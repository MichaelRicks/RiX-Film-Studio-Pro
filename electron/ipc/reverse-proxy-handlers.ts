import { app } from 'electron'
import { spawn, spawnSync } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { findFfmpegPath } from '../export/ffmpeg-utils'
import { logger } from '../logger'
import { handle } from './typed-handle'

// A reversed clip can't be played backwards by a <video>/<audio> element, so the
// preview seeked a paused video every frame (stutter) and muted the audio. Instead
// the editor asks for a reversed copy of the source, rendered once with ffmpeg and
// cached, and plays that forward like any other clip. Export never uses it: it
// reverses the original at full quality.

const PROXY_WIDTH = 1280
// ffmpeg's `reverse` holds every decoded frame in memory; past this the proxy is
// skipped and the preview falls back to the old behaviour.
const MAX_FRAME_BYTES = 2.5 * 1024 ** 3
const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000

let pruned = false
const inflight = new Map<string, Promise<{ status: 'ready'; path: string } | { status: 'failed'; error: string }>>()

function proxyDir(): string {
  const dir = path.join(app.getPath('userData'), 'reverse-proxies')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function pruneOldProxies(dir: string): void {
  if (pruned) return
  pruned = true
  try {
    const cutoff = Date.now() - PRUNE_AFTER_MS
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name)
      if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true })
    }
  } catch (error) {
    logger.warn(`[reverse-proxy] prune failed: ${error}`)
  }
}

interface ProbeInfo { hasVideo: boolean; hasAudio: boolean; duration: number; width: number; height: number; fps: number }

function probe(ffmpegPath: string, file: string): ProbeInfo {
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-i', file], { encoding: 'utf8', timeout: 10000 })
  const text = (result.stdout || '') + (result.stderr || '')
  const dur = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  const video = text.match(/Video:.*?,\s*(\d{2,5})x(\d{2,5})/)
  const fps = text.match(/,\s*(\d+(?:\.\d+)?)\s*fps/)
  return {
    hasVideo: /Video:/.test(text) && !/Video:\s*(mjpeg|png)\b.*attached pic/i.test(text),
    hasAudio: /Audio:/.test(text),
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + parseFloat(dur[3]) : 0,
    width: video ? Number(video[1]) : 0,
    height: video ? Number(video[2]) : 0,
    fps: fps ? parseFloat(fps[1]) : 24,
  }
}

async function buildProxy(srcPath: string): Promise<{ status: 'ready'; path: string } | { status: 'failed'; error: string }> {
  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) return { status: 'failed', error: 'ffmpeg not found' }
  const stat = fs.statSync(srcPath)
  const dir = proxyDir()
  pruneOldProxies(dir)

  const info = probe(ffmpegPath, srcPath)
  const key = crypto.createHash('sha1').update(`${srcPath}|${stat.size}|${stat.mtimeMs}`).digest('hex').slice(0, 20)
  const out = path.join(dir, `${key}.${info.hasVideo ? 'mp4' : 'm4a'}`)
  if (fs.existsSync(out)) {
    fs.utimesSync(out, new Date(), new Date())
    return { status: 'ready', path: out }
  }

  if (info.hasVideo) {
    const scale = info.width > PROXY_WIDTH ? PROXY_WIDTH / info.width : 1
    const frameBytes = info.width * scale * info.height * scale * 1.5
    const estimate = frameBytes * info.fps * info.duration
    if (estimate > MAX_FRAME_BYTES) {
      return { status: 'failed', error: `Clip too long to reverse in preview (${Math.round(info.duration)}s)` }
    }
  } else if (!info.hasAudio) {
    return { status: 'failed', error: 'No audio or video in source' }
  }

  const tmp = path.join(dir, `${key}.partial.${info.hasVideo ? 'mp4' : 'm4a'}`)
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', srcPath]
  if (info.hasVideo) {
    args.push('-vf', `scale='min(${PROXY_WIDTH},iw)':-2,reverse`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-g', '12')
  } else {
    args.push('-vn')
  }
  if (info.hasAudio) args.push('-af', 'areverse', '-c:a', 'aac', '-b:a', '192k')
  else args.push('-an')
  args.push('-movflags', '+faststart', tmp)

  logger.info(`[reverse-proxy] building ${path.basename(srcPath)} -> ${path.basename(out)}`)
  return new Promise(resolve => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    try { if (proc.pid) os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL) } catch { /* not permitted */ }
    let stderr = ''
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    proc.on('error', error => resolve({ status: 'failed', error: `Failed to start ffmpeg: ${error.message}` }))
    proc.on('close', code => {
      if (code === 0 && fs.existsSync(tmp)) {
        fs.renameSync(tmp, out)
        resolve({ status: 'ready', path: out })
      } else {
        fs.rmSync(tmp, { force: true })
        logger.error(`[reverse-proxy] ffmpeg exited ${code}: ${stderr.slice(-300)}`)
        resolve({ status: 'failed', error: `ffmpeg exited ${code}` })
      }
    })
  })
}

export function registerReverseProxyHandlers(): void {
  handle('ensureReverseProxy', ({ srcPath }) => {
    let file: string
    try {
      file = path.resolve(srcPath.startsWith('file://') ? fileURLToPath(srcPath) : srcPath)
      if (!fs.existsSync(file)) return Promise.resolve({ status: 'failed' as const, error: 'Source file not found' })
    } catch (error) {
      return Promise.resolve({ status: 'failed' as const, error: String(error) })
    }
    // One ffmpeg at a time per file, and one run per file however many clips share it.
    let job = inflight.get(file)
    if (!job) {
      job = buildProxy(file)
        .catch(error => ({ status: 'failed' as const, error: String(error) }))
        .finally(() => inflight.delete(file))
      inflight.set(file, job)
    }
    return job
  })
}

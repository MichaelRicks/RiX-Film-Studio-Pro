import { spawn, spawnSync, ChildProcess } from 'child_process'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { isDev, getCurrentDir } from '../config'
import { logger } from '../logger'
import { getPythonDir } from '../python-setup'
import { keyframeExpr } from './keyframe-expr'

let activeExportProcess: ChildProcess | null = null

export function findFfmpegPath(): string | null {
  let binDir: string | null = null

  if (process.platform === 'win32') {
    const imageioRelPath = path.join('Lib', 'site-packages', 'imageio_ffmpeg', 'binaries')
    binDir = isDev
      ? path.join(getCurrentDir(), 'backend', '.venv', imageioRelPath)
      : path.join(getPythonDir(), imageioRelPath)
  } else {
    // macOS/Linux: find lib/python3.X/site-packages dynamically
    const venvBase = isDev
      ? path.join(getCurrentDir(), 'backend', '.venv')
      : getPythonDir()
    const libDir = path.join(venvBase, 'lib')
    if (fs.existsSync(libDir)) {
      const pythonDir = fs.readdirSync(libDir).find(e => e.startsWith('python3'))
      if (pythonDir) {
        binDir = path.join(libDir, pythonDir, 'site-packages', 'imageio_ffmpeg', 'binaries')
      }
    }
  }

  if (binDir && fs.existsSync(binDir)) {
    const bin = fs.readdirSync(binDir).find(f => f.startsWith('ffmpeg'))
    if (bin) return path.join(binDir, bin)
  }

  return null
}

/** Check if a video file contains an audio stream using ffprobe/ffmpeg */
export function fileHasAudio(ffmpegPath: string, filePath: string): boolean {
  try {
    const result = spawnSync(ffmpegPath, ['-i', filePath, '-hide_banner'], {
      encoding: 'utf8',
      timeout: 5000,
    })
    const output = (result.stdout || '') + (result.stderr || '')
    return output.includes('Audio:')
  } catch {
    return false
  }
}


/** Run an ffmpeg command and return a promise. Logs stderr and sets activeExportProcess.
 *  `onProgress`, if given, is called with the encoded output position in seconds
 *  (parsed from ffmpeg's `time=` field) so callers can drive a progress bar. */
export function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  onProgress?: (outTimeSec: number) => void,
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    // Windows refuses a command line over 32,767 chars with a bare ENAMETOOLONG; say what
    // actually happened. (Long timelines are split into passes well before this.)
    const commandLength = ffmpegPath.length + args.reduce((n, a) => n + a.length + 3, 0)
    if (process.platform === 'win32' && commandLength > 32000) {
      const inputs = args.filter(a => a === '-i').length
      logger.error(`[ffmpeg] command line too long (${commandLength} chars, ${inputs} inputs)`)
      resolve({ success: false, error: `Export needs too many source files in one step (${inputs} inputs). Split the timeline into shorter sequences and export each.` })
      return
    }
    logger.info( `[ffmpeg] spawn: ${args.join(' ').slice(0, 400)}`)
    const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    activeExportProcess = proc
    // An export can pin every core for half an hour; run below normal priority so the rest of
    // the machine (and the app's own window) stays responsive. Costs little when it's idle.
    try { if (proc.pid) os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL) } catch { /* not permitted: run at normal */ }
    let stderrLog = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderrLog += text
      // ffmpeg rewrites its progress line in place with carriage returns, so
      // split on both \r and \n to see each update, not one giant line.
      const lines = text.split(/[\r\n]+/)
      for (const line of lines) {
        if (line.includes('frame=') || line.includes('Error') || line.includes('error')) {
          logger.info( `[ffmpeg] ${line.trim().slice(0, 200)}`)
        }
        if (onProgress) {
          const m = line.match(/time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
          if (m) {
            const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + parseFloat(m[3])
            if (Number.isFinite(sec)) onProgress(sec)
          }
        }
      }
    })
    proc.on('close', (code) => {
      activeExportProcess = null
      if (code === 0) {
        resolve({ success: true })
      } else {
        const errLines = stderrLog.split('\n').filter(l => l.trim()).slice(-5).join('\n')
        logger.error( `[ffmpeg] exited ${code}:\n${errLines}`)
        resolve({ success: false, error: `FFmpeg failed (code ${code}): ${errLines.slice(0, 300)}` })
      }
    })
    proc.on('error', (err) => {
      activeExportProcess = null
      resolve({ success: false, error: `Failed to start ffmpeg: ${err.message}` })
    })
  })
}

function runFfmpegSyncOrThrow(ffmpegPath: string, args: string[], timeoutMs = 30000): void {
  logger.info(`[ffmpeg-sync] spawn: ${args.join(' ').slice(0, 400)}`)
  const result = spawnSync(ffmpegPath, args, { timeout: timeoutMs })
  if (result.status === 0) return
  const stderr = (result.stderr?.toString() || '').split('\n').filter(Boolean).slice(-5).join('\n')
  throw new Error(`FFmpeg failed (code ${result.status}): ${stderr.slice(0, 300)}`)
}

export function extractVideoFrameToFile({
  videoPath,
  seekTime,
  width,
  quality,
  outputPath,
  accurate = false,
  timeoutMs = 10000,
}: {
  videoPath: string
  seekTime: number
  width?: number
  quality?: number
  outputPath?: string
  /**
   * When true, seek *after* -i (frame-accurate but slower, decodes from 0 to
   * seekTime). Default false uses the fast keyframe seek before -i, which is
   * fine for thumbnails but can land a few frames off — not acceptable when the
   * user is saving the exact frame they paused on.
   */
  accurate?: boolean
  timeoutMs?: number
}): string {
  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) {
    throw new Error('ffmpeg not found')
  }
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`)
  }

  const resolvedOutputPath = outputPath
    ?? path.join(
      os.tmpdir(),
      `ltx_frame_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`,
    )

  const seekArgs = ['-ss', String(Math.max(0, seekTime))]
  const args: string[] = [
    ...(accurate ? ['-i', videoPath, ...seekArgs] : [...seekArgs, '-i', videoPath]),
    ...(width ? ['-vf', `scale=${width}:-2`] : []),
    '-frames:v', '1',
    ...(quality !== undefined ? ['-q:v', String(quality)] : []),
    '-y',
    resolvedOutputPath,
  ]

  logger.info(`[extract-frame] ${args.join(' ').slice(0, 300)}`)
  runFfmpegSyncOrThrow(ffmpegPath, args, timeoutMs)

  if (!fs.existsSync(resolvedOutputPath)) {
    throw new Error('ffmpeg produced no output file')
  }

  return resolvedOutputPath
}

export function getVideoDimensions(videoPath: string): { width: number; height: number } {
  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) {
    throw new Error('ffmpeg not found')
  }
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`)
  }

  const result = spawnSync(ffmpegPath, ['-hide_banner', '-i', videoPath], {
    encoding: 'utf8',
    timeout: 10000,
  })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  const videoStreamLine = output.split('\n').find(line => line.includes('Video:'))
  const match = videoStreamLine?.match(/(\d{2,5})x(\d{2,5})(?:[,\s\[]|$)/)

  if (!match) {
    throw new Error(`Could not determine video dimensions for ${videoPath}`)
  }

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid video dimensions for ${videoPath}: ${match[1]}x${match[2]}`)
  }

  return { width, height }
}

/** Parse the video stream's fps from ffmpeg -i output; falls back to 24. */
export function getVideoFps(ffmpegPath: string, videoPath: string): number {
  try {
    const result = spawnSync(ffmpegPath, ['-i', videoPath, '-hide_banner'], { encoding: 'utf8', timeout: 5000 })
    const output = (result.stdout || '') + (result.stderr || '')
    const m = output.match(/(\d+(?:\.\d+)?)\s*fps/)
    const fps = m ? Number(m[1]) : NaN
    return Number.isFinite(fps) && fps > 0 ? fps : 24
  } catch {
    return 24
  }
}

/**
 * Extract the final frame of a video to a full-resolution PNG. Reads only the
 * last second (`-sseof -1`) and reverses it so `-frames:v 1` yields the true
 * last frame — robust across variable frame counts, no fps math needed.
 */
export function extractLastFrameToFile({ videoPath, outputPath, timeoutMs = 15000 }: {
  videoPath: string
  outputPath: string
  timeoutMs?: number
}): string {
  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) throw new Error('ffmpeg not found')
  if (!fs.existsSync(videoPath)) throw new Error(`Video file not found: ${videoPath}`)

  const args = ['-sseof', '-1', '-i', videoPath, '-vf', 'reverse', '-frames:v', '1', '-y', outputPath]
  logger.info(`[extract-last-frame] ${args.join(' ').slice(0, 300)}`)
  runFfmpegSyncOrThrow(ffmpegPath, args, timeoutMs)
  if (!fs.existsSync(outputPath)) throw new Error('ffmpeg produced no output file')
  return outputPath
}

/**
 * Average RGB of one frame, via a true box-average downscale to 1x1 read as raw
 * rgb24 (3 bytes). `vf` selects/prepares the frame(s) before the scale (e.g.
 * "trim=start_frame=1:end_frame=2" to grab a video's second frame). Returns null
 * if ffmpeg produces nothing usable — callers must treat that as "skip matching".
 */
function averageRgb(ffmpegPath: string, inputPath: string, vf: string): [number, number, number] | null {
  // 16-bit output (rgb48le): an 8-bit average snaps to whole levels, and the whole point
  // here is to measure a 2-3/255 shift to a fraction of a level. Convert to RGB at full
  // resolution BEFORE averaging: averaging the YUV planes first skips the per-pixel clip at
  // black, which on a dark frame is worth over a level and no longer matches what's on screen.
  const result = spawnSync(
    ffmpegPath,
    ['-v', 'error', '-i', inputPath, '-vf', `${vf},format=rgb24,scale=1:1:flags=area,format=rgb48le`, '-frames:v', '1',
     '-f', 'rawvideo', '-pix_fmt', 'rgb48le', '-'],
    { maxBuffer: 1024 * 1024, timeout: 15000 },
  )
  const buf = result.stdout
  if (!buf || buf.length < 6) return null
  return [buf.readUInt16LE(0) / 257, buf.readUInt16LE(2) / 257, buf.readUInt16LE(4) / 257]
}

/** The clip's YUV conventions, read from ffmpeg's stream line: matrix (bt709 vs bt601) and range (tv vs pc). */
function videoYuvConventions(ffmpegPath: string, videoPath: string): { bt709: boolean; fullRange: boolean } {
  const result = spawnSync(ffmpegPath, ['-i', videoPath, '-hide_banner'], { encoding: 'utf8', timeout: 5000 })
  const line = ((result.stdout || '') + (result.stderr || '')).split('\n').find(l => l.includes('Video:')) ?? ''
  return {
    bt709: /bt709/.test(line) || !/(bt470bg|smpte170m|bt601)/.test(line),
    fullRange: /\(pc[,)]/.test(line),
  }
}

// Cap per-channel correction: the systematic VAE darkening is ~2-3/255, so a
// larger measured delta means the continuation legitimately changed grade (a
// light turned on, the camera moved to a brighter area) -- clamp so the match
// only cancels the bias and never fights real content.
const _MAX_COLOR_MATCH_OFFSET = 8

/**
 * Per-channel additive offset (as an ffmpeg lutrgb filter fragment) that nudges the
 * continuation's grade back to the source's, or null when no meaningful correction
 * applies. `referencePath` is the seed frame (the source clip's last frame); the
 * clip's second frame (index 1 -- the one that becomes the new lead after the trim)
 * is what we match, since it is the boundary the viewer sees against the source.
 */
function colorMatchLutFilter(ffmpegPath: string, videoPath: string, referencePath: string): string | null {
  const seed = averageRgb(ffmpegPath, referencePath, 'null')
  const clip = averageRgb(ffmpegPath, videoPath, 'trim=start_frame=1:end_frame=2,setpts=PTS-STARTPTS')
  if (!seed || !clip) return null
  const clamp = (v: number) => Math.max(-_MAX_COLOR_MATCH_OFFSET, Math.min(_MAX_COLOR_MATCH_OFFSET, v))
  const [dr, dg, db] = [clamp(seed[0] - clip[0]), clamp(seed[1] - clip[1]), clamp(seed[2] - clip[2])]
  if (Math.abs(dr) < 0.1 && Math.abs(dg) < 0.1 && Math.abs(db) < 0.1) return null

  // Apply the shift on the YUV planes themselves. Going through RGB (lutrgb) re-converts
  // the matrix on the way back and lands ~1 level darker than asked, and an 8-bit LUT can
  // only move by whole levels -- so do it at 12-bit, and let the final 8-bit conversion
  // dither the fractions back in.
  const { bt709, fullRange } = videoYuvConventions(ffmpegPath, videoPath)
  const [kr, kb] = bt709 ? [0.2126, 0.0722] : [0.299, 0.114]
  const kg = 1 - kr - kb
  const dyFull = kr * dr + kg * dg + kb * db
  const yScale = (fullRange ? 255 : 219) / 255
  const cScale = (fullRange ? 255 : 224) / 255
  const dY = dyFull * yScale
  const dU = ((db - dyFull) / (2 * (1 - kb))) * cScale
  const dV = ((dr - dyFull) / (2 * (1 - kr))) * cScale
  const to12 = (v: number) => (v * 16).toFixed(3)  // 8-bit levels -> 12-bit levels
  logger.info(`[trim-first-frame] color-match rgb offset r=${dr.toFixed(2)} g=${dg.toFixed(2)} b=${db.toFixed(2)} (seed=${seed.map(v => v.toFixed(2))} clip1=${clip.map(v => v.toFixed(2))}) -> yuv ${dY.toFixed(2)},${dU.toFixed(2)},${dV.toFixed(2)}`)
  return `format=yuv420p12le,lutyuv=y=val+(${to12(dY)}):u=val+(${to12(dU)}):v=val+(${to12(dV)}),format=yuv420p`
}

/**
 * Re-encode a video with its first frame removed (and the matching audio slice
 * dropped so A/V stays in sync). Used by "Continue as new shot" to delete the
 * duplicate lead frame the i2v conditioning reproduces from the source's last
 * frame, so the continuation butt-joins the source with no stutter.
 *
 * `colorMatchReferencePath` (the seed frame) enables a subtle per-channel grade
 * match: the i2v VAE reproduces the conditioning frame ~2-3/255 darker, which
 * compounds across chained continuations; matching the clip's lead frame back to
 * the seed cancels that at the join. Measured/clamped, so it only removes the
 * systematic bias.
 */
export function trimFirstFrameToFile({ videoPath, outputPath, colorMatchReferencePath, timeoutMs = 120000 }: {
  videoPath: string
  outputPath: string
  colorMatchReferencePath?: string
  timeoutMs?: number
}): string {
  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) throw new Error('ffmpeg not found')
  if (!fs.existsSync(videoPath)) throw new Error(`Video file not found: ${videoPath}`)

  const hasAudio = fileHasAudio(ffmpegPath, videoPath)
  const fps = getVideoFps(ffmpegPath, videoPath)
  const colorMatchLut =
    colorMatchReferencePath && fs.existsSync(colorMatchReferencePath)
      ? colorMatchLutFilter(ffmpegPath, videoPath, colorMatchReferencePath)
      : null
  const videoFilter = ['trim=start_frame=1', 'setpts=PTS-STARTPTS', ...(colorMatchLut ? [colorMatchLut] : [])].join(',')
  const args: string[] = [
    '-i', videoPath,
    '-vf', videoFilter,
    ...(hasAudio
      ? ['-af', `atrim=start=${(1 / fps).toFixed(6)},asetpts=PTS-STARTPTS`, '-c:a', 'aac', '-b:a', '192k']
      : ['-an']),
    // High quality: this re-encodes an already-compressed clip, and a second generation at
    // a looser setting adds its own blocking on top of the source's.
    '-c:v', 'libx264', '-crf', '12', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-y', outputPath,
  ]
  logger.info(`[trim-first-frame] ${args.join(' ').slice(0, 300)}`)
  runFfmpegSyncOrThrow(ffmpegPath, args, timeoutMs)
  if (!fs.existsSync(outputPath)) throw new Error('ffmpeg produced no output file')
  return outputPath
}

/**
 * Reframe: crop an image or video to a source-pixel rect, optionally scaling the
 * crop to a fixed output size (e.g. 1080×1920). Async so a long video crop doesn't
 * block the main process; deliberately does NOT touch activeExportProcess, so it
 * can't collide with (or be cancelled by) a timeline export.
 */
export async function reframeCropToFile({ inputPath, outputPath, type, crop, scale, keyframes, timeoutMs = 600000 }: {
  inputPath: string
  outputPath: string
  type: 'image' | 'video'
  crop: { x: number; y: number; width: number; height: number }
  scale?: { width: number; height: number }
  /** Videos: animate the crop origin between these keys (ease-in-out). */
  keyframes?: Array<{ t: number; x: number; y: number }>
  timeoutMs?: number
}): Promise<string> {
  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) throw new Error('ffmpeg not found')
  if (!fs.existsSync(inputPath)) throw new Error(`File not found: ${inputPath}`)

  // yuv420p (and most encoders) need even dimensions/offsets.
  const evenDown = (n: number) => Math.max(0, Math.floor(n / 2) * 2)
  const w = Math.max(2, evenDown(crop.width))
  const h = Math.max(2, evenDown(crop.height))
  const sorted = keyframes && keyframes.length > 1 ? [...keyframes].sort((a, b) => a.t - b.t) : null
  // Keyed: per-frame x/y expressions (crop re-evaluates them every frame and
  // rounds to the chroma grid itself). Single-quoted so the commas inside the
  // if()s aren't read as filter separators.
  const xArg = sorted ? `'${keyframeExpr(sorted.map(k => ({ t: k.t, v: k.x })))}'` : String(evenDown(crop.x))
  const yArg = sorted ? `'${keyframeExpr(sorted.map(k => ({ t: k.t, v: k.y })))}'` : String(evenDown(crop.y))
  const filters = [`crop=w=${w}:h=${h}:x=${xArg}:y=${yArg}`]
  if (scale) filters.push(`scale=${Math.max(2, evenDown(scale.width))}:${Math.max(2, evenDown(scale.height))}:flags=lanczos`)
  const vf = filters.join(',')

  const ext = path.extname(outputPath).toLowerCase()
  const args: string[] =
    type === 'video'
      ? [
          '-i', inputPath, '-vf', vf,
          '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
          '-c:a', 'copy', '-movflags', '+faststart',
          '-y', outputPath,
        ]
      : [
          '-i', inputPath, '-vf', vf, '-frames:v', '1',
          ...(ext === '.jpg' || ext === '.jpeg' ? ['-q:v', '2'] : []),
          '-y', outputPath,
        ]

  logger.info(`[reframe] ${args.join(' ').slice(0, 400)}`)
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000) })
    const timer = setTimeout(() => proc.kill(), timeoutMs)
    proc.on('error', (err) => { clearTimeout(timer); reject(err) })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) return resolve()
      const tail = stderr.split('\n').filter(l => l.trim()).slice(-5).join('\n')
      reject(new Error(`FFmpeg reframe failed (code ${code}): ${tail.slice(0, 300)}`))
    })
  })
  if (!fs.existsSync(outputPath)) throw new Error('ffmpeg produced no output file')
  return outputPath
}

export function stopExportProcess(): void {
  if (activeExportProcess) {
    logger.info( 'Stopping active export process...')
    activeExportProcess.kill()
    activeExportProcess = null
  }
}

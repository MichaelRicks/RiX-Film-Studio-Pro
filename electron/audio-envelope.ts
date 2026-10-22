import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import type { AudioEnvelope } from '../shared/music-ducking'

// Loudness over time of an audio file (or a video's soundtrack), for auto-ducking.
// Decoded once to mono 8 kHz and reduced to one RMS value per HOP seconds; cached by
// path + modified time, since the preview and the export both ask for the same files.

const SAMPLE_RATE = 8000
const HOP = 0.05
const SILENT_DB = -100

const cache = new Map<string, AudioEnvelope>()

export function computeAudioEnvelope(ffmpegPath: string, filePath: string): Promise<AudioEnvelope> {
  let key = filePath
  try { key = `${filePath}|${fs.statSync(filePath).mtimeMs}` } catch { return Promise.resolve({ hop: HOP, db: [] }) }
  const cached = cache.get(key)
  if (cached) return Promise.resolve(cached)

  return new Promise((resolve) => {
    const hopSamples = Math.round(SAMPLE_RATE * HOP)
    const proc = spawn(ffmpegPath, [
      '-v', 'error', '-i', filePath, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'ignore'] })
    try { if (proc.pid) os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL) } catch { /* normal priority */ }

    const db: number[] = []
    let sumSquares = 0
    let count = 0
    let carry: Buffer = Buffer.alloc(0)

    const flushHop = () => {
      const rms = Math.sqrt(sumSquares / Math.max(1, count)) / 32768
      db.push(rms > 0 ? Math.max(SILENT_DB, Math.round(20 * Math.log10(rms) * 10) / 10) : SILENT_DB)
      sumSquares = 0
      count = 0
    }

    proc.stdout.on('data', (chunk: Buffer) => {
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk
      const usable = buf.length - (buf.length % 2)
      for (let i = 0; i < usable; i += 2) {
        const v = buf.readInt16LE(i)
        sumSquares += v * v
        count += 1
        if (count === hopSamples) flushHop()
      }
      carry = buf.subarray(usable)
    })
    const done = () => {
      if (count > 0) flushHop()
      const envelope = { hop: HOP, db }
      // A file with no audio decodes to nothing; cache that too so it isn't retried.
      cache.set(key, envelope)
      resolve(envelope)
    }
    proc.on('close', done)
    proc.on('error', () => resolve({ hop: HOP, db: [] }))
  })
}

import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { logger } from '../logger'
import { fileHasAudio } from './ffmpeg-utils'
import type { ExportClip } from './timeline'

const SAMPLE_RATE = 48000
const NUM_CHANNELS = 2
const BYTES_PER_SAMPLE = 2 // 16-bit signed LE
const BYTES_PER_FRAME = NUM_CHANNELS * BYTES_PER_SAMPLE // 4 bytes per stereo frame

/** Extract raw PCM from a file via ffmpeg into `outFile`; resolves with the byte count.
 *  Streams to disk so a long source never has to fit in memory. */
function extractPcmToFile(
  ffmpegPath: string,
  filePath: string, trimStart: number, trimEnd: number, speed: number, reversed: boolean,
  outFile: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    // Build audio filter chain: trim -> reset PTS -> speed -> reverse
    // Using atrim (not -ss/-t) for sample-accurate trimming
    const filters: string[] = [
      `atrim=start=${trimStart.toFixed(6)}:end=${trimEnd.toFixed(6)}`,
      'asetpts=PTS-STARTPTS',
    ]
    if (speed !== 1) {
      // atempo only supports 0.5-100, chain multiple for extreme values
      let remaining = speed
      while (remaining > 2.0) { filters.push('atempo=2.0'); remaining /= 2.0 }
      while (remaining < 0.5) { filters.push('atempo=0.5'); remaining /= 0.5 }
      filters.push(`atempo=${remaining.toFixed(6)}`)
    }
    if (reversed) filters.push('areverse')

    const args = [
      '-i', filePath,
      '-af', filters.join(','),
      '-f', 's16le', '-ac', String(NUM_CHANNELS), '-ar', String(SAMPLE_RATE),
      'pipe:1',
    ]
    const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const out = fs.createWriteStream(outFile)
    let bytes = 0
    let exitCode: number | null = null
    let finished = false
    const settle = () => {
      if (exitCode === null || !finished) return
      if (exitCode === 0) resolve(bytes)
      else reject(new Error(`PCM extraction failed (code ${exitCode}) for ${filePath}`))
    }
    proc.stdout?.on('data', (chunk: Buffer) => { bytes += chunk.length })
    proc.stdout?.pipe(out)
    proc.stderr?.on('data', () => {}) // drain stderr to prevent blocking
    out.on('finish', () => { finished = true; settle() })
    out.on('error', reject)
    proc.on('close', (code) => { exitCode = code ?? -1; settle() })
    proc.on('error', reject)
  })
}

interface AudioSource {
  filePath: string; trimStart: number; trimEnd: number;
  timelineStart: number; speed: number; reversed: boolean; volume: number;
  audioFadeIn: number; audioFadeOut: number;
  volumeKeyframes?: { t: number; value: number }[];
}

/** Sample a pre-sorted piecewise-linear volume envelope at time `t` (seconds
 *  from clip start); clamps to the first/last keyframe outside the range. */
function sampleVolumeEnvelope(ks: { t: number; value: number }[], t: number): number {
  if (t <= ks[0].t) return ks[0].value
  const last = ks[ks.length - 1]
  if (t >= last.t) return last.value
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1]
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t
      return span <= 0 ? b.value : a.value + (b.value - a.value) * ((t - a.t) / span)
    }
  }
  return last.value
}

// Mix in windows of this many seconds so memory stays flat for hour-long timelines
// (a whole-program Float64 accumulator is ~2.8 GB per hour and blows the array-buffer limit).
const CHUNK_SECONDS = 60

/**
 * Mix all audio from clips into a raw Int16LE PCM file at `outFile`, one
 * CHUNK_SECONDS window at a time. Each source is extracted once to a temp file and
 * sliced per window. Returns the byte length with the sample rate and channel count.
 */
export async function mixAudioToPcmFile(
  clips: ExportClip[],
  totalDuration: number,
  ffmpegPath: string,
  outFile: string,
): Promise<{ bytes: number; sampleRate: number; channels: number }> {
  // Collect audio sources from ORIGINAL clips
  const audioProbeCache = new Map<string, boolean>()
  const audioSources: AudioSource[] = []

  for (const c of clips) {
    const hasKeyframes = !!(c.volumeKeyframes && c.volumeKeyframes.length > 0)
    // A keyframed clip can be audible even if its flat volume is 0.
    if (c.muted || (c.volume <= 0 && !hasKeyframes)) continue
    const fp = c.path
    if (!fp || !fs.existsSync(fp)) continue

    if (c.type === 'audio') {
      audioSources.push({
        filePath: fp,
        trimStart: c.trimStart,
        trimEnd: c.trimStart + c.duration * c.speed,
        timelineStart: c.startTime,
        speed: c.speed,
        reversed: c.reversed,
        volume: c.volume,
        audioFadeIn: c.audioFadeIn ?? 0,
        audioFadeOut: c.audioFadeOut ?? 0,
        volumeKeyframes: c.volumeKeyframes,
      })
    } else if (c.type === 'video') {
      if (!audioProbeCache.has(fp)) {
        audioProbeCache.set(fp, fileHasAudio(ffmpegPath, fp))
      }
      if (!audioProbeCache.get(fp)) continue
      audioSources.push({
        filePath: fp,
        trimStart: c.trimStart,
        trimEnd: c.trimStart + c.duration * c.speed,
        timelineStart: c.startTime,
        speed: c.speed,
        reversed: c.reversed,
        volume: c.volume,
        audioFadeIn: c.audioFadeIn ?? 0,
        audioFadeOut: c.audioFadeOut ?? 0,
        volumeKeyframes: c.volumeKeyframes,
      })
    }
  }

  logger.info( `[Export] Audio: ${audioSources.length} source(s) from ${clips.length} clip(s)`)

  const totalFrames = Math.ceil(totalDuration * SAMPLE_RATE)
  const totalSamples = totalFrames * NUM_CHANNELS

  // Extract each source once to disk; remember where it lands on the timeline.
  interface Extracted { src: AudioSource; fd: number; startSample: number; numSamples: number }
  const extracted: Extracted[] = []
  const tmpFiles: string[] = []
  try {
    for (let i = 0; i < audioSources.length; i++) {
      const src = audioSources[i]
      logger.info( `[Export] Audio ${i + 1}/${audioSources.length}: ${path.basename(src.filePath)} trim=${src.trimStart.toFixed(2)}-${src.trimEnd.toFixed(2)} @${src.timelineStart.toFixed(2)}s vol=${src.volume}`)
      const file = `${outFile}.src${i}`
      tmpFiles.push(file)
      try {
        const bytes = await extractPcmToFile(ffmpegPath, src.filePath, src.trimStart, src.trimEnd, src.speed, src.reversed, file)
        const numSamples = Math.floor(bytes / BYTES_PER_SAMPLE)
        const startFrame = Math.round(src.timelineStart * SAMPLE_RATE)
        extracted.push({ src, fd: fs.openSync(file, 'r'), startSample: startFrame * NUM_CHANNELS, numSamples })
        logger.info( `[Export] Audio ${i + 1}: extracted ${numSamples} samples (${(numSamples / SAMPLE_RATE / NUM_CHANNELS).toFixed(2)}s) at offset frame ${startFrame}`)
      } catch (err: any) {
        logger.warn( `[Export] Failed to extract audio from ${src.filePath}: ${err.message}`)
      }
    }

    const outFd = fs.openSync(outFile, 'w')
    try {
      const chunkSamples = CHUNK_SECONDS * SAMPLE_RATE * NUM_CHANNELS // even, so windows stay frame-aligned
      const mixBuffer = new Float64Array(chunkSamples)
      for (let chunkStart = 0; chunkStart < totalSamples; chunkStart += chunkSamples) {
        const chunkEnd = Math.min(totalSamples, chunkStart + chunkSamples)
        const len = chunkEnd - chunkStart
        mixBuffer.fill(0, 0, len)

        for (const ex of extracted) {
          const { src, startSample, numSamples } = ex
          // Source samples that land inside this window.
          const sFrom = Math.max(0, chunkStart - startSample)
          const sTo = Math.min(numSamples, chunkEnd - startSample)
          if (sTo <= sFrom) continue

          const pcm = Buffer.alloc((sTo - sFrom) * BYTES_PER_SAMPLE)
          fs.readSync(ex.fd, pcm, 0, pcm.length, sFrom * BYTES_PER_SAMPLE)

          // Linear fade in/out envelope, in frames (a frame = NUM_CHANNELS samples).
          const clipFrames = Math.floor(numSamples / NUM_CHANNELS)
          const fadeInFrames = Math.max(0, Math.round((src.audioFadeIn || 0) * SAMPLE_RATE))
          const fadeOutFrames = Math.max(0, Math.round((src.audioFadeOut || 0) * SAMPLE_RATE))
          const hasFade = fadeInFrames > 0 || fadeOutFrames > 0

          // Volume automation envelope (pre-sorted once); sampled per frame below.
          const kfs = (src.volumeKeyframes && src.volumeKeyframes.length > 0)
            ? [...src.volumeKeyframes].sort((a, b) => a.t - b.t)
            : null
          let baseGain = src.volume

          for (let s = sFrom; s < sTo; s++) {
            const destIdx = startSample + s - chunkStart
            if (destIdx < 0 || destIdx >= len) continue
            const frame = (s / NUM_CHANNELS) | 0
            // Recompute the automated base gain once per stereo frame (channel 0).
            if (kfs && (s % NUM_CHANNELS) === 0) {
              baseGain = sampleVolumeEnvelope(kfs, frame / SAMPLE_RATE)
            }
            const value = pcm.readInt16LE((s - sFrom) * BYTES_PER_SAMPLE)
            let gain = kfs ? baseGain : src.volume
            if (hasFade) {
              if (fadeInFrames > 0 && frame < fadeInFrames) {
                gain *= frame / fadeInFrames
              }
              if (fadeOutFrames > 0 && frame >= clipFrames - fadeOutFrames) {
                gain *= Math.max(0, (clipFrames - frame) / fadeOutFrames)
              }
            }
            mixBuffer[destIdx] += value * gain
          }
        }

        // Convert Float64 accumulator -> Int16 PCM (with clamp) and append.
        const outputPcm = Buffer.alloc(len * BYTES_PER_SAMPLE)
        for (let s = 0; s < len; s++) {
          const clamped = Math.max(-32768, Math.min(32767, Math.round(mixBuffer[s])))
          outputPcm.writeInt16LE(clamped, s * BYTES_PER_SAMPLE)
        }
        fs.writeSync(outFd, outputPcm)
      }
    } finally {
      fs.closeSync(outFd)
    }
  } finally {
    for (const ex of extracted) { try { fs.closeSync(ex.fd) } catch { /* already closed */ } }
    for (const f of tmpFiles) { try { fs.unlinkSync(f) } catch { /* never created */ } }
  }

  return { bytes: totalFrames * BYTES_PER_FRAME, sampleRate: SAMPLE_RATE, channels: NUM_CHANNELS }
}

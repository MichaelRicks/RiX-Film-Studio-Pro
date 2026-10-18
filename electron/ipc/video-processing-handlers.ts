import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  extractVideoFrameToFile,
  extractLastFrameToFile,
  trimFirstFrameToFile,
  reframeCropToFile,
  getVideoDimensions,
  getVideoFps,
  findFfmpegPath,
} from '../export/ffmpeg-utils'
import { ensureLibFolder } from './library-handlers'
import { handle } from './typed-handle'

const CONTINUATIONS_FOLDER = 'Continuations'

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

export function registerVideoProcessingHandlers(): void {
  handle('extractVideoFrame', async ({ videoPath, seekTime, width, quality, outputPath }) => {
    return {
      path: extractVideoFrameToFile({
        videoPath,
        seekTime,
        width,
        // When writing to a user-chosen file (Save frame), don't apply the
        // thumbnail JPEG quality knob — ffmpeg infers the format (e.g. PNG)
        // from the outputPath extension and -q:v would be meaningless.
        quality: outputPath ? undefined : quality ?? 2,
        outputPath,
        // A user-chosen outputPath means "Save frame" — grab the exact frame.
        accurate: Boolean(outputPath),
        timeoutMs: 10000,
      }),
    }
  })

  // Seed the prompt bar's start-frame slot from a clip: its opening frame, which
  // is where a re-roll of that shot starts.
  handle('extractVideoSeedFrame', async ({ videoPath }) => {
    const dir = path.join(os.tmpdir(), 'rix-frame-seed')
    fs.mkdirSync(dir, { recursive: true })
    const framePath = path.join(dir, `frame_${stamp()}.png`)
    extractVideoFrameToFile({ videoPath, seekTime: 0, outputPath: framePath, accurate: true, timeoutMs: 15000 })
    return { path: framePath }
  })

  // "Continue as new shot" — extract the clip's last frame into Continuations to
  // seed an i2v continuation, and report the source dims/fps so the next gen matches.
  handle('continuationExtractLastFrame', async ({ videoPath, seekTime, folder }) => {
    const dir = ensureLibFolder(folder || CONTINUATIONS_FOLDER)
    const framePath = path.join(dir, `continuation_frame_${stamp()}.png`)
    if (seekTime != null) {
      // Scrubbed "Continue from this frame": grab the exact frame (accurate seek).
      extractVideoFrameToFile({ videoPath, seekTime, outputPath: framePath, accurate: true, timeoutMs: 15000 })
    } else {
      extractLastFrameToFile({ videoPath, outputPath: framePath })
    }
    const { width, height } = getVideoDimensions(videoPath)
    const ffmpegPath = findFfmpegPath()
    const fps = ffmpegPath ? getVideoFps(ffmpegPath, videoPath) : 24
    return { framePath, width, height, fps }
  })

  // Drop the duplicate lead frame from a freshly generated continuation and save
  // the clean clip into Continuations.
  handle('continuationSaveTrimmed', async ({ videoPath, colorMatchReference, folder }) => {
    const dir = ensureLibFolder(folder || CONTINUATIONS_FOLDER)
    const outPath = path.join(dir, `continuation_${stamp()}.mp4`)
    trimFirstFrameToFile({ videoPath, outputPath: outPath, colorMatchReferencePath: colorMatchReference })
    return { path: outPath }
  })

  // Reframe (e.g. 16:9 → 9:16): crop into a temp file; the renderer then imports
  // it into the project so it lands in the gallery like any other asset.
  handle('reframeCrop', async ({ srcPath, type, x, y, width, height, outWidth, outHeight, suffix, keyframes }) => {
    const outDir = path.join(os.tmpdir(), 'rix-reframe')
    fs.mkdirSync(outDir, { recursive: true })
    const parsed = path.parse(srcPath)
    const safeSuffix = suffix.replace(/[^a-z0-9-]/gi, '') || 'reframe'
    const outPath = path.join(outDir, `${parsed.name}-${safeSuffix}${parsed.ext}`)
    await reframeCropToFile({
      inputPath: srcPath,
      outputPath: outPath,
      type,
      crop: { x, y, width, height },
      scale: outWidth && outHeight ? { width: outWidth, height: outHeight } : undefined,
      keyframes: type === 'video' && keyframes && keyframes.length > 1 ? keyframes : undefined,
    })
    return { path: outPath }
  })
}

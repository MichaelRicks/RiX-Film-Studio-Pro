import path from 'path'
import fs from 'fs'
import os from 'os'
import { getAllowedRoots, getCurrentDir, isDev } from '../config'
import { findFont } from '../../shared/font-catalog'
import { getMainWindow } from '../window'
import { logger } from '../logger'
import { validatePath } from '../path-validation'
import { findFfmpegPath, getVideoDimensions, runFfmpeg, stopExportProcess } from './ffmpeg-utils'
import { buildDissolveTimeRemap, collectOverlayLayers, computeFinalVideoDuration, findDissolveBoundaries, flattenTimeline, type FlatSegment, type OverlayLayer } from './timeline'
import { buildVideoFilterGraph } from './video-filter'
import { mixAudioToPcmFile } from './audio-mix'
import { handle } from '../ipc/typed-handle'
import type { z } from 'zod'
import type { electronAPISchemas } from '../../shared/electron-api-schema'

/** First existing system SANS font, so exported text overlays match the editor
 *  preview's sans look instead of ffmpeg's default serif. Arial first (it's the
 *  preview font stack's fallback). Returns undefined if none found — drawtext
 *  then omits fontfile and falls back to ffmpeg's default (still renders). */
function resolveExportFont(): string | undefined {
  const candidates = process.platform === 'win32'
    ? ['C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/calibri.ttf', 'C:/Windows/Fonts/tahoma.ttf']
    : process.platform === 'darwin'
      ? ['/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc']
      : ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf']
  for (const f of candidates) {
    try { if (fs.existsSync(f)) return f } catch { /* ignore */ }
  }
  return undefined
}

/** Where the bundled overlay fonts live: public/fonts in dev; in the packaged app
 *  dist/fonts, unpacked from asar (see electron-builder asarUnpack) because ffmpeg
 *  reads the file directly and can't see inside the archive. */
function bundledFontsDir(): string {
  return isDev
    ? path.join(getCurrentDir(), 'public', 'fonts')
    : path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'fonts')
}

/** Windows keeps machine fonts in %WINDIR%\Fonts and per-user installs in
 *  %LOCALAPPDATA%\Microsoft\Windows\Fonts. */
function systemFontDirs(): string[] {
  if (process.platform !== 'win32') return []
  const dirs = [path.join(process.env.WINDIR || 'C:/Windows', 'Fonts')]
  if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'))
  return dirs
}

/** Font file for a text overlay: the catalog's bundled/system file for its family
 *  (bold face when asked for and available), else undefined → default font. */
function resolveOverlayFontFile(fontFamily: string | undefined, bold: boolean): string | undefined {
  const entry = findFont(fontFamily)
  const candidates: string[] = []
  if (entry.bundled) {
    const file = (bold && entry.bundled.bold) || entry.bundled.regular
    candidates.push(path.join(bundledFontsDir(), file))
  }
  if (entry.system) {
    const file = (bold && entry.system.bold) || entry.system.regular
    for (const dir of systemFontDirs()) candidates.push(path.join(dir, file))
  }
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c } catch { /* ignore */ }
  }
  logger.warn(`[Export] No font file for "${fontFamily}" — using the default font`)
  return undefined
}

/** Segments rendered per ffmpeg pass. Every segment is its own input, so one pass over a
 *  long timeline overflows Windows' 32K command line (a 1,250-cut project did), and would
 *  open a thousand files at once even if it fit. */
const SEGMENTS_PER_PASS = Number(process.env.RIX_EXPORT_SEGMENTS_PER_PASS) || 40  // env: lets tests force a path
/** Layers composited per ffmpeg pass: a layer is an input as well. */
const LAYERS_PER_PASS = 30

/** Split the program into passes of about SEGMENTS_PER_PASS, never inside a dissolve (it
 *  overlaps the two segments either side of the join, so they must render together). */
function splitIntoPasses(segments: FlatSegment[]): FlatSegment[][] {
  const dissolveAfter = new Set(findDissolveBoundaries(segments).map(b => b.index))
  const passes: FlatSegment[][] = []
  let current: FlatSegment[] = []
  segments.forEach((segment, i) => {
    current.push(segment)
    if (current.length >= SEGMENTS_PER_PASS && !dissolveAfter.has(i)) { passes.push(current); current = [] }
  })
  if (current.length > 0) passes.push(current)
  return passes
}

export type ExportNativeInput = z.infer<typeof electronAPISchemas.exportNative.input>
export type ExportNativeResult = { success: true } | { success: false; error: string }

/** Render the timeline to a file. `preview` trades quality for speed (ultrafast,
 *  high CRF) — used by the RiX MCP server to render frames for review. */
export async function exportTimelineNative(
  { clips, outputPath, codec, width, height, fps, quality, letterbox, subtitles, textOverlays, vertical }: ExportNativeInput,
  { preview = false }: { preview?: boolean } = {},
): Promise<ExportNativeResult> {
  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) return { success: false, error: 'FFmpeg not found' }

  try {
    validatePath(outputPath, getAllowedRoots())
    for (const clip of clips) {
      const fp = clip.path
      if (fp) validatePath(fp, getAllowedRoots())
    }
  } catch (err) {
    return { success: false, error: String(err) }
  }

  const segments = flattenTimeline(clips)
  if (segments.length === 0) return { success: false, error: 'No clips to export' }

  // 9:16: titles are placed relative to each shot's 9:16 window, which depends on
  // the shot's own shape (how it letterboxes in the 16:9 preview) — probe it.
  if (vertical) {
    const dims = new Map<string, { width: number; height: number } | null>()
    for (const seg of segments) {
      if (!seg.filePath) continue
      if (!dims.has(seg.filePath)) {
        try { dims.set(seg.filePath, getVideoDimensions(seg.filePath)) } catch { dims.set(seg.filePath, null) }
      }
      const d = dims.get(seg.filePath)
      if (d && d.width > 0 && d.height > 0) { seg.srcWidth = d.width; seg.srcHeight = d.height }
    }
  }

  for (const seg of segments) {
    if (seg.filePath && !fs.existsSync(seg.filePath)) {
      return { success: false, error: `Source file not found: ${path.basename(seg.filePath)}` }
    }
  }

  // Graphics composited over the program (logos, lower thirds, PiP) rather than
  // flattened into it. Times stay nominal here: buildVideoFilterGraph converts them
  // onto the program clock itself, along with the titles and the subtitles.
  const layers = collectOverlayLayers(clips)
  for (const layer of layers) {
    if (!layer.filePath || !fs.existsSync(layer.filePath)) {
      return { success: false, error: `Layer source not found: ${path.basename(layer.filePath || '')}` }
    }
  }

  // Total program duration drives the progress percentage: ffmpeg reports the
  // encoded position (`time=`), which we divide by this to get a fraction.
  const totalDur = computeFinalVideoDuration(segments)
  const emitProgress = (percent: number, stage: string) => {
    getMainWindow()?.webContents.send('export-progress', {
      percent: Math.max(0, Math.min(100, Math.round(percent))),
      stage,
    })
  }
  // The video encode (step 1) is by far the longest, so it owns most of the
  // bar; audio + mux share the tail. (An h264 mux is a stream copy and flies.)
  const VIDEO_SHARE = 85

  const tmpDir = os.tmpdir()
  const ts = Date.now()
  const tmpVideo = path.join(tmpDir, `ltx-export-video-${ts}.mkv`)
  const tmpAudio = path.join(tmpDir, `ltx-export-audio-${ts}.wav`)
  // Intermediates of a multi-pass video render (see SEGMENTS_PER_PASS).
  const passTmp: string[] = []
  const cleanup = () => {
    try { fs.unlinkSync(tmpVideo) } catch {}
    try { fs.unlinkSync(tmpAudio) } catch {}
    for (const f of passTmp) { try { fs.unlinkSync(f) } catch {} }
  }

  try {
    logger.info( `[Export] Step 1: Video-only export (${segments.length} segments, ${layers.length} layers)`)
    {
      const fontFile = resolveExportFont()
      const graphOpts = {
        width, height, fps, letterbox, subtitles, textOverlays, fontFile, vertical, layers,
        resolveFontFile: resolveOverlayFontFile,
      }
      const finalEncode = preview ? ['-preset', 'ultrafast', '-crf', '28'] : ['-preset', 'fast', '-crf', '16']

      let graphFileCount = 0
      const runGraph = async (inputs: string[], filterScript: string, outFile: string, encode: string[], onTime: (t: number) => void, constantRate = false) => {
        const filterFile = path.join(tmpDir, `ltx-filter-v-${ts}-${graphFileCount++}.txt`)
        fs.writeFileSync(filterFile, filterScript, 'utf8')
        const result = await runFfmpeg(ffmpegPath, [
          '-y', ...inputs, '-filter_complex_script', filterFile,
          '-map', '[outv]', '-an', '-c:v', 'libx264', ...encode, '-pix_fmt', 'yuv420p',
          // The joined pieces carry millisecond mkv timestamps, which don't divide evenly into
          // frames at 24 fps; re-encoding them as-is leaves the mp4 with colliding timestamps
          // and the mux drops a few frames. Regenerate regular ones.
          ...(constantRate ? ['-fps_mode', 'cfr', '-r', String(fps)] : []),
          outFile,
        ], onTime)
        try { fs.unlinkSync(filterFile) } catch {}
        return result
      }

      emitProgress(0, 'Encoding video')
      if (segments.length <= SEGMENTS_PER_PASS) {
        const { inputs, filterScript } = buildVideoFilterGraph(segments, graphOpts)
        const r = await runGraph(inputs, filterScript, tmpVideo, finalEncode, (t) => {
          emitProgress((totalDur > 0 ? t / totalDur : 0) * VIDEO_SHARE, 'Encoding video')
        })
        if (!r.success) { cleanup(); return { success: false, error: r.error } }
      } else {
        // Long timeline: render the segments in passes, join the pieces losslessly, then
        // apply the letterbox/layers/titles/subtitles over the whole joined program in one
        // pass of their own (they're placed by program time, so they can't be split).
        const passes = splitIntoPasses(segments)
        const needsOverlayPass = Boolean(letterbox) || layers.length > 0
          || (textOverlays?.length ?? 0) > 0 || (subtitles?.length ?? 0) > 0
        const segmentShare = needsOverlayPass ? 0.6 : 1
        // Pieces that get re-encoded by the overlay pass are kept near-lossless, so that
        // second generation doesn't show.
        const pieceEncode = needsOverlayPass ? ['-preset', 'veryfast', '-crf', '10'] : finalEncode
        logger.info(`[Export] Long timeline: ${segments.length} segments in ${passes.length} passes${needsOverlayPass ? ' + overlay pass' : ''}`)

        const pieces: { file: string; frames: number }[] = []
        let doneDur = 0
        let doneFrames = 0
        for (const [pi, pass] of passes.entries()) {
          const piece = path.join(tmpDir, `ltx-export-piece-${ts}-${pi}.mkv`)
          passTmp.push(piece)
          const passDur = computeFinalVideoDuration(pass)
          // Each piece gets the frames between its start and end on the whole program's
          // frame grid (rounding the running total, not each piece), so the pieces add up to
          // the program exactly instead of drifting by a fraction of a frame per piece.
          const frameCount = Math.max(1, Math.round((doneDur + passDur) * fps) - doneFrames)
          const g = buildVideoFilterGraph(pass, { width, height, fps, vertical, stage: 'segments', frameCount })
          doneFrames += frameCount
          const r = await runGraph(g.inputs, g.filterScript, piece, pieceEncode, (t) => {
            const frac = totalDur > 0 ? (doneDur + Math.min(t, passDur)) / totalDur : 0
            emitProgress(frac * VIDEO_SHARE * segmentShare, `Encoding video (part ${pi + 1}/${passes.length})`)
          })
          if (!r.success) { cleanup(); return { success: false, error: r.error } }
          pieces.push({ file: piece, frames: frameCount })
          doneDur += passDur
        }

        const joined = needsOverlayPass ? path.join(tmpDir, `ltx-export-joined-${ts}.mkv`) : tmpVideo
        if (needsOverlayPass) passTmp.push(joined)
        const listFile = path.join(tmpDir, `ltx-export-pieces-${ts}.txt`)
        passTmp.push(listFile)
        // Explicit durations: left to read them off each file, the concat demuxer lands the
        // next piece a frame early or late and the join drops or doubles a frame.
        fs.writeFileSync(listFile, pieces.map(({ file, frames }) => (
          `file '${file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'\nduration ${(frames / fps).toFixed(6)}`
        )).join('\n'), 'utf8')
        const joinResult = await runFfmpeg(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', joined])
        if (!joinResult.success) { cleanup(); return { success: false, error: joinResult.error } }

        if (needsOverlayPass) {
          // Every layer is an input too, so they go on in batches, bottom of the stack first,
          // each batch over the last one's result. The letterbox goes under the first batch
          // (as in a single pass) and the titles and subtitles on top of the last.
          const batches: OverlayLayer[][] = []
          for (let i = 0; i < layers.length; i += LAYERS_PER_PASS) batches.push(layers.slice(i, i + LAYERS_PER_PASS))
          if (batches.length === 0) batches.push([])
          let source = joined
          for (const [bi, batch] of batches.entries()) {
            const isLast = bi === batches.length - 1
            const target = isLast ? tmpVideo : path.join(tmpDir, `ltx-export-overlay-${ts}-${bi}.mkv`)
            if (!isLast) passTmp.push(target)
            const g = buildVideoFilterGraph(segments, {
              ...graphOpts,
              stage: 'overlay', baseInput: source, layers: batch,
              letterbox: bi === 0 ? letterbox : undefined,
              textOverlays: isLast ? textOverlays : undefined,
              subtitles: isLast ? subtitles : undefined,
            })
            const r = await runGraph(g.inputs, g.filterScript, target, isLast ? finalEncode : pieceEncode, (t) => {
              const frac = totalDur > 0 ? t / totalDur : 0
              emitProgress(VIDEO_SHARE * (segmentShare + ((bi + frac) / batches.length) * (1 - segmentShare)), 'Adding titles and layers')
            }, true)
            if (!r.success) { cleanup(); return { success: false, error: r.error } }
            source = target
          }
        }
        for (const { file } of pieces) { try { fs.unlinkSync(file) } catch {} }
      }
    }

    emitProgress(VIDEO_SHARE, 'Mixing audio')
    logger.info( '[Export] Step 2: Audio mixdown (PCM buffer approach)')
    // A dissolve overlaps two clips, shrinking the program's real duration
    // below the naive sum of clip lengths (see buildDissolveTimeRemap) -
    // every clip's nominal startTime needs the same conversion applied to
    // video, or its audio drifts later relative to the picture with every
    // dissolve that came before it.
    const remapTime = buildDissolveTimeRemap(segments)
    const remappedClips = clips.map(c => ({ ...c, startTime: remapTime(c.startTime) }))

    let totalDuration = computeFinalVideoDuration(segments)
    for (const c of remappedClips) {
      totalDuration = Math.max(totalDuration, c.startTime + c.duration)
    }

    const tmpRawPcm = path.join(tmpDir, `ltx-pcm-${ts}.raw`)
    const { bytes: pcmBytes, sampleRate, channels: audioChannels } = await mixAudioToPcmFile(remappedClips, totalDuration, ffmpegPath, tmpRawPcm)
    logger.info( `[Export] Wrote raw PCM: ${pcmBytes} bytes (${totalDuration.toFixed(2)}s)`)

    {
      const r = await runFfmpeg(ffmpegPath, [
        '-y', '-f', 's16le', '-ar', String(sampleRate), '-ac', String(audioChannels),
        '-i', tmpRawPcm, '-c:a', 'pcm_s16le', tmpAudio,
      ])
      try { fs.unlinkSync(tmpRawPcm) } catch {}
      if (!r.success) { cleanup(); return { success: false, error: r.error } }
    }

    emitProgress(90, 'Finalizing')
    logger.info( '[Export] Step 3: Combining video + audio')
    let videoCodecArgs: string[]
    let audioCodecArgs: string[]
    if (codec === 'h264') {
      videoCodecArgs = ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(quality || 18), '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
      audioCodecArgs = ['-c:a', 'aac', '-b:a', '192k']
    } else if (codec === 'prores') {
      videoCodecArgs = ['-c:v', 'prores_ks', '-profile:v', String(quality || 3), '-pix_fmt', 'yuva444p10le']
      audioCodecArgs = ['-c:a', 'pcm_s16le']
    } else if (codec === 'vp9') {
      videoCodecArgs = ['-c:v', 'libvpx-vp9', '-b:v', `${quality || 8}M`, '-pix_fmt', 'yuv420p']
      audioCodecArgs = ['-c:a', 'libopus', '-b:a', '128k']
    } else {
      cleanup()
      return { success: false, error: `Unknown codec: ${codec}` }
    }

    const canCopyVideo = codec === 'h264'
    const r = await runFfmpeg(ffmpegPath, [
      '-y', '-i', tmpVideo, '-i', tmpAudio,
      '-map', '0:v', '-map', '1:a',
      ...(canCopyVideo ? ['-c:v', 'copy'] : videoCodecArgs),
      ...audioCodecArgs, '-shortest', outputPath
    ], (t) => {
      // Re-encoding codecs (ProRes/VP9) spend real time here; map it to the
      // last 10%. h264 stream-copies and finishes near-instantly.
      const frac = totalDur > 0 ? t / totalDur : 0
      emitProgress(90 + frac * 10, 'Finalizing')
    })

    cleanup()
    if (!r.success) return { success: false, error: r.error }
    emitProgress(100, 'Done')
    logger.info( `[Export] Done: ${outputPath}`)
    return { success: true }
  } catch (err) {
    cleanup()
    return { success: false, error: String(err) }
  }
}

export function registerExportHandlers(): void {
  handle('exportNative', (input) => exportTimelineNative(input))

  handle('exportCancel', () => {
    stopExportProcess()
    return { success: true }
  })
}

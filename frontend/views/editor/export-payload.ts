import { DEFAULT_SUBTITLE_STYLE } from '../../types/project-model'
import type { Asset, SubtitleClip, TimelineClip, Track } from '../../types/project-model'
import type { ElectronAPI } from '../../../shared/electron-api-schema'
import { selectClipPathFromAssets } from './editor-selectors'

type ExportNativeInput = Parameters<ElectronAPI['exportNative']>[0]

export type ExportTimelinePayload = Pick<ExportNativeInput, 'clips' | 'subtitles' | 'textOverlays' | 'letterbox'>

const LETTERBOX_RATIO_MAP: Record<string, number> = {
  '2.35:1': 2.35,
  '2.39:1': 2.39,
  '2.76:1': 2.76,
  '1.85:1': 1.85,
  '4:3': 4 / 3,
}

/** Everything about the active timeline that the native ffmpeg export needs, minus
 *  output settings. Shared by the Export modal and the RiX MCP server's renders. */
export function buildExportPayload(
  assets: Asset[],
  clips: TimelineClip[],
  tracks: Track[],
  subtitles: SubtitleClip[],
  { burnSubtitles = true }: { burnSubtitles?: boolean } = {},
): ExportTimelinePayload {
  const exportClips = clips
    .filter(clip => clip.type === 'video' || clip.type === 'image' || clip.type === 'audio')
    .filter(clip => tracks[clip.trackIndex]?.enabled !== false)
    .map(clip => ({
      path: selectClipPathFromAssets(assets, clip),
      type: clip.type,
      startTime: clip.startTime,
      duration: clip.duration,
      trimStart: clip.trimStart,
      speed: clip.speed || 1,
      reversed: clip.reversed || false,
      flipH: clip.flipH || false,
      flipV: clip.flipV || false,
      opacity: clip.opacity ?? 100,
      trackIndex: clip.trackIndex,
      muted: clip.muted || false,
      volume: clip.volume ?? 1,
      audioFadeIn: clip.audioFadeIn ?? 0,
      audioFadeOut: clip.audioFadeOut ?? 0,
      volumeKeyframes: clip.volumeKeyframes,
      opacityKeyframes: clip.opacityKeyframes,
      reframe: clip.reframe,
      layer: clip.layer,
      composite: clip.composite,
      motion: clip.motion,
      fadeIn: clip.fadeIn,
      fadeOut: clip.fadeOut,
      colorCorrection: clip.colorCorrection,
      filmLook: clip.filmLook,
      transitionIn: clip.transitionIn,
      transitionOut: clip.transitionOut,
    }))

  const subtitleData = subtitles.map(subtitle => {
    const track = tracks[subtitle.trackIndex]
    return {
      text: subtitle.text,
      startTime: subtitle.startTime,
      endTime: subtitle.endTime,
      style: {
        ...DEFAULT_SUBTITLE_STYLE,
        ...(track?.subtitleStyle || {}),
        ...(subtitle.style || {}),
      },
    }
  })

  // Text-overlay clips (type 'text' with a textStyle) are burned into the export
  // by ffmpeg drawtext — the live preview draws them as DOM, so without this they
  // showed in the editor but were missing from the rendered file.
  const textOverlayData = clips
    .filter(clip => clip.type === 'text' && Boolean(clip.textStyle) && tracks[clip.trackIndex]?.enabled !== false)
    .map(clip => {
      const ts = clip.textStyle!
      return {
        text: ts.text,
        startTime: clip.startTime,
        endTime: clip.startTime + clip.duration,
        fadeIn: clip.textFadeIn ?? 0.5,
        fadeOut: clip.textFadeOut ?? 0.5,
        opacityKeyframes: clip.opacityKeyframes,
        style: {
          fontSize: ts.fontSize,
          color: ts.color,
          backgroundColor: ts.backgroundColor,
          positionX: ts.positionX,
          positionY: ts.positionY,
          strokeColor: ts.strokeColor,
          strokeWidth: ts.strokeWidth,
          shadowColor: ts.shadowColor,
          shadowOffsetX: ts.shadowOffsetX,
          shadowOffsetY: ts.shadowOffsetY,
          opacity: ts.opacity,
          padding: ts.padding,
          textAlign: ts.textAlign,
          fontFamily: ts.fontFamily,
          fontWeight: ts.fontWeight,
          scaleX: ts.scaleX,
          scaleY: ts.scaleY,
        },
      }
    })

  const adjustmentClips = clips.filter(
    clip => clip.type === 'adjustment' && clip.letterbox?.enabled && tracks[clip.trackIndex]?.enabled !== false,
  )
  let letterbox: ExportTimelinePayload['letterbox']
  if (adjustmentClips.length > 0) {
    const best = adjustmentClips.reduce((currentBest, candidate) => (
      candidate.duration > currentBest.duration ? candidate : currentBest
    ))
    const config = best.letterbox!
    letterbox = {
      ratio: config.aspectRatio === 'custom'
        ? (config.customRatio || 2.35)
        : (LETTERBOX_RATIO_MAP[config.aspectRatio] || 2.35),
      color: config.color || '#000000',
      opacity: (config.opacity ?? 100) / 100,
    }
  }

  return {
    clips: exportClips,
    subtitles: burnSubtitles && subtitleData.length > 0 ? subtitleData : undefined,
    textOverlays: textOverlayData.length > 0 ? textOverlayData : undefined,
    letterbox,
  }
}

/**
 * Cut an export payload down to the program range [inPoint, outPoint) and shift
 * it to start at 0 — "export In→Out". Clips are trimmed where the range cuts
 * them; anything keyed to clip-local time (volume/opacity keys, image reframe
 * keys) is shifted by the head cut, and fades/transitions on a cut edge are
 * dropped (the cut isn't the clip's real start/end). Video reframe keys are on
 * source time, so a trimStart change keeps them aligned for free.
 */
export function sliceExportPayloadToRange(
  payload: ExportTimelinePayload,
  inPoint: number,
  outPoint: number,
): ExportTimelinePayload {
  const EPS = 1e-4
  // Keep every key (a key before the cut still shapes the ramp into the range);
  // interpolation holds the end values, so negative / past-the-end times are fine.
  const shiftKeys = <K extends { t: number }>(keys: K[] | undefined, by: number): K[] | undefined => {
    if (!keys || keys.length === 0 || by === 0) return keys
    return keys.map(k => ({ ...k, t: k.t - by }))
  }

  const clips = payload.clips.flatMap(c => {
    const end = c.startTime + c.duration
    const s = Math.max(c.startTime, inPoint)
    const e = Math.min(end, outPoint)
    if (e - s <= EPS) return []
    const headCut = s - c.startTime
    const tailCut = end - e
    const speed = c.speed || 1
    // Reversed clips play their source backwards: cutting the timeline's tail
    // removes the source's head, so it's the tail cut that advances trimStart.
    const trimStart = c.reversed ? c.trimStart + tailCut * speed : c.trimStart + headCut * speed
    const dur = e - s
    return [{
      ...c,
      startTime: s - inPoint,
      duration: dur,
      trimStart,
      audioFadeIn: headCut > EPS ? 0 : c.audioFadeIn,
      audioFadeOut: tailCut > EPS ? 0 : c.audioFadeOut,
      transitionIn: headCut > EPS ? undefined : c.transitionIn,
      transitionOut: tailCut > EPS ? undefined : c.transitionOut,
      volumeKeyframes: shiftKeys(c.volumeKeyframes, headCut),
      reframe: c.reframe && c.type === 'image' && c.reframe.keys
        ? { ...c.reframe, keys: shiftKeys(c.reframe.keys, headCut) }
        : c.reframe,
    }]
  })

  const textOverlays = payload.textOverlays?.flatMap(o => {
    const s = Math.max(o.startTime, inPoint)
    const e = Math.min(o.endTime, outPoint)
    if (e - s <= EPS) return []
    const headCut = s - o.startTime
    return [{
      ...o,
      startTime: s - inPoint,
      endTime: e - inPoint,
      fadeIn: headCut > EPS ? 0 : o.fadeIn,
      fadeOut: o.endTime - e > EPS ? 0 : o.fadeOut,
      opacityKeyframes: shiftKeys(o.opacityKeyframes, headCut),
    }]
  })

  const subtitles = payload.subtitles?.flatMap(sub => {
    const s = Math.max(sub.startTime, inPoint)
    const e = Math.min(sub.endTime, outPoint)
    return e - s <= EPS ? [] : [{ ...sub, startTime: s - inPoint, endTime: e - inPoint }]
  })

  return {
    ...payload,
    clips,
    textOverlays: textOverlays && textOverlays.length > 0 ? textOverlays : undefined,
    subtitles: subtitles && subtitles.length > 0 ? subtitles : undefined,
  }
}

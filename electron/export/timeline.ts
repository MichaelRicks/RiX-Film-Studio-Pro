import type { ClipFilmLook } from '../../shared/film-looks'
import { hasMotion, type ClipMotion } from '../../shared/clip-motion'

export interface ColorCorrection {
  brightness: number; contrast: number; saturation: number; temperature: number;
  tint: number; exposure: number; highlights: number; shadows: number;
}

export interface ClipTransition {
  type: string; duration: number;
}

export interface ExportClip {
  path: string; type: string; startTime: number; duration: number; trimStart: number;
  speed: number; reversed: boolean; flipH: boolean; flipV: boolean; opacity: number; trackIndex: number;
  muted: boolean; volume: number; audioFadeIn?: number; audioFadeOut?: number;
  volumeKeyframes?: { t: number; value: number }[];
  opacityKeyframes?: { t: number; value: number }[];
  reframe?: ClipReframe;
  layer?: ClipLayer; composite?: boolean; motion?: ClipMotion[];
  fadeIn?: number; fadeOut?: number;
  colorCorrection?: ColorCorrection; filmLook?: ClipFilmLook;
  transitionIn?: ClipTransition; transitionOut?: ClipTransition;
}

/** Where a media clip sits in the frame and how big it is, optionally keyframed.
 *  x/y are the layer's CENTER as a fraction of frame width/height; scaleX/scaleY
 *  multiply the size it fills the frame at. Mirrors ClipLayer in the renderer's
 *  project model, and clipLayerAt() there samples it the same way (smoothstep).
 *  Key `t` is clip-local seconds. */
export interface ClipLayer {
  x: number; y: number; scaleX: number; scaleY: number;
  keys?: Array<{ t: number; x: number; y: number; scaleX: number; scaleY: number }>;
}

/** One graphic drawn over the flattened program: a logo, a lower third, a PiP. */
export interface OverlayLayer {
  filePath: string; type: string;
  /** Program time. The caller remaps it for dissolves before building the graph. */
  startTime: number;
  duration: number; trimStart: number; speed: number;
  flipH: boolean; flipV: boolean;
  opacity: number;
  opacityKeyframes?: { t: number; value: number }[];
  /** Fade up/down in seconds. Undefined = DEFAULT_LAYER_FADE, 0 = a hard cut. */
  fadeIn?: number; fadeOut?: number;
  layer: ClipLayer;
  motion?: ClipMotion[];
  colorCorrection?: ColorCorrection; filmLook?: ClipFilmLook;
}

/** Mirrors DEFAULT_LAYER_FADE in video-editor-utils — a graphic that pops on and
 *  off reads as a glitch, so a layer fades at both ends unless told otherwise. */
export const DEFAULT_LAYER_FADE = 0.5

/** Mirrors defaultLayerFade in video-editor-utils: only images fade by default. */
export function defaultLayerFade(type: string | undefined): number {
  return type === 'image' ? DEFAULT_LAYER_FADE : 0
}

const DEFAULT_LAYER: ClipLayer = { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1 }

/**
 * Is this clip a layer — i.e. does it no longer simply fill the frame, so it has
 * to be drawn OVER the tracks below instead of replacing them? Mirrors
 * isLayerClip() in video-editor-utils, which decides the same thing for the
 * preview. Anything else keeps the NLE default of the highest track winning.
 */
export function isLayerExportClip(clip: ExportClip): boolean {
  if (clip.type !== 'video' && clip.type !== 'image') return false
  if (clip.composite) return true
  if (hasMotion(clip.motion)) return true
  if ((clip.opacity ?? 100) < 100) return true
  if (clip.opacityKeyframes && clip.opacityKeyframes.length > 0) return true
  const layer = clip.layer
  if (!layer) return false
  if (layer.keys && layer.keys.length > 0) return true
  return layer.x !== 0.5 || layer.y !== 0.5 || layer.scaleX !== 1 || layer.scaleY !== 1
}

/** A clip that is a layer only because of its motion — a full-frame shot, not a graphic. */
export function isMotionOnlyLayer(clip: ExportClip): boolean {
  return hasMotion(clip.motion) && !isLayerExportClip({ ...clip, motion: undefined })
}

function motionFade(clip: ExportClip, transition: ClipTransition | undefined): number | undefined {
  return isMotionOnlyLayer(clip) && transition?.type === 'fade-to-black' && transition.duration > 0
    ? transition.duration
    : undefined
}

/** The layer clips, bottom track first, so they stack the way the preview shows. */
export function collectOverlayLayers(clips: ExportClip[]): OverlayLayer[] {
  return clips
    .filter(isLayerExportClip)
    .sort((a, b) => (a.trackIndex - b.trackIndex) || (a.startTime - b.startTime))
    .map(clip => ({
      filePath: clip.path,
      type: clip.type,
      startTime: clip.startTime,
      duration: clip.duration,
      trimStart: clip.trimStart,
      speed: clip.speed || 1,
      flipH: clip.flipH || false,
      flipV: clip.flipV || false,
      opacity: clip.opacity ?? 100,
      opacityKeyframes: clip.opacityKeyframes,
      // The layer path can't cross-fade, but over its black base a fade to black is
      // just an alpha ramp, so keep that transition (the preview fades the same way).
      fadeIn: clip.fadeIn ?? motionFade(clip, clip.transitionIn),
      fadeOut: clip.fadeOut ?? motionFade(clip, clip.transitionOut),
      layer: clip.layer ?? DEFAULT_LAYER,
      motion: clip.motion,
      colorCorrection: clip.colorCorrection,
      filmLook: clip.filmLook,
    }))
}

/** 9:16 window position (0..1 along the free axis), optionally keyframed. */
export interface ClipReframe {
  pos: number
  keys?: { t: number; pos: number }[]
}

export interface FlatSegment {
  filePath: string; type: string; startTime: number; duration: number; trimStart: number;
  speed: number; reversed: boolean; flipH: boolean; flipV: boolean; opacity: number;
  muted: boolean; volume: number;
  reframe?: ClipReframe;
  /** Source pixel size — filled in by the exporter for 9:16 exports (title mapping). */
  srcWidth?: number; srcHeight?: number;
  /** A black 'gap' standing in for a motion clip, which is drawn over it as a layer:
   *  the clip's file, probed for its size by a vertical export. */
  placeholderPath?: string;
  colorCorrection?: ColorCorrection; filmLook?: ClipFilmLook;
  transitionIn?: ClipTransition; transitionOut?: ClipTransition;
  // Position of this segment within its ORIGINAL clip's own timeline (not the
  // overall program timeline) and that clip's total duration - needed so a
  // clip fragmented by a higher-track overlay still only applies its
  // transitionIn/Out at the true start/end of the original clip, not at
  // every fragment boundary.
  offsetInClip: number; clipDuration: number;
}

/**
 * Flatten a multi-track timeline into a sequence of segments for ffmpeg concat.
 * At each point in time, the highest trackIndex wins for video (NLE convention).
 */
export function flattenTimeline(clips: ExportClip[]): FlatSegment[] {
  // Only consider video/image clips for visual flattening, and not the layer ones:
  // those are composited on top afterwards (see collectOverlayLayers), so the clip
  // BELOW a layer has to keep the frame for that whole span rather than being
  // replaced by it.
  // The exception is a clip that is a layer ONLY because it has motion: it fills the
  // frame like any shot, so it still takes its place in the program (highest track
  // wins, the timeline keeps its length) — as black, with the moving picture drawn
  // over it as a layer.
  const videoClips = clips.filter(c => (c.type === 'video' || c.type === 'image') && (!isLayerExportClip(c) || isMotionOnlyLayer(c)))
  if (videoClips.length === 0) return []

  // Collect all time boundaries
  const boundaries = new Set<number>()
  boundaries.add(0)
  for (const c of videoClips) {
    boundaries.add(c.startTime)
    boundaries.add(c.startTime + c.duration)
  }
  const sorted = [...boundaries].sort((a, b) => a - b)

  const segments: FlatSegment[] = []

  for (let i = 0; i < sorted.length - 1; i++) {
    const t0 = sorted[i]
    const t1 = sorted[i + 1]
    const segDur = t1 - t0
    if (segDur < 0.001) continue

    const mid = (t0 + t1) / 2
    // Find highest-track clip at this time
    const active = videoClips
      .filter(c => mid >= c.startTime && mid < c.startTime + c.duration)
      .sort((a, b) => b.trackIndex - a.trackIndex)

    if (active.length > 0 && isMotionOnlyLayer(active[0])) {
      const c = active[0]
      // Black base for the layer pass. It keeps the clip's reframe and source path so a
      // vertical export can still find the 9:16 window the moving picture sits in.
      segments.push({
        filePath: '', type: 'gap', startTime: t0, duration: segDur, trimStart: 0,
        speed: 1, reversed: false, flipH: false, flipV: false, opacity: 100,
        muted: true, volume: 0,
        reframe: c.reframe, placeholderPath: c.path,
        offsetInClip: 0, clipDuration: 0,
      })
    } else if (active.length > 0) {
      const c = active[0]
      const offsetInClip = t0 - c.startTime
      segments.push({
        filePath: c.path,
        type: c.type,
        startTime: t0,
        duration: segDur,
        trimStart: c.trimStart + offsetInClip * c.speed,
        speed: c.speed,
        reversed: c.reversed,
        flipH: c.flipH,
        flipV: c.flipV,
        opacity: c.opacity,
        muted: c.muted,
        volume: c.volume,
        reframe: c.reframe,
        colorCorrection: c.colorCorrection,
        filmLook: c.filmLook,
        transitionIn: c.transitionIn,
        transitionOut: c.transitionOut,
        offsetInClip,
        clipDuration: c.duration,
      })
    } else {
      segments.push({
        filePath: '', type: 'gap', startTime: t0, duration: segDur, trimStart: 0,
        speed: 1, reversed: false, flipH: false, flipV: false, opacity: 100,
        muted: true, volume: 0,
        offsetInClip: 0, clipDuration: 0,
      })
    }
  }

  // Merge adjacent segments from the same file with contiguous trim
  const merged: FlatSegment[] = []
  for (const seg of segments) {
    const prev = merged[merged.length - 1]
    if (prev && prev.filePath === seg.filePath && prev.filePath !== '' &&
        prev.speed === seg.speed && prev.reversed === seg.reversed &&
        prev.flipH === seg.flipH && prev.flipV === seg.flipV &&
        prev.opacity === seg.opacity && prev.muted === seg.muted && prev.volume === seg.volume &&
        prev.reframe === seg.reframe &&
        Math.abs((prev.trimStart + prev.duration * prev.speed) - seg.trimStart) < 0.01) {
      prev.duration += seg.duration
    } else {
      merged.push({ ...seg })
    }
  }

  return merged
}

export interface DissolveBoundary {
  /** Dissolve sits between segments[index] and segments[index + 1]. */
  index: number
  duration: number
}

/**
 * Which adjacent segment pairs should cross-fade instead of cut. Mirrors the
 * editor's own preview logic (ProgramMonitor's getDissolveAtTime) exactly:
 * the duration comes ONLY from the outgoing clip's transitionOut - the
 * incoming clip's transitionIn.duration is never read, only its type is
 * checked as a gate. Guarded the same way fades/wipes are (offsetInClip
 * reaching the clip's true end / start) so a clip fragmented by a
 * higher-track overlay doesn't dissolve at every internal fragment boundary.
 */
export function findDissolveBoundaries(segments: FlatSegment[]): DissolveBoundary[] {
  const boundaries: DissolveBoundary[] = []
  for (let i = 0; i < segments.length - 1; i++) {
    const a = segments[i]
    const b = segments[i + 1]
    if (a.transitionOut?.type !== 'dissolve' || !(a.transitionOut.duration > 0)) continue
    if (b.transitionIn?.type !== 'dissolve') continue

    const aReachesClipEnd = Math.abs((a.offsetInClip + a.duration) - a.clipDuration) < 0.01
    const bIsClipStart = b.offsetInClip < 0.01
    if (!aReachesClipEnd || !bIsClipStart) continue

    const duration = Math.min(a.transitionOut.duration, a.duration, b.duration)
    if (duration > 0) boundaries.push({ index: i, duration })
  }
  return boundaries
}

/**
 * A dissolve overlaps the tail of one clip with the head of the next
 * (matching the editor's own preview - see ProgramMonitor's
 * getDissolveAtTime), shrinking the program's real presented duration below
 * the naive sum of clip durations. Every clip's *nominal* startTime (as
 * stored in the project) stays untouched by a dissolve, so anything that
 * schedules events by nominal time - audio mixing in particular - needs to
 * convert to the shrunk *actual* output time or it drifts out of sync with
 * the video after every dissolve. Returns that conversion as a function
 * rather than a lookup table since it needs to answer for arbitrary
 * timestamps (e.g. an audio clip's own startTime), not just segment
 * boundaries.
 */
export function buildDissolveTimeRemap(segments: FlatSegment[]): (nominalTime: number) => number {
  const boundaries = findDissolveBoundaries(segments)
  if (boundaries.length === 0) return (t) => t

  const shrinkPoints = boundaries
    .map(b => ({ atTime: segments[b.index + 1].startTime, amount: b.duration }))
    .sort((a, b) => a.atTime - b.atTime)

  return (nominalTime: number): number => {
    let shrink = 0
    for (const point of shrinkPoints) {
      if (point.atTime > nominalTime) break
      shrink += point.amount
    }
    return nominalTime - shrink
  }
}

/** The program's real presented duration after dissolve overlaps shrink it
 * below the naive sum of segment durations - the authoritative source for
 * this is buildVideoFilterGraph's own accumulation (it has to compute the
 * same running total to build correct xfade offsets), so this just mirrors
 * that logic for callers that need the number without building the graph. */
export function computeFinalVideoDuration(segments: FlatSegment[]): number {
  const boundaries = findDissolveBoundaries(segments)
  const shrinkAfter = new Map(boundaries.map(b => [b.index, b.duration]))
  let total = segments.length > 0 ? segments[0].duration : 0
  for (let i = 1; i < segments.length; i++) {
    const dissolveDuration = shrinkAfter.get(i - 1)
    total += segments[i].duration - (dissolveDuration ?? 0)
  }
  return total
}

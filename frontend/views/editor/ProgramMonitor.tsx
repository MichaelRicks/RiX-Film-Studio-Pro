import React from 'react'
import {
  Layers, Video, ChevronDown,
  ChevronLeft, ChevronRight, Pause, Play, Repeat,
  Expand, Shrink, XCircle, Frame,
} from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Tooltip } from '../../components/ui/tooltip'
import { AudioWaveform } from '../../components/AudioWaveform'
import { FilmLookDefs } from '../../components/FilmLookDefs'
import { pathToFileUrl } from '../../lib/file-url'
import { VerticalReframeOverlay } from './VerticalReframeOverlay'
import { VerticalFrameGuides } from '../../components/ReframeEditor'
import { TextOverlayBox } from './TextOverlayBox'
import { getOpacityPreview, useOpacityPreview } from './text-opacity-preview'
import { DEFAULT_SUBTITLE_STYLE } from '../../types/project-model'
import type { Asset, TimelineClip, Track, SubtitleClip } from '../../types/project-model'
import { getClipEffectStyles as clipEffectStylesFor, getTransitionBgColor, formatTime, getShortcutLabel, tooltipLabel, getMaskedEffectOverlays, textClipOpacity, isLayerClip } from './video-editor-utils'
import { MediaTransformBox } from './MediaTransformBox'
import { TitleSafeGuides } from './TitleSafeGuides'
import { getLayerPreview, setLayerPreview } from './layer-preview'
import type { KeyboardLayout } from '../../lib/keyboard-shortcuts'
import {
  selectActiveTimelineInPoint,
  selectActiveTimelineOutPoint,
  selectAssets,
  selectClips,
  selectCurrentTime,
  selectIsPlaying,
  selectPlayingInOut,
  selectSelectedClipIds,
  selectShowPropertiesPanel,
  selectSubtitles,
  selectTotalDuration,
  selectTracks,
} from './editor-selectors'
import { useEditorActions, useEditorStore } from './editor-store'
import { usePlaybackClips } from './reverse-proxy'
import { isDroppedMediaEvent, isNativeAssetDragEvent, readDroppedAsset, readDroppedMediaAsset } from './dropped-media-asset'

type MonitorRenderMode = 'playback' | 'scrub'
type SyncTarget = 'active' | 'incoming' | 'compositing'
type VideoContributorRole = 'primary' | 'dissolveIncoming' | 'compositing'

interface ActiveLetterboxState {
  ratio: number
  color: string
  opacity: number
  key: string
}

interface AdjustmentEffectState {
  clip: TimelineClip
  filterStyle: React.CSSProperties
  hasVignette: boolean
  vignetteAmount: number
  hasGrain: boolean
  grainAmount: number
}

interface DissolvePair {
  outgoing: TimelineClip
  incoming: TimelineClip
}

interface ActiveVideoContributor {
  clip: TimelineClip
  target: SyncTarget
  role: VideoContributorRole
  opacity: number
}

interface FrameOverlayState {
  activeClip: TimelineClip | null
  crossDissolve: DissolvePair | null
  layerStack: TimelineClip[]
  activeTextClips: TimelineClip[]
  activeSubtitles: SubtitleClip[]
  activeLetterbox: ActiveLetterboxState | null
  activeAdjustmentEffects: AdjustmentEffectState[]
  audioOnlyClips: TimelineClip[]
}

interface FrameRenderState extends FrameOverlayState {
  atTime: number
  crossDissolveProgress: number
  activeVideoContributors: ActiveVideoContributor[]
}

interface FrameRenderCache {
  mediaClips: TimelineClip[]
  videoClips: TimelineClip[]
  textClips: TimelineClip[]
  adjustmentClips: TimelineClip[]
  audioClips: TimelineClip[]
  subtitles: SubtitleClip[]
}

interface VideoContributorSyncState {
  lastAtTime: number | null
  pendingHardSync: boolean
}

const BASE_VIDEO_STYLE = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;z-index:0;pointer-events:none;'
const VIDEO_POOL_PREROLL_SECONDS = 1.5

function resolveClipPathFromAssets(assets: Asset[], clip: TimelineClip): string {
  const proxyPath = (clip as { proxyPath?: string }).proxyPath
  if (proxyPath) return proxyPath
  const liveAsset = clip.assetId
    ? assets.find(asset => asset.id === clip.assetId) || clip.asset
    : clip.asset
  if (!liveAsset) return ''
  if (liveAsset.takes && liveAsset.takes.length > 0 && clip.takeIndex !== undefined) {
    const idx = Math.max(0, Math.min(clip.takeIndex, liveAsset.takes.length - 1))
    return liveAsset.takes[idx].path || ''
  }
  return liveAsset.path || ''
}

function createMonitorVideoElement(src: string): HTMLVideoElement {
  const video = document.createElement('video')
  video.preload = 'auto'
  video.playsInline = true
  video.muted = true
  video.style.cssText = BASE_VIDEO_STYLE
  video.src = pathToFileUrl(src)
  video.load()
  return video
}

function applyPlaybackResolution(video: HTMLVideoElement, playbackResolution: 1 | 0.5 | 0.25) {
  if (playbackResolution < 1) {
    video.style.width = `${playbackResolution * 100}%`
    video.style.height = `${playbackResolution * 100}%`
    video.style.transform = `scale(${1 / playbackResolution})`
    video.style.transformOrigin = 'top left'
    return
  }

  video.style.width = '100%'
  video.style.height = '100%'
  video.style.transform = ''
  video.style.transformOrigin = ''
}

function buildFrameRenderCache(clips: TimelineClip[], subtitles: SubtitleClip[]): FrameRenderCache {
  return {
    mediaClips: clips.filter(clip => clip.type !== 'audio' && clip.type !== 'adjustment' && clip.type !== 'text'),
    videoClips: clips.filter(clip => clip.asset?.type === 'video' && clip.type !== 'audio' && clip.type !== 'adjustment' && clip.type !== 'text'),
    textClips: clips.filter(clip => clip.type === 'text' && Boolean(clip.textStyle)),
    adjustmentClips: clips.filter(clip => clip.type === 'adjustment'),
    audioClips: clips.filter(clip => clip.type === 'audio'),
    subtitles,
  }
}

function getClipTargetTime(clip: TimelineClip, mediaDuration: number, atTime: number): number {
  const timeInClip = atTime - clip.startTime
  const usableMediaDuration = mediaDuration - clip.trimStart - clip.trimEnd
  return clip.reversed
    ? Math.max(0, Math.min(mediaDuration, clip.trimStart + usableMediaDuration - timeInClip * clip.speed))
    : Math.max(0, Math.min(mediaDuration, clip.trimStart + timeInClip * clip.speed))
}

function getTopVisibleClipAtTime(mediaClips: TimelineClip[], tracks: Track[], time: number): TimelineClip | null {
  let best: { clip: TimelineClip; arrayIndex: number } | null = null

  for (let arrayIndex = 0; arrayIndex < mediaClips.length; arrayIndex += 1) {
    const clip = mediaClips[arrayIndex]
    // Layers are drawn OVER whatever owns the frame (see getLayerStack), never
    // instead of it — the same split the export makes between the flattened
    // program and the graphics composited on top.
    if (isLayerClip(clip)) continue
    if (tracks[clip.trackIndex]?.enabled === false) continue
    if (time < clip.startTime || time >= clip.startTime + clip.duration) continue
    if (!best) {
      best = { clip, arrayIndex }
      continue
    }
    if (clip.trackIndex > best.clip.trackIndex || (clip.trackIndex === best.clip.trackIndex && arrayIndex > best.arrayIndex)) {
      best = { clip, arrayIndex }
    }
  }

  return best?.clip ?? null
}

/** Among visible-track clips, the one ending last (by startTime + duration). */
function getLastEndingVisibleClip(mediaClips: TimelineClip[], tracks: Track[]): TimelineClip | null {
  let best: TimelineClip | null = null
  for (const clip of mediaClips) {
    if (isLayerClip(clip)) continue
    if (tracks[clip.trackIndex]?.enabled === false) continue
    if (!best || clip.startTime + clip.duration > best.startTime + best.duration) {
      best = clip
    }
  }
  return best
}

function getDissolveAtTime(mediaClips: TimelineClip[], tracks: Track[], time: number): { pair: DissolvePair; progress: number } | null {
  for (const clipA of mediaClips) {
    if (tracks[clipA.trackIndex]?.enabled === false) continue
    if (clipA.transitionOut?.type !== 'dissolve' || clipA.transitionOut.duration <= 0) continue
    const clipAEnd = clipA.startTime + clipA.duration
    const dissolveStart = clipAEnd - clipA.transitionOut.duration
    if (time < dissolveStart || time >= clipAEnd) continue
    const clipB = mediaClips.find(candidate =>
      candidate.id !== clipA.id &&
      tracks[candidate.trackIndex]?.enabled !== false &&
      candidate.trackIndex === clipA.trackIndex &&
      candidate.transitionIn?.type === 'dissolve' &&
      Math.abs(candidate.startTime - clipAEnd) < 0.05
    )
    if (!clipB) continue
    const progress = Math.max(0, Math.min(1, (time - dissolveStart) / clipA.transitionOut.duration))
    return { pair: { outgoing: clipA, incoming: clipB }, progress }
  }
  return null
}

function getActiveTextClips(textClips: TimelineClip[], tracks: Track[], time: number): TimelineClip[] {
  return textClips
    .filter(clip =>
      tracks[clip.trackIndex]?.enabled !== false &&
      time >= clip.startTime &&
      time < clip.startTime + clip.duration
    )
    .sort((a, b) => a.trackIndex - b.trackIndex)
}

function getActiveSubtitles(subtitles: SubtitleClip[], tracks: Track[], time: number): SubtitleClip[] {
  return subtitles.filter(subtitle => {
    const track = tracks[subtitle.trackIndex]
    return Boolean(track) && !track.muted && time >= subtitle.startTime && time < subtitle.endTime
  })
}

function getActiveLetterbox(adjustmentClips: TimelineClip[], tracks: Track[], time: number): ActiveLetterboxState | null {
  const ratioMap: Record<string, number> = {
    '2.35:1': 2.35,
    '2.39:1': 2.39,
    '2.76:1': 2.76,
    '1.85:1': 1.85,
    '4:3': 4 / 3,
  }

  const activeAdjustments = adjustmentClips
    .filter(clip =>
      tracks[clip.trackIndex]?.enabled !== false &&
      time >= clip.startTime &&
      time < clip.startTime + clip.duration
    )
    .sort((a, b) => b.trackIndex - a.trackIndex)

  for (const clip of activeAdjustments) {
    if (!clip.letterbox?.enabled) continue
    const ratio = clip.letterbox.aspectRatio === 'custom'
      ? (clip.letterbox.customRatio || 2.35)
      : (ratioMap[clip.letterbox.aspectRatio] || 2.35)
    return {
      ratio,
      color: clip.letterbox.color || '#000000',
      opacity: (clip.letterbox.opacity ?? 100) / 100,
      key: `${clip.id}:${ratio}:${clip.letterbox.color || '#000000'}:${clip.letterbox.opacity ?? 100}`,
    }
  }

  return null
}

/**
 * The graphics drawn over the frame at this time — clips that have been moved,
 * resized, faded or flagged to composite. Bottom track first, so they stack the
 * way the timeline reads.
 *
 * These are rendered as their own elements ABOVE the active clip rather than
 * replacing it. Keeping the clip underneath active is what stops playback
 * stuttering at a layer's edges: the primary video stays in the pooled element
 * the whole way through instead of being handed to a fresh <video> that has to
 * load and seek mid-playback.
 */
function getLayerStack(mediaClips: TimelineClip[], tracks: Track[], time: number): TimelineClip[] {
  return mediaClips
    .filter(clip =>
      isLayerClip(clip) &&
      tracks[clip.trackIndex]?.enabled !== false &&
      time >= clip.startTime &&
      time < clip.startTime + clip.duration
    )
    .sort((a, b) => a.trackIndex - b.trackIndex)
}

function getStyleOpacity(style: React.CSSProperties): number {
  if (typeof style.opacity === 'number') return style.opacity
  if (typeof style.opacity === 'string') {
    const parsed = Number(style.opacity)
    return Number.isFinite(parsed) ? parsed : 1
  }
  return 1
}

function toStyleValue(value: string | number | undefined): string {
  if (value === undefined) return ''
  return String(value)
}

/**
 * getClipEffectStyles, with an in-flight transform drag substituted in so the
 * media follows the handles live. The drag itself commits once, on release, so
 * the store (and undo) never sees the intermediate frames — hence reading it
 * from here rather than from the clip.
 */
function getClipEffectStyles(clip: TimelineClip, timeInClip?: number): React.CSSProperties {
  const layerDrag = getLayerPreview()
  const dialedOpacity = getOpacityPreview()
  let previewed = clip
  if (layerDrag && layerDrag.clipId === clip.id) {
    previewed = { ...previewed, layer: layerDrag.frame }
  }
  // An opacity dialed in on the properties panel but not yet committed as a key.
  // Text overlays read this themselves; a media layer is drawn by the monitor, so
  // it has to be substituted here or the slider looks dead until ◆ is pressed.
  if (dialedOpacity && dialedOpacity.clipId === clip.id && clip.type !== 'text') {
    previewed = { ...previewed, opacity: dialedOpacity.value, opacityKeyframes: undefined }
  }
  return previewed === clip ? clipEffectStylesFor(clip, timeInClip) : clipEffectStylesFor(previewed, timeInClip)
}

function clearEffectStyle(element: HTMLElement): void {
  element.style.filter = ''
  element.style.transform = ''
  element.style.clipPath = ''
  element.style.opacity = ''
}

/**
 * Park a layer element that has just left the frame. It stays mounted until
 * React's next render, and this pass runs inside the playback tick — so clearing
 * its style instead would paint it full-frame and fully opaque for that one frame,
 * which is a flash of the graphic as the playhead leaves it. Hiding it is enough;
 * the unmount takes it away, and applyEffectStyle un-hides it if it comes back.
 */
function hideEffectStyle(element: HTMLElement): void {
  element.style.opacity = '0'
}

function applyEffectStyle(
  element: HTMLElement,
  style: React.CSSProperties,
  opacityOverride?: number,
): void {
  element.style.filter = toStyleValue(style.filter as string | undefined)
  element.style.transform = toStyleValue(style.transform as string | undefined)
  element.style.clipPath = toStyleValue(style.clipPath as string | undefined)
  element.style.opacity = toStyleValue(
    opacityOverride !== undefined ? opacityOverride : (style.opacity as string | number | undefined),
  )
}

function getActiveVideoContributors(
  activeClip: TimelineClip | null,
  crossDissolve: DissolvePair | null,
  crossDissolveProgress: number,
  layerStack: TimelineClip[],
  time: number,
): ActiveVideoContributor[] {
  const contributors: ActiveVideoContributor[] = []
  const primaryClip = crossDissolve?.outgoing ?? activeClip

  if (primaryClip?.asset?.type === 'video') {
    const primaryOpacity = crossDissolve
      ? (1 - crossDissolveProgress) * ((crossDissolve.outgoing.opacity ?? 100) / 100)
      : getStyleOpacity(getClipEffectStyles(primaryClip, Math.max(0, time - primaryClip.startTime)))
    contributors.push({
      clip: primaryClip,
      target: 'active',
      role: 'primary',
      opacity: primaryOpacity,
    })
  }

  if (crossDissolve?.incoming.asset?.type === 'video') {
    contributors.push({
      clip: crossDissolve.incoming,
      target: 'incoming',
      role: 'dissolveIncoming',
      opacity: crossDissolveProgress * ((crossDissolve.incoming.opacity ?? 100) / 100),
    })
  }

  for (const clip of layerStack) {
    if (clip.asset?.type !== 'video') continue
    contributors.push({
      clip,
      target: 'compositing',
      role: 'compositing',
      opacity: getStyleOpacity(getClipEffectStyles(clip, Math.max(0, time - clip.startTime))),
    })
  }

  return contributors
}

function deriveFrameRenderState(cache: FrameRenderCache, tracks: Track[], time: number): FrameRenderState {
  let activeClip = getTopVisibleClipAtTime(cache.mediaClips, tracks, time)
  let effectiveTime = time

  // Playhead is past the end of every clip (not a gap mid-timeline) — hold
  // the last frame of whichever clip ends latest instead of going black.
  if (!activeClip) {
    const lastClip = getLastEndingVisibleClip(cache.mediaClips, tracks)
    if (lastClip && time >= lastClip.startTime + lastClip.duration) {
      activeClip = lastClip
      effectiveTime = lastClip.startTime + lastClip.duration - 1 / 240
    }
  }

  const dissolve = getDissolveAtTime(cache.mediaClips, tracks, effectiveTime)
  const layerStack = getLayerStack(cache.mediaClips, tracks, effectiveTime)

  return {
    atTime: effectiveTime,
    activeClip,
    crossDissolve: dissolve?.pair ?? null,
    crossDissolveProgress: dissolve?.progress ?? 0,
    layerStack,
    activeTextClips: getActiveTextClips(cache.textClips, tracks, time),
    activeSubtitles: getActiveSubtitles(cache.subtitles, tracks, time),
    activeLetterbox: getActiveLetterbox(cache.adjustmentClips, tracks, time),
    activeAdjustmentEffects: [],
    audioOnlyClips: cache.audioClips.filter(clip => time >= clip.startTime && time < clip.startTime + clip.duration),
    activeVideoContributors: getActiveVideoContributors(activeClip, dissolve?.pair ?? null, dissolve?.progress ?? 0, layerStack, effectiveTime),
  }
}

function sameClipList(a: TimelineClip[], b: TimelineClip[]): boolean {
  if (a.length !== b.length) return false
  return a.every((clip, index) => clip === b[index])
}

function sameSubtitleList(a: SubtitleClip[], b: SubtitleClip[]): boolean {
  if (a.length !== b.length) return false
  return a.every((subtitle, index) => subtitle === b[index])
}

function sameLetterbox(a: ActiveLetterboxState | null, b: ActiveLetterboxState | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.key === b.key
}

function sameDissolve(a: DissolvePair | null, b: DissolvePair | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.outgoing === b.outgoing && a.incoming === b.incoming
}

function sameFrameOverlayState(a: FrameOverlayState, b: FrameOverlayState): boolean {
  return (
    a.activeClip === b.activeClip &&
    sameDissolve(a.crossDissolve, b.crossDissolve) &&
    sameClipList(a.layerStack, b.layerStack) &&
    sameClipList(a.activeTextClips, b.activeTextClips) &&
    sameSubtitleList(a.activeSubtitles, b.activeSubtitles) &&
    sameLetterbox(a.activeLetterbox, b.activeLetterbox) &&
    sameClipList(a.audioOnlyClips, b.audioOnlyClips) &&
    a.activeAdjustmentEffects.length === b.activeAdjustmentEffects.length
  )
}

function sameVideoContributors(a: ActiveVideoContributor[], b: ActiveVideoContributor[]): boolean {
  if (a.length !== b.length) return false
  return a.every((contributor, index) => {
    const candidate = b[index]
    return (
      contributor.clip === candidate.clip &&
      contributor.target === candidate.target &&
      contributor.role === candidate.role &&
      contributor.opacity === candidate.opacity
    )
  })
}

function sameFrameRenderState(a: FrameRenderState, b: FrameRenderState): boolean {
  return (
    a.atTime === b.atTime &&
    a.crossDissolveProgress === b.crossDissolveProgress &&
    sameFrameOverlayState(a, b) &&
    sameVideoContributors(a.activeVideoContributors, b.activeVideoContributors)
  )
}

export interface ProgramMonitorProps {
  playbackTimeRef: React.MutableRefObject<number>
  setDraggingMarker: React.Dispatch<React.SetStateAction<'timelineIn' | 'timelineOut' | null>>
  kbLayout: KeyboardLayout
  currentProjectId?: string | null
}

export interface ProgramMonitorHandle {
  toggleFullscreen: () => void
}

export const ProgramMonitor = React.forwardRef<ProgramMonitorHandle, ProgramMonitorProps>(function ProgramMonitor({
  playbackTimeRef,
  setDraggingMarker,
  kbLayout,
  currentProjectId = null,
}: ProgramMonitorProps, ref) {
  const {
    addAssetToEditor,
    clearClipSelection,
    clearTimelineMarks,
    insertAssetsToTimeline,
    pause,
    play,
    selectClip,
    setClipLayerAt,
    setClipTextPosition,
    setCurrentTime,
    setShowPropertiesPanel,
    setTimelineInPoint,
    setTimelineOutPoint,
    stepCurrentTime,
    stopShuttle,
    togglePlayInOut,
    updateClip,
  } = useEditorActions()
  const currentTime = useEditorStore(selectCurrentTime)
  const totalDuration = useEditorStore(selectTotalDuration)
  const isPlaying = useEditorStore(selectIsPlaying)
  const assets = useEditorStore(selectAssets)
  const timelineClips = useEditorStore(selectClips)
  // Reversed clips play from a cached reversed copy once it is ready (reverse-proxy.ts).
  const clips = usePlaybackClips(timelineClips, assets)
  const tracks = useEditorStore(selectTracks)
  const subtitles = useEditorStore(selectSubtitles)
  const getClipPath = React.useCallback((clip: TimelineClip) => resolveClipPathFromAssets(assets, clip), [assets])
  const selectedClipIds = useEditorStore(selectSelectedClipIds)
  // One def per distinct look+intensity on the timeline — <FilmLookDefs> dedupes,
  // this just keeps the array identity stable between unrelated state changes.
  const filmLooksInUse = React.useMemo(
    () => clips.flatMap((c) => (c.filmLook ? [c.filmLook] : [])),
    [clips],
  )
  // Re-paint when the properties panel's uncommitted opacity changes, so a media
  // layer tracks the slider the way a title does.
  const dialedOpacity = useOpacityPreview()
  const showPropertiesPanel = useEditorStore(selectShowPropertiesPanel)
  const inPoint = useEditorStore(selectActiveTimelineInPoint)
  const outPoint = useEditorStore(selectActiveTimelineOutPoint)
  const playingInOut = useEditorStore(selectPlayingInOut)

  // Stops the video frame wrapper's onClick from clearing the selection when the
  // click belongs to something drawn on top of it — a text overlay or the media
  // transform box. Mousedown lands on the widget, but the click is delivered to
  // their common ancestor, so any drag that strays outside it reaches the wrapper.
  const suppressFrameClickRef = React.useRef(false)
  const previewContainerRef = React.useRef<HTMLDivElement>(null)
  const videoPoolContainerRef = React.useRef<HTMLDivElement>(null)
  const incomingDissolveVideoRef = React.useRef<HTMLVideoElement | null>(null)
  const incomingDissolveImageRef = React.useRef<HTMLImageElement | null>(null)
  const activeImageRef = React.useRef<HTMLImageElement | null>(null)
  const transitionBgRef = React.useRef<HTMLDivElement | null>(null)
  const videoPoolRef = React.useRef<Map<string, HTMLVideoElement>>(new Map())
  const layerMediaRefs = React.useRef<Map<string, HTMLVideoElement | HTMLImageElement>>(new Map())
  const activePoolPathRef = React.useRef('')
  const activePoolClipIdRef = React.useRef<string | null>(null)
  const contributorSyncStatesRef = React.useRef<Map<string, VideoContributorSyncState>>(new Map())
  const preSeekDoneRef = React.useRef<string | null>(null)
  const clipsRef = React.useRef(clips)
  const tracksRef = React.useRef(tracks)
  const getClipPathRef = React.useRef(getClipPath)
  const [previewZoom, setPreviewZoom] = React.useState<number | 'fit'>('fit')
  const [previewZoomOpen, setPreviewZoomOpen] = React.useState(false)
  const [previewPan, setPreviewPan] = React.useState({ x: 0, y: 0 })
  const previewPanRef = React.useRef({ dragging: false, startX: 0, startY: 0, startPanX: 0, startPanY: 0 })
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const [playbackResOpen, setPlaybackResOpen] = React.useState(false)
  const [playbackResolution, setPlaybackResolution] = React.useState<1 | 0.5 | 0.25>(0.5)
  // "Protect for 9:16" guide: a centered vertical frame (sides dimmed) with
  // optional thirds grid + social-app UI zones, plus an independent thirds grid
  // over the full frame. Persisted per machine.
  const [verticalGuide, setVerticalGuide] = React.useState<{ frame: boolean; grid: boolean; safe: boolean; fullGrid: boolean; titleSafe: boolean }>(() => {
    const defaults = { frame: false, grid: true, safe: false, fullGrid: false, titleSafe: false }
    try {
      const raw = localStorage.getItem('editor.verticalGuide')
      if (raw) return { ...defaults, ...JSON.parse(raw) }
    } catch { /* storage unavailable */ }
    return defaults
  })
  const [verticalGuideOpen, setVerticalGuideOpen] = React.useState(false)
  React.useEffect(() => {
    try { localStorage.setItem('editor.verticalGuide', JSON.stringify(verticalGuide)) } catch { /* storage unavailable */ }
  }, [verticalGuide])
  const [videoFrameSize, setVideoFrameSize] = React.useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const frameRenderCache = React.useMemo(() => buildFrameRenderCache(clips, subtitles), [clips, subtitles])
  const frameRenderCacheRef = React.useRef(frameRenderCache)
  const [frameScene, setFrameScene] = React.useState<FrameOverlayState>(() => {
    const initial = deriveFrameRenderState(frameRenderCache, tracks, currentTime)
    return {
      activeClip: initial.activeClip,
      crossDissolve: initial.crossDissolve,
      layerStack: initial.layerStack,
      activeTextClips: initial.activeTextClips,
      activeSubtitles: initial.activeSubtitles,
      activeLetterbox: initial.activeLetterbox,
      activeAdjustmentEffects: initial.activeAdjustmentEffects,
      audioOnlyClips: initial.audioOnlyClips,
    }
  })
  const frameSceneRef = React.useRef(frameScene)
  // Live DOM handles for active text overlays, so playback can ride their
  // fade-in/out opacity each frame without re-rendering React.
  const textOverlayElsRef = React.useRef<Map<string, HTMLDivElement>>(new Map())
  const lastFrameRequestRef = React.useRef<{ state: FrameRenderState; mode: MonitorRenderMode } | null>(null)
  const playbackTimecodeRef = React.useRef<HTMLSpanElement | null>(null)

  const toggleFullscreen = React.useCallback(() => {
    const el = previewContainerRef.current
    if (!el) return
    if (document.fullscreenElement === el) {
      document.exitFullscreen().catch(() => {})
      return
    }
    el.requestFullscreen().catch(() => {})
  }, [])

  React.useImperativeHandle(ref, () => ({ toggleFullscreen }), [toggleFullscreen])

  React.useEffect(() => {
    clipsRef.current = clips
  }, [clips])

  React.useEffect(() => {
    tracksRef.current = tracks
  }, [tracks])

  React.useEffect(() => {
    getClipPathRef.current = getClipPath
  }, [getClipPath])

  React.useEffect(() => {
    frameRenderCacheRef.current = frameRenderCache
  }, [frameRenderCache])

  const resolveClipPathRef = React.useCallback((clip: TimelineClip): string => {
    const resolved = getClipPathRef.current(clip)
    return resolved || clip.asset?.path || ''
  }, [])

  const getNextVideoClipRef = React.useCallback((afterClip: TimelineClip): TimelineClip | null => {
    const all = clipsRef.current
    const endTime = afterClip.startTime + afterClip.duration
    let best: TimelineClip | null = null
    for (const clip of all) {
      if (clip.type === 'audio' || clip.type === 'adjustment' || clip.type === 'text') continue
      if (clip.asset?.type !== 'video') continue
      if (clip.startTime >= endTime - 0.01) {
        if (!best || clip.startTime < best.startTime) best = clip
      }
    }
    return best
  }, [])

  const syncFrameScene = React.useCallback((nextState: FrameRenderState) => {
    setFrameScene(prevState => {
      const nextOverlayState: FrameOverlayState = {
        activeClip: nextState.activeClip,
        crossDissolve: nextState.crossDissolve,
        layerStack: nextState.layerStack,
        activeTextClips: nextState.activeTextClips,
        activeSubtitles: nextState.activeSubtitles,
        activeLetterbox: nextState.activeLetterbox,
        activeAdjustmentEffects: nextState.activeAdjustmentEffects,
        audioOnlyClips: nextState.audioOnlyClips,
      }
      if (sameFrameOverlayState(prevState, nextOverlayState)) {
        frameSceneRef.current = prevState
        return prevState
      }
      frameSceneRef.current = nextOverlayState
      return nextOverlayState
    })
  }, [])

  const syncPlaybackTimecode = React.useCallback((time: number) => {
    const el = playbackTimecodeRef.current
    if (!el) return
    const nextText = formatTime(time)
    if (el.textContent !== nextText) {
      el.textContent = nextText
    }
  }, [])

  const ensurePoolVideo = React.useCallback((filePath: string) => {
    let video = videoPoolRef.current.get(filePath)
    if (video) return video

    video = createMonitorVideoElement(filePath)
    applyPlaybackResolution(video, playbackResolution)
    videoPoolRef.current.set(filePath, video)
    if (videoPoolContainerRef.current) videoPoolContainerRef.current.appendChild(video)
    return video
  }, [playbackResolution])

  const destroyPoolVideo = React.useCallback((filePath: string) => {
    const video = videoPoolRef.current.get(filePath)
    if (!video) return

    video.pause()
    video.removeAttribute('src')
    video.load()
    if (video.parentElement) video.parentElement.removeChild(video)
    if (activePoolPathRef.current === filePath) activePoolPathRef.current = ''
    videoPoolRef.current.delete(filePath)
  }, [])

  const syncVideoElement = React.useCallback((
    video: HTMLVideoElement,
    clip: TimelineClip,
    atTime: number,
    options: { forceSeek?: boolean; paused?: boolean },
  ) => {
    const { forceSeek = false, paused = false } = options
    video.muted = true
    video.volume = 0

    if (!video.duration || Number.isNaN(video.duration)) {
      if (forceSeek) {
        video.play().then(() => { video.pause() }).catch(() => {})
      }
      return
    }

    const targetTime = getClipTargetTime(clip, video.duration, atTime)
    const shouldPause = paused || clip.reversed
    const driftThreshold = shouldPause ? 0.04 : 0.3

    video.playbackRate = clip.reversed ? 1 : clip.speed
    if (!Number.isNaN(targetTime) && (forceSeek || Math.abs(video.currentTime - targetTime) > driftThreshold)) {
      if (!shouldPause && typeof (video as { fastSeek?: (time: number) => void }).fastSeek === 'function' && !forceSeek) {
        ;(video as { fastSeek: (time: number) => void }).fastSeek(targetTime)
      } else {
        if (forceSeek && Math.abs(video.currentTime - targetTime) < 0.001) {
          video.currentTime = targetTime + 0.001
        }
        video.currentTime = targetTime
      }
    }

    if (shouldPause) {
      if (!video.paused) {
        video.pause()
      }
    } else if (video.paused) {
      video.play().catch(() => {})
    }
  }, [])

  const getContributorKey = React.useCallback((contributor: ActiveVideoContributor) => {
    return `${contributor.target}:${contributor.clip.id}`
  }, [])

  const ensureContributorSyncState = React.useCallback((contributor: ActiveVideoContributor) => {
    const key = `${contributor.target}:${contributor.clip.id}`
    let syncState = contributorSyncStatesRef.current.get(key)
    if (!syncState) {
      syncState = { lastAtTime: null, pendingHardSync: false }
      contributorSyncStatesRef.current.set(key, syncState)
    }
    return syncState
  }, [])

  const syncPlaybackContributorVideo = React.useCallback((
    video: HTMLVideoElement,
    fallbackContributor: ActiveVideoContributor,
    fallbackAtTime: number,
    fallbackMode: MonitorRenderMode,
  ) => {
    const lastFrame = lastFrameRequestRef.current
    const latestState = lastFrame?.state
    const latestMode = lastFrame?.mode ?? fallbackMode
    const latestContributor = latestState?.activeVideoContributors.find(contributor =>
      contributor.target === fallbackContributor.target && contributor.clip.id === fallbackContributor.clip.id
    ) ?? fallbackContributor
    if (latestContributor.clip.asset?.type !== 'video') return
    if (latestContributor.target === 'active' && resolveClipPathRef(latestContributor.clip) !== activePoolPathRef.current) return

    const syncState = ensureContributorSyncState(latestContributor)
    const atTime = latestMode === 'playback'
      ? playbackTimeRef.current
      : latestState?.atTime ?? fallbackAtTime

    syncVideoElement(video, latestContributor.clip, atTime, {
      forceSeek: syncState.pendingHardSync,
      paused: latestMode !== 'playback' || latestContributor.clip.reversed,
    })

    if (syncState.pendingHardSync) {
      syncState.pendingHardSync = false
    }
    syncState.lastAtTime = atTime
  }, [ensureContributorSyncState, playbackTimeRef, resolveClipPathRef, syncVideoElement])

  const syncRetainedPoolVideos = React.useCallback((state: FrameRenderState, mode: MonitorRenderMode) => {
    const desiredSources = new Set<string>()

    for (const contributor of state.activeVideoContributors) {
      if (contributor.clip.asset?.type !== 'video') continue
      const src = resolveClipPathRef(contributor.clip)
      if (src) desiredSources.add(src)
    }

    const activeVideoContributor = state.activeVideoContributors.find(contributor => contributor.target === 'active') ?? null
    if (mode === 'playback' && activeVideoContributor) {
      const nextClip = getNextVideoClipRef(activeVideoContributor.clip)
      if (nextClip) {
        const remainingInCurrent = (activeVideoContributor.clip.startTime + activeVideoContributor.clip.duration) - state.atTime
        if (remainingInCurrent < VIDEO_POOL_PREROLL_SECONDS && remainingInCurrent > 0) {
          const nextSrc = resolveClipPathRef(nextClip)
          if (nextSrc) desiredSources.add(nextSrc)
        }
      }
    }

    for (const poolPath of Array.from(videoPoolRef.current.keys())) {
      if (!desiredSources.has(poolPath)) destroyPoolVideo(poolPath)
    }

    for (const src of desiredSources) {
      ensurePoolVideo(src)
    }
  }, [destroyPoolVideo, ensurePoolVideo, getNextVideoClipRef, resolveClipPathRef])

  const applyFrameVisuals = React.useCallback((state: FrameRenderState, mode: MonitorRenderMode) => {
    syncRetainedPoolVideos(state, mode)

    const { activeClip, crossDissolve, crossDissolveProgress, layerStack, atTime, activeVideoContributors } = state
    const pool = videoPoolRef.current
    const poolContainer = videoPoolContainerRef.current
    const contributorsByKey = new Map(activeVideoContributors.map(contributor => [getContributorKey(contributor), contributor]))
    const activeVideoContributor = activeVideoContributors.find(contributor => contributor.target === 'active') ?? null
    const incomingVideoContributor = activeVideoContributors.find(contributor => contributor.target === 'incoming') ?? null
    const layerVideoContributors = new Map(
      activeVideoContributors
        .filter(contributor => contributor.target === 'compositing')
        .map(contributor => [contributor.clip.id, contributor]),
    )

    for (const key of contributorSyncStatesRef.current.keys()) {
      if (!contributorsByKey.has(key)) contributorSyncStatesRef.current.delete(key)
    }

    if (poolContainer) {
      const shouldShowPool = activeClip?.asset?.type === 'video' || Boolean(crossDissolve?.outgoing.asset?.type === 'video')
      poolContainer.classList.toggle('hidden', !shouldShowPool)
    }

    const outgoingClip = crossDissolve?.outgoing ?? activeClip
    if (activeVideoContributor) {
      const clipPath = resolveClipPathRef(activeVideoContributor.clip)
      if (clipPath) {
        const video = ensurePoolVideo(clipPath)
        const contributorSyncState = ensureContributorSyncState(activeVideoContributor)
        const isNewClip = activePoolClipIdRef.current !== activeVideoContributor.clip.id
        const previousPoolPath = activePoolPathRef.current
        const hasPlaybackJump = mode === 'playback' &&
          contributorSyncState.lastAtTime !== null &&
          Math.abs(atTime - contributorSyncState.lastAtTime) > 0.5
        const shouldForceSyncActive = mode === 'scrub' || isNewClip || hasPlaybackJump
        if (poolContainer && !video.parentElement) poolContainer.appendChild(video)

        for (const [poolPath, pooledVideo] of pool) {
          if (poolPath === clipPath) continue
          pooledVideo.style.opacity = '0'
          pooledVideo.style.zIndex = '0'
        }

        if (clipPath !== previousPoolPath) {
          const oldVid = pool.get(previousPoolPath)
          if (oldVid) {
            oldVid.style.opacity = '0'
            oldVid.style.zIndex = '0'
            oldVid.pause()
          }
          activePoolPathRef.current = clipPath
          preSeekDoneRef.current = null
        }
        if (isNewClip) {
          activePoolClipIdRef.current = activeVideoContributor.clip.id
          preSeekDoneRef.current = null
        }
        video.style.opacity = '1'
        video.style.zIndex = '1'
        if (shouldForceSyncActive) {
          contributorSyncState.pendingHardSync = true
        }
        if (video.readyState >= 2) {
          syncPlaybackContributorVideo(video, activeVideoContributor, atTime, mode)
        } else if (!(video as { __pendingCanplay?: boolean }).__pendingCanplay) {
          ;(video as { __pendingCanplay?: boolean }).__pendingCanplay = true
          const onReady = () => {
            video.removeEventListener('canplay', onReady)
            ;(video as { __pendingCanplay?: boolean }).__pendingCanplay = false
            syncPlaybackContributorVideo(video, activeVideoContributor, atTime, mode)
          }
          video.addEventListener('canplay', onReady)
        }

        if (!crossDissolve && mode === 'playback') {
          const nextClip = getNextVideoClipRef(activeVideoContributor.clip)
          if (nextClip && nextClip.id !== preSeekDoneRef.current) {
            const remainingInCurrent = (activeVideoContributor.clip.startTime + activeVideoContributor.clip.duration) - atTime
            if (remainingInCurrent < VIDEO_POOL_PREROLL_SECONDS && remainingInCurrent > 0) {
              const nextSrc = resolveClipPathRef(nextClip)
              const nextVideo = nextSrc ? ensurePoolVideo(nextSrc) : null
              if (nextVideo && nextVideo.readyState >= 1) {
                const nextTargetTime = nextClip.reversed
                  ? nextClip.trimStart + (nextVideo.duration || 0) - nextClip.trimStart - nextClip.trimEnd
                  : nextClip.trimStart
                if (!Number.isNaN(nextTargetTime)) {
                  if (typeof (nextVideo as { fastSeek?: (time: number) => void }).fastSeek === 'function') {
                    ;(nextVideo as { fastSeek: (time: number) => void }).fastSeek(nextTargetTime)
                  } else {
                    nextVideo.currentTime = nextTargetTime
                  }
                }
                preSeekDoneRef.current = nextClip.id
              }
            }
          }
        }
      }
    } else {
      const curVid = pool.get(activePoolPathRef.current)
      if (curVid) {
        curVid.style.opacity = '0'
        curVid.style.zIndex = '0'
        if (!curVid.paused) {
          curVid.pause()
        }
      }
      activePoolClipIdRef.current = null
    }

    if (poolContainer) {
      if (outgoingClip?.asset?.type === 'video') {
        const baseStyle = getClipEffectStyles(outgoingClip, Math.max(0, atTime - outgoingClip.startTime))
        const outgoingOpacity = crossDissolve
          ? (1 - crossDissolveProgress) * ((crossDissolve.outgoing.opacity ?? 100) / 100)
          : baseStyle.opacity
        applyEffectStyle(poolContainer, baseStyle, typeof outgoingOpacity === 'number' ? outgoingOpacity : undefined)
      } else {
        clearEffectStyle(poolContainer)
        poolContainer.style.opacity = '0'
      }
    }

    if (activeImageRef.current && activeClip?.asset?.type === 'image') {
      const baseStyle = getClipEffectStyles(activeClip, Math.max(0, atTime - activeClip.startTime))
      const opacity = crossDissolve
        ? (1 - crossDissolveProgress) * ((crossDissolve.outgoing.opacity ?? 100) / 100)
        : baseStyle.opacity
      applyEffectStyle(activeImageRef.current, baseStyle, typeof opacity === 'number' ? opacity : undefined)
    } else if (activeImageRef.current) {
      clearEffectStyle(activeImageRef.current)
    }

    if (transitionBgRef.current) {
      if (activeClip) {
        const tInBg = activeClip.transitionIn?.type !== 'none' ? getTransitionBgColor(activeClip.transitionIn.type) : null
        const tOutBg = activeClip.transitionOut?.type !== 'none' ? getTransitionBgColor(activeClip.transitionOut.type) : null
        const bg = tInBg || tOutBg
        if (bg) {
          const effectStyles = getClipEffectStyles(activeClip, Math.max(0, atTime - activeClip.startTime))
          const overlayOpacity = effectStyles.opacity !== undefined ? 1 - (effectStyles.opacity as number) : 0
          transitionBgRef.current.style.backgroundColor = bg
          transitionBgRef.current.style.opacity = overlayOpacity > 0 ? String(overlayOpacity) : '0'
          transitionBgRef.current.style.display = overlayOpacity > 0 ? 'block' : 'none'
        } else {
          transitionBgRef.current.style.display = 'none'
        }
      } else {
        transitionBgRef.current.style.display = 'none'
      }
    }

    if (crossDissolve) {
      const incomingOffset = Math.max(0, atTime - crossDissolve.incoming.startTime)
      const baseIncomingStyle = getClipEffectStyles(crossDissolve.incoming, incomingOffset)
      const incomingOpacity = String(crossDissolveProgress * ((crossDissolve.incoming.opacity ?? 100) / 100))
      const inStyle = {
        ...baseIncomingStyle,
        opacity: incomingOpacity,
      }

      if (incomingVideoContributor && incomingDissolveVideoRef.current) {
        const incomingPath = resolveClipPathRef(incomingVideoContributor.clip)
        const video = incomingDissolveVideoRef.current
        const contributorSyncState = ensureContributorSyncState(incomingVideoContributor)
        const hasPlaybackJump = mode === 'playback' &&
          contributorSyncState.lastAtTime !== null &&
          Math.abs(atTime - contributorSyncState.lastAtTime) > 0.5
        const shouldForceSyncIncoming = mode === 'scrub' || contributorSyncState.lastAtTime === null || hasPlaybackJump
        const incomingFileUrl = incomingPath ? pathToFileUrl(incomingPath) : ''
        if (incomingFileUrl && video.src !== incomingFileUrl && !video.src.endsWith(incomingFileUrl)) {
          video.src = incomingFileUrl
          video.load()
        }
        applyEffectStyle(video, inStyle)
        if (shouldForceSyncIncoming) {
          contributorSyncState.pendingHardSync = true
        }
        if (video.readyState >= 2) {
          syncVideoElement(video, incomingVideoContributor.clip, atTime, {
            forceSeek: contributorSyncState.pendingHardSync,
            paused: true,
          })
          if (contributorSyncState.pendingHardSync) {
            contributorSyncState.pendingHardSync = false
          }
          contributorSyncState.lastAtTime = atTime
        } else if (!(video as { __pendingLoadedData?: boolean }).__pendingLoadedData) {
          ;(video as { __pendingLoadedData?: boolean }).__pendingLoadedData = true
          const onLoaded = () => {
            video.removeEventListener('loadeddata', onLoaded)
            ;(video as { __pendingLoadedData?: boolean }).__pendingLoadedData = false
            syncVideoElement(video, incomingVideoContributor.clip, atTime, {
              forceSeek: contributorSyncState.pendingHardSync,
              paused: true,
            })
            if (contributorSyncState.pendingHardSync) {
              contributorSyncState.pendingHardSync = false
            }
            contributorSyncState.lastAtTime = atTime
          }
          video.addEventListener('loadeddata', onLoaded)
        }
      }

      if (crossDissolve.incoming.asset?.type === 'image' && incomingDissolveImageRef.current) {
        applyEffectStyle(incomingDissolveImageRef.current, inStyle)
      }

      if (crossDissolve.incoming.asset?.type === 'video') {
        const inPath = resolveClipPathRef(crossDissolve.incoming)
        if (inPath) ensurePoolVideo(inPath)
      }
    } else {
      if (incomingDissolveVideoRef.current) clearEffectStyle(incomingDissolveVideoRef.current)
      if (incomingDissolveImageRef.current) clearEffectStyle(incomingDissolveImageRef.current)
    }

    const layerIds = new Set(layerStack.map(clip => clip.id))
    for (const [clipId, element] of layerMediaRefs.current.entries()) {
      if (!layerIds.has(clipId)) {
        hideEffectStyle(element)
      }
    }

    for (const clip of layerStack) {
      const element = layerMediaRefs.current.get(clip.id)
      if (!element) continue
      const clipStyle = getClipEffectStyles(clip, Math.max(0, atTime - clip.startTime))
      applyEffectStyle(element, clipStyle)
      if (element instanceof HTMLVideoElement) {
        const contributor = layerVideoContributors.get(clip.id)
        if (!contributor) {
          if (!element.paused) {
            element.pause()
          }
          continue
        }
        const contributorSyncState = ensureContributorSyncState(contributor)
        const hasPlaybackJump = mode === 'playback' &&
          contributorSyncState.lastAtTime !== null &&
          Math.abs(atTime - contributorSyncState.lastAtTime) > 0.5
        const shouldForceSyncCompositing = mode === 'scrub' || contributorSyncState.lastAtTime === null || hasPlaybackJump
        if (shouldForceSyncCompositing) {
          contributorSyncState.pendingHardSync = true
        }
        if (element.readyState >= 2) {
          syncPlaybackContributorVideo(element, contributor, atTime, mode)
        } else if (!(element as { __pendingLoadedData?: boolean }).__pendingLoadedData) {
          ;(element as { __pendingLoadedData?: boolean }).__pendingLoadedData = true
          const onLoaded = () => {
            element.removeEventListener('loadeddata', onLoaded)
            ;(element as { __pendingLoadedData?: boolean }).__pendingLoadedData = false
            syncPlaybackContributorVideo(element, contributor, atTime, mode)
          }
          element.addEventListener('loadeddata', onLoaded)
        }
      }
    }

    if (activeClip?.asset?.type === 'video') {
      const poolVideo = activePoolPathRef.current ? videoPoolRef.current.get(activePoolPathRef.current) ?? null : null
      if (poolVideo) {
        const overlays = getMaskedEffectOverlays(activeClip)
        for (const overlay of overlays) {
          const maskVideo = document.getElementById(`mask-video-${overlay.effectId}`) as HTMLVideoElement | null
          if (maskVideo && Math.abs(maskVideo.currentTime - poolVideo.currentTime) > 0.04) {
            maskVideo.currentTime = poolVideo.currentTime
          }
        }
      }
    }
  }, [ensureContributorSyncState, ensurePoolVideo, getContributorKey, getNextVideoClipRef, resolveClipPathRef, syncPlaybackContributorVideo, syncRetainedPoolVideos])

  const renderFrame = React.useCallback((atTime: number, mode: MonitorRenderMode) => {
    const nextState = deriveFrameRenderState(frameRenderCacheRef.current, tracksRef.current, atTime)
    const lastFrame = lastFrameRequestRef.current

    if (lastFrame && lastFrame.mode === mode && sameFrameRenderState(lastFrame.state, nextState)) {
      syncPlaybackTimecode(atTime)
      return
    }

    lastFrameRequestRef.current = { state: nextState, mode }
    syncPlaybackTimecode(atTime)
    syncFrameScene(nextState)
    applyFrameVisuals(nextState, mode)
  }, [applyFrameVisuals, syncFrameScene, syncPlaybackTimecode])

  /** Re-apply element styles for the frame already on screen. A transform drag
   *  changes no frame state, so renderFrame() would early-out on it. */
  const repaintFrameVisuals = React.useCallback(() => {
    const lastFrame = lastFrameRequestRef.current
    if (lastFrame) applyFrameVisuals(lastFrame.state, lastFrame.mode)
  }, [applyFrameVisuals])

  React.useEffect(() => {
    repaintFrameVisuals()
  }, [dialedOpacity, repaintFrameVisuals])

  React.useEffect(() => {
    const pool = videoPoolRef.current
    for (const [, video] of pool) {
      applyPlaybackResolution(video, playbackResolution)
    }
  }, [playbackResolution])

  React.useEffect(() => {
    return () => {
      for (const poolPath of Array.from(videoPoolRef.current.keys())) {
        destroyPoolVideo(poolPath)
      }
    }
  }, [destroyPoolVideo])

  React.useLayoutEffect(() => {
    const lastFrame = lastFrameRequestRef.current
    if (!lastFrame) return
    applyFrameVisuals(lastFrame.state, lastFrame.mode)
  }, [applyFrameVisuals, frameScene])

  React.useEffect(() => {
    syncPlaybackTimecode(currentTime)
  }, [currentTime, syncPlaybackTimecode])

  React.useEffect(() => {
    if (!isPlaying) return

    let animFrameId = 0
    const tick = () => {
      renderFrame(playbackTimeRef.current, 'playback')
      animFrameId = requestAnimationFrame(tick)
    }

    animFrameId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(animFrameId)
    }
  }, [isPlaying, playbackTimeRef, renderFrame])

  // While playing, ride each active text overlay's fade in/out opacity per frame.
  // renderFrame short-circuits when the clip set is unchanged, so the fade can't
  // ride React state — update the DOM opacity directly instead. Scrub/paused
  // frames get the same value inline from the JSX above.
  React.useEffect(() => {
    if (!isPlaying) return
    let id = 0
    const tick = () => {
      const t = playbackTimeRef.current
      for (const tc of frameSceneRef.current.activeTextClips) {
        const el = textOverlayElsRef.current.get(tc.id)
        const ts = tc.textStyle
        if (!el || !ts) continue
        const preview = getOpacityPreview()
        el.style.opacity = String(textClipOpacity(tc, t, preview?.clipId === tc.id ? preview.value : null))
      }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [isPlaying, playbackTimeRef])

  React.useEffect(() => {
    if (isPlaying) return
    renderFrame(currentTime, 'scrub')
  }, [clips, currentTime, isPlaying, renderFrame, subtitles, tracks])

  React.useEffect(() => {
    const handler = () => setIsFullscreen(document.fullscreenElement === previewContainerRef.current)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  React.useEffect(() => {
    if (!previewZoomOpen) return
    const handler = () => setPreviewZoomOpen(false)
    const raf = requestAnimationFrame(() => {
      window.addEventListener('click', handler)
    })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('click', handler)
    }
  }, [previewZoomOpen])

  React.useEffect(() => {
    if (!verticalGuideOpen) return
    const handler = () => setVerticalGuideOpen(false)
    const raf = requestAnimationFrame(() => {
      window.addEventListener('click', handler)
    })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('click', handler)
    }
  }, [verticalGuideOpen])

  React.useEffect(() => {
    if (!playbackResOpen) return
    const handler = () => setPlaybackResOpen(false)
    const raf = requestAnimationFrame(() => {
      window.addEventListener('click', handler)
    })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('click', handler)
    }
  }, [playbackResOpen])

  React.useEffect(() => {
    if (previewZoom === 'fit') {
      setPreviewPan({ x: 0, y: 0 })
    }
  }, [previewZoom])

  React.useEffect(() => {
    const el = previewContainerRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setPreviewZoom(prev => {
        const current = prev === 'fit' ? 100 : prev
        const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15
        return Math.round(Math.min(1600, Math.max(10, current * delta)))
      })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  React.useEffect(() => {
    const el = previewContainerRef.current
    if (!el) return
    const PROJECT_RATIO = 16 / 9
    const compute = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width === 0 || height === 0) return
      let fw: number
      let fh: number
      if (width / height > PROJECT_RATIO) {
        fh = height
        fw = height * PROJECT_RATIO
      } else {
        fw = width
        fh = width / PROJECT_RATIO
      }
      setVideoFrameSize(prev => (prev.width === fw && prev.height === fh ? prev : { width: fw, height: fh }))
    }
    compute()
    const observer = new ResizeObserver(compute)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Compositing stack video sync is handled inside renderFrame.

  const activeClip = frameScene.activeClip
  const monitorClip = activeClip
  const layerStack = frameScene.layerStack
  const activeTextClips = frameScene.activeTextClips
  const activeSubtitles = frameScene.activeSubtitles
  const activeLetterbox = frameScene.activeLetterbox
  const activeAdjustmentEffects = frameScene.activeAdjustmentEffects
  const crossDissolveState = frameScene.crossDissolve
    ? {
      ...frameScene.crossDissolve,
      progress: lastFrameRequestRef.current?.state.crossDissolveProgress ?? 0,
    }
    : null

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {/* The SVG filters the graded clips reference by id (see getClipEffectStyles). */}
        <FilmLookDefs looks={filmLooksInUse} />
        {/* Preview (existing) */}
        <div
          ref={previewContainerRef}
          className={`flex-1 relative overflow-hidden min-h-0 min-w-0 ${isFullscreen ? 'bg-black' : ''}`}
          style={{ backgroundColor: isFullscreen ? '#000' : '#333', ...(previewZoom !== 'fit' ? { cursor: 'grab' } : {}) }}
          onDragOver={(e) => { if (isDroppedMediaEvent(e) || isNativeAssetDragEvent(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
          onDrop={(e) => {
            if (isNativeAssetDragEvent(e)) {
              e.preventDefault()
              const asset = readDroppedAsset(e, assets)
              if (asset) insertAssetsToTimeline({ assets: [asset], trackIndex: 0, startTime: currentTime })
              return
            }
            if (!isDroppedMediaEvent(e)) return
            e.preventDefault()
            void readDroppedMediaAsset(e, currentProjectId).then((asset) => {
              if (!asset) return
              addAssetToEditor(asset)
              insertAssetsToTimeline({ assets: [asset], trackIndex: 0, startTime: currentTime })
            })
          }}
          onMouseDown={(e) => {
            if (previewZoom === 'fit') return
            if (e.button !== 0 && e.button !== 1) return
            previewPanRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, startPanX: previewPan.x, startPanY: previewPan.y }
          }}
          onMouseMove={(e) => {
            if (!previewPanRef.current.dragging) return
            setPreviewPan({
              x: previewPanRef.current.startPanX + (e.clientX - previewPanRef.current.startX),
              y: previewPanRef.current.startPanY + (e.clientY - previewPanRef.current.startY),
            })
          }}
          onMouseUp={() => { previewPanRef.current.dragging = false }}
          onMouseLeave={() => { previewPanRef.current.dragging = false }}
        >
          {clips.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center">
                <div className="w-48 h-28 border-2 border-dashed border-zinc-700 rounded-lg flex flex-col items-center justify-center mb-4 mx-auto">
                  <Layers className="h-8 w-8 text-zinc-600 mb-2" />
                  <p className="text-zinc-500 text-xs">Drop clips here</p>
                </div>
                <p className="text-zinc-600 text-xs">Click assets or drag them to the timeline</p>
              </div>
            </div>
          ) : (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={previewZoom !== 'fit' ? {
                transform: `translate(${previewPan.x}px, ${previewPan.y}px) scale(${(previewZoom as number) / 100})`,
                transformOrigin: 'center center',
              } : undefined}
            >
              {/* Video frame wrapper — black bg with exact 16:9 dimensions */}
              <div
                className="relative bg-black overflow-hidden"
                style={videoFrameSize.width > 0 ? { width: videoFrameSize.width, height: videoFrameSize.height } : { width: '100%', aspectRatio: '16/9' }}
                onClick={() => {
                  if (suppressFrameClickRef.current) {
                    return
                  }
                  clearClipSelection()
                }}
              >
              {(() => {
                return (
                <>
                  {/* Layers: graphics drawn OVER the active clip (z above the video
                      pool and the active image, below the transform box and titles). */}
                  {layerStack.map(lowerClip => {
                    const lowerPath = getClipPath(lowerClip) || lowerClip.asset?.path || ''
                    const lowerFileUrl = lowerPath ? pathToFileUrl(lowerPath) : ''
                    if (lowerClip.asset?.type === 'image' || lowerClip.type === 'image') {
                      return (
                        <img
                          key={`comp-${lowerClip.id}`}
                          src={lowerFileUrl}
                          alt=""
                          className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[6]"
                          ref={(el) => {
                            if (el) layerMediaRefs.current.set(lowerClip.id, el)
                            else layerMediaRefs.current.delete(lowerClip.id)
                          }}
                        />
                      )
                    }
                    return (
                      <video
                        key={`comp-${lowerClip.id}`}
                        id={`comp-video-${lowerClip.id}`}
                        src={lowerFileUrl}
                        className="absolute inset-0 w-full h-full object-contain pointer-events-none z-[6]"
                        muted
                        playsInline
                        preload="auto"
                        ref={(el) => {
                          if (el) {
                            layerMediaRefs.current.set(lowerClip.id, el)
                            el.muted = true
                          } else {
                            layerMediaRefs.current.delete(lowerClip.id)
                          }
                        }}
                      />
                    )
                  })}

                  {/* Transition background overlay */}
                  {activeClip && (() => {
                    const tInBg = activeClip.transitionIn?.type !== 'none' ? getTransitionBgColor(activeClip.transitionIn.type) : null
                    const tOutBg = activeClip.transitionOut?.type !== 'none' ? getTransitionBgColor(activeClip.transitionOut.type) : null
                    const bg = tInBg || tOutBg
                    if (!bg) return null
                    return <div ref={transitionBgRef} className="absolute inset-0 z-10 pointer-events-none hidden" />
                  })()}
                  {/* Video pool container — during dissolve, fade out with progress */}
                  <div
                    ref={videoPoolContainerRef}
                    className="absolute inset-0 w-full h-full pointer-events-none z-[2] hidden"
                  />

                  {activeClip?.asset?.type === 'image' && (
                    <img
                      ref={activeImageRef}
                      src={pathToFileUrl(getClipPath(activeClip) || activeClip.asset.path)}
                      alt=""
                      className="absolute inset-0 w-full h-full object-contain z-[2]"
                    />
                  )}

                  {/* Cross-dissolve incoming clip overlay */}
                  {crossDissolveState && (() => {
                    const { incoming } = crossDissolveState
                    const inPath = getClipPath(incoming) || incoming.asset?.path || ''
                    const inFileUrl = inPath ? pathToFileUrl(inPath) : ''
                    if (incoming.asset?.type === 'video') {
                      return (
                        <video
                          ref={incomingDissolveVideoRef}
                          key={`dissolve-in-${incoming.id}`}
                          src={inFileUrl}
                          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                          playsInline
                          muted
                          preload="auto"
                        />
                      )
                    }
                    if (incoming.asset?.type === 'image') {
                      return (
                        <img
                          ref={incomingDissolveImageRef}
                          key={`dissolve-in-${incoming.id}`}
                          src={inFileUrl}
                          alt=""
                          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                        />
                      )
                    }
                    return null
                  })()}

                  {/* EFFECTS HIDDEN - masked effect overlays, vignette, and grain hidden because effects are not applied during export */}

                  {/* Audio waveform or empty state when no video/image clip is visible */}
                  {!monitorClip && (() => {
                    const audioAtPlayhead = frameScene.audioOnlyClips
                    return audioAtPlayhead.length > 0 ? (
                      <div className="absolute inset-0">
                        <AudioWaveform
                          audioClips={audioAtPlayhead.map(c => ({
                            url: pathToFileUrl(getClipPath(c) || c.asset?.path || ''),
                            name: c.asset?.path || c.importedName || 'Audio',
                            startTime: c.startTime,
                            duration: c.duration,
                          }))}
                          currentTime={currentTime}
                          isPlaying={isPlaying}
                        />
                      </div>
                    ) : !isPlaying ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                        <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
                          <Video className="h-8 w-8 text-zinc-600" />
                        </div>
                        <p className="text-zinc-500 text-sm">No clip at playhead</p>
                        <p className="text-zinc-600 text-xs mt-1">Move playhead over a clip to preview</p>
                      </div>
                    ) : null
                  })()}
                </>
                )
              })()}

              {/* Adjustment layer effects */}
              {activeAdjustmentEffects.map(({ clip: adjClip, filterStyle, hasVignette, vignetteAmount, hasGrain, grainAmount }) => {
                const backdropFilter = filterStyle.filter && filterStyle.filter !== 'none' ? String(filterStyle.filter) : undefined
                return (
                  <React.Fragment key={`adj-fx-${adjClip.id}`}>
                    {backdropFilter && (
                      <div
                        className="absolute inset-0 z-[22] pointer-events-none"
                        style={{ backdropFilter, WebkitBackdropFilter: backdropFilter }}
                      />
                    )}
                    {hasVignette && (
                      <div
                        className="absolute inset-0 z-[22] pointer-events-none"
                        style={{
                          background: `radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,${vignetteAmount}) 100%)`,
                        }}
                      />
                    )}
                    {hasGrain && (
                      <canvas
                        ref={(canvas) => {
                          if (!canvas) return
                          const ctx = canvas.getContext('2d')
                          if (!ctx) return
                          const w = canvas.width = 256
                          const h = canvas.height = 256
                          const imageData = ctx.createImageData(w, h)
                          for (let i = 0; i < imageData.data.length; i += 4) {
                            const v = Math.random() * 255
                            imageData.data[i] = v
                            imageData.data[i + 1] = v
                            imageData.data[i + 2] = v
                            imageData.data[i + 3] = (grainAmount / 100) * 80
                          }
                          ctx.putImageData(imageData, 0, 0)
                        }}
                        className="absolute inset-0 z-[22] pointer-events-none w-full h-full"
                        style={{ mixBlendMode: 'overlay', imageRendering: 'pixelated' }}
                      />
                    )}
                  </React.Fragment>
                )
              })}

              {/* Transform box for the selected video/image clip — move, resize,
                  stretch. Offered for any visible media clip, so the background can
                  be punched in as well as a logo placed on top. */}
              {(() => {
                const target = [...layerStack].reverse().concat(activeClip ? [activeClip] : [])
                  .find(clip => selectedClipIds.has(clip.id) && (clip.type === 'video' || clip.type === 'image'))
                if (!target) return null
                const atTime = isPlaying ? playbackTimeRef.current : currentTime
                const timeInClip = Math.max(0, atTime - target.startTime)
                return (
                  <MediaTransformBox
                    key={`layer-${target.id}`}
                    clip={target}
                    frameSize={videoFrameSize}
                    timeInClip={timeInClip}
                    onPreview={(preview) => {
                      setLayerPreview(preview ? { clipId: target.id, frame: preview } : null)
                      repaintFrameVisuals()
                    }}
                    onDragActiveChange={(active) => {
                      // A drag that ends outside the box delivers its click to the
                      // frame, whose handler clears the selection — so the clip the
                      // user was just sizing would need re-picking in the timeline
                      // before they could move it. Same guard the text box uses.
                      suppressFrameClickRef.current = active
                      if (!active) selectClip(target.id)
                    }}
                    onCommit={(patch) => setClipLayerAt(target.id, timeInClip, patch)}
                  />
                )
              })()}

              {/* Text overlay clips */}
              {activeTextClips.map(tc => (
                <TextOverlayBox
                  key={`text-${tc.id}`}
                  clip={tc}
                  frameHeight={videoFrameSize.height}
                  // While playing, the store's time lags (it's throttled) — use the live
                  // playhead so React renders agree with the per-frame opacity loop.
                  time={isPlaying ? playbackTimeRef.current : currentTime}
                  selected={selectedClipIds.has(tc.id)}
                  registerEl={(id, el) => { if (el) textOverlayElsRef.current.set(id, el); else textOverlayElsRef.current.delete(id) }}
                  onTransformCommit={(patch) => updateClip(tc.id, { textStyle: { ...tc.textStyle!, ...patch } })}
                  onBodyMouseDown={(e) => {
                    e.stopPropagation()
                    suppressFrameClickRef.current = true
                    selectClip(tc.id)
                    // Capture panel state at mousedown time so we can restore it after any
                    // spurious onClick handlers that might close it
                    const wasOpen = showPropertiesPanel
                    const clipId = tc.id
                    const container = (e.currentTarget.parentElement as HTMLElement)
                    if (!container) return
                    const rect = container.getBoundingClientRect()
                    const onMove = (ev: MouseEvent) => {
                      const px = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100))
                      const py = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100))
                      setClipTextPosition(tc.id, px, py)
                    }
                    const onUp = () => {
                      window.removeEventListener('mousemove', onMove)
                      window.removeEventListener('mouseup', onUp)
                      // Reset the ref and restore state after all click events have fired
                      requestAnimationFrame(() => {
                        suppressFrameClickRef.current = false
                        selectClip(clipId)
                        if (wasOpen) setShowPropertiesPanel(true)
                      })
                    }
                    window.addEventListener('mousemove', onMove)
                    window.addEventListener('mouseup', onUp)
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    selectClip(tc.id)
                    setShowPropertiesPanel(true)
                  }}
                />
              ))}

              {/* Subtitle overlay */}
              {activeSubtitles.length > 0 && (
                <div className="absolute inset-0 z-[25] pointer-events-none flex flex-col justify-end">
                  {activeSubtitles.map(sub => {
                    const track = tracks[sub.trackIndex]
                    const style = { ...DEFAULT_SUBTITLE_STYLE, ...(track?.subtitleStyle || {}), ...sub.style }
                    return (
                      <div
                        key={sub.id}
                        className={`w-full flex ${
                          style.position === 'top' ? 'self-start' : style.position === 'center' ? 'self-center absolute inset-0 items-center justify-center' : 'self-end'
                        }`}
                        style={style.position !== 'center' ? { padding: style.position === 'top' ? '12px 16px 0' : '0 16px 12px' } : undefined}
                      >
                        <span
                          className="inline-block max-w-[90%] text-center mx-auto rounded px-3 py-1.5 leading-snug whitespace-pre-wrap"
                          style={{
                            fontSize: `${style.fontSize}px`,
                            fontFamily: style.fontFamily,
                            fontWeight: style.fontWeight,
                            fontStyle: style.italic ? 'italic' : 'normal',
                            color: style.color,
                            backgroundColor: style.backgroundColor,
                            textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
                          }}
                        >
                          {sub.text}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Letterbox overlay from adjustment layers */}
              {activeLetterbox && (() => {
                const containerRatio = 16 / 9
                const targetRatio = activeLetterbox.ratio
                if (targetRatio >= containerRatio) {
                  const barPct = ((1 - containerRatio / targetRatio) / 2) * 100
                  return barPct > 0 ? (
                    <>
                      <div
                        className="absolute left-0 right-0 top-0 z-[18] pointer-events-none"
                        style={{ height: `${barPct}%`, backgroundColor: activeLetterbox.color, opacity: activeLetterbox.opacity }}
                      />
                      <div
                        className="absolute left-0 right-0 bottom-0 z-[18] pointer-events-none"
                        style={{ height: `${barPct}%`, backgroundColor: activeLetterbox.color, opacity: activeLetterbox.opacity }}
                      />
                    </>
                  ) : null
                } else {
                  const barPct = ((1 - targetRatio / containerRatio) / 2) * 100
                  return barPct > 0 ? (
                    <>
                      <div
                        className="absolute top-0 bottom-0 left-0 z-[18] pointer-events-none"
                        style={{ width: `${barPct}%`, backgroundColor: activeLetterbox.color, opacity: activeLetterbox.opacity }}
                      />
                      <div
                        className="absolute top-0 bottom-0 right-0 z-[18] pointer-events-none"
                        style={{ width: `${barPct}%`, backgroundColor: activeLetterbox.color, opacity: activeLetterbox.opacity }}
                      />
                    </>
                  ) : null
                }
              })()}
              {/* EFFECTS HIDDEN - mask shape visual overlay hidden because effects are not applied during export */}

              {/* 9:16 guide + per-clip reframe window. The overlay itself is preview
                  only; a 9:16 export crops each clip to the window set here. */}
              {verticalGuide.fullGrid && videoFrameSize.width > 0 && (
                <div className="absolute inset-0 z-[19] pointer-events-none">
                  <VerticalFrameGuides showGrid showSafe={false} />
                </div>
              )}
              {verticalGuide.titleSafe && videoFrameSize.width > 0 && (
                <div className="absolute inset-0 z-[19] pointer-events-none">
                  <TitleSafeGuides />
                </div>
              )}
              {verticalGuide.frame && videoFrameSize.width > 0 && (() => {
                const src = activeClip
                  ? assets.find(a => a.id === activeClip.assetId) ?? activeClip.asset
                  : null
                return (
                  <VerticalReframeOverlay
                    frameSize={videoFrameSize}
                    clip={activeClip ?? null}
                    sourceSize={src?.width && src?.height ? { width: src.width, height: src.height } : null}
                    currentTime={currentTime}
                    isPlaying={isPlaying}
                    playbackTimeRef={playbackTimeRef}
                    showGrid={verticalGuide.grid}
                    showSafe={verticalGuide.safe}
                    onPause={pause}
                    onChange={(clipId, reframe) => updateClip(clipId, { reframe })}
                  />
                )
              })()}
              </div>{/* end video frame wrapper */}

              {/* Transparent overlay to prevent video element default interactions */}
              <div
                className="absolute inset-0 z-20 pointer-events-none"
              />
            </div>
          )}

          {/* Timecode + clip info moved to bottom status bar */}
        </div>

        {/* Program monitor mini scrub bar with IN/OUT markers */}
        {clips.length > 0 && (
          <div className="bg-zinc-900 border-t border-zinc-800 flex-shrink-0 relative px-2 py-1">
            <div
              id="program-scrub-bar"
              className="relative h-5 cursor-pointer group"
              onMouseDown={(e) => {
                const bar = e.currentTarget
                const rect = bar.getBoundingClientRect()
                const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                const t = pct * totalDuration
                pause()
                setCurrentTime(t)
                const onMove = (ev: MouseEvent) => {
                  const p = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
                  setCurrentTime(p * totalDuration)
                }
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove)
                  window.removeEventListener('mouseup', onUp)
                }
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
            >
              {/* Base track */}
              <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 bg-zinc-700 rounded-full" />
              {/* Progress fill */}
              <div
                className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-zinc-500 rounded-full"
                style={{ width: totalDuration > 0 ? `${(currentTime / totalDuration) * 100}%` : '0%' }}
              />
              {/* Dimmed region BEFORE In */}
              {inPoint !== null && (
                <div
                  className="absolute top-0 bottom-0 left-0 bg-black/50 rounded-l"
                  style={{ width: `${(inPoint / totalDuration) * 100}%` }}
                />
              )}
              {/* Dimmed region AFTER Out */}
              {outPoint !== null && (
                <div
                  className="absolute top-0 bottom-0 right-0 bg-black/50 rounded-r"
                  style={{ width: `${100 - (outPoint / totalDuration) * 100}%` }}
                />
              )}
              {/* In/Out range highlight */}
              {(inPoint !== null || outPoint !== null) && (
                <div
                  className="absolute top-0 bottom-0 border-t-2 border-b-2 border-blue-400/70 pointer-events-none"
                  style={{
                    left: `${((inPoint ?? 0) / totalDuration) * 100}%`,
                    width: `${(((outPoint ?? totalDuration) - (inPoint ?? 0)) / totalDuration) * 100}%`,
                  }}
                >
                  <div className="absolute inset-0 top-1/2 -translate-y-1/2 h-1 bg-blue-400/30 rounded-full" />
                </div>
              )}
              {/* In bracket — draggable */}
              {inPoint !== null && (
                <div
                  className="absolute top-0 bottom-0 flex items-center z-10 cursor-ew-resize"
                  style={{ left: `calc(${(inPoint / totalDuration) * 100}% - 6px)`, width: 12 }}
                  onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setDraggingMarker('timelineIn') }}
                >
                  <div className="w-1 h-full bg-blue-400 rounded-l-sm flex flex-col justify-between py-0.5 pointer-events-none ml-auto">
                    <div className="w-2 h-0.5 bg-blue-400 rounded-r" />
                    <div className="w-2 h-0.5 bg-blue-400 rounded-r" />
                  </div>
                </div>
              )}
              {/* Out bracket — draggable */}
              {outPoint !== null && (
                <div
                  className="absolute top-0 bottom-0 flex items-center z-10 cursor-ew-resize"
                  style={{ left: `${(outPoint / totalDuration) * 100}%`, width: 12 }}
                  onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setDraggingMarker('timelineOut') }}
                >
                  <div className="w-1 h-full bg-blue-400 rounded-r-sm flex flex-col justify-between py-0.5 pointer-events-none">
                    <div className="w-2 h-0.5 bg-blue-400 rounded-l -ml-1" />
                    <div className="w-2 h-0.5 bg-blue-400 rounded-l -ml-1" />
                  </div>
                </div>
              )}
              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 z-20 pointer-events-none"
                style={{ left: totalDuration > 0 ? `${(currentTime / totalDuration) * 100}%` : '0%' }}
              >
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-white rounded-full" />
                <div className="absolute top-1.5 bottom-0 left-1/2 -translate-x-1/2 w-px bg-white" />
              </div>
            </div>
            {/* Timecode labels */}
            {(inPoint !== null || outPoint !== null) && (
              <div className="flex justify-between items-center mt-0.5 h-3">
                <span className="text-[9px] font-mono text-blue-400/80">
                  {inPoint !== null ? `IN ${formatTime(inPoint)}` : ''}
                </span>
                <span className="text-[9px] font-mono text-zinc-500">
                  {inPoint !== null && outPoint !== null ? `Duration: ${formatTime(outPoint - inPoint)}` : ''}
                </span>
                <span className="text-[9px] font-mono text-blue-400/80">
                  {outPoint !== null ? `OUT ${formatTime(outPoint)}` : ''}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Status bar: timecode | Fit | transport controls | resolution | duration */}
        <div className="h-8 bg-zinc-950 border-t border-zinc-800 flex items-center px-3 flex-shrink-0 gap-2">
          {/* Left: current timecode */}
          <span
            ref={playbackTimecodeRef}
            className="text-[12px] font-mono font-medium text-amber-400 tabular-nums tracking-tight select-none flex-shrink-0"
          >
            {formatTime(currentTime)}
          </span>

          {/* Fit / Zoom dropdown */}
          <div className="relative flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setPreviewZoomOpen(prev => !prev) }}
              className={`h-6 px-2 rounded text-[11px] font-medium tabular-nums flex items-center gap-1 transition-colors border ${
                previewZoomOpen
                  ? 'bg-zinc-700 text-white border-zinc-600'
                  : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border-zinc-700 hover:border-zinc-600'
              }`}
            >
              {previewZoom === 'fit' ? 'Fit' : `${previewZoom}%`}
              <ChevronDown className="h-3 w-3" />
            </button>
            {previewZoomOpen && (
              <div className="absolute bottom-full left-0 mb-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl py-1 min-w-[100px] z-50">
                {[
                  { label: 'Fit', value: 'fit' as const },
                  { label: '10%', value: 10 },
                  { label: '25%', value: 25 },
                  { label: '50%', value: 50 },
                  { label: '75%', value: 75 },
                  { label: '100%', value: 100 },
                  { label: '150%', value: 150 },
                  { label: '200%', value: 200 },
                  { label: '400%', value: 400 },
                  { label: '800%', value: 800 },
                ].map(opt => (
                  <button
                    key={opt.label}
                    onClick={() => { setPreviewZoom(opt.value); setPreviewZoomOpen(false) }}
                    className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 transition-colors ${
                      previewZoom === opt.value
                        ? 'text-blue-300 bg-blue-600/20'
                        : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    {previewZoom === opt.value && <span className="text-blue-400">&#10003;</span>}
                    <span className={previewZoom === opt.value ? '' : 'ml-5'}>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Center: transport controls — Premiere-style 5-button strip */}
          <div className="flex-1 flex items-center justify-center gap-0.5">
            {/* Set In */}
            <Tooltip content={`${inPoint !== null ? `In: ${formatTime(inPoint)} — ` : ''}${tooltipLabel('Set In point', getShortcutLabel(kbLayout, 'mark.setIn'))}`} side="top">
              <Button
                variant="ghost" size="icon"
                className={`h-6 w-6 ${inPoint !== null ? 'text-yellow-400' : 'text-zinc-500'}`}
                onClick={() => setTimelineInPoint(inPoint !== null && Math.abs(inPoint - currentTime) < 0.01 ? null : currentTime)}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="7,4 4,4 4,20 7,20" />
                  <line x1="10" y1="12" x2="20" y2="12" />
                  <polyline points="16,8 20,12 16,16" />
                </svg>
              </Button>
            </Tooltip>
            <div className="w-px h-3 bg-zinc-700" />
            {/* Go to In */}
            <Tooltip content={tooltipLabel('Go to In Point', getShortcutLabel(kbLayout, 'transport.goToIn'))} side="top">
              <Button
                variant="ghost" size="icon"
                className={`h-6 w-6 ${inPoint !== null ? 'text-zinc-400' : 'text-zinc-500'}`}
                onClick={() => {
                  const target = inPoint ?? (clips.length > 0 ? Math.min(...clips.map(c => c.startTime)) : 0)
                  pause()
                  stopShuttle()
                  setCurrentTime(target)
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="4" x2="4" y2="20" />
                  <line x1="8" y1="12" x2="20" y2="12" />
                  <polyline points="14,7 8,12 14,17" />
                </svg>
              </Button>
            </Tooltip>
            {/* Step Back */}
            <Tooltip content={tooltipLabel('Step Back', getShortcutLabel(kbLayout, 'transport.stepBackward'))} side="top">
              <Button
                variant="ghost" size="icon"
                className="h-6 w-6 text-zinc-500"
                onClick={() => {
                  pause()
                  stopShuttle()
                  stepCurrentTime(-1 / 24)
                }}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
            {/* Play/Pause toggle */}
            <Tooltip content={isPlaying ? tooltipLabel('Pause', getShortcutLabel(kbLayout, 'transport.playPause')) : tooltipLabel('Play', getShortcutLabel(kbLayout, 'transport.playPause'))} side="top">
              <Button
                variant="ghost" size="icon"
                onClick={() => {
                  stopShuttle()
                  if (isPlaying) pause()
                  else play()
                }}
                className="h-6 w-6 text-zinc-400"
              >
                {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3 ml-0.5" />}
              </Button>
            </Tooltip>
            {/* Step Forward */}
            <Tooltip content={tooltipLabel('Step Forward', getShortcutLabel(kbLayout, 'transport.stepForward'))} side="top">
              <Button
                variant="ghost" size="icon"
                className="h-6 w-6 text-zinc-500"
                onClick={() => {
                  pause()
                  stopShuttle()
                  setCurrentTime(Math.min(totalDuration, currentTime + (1 / 24)))
                }}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
            {/* Go to Out */}
            <Tooltip content={tooltipLabel('Go to Out Point', getShortcutLabel(kbLayout, 'transport.goToOut'))} side="top">
              <Button
                variant="ghost" size="icon"
                className={`h-6 w-6 ${outPoint !== null ? 'text-zinc-400' : 'text-zinc-500'}`}
                onClick={() => {
                  const target = outPoint ?? (clips.length > 0 ? Math.max(...clips.map(c => c.startTime + c.duration)) : totalDuration)
                  pause()
                  stopShuttle()
                  setCurrentTime(target)
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="20" y1="4" x2="20" y2="20" />
                  <line x1="16" y1="12" x2="4" y2="12" />
                  <polyline points="10,7 16,12 10,17" />
                </svg>
              </Button>
            </Tooltip>
            <div className="w-px h-3 bg-zinc-700" />
            {/* Set Out */}
            <Tooltip content={`${outPoint !== null ? `Out: ${formatTime(outPoint)} — ` : ''}${tooltipLabel('Set Out point', getShortcutLabel(kbLayout, 'mark.setOut'))}`} side="top">
              <Button
                variant="ghost" size="icon"
                className={`h-6 w-6 ${outPoint !== null ? 'text-yellow-400' : 'text-zinc-500'}`}
                onClick={() => setTimelineOutPoint(outPoint !== null && Math.abs(outPoint - currentTime) < 0.01 ? null : currentTime)}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="17,4 20,4 20,20 17,20" />
                  <line x1="14" y1="12" x2="4" y2="12" />
                  <polyline points="8,8 4,12 8,16" />
                </svg>
              </Button>
            </Tooltip>
            {/* Loop In/Out */}
            <Tooltip content="Loop In/Out" side="top">
              <Button
                variant="ghost" size="icon"
                className={`h-6 w-6 ${playingInOut ? 'text-yellow-400 bg-yellow-400/10' : 'text-zinc-500'} ${inPoint === null || outPoint === null ? 'opacity-30 cursor-not-allowed' : ''}`}
                disabled={inPoint === null || outPoint === null}
                onClick={() => {
                  if (inPoint === null || outPoint === null) return
                  stopShuttle()
                  if (playingInOut) {
                    togglePlayInOut()
                    pause()
                    return
                  }
                  setCurrentTime(inPoint)
                  togglePlayInOut()
                  play()
                }}
              >
                <Repeat className="h-3 w-3" />
              </Button>
            </Tooltip>
            {/* Clear In/Out */}
            <Tooltip content={tooltipLabel('Clear In/Out', getShortcutLabel(kbLayout, 'mark.clearInOut'))} side="top">
              <Button
                variant="ghost" size="icon"
                className={`h-6 w-6 text-zinc-500 ${inPoint === null && outPoint === null ? 'opacity-30 cursor-not-allowed' : ''}`}
                disabled={inPoint === null && outPoint === null}
                onClick={() => {
                  if (playingInOut) { togglePlayInOut(); pause() }
                  clearTimelineMarks()
                }}
              >
                <XCircle className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
          </div>

          {/* Framing guides: thirds, safe areas, 9:16 */}
          <div className="relative flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setVerticalGuideOpen(prev => !prev) }}
              className={`h-6 px-2 rounded text-[11px] font-medium flex items-center gap-1 transition-colors border ${
                verticalGuide.frame || verticalGuide.fullGrid || verticalGuide.titleSafe
                  ? 'bg-zinc-900 text-[rgb(var(--accent))] border-[rgb(var(--accent))]/60'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-700 hover:border-zinc-600'
              }`}
              title="Framing guides — thirds grid, title/action safe areas, or a 9:16 frame to check the cut is safe for a portrait crop"
            >
              <Frame className="h-3 w-3" />
              Guides
              <ChevronDown className="h-3 w-3" />
            </button>
            {verticalGuideOpen && (
              <div
                className="absolute bottom-full right-0 mb-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl py-1 min-w-[180px] z-50"
                onClick={(e) => e.stopPropagation()}
              >
                {([
                  { key: 'fullGrid', label: 'Thirds grid (full frame)' },
                  { key: 'titleSafe', label: 'Title & action safe' },
                  { key: 'frame', label: 'Show 9:16 frame' },
                  { key: 'grid', label: 'Thirds grid in 9:16' },
                  { key: 'safe', label: 'Social UI safe zones' },
                ] as const).map(opt => {
                  const on = verticalGuide[opt.key]
                  const disabled = (opt.key === 'grid' || opt.key === 'safe') && !verticalGuide.frame
                  return (
                    <button
                      key={opt.key}
                      title={disabled ? 'Turn on the 9:16 frame first' : undefined}
                      disabled={disabled}
                      onClick={() => setVerticalGuide(g => ({ ...g, [opt.key]: !g[opt.key] }))}
                      className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 transition-colors ${
                        disabled ? 'text-zinc-600 cursor-default' : on ? 'text-blue-300 hover:bg-zinc-800' : 'text-zinc-300 hover:bg-zinc-800'
                      }`}
                    >
                      <span className="w-3 text-blue-400">{on && !disabled ? '✓' : ''}</span>
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Resolution dropdown */}
          <div className="relative flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setPlaybackResOpen(prev => !prev) }}
              className={`h-6 px-2 rounded text-[11px] font-medium flex items-center gap-1 transition-colors border ${
                playbackResolution === 1
                  ? 'bg-zinc-900 text-green-400 border-zinc-700 hover:border-zinc-600'
                  : playbackResolution === 0.5
                  ? 'bg-zinc-900 text-yellow-400 border-zinc-700 hover:border-zinc-600'
                  : 'bg-zinc-900 text-orange-400 border-zinc-700 hover:border-zinc-600'
              }`}
              title="Playback resolution"
            >
              {playbackResolution === 1 ? 'Full' : playbackResolution === 0.5 ? '1/2' : '1/4'}
              <ChevronDown className="h-3 w-3" />
            </button>
            {playbackResOpen && (
              <div className="absolute bottom-full right-0 mb-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl py-1 min-w-[120px] z-50">
                {([
                  { label: 'Full (1:1)', value: 1 as const, desc: 'Highest quality' },
                  { label: 'Half (1/2)', value: 0.5 as const, desc: 'Balanced' },
                  { label: 'Quarter (1/4)', value: 0.25 as const, desc: 'Smoothest' },
                ] as const).map(opt => (
                  <button
                    key={opt.label}
                    onClick={() => { setPlaybackResolution(opt.value); setPlaybackResOpen(false) }}
                    className={`w-full text-left px-3 py-1.5 text-[11px] flex flex-col gap-0 transition-colors ${
                      playbackResolution === opt.value
                        ? 'text-blue-300 bg-blue-600/20'
                        : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {playbackResolution === opt.value && <span className="text-blue-400">&#10003;</span>}
                      <span className={playbackResolution === opt.value ? '' : 'ml-5'}>{opt.label}</span>
                    </div>
                    <span className={`text-[10px] ${playbackResolution === opt.value ? 'text-blue-400/60' : 'text-zinc-500'} ml-5`}>{opt.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Fullscreen */}
          <Tooltip content={isFullscreen ? tooltipLabel('Exit fullscreen', getShortcutLabel(kbLayout, 'view.fullscreen')) : tooltipLabel('Fullscreen', getShortcutLabel(kbLayout, 'view.fullscreen'))} side="top">
            <button
              onClick={toggleFullscreen}
              className="p-1 rounded hover:bg-zinc-800 transition-colors text-zinc-500 hover:text-zinc-300"
            >
              {isFullscreen
                ? <Shrink className="h-3.5 w-3.5" />
                : <Expand className="h-3.5 w-3.5" />
              }
            </button>
          </Tooltip>

          {/* Right: total duration */}
          <span className="text-[12px] font-mono font-medium text-zinc-400 tabular-nums tracking-tight select-none flex-shrink-0 text-right">
            {formatTime(totalDuration)}
          </span>
        </div>
      </div>
  )
})

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { shallow } from 'zustand/vanilla/shallow'
import {
  Plus, Trash2,
  ZoomIn, ZoomOut, Maximize2,
  Volume2, VolumeX, Copy,
  Layers,
  Gauge, Upload,
  Magnet, Lock, Unlock, GripVertical, Pencil, Film,
  Palette,
  Eye, EyeOff, ChevronRight, ChevronLeft,
  X, MessageSquare, FileUp, FileDown,
  Sparkles, Type,
  Music, RefreshCw, Loader2, Link2,
  CircleDot, Circle, PanelRight, ArrowLeftRight, Diamond, Crosshair,
} from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Tooltip } from '../../components/ui/tooltip'
import { ClipWaveform } from '../../components/AudioWaveform'
import { useVisibleTimeWindow } from './useVisibleTimeWindow'
import type { GenerationSettings } from '../../components/SettingsPanel'
import { useAppSettings } from '../../contexts/AppSettingsContext'
import { useVideoGenerationModelSpecs } from '../../hooks/use-video-generation-model-specs'
import { RETAKE_EXTEND_MODELS } from '../../hooks/use-retake'
import type { GenerationError } from '../../lib/generation-errors'
import { addVisualAssetToProject } from '../../lib/asset-copy'
import { GPM_IMAGE_DND_TYPE } from '../../components/gpm/gpm-image-file'
import { FILE_DND } from '../../components/gpm/DownloadsBrowser'
import { GapGenerationModal } from './GapGenerationModal'
import { ClipContextMenu, type ClipContextMenuState } from './ClipContextMenu'
import type { TimelineClip, Track, SubtitleClip, Asset, TextOverlayStyle, TransitionType } from '../../types/project-model'
import { ApiClient } from '../../lib/api-client'
import { pathToFileUrl } from '../../lib/file-url'
import {
  areVideoGenerationSettingsEquivalent,
  getApiOfferingCapabilities,
  getLocalOfferingCapabilities,
  getVideoGenerationModelSpecs,
  resolveVideoGenerationOptions,
  sanitizeVideoGenerationSettings,
} from '../../lib/video-generation-model-specs'
import {
  PRIMARY_TOOLS, TRIM_TOOLS,
  CUT_POINT_TOLERANCE, DEFAULT_DISSOLVE_DURATION,
  type ToolType,
  getShortcutLabel, tooltipLabel,
  formatTime, parseTime, getColorLabel,
} from './video-editor-utils'
import {
  applyStateAction,
} from './editor-actions'
import {
  selectActiveTimeline,
  selectActiveTimelineInPoint,
  selectActiveTimelineOutPoint,
  selectAssets,
  selectCanUseClipboard,
  selectClipMaxDurationFromAssets,
  selectClipPathFromAssets,
  selectClipResolutionFromAssets,
  selectClips,
  selectCurrentTime,
  selectEditingSubtitleId,
  selectIsPlaying,
  selectLastTrimTool,
  selectLiveAssetForClipFromAssets,
  selectOpenTimelineIds,
  selectPixelsPerSecond,
  selectSelectedClipForProperties,
  selectSelectedClipIds,
  selectSelectedSubtitleId,
  selectShowPropertiesPanel,
  selectSnapEnabled,
  selectSubtitleTrackStyleIdx,
  selectSubtitles,
  selectTimelineLength,
  selectTimelineRenameState,
  selectTimelines,
  selectTotalDuration,
  selectTracks,
  selectZoom,
  selectActiveTool,
} from './editor-selectors'
import { useTimelineDrag } from './useTimelineDrag'
import { TimelineRulerTicks } from './TimelineRulerTicks'
import { TimelineScrollbar } from './TimelineScrollbar'
import { clampZoom, formatZoom, sliderToZoom, stepZoom, zoomToSlider, ZOOM_SLIDER_MAX } from './timeline-zoom'
import { useEditorActions, useEditorStore } from './editor-store'
import { ClipKeyframeDiamonds } from './ClipKeyframeDiamonds'
import { skipMcpReveal, useMcpReveal } from './mcp-reveal'

// Custom scissors cursor SVG for the blade tool (white with dark outline for contrast)
const SCISSORS_CURSOR_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><circle cx='6' cy='6' r='3'/><path d='M8.12 8.12 12 12'/><path d='M20 4 8.12 15.88'/><circle cx='6' cy='18' r='3'/><path d='M14.8 14.8 20 20'/></svg>`
const SCISSORS_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(SCISSORS_CURSOR_SVG)}") 12 12, crosshair`

// Track Select Forward cursors — stacked chevrons for all tracks, single for one track
const TRACK_FWD_ALL_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='28' viewBox='0 0 24 28' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='M8 1l5 5-5 5'/><path d='M8 16l5 5-5 5'/></svg>`
const TRACK_FWD_ALL_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(TRACK_FWD_ALL_SVG)}") 12 12, e-resize`
const TRACK_FWD_ONE_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='M8 6l6 6-6 6'/></svg>`
const TRACK_FWD_ONE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(TRACK_FWD_ONE_SVG)}") 12 12, e-resize`

/** mm:ss, with minutes allowed past 59 (a 30-minute timeline reads 30:00). */
function formatLength(seconds: number): string {
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`
}

// Below this width (px) a clip is drawn as a plain block.
const NARROW_CLIP_PX = 28

type TimelineMenuState = { timelineId: string; x: number; y: number } | null
type GapSelection = { trackIndex: number; startTime: number; endTime: number } | null
type GapAnchor = { x: number; gapTop: number; gapBottom: number } | null
type GapGenerateMode = 'text-to-video' | 'image-to-video' | 'text-to-image'

interface GapGenerationApi {
  generate: (prompt: string, imagePath: string | null, settings: GenerationSettings) => Promise<void>
  generateImage: (prompt: string, settings: GenerationSettings) => Promise<void>
  videoPath: string | null
  imagePath: string | null
  isGenerating: boolean
  progress: number
  statusMessage: string
  cancel: () => void
  reset: () => void
  error: GenerationError | null
  canCancel: boolean
}

export interface VideoEditorTimelineEditingPanelProps {
  currentProjectId: string | null
  playbackTimeRef: React.MutableRefObject<number>
  centerOnPlayheadRef: React.MutableRefObject<boolean>
  getMinZoom: () => number
  canUseIcLora: boolean
  handleICLoraClip: (clip: TimelineClip) => void
  kbLayout: any
  handleExportTimelineXml: () => void
  subtitleFileInputRef: React.RefObject<HTMLInputElement>
  handleImportSrt: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleExportSrt: () => void
  gapGenerationApi: GapGenerationApi
  selectedGapRefBridge: React.MutableRefObject<GapSelection>
  gapGenerateModeRefBridge: React.MutableRefObject<GapGenerateMode | null>
  clearSelectedGapRefBridge: React.MutableRefObject<() => void>
  closeSelectedGapRefBridge: React.MutableRefObject<() => void>
  timelineRefBridge: React.MutableRefObject<HTMLDivElement | null>
  trackContainerRefBridge: React.MutableRefObject<HTMLDivElement | null>
  trackHeadersRefBridge: React.MutableRefObject<HTMLDivElement | null>
  rulerScrollRefBridge: React.MutableRefObject<HTMLDivElement | null>
  markerDragOriginRef: React.MutableRefObject<'timeline' | 'scrubbar' | null>
  setDraggingMarker: (v: 'timelineIn' | 'timelineOut' | null) => void
  bladeShiftHeld: boolean
  onTimelinePanelContextMenu?: (e: React.MouseEvent, timelineId: string) => void
  fitToViewRef: React.MutableRefObject<() => void>
  onRevealAsset: (assetId: string) => void
  onCreateVideoFromImage: (clip: TimelineClip) => void
  onCaptureFrameForVideo: (clip: TimelineClip) => void
  onCreateVideoFromAudio: (clip: TimelineClip) => void
  handleRegenerate: (assetId: string, clipId: string) => void
  handleRetakeClip: (clip: TimelineClip) => void
  handleCancelRegeneration: () => void
  canCancelInFlight: boolean
  isRegenerating: boolean
  regenProgress: number
}

export function VideoEditorTimelineEditingPanel(props: VideoEditorTimelineEditingPanelProps) {
  const {
    currentProjectId,
    playbackTimeRef,
    centerOnPlayheadRef,
    getMinZoom,
    canUseIcLora,
    handleICLoraClip,
    kbLayout,
    handleExportTimelineXml,
    subtitleFileInputRef,
    handleImportSrt,
    handleExportSrt,
    gapGenerationApi,
    selectedGapRefBridge,
    gapGenerateModeRefBridge,
    clearSelectedGapRefBridge,
    closeSelectedGapRefBridge,
    timelineRefBridge,
    trackContainerRefBridge,
    trackHeadersRefBridge,
    rulerScrollRefBridge,
    markerDragOriginRef,
    setDraggingMarker,
    bladeShiftHeld,
    onTimelinePanelContextMenu,
    fitToViewRef,
    onRevealAsset,
    onCreateVideoFromImage,
    onCaptureFrameForVideo,
    onCreateVideoFromAudio,
    handleRegenerate,
    handleRetakeClip,
    handleCancelRegeneration,
    canCancelInFlight,
    isRegenerating,
    regenProgress,
  } = props
  const actions = useEditorActions()
  const { shouldVideoGenerateWithLtxApi } = useAppSettings()
  const {
    modelSpecs: videoGenerationModelSpecsResponse,
    isLoading: isLoadingVideoGenerationModelSpecs,
    errorMessage: videoGenerationModelSpecsErrorMessage,
  } = useVideoGenerationModelSpecs()
  const localCaps = getLocalOfferingCapabilities(videoGenerationModelSpecsResponse)
  // Retake/Extend always request RETAKE_EXTEND_MODELS (currently "pro" / 2.3 Pro),
  // not the timeline clip's t2v/i2v generation pipeline.
  const apiCaps = getApiOfferingCapabilities(
    videoGenerationModelSpecsResponse,
    RETAKE_EXTEND_MODELS[0],
  )
  const canUseRetake = shouldVideoGenerateWithLtxApi
    ? Boolean(apiCaps?.retake)
    : Boolean(localCaps?.retake)
  const requestRetakeClip = (clip: TimelineClip) => {
    if (!canUseRetake) return
    handleRetakeClip(clip)
  }

  const assets = useEditorStore(selectAssets)
  const timelines = useEditorStore(selectTimelines)
  const activeTimeline = useEditorStore(selectActiveTimeline)
  const clips = useEditorStore(selectClips)
  const tracks = useEditorStore(selectTracks)
  const subtitles = useEditorStore(selectSubtitles)
  const totalDuration = useEditorStore(selectTotalDuration)
  const timelineLength = useEditorStore(selectTimelineLength)
  const pixelsPerSecond = useEditorStore(selectPixelsPerSecond)
  const currentTime = useEditorStore(selectCurrentTime)
  const isPlaying = useEditorStore(selectIsPlaying)
  const inPoint = useEditorStore(selectActiveTimelineInPoint)
  const outPoint = useEditorStore(selectActiveTimelineOutPoint)
  const zoom = useEditorStore(selectZoom)
  const selectedClip = useEditorStore(selectSelectedClipForProperties)
  const selectedClipIds = useEditorStore(selectSelectedClipIds)
  const activeTool = useEditorStore(selectActiveTool)
  const lastTrimTool = useEditorStore(selectLastTrimTool)
  const snapEnabled = useEditorStore(selectSnapEnabled)
  const showPropertiesPanel = useEditorStore(selectShowPropertiesPanel)
  const openTimelineIds = useEditorStore(selectOpenTimelineIds)
  const { renamingTimelineId, renameValue, renameSource } = useEditorStore(selectTimelineRenameState, shallow)
  const subtitleTrackStyleIdx = useEditorStore(selectSubtitleTrackStyleIdx)
  const selectedSubtitleId = useEditorStore(selectSelectedSubtitleId)
  const editingSubtitleId = useEditorStore(selectEditingSubtitleId)
  const hasClipboard = useEditorStore(selectCanUseClipboard)

  const setClips = useCallback((value: React.SetStateAction<TimelineClip[]>) => {
    actions.setTimelineClips(value)
  }, [actions])

  const setTracks = useCallback((value: React.SetStateAction<Track[]>) => {
    actions.setTimelineTracks(value)
  }, [actions])

  const setSubtitles = useCallback((value: React.SetStateAction<SubtitleClip[]>) => {
    actions.setTimelineSubtitles(value)
  }, [actions])

  const setCurrentTime = useCallback((time: number) => {
    actions.setCurrentTime(time)
  }, [actions])

  const setIsPlaying = useCallback((playing: boolean) => {
    if (playing) actions.play()
    else actions.pause()
  }, [actions])

  const setZoom = useCallback((value: React.SetStateAction<number>) => {
    actions.setZoom(applyStateAction(value, zoom))
  }, [actions, zoom])

  const setSelectedClipIds = useCallback((value: React.SetStateAction<Set<string>>) => {
    actions.setSelectedClipIds(value)
  }, [actions])

  const setActiveTool = useCallback((tool: ToolType) => {
    actions.setActiveTool(tool)
  }, [actions])

  const setLastTrimTool = useCallback((tool: ToolType) => {
    actions.setLastTrimTool(tool)
  }, [actions])

  const setSnapEnabled = useCallback((enabled: boolean) => {
    actions.setSnapEnabled(enabled)
  }, [actions])

  const setShowPropertiesPanel = useCallback((value: React.SetStateAction<boolean>) => {
    actions.setShowPropertiesPanel(applyStateAction(value, showPropertiesPanel))
  }, [actions, showPropertiesPanel])

  const setRenameValue = useCallback((value: string) => {
    actions.setTimelineRenameValue(value)
  }, [actions])

  const setRenamingTimelineId = useCallback((id: string | null) => {
    if (id === null) {
      actions.cancelTimelineRename()
    }
  }, [actions])

  const handleAddTimeline = useCallback(() => {
    actions.createTimeline()
  }, [actions])

  const handleSwitchTimeline = useCallback((id: string) => {
    actions.switchActiveTimeline(id)
  }, [actions])

  const handleCloseTimelineTab = useCallback((id: string) => {
    actions.closeTimelineTab(id)
  }, [actions])

  const handleStartRename = useCallback((id: string, name: string, source: 'tab' | 'panel' = 'tab') => {
    actions.startTimelineRename(id, source)
    actions.setTimelineRenameValue(name)
  }, [actions])

  const handleFinishRename = useCallback(() => {
    actions.commitTimelineRename()
  }, [actions])

  const handleDeleteTimeline = useCallback((id: string) => {
    actions.deleteTimeline(id)
  }, [actions])

  const handleDuplicateTimeline = useCallback((id: string) => {
    actions.duplicateTimeline(id)
  }, [actions])

  const handleCopy = useCallback(() => {
    actions.copySelection()
  }, [actions])

  const handleCut = useCallback(() => {
    actions.cutSelection()
  }, [actions])

  const handlePaste = useCallback(() => {
    actions.pasteSelection()
  }, [actions])

  const addSubtitleTrack = useCallback(() => {
    actions.addSubtitleTrack()
  }, [actions])

  const createAdjustmentLayerAsset = useCallback(() => {
    actions.createAdjustmentLayerAsset()
  }, [actions])

  const addTextClip = useCallback((style?: Partial<TextOverlayStyle>, startTime?: number, trackIdx?: number) => {
    actions.addTextClip({ style, startTime, trackIndex: trackIdx })
  }, [actions])

  const duplicateClip = useCallback((clipId: string) => {
    actions.duplicateClips([clipId])
  }, [actions])

  const splitClipAtPlayhead = useCallback((clipId: string, atTime?: number, batchClipIds?: string[]) => {
    actions.splitClipsAtTime(batchClipIds ?? [clipId], atTime ?? currentTime)
  }, [actions, currentTime])

  const updateClip = useCallback((id: string, patch: Partial<TimelineClip>) => {
    actions.updateClip(id, patch)
  }, [actions])

  const updateAsset = useCallback((_projectId: string, assetId: string, updates: Partial<Asset>) => {
    actions.updateAsset(assetId, updates)
  }, [actions])

  const addClipToTimeline = useCallback((asset: Asset, trackIndex: number, startTime?: number) => {
    actions.insertAssetsToTimeline({ assets: [asset], trackIndex, startTime })
  }, [actions])

  const addAssetToEditor = useCallback((asset: Asset) => {
    actions.addAssetToEditor(asset)
  }, [actions])

  const resolveClipPath = useCallback((clip: TimelineClip | null) => {
    return clip ? selectClipPathFromAssets(assets, clip) : ''
  }, [assets])

  const getMaxClipDuration = useCallback((clip: TimelineClip) => {
    return selectClipMaxDurationFromAssets(assets, clip)
  }, [assets])

  const setSubtitleTrackStyleIdx = useCallback((idx: number | null) => {
    actions.setSubtitleTrackStyleEditorTrack(idx ?? undefined)
  }, [actions])

  const setSelectedSubtitleId = useCallback((id: string | null) => {
    if (id) actions.setSelectedSubtitle(id)
    else actions.clearSelectedSubtitle()
  }, [actions])

  const setEditingSubtitleId = useCallback((value: React.SetStateAction<string | null>) => {
    actions.setEditingSubtitleId(value)
  }, [actions])

  const updateSubtitle = useCallback((id: string, patch: Partial<SubtitleClip>) => {
    actions.updateSubtitle(id, patch)
  }, [actions])

  const getClipPath = useCallback((clip: TimelineClip) => {
    return selectClipPathFromAssets(assets, clip)
  }, [assets])

  const getClipResolution = useCallback((clip: TimelineClip) => {
    return selectClipResolutionFromAssets(assets, clip)
  }, [assets])

  const getLiveAsset = useCallback((clip: TimelineClip) => {
    return selectLiveAssetForClipFromAssets(assets, clip)
  }, [assets])

  const handleClipTakeChange = useCallback((clipId: string, direction: 'prev' | 'next') => {
    actions.stepClipTake(clipId, direction)
  }, [actions])

  const handleDeleteTake = useCallback((clipId: string) => {
    actions.deleteClipDisplayedTake(clipId)
  }, [actions])

  const [editingTimecode, setEditingTimecode] = useState(false)
  const [timecodeInput, setTimecodeInput] = useState('')
  const timecodeInputRef = useRef<HTMLInputElement>(null)

  const [showTrimFlyout, setShowTrimFlyout] = useState(false)
  const trimLongPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const trimFlyoutOpenedRef = useRef(false)

  const [timelineContextMenu, setTimelineContextMenu] = useState<TimelineMenuState>(null)
  const timelineContextMenuRef = useRef<HTMLDivElement>(null)
  const [clipContextMenu, setClipContextMenu] = useState<ClipContextMenuState | null>(null)
  const clipContextMenuRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const [bladeHoverInfo, setBladeHoverInfo] = useState<{ clipId: string; offsetX: number; time: number } | null>(null)
  const [hoveredCutPoint, setHoveredCutPoint] = useState<{
    leftClipId: string; rightClipId: string; time: number; trackIndex: number
  } | null>(null)
  // Which seam a transition chip is currently being dragged over (for the drop highlight).
  const [dragOverCut, setDragOverCut] = useState<{ leftClipId: string; rightClipId: string } | null>(null)

  const [videoTrackHeight, setVideoTrackHeight] = useState(56)
  const [audioTrackHeight, setAudioTrackHeight] = useState(56)
  const [subtitleTrackHeight, setSubtitleTrackHeight] = useState(40)
  const suppressGapClickRef = useRef(false)
  const [selectedGapAnchor, setSelectedGapAnchor] = useState<GapAnchor>(null)
  const [selectedGap, setSelectedGap] = useState<GapSelection>(null)
  const [gapGenerateMode, setGapGenerateMode] = useState<GapGenerateMode | null>(null)
  const [gapPrompt, setGapPrompt] = useState('')
  const [gapSettings, setGapSettings] = useState<GenerationSettings>({
    model: 'fast',
    duration: 5,
    videoResolution: '540p',
    fps: 24,
    audio: true,
    cameraMotion: 'none',
    imageResolution: '1080p',
    imageAspectRatio: '16:9',
    imageSteps: 30,
  })
  const [gapImageFile, setGapImageFile] = useState<File | null>(null)
  const gapImageInputRef = useRef<HTMLInputElement>(null)
  const [gapApplyAudioToTrack, setGapApplyAudioToTrack] = useState(true)
  const [generatingGap, setGeneratingGap] = useState<{
    trackIndex: number
    startTime: number
    endTime: number
    mode: GapGenerateMode
    prompt: string
    settings: GenerationSettings
    applyAudio: boolean
  } | null>(null)
  const [gapSuggesting, setGapSuggesting] = useState(false)
  const [gapSuggestion, setGapSuggestion] = useState<string | null>(null)
  const [gapSuggestionError, setGapSuggestionError] = useState(false)
  const [gapSuggestionNoApiKey, setGapSuggestionNoApiKey] = useState(false)
  const [gapBeforeFrame, setGapBeforeFrame] = useState<string | null>(null)
  const [gapAfterFrame, setGapAfterFrame] = useState<string | null>(null)
  const gapDuration = selectedGap ? selectedGap.endTime - selectedGap.startTime : null
  const gapVideoModelSpecs = getVideoGenerationModelSpecs(videoGenerationModelSpecsResponse, {
    useApiSpecs: shouldVideoGenerateWithLtxApi,
  })
  const gapResolvedVideoOptions = (
    gapGenerateMode === 'text-to-image'
    || gapDuration === null
    || gapVideoModelSpecs.length === 0
  )
    ? null
    : resolveVideoGenerationOptions({
        settings: gapSettings,
        modelSpecs: gapVideoModelSpecs,
        minimumDuration: gapDuration,
        durationSelection: 'smallest_valid',
      })
  const gapCanGenerateVideo = Boolean(
    gapResolvedVideoOptions
    && gapResolvedVideoOptions.hasCompatibleOptions
    && !isLoadingVideoGenerationModelSpecs
    && !videoGenerationModelSpecsErrorMessage
  )
  const gapVideoSettingsMessage = isLoadingVideoGenerationModelSpecs
    ? 'Loading generation settings...'
    : videoGenerationModelSpecsErrorMessage
      ? `Could not load generation settings: ${videoGenerationModelSpecsErrorMessage}`
      : gapGenerateMode !== 'text-to-image' && selectedGap && !gapCanGenerateVideo
        ? 'This gap is too long to fill with a single video generation.'
        : null

  const selectedGapRef = useRef<GapSelection>(selectedGap)
  selectedGapRef.current = selectedGap
  selectedGapRefBridge.current = selectedGap

  const gapGenerateModeRef = useRef<GapGenerateMode | null>(gapGenerateMode)
  gapGenerateModeRef.current = gapGenerateMode
  gapGenerateModeRefBridge.current = gapGenerateMode

  const closeGap = useCallback((gap: NonNullable<GapSelection>) => {
    const gapDuration = gap.endTime - gap.startTime

    setClips(prev => prev.map(clip => {
      if (clip.startTime >= gap.endTime) {
        return { ...clip, startTime: Math.max(0, clip.startTime - gapDuration) }
      }
      return clip
    }))
    setSubtitles(prev => prev.map(subtitle => {
      if (subtitle.startTime >= gap.endTime) {
        return {
          ...subtitle,
          startTime: Math.max(0, subtitle.startTime - gapDuration),
          endTime: Math.max(0.1, subtitle.endTime - gapDuration),
        }
        }
      return subtitle
    }))
  }, [setClips, setSubtitles])

  const deleteTrack = useCallback((idx: number) => {
    if (tracks.length <= 1) return
    setClips(prev => prev
      .filter(clip => clip.trackIndex !== idx)
      .map(clip => clip.trackIndex > idx ? { ...clip, trackIndex: clip.trackIndex - 1 } : clip)
    )
    setSubtitles(prev => prev
      .filter(subtitle => subtitle.trackIndex !== idx)
      .map(subtitle => subtitle.trackIndex > idx ? { ...subtitle, trackIndex: subtitle.trackIndex - 1 } : subtitle)
    )
    setTracks(tracks.filter((_, trackIndex) => trackIndex !== idx))
  }, [setClips, setSubtitles, setTracks, tracks])

  const addSubtitleClip = useCallback((trackIndex: number) => {
    const subtitle: SubtitleClip = {
      id: `sub-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      text: 'New subtitle',
      startTime: currentTime,
      endTime: currentTime + 3,
      trackIndex,
    }
    setSubtitles(prev => [...prev, subtitle])
    setSelectedSubtitleId(subtitle.id)
    setEditingSubtitleId(subtitle.id)
  }, [currentTime, setEditingSubtitleId, setSelectedSubtitleId, setSubtitles])

  const addCrossDissolve = useCallback((leftClipId: string, rightClipId: string) => {
    const leftClip = clips.find(clip => clip.id === leftClipId)
    const rightClip = clips.find(clip => clip.id === rightClipId)
    if (!leftClip || !rightClip) return

    // Audio seam → cross-dissolve is the left clip fading out into the right
    // clip fading in over the same window (reuses the per-clip audioFade fields;
    // sized afterwards with the clips' waveform fade handles).
    if (leftClip.type === 'audio') {
      const dur = +Math.min(DEFAULT_DISSOLVE_DURATION, leftClip.duration / 2, rightClip.duration / 2).toFixed(2)
      setClips(prev => prev.map(clip => {
        if (clip.id === leftClipId) return { ...clip, audioFadeOut: dur }
        if (clip.id === rightClipId) return { ...clip, audioFadeIn: dur }
        return clip
      }))
      return
    }

    setClips(prev => prev.map(clip => {
      if (clip.id === leftClipId) {
        return { ...clip, transitionOut: { type: 'dissolve' as const, duration: DEFAULT_DISSOLVE_DURATION } }
      }
      if (clip.id === rightClipId) {
        return { ...clip, transitionIn: { type: 'dissolve' as const, duration: DEFAULT_DISSOLVE_DURATION } }
      }
      return clip
    }))
  }, [clips, setClips])

  const removeCrossDissolve = useCallback((leftClipId: string, rightClipId: string) => {
    const leftClip = clips.find(clip => clip.id === leftClipId)
    if (leftClip?.type === 'audio') {
      setClips(prev => prev.map(clip => {
        if (clip.id === leftClipId) return { ...clip, audioFadeOut: 0 }
        if (clip.id === rightClipId) return { ...clip, audioFadeIn: 0 }
        return clip
      }))
      return
    }
    setClips(prev => prev.map(clip => {
      if (clip.id === leftClipId) {
        return { ...clip, transitionOut: { type: 'none' as const, duration: 0.5 } }
      }
      if (clip.id === rightClipId) {
        return { ...clip, transitionIn: { type: 'none' as const, duration: 0.5 } }
      }
      return clip
    }))
  }, [clips, setClips])

  // Apply a centered transition to the seam between two clips: the left clip's
  // transitionOut and the right clip's transitionIn both become `type` (a
  // dissolve becomes a cross-dissolve; a fade goes out-then-in through the seam;
  // a wipe wipes out-then-in). Existing durations are preserved. Used by the
  // drag-a-transition-onto-the-cut drop target.
  const applyJunctionTransition = useCallback((leftClipId: string, rightClipId: string, type: TransitionType) => {
    if (type === 'none') { removeCrossDissolve(leftClipId, rightClipId); return }
    // Audio seam: any dropped transition becomes an audio cross-dissolve.
    const leftClip = clips.find(clip => clip.id === leftClipId)
    if (leftClip?.type === 'audio') {
      const rightClip = clips.find(clip => clip.id === rightClipId)
      const dur = +Math.min(DEFAULT_DISSOLVE_DURATION, leftClip.duration / 2, (rightClip?.duration ?? Infinity) / 2).toFixed(2)
      setClips(prev => prev.map(clip => {
        if (clip.id === leftClipId) return { ...clip, audioFadeOut: clip.audioFadeOut || dur }
        if (clip.id === rightClipId) return { ...clip, audioFadeIn: clip.audioFadeIn || dur }
        return clip
      }))
      return
    }
    setClips(prev => prev.map(clip => {
      if (clip.id === leftClipId) {
        return { ...clip, transitionOut: { type, duration: clip.transitionOut?.duration || DEFAULT_DISSOLVE_DURATION } }
      }
      if (clip.id === rightClipId) {
        return { ...clip, transitionIn: { type, duration: clip.transitionIn?.duration || DEFAULT_DISSOLVE_DURATION } }
      }
      return clip
    }))
  }, [clips, setClips, removeCrossDissolve])

  // The seam fade last placed or sized, so it can be stamped onto other cuts
  // without redoing it by hand. `audio` seams are crossfades, the rest are video
  // transitions.
  const [lastSeam, setLastSeam] = useState<{ audio: boolean; type: TransitionType; duration: number } | null>(null)

  // Put one fade spec on a set of seams. A clip can be the left side of one seam
  // and the right side of the next, so the changes are merged per clip first.
  const applySeamSpec = useCallback((
    targets: { leftClip: TimelineClip; rightClip: TimelineClip }[],
    spec: { audio: boolean; type: TransitionType; duration: number },
  ) => {
    if (targets.length === 0) return
    const patches = new Map<string, Partial<TimelineClip>>()
    for (const t of targets) {
      const dur = +Math.max(0.1, Math.min(spec.duration, Math.min(t.leftClip.duration, t.rightClip.duration) / 2)).toFixed(2)
      if (spec.audio) {
        patches.set(t.leftClip.id, { ...patches.get(t.leftClip.id), audioFadeOut: dur })
        patches.set(t.rightClip.id, { ...patches.get(t.rightClip.id), audioFadeIn: dur })
      } else {
        patches.set(t.leftClip.id, { ...patches.get(t.leftClip.id), transitionOut: { type: spec.type, duration: dur } })
        patches.set(t.rightClip.id, { ...patches.get(t.rightClip.id), transitionIn: { type: spec.type, duration: dur } })
      }
    }
    setClips(prev => prev.map(c => (patches.has(c.id) ? { ...c, ...patches.get(c.id) } : c)))
  }, [setClips])

  // Copy a clip's fades onto every later clip on the same track: fade in/out on
  // audio, and the in/out transitions (dissolve, fade from/to black) on picture.
  // A video clip's linked audio is carried along on its own track.
  const copyFadesForward = useCallback((clipId: string) => {
    const source = clips.find(c => c.id === clipId)
    if (!source) return
    const sources = [source, ...(source.linkedClipIds ?? []).map(id => clips.find(c => c.id === id)).filter((c): c is TimelineClip => !!c)]
    const patches = new Map<string, Partial<TimelineClip>>()
    for (const src of sources) {
      const patch: Partial<TimelineClip> = {}
      if (src.type === 'audio') {
        if ((src.audioFadeIn ?? 0) > 0) patch.audioFadeIn = src.audioFadeIn
        if ((src.audioFadeOut ?? 0) > 0) patch.audioFadeOut = src.audioFadeOut
      } else {
        if (src.transitionIn && src.transitionIn.type !== 'none') patch.transitionIn = src.transitionIn
        if (src.transitionOut && src.transitionOut.type !== 'none') patch.transitionOut = src.transitionOut
      }
      if (Object.keys(patch).length === 0) continue
      for (const c of clips) {
        if (c.id === src.id || c.trackIndex !== src.trackIndex || c.startTime <= src.startTime) continue
        if ((c.type === 'audio') !== (src.type === 'audio')) continue
        const half = c.duration / 2
        const next: Partial<TimelineClip> = { ...patch }
        if (next.audioFadeIn !== undefined) next.audioFadeIn = +Math.min(next.audioFadeIn, half).toFixed(2)
        if (next.audioFadeOut !== undefined) next.audioFadeOut = +Math.min(next.audioFadeOut, half).toFixed(2)
        if (next.transitionIn) next.transitionIn = { ...next.transitionIn, duration: +Math.min(next.transitionIn.duration, half).toFixed(2) }
        if (next.transitionOut) next.transitionOut = { ...next.transitionOut, duration: +Math.min(next.transitionOut.duration, half).toFixed(2) }
        patches.set(c.id, { ...patches.get(c.id), ...next })
      }
    }
    if (patches.size === 0) return
    setClips(prev => prev.map(c => (patches.has(c.id) ? { ...c, ...patches.get(c.id) } : c)))
  }, [clips, setClips])

  const removeClip = useCallback((clipId: string) => {
    const clip = clips.find(candidate => candidate.id === clipId)
    if (clip && tracks[clip.trackIndex]?.locked) return

    const removeIds = new Set([clipId])
    clip?.linkedClipIds?.forEach(linkedId => removeIds.add(linkedId))
    setClips(clips.filter(candidate => !removeIds.has(candidate.id)))
    setSelectedClipIds(prev => {
      const next = new Set(prev)
      removeIds.forEach(id => next.delete(id))
      return next
    })
  }, [clips, setClips, setSelectedClipIds, tracks])

  const clearSelectedGap = useCallback(() => {
    setGapGenerateMode(null)
    setSelectedGap(null)
    setSelectedGapAnchor(null)
  }, [])
  clearSelectedGapRefBridge.current = clearSelectedGap

  const selectGap = useCallback((gap: NonNullable<GapSelection>, target: HTMLElement) => {
    setSelectedGap(gap)
    setSelectedClipIds(new Set())
    setSelectedSubtitleId(null)
    setGapGenerateMode(null)
    const rect = target.getBoundingClientRect()
    setSelectedGapAnchor({ x: rect.left + rect.width / 2, gapTop: rect.top, gapBottom: rect.bottom })
  }, [setSelectedClipIds, setSelectedSubtitleId])

  const closeSelectedGap = useCallback(() => {
    const gap = selectedGapRef.current
    if (!gap) return
    clearSelectedGap()
    closeGap(gap)
  }, [clearSelectedGap, closeGap])
  closeSelectedGapRefBridge.current = closeSelectedGap

  useEffect(() => {
    if (gapGenerateMode === 'text-to-image' && gapImageFile) {
      setGapImageFile(null)
    }
  }, [gapGenerateMode, gapImageFile])

  useEffect(() => {
    if (!selectedGap) {
      setSelectedGapAnchor(null)
    }
  }, [selectedGap])

  useEffect(() => {
    if (gapGenerateMode === 'text-to-image' || gapDuration === null || gapVideoModelSpecs.length === 0) return
    setGapSettings((prev) => {
      const next = sanitizeVideoGenerationSettings(prev, gapVideoModelSpecs, {
        minimumDuration: gapDuration,
        durationSelection: 'smallest_valid',
      })
      if (!next || areVideoGenerationSettingsEquivalent(prev, next)) {
        return prev
      }
      return next
    })
  }, [gapDuration, gapGenerateMode, gapVideoModelSpecs])

  const timelineGaps = useMemo(() => {
    const gaps: Array<{ trackIndex: number; startTime: number; endTime: number }> = []

    tracks.forEach((track, trackIdx) => {
      if (track.type === 'subtitle') return

      const trackClips = clips
        .filter(c => c.trackIndex === trackIdx)
        .sort((a, b) => a.startTime - b.startTime)

      if (trackClips.length === 0) return

      if (trackClips[0].startTime > 0.05) {
        gaps.push({ trackIndex: trackIdx, startTime: 0, endTime: trackClips[0].startTime })
      }

      for (let i = 0; i < trackClips.length - 1; i++) {
        const endOfCurrent = trackClips[i].startTime + trackClips[i].duration
        const startOfNext = trackClips[i + 1].startTime
        if (startOfNext - endOfCurrent > 0.05) {
          gaps.push({ trackIndex: trackIdx, startTime: endOfCurrent, endTime: startOfNext })
        }
      }
    })

    return gaps
  }, [clips, tracks])

  const gapSuggestionAbortRef = useRef<AbortController | null>(null)
  const gapPromptRef = useRef(gapPrompt)
  gapPromptRef.current = gapPrompt
  const gapImageFileRef = useRef<File | null>(gapImageFile)
  gapImageFileRef.current = gapImageFile

  const runSuggestion = useCallback(async (forceReplace: boolean = false) => {
    const gap = selectedGapRef.current
    const mode = gapGenerateModeRef.current
    if (!gap || !mode) return

    gapSuggestionAbortRef.current?.abort()
    const abortController = new AbortController()
    gapSuggestionAbortRef.current = abortController

    try {
      setGapSuggesting(true)
      setGapSuggestion(null)
      setGapSuggestionError(false)
      setGapSuggestionNoApiKey(false)

      const trackClips = clips
        .filter(c => c.trackIndex === gap.trackIndex && c.type !== 'audio')
        .sort((a, b) => a.startTime - b.startTime)

      const clipBefore = trackClips.find(c => {
        const clipEnd = c.startTime + c.duration
        return Math.abs(clipEnd - gap.startTime) < 0.05
      })

      const clipAfter = trackClips.find(c => Math.abs(c.startTime - gap.endTime) < 0.05)

      if (!clipBefore && !clipAfter) {
        setGapSuggesting(false)
        return
      }

      let beforeFrame = ''
      let afterFrame = ''
      let beforePrompt = ''
      let afterPrompt = ''
      let beforeFramePath = ''
      let afterFramePath = ''

      const framePromises: Promise<void>[] = []

      if (clipBefore) {
        const clipPath = resolveClipPath(clipBefore)
        beforePrompt = clipBefore.asset?.prompt || ''
        if (clipPath) {
          if (clipBefore.asset?.type === 'video') {
            const seekTime = clipBefore.trimStart + clipBefore.duration * clipBefore.speed - 0.1
            framePromises.push(
              window.electronAPI.extractVideoFrame({ videoPath: clipPath, seekTime: Math.max(0, seekTime), width: 512, quality: 3 })
                .then(result => { beforeFrame = result.path; beforeFramePath = result.path })
                .catch(() => {})
            )
          } else if (clipBefore.asset?.type === 'image') {
            beforeFrame = clipPath
            beforeFramePath = clipPath
          }
        }
      }

      if (clipAfter) {
        const clipPath = resolveClipPath(clipAfter)
        afterPrompt = clipAfter.asset?.prompt || ''
        if (clipPath) {
          if (clipAfter.asset?.type === 'video') {
            framePromises.push(
              window.electronAPI.extractVideoFrame({ videoPath: clipPath, seekTime: clipAfter.trimStart + 0.1, width: 512, quality: 3 })
                .then(result => { afterFrame = result.path; afterFramePath = result.path })
                .catch(() => {})
            )
          } else if (clipAfter.asset?.type === 'image') {
            afterFrame = clipPath
            afterFramePath = clipPath
          }
        }
      }

      await Promise.all(framePromises)

      if (abortController.signal.aborted) return

      if (beforeFramePath) setGapBeforeFrame(beforeFramePath)
      if (afterFramePath) setGapAfterFrame(afterFramePath)

      if (!beforeFrame && !afterFrame && !beforePrompt && !afterPrompt) {
        setGapSuggesting(false)
        return
      }

      let inputImagePath = ''
      const imageFile = gapImageFileRef.current
      if (imageFile && mode === 'image-to-video') {
        const electronPath = (imageFile as { path?: string }).path
        if (electronPath) {
          inputImagePath = electronPath
        }
      }

      const result = await ApiClient.suggestGapPrompt({
        gapDuration: gap.endTime - gap.startTime,
        mode,
        beforePrompt,
        afterPrompt,
        beforeFrame,
        afterFrame,
        ...(inputImagePath ? { inputImage: inputImagePath } : {}),
      }, {
        signal: abortController.signal,
      })
      if (!result.ok) {
        const isApiKeyError = result.status === 401 || result.status === 403
          || JSON.stringify(result.error).toLowerCase().includes('api_key')
          || JSON.stringify(result.error).toLowerCase().includes('gemini')
          || JSON.stringify(result.error).toLowerCase().includes('no api key')
          || JSON.stringify(result.error).toLowerCase().includes('api key')
        if (isApiKeyError) {
          setGapSuggestionNoApiKey(true)
        } else {
          console.warn('Gap prompt suggestion failed:', result.error.message)
          setGapSuggestionError(true)
        }
        return
      }

      if (abortController.signal.aborted) return

      const data = result.data
      if (data.suggested_prompt) {
        setGapSuggestion(data.suggested_prompt)
        if (forceReplace || !gapPromptRef.current.trim()) {
          setGapPrompt(data.suggested_prompt)
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      console.warn('Gap prompt suggestion failed:', err)
      setGapSuggestionError(true)
    } finally {
      if (!abortController.signal.aborted) {
        setGapSuggesting(false)
      }
    }
  }, [clips, resolveClipPath])

  const suggestionFiredKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!selectedGap || !gapGenerateMode) {
      setGapSuggesting(false)
      setGapSuggestion(null)
      setGapSuggestionError(false)
      setGapSuggestionNoApiKey(false)
      setGapBeforeFrame(null)
      setGapAfterFrame(null)
      gapSuggestionAbortRef.current?.abort()
      suggestionFiredKeyRef.current = null
      return
    }

    const key = `${selectedGap.trackIndex}:${selectedGap.startTime}:${selectedGap.endTime}:${gapGenerateMode}`
    if (suggestionFiredKeyRef.current === key) return
    suggestionFiredKeyRef.current = key

    runSuggestion(false)

    return () => { gapSuggestionAbortRef.current?.abort() }
  }, [selectedGap, gapGenerateMode, runSuggestion])

  const prevImageFileRef = useRef<File | null>(null)
  useEffect(() => {
    const prev = prevImageFileRef.current
    prevImageFileRef.current = gapImageFile

    if (prev === gapImageFile) return
    if (gapGenerateMode !== 'image-to-video') return
    if (!selectedGap) return

    runSuggestion(true)
  }, [gapImageFile, gapGenerateMode, selectedGap, runSuggestion])

  useEffect(() => () => {
    gapSuggestionAbortRef.current?.abort()
  }, [])

  const regenerateSuggestion = useCallback(() => {
    runSuggestion(true)
  }, [runSuggestion])

  const handleGapGenerate = useCallback(async () => {
    if (!selectedGap || !gapGenerateMode || !gapPrompt.trim() || !currentProjectId) return

    const gap = selectedGap
    const mode = gapGenerateMode
    const finalPrompt = gapPrompt.trim()
    const settings = mode === 'text-to-image'
      ? gapSettings
      : sanitizeVideoGenerationSettings(gapSettings, gapVideoModelSpecs, {
          minimumDuration: gap.endTime - gap.startTime,
          durationSelection: 'smallest_valid',
        })
    if (!settings) return

    setGeneratingGap({
      trackIndex: gap.trackIndex,
      startTime: gap.startTime,
      endTime: gap.endTime,
      mode,
      prompt: finalPrompt,
      settings,
      applyAudio: gapApplyAudioToTrack,
    })

    clearSelectedGap()

    try {
      if (mode === 'text-to-image') {
        await gapGenerationApi.generateImage(finalPrompt, settings)
      } else {
        let imagePath: string | null = null
        if (gapImageFile) {
          const electronPath = (gapImageFile as { path?: string }).path
          if (electronPath) {
            imagePath = electronPath
          } else {
            const buf = await gapImageFile.arrayBuffer()
            const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
            const modelsPath = await window.electronAPI.getModelsPath()
            const tmpDir = modelsPath.replace(/[/\\]models$/, '')
            const tmpPath = `${tmpDir}/tmp_gap_image_${Date.now()}.png`
            await window.electronAPI.saveFile({ filePath: tmpPath, data: b64, encoding: 'base64' })
            imagePath = tmpPath
          }
        }
        await gapGenerationApi.generate(finalPrompt, imagePath, settings)
      }
    } catch (err) {
      console.error('Gap generation failed:', err)
      setGeneratingGap(null)
    }
  }, [
    clearSelectedGap,
    currentProjectId,
    gapApplyAudioToTrack,
    gapGenerateMode,
    gapGenerationApi,
    gapImageFile,
    gapPrompt,
    gapSettings,
    gapVideoModelSpecs,
    selectedGap,
  ])

  useEffect(() => {
    if (!generatingGap || gapGenerationApi.isGenerating) return

    const isImageResult = generatingGap.mode === 'text-to-image'
    const sourcePath = isImageResult ? gapGenerationApi.imagePath : gapGenerationApi.videoPath
    if (!sourcePath || !currentProjectId) {
      if (!gapGenerationApi.isGenerating && generatingGap) {
        setGeneratingGap(null)
        if (!gapGenerationApi.error) gapGenerationApi.reset()
      }
      return
    }

    void (async () => {
      const gap = {
        trackIndex: generatingGap.trackIndex,
        startTime: generatingGap.startTime,
        endTime: generatingGap.endTime,
      }
      const assetType = isImageResult ? 'image' : 'video'
      const copied = await addVisualAssetToProject(sourcePath, currentProjectId, assetType)
      if (copied) {
        const asset: Asset = {
          id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
          type: assetType,
          path: copied.path,
          bigThumbnailPath: copied.bigThumbnailPath,
          smallThumbnailPath: copied.smallThumbnailPath,
          width: copied.width,
          height: copied.height,
          prompt: generatingGap.prompt,
          resolution: isImageResult ? generatingGap.settings.imageResolution : generatingGap.settings.videoResolution,
          duration: assetType === 'video' ? generatingGap.settings.duration ?? undefined : undefined,
          generationParams: {
            mode: generatingGap.mode,
            prompt: generatingGap.prompt,
            model: generatingGap.settings.model,
            duration: generatingGap.settings.duration,
            resolution: isImageResult ? generatingGap.settings.imageResolution : generatingGap.settings.videoResolution,
            fps: generatingGap.settings.fps,
            audio: generatingGap.settings.audio,
            cameraMotion: generatingGap.settings.cameraMotion,
            imageAspectRatio: generatingGap.settings.imageAspectRatio,
            imageSteps: generatingGap.settings.imageSteps,
          },
          takes: [{
            path: copied.path,
            bigThumbnailPath: copied.bigThumbnailPath,
            smallThumbnailPath: copied.smallThumbnailPath,
            width: copied.width,
            height: copied.height,
            createdAt: Date.now(),
          }],
          activeTakeIndex: 0,
          createdAt: Date.now(),
        }
        actions.insertGeneratedGapAsset({
          gap,
          asset,
          createAudio: assetType === 'video' && generatingGap.applyAudio && generatingGap.settings.audio,
        })
      }

      setGeneratingGap(null)
      setGapPrompt('')
      setGapImageFile(null)
      gapGenerationApi.reset()
    })()
  }, [actions, currentProjectId, gapGenerationApi, generatingGap])

  const cancelGapGeneration = useCallback(() => {
    if (!gapGenerationApi.canCancel) return
    gapGenerationApi.cancel()
    // Keep gap UI until the generate POST returns cancelled so liveness
    // suppression stays up while the GPU job unwinds.
  }, [gapGenerationApi])

  const handleCloseGap = useCallback(() => {
    closeSelectedGap()
  }, [closeSelectedGap])

  const timelineRef = useRef<HTMLDivElement>(null)
  const trackContainerRef = useRef<HTMLDivElement>(null)
  // Claude's edits drop in one at a time; keep the clip being revealed in view.
  const mcpReveal = useMcpReveal()
  useEffect(() => {
    const container = trackContainerRef.current
    const id = mcpReveal.focus.values().next().value
    const el = id && container?.querySelector<HTMLElement>(`[data-clip-id="${CSS.escape(id)}"]`)
    if (!container || !el) return
    const left = el.offsetLeft, right = left + el.offsetWidth
    if (left < container.scrollLeft || right > container.scrollLeft + container.clientWidth) {
      container.scrollTo({ left: Math.max(0, left - container.clientWidth * 0.25), behavior: 'smooth' })
    }
  }, [mcpReveal.focus])
  const trackHeadersRef = useRef<HTMLDivElement>(null)
  const rulerScrollRef = useRef<HTMLDivElement>(null)
  const playheadRulerRef = useRef<HTMLDivElement>(null)
  const playheadOverlayRef = useRef<HTMLDivElement>(null)
  const timelineTimecodeRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (timelineRefBridge) timelineRefBridge.current = timelineRef.current
    if (trackContainerRefBridge) trackContainerRefBridge.current = trackContainerRef.current
    if (trackHeadersRefBridge) trackHeadersRefBridge.current = trackHeadersRef.current
    if (rulerScrollRefBridge) rulerScrollRefBridge.current = rulerScrollRef.current
  })

  const DIVIDER_H = 8

  const orderedTracks: { track: Track; realIndex: number; displayRow: number }[] = useMemo(() => {
    const videoTracks: { track: Track; realIndex: number }[] = []
    const audioTracks: { track: Track; realIndex: number }[] = []
    const subtitleTracks: { track: Track; realIndex: number }[] = []

    tracks.forEach((track: Track, i: number) => {
      if (track.type === 'subtitle') subtitleTracks.push({ track, realIndex: i })
      else if (track.kind === 'audio') audioTracks.push({ track, realIndex: i })
      else videoTracks.push({ track, realIndex: i })
    })

    videoTracks.reverse()
    const ordered = [...subtitleTracks, ...videoTracks, ...audioTracks]
    return ordered.map((entry, displayRow) => ({ ...entry, displayRow }))
  }, [tracks])

  const trackDisplayRow = useMemo(() => {
    const map = new Map<number, number>()
    orderedTracks.forEach(entry => map.set(entry.realIndex, entry.displayRow))
    return map
  }, [orderedTracks])

  const audioDividerDisplayRow = useMemo(() => {
    const firstAudio = orderedTracks.find(e => e.track.kind === 'audio')
    return firstAudio?.displayRow ?? -1
  }, [orderedTracks])

  const getTrackHeight = useCallback((trackIndex: number): number => {
    const track = tracks[trackIndex]
    if (!track) return videoTrackHeight
    if (track.type === 'subtitle') return subtitleTrackHeight
    return track.kind === 'audio' ? audioTrackHeight : videoTrackHeight
  }, [tracks, videoTrackHeight, audioTrackHeight, subtitleTrackHeight])

  const trackTopPx = useCallback((realTrackIndex: number, padding = 0): number => {
    const displayRow = trackDisplayRow.get(realTrackIndex) ?? realTrackIndex
    let top = 0
    for (let r = 0; r < displayRow; r++) {
      const entry = orderedTracks[r]
      if (entry) {
        top += entry.track.type === 'subtitle' ? subtitleTrackHeight : entry.track.kind === 'audio' ? audioTrackHeight : videoTrackHeight
      }
    }
    if (audioDividerDisplayRow >= 0 && displayRow >= audioDividerDisplayRow) top += DIVIDER_H
    return top + padding
  }, [trackDisplayRow, audioDividerDisplayRow, orderedTracks, videoTrackHeight, audioTrackHeight, subtitleTrackHeight])

  const cutPoints = useMemo(() => {
    const points: { leftClip: TimelineClip; rightClip: TimelineClip; time: number; trackIndex: number; hasDissolve: boolean; hasTransition: boolean; transitionType: TransitionType; isAudio: boolean }[] = []
    const byTrack: Map<number, TimelineClip[]> = new Map()
    for (const clip of clips) {
      if (!byTrack.has(clip.trackIndex)) byTrack.set(clip.trackIndex, [])
      byTrack.get(clip.trackIndex)!.push(clip)
    }
    for (const [trackIdx, trackClips] of byTrack) {
      const sorted = [...trackClips].sort((a, b) => a.startTime - b.startTime)
      for (let i = 0; i < sorted.length - 1; i++) {
        const left = sorted[i]
        const right = sorted[i + 1]
        const leftEnd = left.startTime + left.duration
        if (Math.abs(leftEnd - right.startTime) < CUT_POINT_TOLERANCE) {
          if (left.type === 'audio') {
            // Audio seam: the "transition" is a cross-dissolve, present when the
            // left clip fades out and the right clip fades in across the cut.
            const hasXfade = (left.audioFadeOut ?? 0) > 0 && (right.audioFadeIn ?? 0) > 0
            points.push({ leftClip: left, rightClip: right, time: leftEnd, trackIndex: trackIdx, hasDissolve: false, hasTransition: hasXfade, transitionType: 'none', isAudio: true })
            continue
          }
          const leftOut = left.transitionOut?.type
          const rightIn = right.transitionIn?.type
          const transitionType: TransitionType =
            (leftOut && leftOut !== 'none') ? leftOut
              : (rightIn && rightIn !== 'none') ? rightIn
                : 'none'
          const hasDissolve = transitionType === 'dissolve'
          const hasTransition = transitionType !== 'none'
          points.push({ leftClip: left, rightClip: right, time: leftEnd, trackIndex: trackIdx, hasDissolve, hasTransition, transitionType, isAudio: false })
        }
      }
    }
    return points
  }, [clips])

  // Room past the last clip to scroll into and drop onto. The playhead can be
  // scrubbed anywhere inside it, not just up to the last clip.
  const timelineExtent = totalDuration + Math.max(30, totalDuration * 0.25)

  const {
    draggingClip,
    resizingClip,
    slipSlideClip,
    lassoRect, setLassoRect,
    handleRulerMouseDown,
    expandWithLinkedClips,
    handleClipMouseDown,
    handleResizeStart,
    handleTrackDrop,
    lassoOriginRef,
  } = useTimelineDrag({
    activeTool, setActiveTool, lastTrimTool, setLastTrimTool,
    pixelsPerSecond, totalDuration: timelineExtent,
    clips, setClips, tracks,
    selectedClipIds, setSelectedClipIds,
    currentTime, setCurrentTime, setIsPlaying,
    snapEnabled, resolveClipPath, getMaxClipDuration, addClipToTimeline, addAssetToEditor,
    assets, timelines, activeTimeline, currentProjectId,
    timelineRef, trackContainerRef,
    orderedTracks, getTrackHeight, trackTopPx, cutPoints,
    splitClipAtPlayhead, setSelectedSubtitleId, setSelectedGap,
    audioTrackHeight, videoTrackHeight, subtitleTrackHeight,
  })

  // Clip virtualization: only clips near the viewport are mounted. Anything being
  // interacted with (selected, dragged, trimmed, revealed by Claude) stays mounted
  // wherever it is, so drags and edits never lose their DOM node.
  const visibleWindow = useVisibleTimeWindow(trackContainerRef, pixelsPerSecond)
  const visibleClips = useMemo(() => {
    const pinned = new Set<string>(selectedClipIds)
    if (draggingClip?.clipId) pinned.add(draggingClip.clipId)
    if (resizingClip?.clipId) pinned.add(resizingClip.clipId)
    if (slipSlideClip?.clipId) pinned.add(slipSlideClip.clipId)
    for (const id of mcpReveal.focus) pinned.add(id)
    return clips.filter(c =>
      pinned.has(c.id) || (c.startTime < visibleWindow.to && c.startTime + c.duration > visibleWindow.from))
  }, [clips, selectedClipIds, draggingClip, resizingClip, slipSlideClip, mcpReveal.focus, visibleWindow])

  const startSelectionLasso = useCallback((clientX: number, clientY: number, shiftKey: boolean) => {
    setSelectedSubtitleId(null)
    setEditingSubtitleId(null)
    clearSelectedGap()
    if (!shiftKey) {
      setSelectedClipIds(new Set())
    }
    const container = trackContainerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    lassoOriginRef.current = {
      scrollLeft: container.scrollLeft,
      containerLeft: rect.left,
      containerTop: rect.top,
    }
    setLassoRect({
      startX: clientX,
      startY: clientY,
      currentX: clientX,
      currentY: clientY,
    })
  }, [clearSelectedGap, lassoOriginRef, setEditingSubtitleId, setLassoRect, setSelectedClipIds, setSelectedSubtitleId])

  const handleClipContextMenu = (e: React.MouseEvent, clip: TimelineClip) => {
    e.preventDefault()
    e.stopPropagation()
    if (!selectedClipIds.has(clip.id)) {
      setSelectedClipIds(expandWithLinkedClips(new Set([clip.id])))
    }
    setClipContextMenu({ kind: 'clip', clipId: clip.id, x: e.clientX, y: e.clientY })
  }

  const handleTimelineBgContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const scrollLeft = (e.currentTarget as HTMLElement).scrollLeft || 0
    const clickX = e.clientX - rect.left + scrollLeft
    const clickTime = Math.max(0, clickX / pixelsPerSecond)
    setCurrentTime(clickTime)
    setClipContextMenu({ kind: 'background', x: e.clientX, y: e.clientY })
  }

  useEffect(() => {
    if (!timelineContextMenu) return
    const handler = () => setTimelineContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [timelineContextMenu])

  useEffect(() => {
    if (!timelineContextMenu || !timelineContextMenuRef.current) return
    const el = timelineContextMenuRef.current
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let { x, y } = timelineContextMenu
    let adjusted = false

    if (rect.right > vw - 8) { x = vw - rect.width - 8; adjusted = true }
    if (rect.bottom > vh - 8) { y = vh - rect.height - 8; adjusted = true }
    if (x < 8) { x = 8; adjusted = true }
    if (y < 8) { y = 8; adjusted = true }

    if (adjusted) {
      el.style.left = `${x}px`
      el.style.top = `${y}px`
    }
  }, [timelineContextMenu])

  useEffect(() => {
    if (!clipContextMenu) return
    const handler = () => setClipContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [clipContextMenu])

  useEffect(() => {
    if (!clipContextMenu || !clipContextMenuRef.current) return
    const el = clipContextMenuRef.current
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let { x, y } = clipContextMenu
    let adjusted = false

    if (rect.right > vw - 8) { x = vw - rect.width - 8; adjusted = true }
    if (rect.bottom > vh - 8) { y = vh - rect.height - 8; adjusted = true }
    if (x < 8) { x = 8; adjusted = true }
    if (y < 8) { y = 8; adjusted = true }

    if (adjusted) {
      el.style.left = `${x}px`
      el.style.top = `${y}px`
    }
  }, [clipContextMenu])

  const contextClip = clipContextMenu?.kind === 'clip'
    ? clips.find(clip => clip.id === clipContextMenu.clipId) ?? null
    : null

  const handleTimelineTabContextMenu = (e: React.MouseEvent, timelineId: string) => {
    e.preventDefault()
    if (onTimelinePanelContextMenu) {
      onTimelinePanelContextMenu(e, timelineId)
    }
    setTimelineContextMenu({ timelineId, x: e.clientX, y: e.clientY })
  }

  useEffect(() => {
    const onExternalOpen = (event: Event) => {
      const custom = event as CustomEvent<{ timelineId: string; x: number; y: number }>
      if (!custom.detail) return
      setTimelineContextMenu({
        timelineId: custom.detail.timelineId,
        x: custom.detail.x,
        y: custom.detail.y,
      })
    }
    window.addEventListener('video-editor:open-timeline-menu', onExternalOpen as EventListener)
    return () => {
      window.removeEventListener('video-editor:open-timeline-menu', onExternalOpen as EventListener)
    }
  }, [])

  const syncPlayheadPosition = useCallback((time: number) => {
    const container = trackContainerRef.current
    const scrollLeft = container?.scrollLeft || 0
    const leftPx = time * pixelsPerSecond

    if (playheadRulerRef.current) {
      playheadRulerRef.current.style.left = `${leftPx}px`
    }
    if (playheadOverlayRef.current) {
      playheadOverlayRef.current.style.left = `${leftPx - scrollLeft}px`
    }
  }, [pixelsPerSecond])

  const syncTimelineTimecode = useCallback((time: number) => {
    if (editingTimecode) return
    const el = timelineTimecodeRef.current
    if (!el) return
    const nextText = formatTime(time)
    if (el.textContent !== nextText) {
      el.textContent = nextText
    }
  }, [editingTimecode])

  const syncTimelineScrollMirrors = useCallback(() => {
    const container = trackContainerRef.current
    if (!container) return

    if (trackHeadersRef.current) {
      trackHeadersRef.current.scrollTop = container.scrollTop
    }
    if (rulerScrollRef.current) {
      rulerScrollRef.current.scrollLeft = container.scrollLeft
    }
  }, [])

  const maybeAutoScrollToPlayhead = useCallback((time: number) => {
    const container = trackContainerRef.current
    if (!container) return

    const playheadX = time * pixelsPerSecond
    const { scrollLeft, clientWidth } = container
    const margin = 80
    let nextScrollLeft = scrollLeft

    if (playheadX > scrollLeft + clientWidth - margin) {
      nextScrollLeft = playheadX - clientWidth + margin
    } else if (playheadX < scrollLeft + margin) {
      nextScrollLeft = Math.max(0, playheadX - margin)
    }

    if (nextScrollLeft !== scrollLeft) {
      container.scrollLeft = nextScrollLeft
      if (rulerScrollRef.current) {
        rulerScrollRef.current.scrollLeft = nextScrollLeft
      }
    }
  }, [pixelsPerSecond])

  const handleTimelineScroll = useCallback(() => {
    syncTimelineScrollMirrors()
    syncPlayheadPosition(isPlaying ? playbackTimeRef.current : currentTime)
  }, [currentTime, isPlaying, playbackTimeRef, syncPlayheadPosition, syncTimelineScrollMirrors])

  const handleFitToView = useCallback(() => {
    const container = trackContainerRef.current
    if (!container || totalDuration <= 0) return
    const containerWidth = container.clientWidth - 20
    const idealZoom = containerWidth / (totalDuration * 100)
    setZoom(clampZoom(idealZoom, getMinZoom()))
    // The timeline runs past the last clip, so a fit can still be scrolled partway
    // along; bring it back to the start once the new width has been laid out.
    requestAnimationFrame(() => {
      container.scrollLeft = 0
      if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = 0
    })
  }, [totalDuration, setZoom, getMinZoom])

  useEffect(() => {
    if (!isPlaying) return

    let animFrameId = 0
    const tick = () => {
      const playheadTime = playbackTimeRef.current
      maybeAutoScrollToPlayhead(playheadTime)
      syncPlayheadPosition(playheadTime)
      syncTimelineTimecode(playheadTime)
      animFrameId = requestAnimationFrame(tick)
    }

    animFrameId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(animFrameId)
    }
  }, [isPlaying, maybeAutoScrollToPlayhead, playbackTimeRef, syncPlayheadPosition, syncTimelineTimecode])

  useEffect(() => {
    if (isPlaying) return
    syncPlayheadPosition(currentTime)
    syncTimelineTimecode(currentTime)
  }, [currentTime, isPlaying, syncPlayheadPosition, syncTimelineTimecode])

  useEffect(() => {
    if (!centerOnPlayheadRef.current) return
    centerOnPlayheadRef.current = false

    const container = trackContainerRef.current
    if (!container) return

    const playheadTime = isPlaying ? playbackTimeRef.current : currentTime
    const playheadX = playheadTime * pixelsPerSecond
    const centerScroll = playheadX - container.clientWidth / 2
    container.scrollLeft = Math.max(0, centerScroll)
    if (rulerScrollRef.current) {
      rulerScrollRef.current.scrollLeft = container.scrollLeft
    }
    syncPlayheadPosition(playheadTime)
    syncTimelineTimecode(playheadTime)
  }, [centerOnPlayheadRef, currentTime, isPlaying, pixelsPerSecond, playbackTimeRef, syncPlayheadPosition, syncTimelineTimecode])

  useEffect(() => {
    syncTimelineTimecode(currentTime)
  }, [currentTime, syncTimelineTimecode])

  useEffect(() => {
    const container = trackContainerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        centerOnPlayheadRef.current = true
        const direction = e.deltaY > 0 ? -1 : 1
        setZoom((prev: number) => stepZoom(prev, direction, getMinZoom(), 1.15))
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [setZoom, centerOnPlayheadRef, getMinZoom])

  useEffect(() => {
    fitToViewRef.current = handleFitToView
  }, [fitToViewRef, handleFitToView])

  // Jumps of the playhead (Go to End, next edit, a typed timecode) bring it into
  // view; without this the playhead moves off-screen when zoomed in. Playback has
  // its own follow, and a playhead already in view is left alone.
  useEffect(() => {
    if (isPlaying) return
    const container = trackContainerRef.current
    if (!container) return
    const x = currentTime * pixelsPerSecond
    if (x >= container.scrollLeft && x <= container.scrollLeft + container.clientWidth) return
    container.scrollLeft = Math.max(0, x - container.clientWidth / 2)
    if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = container.scrollLeft
    syncPlayheadPosition(currentTime)
    // Only a change of time should pull the view; zooming recentres on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime])

  // Zoom so the selected clips fill the timeline view, then scroll to them.
  const pendingZoomScrollRef = useRef<number | null>(null)
  const handleZoomToSelection = useCallback(() => {
    const container = trackContainerRef.current
    const picked = clips.filter(c => selectedClipIds.has(c.id))
    if (!container || picked.length === 0) return
    const start = Math.min(...picked.map(c => c.startTime))
    const end = Math.max(...picked.map(c => c.startTime + c.duration))
    const usableWidth = Math.max(100, container.clientWidth - 40)
    const nextZoom = clampZoom(usableWidth / (Math.max(end - start, 0.5) * 100), getMinZoom())
    const scrollTo = Math.max(0, start * 100 * nextZoom - 20)
    if (Math.abs(nextZoom - zoom) < 1e-4) {
      container.scrollLeft = scrollTo
      if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = scrollTo
      return
    }
    pendingZoomScrollRef.current = scrollTo
    setZoom(nextZoom)
  }, [clips, selectedClipIds, zoom, setZoom, getMinZoom])

  useEffect(() => {
    const scrollTo = pendingZoomScrollRef.current
    if (scrollTo === null) return
    pendingZoomScrollRef.current = null
    const container = trackContainerRef.current
    if (!container) return
    container.scrollLeft = scrollTo
    if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = scrollTo
    syncPlayheadPosition(isPlaying ? playbackTimeRef.current : currentTime)
  }, [pixelsPerSecond]) // eslint-disable-line react-hooks/exhaustive-deps

  // Timeline length: typed as a timecode; empty goes back to following the content.
  const [editingLength, setEditingLength] = useState(false)
  const [lengthInput, setLengthInput] = useState('')
  const commitLength = useCallback(() => {
    setEditingLength(false)
    const text = lengthInput.trim()
    if (text === '') { actions.setTimelineLength(null); return }
    // A bare number is minutes ("30" = half an hour); anything with colons is mm:ss or hh:mm:ss.
    const seconds = /^\d+(\.\d+)?$/.test(text) ? parseFloat(text) * 60 : parseTime(text)
    if (seconds !== null && seconds > 0) actions.setTimelineLength(seconds)
  }, [actions, lengthInput])

  const rulerInterval = useMemo(() => {
    const minLabelSpacing = 80
    const intervals = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
    for (const interval of intervals) {
      if (interval * pixelsPerSecond >= minLabelSpacing) return interval
    }
    return 3600
  }, [pixelsPerSecond])

  const rulerSubInterval = useMemo(() => {
    if (rulerInterval <= 1) return 0.5
    if (rulerInterval <= 5) return 1
    if (rulerInterval <= 15) return 5
    if (rulerInterval <= 60) return 10
    if (rulerInterval <= 300) return 60
    if (rulerInterval <= 900) return 300
    if (rulerInterval <= 1800) return 600
    return 900
  }, [rulerInterval])

  // --- Extracted timeline subtree from VideoEditor ---
  return (
    <>
      <div className="h-full min-h-0 flex flex-col">
        {/* Timeline Tabs */}
        <div className="h-8 bg-zinc-900 flex items-center px-1 gap-0.5 overflow-x-auto flex-shrink-0">
          {timelines.filter(tl => openTimelineIds.has(tl.id)).map(tl => (
            <div
              key={tl.id}
              className={`group flex items-center gap-1 pl-3 pr-1 h-6 rounded-t text-xs font-medium cursor-pointer transition-colors flex-shrink-0 ${
                tl.id === activeTimeline?.id
                  ? 'bg-zinc-950 text-white border-t border-l border-r border-zinc-700'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
              }`}
              onClick={() => handleSwitchTimeline(tl.id)}
              onDoubleClick={() => handleStartRename(tl.id, tl.name)}
              onContextMenu={(e) => handleTimelineTabContextMenu(e, tl.id)}
            >
              {renamingTimelineId === tl.id && renameSource === 'tab' ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={handleFinishRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFinishRename()
                    if (e.key === 'Escape') { setRenamingTimelineId(null); setRenameValue('') }
                  }}
                  className="bg-transparent border-b border-blue-500 outline-none text-white text-xs w-20"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="truncate max-w-[120px]">{tl.name}</span>
              )}
              {/* Close tab button */}
              <Tooltip content="Close tab" side="bottom">
                <button
                  className={`ml-0.5 p-0.5 rounded transition-colors flex-shrink-0 ${
                    tl.id === activeTimeline?.id
                      ? 'text-zinc-500 hover:text-white hover:bg-zinc-700'
                      : 'text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-300 hover:bg-zinc-700'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCloseTimelineTab(tl.id)
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </Tooltip>
            </div>
          ))}
          
          {/* Add timeline button */}
          <Tooltip content="New timeline" side="bottom">
            <button
              onClick={handleAddTimeline}
              className="flex items-center justify-center w-6 h-6 rounded text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors flex-shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          
          
          {/* Context menu */}
          {timelineContextMenu && (
            <div 
              ref={timelineContextMenuRef}
              className="fixed bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 z-50 min-w-[140px]"
              style={{ left: timelineContextMenu.x, top: timelineContextMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  const tl = timelines.find(t => t.id === timelineContextMenu.timelineId)
                  if (tl) handleStartRename(tl.id, tl.name, 'panel')
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
              >
                <Pencil className="h-3 w-3" />
                Rename
              </button>
              <button
                onClick={() => handleDuplicateTimeline(timelineContextMenu.timelineId)}
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
              >
                <Copy className="h-3 w-3" />
                Duplicate
              </button>
              <div className="h-px bg-zinc-700 my-0.5" />
              <button
                disabled={true}
                title="Coming Soon!"
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-500 flex items-center gap-2 opacity-50 cursor-not-allowed"
              >
                <ZoomIn className="h-3 w-3" />
                Upscale Timeline
              </button>
              <div className="h-px bg-zinc-700 my-0.5" />
              <button
                onClick={() => {
                  actions.openImportTimelineModal()
                  setTimelineContextMenu(null)
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
              >
                <FileUp className="h-3 w-3" />
                Import XML Timeline
              </button>
              <div className="relative group/export">
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
                >
                  <Upload className="h-3 w-3" />
                  Export
                  <ChevronRight className="h-3 w-3 ml-auto text-zinc-500" />
                </button>
                <div className="absolute left-full top-0 ml-0.5 min-w-[160px] bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 z-50 hidden group-hover/export:block">
                  <button
                    onClick={() => {
                      actions.openExportModal()
                      setTimelineContextMenu(null)
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
                  >
                    <Upload className="h-3 w-3" />
                    Export Timeline...
                  </button>
                  <button
                    onClick={() => {
                      handleExportTimelineXml()
                      setTimelineContextMenu(null)
                    }}
                    disabled={clips.length === 0}
                    className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2 disabled:opacity-40"
                  >
                    <FileDown className="h-3 w-3" />
                    Export as FCP 7 XML
                  </button>
                </div>
              </div>
              <div className="h-px bg-zinc-700 my-0.5" />
              <button
                onClick={() => {
                  handleCloseTimelineTab(timelineContextMenu.timelineId)
                  setTimelineContextMenu(null)
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
              >
                <X className="h-3 w-3" />
                Close Tab
              </button>
              {timelines.length > 1 && (
                <>
                  <button
                    onClick={() => handleDeleteTimeline(timelineContextMenu.timelineId)}
                    className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-zinc-700 flex items-center gap-2"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        
        {/* Timeline with Tools */}
        <div className="bg-zinc-950 border-t border-zinc-800 flex overflow-hidden flex-1 min-h-0">
          {/* Tools Panel */}
          <div className="w-10 flex-shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col items-center py-1 gap-0.5 overflow-hidden">
            {PRIMARY_TOOLS.map(tool => (
              <Tooltip key={tool.id} content={tooltipLabel(tool.label, getShortcutLabel(kbLayout, tool.actionId))} side="right">
                <button
                  onClick={() => setActiveTool(tool.id)}
                  className={`p-1.5 rounded-lg transition-colors relative group flex-shrink-0 ${
                    activeTool === tool.id
                      ? 'bg-blue-600 text-white'
                      : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                  }`}
                >
                  <tool.icon className="h-4 w-4" />
                  <div className="absolute left-full ml-2 px-2 py-1 bg-zinc-800 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50">
                    {(() => { const s = getShortcutLabel(kbLayout, tool.actionId); return <>{tool.label}{s && <span className="text-zinc-400"> ({s})</span>}</>; })()}
                  </div>
                </button>
              </Tooltip>
            ))}
            
            {/* Trim tools group button */}
            {(() => {
              const trimToolIds = new Set(TRIM_TOOLS.map(t => t.id))
              const isTrimActive = trimToolIds.has(activeTool)
              const currentTrimTool = TRIM_TOOLS.find(t => t.id === (isTrimActive ? activeTool : lastTrimTool)) || TRIM_TOOLS[0]
              return (
                <div className="relative flex-shrink-0">
                  <Tooltip content={(() => { const s = getShortcutLabel(kbLayout, currentTrimTool.actionId); return s ? `${currentTrimTool.label} (${s}) — right-click or hold for more` : `${currentTrimTool.label} — right-click or hold for more` })()} side="right">
                    <button
                      onClick={() => {
                        if (trimFlyoutOpenedRef.current) { trimFlyoutOpenedRef.current = false; return }
                        setActiveTool(currentTrimTool.id)
                        setLastTrimTool(currentTrimTool.id)
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        if (trimLongPressRef.current) { clearTimeout(trimLongPressRef.current); trimLongPressRef.current = null }
                        trimFlyoutOpenedRef.current = true
                        setShowTrimFlyout(true)
                      }}
                      onMouseDown={(e) => {
                        if (e.button !== 0) return
                        trimFlyoutOpenedRef.current = false
                        trimLongPressRef.current = setTimeout(() => {
                          trimLongPressRef.current = null
                          trimFlyoutOpenedRef.current = true
                          setShowTrimFlyout(true)
                        }, 400)
                      }}
                      onMouseUp={() => {
                        if (trimLongPressRef.current) { clearTimeout(trimLongPressRef.current); trimLongPressRef.current = null }
                      }}
                      onMouseLeave={() => {
                        if (trimLongPressRef.current) { clearTimeout(trimLongPressRef.current); trimLongPressRef.current = null }
                      }}
                      data-trim-group-btn=""
                      className={`p-1.5 rounded-lg transition-colors relative group ${
                        isTrimActive
                          ? 'bg-blue-600 text-white'
                          : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                      }`}
                    >
                      <currentTrimTool.icon className="h-4 w-4" />
                      <div className="absolute bottom-0 right-0 w-0 h-0 border-l-[4px] border-l-transparent border-b-[4px] border-b-current opacity-60" />
                      <div className="absolute left-full ml-2 px-2 py-1 bg-zinc-800 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50">
                        {(() => { const s = getShortcutLabel(kbLayout, currentTrimTool.actionId); return <>{currentTrimTool.label}{s && <span className="text-zinc-400"> ({s})</span>}</>; })()}
                      </div>
                    </button>
                  </Tooltip>
                  {showTrimFlyout && (() => {
                    const btnEl = document.querySelector('[data-trim-group-btn]')
                    const rect = btnEl?.getBoundingClientRect()
                    return (
                      <>
                        <div className="fixed inset-0 z-[9998]" onMouseDown={() => setShowTrimFlyout(false)} onContextMenu={(e) => { e.preventDefault(); setShowTrimFlyout(false) }} />
                        <div
                          className="fixed bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 z-[9999] min-w-[160px]"
                          style={{ top: rect?.top ?? 0, left: (rect?.right ?? 44) + 4 }}
                        >
                          {TRIM_TOOLS.map(t => (
                            <button
                              key={t.id}
                              onClick={() => {
                                setActiveTool(t.id)
                                setLastTrimTool(t.id)
                                setShowTrimFlyout(false)
                              }}
                              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                                activeTool === t.id ? 'bg-blue-600/30 text-white' : 'text-zinc-300 hover:bg-zinc-700'
                              }`}
                            >
                              <t.icon className="h-3.5 w-3.5" />
                              <span className="flex-1">{t.label}</span>
                              <span className="text-zinc-500 text-[10px]">{getShortcutLabel(kbLayout, t.actionId)}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )
                  })()}
                </div>
              )
            })()}
            
            <div className="w-6 h-px bg-zinc-700 my-1 flex-shrink-0" />
            
            <Tooltip content={snapEnabled ? 'Snapping On' : 'Snapping Off'} side="right">
              <button
                onClick={() => setSnapEnabled(!snapEnabled)}
                className={`p-1.5 rounded-lg transition-colors flex-shrink-0 ${
                  snapEnabled
                    ? 'bg-blue-600 text-white'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                }`}
              >
                <Magnet className="h-4 w-4" />
              </button>
            </Tooltip>
            
            {/* EFFECTS HIDDEN - FX button hidden because effects are not applied during export
            <div className="w-6 h-px bg-zinc-700 my-1 flex-shrink-0" />

            <button
              onClick={() => setShowEffectsBrowser(!showEffectsBrowser)}
              className={`p-1.5 rounded-lg transition-colors flex-shrink-0 text-[10px] font-bold ${
                showEffectsBrowser
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
              }`}
              title="Effects Browser"
            >
              FX
            </button>
            EFFECTS HIDDEN */}

            <div className="w-6 h-px bg-zinc-700 my-1 flex-shrink-0" />
            
            <Tooltip content="Add Text Overlay" side="right">
              <button
                onClick={() => addTextClip()}
                className="p-1.5 rounded-lg transition-colors flex-shrink-0 text-cyan-400 hover:bg-cyan-900/30 hover:text-cyan-300 group relative"
              >
                <Type className="h-4 w-4" />
                <div className="absolute left-full ml-2 px-2 py-1 bg-zinc-800 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50">
                  Add Text Overlay
                </div>
              </button>
            </Tooltip>

            {canUseIcLora && (
              <>
                <div className="w-6 h-px bg-zinc-700 my-1 flex-shrink-0" />

                <Tooltip content="IC-LoRA Style Transfer" side="right">
                  <button
                    onClick={() => {
                      if (selectedClip?.type === 'video') {
                        handleICLoraClip(selectedClip)
                      }
                    }}
                    disabled={selectedClip?.type !== 'video'}
                    className="p-1.5 rounded-lg transition-colors flex-shrink-0 group relative text-amber-500/70 hover:bg-amber-900/30 hover:text-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Sparkles className="h-4 w-4" />
                    <div className="absolute left-full ml-2 px-2 py-1 bg-zinc-800 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50">
                      IC-LoRA Style Transfer
                    </div>
                  </button>
                </Tooltip>
              </>
            )}

            <div className="flex-1" />

            <Tooltip content={showPropertiesPanel ? 'Hide Properties Panel' : 'Show Properties Panel'} side="right">
              <button
                onClick={() => setShowPropertiesPanel(p => !p)}
                className={`p-1.5 rounded-lg transition-colors flex-shrink-0 group relative ${
                  showPropertiesPanel ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                }`}
              >
                <PanelRight className="h-4 w-4" />
                <div className="absolute left-full ml-2 px-2 py-1 bg-zinc-800 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50">
                  {showPropertiesPanel ? 'Hide Properties' : 'Show Properties'}
                </div>
              </button>
            </Tooltip>
          </div>
          
          {/* EFFECTS HIDDEN - Effects Browser panel hidden because effects are not applied during export */}

          {/* Timeline content */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Ruler row - fixed at top */}
            <div className="flex flex-shrink-0">
              <div
                className="w-32 h-6 flex-shrink-0 border-b border-r border-zinc-800 bg-zinc-900 flex items-center justify-center cursor-text"
                onClick={() => {
                  if (!editingTimecode) {
                    setTimecodeInput(formatTime(isPlaying ? playbackTimeRef.current : currentTime))
                    setEditingTimecode(true)
                    requestAnimationFrame(() => timecodeInputRef.current?.select())
                  }
                }}
              >
                {editingTimecode ? (
                  <input
                    ref={timecodeInputRef}
                    autoFocus
                    className="w-full h-full bg-zinc-950 text-amber-400 text-[11px] font-mono font-medium text-center outline-none border-none tabular-nums tracking-tight px-1"
                    value={timecodeInput}
                    onChange={e => setTimecodeInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const t = parseTime(timecodeInput)
                        if (t !== null) {
                          const clamped = Math.max(0, Math.min(timelineExtent, t))
                          setCurrentTime(clamped)
                          playbackTimeRef.current = clamped
                        }
                        setEditingTimecode(false)
                      } else if (e.key === 'Escape') {
                        setEditingTimecode(false)
                      }
                      e.stopPropagation()
                    }}
                    onClick={e => e.stopPropagation()}
                    onBlur={() => setEditingTimecode(false)}
                  />
                ) : (
                  <span
                    ref={timelineTimecodeRef}
                    className="text-[11px] font-mono font-medium text-amber-400 tabular-nums tracking-tight select-none"
                  >
                    {formatTime(currentTime)}
                  </span>
                )}
              </div>
              <div ref={rulerScrollRef} className="flex-1 overflow-hidden">
                <div 
                  ref={timelineRef}
                  style={{ minWidth: `${timelineExtent * pixelsPerSecond}px` }}
                  className={`h-6 bg-zinc-900 border-b border-zinc-800 relative select-none ${
                    'cursor-pointer'
                  }`}
                  onMouseDown={handleRulerMouseDown}
                >
                  <TimelineRulerTicks
                    scrollContainerRef={trackContainerRef}
                    extent={timelineExtent}
                    pixelsPerSecond={pixelsPerSecond}
                    interval={rulerInterval}
                    subInterval={rulerSubInterval}
                  />
                  {/* Dimmed region BEFORE In point on ruler */}
                  {inPoint !== null && (
                    <div
                      className="absolute top-0 bottom-0 left-0 bg-black/40 pointer-events-none z-10"
                      style={{ width: `${inPoint * pixelsPerSecond}px` }}
                    />
                  )}
                  {/* Dimmed region AFTER Out point on ruler */}
                  {outPoint !== null && (
                    <div
                      className="absolute top-0 bottom-0 right-0 bg-black/40 pointer-events-none z-10"
                      style={{ left: `${outPoint * pixelsPerSecond}px` }}
                    />
                  )}
                  {/* In/Out range highlight on ruler */}
                  {(inPoint !== null || outPoint !== null) && (
                    <div
                      className="absolute top-0 bottom-0 border-t-2 border-b-2 border-blue-400/60 pointer-events-none z-10"
                      style={{
                        left: `${(inPoint ?? 0) * pixelsPerSecond}px`,
                        width: `${((outPoint ?? totalDuration) - (inPoint ?? 0)) * pixelsPerSecond}px`,
                      }}
                    />
                  )}
                  {/* In point bracket marker — draggable */}
                  {inPoint !== null && (
                    <div
                      className="absolute top-0 bottom-0 z-[15] cursor-ew-resize"
                      style={{ left: `${inPoint * pixelsPerSecond - 6}px`, width: 12 }}
                      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); markerDragOriginRef.current = 'timeline'; setDraggingMarker('timelineIn') }}
                    >
                      {/* Bracket shape */}
                      <div className="absolute top-0 bottom-0 left-[5px] w-1.5 bg-blue-400 rounded-l-sm flex flex-col justify-between pointer-events-none">
                        <div className="w-3 h-0.5 bg-blue-400 rounded-r" />
                        <div className="w-3 h-0.5 bg-blue-400 rounded-r" />
                      </div>
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[8px] font-bold text-blue-400 whitespace-nowrap pointer-events-none">IN</div>
                    </div>
                  )}
                  {/* Out point bracket marker — draggable */}
                  {outPoint !== null && (
                    <div
                      className="absolute top-0 bottom-0 z-[15] cursor-ew-resize"
                      style={{ left: `${outPoint * pixelsPerSecond - 6}px`, width: 12 }}
                      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); markerDragOriginRef.current = 'timeline'; setDraggingMarker('timelineOut') }}
                    >
                      {/* Bracket shape */}
                      <div className="absolute top-0 bottom-0 left-[5px] w-1.5 bg-blue-400 rounded-r-sm flex flex-col justify-between pointer-events-none">
                        <div className="w-3 h-0.5 bg-blue-400 rounded-l -ml-1.5" />
                        <div className="w-3 h-0.5 bg-blue-400 rounded-l -ml-1.5" />
                      </div>
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 text-[8px] font-bold text-blue-400 whitespace-nowrap pointer-events-none">OUT</div>
                    </div>
                  )}
                  {/* Playhead (ruler) — position updated by rAF engine during playback */}
                  <div 
                    ref={playheadRulerRef}
                    className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 pointer-events-none"
                    style={{ left: `${currentTime * pixelsPerSecond}px` }}
                  >
                    <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-red-500" />
                  </div>
                </div>
              </div>
            </div>
            
            {/* Tracks body - vertically scrollable */}
            <div className="flex flex-1 min-h-0 flex-col">
              {/* Scrollable tracks area */}
              <div className="flex flex-1 min-h-0">
              {/* Track headers column. A click on its empty space (not a control)
                  deselects, same as clicking empty track area. */}
              <div
                className="w-32 flex-shrink-0 border-r border-zinc-800 bg-zinc-900 flex flex-col overflow-hidden"
                onMouseDown={(e) => {
                  if (e.button !== 0) return
                  if ((e.target as HTMLElement).closest('button, input, select, textarea, [contenteditable="true"]')) return
                  setSelectedClipIds(new Set())
                  setSelectedSubtitleId(null)
                  clearSelectedGap()
                }}
              >
                {/* Add track buttons - pinned above scrollable area */}
                <div className="flex-shrink-0 h-7 flex items-center px-2 gap-1.5 border-b border-zinc-700/50">
                  <button 
                    onClick={() => actions.addTrack('video')}
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 flex items-center gap-0.5"
                    title="Add video track"
                  >
                    <Plus className="h-3 w-3" />
                    V
                  </button>
                  <button 
                    onClick={() => actions.addTrack('audio')}
                    className="text-[10px] text-emerald-500/70 hover:text-emerald-400 flex items-center gap-0.5"
                    title="Add audio track"
                  >
                    <Plus className="h-3 w-3" />
                    A
                  </button>
                  <div className="w-px h-3 bg-zinc-700" />
                  <button 
                    onClick={() => addSubtitleTrack()}
                    className="text-[10px] text-amber-500/70 hover:text-amber-400 flex items-center gap-0.5"
                    title="Add subtitle track"
                  >
                    <MessageSquare className="h-3 w-3" />
                    Subs
                  </button>
                  <div className="w-px h-3 bg-zinc-700" />
                  <button 
                    onClick={() => createAdjustmentLayerAsset()}
                    className="text-[10px] text-blue-400/70 hover:text-blue-300 flex items-center gap-0.5"
                    title="Create adjustment layer asset"
                  >
                    <Layers className="h-3 w-3" />
                    Adj
                  </button>
                </div>
                {/* Scrollable track headers - synced with vertical scroll */}
                <div ref={trackHeadersRef} className="flex-1 overflow-hidden flex flex-col select-none">
                {orderedTracks.map(({ track, realIndex, displayRow }) => (
                  <React.Fragment key={track.id}>
                    {/* Draggable divider between video and audio sections */}
                    {displayRow === audioDividerDisplayRow && (
                      <div 
                        className="flex-shrink-0 bg-zinc-700/60 relative cursor-row-resize hover:bg-blue-500/30 transition-colors group/divider"
                        style={{ height: DIVIDER_H }}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const startY = e.clientY
                          const startVH = videoTrackHeight
                          const startAH = audioTrackHeight
                          const onMove = (ev: MouseEvent) => {
                            const delta = ev.clientY - startY
                            const newVH = Math.max(32, Math.min(200, startVH + delta))
                            const newAH = Math.max(32, Math.min(200, startAH - delta))
                            setVideoTrackHeight(newVH)
                            setAudioTrackHeight(newAH)
                          }
                          const onUp = () => {
                            window.removeEventListener('mousemove', onMove)
                            window.removeEventListener('mouseup', onUp)
                          }
                          window.addEventListener('mousemove', onMove)
                          window.addEventListener('mouseup', onUp)
                        }}
                      >
                        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center justify-center">
                          <div className="flex flex-col items-center gap-[1px]">
                            <div className="w-8 h-[1px] bg-zinc-500 group-hover/divider:bg-blue-400 transition-colors rounded-full" />
                            <div className="w-8 h-[1px] bg-zinc-500 group-hover/divider:bg-blue-400 transition-colors rounded-full" />
                          </div>
                        </div>
                        <span className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 text-[7px] font-bold text-zinc-400 bg-zinc-800 px-1.5 rounded-sm leading-none pointer-events-none">V | A</span>
                      </div>
                    )}
                    <div 
                      className={`group flex-shrink-0 border-b border-zinc-800 text-xs relative ${
                        track.type === 'subtitle'
                          ? 'bg-amber-950/20 px-1.5 flex flex-col justify-center gap-0'
                          : track.kind === 'audio'
                          ? 'bg-emerald-950/10 px-2 flex items-center justify-between'
                          : 'px-2 flex items-center justify-between'
                      }`}
                      style={{ height: track.type === 'subtitle' ? subtitleTrackHeight : track.kind === 'audio' ? audioTrackHeight : videoTrackHeight }}
                    >
                      {track.type === 'subtitle' ? (
                        <>
                          {/* Row 1: track name */}
                          <div className="flex items-center gap-1">
                            <MessageSquare className="h-3 w-3 text-amber-500/60 flex-shrink-0" />
                            <span className={`text-[10px] font-semibold truncate ${track.muted ? 'text-zinc-600' : 'text-amber-400/80'}`}>
                              {track.name}
                            </span>
                          </div>
                          {/* Row 2: tools */}
                          <div className="flex items-center gap-0">
                            <Tooltip content="Track style settings" side="right">
                              <button
                                onClick={() => setSubtitleTrackStyleIdx(subtitleTrackStyleIdx === realIndex ? null : realIndex)}
                                className={`p-0.5 rounded ${subtitleTrackStyleIdx === realIndex ? 'text-amber-400 bg-amber-900/30' : 'text-amber-500/60 hover:text-amber-400'}`}
                              >
                                <Palette className="h-3 w-3" />
                              </button>
                            </Tooltip>
                            <Tooltip content="Add subtitle" side="right">
                              <button
                                onClick={() => addSubtitleClip(realIndex)}
                                className="p-0.5 rounded text-amber-500/60 hover:text-amber-400"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </Tooltip>
                            <Tooltip content={track.locked ? 'Unlock' : 'Lock'} side="right">
                              <button
                                onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? {...t, locked: !t.locked} : t))}
                                className={`p-0.5 rounded ${track.locked ? 'text-yellow-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                              >
                                {track.locked ? <Lock className="h-2.5 w-2.5" /> : <Unlock className="h-2.5 w-2.5" />}
                              </button>
                            </Tooltip>
                            <Tooltip content={track.muted ? 'Show subtitles' : 'Hide subtitles'} side="right">
                              <button
                                onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? {...t, muted: !t.muted} : t))}
                                className={`p-0.5 rounded ${track.muted ? 'text-red-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                              >
                                {track.muted ? <EyeOff className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
                              </button>
                            </Tooltip>
                            <Tooltip content="Delete track" side="right">
                              <button
                                onClick={() => {
                                  if (confirm(`Delete subtitle track "${track.name}"?`)) {
                                    setTracks(tracks.filter((_, i) => i !== realIndex))
                                    setSubtitles(prev => prev.filter(s => s.trackIndex !== realIndex))
                                  }
                                }}
                                className="p-0.5 rounded text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <Trash2 className="h-2.5 w-2.5" />
                              </button>
                            </Tooltip>
                          </div>
                        </>
                      ) : (
                      <>
                      <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                        <Tooltip content={track.sourcePatched !== false ? 'Source patched (click to unpatch)' : 'Source unpatched (click to patch)'} side="right">
                          <button
                            onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? {...t, sourcePatched: !(t.sourcePatched !== false)} : t))}
                            className={`p-0.5 rounded flex-shrink-0 transition-colors ${
                              track.sourcePatched !== false
                                ? track.kind === 'audio'
                                  ? 'text-emerald-400 hover:text-emerald-300'
                                  : 'text-blue-400 hover:text-blue-300'
                                : 'text-zinc-600 hover:text-zinc-400'
                            }`}
                          >
                            {track.sourcePatched !== false
                              ? <CircleDot className="h-2.5 w-2.5" />
                              : <Circle className="h-2.5 w-2.5" />
                            }
                          </button>
                        </Tooltip>
                        <span className={`text-[10px] font-semibold truncate ${
                          track.muted ? 'text-zinc-600' 
                          : track.kind === 'audio' ? 'text-emerald-400/80'
                          : 'text-zinc-300'
                        }`}>
                          {track.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-0 flex-shrink-0">
                        <Tooltip content={track.locked ? 'Unlock' : 'Lock'} side="right">
                          <button
                            onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? {...t, locked: !t.locked} : t))}
                            className={`p-0.5 rounded ${track.locked ? 'text-yellow-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                          >
                            {track.locked ? <Lock className="h-2.5 w-2.5" /> : <Unlock className="h-2.5 w-2.5" />}
                          </button>
                        </Tooltip>
                        {track.kind !== 'audio' && (
                          <Tooltip content={track.enabled === false ? 'Enable track output' : 'Disable track output'} side="right">
                            <button
                              onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? {...t, enabled: !(t.enabled !== false)}: t))}
                              className={`p-0.5 rounded ${track.enabled === false ? 'text-zinc-600' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                              {track.enabled === false ? <EyeOff className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
                            </button>
                          </Tooltip>
                        )}
                        {track.kind !== 'audio' && (
                          <Tooltip content={track.muted ? 'Unmute' : 'Mute'} side="right">
                            <button
                              onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? {...t, muted: !t.muted} : t))}
                              className={`p-0.5 rounded ${track.muted ? 'text-red-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                              {track.muted ? <VolumeX className="h-2.5 w-2.5" /> : <Volume2 className="h-2.5 w-2.5" />}
                            </button>
                          </Tooltip>
                        )}
                        {track.kind === 'audio' && (
                          <button
                            onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? {...t, muted: !t.muted} : t))}
                            className={`px-1 py-0.5 rounded text-[10px] font-bold leading-none ${
                              track.muted ? 'bg-red-500/80 text-white' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
                            }`}
                            title={track.muted ? 'Unmute track' : 'Mute track'}
                          >
                            M
                          </button>
                        )}
                        {track.kind === 'audio' && (
                          <button
                            onClick={() => setTracks(tracks.map((t, i) => i === realIndex ? {...t, solo: !t.solo} : t))}
                            className={`px-1 py-0.5 rounded text-[10px] font-bold leading-none ${
                              track.solo ? 'bg-yellow-500/80 text-black' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
                            }`}
                            title={track.solo ? 'Unsolo track' : 'Solo track'}
                          >
                            S
                          </button>
                        )}
                        {tracks.length > 1 && (
                          <Tooltip content="Delete track" side="right">
                            <button
                              onClick={() => deleteTrack(realIndex)}
                              className="p-0.5 rounded text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <Trash2 className="h-2.5 w-2.5" />
                            </button>
                          </Tooltip>
                        )}
                      </div>
                      </>
                      )}
                      {/* Track height resize handle */}
                      <div
                        className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize z-10 group/resize hover:bg-blue-500/40 transition-colors"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const isSubtitle = track.type === 'subtitle'
                          const isAudio = track.kind === 'audio'
                          const startY = e.clientY
                          const startH = isSubtitle ? subtitleTrackHeight : isAudio ? audioTrackHeight : videoTrackHeight
                          const onMove = (ev: MouseEvent) => {
                            const delta = ev.clientY - startY
                            const newH = Math.max(24, Math.min(200, startH + delta))
                            if (isSubtitle) setSubtitleTrackHeight(newH)
                            else if (isAudio) setAudioTrackHeight(newH)
                            else setVideoTrackHeight(newH)
                          }
                          const onUp = () => {
                            window.removeEventListener('mousemove', onMove)
                            window.removeEventListener('mouseup', onUp)
                            if (suppressGapClickRef.current) {
                              window.setTimeout(() => {
                                suppressGapClickRef.current = false
                              }, 0)
                            }
                          }
                          window.addEventListener('mousemove', onMove)
                          window.addEventListener('mouseup', onUp)
                        }}
                      >
                        <div className="mx-auto w-6 h-0.5 bg-zinc-600 rounded-full mt-0.5 group-hover/resize:bg-blue-400 transition-colors" />
                      </div>
                    </div>
                  </React.Fragment>
                ))}
                {/* Spacer at bottom of track list */}
                <div className="h-4 flex-shrink-0" />
              </div>{/* end trackHeadersRef */}
              </div>{/* end track headers column */}
              
              {/* Scrollable track content area */}
              <div className="flex-1 flex flex-col min-w-0 relative overflow-hidden">
                {mcpReveal.total > 0 && (
                  <div className="absolute top-1 right-2 z-40 flex items-center gap-2 h-5 pl-2 pr-1 rounded-full bg-zinc-900/90 border border-[rgb(var(--accent))]/60 text-[10px] text-zinc-200 shadow-lg">
                    <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--accent))] animate-pulse" />
                    Claude is editing · {mcpReveal.step}/{mcpReveal.total}
                    <button onClick={skipMcpReveal} className="px-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-700">Skip</button>
                  </div>
                )}
                {/* Full-height playhead line — spans spacer + tracks, positioned on the wrapper */}
                <div
                  ref={playheadOverlayRef}
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-30 pointer-events-none"
                  style={{ left: `${currentTime * pixelsPerSecond - (trackContainerRef.current?.scrollLeft || 0)}px` }}
                />
                {/* Spacer matching the add-track button bar height */}
                {/* Also a place to start a drag-select: on a long, full timeline it is
                    the only empty space that doesn't need scrolling to the end. */}
                <div
                  className="flex-shrink-0 h-7 border-b border-zinc-700/50"
                  onMouseDown={(e) => {
                    if (e.button !== 0 || activeTool !== 'select') return
                    e.preventDefault()
                    startSelectionLasso(e.clientX, e.clientY, e.shiftKey)
                  }}
                />
                <div 
                  ref={trackContainerRef}
                  className="flex-1 overflow-auto select-none tl-scroll"
                  onScroll={handleTimelineScroll}
                >
                <div 
                  style={{ minWidth: `${timelineExtent * pixelsPerSecond}px`,
                    ...(activeTool === 'blade' ? { cursor: SCISSORS_CURSOR }
                      : activeTool === 'trackForward' ? { cursor: bladeShiftHeld ? TRACK_FWD_ONE_CURSOR : TRACK_FWD_ALL_CURSOR }
                      : {}),
                  }}
                  // Full height, so the empty space under the last track starts a
                  // drag-select too (with every track full there is nowhere else).
                  className="relative min-h-full"
                  onDragOver={(e) => {
                    // Allow asset/timeline drops anywhere on the timeline area, including
                    // images/videos dragged from the Prompt Manager Pro Downloads Browser
                    // or Images tab.
                    if (
                      e.dataTransfer.types.includes('assetid') || e.dataTransfer.types.includes('assetids')
                      || e.dataTransfer.types.includes('asset') || e.dataTransfer.types.includes('timeline')
                      || e.dataTransfer.types.includes(FILE_DND) || e.dataTransfer.types.includes(GPM_IMAGE_DND_TYPE)
                    ) {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'copy'
                    }
                  }}
                  onDrop={(e) => {
                    // Determine which track the drop landed on from the Y position
                    const container = trackContainerRef.current
                    if (!container) return
                    const rect = container.getBoundingClientRect()
                    const yInContainer = e.clientY - rect.top + container.scrollTop
                    let droppedTrackIndex = 0
                    let accY = 0
                    for (const entry of orderedTracks) {
                      if (entry.displayRow === audioDividerDisplayRow) accY += DIVIDER_H
                      const th = entry.track.type === 'subtitle' ? subtitleTrackHeight : entry.track.kind === 'audio' ? audioTrackHeight : videoTrackHeight
                      if (yInContainer >= accY && yInContainer < accY + th) {
                        droppedTrackIndex = entry.realIndex
                        break
                      }
                      accY += th
                      droppedTrackIndex = entry.realIndex
                    }
                    handleTrackDrop(e, droppedTrackIndex)
                  }}
                  onContextMenu={(e) => {
                    // Right-click on background (not on a clip) opens paste menu
                    if (e.target === e.currentTarget || (e.target as HTMLElement).closest('[data-track-bg]')) {
                      handleTimelineBgContextMenu(e)
                    }
                  }}
                  onMouseDown={(e) => {
                    // Only start lasso on direct click on the tracks area (not on clips)
                    if (e.target === e.currentTarget || (e.target as HTMLElement).closest('[data-track-bg]')) {
                      if (activeTool === 'trackForward') {
                        setSelectedSubtitleId(null)
                        setEditingSubtitleId(null)
                        clearSelectedGap()
                        // Track Select Forward: click empty area → select all clips from click time forward
                        const container = trackContainerRef.current
                        if (container) {
                          const rect = container.getBoundingClientRect()
                          const scrollLeft = container.scrollLeft
                          const scrollTop = container.scrollTop
                          const clickX = e.clientX - rect.left + scrollLeft
                          const clickY = e.clientY - rect.top + scrollTop
                          const clickTime = clickX / pixelsPerSecond
                          
                          // Determine which track was clicked using display ordering
                          let clickedRealTrackIndex = -1
                          let accY = 0
                          for (const entry of orderedTracks) {
                            if (entry.displayRow === audioDividerDisplayRow) accY += DIVIDER_H
                            const th = entry.track.type === 'subtitle' ? subtitleTrackHeight : entry.track.kind === 'audio' ? audioTrackHeight : videoTrackHeight
                            if (clickY >= accY && clickY < accY + th) {
                              clickedRealTrackIndex = entry.realIndex
                              break
                            }
                            accY += th
                          }
                          
                          const forwardClips = clips.filter(c => {
                            if (e.shiftKey) {
                              return c.trackIndex === clickedRealTrackIndex && c.startTime >= clickTime - 0.01
                            } else {
                              return c.startTime >= clickTime - 0.01
                            }
                          })
                          setSelectedClipIds(new Set(forwardClips.map(c => c.id)))
                        }
                      } else if (activeTool === 'select') {
                        startSelectionLasso(e.clientX, e.clientY, e.shiftKey)
                      }
                    }
                  }}
                >
                  {/* Dimmed region BEFORE In point on tracks */}
                  {inPoint !== null && (
                    <div
                      className="absolute top-0 bottom-0 left-0 bg-black/25 pointer-events-none z-[5]"
                      style={{ width: `${inPoint * pixelsPerSecond}px` }}
                    />
                  )}
                  {/* Dimmed region AFTER Out point on tracks */}
                  {outPoint !== null && (
                    <div
                      className="absolute top-0 bottom-0 bg-black/25 pointer-events-none z-[5]"
                      style={{ left: `${outPoint * pixelsPerSecond}px`, right: 0 }}
                    />
                  )}
                  {/* In/Out range highlight on tracks */}
                  {(inPoint !== null || outPoint !== null) && (
                    <div
                      className="absolute top-0 bottom-0 border-l-2 border-r-2 border-blue-400/40 pointer-events-none z-[5]"
                      style={{
                        left: `${(inPoint ?? 0) * pixelsPerSecond}px`,
                        width: `${((outPoint ?? totalDuration) - (inPoint ?? 0)) * pixelsPerSecond}px`,
                      }}
                    />
                  )}
                  {/* In point line on tracks */}
                  {inPoint !== null && (
                    <div 
                      className="absolute top-0 bottom-0 w-0.5 bg-blue-400/60 z-[15] pointer-events-none"
                      style={{ left: `${inPoint * pixelsPerSecond}px` }}
                    />
                  )}
                  {/* Out point line on tracks */}
                  {outPoint !== null && (
                    <div 
                      className="absolute top-0 bottom-0 w-0.5 bg-blue-400/60 z-[15] pointer-events-none"
                      style={{ left: `${outPoint * pixelsPerSecond}px` }}
                    />
                  )}
                  {/* Playhead is now rendered as overlay on the column wrapper (playheadOverlayRef) */}
                  
                  {orderedTracks.map(({ track, realIndex, displayRow }) => (
                    <React.Fragment key={track.id}>
                      {/* Divider between video and audio sections */}
                      {displayRow === audioDividerDisplayRow && (
                        <div
                          className="bg-zinc-700/60 cursor-row-resize hover:bg-blue-500/30 transition-colors"
                          style={{ height: DIVIDER_H }}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            const startY = e.clientY
                            const startVH = videoTrackHeight
                            const startAH = audioTrackHeight
                            const onMove = (ev: MouseEvent) => {
                              const delta = ev.clientY - startY
                              const newVH = Math.max(32, Math.min(200, startVH + delta))
                              const newAH = Math.max(32, Math.min(200, startAH - delta))
                              setVideoTrackHeight(newVH)
                              setAudioTrackHeight(newAH)
                            }
                            const onUp = () => {
                              window.removeEventListener('mousemove', onMove)
                              window.removeEventListener('mouseup', onUp)
                            }
                            window.addEventListener('mousemove', onMove)
                            window.addEventListener('mouseup', onUp)
                          }}
                        />
                      )}
                      <div 
                        data-track-bg="true"
                        className={`border-b border-zinc-800 ${
                          track.type === 'subtitle'
                            ? 'bg-amber-950/15'
                            : track.kind === 'audio'
                              ? (displayRow % 2 === 0 ? 'bg-emerald-950/20' : 'bg-emerald-950/10')
                              : displayRow % 2 === 0 ? 'bg-zinc-900/50' : 'bg-zinc-950'
                        } ${track.locked ? 'opacity-50' : ''}`}
                        style={{ height: track.type === 'subtitle' ? subtitleTrackHeight : track.kind === 'audio' ? audioTrackHeight : videoTrackHeight }}
                        onDrop={(e) => {
                          e.stopPropagation()
                          if (track.type === 'subtitle') {
                            e.preventDefault()
                            return
                          }
                          handleTrackDrop(e, realIndex)
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDoubleClick={() => {
                          if (track.type === 'subtitle' && !track.locked) {
                            addSubtitleClip(realIndex)
                          }
                        }}
                      />
                    </React.Fragment>
                  ))}
                  
                  {/* Lasso selection rectangle */}
                  {lassoRect && lassoOriginRef.current && (() => {
                    const origin = lassoOriginRef.current!
                    const container = trackContainerRef.current
                    if (!container) return null
                    const scrollLeft = container.scrollLeft
                    const scrollTop = container.scrollTop
                    const x1 = Math.min(lassoRect.startX, lassoRect.currentX) - origin.containerLeft + scrollLeft
                    const x2 = Math.max(lassoRect.startX, lassoRect.currentX) - origin.containerLeft + scrollLeft
                    const y1 = Math.min(lassoRect.startY, lassoRect.currentY) - origin.containerTop + scrollTop
                    const y2 = Math.max(lassoRect.startY, lassoRect.currentY) - origin.containerTop + scrollTop
                    return (
                      <div
                        className="absolute border border-blue-400 bg-blue-500/10 z-30 pointer-events-none rounded-sm"
                        style={{
                          left: x1,
                          top: y1,
                          width: x2 - x1,
                          height: y2 - y1,
                        }}
                      />
                    )
                  })()}
                  
                  {visibleClips.map(clip => {
                    const liveAsset = clip.assetId ? assets.find(a => a.id === clip.assetId) : null
                    const clipColor = getColorLabel(clip.colorLabel || liveAsset?.colorLabel || clip.asset?.colorLabel)
                    const clipWidthPx = clip.duration * pixelsPerSecond
                    const isAudioClip = clip.type === 'audio'
                    const fadeInPx = Math.min(clipWidthPx, (clip.audioFadeIn ?? 0) * pixelsPerSecond)
                    const fadeOutPx = Math.min(clipWidthPx, (clip.audioFadeOut ?? 0) * pixelsPerSecond)
                    return (
                    <div
                      key={clip.id}
                      data-clip-id={clip.id}
                      className={`absolute rounded border-2 transition-all overflow-hidden select-none ${
                        selectedClipIds.has(clip.id) 
                          ? 'border-blue-500 shadow-lg shadow-blue-500/20' 
                          : clipColor
                            ? `hover:brightness-125`
                            : 'border-zinc-600 hover:border-zinc-500'
                      } ${!clipColor ? (clip.type === 'audio' ? 'bg-green-900/50' : clip.type === 'adjustment' ? 'bg-blue-900/40 border-dashed' : clip.type === 'text' ? 'bg-cyan-900/50 border-cyan-600/40' : 'bg-zinc-800') : ''} ${
                        activeTool === 'select' || activeTool === 'ripple' || activeTool === 'roll' ? 'cursor-grab' : ''
                      } ${
                        activeTool === 'slip' ? 'cursor-ew-resize' : ''
                      } ${activeTool === 'slide' ? 'cursor-col-resize' : ''} ${
                        draggingClip?.clipId === clip.id || (draggingClip && selectedClipIds.has(clip.id)) ? 'opacity-80 cursor-grabbing z-30' : ''
                      } ${slipSlideClip?.clipId === clip.id ? 'opacity-90 ring-2 ring-yellow-500/50 z-30' : ''
                      } ${mcpReveal.focus.has(clip.id) ? (mcpReveal.focusKind === 'add' ? 'mcp-clip-drop' : 'mcp-clip-flash') : ''
                      }`}
                      style={{
                        ...(mcpReveal.hidden.has(clip.id) ? { visibility: 'hidden' as const, pointerEvents: 'none' as const } : {}),
                        left: `${clip.startTime * pixelsPerSecond}px`,
                        width: `${clip.duration * pixelsPerSecond}px`,
                        top: `${trackTopPx(clip.trackIndex, 4)}px`,
                        height: `${getTrackHeight(clip.trackIndex) - 8}px`,
                        ...(activeTool === 'blade' ? { cursor: SCISSORS_CURSOR }
                          : activeTool === 'trackForward' ? { cursor: bladeShiftHeld ? TRACK_FWD_ONE_CURSOR : TRACK_FWD_ALL_CURSOR }
                          : {}),
                        ...(clipColor ? {
                          backgroundColor: `${clipColor.color}80`,
                          borderColor: selectedClipIds.has(clip.id) ? undefined : clipColor.color,
                        } : {}),
                      }}
                      onMouseDown={(e) => handleClipMouseDown(e, clip)}
                      onDoubleClick={() => {
                        setSelectedClipIds(expandWithLinkedClips(new Set([clip.id])))
                        setShowPropertiesPanel(true)
                      }}
                      onMouseMove={(e) => {
                        if (activeTool === 'blade') {
                          const rect = e.currentTarget.getBoundingClientRect()
                          const ox = e.clientX - rect.left
                          const hoverTime = clip.startTime + (ox / rect.width) * clip.duration
                          setBladeHoverInfo({ clipId: clip.id, offsetX: ox, time: hoverTime })
                        }
                      }}
                      onMouseLeave={() => {
                        if (activeTool === 'blade' && bladeHoverInfo?.clipId === clip.id) {
                          setBladeHoverInfo(null)
                        }
                      }}
                      onContextMenu={(e) => handleClipContextMenu(e, clip)}
                      /* EFFECTS HIDDEN - drag-drop for effects hidden because effects are not applied during export */
                    >
                      {/* 9:16 reframe keyframes (cyan). Keys live on SOURCE time for video
                          (clip-local for images), so map through trim/speed to place them.
                          Drag to slide in time; click to park the playhead on the key — the
                          program monitor's 9:16 frame then edits that key directly.
                          Double-click (or Alt+click) deletes a key, like the volume dots. */}
                      {(clip.type === 'video' || clip.type === 'image') && clip.reframe?.keys && clip.reframe.keys.length > 0 && (() => {
                        const speed = clip.speed || 1
                        const toLocal = (t: number) => (clip.type === 'video' ? (t - clip.trimStart) / speed : t)
                        const toKeyTime = (local: number) => (clip.type === 'video' ? clip.trimStart + local * speed : local)
                        // Removing the last key keeps the window where that key had it (as the
                        // monitor's delete-key button does) instead of snapping back to centre.
                        const deleteKey = (i: number) => setClips(prev => prev.map(c => {
                          if (c.id !== clip.id || !c.reframe?.keys) return c
                          const removed = c.reframe.keys[i]
                          const rest = c.reframe.keys.filter((_, j) => j !== i)
                          return { ...c, reframe: rest.length ? { ...c.reframe, keys: rest } : { pos: removed?.pos ?? c.reframe.pos } }
                        }))
                        return (
                          <div className="absolute inset-x-0 top-0 h-3 z-20 pointer-events-none">
                            {clip.reframe.keys.map((k, i) => {
                              const local = toLocal(k.t)
                              if (local < -1e-3 || local > clip.duration + 1e-3) return null // trimmed away
                              return (
                                <button
                                  key={`rkf-${i}`}
                                  className="absolute top-0.5 -translate-x-1/2 text-cyan-300 hover:text-cyan-100 hover:scale-125 transition-transform pointer-events-auto cursor-ew-resize"
                                  style={{ left: `${Math.max(0, Math.min(1, local / Math.max(1e-6, clip.duration))) * 100}%` }}
                                  title={`9:16 frame keyframe at ${local.toFixed(2)}s — drag to move, click to edit, double-click to delete`}
                                  onClick={(e) => e.stopPropagation()}
                                  onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); deleteKey(i) }}
                                  onMouseDown={(e) => {
                                    e.stopPropagation()
                                    e.preventDefault()
                                    if (e.altKey) { deleteKey(i); return }
                                    const rect = (e.currentTarget.closest('[data-clip-id]') as HTMLElement | null)?.getBoundingClientRect()
                                    if (!rect) return
                                    const startX = e.clientX
                                    let dragged = false
                                    const onMove = (ev: MouseEvent) => {
                                      if (!dragged && Math.abs(ev.clientX - startX) < 3) return
                                      dragged = true
                                      const localNew = Math.max(0, Math.min(clip.duration, ((ev.clientX - rect.left) / rect.width) * clip.duration))
                                      setClips(prev => prev.map(c => c.id === clip.id && c.reframe?.keys
                                        ? { ...c, reframe: { ...c.reframe, keys: c.reframe.keys.map((kk, j) => (j === i ? { ...kk, t: +toKeyTime(localNew).toFixed(3) } : kk)) } }
                                        : c))
                                      setCurrentTime(clip.startTime + localNew)
                                    }
                                    const onUp = () => {
                                      document.removeEventListener('mousemove', onMove)
                                      document.removeEventListener('mouseup', onUp)
                                      document.body.style.cursor = ''
                                      if (dragged) {
                                        setClips(prev => prev.map(c => c.id === clip.id && c.reframe?.keys
                                          ? { ...c, reframe: { ...c.reframe, keys: [...c.reframe.keys].sort((a, b) => a.t - b.t) } }
                                          : c))
                                      } else {
                                        setSelectedClipIds(expandWithLinkedClips(new Set([clip.id])))
                                        setCurrentTime(clip.startTime + local)
                                      }
                                    }
                                    document.addEventListener('mousemove', onMove)
                                    document.addEventListener('mouseup', onUp)
                                    document.body.style.cursor = 'ew-resize'
                                  }}
                                >
                                  <Diamond className="h-2.5 w-2.5 fill-current" />
                                </button>
                              )
                            })}
                          </div>
                        )
                      })()}
                      {/* Transform keyframes (violet), for a clip placed/sized as a layer.
                          Sits just above the opacity row so the two can be read apart. */}
                      {clip.layer?.keys && clip.layer.keys.length > 0 && (
                        <ClipKeyframeDiamonds
                          keys={clip.layer.keys.map(k => k.t)}
                          duration={clip.duration}
                          colorClass="text-violet-300 hover:text-violet-100"
                          rowClass="bottom-3"
                          title={(i) => {
                            const k = clip.layer!.keys![i]
                            return `Position ${Math.round(k.x * 1000) / 10}%, ${Math.round(k.y * 1000) / 10}% · size ` +
                              `${Math.round(k.scaleX * 1000) / 10}% at ${k.t.toFixed(2)}s — drag to move, click to edit, double-click to delete`
                          }}
                          onDelete={(i) => actions.removeClipLayerKey(clip.id, i)}
                          onMoveKey={(i, t) => { actions.moveClipLayerKey(clip.id, i, t); setCurrentTime(clip.startTime + t) }}
                          onDragEnd={() => { /* moveClipLayerKey already keeps the keys sorted */ }}
                          onPark={(t) => {
                            setSelectedClipIds(expandWithLinkedClips(new Set([clip.id])))
                            setShowPropertiesPanel(true)
                            setCurrentTime(clip.startTime + t)
                          }}
                        />
                      )}
                      {/* Opacity keyframes (amber) — on text overlays and on media clips
                          that have been faded or keyframed. */}
                      {clip.opacityKeyframes && clip.opacityKeyframes.length > 0 && (
                        <ClipKeyframeDiamonds
                          keys={clip.opacityKeyframes.map(k => k.t)}
                          duration={clip.duration}
                          colorClass="text-amber-300 hover:text-amber-100"
                          title={(i) => {
                            const k = clip.opacityKeyframes![i]
                            return `Opacity ${Math.round(k.value)}% at ${k.t.toFixed(2)}s — drag to move, click to edit, double-click to delete`
                          }}
                          onDelete={(i) => actions.removeClipOpacityKey(clip.id, i)}
                          onMoveKey={(i, t) => {
                            setClips(prev => prev.map(c => c.id === clip.id && c.opacityKeyframes
                              ? { ...c, opacityKeyframes: c.opacityKeyframes.map((kk, j) => (j === i ? { ...kk, t: +t.toFixed(3) } : kk)) }
                              : c))
                            setCurrentTime(clip.startTime + t)
                          }}
                          onDragEnd={() => {
                            setClips(prev => prev.map(c => c.id === clip.id && c.opacityKeyframes
                              ? { ...c, opacityKeyframes: [...c.opacityKeyframes].sort((a, b) => a.t - b.t) }
                              : c))
                          }}
                          onPark={(t) => {
                            setSelectedClipIds(expandWithLinkedClips(new Set([clip.id])))
                            setShowPropertiesPanel(true)
                            setCurrentTime(clip.startTime + t)
                          }}
                        />
                      )}
                      {/* Blade cut indicator line */}
                      {activeTool === 'blade' && bladeHoverInfo && (() => {
                        // Show indicator on the hovered clip, or on all clips at that time when Shift is held
                        const isHoveredClip = bladeHoverInfo.clipId === clip.id
                        const isShiftTarget = bladeShiftHeld && !isHoveredClip &&
                          bladeHoverInfo.time > clip.startTime + 0.05 &&
                          bladeHoverInfo.time < clip.startTime + clip.duration - 0.05
                        if (!isHoveredClip && !isShiftTarget) return null
                        const indicatorPx = isHoveredClip
                          ? bladeHoverInfo.offsetX
                          : (bladeHoverInfo.time - clip.startTime) * pixelsPerSecond
                        return (
                          <div
                            className={`absolute top-0 bottom-0 w-px z-20 pointer-events-none ${isHoveredClip ? 'bg-red-500' : 'bg-red-500/60'}`}
                            style={{ left: `${indicatorPx}px` }}
                          >
                            <div className={`absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 ${isHoveredClip ? 'bg-red-500' : 'bg-red-500/60'}`} />
                            <div className={`absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 ${isHoveredClip ? 'bg-red-500' : 'bg-red-500/60'}`} />
                          </div>
                        )
                      })()}
                      <div className={`absolute left-0 top-0 bottom-0 w-4 flex items-center justify-center text-zinc-500 hover:text-white ${activeTool === 'trackForward' || activeTool === 'blade' ? '' : 'cursor-grab'}`}
                        style={activeTool === 'blade' ? { cursor: SCISSORS_CURSOR } : activeTool === 'trackForward' ? { cursor: bladeShiftHeld ? TRACK_FWD_ONE_CURSOR : TRACK_FWD_ALL_CURSOR } : {}}>
                        <GripVertical className="h-3 w-3" />
                      </div>

                      {/* Audio fade in/out — draggable handles + fade-wedge shading on the waveform */}
                      {isAudioClip && clipWidthPx >= NARROW_CLIP_PX && (
                        <div className="absolute inset-0 z-20 pointer-events-none">
                          {fadeInPx > 1 && (
                            <div className="absolute top-0 bottom-0 left-0 bg-black/45" style={{ width: fadeInPx, clipPath: 'polygon(0 0, 100% 0, 0 100%)' }} />
                          )}
                          {fadeOutPx > 1 && (
                            <div className="absolute top-0 bottom-0 bg-black/45" style={{ left: clipWidthPx - fadeOutPx, width: fadeOutPx, clipPath: 'polygon(0 0, 100% 0, 100% 100%)' }} />
                          )}
                          <div
                            className="absolute top-0 h-3 w-3 -translate-x-1/2 rounded-full bg-white/90 border border-emerald-600 shadow cursor-ew-resize pointer-events-auto hover:scale-125 transition-transform"
                            style={{ left: fadeInPx }}
                            title="Drag to set audio fade in"
                            onMouseDown={(e) => {
                              e.stopPropagation(); e.preventDefault()
                              const startX = e.clientX
                              const startFade = clip.audioFadeIn ?? 0
                              const onMove = (ev: MouseEvent) => {
                                const next = Math.max(0, Math.min(clip.duration / 2, startFade + (ev.clientX - startX) / pixelsPerSecond))
                                setClips(prev => prev.map(c => c.id === clip.id ? { ...c, audioFadeIn: +next.toFixed(2) } : c))
                              }
                              const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.style.cursor = '' }
                              document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); document.body.style.cursor = 'ew-resize'
                            }}
                          />
                          <div
                            className="absolute top-0 h-3 w-3 -translate-x-1/2 rounded-full bg-white/90 border border-emerald-600 shadow cursor-ew-resize pointer-events-auto hover:scale-125 transition-transform"
                            style={{ left: clipWidthPx - fadeOutPx }}
                            title="Drag to set audio fade out"
                            onMouseDown={(e) => {
                              e.stopPropagation(); e.preventDefault()
                              const startX = e.clientX
                              const startFade = clip.audioFadeOut ?? 0
                              const onMove = (ev: MouseEvent) => {
                                const next = Math.max(0, Math.min(clip.duration / 2, startFade + (startX - ev.clientX) / pixelsPerSecond))
                                setClips(prev => prev.map(c => c.id === clip.id ? { ...c, audioFadeOut: +next.toFixed(2) } : c))
                              }
                              const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.style.cursor = '' }
                              document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); document.body.style.cursor = 'ew-resize'
                            }}
                          />

                          {/* Volume line + automation keyframes. Flat = drag for gain,
                              double-click to start keyframing. Keyframed = a polyline
                              with draggable dots; double-click a dot removes it, the
                              line adds one. Value 0..2 maps to the 18%..90% band. */}
                          {(() => {
                            const clipHeightPx = getTrackHeight(clip.trackIndex) - 8
                            const kfs = clip.volumeKeyframes && clip.volumeKeyframes.length > 0
                              ? [...clip.volumeKeyframes].sort((a, b) => a.t - b.t)
                              : null
                            const valueToTopPct = (v: number) => 18 + (1 - v / 2) * 72
                            // (t, value) from a mouse event, resolved against the clip box.
                            const posFromEvent = (ev: { clientX: number; clientY: number }, el: HTMLElement) => {
                              const rect = (el.closest('[data-clip-id]') as HTMLElement | null)?.getBoundingClientRect()
                              if (!rect) return null
                              const t = Math.max(0, Math.min(clip.duration, (ev.clientX - rect.left) / pixelsPerSecond))
                              const topPct = ((ev.clientY - rect.top) / rect.height) * 100
                              const value = Math.max(0, Math.min(2, (1 - (topPct - 18) / 72) * 2))
                              return { t, value }
                            }
                            const applyKfs = (next: { t: number; value: number }[]) =>
                              setClips(prev => prev.map(c => c.id === clip.id ? { ...c, volumeKeyframes: next.length ? next : undefined } : c))

                            if (!kfs) {
                              const vol = clip.volume ?? 1
                              const usablePx = Math.max(1, clipHeightPx * 0.72)
                              return (
                                <div
                                  className="absolute left-5 right-1 h-2.5 -translate-y-1/2 cursor-ns-resize pointer-events-auto group/vol"
                                  style={{ top: `${valueToTopPct(vol)}%` }}
                                  title="Drag to set volume · double-click to add keyframes"
                                  onMouseDown={(e) => {
                                    e.stopPropagation(); e.preventDefault()
                                    const startY = e.clientY
                                    const startVol = clip.volume ?? 1
                                    const onMove = (ev: MouseEvent) => {
                                      const next = Math.max(0, Math.min(2, startVol - ((ev.clientY - startY) / usablePx) * 2))
                                      actions.setClipAudioLevel(clip.id, +next.toFixed(2))
                                    }
                                    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.style.cursor = '' }
                                    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); document.body.style.cursor = 'ns-resize'
                                  }}
                                  onDoubleClick={(e) => {
                                    e.stopPropagation()
                                    const p = posFromEvent(e, e.currentTarget)
                                    if (!p) return
                                    const seeded = [{ t: 0, value: vol }, { t: clip.duration, value: vol }, { t: +p.t.toFixed(3), value: +p.value.toFixed(3) }]
                                      .sort((a, b) => a.t - b.t)
                                    applyKfs(seeded)
                                  }}
                                >
                                  <div className={`absolute inset-x-0 top-1/2 -translate-y-1/2 h-0.5 rounded-full transition-colors ${vol > 1 ? 'bg-amber-300/80' : 'bg-emerald-300/70'} group-hover/vol:bg-white`} />
                                  <div className="absolute right-1.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-white/90 border border-emerald-700 shadow opacity-0 group-hover/vol:opacity-100 transition-opacity" />
                                  <span className="absolute left-1 -top-3 text-[8px] text-white bg-black/60 px-1 rounded opacity-0 group-hover/vol:opacity-100 transition-opacity whitespace-nowrap tabular-nums">{Math.round(vol * 100)}%</span>
                                </div>
                              )
                            }

                            const pts = kfs.map(k => `${Math.min(clipWidthPx, k.t * pixelsPerSecond)},${valueToTopPct(k.value) / 100 * clipHeightPx}`).join(' ')
                            return (
                              <>
                                <svg className="absolute inset-0" width={clipWidthPx} height={clipHeightPx} style={{ pointerEvents: 'none', overflow: 'visible' }}>
                                  <polyline points={pts} fill="none" stroke="rgba(110,231,183,0.95)" strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
                                  <polyline
                                    points={pts} fill="none" stroke="transparent" strokeWidth={14}
                                    style={{ pointerEvents: 'stroke', cursor: 'copy' }}
                                    onDoubleClick={(e) => {
                                      e.stopPropagation()
                                      const p = posFromEvent(e, e.currentTarget as unknown as HTMLElement)
                                      if (!p) return
                                      applyKfs([...kfs, { t: +p.t.toFixed(3), value: +p.value.toFixed(3) }].sort((a, b) => a.t - b.t))
                                    }}
                                  />
                                </svg>
                                {kfs.map((k, idx) => (
                                  <div
                                    key={idx}
                                    className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white border border-emerald-600 shadow cursor-move pointer-events-auto hover:scale-125 transition-transform z-30"
                                    style={{ left: `${Math.min(clipWidthPx, k.t * pixelsPerSecond)}px`, top: `${valueToTopPct(k.value)}%` }}
                                    title={`${Math.round(k.value * 100)}% · double-click to remove`}
                                    onMouseDown={(e) => {
                                      e.stopPropagation(); e.preventDefault()
                                      const dotEl = e.currentTarget as HTMLElement
                                      const base = kfs
                                      const prevT = idx > 0 ? base[idx - 1].t : 0
                                      const nextT = idx < base.length - 1 ? base[idx + 1].t : clip.duration
                                      const onMove = (ev: MouseEvent) => {
                                        const p = posFromEvent(ev, dotEl)
                                        if (!p) return
                                        const t = Math.max(prevT, Math.min(nextT, p.t))
                                        applyKfs(base.map((kk, i) => i === idx ? { t: +t.toFixed(3), value: +p.value.toFixed(3) } : kk))
                                      }
                                      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.style.cursor = '' }
                                      document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); document.body.style.cursor = 'grabbing'
                                    }}
                                    onDoubleClick={(e) => {
                                      e.stopPropagation()
                                      applyKfs(kfs.filter((_, i) => i !== idx))
                                    }}
                                  />
                                ))}
                              </>
                            )
                          })()}
                        </div>
                      )}

                      {/* A clip only a few px wide (a whole long timeline in view) has no room
                          for a thumbnail, label or waveform; leaving them out is what keeps the
                          full-length view quick to open. */}
                      {clipWidthPx >= NARROW_CLIP_PX && (
                      <div className="h-full flex items-center pl-5 pr-2 gap-2">
                        {clip.type === 'adjustment' ? (
                          <div className="h-8 w-8 flex-shrink-0 rounded bg-blue-800/30 border border-blue-600/30 flex items-center justify-center">
                            <Layers className="h-4 w-4 text-blue-400" />
                          </div>
                        ) : clip.type === 'text' ? (
                          <div className="h-8 w-8 flex-shrink-0 rounded bg-cyan-800/30 border border-cyan-600/30 flex items-center justify-center">
                            <Type className="h-4 w-4 text-cyan-400" />
                          </div>
                        ) : clip.type === 'audio' ? (
                          <>
                            <ClipWaveform
                              url={pathToFileUrl(getClipPath(clip) || clip.asset?.path || '')}
                              trimStart={clip.trimStart}
                              duration={clip.duration}
                              speed={clip.speed}
                              reversed={clip.reversed}
                            />
                            <div className="h-8 w-8 flex-shrink-0 rounded bg-emerald-800/50 flex items-center justify-center relative z-10">
                              <Music className="h-4 w-4 text-emerald-400" />
                            </div>
                          </>
                        ) : clip.asset && (() => {
                          const liveAsset = getLiveAsset(clip)
                          if (!liveAsset) return null
                          let thumbPath: string | undefined = liveAsset.smallThumbnailPath
                          const takeIdx = clip.takeIndex ?? liveAsset.activeTakeIndex
                          if (liveAsset.takes && liveAsset.takes.length > 0 && takeIdx !== undefined) {
                            const idx = Math.max(0, Math.min(takeIdx, liveAsset.takes.length - 1))
                            thumbPath = liveAsset.takes[idx].smallThumbnailPath
                          }
                          return thumbPath ? (
                            <img
                              key={`thumb-${clip.id}-${clip.takeIndex ?? 'default'}`}
                              src={pathToFileUrl(thumbPath)}
                              alt=""
                              className="h-8 aspect-video object-cover rounded"
                            />
                          ) : (
                            <div className="h-8 aspect-video rounded" />
                          )
                        })()}
                        <div className={`flex-1 min-w-0 ${clip.type === 'audio' ? 'relative z-10' : ''}`}>
                          <p className={`text-[10px] truncate ${clip.type === 'adjustment' ? 'text-blue-300' : clip.type === 'text' ? 'text-cyan-300' : clip.type === 'audio' ? 'text-emerald-300' : 'text-zinc-300'}`}>
                            {clip.type === 'adjustment' ? 'Adjustment Layer' : clip.type === 'text' ? (clip.textStyle?.text?.slice(0, 30) || 'Text') : clip.asset?.prompt?.slice(0, 30) || clip.importedName || 'Clip'}
                          </p>
                          <div className="flex items-center gap-2 text-[9px] text-zinc-500">
                            <span>{clip.duration.toFixed(1)}s</span>
                            {(() => {
                              const resInfo = getClipResolution(clip)
                              if (!resInfo) return null
                              return <span style={{ color: resInfo.color }} className="font-semibold">{resInfo.displayName}</span>
                            })()}
                            {clip.speed !== 1 && <span className="text-yellow-400">{clip.speed}x</span>}
                            {clip.reversed && <span className="text-blue-400">REV</span>}
                            {clip.muted && <span className="text-red-400">M</span>}
                            {(clip.flipH || clip.flipV) && <span className="text-cyan-400">FLIP</span>}
                            {clip.colorCorrection && Object.values(clip.colorCorrection).some(v => v !== 0) && <span className="text-orange-400">CC</span>}
                            {clip.letterbox?.enabled && <span className="text-blue-400">LB</span>}
                            {clip.linkedClipIds?.length && <Link2 className="h-2.5 w-2.5 text-zinc-500 inline" />}
                          </div>
                        </div>
                        
                        {/* Take navigation + Regenerate (only for clips with gen params) */}
                        {(() => {
                          const liveAsset = getLiveAsset(clip)
                          if (!liveAsset || clip.duration * pixelsPerSecond <= 60 || clip.type === 'adjustment' || clip.type === 'audio') return null
                          return (
                            <div className="flex-shrink-0 flex items-center gap-0.5" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                              {/* Take navigation: prev/next */}
                              {liveAsset.takes && liveAsset.takes.length > 1 && (
                                <>
                                  <Tooltip content="Previous take" side="top">
                                    <button
                                      onClick={() => handleClipTakeChange(clip.id, 'prev')}
                                      className="p-0.5 rounded hover:bg-white/10 text-zinc-500 hover:text-white transition-colors"
                                    >
                                      <ChevronLeft className="h-3 w-3" />
                                    </button>
                                  </Tooltip>
                                  <span className="text-[8px] text-zinc-400 min-w-[24px] text-center">
                                    {(clip.takeIndex ?? (liveAsset.activeTakeIndex ?? liveAsset.takes.length - 1)) + 1}/{liveAsset.takes.length}
                                  </span>
                                  <Tooltip content="Next take" side="top">
                                    <button
                                      onClick={() => handleClipTakeChange(clip.id, 'next')}
                                      className="p-0.5 rounded hover:bg-white/10 text-zinc-500 hover:text-white transition-colors"
                                    >
                                      <ChevronRight className="h-3 w-3" />
                                    </button>
                                  </Tooltip>
                                  <Tooltip content="Delete this take" side="top">
                                    <button
                                      onClick={() => {
                                        if (confirm(`Delete take ${(clip.takeIndex ?? (liveAsset.activeTakeIndex ?? liveAsset.takes!.length - 1)) + 1}?`)) {
                                          handleDeleteTake(clip.id)
                                        }
                                      }}
                                      className="p-0.5 rounded hover:bg-red-900/50 text-zinc-500 hover:text-red-400 transition-colors"
                                    >
                                      <Trash2 className="h-2.5 w-2.5" />
                                    </button>
                                  </Tooltip>
                                </>
                              )}
                              <Tooltip content="Regenerate shot" side="top">
                                <button
                                  onClick={() => handleRegenerate(clip.assetId!, clip.id)}
                                  disabled={isRegenerating}
                                  className={`p-0.5 rounded transition-colors ${
                                    clip.isRegenerating
                                      ? 'text-blue-400'
                                      : 'hover:bg-white/10 text-zinc-500 hover:text-blue-400'
                                  }`}
                                >
                                  <RefreshCw className={`h-3 w-3 ${clip.isRegenerating ? 'animate-spin' : ''}`} />
                                </button>
                              </Tooltip>
                              {canUseRetake && clip.type === 'video' && (
                                <Tooltip content="Retake section" side="top">
                                  <button
                                    onClick={() => requestRetakeClip(clip)}
                                    className="p-0.5 rounded transition-colors hover:bg-white/10 text-zinc-500 hover:text-blue-400"
                                  >
                                    <Film className="h-3 w-3" />
                                  </button>
                                </Tooltip>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                      )}
                      
                      {/* Regenerating overlay on the clip */}
                      {clip.isRegenerating && (
                        <div className="absolute inset-0 bg-blue-900/30 backdrop-blur-[2px] flex items-center justify-center rounded-lg z-10">
                          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-900/80 border border-blue-500/40">
                            <Loader2 className="h-3 w-3 text-blue-300 animate-spin" />
                            <span className="text-[9px] text-blue-200 font-medium">
                              {regenProgress > 0 ? `${regenProgress}%` : 'Regenerating...'}
                            </span>
                            {canCancelInFlight && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCancelRegeneration() }}
                              className="ml-1 px-1.5 py-0.5 rounded bg-zinc-800/80 border border-zinc-600/60 text-[9px] text-zinc-300 hover:text-red-400 hover:border-red-500/50 hover:bg-red-900/30 transition-colors"
                            >
                              Cancel
                            </button>
                            )}
                          </div>
                        </div>
                      )}
                      
                      
                      {/* Transition in indicator */}
                      {clip.transitionIn?.type !== 'none' && clip.transitionIn?.duration > 0 && (
                        <div
                          className="absolute top-0 bottom-0 left-0 pointer-events-none"
                          style={{
                            width: `${Math.min(clip.transitionIn.duration / clip.duration * 100, 50)}%`,
                            background: 'linear-gradient(to right, rgba(139,92,246,0.4), transparent)',
                          }}
                        />
                      )}
                      {/* Transition out indicator */}
                      {clip.transitionOut?.type !== 'none' && clip.transitionOut?.duration > 0 && (
                        <div
                          className="absolute top-0 bottom-0 right-0 pointer-events-none"
                          style={{
                            width: `${Math.min(clip.transitionOut.duration / clip.duration * 100, 50)}%`,
                            background: 'linear-gradient(to left, rgba(139,92,246,0.4), transparent)',
                          }}
                        />
                      )}
                      
                      {/* Resolution color-code bar at the bottom of the clip */}
                      {(() => {
                        const resInfo = getClipResolution(clip)
                        if (!resInfo) return null
                        return (
                          <div
                            className="absolute bottom-0 left-0 right-0 h-[3px] pointer-events-none"
                            style={{ backgroundColor: resInfo.color }}
                            title={resInfo.label}
                          />
                        )
                      })()}

                      <div 
                        className={`absolute left-0 top-0 bottom-0 w-3 ${activeTool === 'trackForward' || activeTool === 'blade' ? '' : 'cursor-ew-resize'} transition-colors flex items-center justify-center ${
                          resizingClip?.clipId === clip.id && resizingClip?.edge === 'left'
                            ? activeTool === 'roll' ? 'bg-yellow-500' : activeTool === 'ripple' ? 'bg-green-500' : 'bg-blue-500'
                            : activeTool === 'roll' ? 'hover:bg-yellow-500/50' : activeTool === 'ripple' ? 'hover:bg-green-500/50' : 'hover:bg-blue-500/50'
                        }`}
                        style={activeTool === 'blade' ? { cursor: SCISSORS_CURSOR } : activeTool === 'trackForward' ? { cursor: bladeShiftHeld ? TRACK_FWD_ONE_CURSOR : TRACK_FWD_ALL_CURSOR } : {}}
                        onMouseDown={(e) => handleResizeStart(e, clip, 'left')}
                      >
                        <div className={`w-0.5 h-6 rounded-full ${
                          activeTool === 'roll' ? 'bg-yellow-300' : activeTool === 'ripple' ? 'bg-green-300' : 'bg-zinc-500'
                        }`} />
                      </div>
                      <div 
                        className={`absolute right-0 top-0 bottom-0 w-3 ${activeTool === 'trackForward' || activeTool === 'blade' ? '' : 'cursor-ew-resize'} transition-colors flex items-center justify-center ${
                          resizingClip?.clipId === clip.id && resizingClip?.edge === 'right'
                            ? activeTool === 'roll' ? 'bg-yellow-500' : activeTool === 'ripple' ? 'bg-green-500' : 'bg-blue-500'
                            : activeTool === 'roll' ? 'hover:bg-yellow-500/50' : activeTool === 'ripple' ? 'hover:bg-green-500/50' : 'hover:bg-blue-500/50'
                        }`}
                        style={activeTool === 'blade' ? { cursor: SCISSORS_CURSOR } : activeTool === 'trackForward' ? { cursor: bladeShiftHeld ? TRACK_FWD_ONE_CURSOR : TRACK_FWD_ALL_CURSOR } : {}}
                        onMouseDown={(e) => handleResizeStart(e, clip, 'right')}
                      >
                        <div className={`w-0.5 h-6 rounded-full ${
                          activeTool === 'roll' ? 'bg-yellow-300' : activeTool === 'ripple' ? 'bg-green-300' : 'bg-zinc-500'
                        }`} />
                      </div>
                    </div>
                  )})}
                  
                  {/* Gap indicators between clips */}
                  {timelineGaps.map((gap, i) => {
                    const leftPx = gap.startTime * pixelsPerSecond
                    const widthPx = (gap.endTime - gap.startTime) * pixelsPerSecond
                    const topPx = trackTopPx(gap.trackIndex, 4)
                    const isSelected = selectedGap &&
                      selectedGap.trackIndex === gap.trackIndex &&
                      Math.abs(selectedGap.startTime - gap.startTime) < 0.01 &&
                      Math.abs(selectedGap.endTime - gap.endTime) < 0.01
                    const isGeneratingHere = generatingGap &&
                      generatingGap.trackIndex === gap.trackIndex &&
                      Math.abs(generatingGap.startTime - gap.startTime) < 0.01 &&
                      Math.abs(generatingGap.endTime - gap.endTime) < 0.01

                    if (widthPx < 4) return null

                    return (
                      <div
                        key={`gap-${i}`}
                        className={`absolute rounded cursor-pointer transition-all group ${
                          isGeneratingHere
                            ? 'bg-blue-500/15 border-2 border-dashed border-blue-400/60 shadow-inner'
                            : isSelected
                            ? 'bg-blue-500/20 border-2 border-dashed border-blue-400/60 shadow-inner'
                            : 'border-2 border-dashed border-transparent hover:bg-blue-500/10 hover:border-blue-400/30'
                        }`}
                        style={{
                          left: `${leftPx}px`,
                          top: `${topPx}px`,
                          width: `${widthPx}px`,
                          height: `${getTrackHeight(gap.trackIndex) - 8}px`,
                        }}
                        onMouseDown={(e) => {
                          if (e.button !== 0 || activeTool !== 'select' || isGeneratingHere) return
                          startSelectionLasso(e.clientX, e.clientY, e.shiftKey)
                          suppressGapClickRef.current = false
                          const startX = e.clientX
                          const startY = e.clientY
                          const onMove = (event: MouseEvent) => {
                            if (
                              Math.abs(event.clientX - startX) >= 4 ||
                              Math.abs(event.clientY - startY) >= 4
                            ) {
                              suppressGapClickRef.current = true
                            }
                          }
                          const onUp = () => {
                            window.removeEventListener('mousemove', onMove)
                            window.removeEventListener('mouseup', onUp)
                          }
                          window.addEventListener('mousemove', onMove)
                          window.addEventListener('mouseup', onUp)
                        }}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (suppressGapClickRef.current) {
                            suppressGapClickRef.current = false
                            return
                          }
                          if (isGeneratingHere) return
                          selectGap(gap, e.currentTarget as HTMLElement)
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          if (isGeneratingHere) return
                          selectGap(gap, e.currentTarget as HTMLElement)
                        }}
                      >
                        {isGeneratingHere ? (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                            <Loader2 className="h-3 w-3 text-blue-400 animate-spin pointer-events-none" />
                            {widthPx > 50 && (
                              <span className="text-[9px] text-blue-300 font-medium pointer-events-none">
                                {gapGenerationApi.progress > 0 ? `${gapGenerationApi.progress}%` : 'Generating...'}
                              </span>
                            )}
                            {widthPx > 30 && (
                              <div className="w-3/4 h-0.5 bg-blue-900/40 rounded-full overflow-hidden pointer-events-none">
                                <div
                                  className="h-full bg-blue-400 rounded-full transition-all duration-300"
                                  style={{ width: `${Math.max(gapGenerationApi.progress, 2)}%` }}
                                />
                              </div>
                            )}
                            {gapGenerationApi.canCancel && (
                            <Tooltip content="Cancel generation" side="top">
                              <button
                                onClick={(e) => { e.stopPropagation(); cancelGapGeneration() }}
                                className="absolute top-0.5 right-0.5 p-0.5 rounded hover:bg-zinc-700/80 text-zinc-500 hover:text-red-400 transition-colors"
                              >
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </Tooltip>
                            )}
                          </div>
                        ) : (
                          <div className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity ${
                            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                          }`}>
                            <span className="text-[9px] font-medium text-blue-400">
                              {(gap.endTime - gap.startTime).toFixed(1)}s
                            </span>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  
                  {/* Subtitle clips on subtitle tracks */}
                  {subtitles.map(sub => {
                    const track = tracks[sub.trackIndex]
                    if (!track || track.type !== 'subtitle') return null
                    const leftPx = sub.startTime * pixelsPerSecond
                    const widthPx = Math.max(20, (sub.endTime - sub.startTime) * pixelsPerSecond)
                    const topPx = trackTopPx(sub.trackIndex, 4)
                    const isSelected = selectedSubtitleId === sub.id
                    const isEditing = editingSubtitleId === sub.id
                    
                    return (
                      <div
                        key={sub.id}
                        className={`absolute rounded border-2 overflow-hidden cursor-pointer select-none flex items-center ${
                          isSelected
                            ? 'border-amber-400 shadow-lg shadow-amber-500/20 bg-amber-900/60'
                            : 'border-amber-700/50 hover:border-amber-600/70 bg-amber-900/40'
                        } ${track.locked ? 'pointer-events-none opacity-50' : ''}`}
                        style={{
                          left: `${leftPx}px`,
                          top: `${topPx}px`,
                          width: `${widthPx}px`,
                          height: `${getTrackHeight(sub.trackIndex) - 8}px`,
                        }}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedSubtitleId(sub.id)
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          setEditingSubtitleId(sub.id)
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setSelectedSubtitleId(sub.id)
                        }}
                        onMouseDown={(e) => {
                          if (track.locked || e.button !== 0) return
                          e.stopPropagation()
                          const startX = e.clientX
                          const origStart = sub.startTime
                          const origEnd = sub.endTime
                          const dur = origEnd - origStart
                          
                          const onMove = (ev: MouseEvent) => {
                            const dx = ev.clientX - startX
                            const dt = dx / pixelsPerSecond
                            const newStart = Math.max(0, origStart + dt)
                            updateSubtitle(sub.id, { startTime: newStart, endTime: newStart + dur })
                          }
                          const onUp = () => {
                            window.removeEventListener('mousemove', onMove)
                            window.removeEventListener('mouseup', onUp)
                          }
                          window.addEventListener('mousemove', onMove)
                          window.addEventListener('mouseup', onUp)
                        }}
                      >
                        {/* Subtitle text */}
                        <div className="flex-1 min-w-0 px-2 py-1">
                          {isEditing ? (
                            <input
                              autoFocus
                              defaultValue={sub.text}
                              className="w-full bg-transparent text-amber-100 text-[10px] leading-tight outline-none border-b border-amber-500/50"
                              onBlur={(e) => {
                                updateSubtitle(sub.id, { text: e.target.value })
                                setEditingSubtitleId(null)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  updateSubtitle(sub.id, { text: (e.target as HTMLInputElement).value })
                                  setEditingSubtitleId(null)
                                }
                                if (e.key === 'Escape') setEditingSubtitleId(null)
                                e.stopPropagation()
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <span className="text-[10px] text-amber-200 leading-tight line-clamp-2 break-all">
                              {sub.text}
                            </span>
                          )}
                        </div>

                        {/* Left resize handle */}
                        <div
                          className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-amber-400/30"
                          onMouseDown={(e) => {
                            e.stopPropagation()
                            const startX = e.clientX
                            const origStart = sub.startTime
                            const onMove = (ev: MouseEvent) => {
                              const dx = ev.clientX - startX
                              const dt = dx / pixelsPerSecond
                              const newStart = Math.max(0, Math.min(sub.endTime - 0.2, origStart + dt))
                              updateSubtitle(sub.id, { startTime: newStart })
                            }
                            const onUp = () => {
                              window.removeEventListener('mousemove', onMove)
                              window.removeEventListener('mouseup', onUp)
                            }
                            window.addEventListener('mousemove', onMove)
                            window.addEventListener('mouseup', onUp)
                          }}
                        />
                        {/* Right resize handle */}
                        <div
                          className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-amber-400/30"
                          onMouseDown={(e) => {
                            e.stopPropagation()
                            const startX = e.clientX
                            const origEnd = sub.endTime
                            const onMove = (ev: MouseEvent) => {
                              const dx = ev.clientX - startX
                              const dt = dx / pixelsPerSecond
                              const newEnd = Math.max(sub.startTime + 0.2, origEnd + dt)
                              updateSubtitle(sub.id, { endTime: newEnd })
                            }
                            const onUp = () => {
                              window.removeEventListener('mousemove', onMove)
                              window.removeEventListener('mouseup', onUp)
                            }
                            window.addEventListener('mousemove', onMove)
                            window.addEventListener('mouseup', onUp)
                          }}
                        />
                      </div>
                    )
                  })}
                  
                  {/* Cut point indicators for cross-dissolve */}
                  {cutPoints.map((cp) => {
                    const leftPx = cp.time * pixelsPerSecond
                    const topPx = trackTopPx(cp.trackIndex, 4)
                    const isHovered = hoveredCutPoint?.leftClipId === cp.leftClip.id && hoveredCutPoint?.rightClipId === cp.rightClip.id
                    const isDragOver = dragOverCut?.leftClipId === cp.leftClip.id && dragOverCut?.rightClipId === cp.rightClip.id
                    const dissolveDur = cp.hasTransition
                      ? (cp.isAudio ? (cp.leftClip.audioFadeOut || DEFAULT_DISSOLVE_DURATION) : (cp.leftClip.transitionOut?.duration || DEFAULT_DISSOLVE_DURATION))
                      : 0
                    const dissolveWidthPx = dissolveDur * pixelsPerSecond
                    // Half the seam zone: the fade runs this far each side of the cut.
                    const halfPx = cp.hasTransition ? Math.max(12, dissolveWidthPx) : 12
                    const laterSeams = cutPoints.filter(o => o.isAudio === cp.isAudio && o.trackIndex === cp.trackIndex && o.time > cp.time + CUT_POINT_TOLERANCE)
                    // Color-code + label the seam region by transition type.
                    const tRGB =
                      cp.transitionType === 'dissolve' ? '139,92,246'      // purple
                        : cp.transitionType === 'fade-to-black' ? '148,163,184'  // slate
                        : cp.transitionType === 'fade-to-white' ? '226,232,240'  // light
                        : '59,130,246'                                     // blue (wipes)
                    const tLabel =
                      cp.transitionType === 'dissolve' ? 'Dissolve'
                        : cp.transitionType === 'fade-to-black' ? 'Fade ●'
                        : cp.transitionType === 'fade-to-white' ? 'Fade ○'
                        : cp.transitionType === 'wipe-left' ? 'Wipe ◄'
                        : cp.transitionType === 'wipe-right' ? 'Wipe ►'
                        : cp.transitionType === 'wipe-up' ? 'Wipe ▲'
                        : cp.transitionType === 'wipe-down' ? 'Wipe ▼'
                        : ''

                    return (
                      <div
                        key={`cut-${cp.leftClip.id}-${cp.rightClip.id}`}
                        className="absolute z-20"
                        style={{
                          left: `${leftPx - halfPx}px`,
                          top: `${topPx - 24}px`,
                          width: `${halfPx * 2}px`,
                          height: `${48 + 24}px`, /* extend upward to include popup zone */
                        }}
                        onMouseEnter={() => setHoveredCutPoint({
                          leftClipId: cp.leftClip.id,
                          rightClipId: cp.rightClip.id,
                          time: cp.time,
                          trackIndex: cp.trackIndex,
                        })}
                        onMouseLeave={() => setHoveredCutPoint(null)}
                        onDragOver={(e) => {
                          if (!e.dataTransfer.types.includes('transitiontype')) return
                          e.preventDefault()
                          e.stopPropagation()
                          e.dataTransfer.dropEffect = 'copy'
                          if (!isDragOver) setDragOverCut({ leftClipId: cp.leftClip.id, rightClipId: cp.rightClip.id })
                        }}
                        onDragLeave={() => {
                          setDragOverCut(prev => (prev?.leftClipId === cp.leftClip.id && prev?.rightClipId === cp.rightClip.id) ? null : prev)
                        }}
                        onDrop={(e) => {
                          const type = e.dataTransfer.getData('transitiontype') as TransitionType
                          setDragOverCut(null)
                          if (!type) return
                          e.preventDefault()
                          e.stopPropagation()
                          applyJunctionTransition(cp.leftClip.id, cp.rightClip.id, type)
                          setLastSeam({ audio: cp.isAudio, type: cp.isAudio ? 'dissolve' : type, duration: dissolveDur || DEFAULT_DISSOLVE_DURATION })
                        }}
                      >
                        {/* Visible indicator line — also the drop indicator: a faint
                            tick on empty seams, brighter with a transition, glowing on drag-over. */}
                        <div
                          className={`absolute top-6 bottom-0 rounded-full transition-all ${isDragOver ? 'w-1.5 shadow-[0_0_8px_rgba(96,165,250,0.9)]' : 'w-0.5'} ${
                            isDragOver || isHovered ? 'bg-blue-400' : cp.hasTransition ? (cp.isAudio ? 'bg-emerald-400/70' : 'bg-blue-500/60') : 'bg-zinc-500/25'
                          }`}
                          style={{ left: `${halfPx}px`, transform: 'translateX(-50%)' }}
                        />
                        
                        {cp.hasTransition && (
                          <>
                            {/* Fade zone straddling the seam. Dragging the left edge left or the
                                right edge right lengthens it (video dissolves and audio crossfades
                                alike); dragging either toward the cut shortens it. */}
                            <div
                              className="absolute rounded-sm pointer-events-none"
                              style={{
                                left: 0,
                                top: '24px',
                                width: `${halfPx * 2}px`,
                                height: '48px',
                                background: cp.isAudio
                                  ? 'linear-gradient(to right, rgba(52,211,153,0.12), rgba(52,211,153,0.28), rgba(52,211,153,0.12))'
                                  : `linear-gradient(to right, rgba(${tRGB},0.15), rgba(${tRGB},0.3), rgba(${tRGB},0.15))`,
                                borderTop: `2px solid ${cp.isAudio ? 'rgba(52,211,153,0.5)' : `rgba(${tRGB},0.5)`}`,
                                borderBottom: `2px solid ${cp.isAudio ? 'rgba(52,211,153,0.5)' : `rgba(${tRGB},0.5)`}`,
                              }}
                            />
                            <div
                              className="absolute flex items-center justify-center pointer-events-none"
                              style={{ left: 0, top: '24px', width: `${halfPx * 2}px`, height: '48px' }}
                            >
                              <span className="text-[9px] text-white/90 font-medium bg-black/55 px-1.5 py-0.5 rounded whitespace-nowrap flex items-center gap-0.5">
                                {cp.isAudio ? <ArrowLeftRight className="h-2.5 w-2.5" /> : <>{tLabel} · </>}
                                {dissolveDur.toFixed(1)}s
                              </span>
                            </div>
                            {(['left', 'right'] as const).map(side => (
                              <div
                                key={side}
                                className="absolute top-6 bottom-0 w-2 cursor-ew-resize hover:bg-blue-500/40 transition-colors z-30"
                                style={side === 'left' ? { left: 0 } : { right: 0 }}
                                title="Drag outward to lengthen, inward to shorten"
                                onMouseDown={(e) => {
                                  e.stopPropagation()
                                  e.preventDefault()
                                  const startX = e.clientX
                                  const startDur = dissolveDur
                                  const maxDur = cp.isAudio
                                    ? Math.min(cp.leftClip.duration, cp.rightClip.duration) / 2
                                    : (side === 'left' ? cp.leftClip.duration : cp.rightClip.duration) * 0.9
                                  let latest = startDur
                                  const handleMove = (ev: MouseEvent) => {
                                    // Outward is longer: left edge dragged left, right edge dragged right.
                                    const delta = (side === 'left' ? startX - ev.clientX : ev.clientX - startX) / pixelsPerSecond
                                    const newDur = +Math.max(0.1, Math.min(maxDur, startDur + delta)).toFixed(2)
                                    latest = newDur
                                    setClips(prev => prev.map(c => {
                                      if (c.id === cp.leftClip.id) {
                                        return cp.isAudio ? { ...c, audioFadeOut: newDur } : { ...c, transitionOut: { ...c.transitionOut, duration: newDur } }
                                      }
                                      if (c.id === cp.rightClip.id) {
                                        return cp.isAudio ? { ...c, audioFadeIn: newDur } : { ...c, transitionIn: { ...c.transitionIn, duration: newDur } }
                                      }
                                      return c
                                    }))
                                  }
                                  const handleUp = () => {
                                    document.removeEventListener('mousemove', handleMove)
                                    document.removeEventListener('mouseup', handleUp)
                                    document.body.style.cursor = ''
                                    document.body.style.userSelect = ''
                                    setLastSeam({ audio: cp.isAudio, type: cp.isAudio ? 'dissolve' : cp.transitionType, duration: latest })
                                  }
                                  document.addEventListener('mousemove', handleMove)
                                  document.addEventListener('mouseup', handleUp)
                                  document.body.style.cursor = 'ew-resize'
                                  document.body.style.userSelect = 'none'
                                }}
                              >
                                <div className={`absolute inset-y-0 ${side === 'left' ? 'left-0' : 'right-0'} w-0.5 ${cp.isAudio ? 'bg-emerald-300' : 'bg-blue-400'} rounded-full`} />
                              </div>
                            ))}
                          </>
                        )}

                        {/* Hover actions: add or remove the fade, and copy it to other cuts. */}
                        {isHovered && (
                          <div
                            className="absolute left-1/2 -translate-x-1/2 top-0 whitespace-nowrap z-40 flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {cp.hasTransition ? (
                              <>
                                <button
                                  className="px-2 py-0.5 rounded bg-red-900/80 border border-red-700 text-[9px] text-red-300 hover:bg-red-800 transition-colors shadow-lg"
                                  onClick={() => removeCrossDissolve(cp.leftClip.id, cp.rightClip.id)}
                                >
                                  Remove
                                </button>
                                {laterSeams.length > 0 && (
                                  <button
                                    className="px-2 py-0.5 rounded bg-zinc-800/90 border border-zinc-600 text-[9px] text-zinc-200 hover:bg-zinc-700 transition-colors shadow-lg"
                                    title={`Copy this ${dissolveDur.toFixed(1)}s fade to the ${laterSeams.length} later cut${laterSeams.length === 1 ? '' : 's'} on this track`}
                                    onClick={() => {
                                      const spec = { audio: cp.isAudio, type: cp.isAudio ? 'dissolve' as TransitionType : cp.transitionType, duration: dissolveDur }
                                      applySeamSpec(laterSeams, spec)
                                      setLastSeam(spec)
                                    }}
                                  >
                                    All forward ▸ ({laterSeams.length})
                                  </button>
                                )}
                              </>
                            ) : (
                              <>
                                <button
                                  className={`px-2 py-1 rounded-lg border text-[10px] text-white transition-colors shadow-lg flex items-center gap-1 ${
                                    cp.isAudio ? 'bg-emerald-600/90 border-emerald-500 hover:bg-emerald-500' : 'bg-blue-600/90 border-blue-500 hover:bg-blue-500'
                                  }`}
                                  onClick={() => {
                                    addCrossDissolve(cp.leftClip.id, cp.rightClip.id)
                                    setLastSeam({ audio: cp.isAudio, type: 'dissolve', duration: DEFAULT_DISSOLVE_DURATION })
                                  }}
                                >
                                  {cp.isAudio ? <ArrowLeftRight className="h-3 w-3" /> : <Film className="h-3 w-3" />}
                                  {cp.isAudio ? 'Crossfade' : 'Dissolve'}
                                </button>
                                {lastSeam && lastSeam.audio === cp.isAudio && (
                                  <>
                                    <button
                                      className="px-2 py-1 rounded-lg bg-zinc-800/90 border border-zinc-600 text-[10px] text-zinc-200 hover:bg-zinc-700 transition-colors shadow-lg"
                                      title="Use the fade you placed last on this cut"
                                      onClick={() => applySeamSpec([cp], lastSeam)}
                                    >
                                      Last: {cp.isAudio ? 'crossfade' : lastSeam.type.replace('fade-to-', 'fade ')} {lastSeam.duration.toFixed(1)}s
                                    </button>
                                    <button
                                      className="px-2 py-1 rounded-lg bg-zinc-800/90 border border-zinc-600 text-[10px] text-zinc-200 hover:bg-zinc-700 transition-colors shadow-lg"
                                      title="Use the fade you placed last on this cut and every later cut on this track"
                                      onClick={() => applySeamSpec([cp, ...laterSeams], lastSeam)}
                                    >
                                      Last ▸ all forward
                                    </button>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>{/* close relative inner */}
              </div>{/* close trackContainerRef */}
              <TimelineScrollbar containerRef={trackContainerRef} contentWidth={timelineExtent * pixelsPerSecond} />
              </div>{/* close content column */}
            </div>{/* close scrollable area row */}
            </div>{/* close tracks body flex-col */}
          </div>
        </div>
        
        {/* Bottom toolbar with zoom bar */}
        <div className="h-9 bg-zinc-900 border-t border-zinc-800 flex items-center px-3 gap-2 flex-shrink-0">
          {selectedClip && (
            <>
              <div className="w-px h-4 bg-zinc-700" />
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                <Gauge className="h-3 w-3" />
                <select
                  value={selectedClip.speed}
                  onChange={(e) => {
                    const newSpeed = parseFloat(e.target.value)
                    const oldSpeed = selectedClip.speed
                    let newDuration = selectedClip.duration * (oldSpeed / newSpeed)
                    const maxDur = getMaxClipDuration({ ...selectedClip, speed: newSpeed })
                    newDuration = Math.min(newDuration, maxDur)
                    newDuration = Math.max(0.5, newDuration)
                    updateClip(selectedClip.id, { speed: newSpeed, duration: newDuration })
                  }}
                  className="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-white"
                >
                  <option value={0.25}>0.25x</option>
                  <option value={0.5}>0.5x</option>
                  <option value={0.75}>0.75x</option>
                  <option value={1}>1x</option>
                  <option value={1.25}>1.25x</option>
                  <option value={1.5}>1.5x</option>
                  <option value={2}>2x</option>
                  <option value={4}>4x</option>
                </select>
              </div>
            </>
          )}
          
          <div className="w-px h-4 bg-zinc-700" />
          
          <Button
            variant="outline"
            size="sm"
            className="h-6 border-zinc-700 text-zinc-400 text-[10px] px-2"
            onClick={() => actions.openExportModal()}
          >
            <Upload className="h-3 w-3 mr-1" />
            Export
          </Button>
          
          
          {/* Subtitle import/export */}
          {tracks.some(t => t.type === 'subtitle') && (
            <>
              <div className="w-px h-4 bg-zinc-700" />
              <div className="flex items-center gap-1">
                <button
                  onClick={() => subtitleFileInputRef.current?.click()}
                  className="h-6 px-2 rounded bg-amber-900/30 border border-amber-700/30 text-amber-400 hover:bg-amber-900/50 text-[10px] flex items-center gap-1 transition-colors"
                  title="Import SRT subtitles"
                >
                  <FileUp className="h-3 w-3" />
                  Import SRT
                </button>
                <button
                  onClick={handleExportSrt}
                  disabled={subtitles.length === 0}
                  className="h-6 px-2 rounded bg-amber-900/30 border border-amber-700/30 text-amber-400 hover:bg-amber-900/50 text-[10px] flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Export SRT subtitles"
                >
                  <FileDown className="h-3 w-3" />
                  Export SRT
                </button>
              </div>
              <input
                ref={subtitleFileInputRef}
                type="file"
                accept=".srt"
                onChange={handleImportSrt}
                className="hidden"
              />
            </>
          )}
          
          <div className="w-px h-4 bg-zinc-700" />
          {/* Timeline length: how far the timeline runs. Bare number = minutes. */}
          <div className="flex items-center gap-1 text-[10px] text-zinc-400">
            <span>Length</span>
            {editingLength ? (
              <input
                autoFocus
                value={lengthInput}
                onChange={(e) => setLengthInput(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') commitLength()
                  else if (e.key === 'Escape') setEditingLength(false)
                }}
                onBlur={commitLength}
                placeholder="min or mm:ss"
                className="w-20 h-6 bg-zinc-950 border border-zinc-700 rounded px-1.5 text-[10px] text-amber-400 font-mono outline-none"
              />
            ) : (
              <Tooltip content="Set how long the timeline runs (e.g. 30 = 30 minutes). Clear to follow the clips." side="top">
                <button
                  onClick={() => {
                    setLengthInput(timelineLength ? formatLength(timelineLength) : '')
                    setEditingLength(true)
                  }}
                  className="h-6 px-1.5 rounded bg-zinc-800 border border-zinc-700 text-[10px] font-mono text-amber-400 hover:border-zinc-500 tabular-nums"
                >
                  {timelineLength ? formatLength(timelineLength) : 'Auto'}
                </button>
              </Tooltip>
            )}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Zoom slider bar */}
          <div className="flex items-center gap-2">
            <Tooltip content="Zoom out (-)" side="top">
              <button
                onClick={() => { centerOnPlayheadRef.current = true; setZoom(stepZoom(zoom, -1, getMinZoom())) }}
                className="p-0.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <input
              type="range"
              min={0}
              max={ZOOM_SLIDER_MAX}
              step={1}
              value={zoomToSlider(zoom, getMinZoom())}
              onChange={(e) => { centerOnPlayheadRef.current = true; setZoom(sliderToZoom(parseInt(e.target.value), getMinZoom())) }}
              className="w-28 h-1 accent-blue-500 cursor-pointer"
              title={`Zoom: ${formatZoom(zoom)}`}
            />
            <Tooltip content="Zoom in (+)" side="top">
              <button
                onClick={() => { centerOnPlayheadRef.current = true; setZoom(stepZoom(zoom, 1, getMinZoom())) }}
                className="p-0.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <span className="text-[10px] text-zinc-500 tabular-nums w-9 text-right">{formatZoom(zoom)}</span>
            <Tooltip content="Zoom to selected clips (drag-select clips first)" side="top">
              <button
                onClick={handleZoomToSelection}
                disabled={selectedClipIds.size === 0}
                className="p-0.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors ml-0.5 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Crosshair className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
            <Tooltip content="Fit to view (Ctrl+0)" side="top">
              <button
                onClick={handleFitToView}
                className="p-0.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors ml-0.5"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          </div>
        </div>
        </div>
      {clipContextMenu && (
        <ClipContextMenu
          clipContextMenu={clipContextMenu}
          contextClip={contextClip}
          clipContextMenuRef={clipContextMenuRef}
          clips={clips}
          tracks={tracks}
          selectedClipIds={selectedClipIds}
          setSelectedClipIds={setSelectedClipIds}
          currentTime={currentTime}
          hasClipboard={hasClipboard}
          isRegenerating={isRegenerating}
          currentProjectId={currentProjectId}
          updateAsset={updateAsset}
          handleCopy={handleCopy}
          handleCut={handleCut}
          handlePaste={handlePaste}
          setClipContextMenu={setClipContextMenu}
          addTextClip={addTextClip}
          setClips={setClips}
          handleRegenerate={handleRegenerate}
          handleCancelRegeneration={handleCancelRegeneration}
          canCancelInFlight={canCancelInFlight}
          handleClipTakeChange={handleClipTakeChange}
          handleDeleteTake={handleDeleteTake}
          duplicateClip={duplicateClip}
          splitClipAtPlayhead={splitClipAtPlayhead}
          removeClip={removeClip}
          updateClip={updateClip}
          getLiveAsset={getLiveAsset}
          getMaxClipDuration={getMaxClipDuration}
          onRevealAsset={onRevealAsset}
          onCreateVideoFromImage={onCreateVideoFromImage}
          onRetakeClip={requestRetakeClip}
          onICLoraClip={handleICLoraClip}
          canUseIcLora={canUseIcLora}
          canUseRetake={canUseRetake}
          onCaptureFrameForVideo={onCaptureFrameForVideo}
          onCreateVideoFromAudio={onCreateVideoFromAudio}
          copyFadesForward={copyFadesForward}
        />
      )}
      {selectedGap && tracks[selectedGap.trackIndex]?.kind !== 'audio' && (
        <GapGenerationModal
          selectedGap={selectedGap}
          anchorPosition={selectedGapAnchor}
          gapGenerateMode={gapGenerateMode}
          setGapGenerateMode={setGapGenerateMode}
          gapPrompt={gapPrompt}
          setGapPrompt={setGapPrompt}
          gapSuggesting={gapSuggesting}
          gapSuggestion={gapSuggestion}
          gapBeforeFrame={gapBeforeFrame}
          gapAfterFrame={gapAfterFrame}
          gapSettings={gapSettings}
          setGapSettings={setGapSettings}
          gapVideoModelSpecs={gapVideoModelSpecs}
          gapVideoSettingsMessage={gapVideoSettingsMessage}
          gapCanGenerateVideo={gapCanGenerateVideo}
          gapImageFile={gapImageFile}
          setGapImageFile={setGapImageFile}
          gapImageInputRef={gapImageInputRef}
          isRegenerating={gapGenerationApi.isGenerating}
          regenStatusMessage={gapGenerationApi.statusMessage}
          regenProgress={gapGenerationApi.progress}
          regenReset={gapGenerationApi.reset}
          handleGapGenerate={handleGapGenerate}
          handleCloseGap={handleCloseGap}
          setSelectedGap={setSelectedGap}
          gapApplyAudioToTrack={gapApplyAudioToTrack}
          setGapApplyAudioToTrack={setGapApplyAudioToTrack}
          regenerateSuggestion={regenerateSuggestion}
          gapSuggestionError={gapSuggestionError}
          gapSuggestionNoApiKey={gapSuggestionNoApiKey}
        />
      )}
    </>
  )
}

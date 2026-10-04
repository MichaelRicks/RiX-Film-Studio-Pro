import { useEffect, useState } from 'react'
import { shallow } from 'zustand/vanilla/shallow'
import {
  Trash2, FileVideo, FileImage, FileAudio, Layers, Type,
  FlipHorizontal2, FlipVertical2, ChevronDown, ChevronRight,
  Palette, Eye, Sun, Contrast, Droplets, Thermometer,
  SunDim, Moon, RotateCcw, Film, // EFFECTS HIDDEN: removed EyeOff, Sparkles, Plus, X
  AlignLeft, AlignCenter, AlignRight, Diamond, ChevronLeft, Eraser,
} from 'lucide-react'
import type { Asset, ClipLayerFrame, TimelineClip, LetterboxSettings, TextOverlayStyle, TransitionType } from '../../types/project-model' // EFFECTS HIDDEN: removed EffectMask
import { DEFAULT_COLOR_CORRECTION, DEFAULT_LETTERBOX } from '../../types/project-model' // EFFECTS HIDDEN: removed EFFECT_DEFINITIONS, DEFAULT_EFFECT_MASK
import { TEXT_PRESETS } from '../../types/project'
import { namedResolutionTier } from '../../lib/video-resolution'
import { clipLayerAt, DEFAULT_LAYER_FADE, formatTime, isLayerClip } from './video-editor-utils'
import { Tooltip } from '../../components/ui/tooltip'
import {
  selectAssets,
  selectClips,
  selectCurrentTime,
  selectSelectedClipAudioControls,
  selectSelectedClipForProperties,
  selectTracks,
} from './editor-selectors'
import { useEditorActions, useEditorStore } from './editor-store'
import { FontPicker } from '../../components/FontPicker'
import { FilmLookPicker } from './FilmLookPicker'
import { FILM_LOOKS_BY_ID } from '../../../shared/film-looks'
import { pathToFileUrl } from '../../lib/file-url'
import { setOpacityPreview } from './text-opacity-preview'
import { OpacityKeyframeRow } from './OpacityKeyframeRow'
import { fontHasBold } from '../../../shared/font-catalog'

interface ClipPropertiesPanelProps {
  onCreateVideoFromImage: (clip: TimelineClip) => void
}

export function ClipPropertiesPanel(props: ClipPropertiesPanelProps) {
  const {
    onCreateVideoFromImage,
  } = props
  const {
    addClipLayerKey,
    clearClipLayerKeys,
    deleteClipDisplayedTake,
    removeClipLayerKey,
    resetClipLayer,
    setClipAudioLevel,
    setClipAudioMuted,
    setClipComposite,
    setClipLayerAt,
    setCurrentTime,
    updateClip,
  } = useEditorActions()
  // Keeps W and H in step while resizing from the panel (the preview's corner
  // handles already do this; its edge handles are the way to stretch one axis).
  const [linkLayerScale, setLinkLayerScale] = useState(true)
  const currentTime = useEditorStore(selectCurrentTime)
  // Opacity value dialed in between keyframes, not yet committed with ◆.
  const [pendingOpacity, setPendingOpacity] = useState<{ clipId: string; t: number; value: number } | null>(null)
  // Volume dialed in between keyframes, not yet committed with ◆ (percent, like the row).
  const [pendingVolume, setPendingVolume] = useState<{ clipId: string; t: number; value: number } | null>(null)
  const assets = useEditorStore(selectAssets)
  const clips = useEditorStore(selectClips)
  const tracks = useEditorStore(selectTracks)
  const selectedClip = useEditorStore(selectSelectedClipForProperties)
  const clipAudioControls = useEditorStore(selectSelectedClipAudioControls, shallow)
  // Show the pending value in the program monitor right away, for as long as it
  // still applies (same clip, playhead hasn't moved off that spot).
  const pendingLive = pendingOpacity && selectedClip?.id === pendingOpacity.clipId &&
    Math.abs((currentTime - (selectedClip?.startTime ?? 0)) - pendingOpacity.t) < 1 / 48
    ? pendingOpacity
    : null
  useEffect(() => {
    setOpacityPreview(pendingLive ? { clipId: pendingLive.clipId, value: pendingLive.value } : null)
  }, [pendingLive?.clipId, pendingLive?.value])
  useEffect(() => () => setOpacityPreview(null), [])
  if (!selectedClip) return null

  const effectiveMuted = clipAudioControls?.muted ?? (selectedClip.muted || false)
  const effectiveVolume = clipAudioControls?.volume ?? (selectedClip.volume ?? 1)

  const getLiveAsset = (clip: TimelineClip): Asset | null | undefined => {
    if (!clip.assetId) return clip.asset
    return assets.find(asset => asset.id === clip.assetId) || clip.asset
  }

  const getMaxClipDuration = (clip: TimelineClip): number => {
    const liveAsset = getLiveAsset(clip)
    if (clip.type !== 'video' || !liveAsset?.duration) return Infinity
    const mediaDuration = liveAsset.duration
    const usableMedia = mediaDuration - clip.trimStart - clip.trimEnd
    return Math.max(0.5, usableMedia / clip.speed)
  }

  const handleDeleteDisplayedTake = () => {
    deleteClipDisplayedTake(selectedClip.id)
  }

  const [propertiesTab, setPropertiesTab] = useState<'properties' | 'metadata'>('properties')
  const [showFlip, setShowFlip] = useState(false)
  const [showTransitions, setShowTransitions] = useState(false)
  const [showColorCorrection, setShowColorCorrection] = useState(false)
  const [showFilmLook, setShowFilmLook] = useState(true)

  const getClipDimensions = (clip: TimelineClip): { width: number; height: number } | null => {
    if (clip.type === 'audio') return null
    const liveAsset = getLiveAsset(clip)
    if (!liveAsset) return null

    const takeIndex = clip.takeIndex ?? liveAsset.activeTakeIndex
    if (liveAsset.takes && liveAsset.takes.length > 0 && takeIndex !== undefined) {
      const idx = Math.max(0, Math.min(takeIndex, liveAsset.takes.length - 1))
      const take = liveAsset.takes[idx]
      if (take.width && take.height) {
        return { width: take.width, height: take.height }
      }
    }

    if (liveAsset.width && liveAsset.height) {
      return { width: liveAsset.width, height: liveAsset.height }
    }

    return null
  }

  const isTextClip = selectedClip.type === 'text'
  const hasPlaybackControls = selectedClip.type === 'video' || selectedClip.type === 'audio'
  const hasAudioControls = selectedClip.type === 'video' || selectedClip.type === 'audio'
  const hasVisualTransformControls = selectedClip.type === 'video' || selectedClip.type === 'image'
  const hasTransitionControls = selectedClip.type === 'video' || selectedClip.type === 'image'
  const hasColorCorrectionControls = selectedClip.type === 'video' || selectedClip.type === 'image'

  // The swatches grade the clip's own still, so the grid shows this shot in each
  // look rather than a stock sample.
  const filmLookAsset = getLiveAsset(selectedClip)
  const filmLookThumbnailPath = filmLookAsset?.smallThumbnailPath
    ?? filmLookAsset?.bigThumbnailPath
    ?? (selectedClip.type === 'image' ? filmLookAsset?.path : undefined)
  const filmLookThumbnailUrl = filmLookThumbnailPath ? pathToFileUrl(filmLookThumbnailPath) : null
  const activeFilmLookName = selectedClip.filmLook
    ? FILM_LOOKS_BY_ID.get(selectedClip.filmLook.presetId)?.name ?? null
    : null

  return (
    <div className="h-full w-full flex-shrink-0 border-l border-zinc-800 bg-zinc-900 p-4 overflow-auto">
      {/* Tab header */}
      <div className="flex items-center gap-0 mb-4 border-b border-zinc-700">
        <button
          className={`px-3 py-1.5 text-xs font-semibold transition-colors border-b-2 ${
            propertiesTab === 'properties'
              ? 'text-white border-blue-500'
              : 'text-zinc-500 border-transparent hover:text-zinc-300'
          }`}
          onClick={() => setPropertiesTab('properties')}
        >
          Properties
        </button>
        <button
          className={`px-3 py-1.5 text-xs font-semibold transition-colors border-b-2 ${
            propertiesTab === 'metadata'
              ? 'text-white border-blue-500'
              : 'text-zinc-500 border-transparent hover:text-zinc-300'
          }`}
          onClick={() => setPropertiesTab('metadata')}
        >
          Metadata
        </button>
      </div>

      {/* Metadata Tab */}
      {propertiesTab === 'metadata' && (() => {
        const liveAsset = getLiveAsset(selectedClip)
        const dims = getClipDimensions(selectedClip)
        const genParams = liveAsset?.generationParams

        // Current take info
        const totalTakes = liveAsset?.takes?.length || 1
        const currentTakeIdx = selectedClip.takeIndex ?? (liveAsset?.activeTakeIndex ?? (totalTakes - 1))
        const displayTakeNum = Math.min(currentTakeIdx, totalTakes - 1) + 1

        // Get the file path for the current take
        let filePath = liveAsset?.path || ''
        if (liveAsset?.takes && liveAsset.takes.length > 0 && selectedClip.takeIndex !== undefined) {
          const idx = Math.max(0, Math.min(selectedClip.takeIndex, liveAsset.takes.length - 1))
          filePath = liveAsset.takes[idx].path
        }

        // Determine if this is an upscaled take (take index > 0 and resolution is higher than original)
        const originalRes = liveAsset?.generationParams?.resolution
        const qualityTier = dims ? namedResolutionTier(Math.min(dims.width, dims.height)) : 0
        const isUpscaled = dims && originalRes ? qualityTier > parseInt(originalRes, 10) : false

        return (
          <div className="space-y-3">
            {/* Currently Displayed */}
            <div className="space-y-2">
              <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Currently Displayed</h4>
              <div className="bg-zinc-800/60 rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Take</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-white font-medium">{displayTakeNum} / {totalTakes}</span>
                    {totalTakes > 1 && (
                      <Tooltip content="Delete this take" side="left">
                        <button
                          onClick={() => {
                            if (confirm(`Delete take ${displayTakeNum}?`)) {
                              handleDeleteDisplayedTake()
                            }
                          }}
                          className="p-0.5 rounded hover:bg-red-900/50 text-zinc-500 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>
                {dims ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-400">Quality</span>
                      <span className="text-xs text-white">
                        {qualityTier >= 2160 ? 'Ultra HD' : qualityTier >= 1080 ? 'Full HD' : qualityTier >= 720 ? 'HD' : 'SD'}
                        {isUpscaled && <span className="ml-1.5 text-green-400">(Upscaled)</span>}
                      </span>
                    </div>
                    {dims.width > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-400">Dimensions</span>
                        <span className="text-xs text-white font-mono">{dims.width} × {dims.height}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-zinc-500 italic">Dimension metadata unavailable.</div>
                )}
                {originalRes && originalRes !== 'imported' && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">Original Gen</span>
                    <span className="text-xs text-zinc-500">{originalRes}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Clip Info */}
            <div className="space-y-2">
              <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Clip Info</h4>
              <div className="bg-zinc-800/60 rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Type</span>
                  <div className="flex items-center gap-1">
                    {selectedClip.type === 'video' && <FileVideo className="h-3 w-3 text-zinc-400" />}
                    {selectedClip.type === 'image' && <FileImage className="h-3 w-3 text-zinc-400" />}
                    {selectedClip.type === 'audio' && <FileAudio className="h-3 w-3 text-zinc-400" />}
                    {selectedClip.type === 'text' && <Type className="h-3 w-3 text-zinc-400" />}
                    <span className="text-xs text-white capitalize">{selectedClip.type}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Duration</span>
                  <span className="text-xs text-white">{selectedClip.duration.toFixed(2)}s</span>
                </div>
                {liveAsset?.duration && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">Source Duration</span>
                    <span className="text-xs text-white">{liveAsset.duration.toFixed(2)}s</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Speed</span>
                  <span className="text-xs text-white">{selectedClip.speed}x</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Track</span>
                  <span className="text-xs text-white">{tracks[selectedClip.trackIndex]?.name || `Track ${selectedClip.trackIndex + 1}`}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Start</span>
                  <span className="text-xs text-white">{formatTime(selectedClip.startTime)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">End</span>
                  <span className="text-xs text-white">{formatTime(selectedClip.startTime + selectedClip.duration)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Trim In</span>
                  <span className="text-xs text-white">{selectedClip.trimStart.toFixed(2)}s</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Trim Out</span>
                  <span className="text-xs text-white">{selectedClip.trimEnd.toFixed(2)}s</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Opacity</span>
                  <span className="text-xs text-white">{selectedClip.opacity}%</span>
                </div>
              </div>
            </div>

            {/* Takes */}
            {liveAsset?.takes && liveAsset.takes.length > 1 && (
              <div className="space-y-2">
                <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Takes</h4>
                <div className="bg-zinc-800/60 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">Total Takes</span>
                    <span className="text-xs text-white">{liveAsset.takes.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">Active Take</span>
                    <span className="text-xs text-white">
                      #{(selectedClip.takeIndex ?? (liveAsset.activeTakeIndex ?? liveAsset.takes.length - 1)) + 1}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Generation Parameters */}
            {genParams && (
              <div className="space-y-2">
                <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Generation</h4>
                <div className="bg-zinc-800/60 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">Mode</span>
                    <span className="text-xs text-white">{genParams.mode.replace(/-/g, ' ')}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">Model</span>
                    <span className="text-xs text-white">{genParams.model}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">Gen Resolution</span>
                    <span className="text-xs text-white">{genParams.resolution}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">FPS</span>
                    <span className="text-xs text-white">{genParams.fps}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">Duration</span>
                    <span className="text-xs text-white">{genParams.duration}s</span>
                  </div>
                  {genParams.cameraMotion && genParams.cameraMotion !== 'none' && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-400">Camera</span>
                      <span className="text-xs text-white">{genParams.cameraMotion}</span>
                    </div>
                  )}
                  {genParams.prompt && (
                    <div className="mt-2">
                      <span className="text-xs text-zinc-400 block mb-1">Prompt</span>
                      <p className="text-xs text-zinc-300 bg-zinc-900/50 rounded p-2 break-words leading-relaxed">{genParams.prompt}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* File Path */}
            {filePath && (
              <div className="space-y-2">
                <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">File</h4>
                <div className="bg-zinc-800/60 rounded-lg p-3">
                  <p className="text-[10px] text-zinc-400 break-all font-mono leading-relaxed">{filePath}</p>
                </div>
              </div>
            )}

            {/* Asset Created At */}
            {liveAsset?.createdAt && (
              <div className="space-y-2">
                <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Created</h4>
                <div className="bg-zinc-800/60 rounded-lg p-3">
                  <span className="text-xs text-zinc-300">{new Date(liveAsset.createdAt).toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* Properties Tab */}
      {propertiesTab === 'properties' && <div className="space-y-4">
        {/* Adjustment Layer properties */}
        {selectedClip.type === 'adjustment' && (() => {
          const lb = { ...DEFAULT_LETTERBOX, ...selectedClip.letterbox }
          const updateLetterbox = (patch: Partial<LetterboxSettings>) => {
            updateClip(selectedClip.id, { letterbox: { ...lb, ...patch } })
          }
          return (
            <div className="bg-blue-950/30 border border-blue-700/30 rounded-lg p-3 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Layers className="h-4 w-4 text-blue-400" />
                <h4 className="text-xs font-semibold text-blue-300">Adjustment Layer</h4>
              </div>

              {/* Letterbox toggle */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Letterbox</span>
                <button
                  onClick={() => updateLetterbox({ enabled: !lb.enabled })}
                  className={`px-2.5 py-0.5 rounded text-[10px] border transition-colors ${
                    lb.enabled
                      ? 'bg-blue-600/30 text-blue-300 border-blue-500/40'
                      : 'bg-zinc-800 text-zinc-500 border-zinc-700'
                  }`}
                >
                  {lb.enabled ? 'On' : 'Off'}
                </button>
              </div>

              {lb.enabled && (
                <>
                  {/* Aspect ratio */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-400">Aspect Ratio</span>
                    <select
                      value={lb.aspectRatio}
                      onChange={e => updateLetterbox({ aspectRatio: e.target.value as LetterboxSettings['aspectRatio'] })}
                      className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-white focus:outline-none focus:border-blue-500/50"
                    >
                      <option value="2.39:1">2.39:1 (Anamorphic)</option>
                      <option value="2.35:1">2.35:1 (Cinemascope)</option>
                      <option value="2.76:1">2.76:1 (Ultra Panavision)</option>
                      <option value="1.85:1">1.85:1 (Flat Widescreen)</option>
                      <option value="4:3">4:3 (Classic TV)</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>

                  {/* Custom ratio input */}
                  {lb.aspectRatio === 'custom' && (
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-zinc-400">Custom Ratio</span>
                      <input
                        type="number"
                        step={0.01}
                        min={1}
                        max={4}
                        value={lb.customRatio || 2.35}
                        onChange={e => updateLetterbox({ customRatio: parseFloat(e.target.value) || 2.35 })}
                        onKeyDown={e => e.stopPropagation()}
                        className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-white text-center focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                  )}

                  {/* Bar color */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-400">Bar Color</span>
                    <input
                      type="color"
                      value={lb.color}
                      onChange={e => updateLetterbox({ color: e.target.value })}
                      className="w-7 h-6 rounded cursor-pointer border border-zinc-700"
                    />
                  </div>

                  {/* Bar opacity */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-400">Bar Opacity</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="range" min={0} max={100} value={lb.opacity}
                        onChange={e => updateLetterbox({ opacity: parseInt(e.target.value) })}
                        className="w-20 accent-blue-500"
                      />
                      <span className="text-[10px] text-zinc-300 w-8 text-right tabular-nums">{lb.opacity}%</span>
                    </div>
                  </div>
                </>
              )}

              {/* Color correction note */}
              <p className="text-[9px] text-zinc-600 pt-1 border-t border-zinc-800">
                Color correction on this layer affects all tracks below.
              </p>
            </div>
          )
        })()}

        {/* Text overlay properties */}
        {selectedClip.type === 'text' && selectedClip.textStyle && (() => {
          const ts = selectedClip.textStyle
          const updateText = (patch: Partial<TextOverlayStyle>) => {
            updateClip(selectedClip.id, { textStyle: { ...ts, ...patch } })
          }
          return (
            <div className="bg-cyan-950/30 border border-cyan-700/30 rounded-lg p-3 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Type className="h-4 w-4 text-cyan-400" />
                <h4 className="text-xs font-semibold text-cyan-300">Text Overlay</h4>
              </div>

              {/* Text content */}
              <div className="space-y-1">
                <span className="text-[10px] text-zinc-400">Content</span>
                <textarea
                  value={ts.text}
                  onChange={e => updateText({ text: e.target.value })}
                  rows={3}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white resize-none focus:outline-none focus:border-cyan-500/50"
                  placeholder="Enter text..."
                />
              </div>

              {/* Font family — same list the export resolves font files from */}
              <div className="space-y-1">
                <span className="text-[10px] text-zinc-400">Font</span>
                <FontPicker value={ts.fontFamily} onChange={fontFamily => updateText({ fontFamily })} />
                {!fontHasBold(ts.fontFamily) && (
                  <p className="text-[9px] text-zinc-500">Single-weight font — Bold has no effect.</p>
                )}
              </div>

              {/* Font size */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Size</span>
                <div className="flex items-center gap-2">
                  <input type="range" min={12} max={200} value={ts.fontSize} onChange={e => updateText({ fontSize: parseInt(e.target.value) })} className="w-20 accent-cyan-500" />
                  <span className="text-[10px] text-zinc-300 w-8 text-right tabular-nums">{ts.fontSize}</span>
                </div>
              </div>

              <OpacityKeyframeRow
                clipId={selectedClip.id}
                startTime={selectedClip.startTime}
                duration={selectedClip.duration}
                keys={selectedClip.opacityKeyframes ?? []}
                staticValue={ts.opacity}
                currentTime={currentTime}
                pending={pendingOpacity}
                setPending={setPendingOpacity}
                setKeys={(next) => updateClip(selectedClip.id, { opacityKeyframes: next && next.length ? next : undefined })}
                setStatic={(v) => updateText({ opacity: v })}
                clearKeys={(v) => updateClip(selectedClip.id, { opacityKeyframes: undefined, textStyle: { ...ts, opacity: v } })}
                setCurrentTime={setCurrentTime}
              />

              {/* Font weight & style */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Weight</span>
                <select
                  value={ts.fontWeight}
                  onChange={e => updateText({ fontWeight: e.target.value as TextOverlayStyle['fontWeight'] })}
                  className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-white focus:outline-none focus:border-cyan-500/50"
                >
                  <option value="100">Thin</option>
                  <option value="300">Light</option>
                  <option value="normal">Normal</option>
                  <option value="500">Medium</option>
                  <option value="600">Semibold</option>
                  <option value="bold">Bold</option>
                  <option value="800">Extra Bold</option>
                  <option value="900">Black</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateText({ fontStyle: ts.fontStyle === 'italic' ? 'normal' : 'italic' })}
                  className={`px-2 py-1 rounded text-[10px] border ${ts.fontStyle === 'italic' ? 'bg-cyan-600/30 text-cyan-300 border-cyan-500/40' : 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}
                >
                  <em>Italic</em>
                </button>
              </div>

              {/* Text color */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Color</span>
                <input type="color" value={ts.color} onChange={e => updateText({ color: e.target.value })} className="w-7 h-6 rounded cursor-pointer border border-zinc-700" />
              </div>

              {/* Background color */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Background</span>
                <div className="flex items-center gap-1.5">
                  <input type="color" value={ts.backgroundColor === 'transparent' ? '#000000' : ts.backgroundColor.slice(0, 7)} onChange={e => updateText({ backgroundColor: e.target.value + 'cc' })} className="w-7 h-6 rounded cursor-pointer border border-zinc-700" />
                  <button
                    onClick={() => updateText({ backgroundColor: ts.backgroundColor === 'transparent' ? 'rgba(0,0,0,0.7)' : 'transparent' })}
                    className={`px-1.5 py-0.5 rounded text-[9px] border ${ts.backgroundColor !== 'transparent' ? 'bg-cyan-600/20 text-cyan-300 border-cyan-500/30' : 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}
                  >
                    {ts.backgroundColor !== 'transparent' ? 'On' : 'Off'}
                  </button>
                </div>
              </div>

              {/* Text alignment */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Align</span>
                <div className="flex gap-0.5">
                  {(['left', 'center', 'right'] as const).map(align => (
                    <button
                      key={align}
                      onClick={() => updateText({ textAlign: align })}
                      className={`p-1.5 rounded ${ts.textAlign === align ? 'bg-cyan-600/30 text-cyan-300' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'}`}
                    >
                      {align === 'left' ? <AlignLeft className="h-3 w-3" /> : align === 'center' ? <AlignCenter className="h-3 w-3" /> : <AlignRight className="h-3 w-3" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Position */}
              <div className="space-y-1.5">
                <span className="text-[10px] text-zinc-400">Position</span>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <span className="text-[9px] text-zinc-500">X</span>
                    <input type="range" min={0} max={100} value={ts.positionX} onChange={e => updateText({ positionX: parseFloat(e.target.value) })} className="w-full accent-cyan-500" />
                  </div>
                  <div className="flex-1">
                    <span className="text-[9px] text-zinc-500">Y</span>
                    <input type="range" min={0} max={100} value={ts.positionY} onChange={e => updateText({ positionY: parseFloat(e.target.value) })} className="w-full accent-cyan-500" />
                  </div>
                </div>
              </div>

              {/* Stretch (set by the preview's edge handles) */}
              {((ts.scaleX ?? 1) !== 1 || (ts.scaleY ?? 1) !== 1) && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-400">Stretch</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-300 tabular-nums">
                      W {Math.round((ts.scaleX ?? 1) * 100)}% · H {Math.round((ts.scaleY ?? 1) * 100)}%
                    </span>
                    <button
                      onClick={() => updateText({ scaleX: 1, scaleY: 1 })}
                      className="px-1.5 py-0.5 rounded text-[9px] border bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              )}

              {/* Fade in / out (opacity envelope over the clip's life) */}
              {(() => {
                const maxFade = Math.max(0.1, selectedClip.duration / 2)
                const fadeIn = Math.min(selectedClip.textFadeIn ?? 0.5, maxFade)
                const fadeOut = Math.min(selectedClip.textFadeOut ?? 0.5, maxFade)
                return (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-zinc-400">Fade In</span>
                      <div className="flex items-center gap-2">
                        <input type="range" min={0} max={maxFade} step={0.1} value={fadeIn} onChange={e => updateClip(selectedClip.id, { textFadeIn: parseFloat(e.target.value) })} className="w-20 accent-cyan-500" />
                        <span className="text-[10px] text-zinc-300 w-8 text-right tabular-nums">{fadeIn.toFixed(1)}s</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-zinc-400">Fade Out</span>
                      <div className="flex items-center gap-2">
                        <input type="range" min={0} max={maxFade} step={0.1} value={fadeOut} onChange={e => updateClip(selectedClip.id, { textFadeOut: parseFloat(e.target.value) })} className="w-20 accent-cyan-500" />
                        <span className="text-[10px] text-zinc-300 w-8 text-right tabular-nums">{fadeOut.toFixed(1)}s</span>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Stroke */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Outline</span>
                <div className="flex items-center gap-1.5">
                  <input type="range" min={0} max={10} step={0.5} value={ts.strokeWidth} onChange={e => updateText({ strokeWidth: parseFloat(e.target.value) })} className="w-16 accent-cyan-500" />
                  <input type="color" value={ts.strokeColor === 'transparent' ? '#000000' : ts.strokeColor} onChange={e => updateText({ strokeColor: e.target.value, strokeWidth: Math.max(ts.strokeWidth, 1) })} className="w-5 h-5 rounded cursor-pointer border border-zinc-700" />
                </div>
              </div>

              {/* Shadow */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Shadow</span>
                <div className="flex items-center gap-2">
                  <input type="range" min={0} max={20} value={ts.shadowBlur} onChange={e => updateText({ shadowBlur: parseInt(e.target.value) })} className="w-16 accent-cyan-500" />
                  <span className="text-[10px] text-zinc-300 w-4 text-right tabular-nums">{ts.shadowBlur}</span>
                </div>
              </div>

              {/* Presets */}
              <div className="pt-2 border-t border-zinc-800">
                <span className="text-[10px] text-zinc-400 block mb-1.5">Apply Preset</span>
                <div className="grid grid-cols-2 gap-1">
                  {TEXT_PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      // Presets restyle; they don't replace the user's words.
                      onClick={() => updateText({ ...preset.style, text: ts.text })}
                      className="px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-[9px] text-zinc-300 hover:border-cyan-500/40 hover:bg-cyan-900/20 transition-colors truncate"
                      title={preset.name}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )
        })()}

        {/* Image-to-Video quick action for image clips */}
        {selectedClip.type === 'image' && (
          <button
            onClick={() => onCreateVideoFromImage(selectedClip)}
            className="w-full px-3 py-2 rounded-lg bg-blue-600/15 border border-blue-500/30 text-blue-400 text-xs hover:bg-blue-600/25 hover:border-blue-500/50 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Film className="h-3.5 w-3.5" />
            Generate Video (I2V)
          </button>
        )}
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Start Time</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={selectedClip.startTime.toFixed(2)}
              onChange={(e) => updateClip(selectedClip.id, { startTime: Math.max(0, parseFloat(e.target.value) || 0) })}
              min={0}
              step={0.1}
              className="flex-1 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white text-sm"
            />
            <span className="text-xs text-zinc-500">sec</span>
          </div>
        </div>

        <div>
          <label className="block text-xs text-zinc-500 mb-1">Duration</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={selectedClip.duration.toFixed(2)}
              onChange={(e) => {
                let dur = Math.max(0.1, parseFloat(e.target.value) || 1)
                const maxDur = getMaxClipDuration(selectedClip)
                dur = Math.min(dur, maxDur)
                updateClip(selectedClip.id, { duration: dur })
              }}
              min={0.1}
              max={getMaxClipDuration(selectedClip)}
              step={0.1}
              className="flex-1 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white text-sm"
            />
            <span className="text-xs text-zinc-500">sec</span>
            {selectedClip.type === 'video' && selectedClip.asset?.duration && (
              <span className="text-[10px] text-zinc-600">max {getMaxClipDuration(selectedClip).toFixed(1)}s</span>
            )}
          </div>
        </div>

        {hasPlaybackControls && (
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Speed</label>
            <input
              type="range"
              min={0.25}
              max={4}
              step={0.25}
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
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
              <span>0.25x</span>
              <span className="text-white">{selectedClip.speed}x</span>
              <span>4x</span>
            </div>
          </div>
        )}

        {hasAudioControls && (() => {
          // Volume lives on the audio clip (a video clip's linked audio); its automation
          // keyframes — the timeline's rubber band, or Claude's ducking — are edited here too.
          const volumeTarget = selectedClip.type === 'audio'
            ? selectedClip
            : (selectedClip.linkedClipIds ?? [])
              .map(id => clips.find(c => c.id === id))
              .find(c => c?.type === 'audio') ?? selectedClip
          const volumeKeys = (volumeTarget.volumeKeyframes ?? []).map(k => ({ t: k.t, value: k.value * 100 }))
          return (
            <OpacityKeyframeRow
              label="Volume"
              max={200}
              clipId={volumeTarget.id}
              startTime={volumeTarget.startTime}
              duration={volumeTarget.duration}
              keys={volumeKeys}
              staticValue={Math.round((effectiveMuted ? 0 : effectiveVolume) * 100)}
              currentTime={currentTime}
              pending={pendingVolume}
              setPending={setPendingVolume}
              setKeys={(next) => updateClip(volumeTarget.id, {
                volumeKeyframes: next && next.length
                  ? next.map(k => ({ t: +k.t.toFixed(3), value: +(k.value / 100).toFixed(3) }))
                  : undefined,
              })}
              setStatic={(v) => setClipAudioLevel(selectedClip.id, v / 100)}
              clearKeys={(v) => updateClip(volumeTarget.id, { volumeKeyframes: undefined, volume: v / 100 })}
              setCurrentTime={setCurrentTime}
              accent="accent-emerald-500"
            />
          )
        })()}

        {hasAudioControls && (() => {
          const maxFade = Math.max(0.1, Math.min(5, selectedClip.duration / 2))
          return (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-zinc-500">Fade In</label>
                <span className="text-[10px] text-zinc-400 tabular-nums">{(selectedClip.audioFadeIn ?? 0).toFixed(1)}s</span>
              </div>
              <input
                type="range"
                min={0}
                max={maxFade}
                step={0.1}
                value={Math.min(selectedClip.audioFadeIn ?? 0, maxFade)}
                onChange={(e) => updateClip(selectedClip.id, { audioFadeIn: parseFloat(e.target.value) })}
                className="w-full"
              />
              <div className="flex items-center justify-between mb-1 mt-2">
                <label className="text-xs text-zinc-500">Fade Out</label>
                <span className="text-[10px] text-zinc-400 tabular-nums">{(selectedClip.audioFadeOut ?? 0).toFixed(1)}s</span>
              </div>
              <input
                type="range"
                min={0}
                max={maxFade}
                step={0.1}
                value={Math.min(selectedClip.audioFadeOut ?? 0, maxFade)}
                onChange={(e) => updateClip(selectedClip.id, { audioFadeOut: parseFloat(e.target.value) })}
                className="w-full"
              />
            </div>
          )
        })()}

        {hasAudioControls && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedClip.reversed}
                onChange={(e) => updateClip(selectedClip.id, { reversed: e.target.checked })}
                className="rounded bg-zinc-800 border-zinc-600"
              />
              <span className="text-sm text-zinc-300">Reverse playback</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={effectiveMuted}
                onChange={(e) => setClipAudioMuted(selectedClip.id, e.target.checked)}
                className="rounded bg-zinc-800 border-zinc-600"
              />
              <span className="text-sm text-zinc-300">Mute audio</span>
            </label>
          </div>
        )}

        {/* --- Opacity --- */}
        {!isTextClip && (
          <div className="pt-3 border-t border-zinc-800">
            <label className="text-xs font-semibold text-zinc-400 block mb-1.5">Opacity</label>
            <OpacityKeyframeRow
              clipId={selectedClip.id}
              startTime={selectedClip.startTime}
              duration={selectedClip.duration}
              keys={selectedClip.opacityKeyframes ?? []}
              staticValue={selectedClip.opacity ?? 100}
              currentTime={currentTime}
              pending={pendingOpacity}
              setPending={setPendingOpacity}
              setKeys={(next) => updateClip(selectedClip.id, {
                opacityKeyframes: next && next.length ? next : undefined,
                // Fading means the tracks below have to show through.
                composite: next && next.length ? true : selectedClip.composite,
              })}
              setStatic={(v) => updateClip(selectedClip.id, { opacity: v, composite: v < 100 ? true : selectedClip.composite })}
              clearKeys={(v) => updateClip(selectedClip.id, { opacityKeyframes: undefined, opacity: v })}
              setCurrentTime={setCurrentTime}
              accent="accent-blue-500"
            />
            {/* Fades, for a clip acting as a layer. A graphic that pops on and off
                reads as a glitch, so both default to half a second; 0 is a hard cut.
                A clip still filling the frame doesn't fade — it would come up from
                black at the top of every shot — so the controls only show once it is
                actually a layer. */}
            {isLayerClip(selectedClip) && (
              <div className="flex items-center gap-1.5 mt-2">
                <span className="text-[10px] text-zinc-400 w-12">Fade</span>
                <input
                  type="number" step={0.1} min={0} max={Math.max(0, selectedClip.duration / 2)}
                  value={selectedClip.fadeIn ?? DEFAULT_LAYER_FADE}
                  title="Fade up at the start, in seconds (0 = hard cut)"
                  className="w-14 px-1.5 py-1 rounded bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-200 tabular-nums focus:outline-none focus:border-blue-500"
                  onChange={(e) => updateClip(selectedClip.id, { fadeIn: Math.max(0, parseFloat(e.target.value) || 0) })}
                />
                <input
                  type="number" step={0.1} min={0} max={Math.max(0, selectedClip.duration / 2)}
                  value={selectedClip.fadeOut ?? DEFAULT_LAYER_FADE}
                  title="Fade down at the end, in seconds (0 = hard cut)"
                  className="w-14 px-1.5 py-1 rounded bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-200 tabular-nums focus:outline-none focus:border-blue-500"
                  onChange={(e) => updateClip(selectedClip.id, { fadeOut: Math.max(0, parseFloat(e.target.value) || 0) })}
                />
                <span className="text-[9px] text-zinc-500">sec in / out</span>
              </div>
            )}
          </div>
        )}

        {/* --- Transform: place and size a clip in the frame (logos, graphics,
               punch-ins). Keyframe it to animate. Dragging the box in the program
               monitor writes the same values. --- */}
        {hasVisualTransformControls && (() => {
          const localT = currentTime - selectedClip.startTime
          const inClip = localT >= -1e-3 && localT <= selectedClip.duration + 1e-3
          const t = Math.max(0, Math.min(selectedClip.duration, localT))
          const frame = clipLayerAt(selectedClip, t)
          const keys = [...(selectedClip.layer?.keys ?? [])].sort((a, b) => a.t - b.t)
          const KEY_EPS = 1 / 48
          const keyIdx = keys.findIndex(k => Math.abs(k.t - t) < KEY_EPS)
          const prevKey = [...keys].reverse().find(k => k.t < t - KEY_EPS)
          const nextKey = keys.find(k => k.t > t + KEY_EPS)
          const iconBtn = 'p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent'
          const num = 'w-14 px-1.5 py-1 rounded bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-200 tabular-nums focus:outline-none focus:border-blue-500'
          const set = (patch: Partial<ClipLayerFrame>) => setClipLayerAt(selectedClip.id, t, patch)
          const pct = (v: number) => Math.round(v * 1000) / 10
          return (
            <div className="pt-3 border-t border-zinc-800">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-zinc-400">Transform</label>
                {selectedClip.layer && (
                  <Tooltip content="Reset to fill the frame" side="left">
                    <button onClick={() => resetClipLayer(selectedClip.id)} className={iconBtn}>
                      <RotateCcw className="h-3 w-3" />
                    </button>
                  </Tooltip>
                )}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-400 w-12">Position</span>
                  <input
                    type="number" step={1} value={pct(frame.x)} className={num} title="Horizontal center, % of frame width"
                    onChange={(e) => set({ x: (parseFloat(e.target.value) || 0) / 100 })}
                  />
                  <input
                    type="number" step={1} value={pct(frame.y)} className={num} title="Vertical center, % of frame height"
                    onChange={(e) => set({ y: (parseFloat(e.target.value) || 0) / 100 })}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-400 w-12">Size</span>
                  <input
                    type="number" step={1} min={2} value={pct(frame.scaleX)} className={num} title="Width, % of the size it fills the frame at"
                    onChange={(e) => {
                      const v = Math.max(0.02, (parseFloat(e.target.value) || 0) / 100)
                      set(linkLayerScale ? { scaleX: v, scaleY: v } : { scaleX: v })
                    }}
                  />
                  <input
                    type="number" step={1} min={2} value={pct(frame.scaleY)} className={num} title="Height, % of the size it fills the frame at"
                    onChange={(e) => {
                      const v = Math.max(0.02, (parseFloat(e.target.value) || 0) / 100)
                      set(linkLayerScale ? { scaleX: v, scaleY: v } : { scaleY: v })
                    }}
                  />
                  <label className="flex items-center gap-1 cursor-pointer" title="Keep width and height in proportion">
                    <input
                      type="checkbox" checked={linkLayerScale}
                      onChange={(e) => setLinkLayerScale(e.target.checked)}
                      className="rounded bg-zinc-800 border-zinc-600"
                    />
                    <span className="text-[9px] text-zinc-500">Link</span>
                  </label>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-amber-300/80 tabular-nums">
                    {keys.length > 0
                      ? `${keys.length} key${keys.length === 1 ? '' : 's'}${keyIdx >= 0 ? ` · on key ${keyIdx + 1}` : ''}`
                      : 'Not animated'}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => addClipLayerKey(selectedClip.id, t)}
                      disabled={!inClip}
                      className={`${iconBtn} ${keyIdx >= 0 ? 'text-amber-300' : 'text-amber-300/70'}`}
                      title={inClip ? 'Keyframe this position and size at the playhead' : 'Move the playhead over this clip to add a keyframe'}
                    >
                      <Diamond className={`h-3 w-3 ${keyIdx >= 0 ? 'fill-current' : ''}`} />
                    </button>
                    <button onClick={() => prevKey && setCurrentTime(selectedClip.startTime + prevKey.t)} disabled={!prevKey} className={iconBtn} title="Previous keyframe">
                      <ChevronLeft className="h-3 w-3" />
                    </button>
                    <button onClick={() => nextKey && setCurrentTime(selectedClip.startTime + nextKey.t)} disabled={!nextKey} className={iconBtn} title="Next keyframe">
                      <ChevronRight className="h-3 w-3" />
                    </button>
                    <button onClick={() => removeClipLayerKey(selectedClip.id, keyIdx)} disabled={keyIdx < 0} className={iconBtn} title="Delete the keyframe at the playhead">
                      <Trash2 className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => clearClipLayerKeys(selectedClip.id, t)}
                      disabled={keys.length === 0}
                      className={iconBtn}
                      title="Clear keyframes (keeps the current position and size)"
                    >
                      <Eraser className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer pt-0.5" title="Draw over the tracks below instead of replacing them. Needed for a full-frame logo with transparency.">
                  <input
                    type="checkbox"
                    checked={selectedClip.composite ?? false}
                    onChange={(e) => setClipComposite(selectedClip.id, e.target.checked)}
                    className="rounded bg-zinc-800 border-zinc-600"
                  />
                  <span className="text-[11px] text-zinc-300">Composite over lower tracks</span>
                </label>
              </div>
            </div>
          )
        })()}

        {/* --- Flip --- */}
        {hasVisualTransformControls && (
          <div className="pt-3 border-t border-zinc-800">
            <button
              className="flex items-center gap-2 w-full text-left text-xs font-semibold text-zinc-400 hover:text-white transition-colors mb-2"
              onClick={() => setShowFlip(!showFlip)}
            >
              {showFlip ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <FlipHorizontal2 className="h-3.5 w-3.5" />
              Flip
            </button>
            {showFlip && (
              <div className="space-y-2 pl-5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedClip.flipH}
                    onChange={(e) => updateClip(selectedClip.id, { flipH: e.target.checked })}
                    className="rounded bg-zinc-800 border-zinc-600"
                  />
                  <FlipHorizontal2 className="h-3.5 w-3.5 text-zinc-400" />
                  <span className="text-sm text-zinc-300">Horizontal</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedClip.flipV}
                    onChange={(e) => updateClip(selectedClip.id, { flipV: e.target.checked })}
                    className="rounded bg-zinc-800 border-zinc-600"
                  />
                  <FlipVertical2 className="h-3.5 w-3.5 text-zinc-400" />
                  <span className="text-sm text-zinc-300">Vertical</span>
                </label>
              </div>
            )}
          </div>
        )}

        {/* --- Transitions --- */}
        {hasTransitionControls && (
          <div className="pt-3 border-t border-zinc-800">
            <button
              className="flex items-center gap-2 w-full text-left text-xs font-semibold text-zinc-400 hover:text-white transition-colors mb-2"
              onClick={() => setShowTransitions(!showTransitions)}
            >
              {showTransitions ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <Film className="h-3.5 w-3.5" />
              Transitions
            </button>
            {showTransitions && (
              <div className="space-y-3 pl-5">
                {/* Drag-to-seam palette: drop a centered transition onto a cut
                    between two clips in the timeline. */}
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-1 uppercase tracking-wider">Drag onto a cut</label>
                  <div className="flex flex-wrap gap-1.5">
                    {([
                      { type: 'dissolve', label: 'Dissolve' },
                      { type: 'fade-to-black', label: 'Fade Black' },
                      { type: 'fade-to-white', label: 'Fade White' },
                      { type: 'wipe-left', label: 'Wipe ◄' },
                      { type: 'wipe-right', label: 'Wipe ►' },
                      { type: 'wipe-up', label: 'Wipe ▲' },
                      { type: 'wipe-down', label: 'Wipe ▼' },
                    ] as { type: TransitionType; label: string }[]).map(item => (
                      <div
                        key={item.type}
                        draggable
                        onDragStart={(e) => {
                          // NB: HTML5 DnD lowercases the type key, so use lowercase
                          // everywhere (matches the timeline's drop handlers).
                          e.dataTransfer.setData('transitiontype', item.type)
                          e.dataTransfer.effectAllowed = 'copy'
                        }}
                        title={`${item.label} — drag onto a cut between two clips`}
                        className="px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-[10px] text-zinc-300 cursor-grab active:cursor-grabbing hover:border-blue-500/60 hover:text-white transition-colors select-none"
                      >
                        {item.label}
                      </div>
                    ))}
                  </div>
                  <p className="text-[9px] text-zinc-600 mt-1">Drops a centered transition on the seam.</p>
                </div>
                {/* Transition In */}
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-1 uppercase tracking-wider">Transition In</label>
                  <select
                    value={selectedClip.transitionIn?.type || 'none'}
                    onChange={(e) => updateClip(selectedClip.id, {
                      transitionIn: { ...selectedClip.transitionIn, type: e.target.value as TransitionType }
                    })}
                    className="w-full px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white text-xs"
                  >
                    <option value="none">None</option>
                    <option value="dissolve">Dissolve</option>
                    <option value="fade-to-black">Fade from Black</option>
                    <option value="fade-to-white">Fade from White</option>
                    <option value="wipe-left">Wipe Left</option>
                    <option value="wipe-right">Wipe Right</option>
                    <option value="wipe-up">Wipe Up</option>
                    <option value="wipe-down">Wipe Down</option>
                  </select>
                  {selectedClip.transitionIn?.type !== 'none' && (
                    <div className="mt-1.5">
                      <label className="block text-[10px] text-zinc-600 mb-0.5">Duration</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={0.1}
                          max={Math.min(2, selectedClip.duration / 2)}
                          step={0.1}
                          value={selectedClip.transitionIn?.duration || 0.5}
                          onChange={(e) => updateClip(selectedClip.id, {
                            transitionIn: { ...selectedClip.transitionIn, duration: parseFloat(e.target.value) }
                          })}
                          className="flex-1"
                        />
                        <span className="text-[10px] text-zinc-400 w-6 text-right">{(selectedClip.transitionIn?.duration || 0.5).toFixed(1)}s</span>
                      </div>
                    </div>
                  )}
                </div>
                {/* Transition Out */}
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-1 uppercase tracking-wider">Transition Out</label>
                  <select
                    value={selectedClip.transitionOut?.type || 'none'}
                    onChange={(e) => updateClip(selectedClip.id, {
                      transitionOut: { ...selectedClip.transitionOut, type: e.target.value as TransitionType }
                    })}
                    className="w-full px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-white text-xs"
                  >
                    <option value="none">None</option>
                    <option value="dissolve">Dissolve</option>
                    <option value="fade-to-black">Fade to Black</option>
                    <option value="fade-to-white">Fade to White</option>
                    <option value="wipe-left">Wipe Left</option>
                    <option value="wipe-right">Wipe Right</option>
                    <option value="wipe-up">Wipe Up</option>
                    <option value="wipe-down">Wipe Down</option>
                  </select>
                  {selectedClip.transitionOut?.type !== 'none' && (
                    <div className="mt-1.5">
                      <label className="block text-[10px] text-zinc-600 mb-0.5">Duration</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={0.1}
                          max={Math.min(2, selectedClip.duration / 2)}
                          step={0.1}
                          value={selectedClip.transitionOut?.duration || 0.5}
                          onChange={(e) => updateClip(selectedClip.id, {
                            transitionOut: { ...selectedClip.transitionOut, duration: parseFloat(e.target.value) }
                          })}
                          className="flex-1"
                        />
                        <span className="text-[10px] text-zinc-400 w-6 text-right">{(selectedClip.transitionOut?.duration || 0.5).toFixed(1)}s</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* EFFECTS HIDDEN - Applied Effects section hidden because effects are not applied during export */}

        {/* --- Film Look --- */}
        {hasColorCorrectionControls && (
          <div className="pt-3 border-t border-zinc-800">
            <button
              className="flex items-center gap-2 w-full text-left text-xs font-semibold text-zinc-400 hover:text-white transition-colors mb-2"
              onClick={() => setShowFilmLook(!showFilmLook)}
            >
              {showFilmLook ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <Film className="h-3.5 w-3.5" />
              Film Look
              {activeFilmLookName && (
                <span className="ml-auto text-[10px] font-normal text-zinc-500 truncate max-w-[90px]">
                  {activeFilmLookName}
                </span>
              )}
            </button>
            {showFilmLook && (
              <FilmLookPicker
                value={selectedClip.filmLook}
                thumbnailUrl={filmLookThumbnailUrl}
                onChange={(next) => updateClip(selectedClip.id, { filmLook: next })}
                onApplyToAll={() => {
                  const look = selectedClip.filmLook
                  if (!look) return
                  for (const c of clips) {
                    if (c.type === 'video' || c.type === 'image') updateClip(c.id, { filmLook: { ...look } })
                  }
                }}
              />
            )}
          </div>
        )}

        {/* --- Color Correction --- */}
        {hasColorCorrectionControls && (
          <div className="pt-3 border-t border-zinc-800">
            <button
              className="flex items-center gap-2 w-full text-left text-xs font-semibold text-zinc-400 hover:text-white transition-colors mb-2"
              onClick={() => setShowColorCorrection(!showColorCorrection)}
            >
              {showColorCorrection ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <Palette className="h-3.5 w-3.5" />
              Color Correction
              {selectedClip.colorCorrection && Object.values(selectedClip.colorCorrection).some(v => v !== 0) && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
              )}
            </button>
            {showColorCorrection && (
              <div className="space-y-2.5 pl-1">
              <button
                className="flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-blue-400 transition-colors"
                onClick={() => updateClip(selectedClip.id, { colorCorrection: { ...DEFAULT_COLOR_CORRECTION } })}
              >
                <RotateCcw className="h-3 w-3" />
                Reset All
              </button>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <Eye className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Exposure</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.exposure || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.exposure || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), exposure: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <Sun className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Brightness</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.brightness || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.brightness || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), brightness: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <Contrast className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Contrast</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.contrast || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.contrast || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), contrast: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <Droplets className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Saturation</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.saturation || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.saturation || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), saturation: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <Thermometer className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Temperature</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.temperature || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.temperature || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), temperature: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
                <div className="flex justify-between text-[9px] text-zinc-600 mt-0.5">
                  <span>Cool</span>
                  <span>Warm</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <Palette className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Tint</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.tint || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.tint || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), tint: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
                <div className="flex justify-between text-[9px] text-zinc-600 mt-0.5">
                  <span>Green</span>
                  <span>Magenta</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <SunDim className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Highlights</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.highlights || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.highlights || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), highlights: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5">
                    <Moon className="h-3 w-3 text-zinc-500" />
                    <span className="text-[11px] text-zinc-400">Shadows</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 tabular-nums">{selectedClip.colorCorrection?.shadows || 0}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={selectedClip.colorCorrection?.shadows || 0}
                  onChange={(e) => updateClip(selectedClip.id, {
                    colorCorrection: { ...(selectedClip.colorCorrection || DEFAULT_COLOR_CORRECTION), shadows: parseInt(e.target.value) }
                  })}
                  className="w-full h-1.5 accent-blue-500"
                />
              </div>
              </div>
            )}
          </div>
        )}
      </div>}
    </div>
  )
}

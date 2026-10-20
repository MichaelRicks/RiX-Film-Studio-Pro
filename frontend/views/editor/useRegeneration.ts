import { useCallback, useEffect, useRef, useState } from 'react'
import type { Asset, GenerationParams, TimelineClip } from '../../types/project-model'
import type { GenerationSettings } from '../../components/SettingsPanel'
import type { GenerationError } from '../../lib/generation-errors'
import type { VideoGenerationPipeline } from '../../lib/video-generation-model-specs'
import type { GenSpaceMode } from '../../lib/genspace-multi-keyframe'
import { fromPersistedKeyframes, type KeyframeItem } from '../../lib/multi-keyframe'
import { addVisualAssetToProject } from '../../lib/asset-copy'
import { pathToFileUrl } from '../../lib/file-url'
import { probeVideoDuration } from '../../lib/probe-video-duration'
import { ApiClient } from '../../lib/api-client'
import { logger } from '../../lib/logger'
import { enqueueRegen, makeRegenJob, moveRegen, removeRegen, type RegenJob } from './regen-queue'
import {
  selectAssets,
  selectClips,
  selectRegenerationPreError,
  selectRegeneratingAssetId,
  selectRegeneratingClipId,
} from './editor-selectors'
import { useEditorActions, useEditorStore } from './editor-store'

const LEGACY_VIDEO_RESOLUTION_MAP: Record<string, string> = {
  '768x512': '540p',
  '1024x576': '540p',
  '1280x720': '720p',
  '1920x1080': '1080p',
}

const LEGACY_IMAGE_RESOLUTION_MAP: Record<string, string> = {
  '768x512': '1080p',
  '1024x576': '1080p',
  '1280x720': '1080p',
  '1920x1080': '1080p',
  '2160p': '2048p',
}

function normalizeVideoResolution(value: string | undefined): string {
  if (!value) return '540p'
  if (value === '540p' || value === '720p' || value === '1080p' || value === '1440p' || value === '2160p') {
    return value
  }
  return LEGACY_VIDEO_RESOLUTION_MAP[value] || '540p'
}

function normalizeImageResolution(value: string | undefined): string {
  if (!value) return '1080p'
  if (value === '1080p' || value === '1440p' || value === '2048p') {
    return value
  }
  return LEGACY_IMAGE_RESOLUTION_MAP[value] || '1080p'
}

function resolveLiveAssetForClip(assets: Asset[], clip: TimelineClip): Asset {
  if (!clip.assetId) return clip.asset!
  return assets.find(asset => asset.id === clip.assetId) || clip.asset!
}

function resolveClipPath(assets: Asset[], clip: TimelineClip): string {
  const liveAsset = resolveLiveAssetForClip(assets, clip)
  if (liveAsset.takes && liveAsset.takes.length > 0 && clip.takeIndex !== undefined) {
    const idx = Math.max(0, Math.min(clip.takeIndex, liveAsset.takes.length - 1))
    return liveAsset.takes[idx].path || ''
  }
  return liveAsset.path || ''
}

function resolveAssetPreviewPath(assets: Asset[], clips: TimelineClip[], asset: Asset, clipId?: string): string {
  const clip = clipId ? clips.find(candidate => candidate.id === clipId) : undefined
  if (clip) {
    const clipPath = resolveClipPath(assets, clip)
    if (clipPath) return clipPath
  }

  if (asset.takes && asset.takes.length > 0) {
    const activeIndex = Math.max(0, Math.min(asset.activeTakeIndex ?? (asset.takes.length - 1), asset.takes.length - 1))
    return asset.takes[activeIndex]?.path || asset.path
  }

  return asset.path
}

/** What the Regenerate dialog is showing. `params` is null while a prompt is still being worked out. */
export interface RegenDialogState {
  assetId: string
  clipId?: string
  assetName: string
  assetType: Asset['type']
  thumbnailPath?: string
  /** True when the asset has no stored generation settings and the prompt was written for it. */
  promptSuggested: boolean
  suggesting: boolean
  params: GenerationParams | null
}

function assetFileName(asset: Asset): string {
  return (asset.path || '').split(/[\\/]/).pop() || 'Shot'
}

function jobLabel(asset: Asset, prompt: string): string {
  const name = assetFileName(asset)
  const snippet = prompt.trim().replace(/\s+/g, ' ')
  return snippet ? `${name} · ${snippet.length > 48 ? `${snippet.slice(0, 48)}…` : snippet}` : name
}

/** Settings to start from for an asset that has no generation record (imported footage). */
function defaultParamsFor(asset: Asset, prompt: string): GenerationParams {
  const isImage = asset.type === 'image'
  return {
    mode: isImage ? 'text-to-image' : 'text-to-video',
    prompt,
    model: 'fast',
    duration: isImage ? null : (asset.duration || 5),
    resolution: isImage ? normalizeImageResolution(asset.resolution) : normalizeVideoResolution(asset.resolution),
    fps: 24,
    audio: false,
    cameraMotion: 'none',
  }
}

export interface RegenerateOptions {
  /** Skip the dialog and re-run the stored settings as they are. */
  quick?: boolean
}

export interface UseRegenerationParams {
  projectId: string
  // Generation hook values
  regenGenerate: (
    prompt: string,
    imagePath: string | null,
    settings: GenerationSettings,
    audioPath?: string | null,
    lastImagePath?: string | null,
    imageInputs?: { mode: GenSpaceMode; keyframes: KeyframeItem[] },
  ) => Promise<void>
  regenGenerateImage: (prompt: string, settings: GenerationSettings, editSource?: string | null) => Promise<void>
  regenVideoPath: string | null
  regenImagePath: string | null
  isRegenerating: boolean
  regenCancel: () => void
  regenReset: () => void
  regenError: GenerationError | null
  canCancelInFlight: boolean
  shouldVideoGenerateWithLtxApi: boolean
}

export function useRegeneration(params: UseRegenerationParams) {
  const {
    projectId,
    regenGenerate,
    regenGenerateImage,
    regenVideoPath,
    regenImagePath,
    isRegenerating,
    regenCancel,
    regenReset,
    regenError,
    canCancelInFlight,
    shouldVideoGenerateWithLtxApi,
  } = params
  const {
    applyRegeneratedAsset,
    cancelClipRegeneration,
    failClipRegeneration,
    setRegenerationPreError,
    startClipRegeneration,
  } = useEditorActions()
  const assets = useEditorStore(selectAssets)
  const clips = useEditorStore(selectClips)
  const regeneratingAssetId = useEditorStore(selectRegeneratingAssetId)
  const regeneratingClipId = useEditorStore(selectRegeneratingClipId)
  const regenerationPreError = useEditorStore(selectRegenerationPreError)
  const cancelRequestedRef = useRef(false)
  // What the running job was started with; the finished video becomes an asset described by it.
  const regenJobRef = useRef<GenerationParams | null>(null)

  const dismissRegenerationPreError = useCallback(() => {
    setRegenerationPreError(null)
  }, [setRegenerationPreError])

  const [regenDialog, setRegenDialog] = useState<RegenDialogState | null>(null)
  const [regenQueue, setRegenQueue] = useState<RegenJob[]>([])
  // True while a shot is rendering or others are waiting: new requests join the line.
  const busy = isRegenerating || !!regeneratingAssetId || regenQueue.length > 0

  // For an asset with no generation record, look at its first frame and have the
  // prompt helper describe it. Null when that is not possible.
  const suggestParams = useCallback(async (asset: Asset, clipId?: string): Promise<GenerationParams | null> => {
    try {
      const clipPath = resolveAssetPreviewPath(assets, clips, asset, clipId)
      let framePath = ''

      if (asset.type === 'video' && clipPath) {
        const frame = await window.electronAPI.extractVideoFrame({
          videoPath: clipPath,
          seekTime: 0.1,
          width: 512,
          quality: 3,
        })
        framePath = frame.path
      } else if (asset.type === 'image' && clipPath) {
        framePath = clipPath
      }
      if (!framePath) return null

      const result = await ApiClient.suggestGapPrompt({
        gapDuration: asset.duration || 5,
        mode: asset.type === 'image' ? 'text-to-image' : 'text-to-video',
        beforePrompt: '',
        afterPrompt: '',
        beforeFrame: framePath,
        afterFrame: '',
      })
      if (!result.ok) throw new Error(result.error.message)

      const suggestedPrompt = result.data.suggested_prompt
      return suggestedPrompt ? defaultParamsFor(asset, suggestedPrompt) : null
    } catch (error) {
      logger.warn(`Failed to auto-generate prompt for imported asset: ${error}`)
      return null
    }
  }, [assets, clips])

  // `override` is what the Regenerate dialog collected; without it the asset's stored settings run as they are.
  const runRegeneration = useCallback(async (assetId: string, clipId?: string, override?: GenerationParams) => {
    if (!projectId || isRegenerating) return
    const asset = assets.find(candidate => candidate.id === assetId)
    if (!asset) return

    startClipRegeneration(assetId, clipId)

    let generationParams: GenerationParams | undefined = override ?? asset.generationParams
    if (!generationParams) {
      generationParams = (await suggestParams(asset, clipId)) ?? undefined
      if (!generationParams) {
        failClipRegeneration(
          'Could not auto-generate a prompt for this clip. Try using "Send to GenSpace" instead.',
        )
        return
      }
    }
    regenJobRef.current = generationParams

    if (generationParams.mode === 'retake') {
      failClipRegeneration(
        'Retake assets cannot be regenerated yet. Try using Retake from the clip menu instead.',
      )
      return
    }

    if (generationParams.mode === 'ic-lora') {
      failClipRegeneration(
        'IC-LoRA assets cannot be regenerated yet. Try using IC-LoRA from the clip menu instead.',
      )
      return
    }

    if (generationParams.mode === 'text-to-image') {
      void regenGenerateImage(generationParams.prompt, {
        model: generationParams.model as VideoGenerationPipeline,
        duration: generationParams.duration,
        videoResolution: '540p',
        fps: generationParams.fps,
        audio: generationParams.audio,
        cameraMotion: generationParams.cameraMotion,
        imageResolution: normalizeImageResolution(generationParams.resolution),
        imageAspectRatio: generationParams.imageAspectRatio || '16:9',
        imageSteps: generationParams.imageSteps || 4,
        variations: 1,
      })
      return
    }

    if (generationParams.mode === 'image-edit') {
      if (!generationParams.inputImageUrl) {
        failClipRegeneration(
          'This edited asset is missing its source image and cannot be regenerated.',
        )
        return
      }
      void regenGenerateImage(generationParams.prompt, {
        model: generationParams.model as VideoGenerationPipeline,
        duration: generationParams.duration,
        videoResolution: '540p',
        fps: generationParams.fps,
        audio: generationParams.audio,
        cameraMotion: generationParams.cameraMotion,
        imageResolution: normalizeImageResolution(generationParams.resolution),
        imageAspectRatio: generationParams.imageAspectRatio || '16:9',
        imageSteps: generationParams.imageSteps || 8,
        imageEditStrength: generationParams.imageEditStrength,
        variations: 1,
      }, generationParams.inputImageUrl)
      return
    }

    const imagePath = generationParams.inputImageUrl
      && (generationParams.mode === 'image-to-video' || generationParams.mode === 'audio-to-video')
      ? generationParams.inputImageUrl
      : null
    const rawVideoSettings: GenerationSettings = {
      model: generationParams.model as VideoGenerationPipeline,
      duration: generationParams.duration,
      videoResolution: normalizeVideoResolution(generationParams.resolution),
      fps: generationParams.fps,
      audio: generationParams.audio,
      cameraMotion: generationParams.cameraMotion,
      imageResolution: '1080p',
      imageAspectRatio: generationParams.imageAspectRatio || '16:9',
      imageSteps: generationParams.imageSteps || 4,
      // Local LoRA refs are filesystem paths the cloud API can't resolve.
      loras: !shouldVideoGenerateWithLtxApi ? generationParams.loras : undefined,
    }
    void regenGenerate(
      generationParams.prompt,
      imagePath,
      rawVideoSettings,
      generationParams.mode === 'audio-to-video' ? generationParams.inputAudioUrl : undefined,
      imagePath && generationParams.duration != null ? generationParams.inputLastImageUrl : undefined,
      generationParams.mode === 'multi-keyframe'
        ? {
            mode: 'multi-keyframe',
            keyframes: fromPersistedKeyframes(generationParams.keyframes ?? []),
          }
        : undefined,
    )
  }, [
    isRegenerating,
    projectId,
    regenGenerate,
    regenGenerateImage,
    startClipRegeneration,
    failClipRegeneration,
    assets,
    suggestParams,
    shouldVideoGenerateWithLtxApi,
  ])

  const closeRegenDialog = useCallback(() => setRegenDialog(null), [])

  // The entry point for every Regenerate button: ask first, so the prompt and settings can
  // change. `quick` (Shift-click) keeps the old one-click re-run.
  const handleRegenerate = useCallback((assetId: string, clipId?: string, options?: RegenerateOptions) => {
    if (!projectId) return
    const asset = assets.find(candidate => candidate.id === assetId)
    if (!asset) return
    const stored = asset.generationParams

    // Retake and IC-LoRA runs cannot be redone here; the run step reports that.
    if (options?.quick || stored?.mode === 'retake' || stored?.mode === 'ic-lora') {
      if (busy) {
        // Only a shot with stored settings can wait its turn; there is nothing to freeze otherwise.
        if (options?.quick && stored && stored.mode !== 'retake' && stored.mode !== 'ic-lora') {
          setRegenQueue(prev => enqueueRegen(prev, makeRegenJob({ assetId, clipId, label: jobLabel(asset, stored.prompt), params: stored })))
        }
        return
      }
      void runRegeneration(assetId, clipId)
      return
    }

    const base = {
      assetId,
      clipId,
      assetName: assetFileName(asset),
      assetType: asset.type,
      thumbnailPath: asset.bigThumbnailPath || asset.smallThumbnailPath,
    }
    if (stored) {
      setRegenDialog({ ...base, promptSuggested: false, suggesting: false, params: stored })
      return
    }
    setRegenDialog({ ...base, promptSuggested: false, suggesting: true, params: defaultParamsFor(asset, '') })
    void suggestParams(asset, clipId).then(suggested => {
      setRegenDialog(current => {
        if (!current || current.assetId !== assetId || current.clipId !== clipId) return current
        return {
          ...current,
          suggesting: false,
          promptSuggested: !!suggested,
          params: suggested ?? current.params,
        }
      })
    })
  }, [assets, isRegenerating, projectId, runRegeneration, suggestParams])

  // Another shot is rendering (or waiting), so this one joins the line with its settings frozen.
  const confirmRegenerate = useCallback((params: GenerationParams) => {
    const current = regenDialog
    if (!current) return
    setRegenDialog(null)
    if (busy) {
      const asset = assets.find(candidate => candidate.id === current.assetId)
      if (!asset) return
      setRegenQueue(prev => enqueueRegen(prev, makeRegenJob({
        assetId: current.assetId,
        clipId: current.clipId,
        label: jobLabel(asset, params.prompt),
        params,
      })))
      return
    }
    void runRegeneration(current.assetId, current.clipId, params)
  }, [assets, busy, regenDialog, runRegeneration])

  const removeFromRegenQueue = useCallback((id: string) => setRegenQueue(prev => removeRegen(prev, id)), [])
  const moveInRegenQueue = useCallback(
    (id: string, to: 'up' | 'down' | 'top') => setRegenQueue(prev => moveRegen(prev, id, to)),
    [],
  )
  const clearRegenQueue = useCallback(() => setRegenQueue([]), [])

  // Start the next waiting shot once the current one is fully done (saved as a take, or
  // failed). While an error is on screen the line waits, so the error is not lost.
  useEffect(() => {
    if (regenQueue.length === 0) return
    if (isRegenerating || regeneratingAssetId) return
    // The last result must be saved and cleared first. The save effects below pair whatever
    // path is still held with whichever shot is regenerating, so starting the next job while
    // the old path lingers would file the previous shot's video under the new one.
    if (regenVideoPath || regenImagePath) return
    if (regenError || regenerationPreError) return
    const [next, ...rest] = regenQueue
    setRegenQueue(rest)
    void runRegeneration(next.assetId, next.clipId, next.params)
  }, [regenQueue, isRegenerating, regeneratingAssetId, regenVideoPath, regenImagePath, regenError, regenerationPreError, runRegeneration])

  const handleCancelRegeneration = useCallback(() => {
    if (!canCancelInFlight) return
    cancelRequestedRef.current = true
    regenCancel()
  }, [canCancelInFlight, regenCancel])

  const persistGeneratedTake = useCallback(async (
    generatedPath: string,
    type: 'video' | 'image',
    assetId: string,
    clipId: string | null,
  ) => {
    if (!projectId) return

    const copied = await addVisualAssetToProject(generatedPath, projectId, type)
    if (!copied) {
      logger.error(`Failed to persist regenerated ${type}: ${generatedPath}`)
      cancelClipRegeneration()
      regenReset()
      return
    }

    // The result is a new asset, so the shot it replaced stays in the library and in GenSpace.
    const source = assets.find(candidate => candidate.id === assetId)
    const params = regenJobRef.current ?? source?.generationParams
    const measuredDuration = type === 'video' ? await probeVideoDuration(pathToFileUrl(copied.path)) : undefined
    const now = Date.now()
    applyRegeneratedAsset({
      id: `asset-${now}-${Math.random().toString(36).slice(2, 11)}`,
      type,
      path: copied.path,
      bigThumbnailPath: copied.bigThumbnailPath,
      smallThumbnailPath: copied.smallThumbnailPath,
      width: copied.width,
      height: copied.height,
      prompt: params?.prompt ?? source?.prompt ?? '',
      resolution: params?.resolution ?? source?.resolution ?? '',
      duration: type === 'video' ? (measuredDuration ?? params?.duration ?? source?.duration ?? undefined) : undefined,
      binId: source?.binId,
      generationParams: params,
      takes: [{
        path: copied.path,
        bigThumbnailPath: copied.bigThumbnailPath,
        smallThumbnailPath: copied.smallThumbnailPath,
        width: copied.width,
        height: copied.height,
        createdAt: now,
      }],
      activeTakeIndex: 0,
      createdAt: now,
    }, clipId ?? undefined)
    regenJobRef.current = null
    regenReset()
  }, [applyRegeneratedAsset, assets, cancelClipRegeneration, projectId, regenReset])

  useEffect(() => {
    if (cancelRequestedRef.current) return
    if (!regenVideoPath || !regeneratingAssetId || !projectId || isRegenerating) return
    void persistGeneratedTake(regenVideoPath, 'video', regeneratingAssetId, regeneratingClipId)
  }, [
    isRegenerating,
    persistGeneratedTake,
    projectId,
    regeneratingAssetId,
    regeneratingClipId,
    regenVideoPath,
  ])

  useEffect(() => {
    if (cancelRequestedRef.current) return
    if (!regenImagePath || !regeneratingAssetId || !projectId || isRegenerating) return
    void persistGeneratedTake(regenImagePath, 'image', regeneratingAssetId, regeneratingClipId)
  }, [
    isRegenerating,
    persistGeneratedTake,
    projectId,
    regeneratingAssetId,
    regeneratingClipId,
    regenImagePath,
  ])

  // Keep UI clip state in sync if generation fails.
  // Do not reset generation error here; dialog owns that lifecycle.
  useEffect(() => {
    if (cancelRequestedRef.current) return
    if (!regeneratingAssetId || isRegenerating || !regenError) return
    cancelClipRegeneration()
  }, [cancelClipRegeneration, isRegenerating, regeneratingAssetId, regenError])

  useEffect(() => {
    if (!cancelRequestedRef.current || isRegenerating) return
    cancelRequestedRef.current = false
    cancelClipRegeneration()
    regenReset()
  }, [cancelClipRegeneration, isRegenerating, regenReset])

  return {
    regeneratingAssetId,
    regenerationPreError,
    handleRegenerate,
    handleCancelRegeneration,
    dismissRegenerationPreError,
    regenDialog,
    closeRegenDialog,
    confirmRegenerate,
    regenBusy: busy,
    regeneratingLabel: regeneratingAssetId
      ? assetFileName(assets.find(a => a.id === regeneratingAssetId) ?? ({ path: '' } as Asset))
      : null,
    regenQueue,
    removeFromRegenQueue,
    moveInRegenQueue,
    clearRegenQueue,
  }
}

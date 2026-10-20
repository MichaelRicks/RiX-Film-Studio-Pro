import { useEffect, useMemo, useRef, useState } from 'react'
import { Image as ImageIcon, ListPlus, Loader2, RefreshCw, RotateCcw, Video, X } from 'lucide-react'
import { SettingsPanel } from '../../components/SettingsPanel'
import type { GenerationMode, GenerationSettings } from '../../components/SettingsPanel'
import { pathToFileUrl } from '../../lib/file-url'
import {
  sanitizeVideoGenerationSettings,
  type VideoGenerationModelSpecItem,
  type VideoGenerationPipeline,
} from '../../lib/video-generation-model-specs'
import type { GenerationParams } from '../../types/project-model'
import type { RegenDialogState } from './useRegeneration'

interface RegenerateShotDialogProps {
  dialog: RegenDialogState
  videoModelSpecs: VideoGenerationModelSpecItem[]
  videoSettingsMessage?: string | null
  /** Another shot is rendering, so this one will join the line instead of starting. */
  queueing?: boolean
  onCancel: () => void
  onConfirm: (params: GenerationParams) => void
}

const isImageParams = (params: GenerationParams) => params.mode === 'text-to-image' || params.mode === 'image-edit'

function paramsToSettings(params: GenerationParams): GenerationSettings {
  const image = isImageParams(params)
  return {
    model: params.model as VideoGenerationPipeline,
    duration: params.duration,
    videoResolution: image ? '540p' : params.resolution,
    fps: params.fps,
    audio: params.audio,
    cameraMotion: params.cameraMotion,
    imageResolution: image ? params.resolution : '1080p',
    imageAspectRatio: params.imageAspectRatio || '16:9',
    imageSteps: params.imageSteps || (params.mode === 'image-edit' ? 8 : 4),
    loras: params.loras,
  }
}

function settingsToParams(base: GenerationParams, prompt: string, settings: GenerationSettings): GenerationParams {
  const image = isImageParams(base)
  return {
    ...base,
    prompt,
    model: settings.model,
    duration: image ? base.duration : settings.duration,
    resolution: image ? settings.imageResolution : settings.videoResolution,
    fps: settings.fps,
    audio: settings.audio,
    cameraMotion: settings.cameraMotion,
    imageAspectRatio: image ? settings.imageAspectRatio : base.imageAspectRatio,
    imageSteps: image ? settings.imageSteps : base.imageSteps,
  }
}

/** Shown before a shot is regenerated, so the prompt and settings can change first. */
export function RegenerateShotDialog({
  dialog, videoModelSpecs, videoSettingsMessage, queueing = false, onCancel, onConfirm,
}: RegenerateShotDialogProps) {
  const base = dialog.params
  const [prompt, setPrompt] = useState(base?.prompt ?? '')
  const [settings, setSettings] = useState<GenerationSettings | null>(base ? paramsToSettings(base) : null)
  const touchedRef = useRef(false)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  // The prompt for an imported clip arrives a moment after the dialog opens; fill it in
  // unless the user has already started typing.
  useEffect(() => {
    if (!base) return
    if (!touchedRef.current) setPrompt(base.prompt)
    setSettings(prev => prev ?? paramsToSettings(base))
  }, [base])

  useEffect(() => { promptRef.current?.focus() }, [])

  const image = base ? isImageParams(base) : dialog.assetType === 'image'
  const originalPrompt = base?.prompt ?? ''
  const canSubmit = !!base && !!settings && prompt.trim().length > 0 && !dialog.suggesting

  const submit = () => {
    if (!base || !settings || !prompt.trim()) return
    let finalSettings = settings
    if (!image && videoModelSpecs.length > 0) {
      finalSettings = sanitizeVideoGenerationSettings(settings, videoModelSpecs) ?? settings
    }
    onConfirm(settingsToParams(base, prompt.trim(), finalSettings))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const settingsMode: GenerationMode = image
    ? 'text-to-image'
    : (base?.inputImageUrl ? 'image-to-video' : 'text-to-video')

  const sourceNote = useMemo(() => {
    if (!base) return null
    if (base.mode === 'image-to-video' || base.mode === 'audio-to-video') return 'Uses the same start frame as before.'
    if (base.mode === 'multi-keyframe') return 'Uses the same keyframes as before.'
    if (base.mode === 'image-edit') return 'Edits the same source image as before.'
    return null
  }, [base])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onMouseDown={onCancel}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[460px] max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${image ? 'bg-emerald-600/20' : 'bg-blue-600/20'}`}>
              {image ? <ImageIcon className="h-4 w-4 text-emerald-400" /> : <Video className="h-4 w-4 text-blue-400" />}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-white">Regenerate shot</h2>
              <p className="text-[11px] text-zinc-500 truncate">{dialog.assetName}</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {dialog.thumbnailPath && (
            <img
              src={pathToFileUrl(dialog.thumbnailPath)}
              alt=""
              className="w-full h-28 object-cover rounded-lg border border-zinc-800 bg-zinc-950"
            />
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-zinc-400" htmlFor="regen-prompt">Prompt</label>
              {base && prompt !== originalPrompt && (
                <button
                  onClick={() => { touchedRef.current = true; setPrompt(originalPrompt) }}
                  className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-200 transition-colors"
                >
                  <RotateCcw className="h-3 w-3" /> Reset to {dialog.promptSuggested ? 'suggested' : 'original'}
                </button>
              )}
            </div>
            <div className="relative">
              <textarea
                id="regen-prompt"
                ref={promptRef}
                value={prompt}
                onChange={e => { touchedRef.current = true; setPrompt(e.target.value) }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit() }
                }}
                rows={6}
                placeholder={dialog.suggesting ? 'Describing the clip…' : 'Describe the shot'}
                className="w-full resize-y rounded-lg bg-zinc-950 border border-zinc-800 focus:border-blue-500 outline-none px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
              />
              {dialog.suggesting && (
                <Loader2 className="absolute right-2 top-2 h-4 w-4 animate-spin text-zinc-500" />
              )}
            </div>
            {dialog.promptSuggested && (
              <p className="mt-1 text-[10px] text-zinc-500">This clip had no prompt, so one was written from its first frame. Edit it freely.</p>
            )}
            {sourceNote && <p className="mt-1 text-[10px] text-zinc-500">{sourceNote}</p>}
          </div>

          {settings && (
            <div className="[&_select]:h-8 [&_select]:text-xs [&_select]:py-1 [&_label]:text-[10px] [&_label]:mb-1">
              <SettingsPanel
                settings={settings}
                onSettingsChange={setSettings}
                mode={settingsMode}
                videoModelSpecs={image ? undefined : videoModelSpecs}
                videoSettingsMessage={image ? undefined : videoSettingsMessage}
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-zinc-800">
          <span className="text-[10px] text-zinc-600">
            {queueing ? 'Another shot is rendering. This one will start when it is done.' : 'Ctrl+Enter to regenerate. The result is a new asset; the original stays in your library.'}
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!canSubmit}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:hover:bg-blue-600 transition-colors"
            >
              {queueing ? <ListPlus className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {queueing ? 'Add to queue' : 'Regenerate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

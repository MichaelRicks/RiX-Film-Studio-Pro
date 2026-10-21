import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Image as ImageIcon, ListPlus, Loader2, RefreshCw, RotateCcw, Sparkles, Video, X } from 'lucide-react'
import { SettingsPanel } from '../../components/SettingsPanel'
import type { GenerationMode, GenerationSettings } from '../../components/SettingsPanel'
import { pathToFileUrl } from '../../lib/file-url'
import { registerGenerationPromptTarget } from '../../lib/generation-prompt-bridge'
import { buildTrimPromptBrief, looksMultiShot } from '../../lib/trim-prompt-brief'
import {
  sanitizeVideoGenerationSettings,
  type VideoGenerationModelSpecItem,
  type VideoGenerationPipeline,
} from '../../lib/video-generation-model-specs'
import type { GenerationParams } from '../../types/project-model'
import type { RegenDialogState } from './useRegeneration'

/** Where the new shot starts: the clip's first frame as trimmed, the original start, or no start frame. */
type StartFrameChoice = 'clip' | 'original' | 'none'

interface RegenerateShotDialogProps {
  dialog: RegenDialogState
  videoModelSpecs: VideoGenerationModelSpecItem[]
  videoSettingsMessage?: string | null
  /** Another shot is rendering, so this one will join the line instead of starting. */
  queueing?: boolean
  onCancel: () => void
  onConfirm: (params: GenerationParams) => void | Promise<void>
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
  const [startChoice, setStartChoice] = useState<StartFrameChoice | null>(null)
  // Asking Claude to cut the prompt down to this clip's shot: it works in the user's own Claude
  // app and hands the result back through set_generation_prompt, which lands here while open.
  const [trimAsk, setTrimAsk] = useState<{ status: 'idle' | 'opening' | 'waiting' | 'done' | 'error'; message?: string }>({ status: 'idle' })
  const promptRef = useRef<HTMLTextAreaElement>(null)

  // The prompt for an imported clip arrives a moment after the dialog opens; fill it in
  // unless the user has already started typing.
  useEffect(() => {
    if (!base) return
    if (!touchedRef.current) setPrompt(base.prompt)
    setSettings(prev => prev ?? paramsToSettings(base))
  }, [base])

  useEffect(() => { promptRef.current?.focus() }, [])

  useEffect(() => registerGenerationPromptTarget(text => {
    touchedRef.current = true
    setPrompt(text)
    setTrimAsk({ status: 'done' })
  }), [])

  const image = base ? isImageParams(base) : dialog.assetType === 'image'
  const originalPrompt = base?.prompt ?? ''

  // A trimmed clip uses part of a longer generation, but the stored prompt covers all of it.
  const clipWindow = image ? undefined : dialog.clipWindow
  const partialClip = !!clipWindow?.usesPart && prompt.trim().length > 0
  const multiShotWarning = partialClip && looksMultiShot(prompt)

  const askClaudeToTrim = async () => {
    if (!clipWindow) return
    setTrimAsk({ status: 'opening' })
    try {
      const r = await window.electronAPI.openClaudeCode({
        prompt: buildTrimPromptBrief({ videoPath: clipWindow.videoPath, start: clipWindow.start, end: clipWindow.end, prompt }),
      })
      setTrimAsk(r.success ? { status: 'waiting' } : { status: 'error', message: r.error })
    } catch (err) {
      setTrimAsk({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  // Start frame: a trimmed clip defaults to its own first frame, since the source's opening
  // (often a character sheet) is no longer what the clip shows.
  const clipFrame = image ? undefined : dialog.clipFrame
  const hasOriginalStart = !!base && (!!base.inputImageUrl || base.mode === 'multi-keyframe')
  const trimmed = (clipFrame?.seekTime ?? 0) > 0.04
  const clipFrameUsable = !!clipFrame && clipFrame.status !== 'failed'
  const defaultChoice: StartFrameChoice = trimmed && clipFrameUsable ? 'clip' : hasOriginalStart ? 'original' : 'none'
  const choice: StartFrameChoice = startChoice === 'clip' && !clipFrameUsable ? defaultChoice : (startChoice ?? defaultChoice)
  const waitingForFrame = choice === 'clip' && clipFrame?.status === 'loading'
  const canSubmit = !!base && !!settings && prompt.trim().length > 0 && !dialog.suggesting && !waitingForFrame

  const submit = () => {
    if (!base || !settings || !prompt.trim() || waitingForFrame) return
    let finalSettings = settings
    if (!image && videoModelSpecs.length > 0) {
      finalSettings = sanitizeVideoGenerationSettings(settings, videoModelSpecs) ?? settings
    }
    let next = settingsToParams(base, prompt.trim(), finalSettings)
    if (!image && clipFrame && choice === 'clip' && clipFrame.path) {
      next = {
        ...next,
        mode: next.mode === 'audio-to-video' ? 'audio-to-video' : 'image-to-video',
        inputImageUrl: clipFrame.path,
        inputLastImageUrl: undefined,
        keyframes: undefined,
      }
    } else if (!image && clipFrame && choice === 'none') {
      next = {
        ...next,
        mode: next.mode === 'image-to-video' || next.mode === 'multi-keyframe' ? 'text-to-video' : next.mode,
        inputImageUrl: undefined,
        inputLastImageUrl: undefined,
        keyframes: undefined,
      }
    }
    void onConfirm(next)
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
    : ((clipFrame ? choice === 'clip' || (choice === 'original' && !!base?.inputImageUrl) : !!base?.inputImageUrl)
      ? 'image-to-video'
      : 'text-to-video')

  const sourceNote = useMemo(() => {
    if (!base || clipFrame) return null
    if (base.mode === 'image-to-video' || base.mode === 'audio-to-video') return 'Uses the same start frame as before.'
    if (base.mode === 'multi-keyframe') return 'Uses the same keyframes as before.'
    if (base.mode === 'image-edit') return 'Edits the same source image as before.'
    return null
  }, [base, clipFrame])

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

            {partialClip && clipWindow && (
              <div className={`mt-2 rounded-lg border px-3 py-2 ${
                multiShotWarning ? 'border-amber-500/40 bg-amber-500/10' : 'border-zinc-800 bg-zinc-950'
              }`}>
                {multiShotWarning && (
                  <p className="flex items-start gap-1.5 text-[11px] text-amber-200/90 leading-snug">
                    <AlertTriangle className="h-3.5 w-3.5 mt-px flex-shrink-0" />
                    <span>
                      This prompt describes several shots, but this clip only uses {clipWindow.start.toFixed(1)}s to {clipWindow.end.toFixed(1)}s of
                      its source. Regenerating will make every shot again.
                    </span>
                  </p>
                )}
                <div className={`flex items-center gap-2 ${multiShotWarning ? 'mt-2' : ''}`}>
                  <button
                    onClick={() => void askClaudeToTrim()}
                    disabled={trimAsk.status === 'opening'}
                    className="flex items-center gap-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 px-2.5 py-1 text-[11px] text-zinc-100 disabled:opacity-50 transition-colors"
                  >
                    {trimAsk.status === 'opening' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    Trim prompt to this shot with Claude
                  </button>
                  {trimAsk.status === 'waiting' && (
                    <span className="text-[10px] text-zinc-500">Press Send in Claude. The trimmed prompt lands here.</span>
                  )}
                  {trimAsk.status === 'done' && (
                    <span className="text-[10px] text-emerald-400">Prompt trimmed. Check it before you regenerate.</span>
                  )}
                </div>
                {trimAsk.status === 'error' && (
                  <p className="mt-1.5 text-[10px] text-red-400">
                    {trimAsk.message || 'Could not open Claude.'} Connect Claude first from Create, using Prompt with Claude.
                  </p>
                )}
              </div>
            )}
          </div>

          {clipFrame && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-zinc-400">Start frame</div>
              <div className="grid grid-cols-3 gap-2">
                {([
                  ['clip', trimmed ? 'Clip start (trimmed)' : 'Clip start', clipFrameUsable],
                  ['original', base?.mode === 'multi-keyframe' ? 'Original keyframes' : 'Original start', hasOriginalStart],
                  ['none', 'Text only', true],
                ] as const).filter(([, , available]) => available).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setStartChoice(id)}
                    className={`rounded-lg border p-1 text-left transition-colors ${
                      choice === id ? 'border-blue-500 bg-blue-500/10' : 'border-zinc-700 hover:border-zinc-500'
                    }`}
                  >
                    <div className="relative aspect-video w-full overflow-hidden rounded bg-zinc-950 flex items-center justify-center">
                      {id === 'clip' && clipFrame.path && (
                        <img src={pathToFileUrl(clipFrame.path)} alt="" className="h-full w-full object-cover" />
                      )}
                      {id === 'clip' && clipFrame.status === 'loading' && (
                        <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
                      )}
                      {id === 'original' && base?.inputImageUrl && (
                        <img
                          src={pathToFileUrl(base.inputImageUrl)}
                          alt=""
                          className="h-full w-full object-cover"
                          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                        />
                      )}
                      {id === 'none' && <span className="text-[10px] text-zinc-600">No image</span>}
                    </div>
                    <div className="px-0.5 pt-1 text-[10px] text-zinc-300 truncate">{label}</div>
                  </button>
                ))}
              </div>
              {trimmed && (
                <p className="mt-1 text-[10px] text-zinc-500">
                  This clip is trimmed, so it starts {clipFrame.seekTime.toFixed(1)}s into its source. The new shot can start from the frame the clip opens on.
                </p>
              )}
            </div>
          )}

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

import { Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { pathToFileUrl } from '../lib/file-url'
import { Button } from './ui/button'

export type EnhanceMethod = 'refine' | 'rebuild'
export type EnhanceScale = 1 | 2

// Mirrors backend/services/detail_pass/video_io.py, which has the final say.
const MAX_SECONDS = 5.1
const MAX_SAME_SIZE_PIXELS = 640_000
const MAX_DOUBLED_SOURCE_PIXELS = 768 * 384

interface ClipInfo {
  width: number
  height: number
  seconds: number
}

function blockedReason(clip: ClipInfo, scale: EnhanceScale): string | null {
  if (clip.seconds > MAX_SECONDS) return 'Clips up to 5 seconds only'
  const pixels = clip.width * clip.height
  if (scale === 2) {
    if (pixels > MAX_DOUBLED_SOURCE_PIXELS) return 'Clips up to 768x384 only'
    return clip.width % 32 || clip.height % 32 ? 'Width and height must divide by 32' : null
  }
  if (pixels > MAX_SAME_SIZE_PIXELS) return 'Clips up to 540p only'
  return clip.width % 64 || clip.height % 64 ? 'Width and height must divide by 64' : null
}

const METHODS: { value: EnhanceMethod; title: string; detail: string }[] = [
  { value: 'refine', title: 'Refine (recommended)', detail: 'Starts from your clip. Quicker and stays closer to it.' },
  { value: 'rebuild', title: 'Full rebuild', detail: 'Remakes the picture using your clip as a guide. Takes longer.' },
]

function choiceClass(selected: boolean) {
  return `w-full rounded-lg border px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-40 ${
    selected ? 'border-[rgb(var(--accent))] bg-[rgb(var(--accent)/0.15)]' : 'border-zinc-700 hover:bg-zinc-800'
  }`
}

/** FORK: options for "Enhance detail". Mount it only while open. */
export function EnhanceDetailDialog({
  videoPath,
  queueing,
  onClose,
  onStart,
}: {
  videoPath: string
  /** Another job is running, so this one will wait in the queue. */
  queueing: boolean
  onClose: () => void
  onStart: (method: EnhanceMethod, scale: EnhanceScale) => void
}) {
  const [clip, setClip] = useState<ClipInfo | null>(null)
  const [unreadable, setUnreadable] = useState(false)
  const [method, setMethod] = useState<EnhanceMethod>('refine')
  const [chosenScale, setChosenScale] = useState<EnhanceScale>(1)

  const reasons: Record<EnhanceScale, string | null> = {
    1: clip ? blockedReason(clip, 1) : null,
    2: clip ? blockedReason(clip, 2) : null,
  }
  // Fall back to the other size when the chosen one doesn't fit this clip.
  const scale: EnhanceScale = reasons[chosenScale] === null ? chosenScale : chosenScale === 1 ? 2 : 1
  const canStart = clip !== null && reasons[scale] === null

  return createPortal(
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { e.stopPropagation(); onClose() }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-zinc-700/50 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Enhance detail"
      >
        <video
          className="hidden"
          src={pathToFileUrl(videoPath)}
          preload="metadata"
          muted
          onLoadedMetadata={(e) => {
            const video = e.currentTarget
            setClip({ width: video.videoWidth, height: video.videoHeight, seconds: video.duration })
          }}
          onError={() => setUnreadable(true)}
        />
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Sparkles className="h-4 w-4 text-amber-400" />
            Enhance detail
          </h2>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-xs leading-relaxed text-zinc-300">
            Makes a new, sharper copy and keeps your original. It keeps the clip's color and sound.
            {clip && ` This clip is ${clip.width}x${clip.height}, ${clip.seconds.toFixed(1)} seconds.`}
          </p>
          {unreadable && <p className="text-xs text-red-400">This video couldn&apos;t be read.</p>}

          <div className="space-y-1.5">
            {METHODS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={method === item.value}
                onClick={() => setMethod(item.value)}
                className={choiceClass(method === item.value)}
              >
                <span className="block text-xs font-medium text-white">{item.title}</span>
                <span className="block text-[11px] text-zinc-400">{item.detail}</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {([1, 2] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={canStart && scale === value}
                disabled={!clip || reasons[value] !== null}
                onClick={() => setChosenScale(value)}
                className={choiceClass(canStart && scale === value)}
              >
                <span className="block text-xs font-medium text-white">{value === 1 ? 'Same size' : '2x bigger'}</span>
                <span className="block text-[11px] text-zinc-400">
                  {!clip ? 'Reading clip…' : reasons[value] ?? `${clip.width * value}x${clip.height * value}`}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <Button size="sm" variant="outline" onClick={onClose} className="border-zinc-700 text-xs text-zinc-300">
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canStart}
            onClick={() => onStart(method, scale)}
            className="bg-blue-600 text-xs text-white hover:bg-blue-500"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {queueing ? 'Add to queue' : 'Enhance'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

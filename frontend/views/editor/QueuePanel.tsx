import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, ListOrdered, Loader2, X } from 'lucide-react'
export interface QueuePanelItem {
  id: string
  label: string
}

interface QueuePanelProps {
  /** The shot rendering now, if any. */
  runningLabel: string | null
  queue: QueuePanelItem[]
  /** Heading of the card. */
  title?: string
  /** Tailwind position classes; the card is fixed to the window. */
  positionClass?: string
  /** Sits in the page flow (collapsed to one line until opened) instead of floating over it. */
  inline?: boolean
  /** Small print under the list. */
  footnote?: string
  onRemove: (id: string) => void
  onMove: (id: string, to: 'up' | 'down' | 'top') => void
  onClear: () => void
}

/** Shows what is waiting to run. Hidden when nothing is waiting. */
export function QueuePanel({
  runningLabel, queue, title = 'Regenerate queue', positionClass = 'right-4 bottom-16', inline = false, footnote,
  onRemove, onMove, onClear,
}: QueuePanelProps) {
  const [open, setOpen] = useState(!inline)
  if (queue.length === 0) return null

  return (
    <div
      className={`rounded-xl border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm ${
        inline ? 'mb-2 w-full' : `fixed ${positionClass} z-[90] w-[340px] shadow-2xl`
      }`}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ListOrdered className="h-3.5 w-3.5 text-blue-400" />
        <span className="flex-1 text-xs font-medium text-zinc-200">
          {title} <span className="text-zinc-500">· {queue.length} waiting</span>
        </span>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-zinc-500" /> : <ChevronUp className="h-3.5 w-3.5 text-zinc-500" />}
      </button>

      {open && (
        <div className="border-t border-zinc-800 px-2 py-2 space-y-1 max-h-64 overflow-y-auto">
          {runningLabel && (
            <div className="flex items-center gap-2 rounded-lg bg-blue-600/10 px-2 py-1.5">
              <Loader2 className="h-3 w-3 animate-spin text-blue-400 flex-shrink-0" />
              <span className="flex-1 truncate text-[11px] text-blue-200">{runningLabel}</span>
              <span className="text-[10px] text-blue-300/70">rendering</span>
            </div>
          )}
          {queue.map((job, i) => (
            <div key={job.id} className="group flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-zinc-800/70">
              <span className="w-4 text-center text-[10px] tabular-nums text-zinc-500">{i + 1}</span>
              <span className="flex-1 truncate text-[11px] text-zinc-300" title={job.label}>{job.label}</span>
              <button
                onClick={() => onMove(job.id, 'up')}
                disabled={i === 0}
                className="p-0.5 rounded text-zinc-500 hover:text-white disabled:opacity-25 disabled:hover:text-zinc-500"
                aria-label="Move up"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                onClick={() => onMove(job.id, 'down')}
                disabled={i === queue.length - 1}
                className="p-0.5 rounded text-zinc-500 hover:text-white disabled:opacity-25 disabled:hover:text-zinc-500"
                aria-label="Move down"
              >
                <ArrowDown className="h-3 w-3" />
              </button>
              <button
                onClick={() => onRemove(job.id)}
                className="p-0.5 rounded text-zinc-500 hover:text-red-400"
                aria-label="Remove from queue"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[10px] text-zinc-600">{footnote}</span>
            <button onClick={onClear} className="text-[10px] text-zinc-500 hover:text-zinc-200 transition-colors">
              Clear queue
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

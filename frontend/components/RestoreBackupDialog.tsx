import { useState } from 'react'
import { Button } from './ui/button'

export interface RestoreBackupListing {
  folder: string
  createdAt: number | null
  projects: {
    projectId: string
    name: string
    updatedAt: number
    assetCount: number
    status: 'missing' | 'newer' | 'older' | 'same'
  }[]
}

const STATUS_LABEL: Record<RestoreBackupListing['projects'][number]['status'], { text: string; hint: string; className: string }> = {
  missing: { text: 'Missing', hint: 'Not in the app right now', className: 'text-amber-400' },
  newer: { text: 'Newer in backup', hint: 'The backup was saved after your current copy', className: 'text-emerald-400' },
  older: { text: 'Older in backup', hint: 'Restoring replaces your current copy with an older one', className: 'text-zinc-400' },
  same: { text: 'Same', hint: 'Identical to your current copy', className: 'text-zinc-500' },
}

function formatWhen(ms: number): string {
  return ms > 0 ? new Date(ms).toLocaleString() : 'unknown'
}

/**
 * Pick which projects to bring back from a backup folder. Missing and newer ones
 * start ticked; older and identical ones don't. Restoring never discards the
 * current record: the main process keeps it beside the project as
 * project.rix.before-restore-<time>.json.
 */
export function RestoreBackupDialog({
  listing,
  onCancel,
  onRestore,
}: {
  listing: RestoreBackupListing
  onCancel: () => void
  onRestore: (projectIds: string[]) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(listing.projects.filter(p => p.status === 'missing' || p.status === 'newer').map(p => p.projectId)),
  )
  const [busy, setBusy] = useState(false)
  const sorted = [...listing.projects].sort((a, b) => b.updatedAt - a.updatedAt)

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-6" onClick={onCancel}>
      <div
        className="w-full max-w-2xl max-h-[80vh] flex flex-col bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-zinc-800">
          <h2 className="text-base font-semibold text-white">Restore From Backup</h2>
          <p className="text-xs text-zinc-500 mt-1 break-all">
            {listing.folder}{listing.createdAt ? ` · made ${formatWhen(listing.createdAt)}` : ''}
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            This brings back project files only; the media they use must still be where it was. Your current copy of
            each restored project is kept beside it as a <span className="font-mono">before-restore</span> file.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {sorted.map(project => {
            const status = STATUS_LABEL[project.status]
            return (
              <label
                key={project.projectId}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/70 cursor-pointer"
                title={status.hint}
              >
                <input
                  type="checkbox"
                  checked={selected.has(project.projectId)}
                  onChange={() => toggle(project.projectId)}
                  className="accent-blue-500"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{project.name}</p>
                  <p className="text-[11px] text-zinc-500">
                    Saved {formatWhen(project.updatedAt)} · {project.assetCount} assets
                  </p>
                </div>
                <span className={`text-xs flex-shrink-0 ${status.className}`}>{status.text}</span>
              </label>
            )
          })}
        </div>

        <div className="p-4 border-t border-zinc-800 flex items-center gap-2">
          <button
            className="text-xs text-zinc-400 hover:text-white"
            onClick={() => setSelected(new Set(sorted.map(p => p.projectId)))}
          >
            Select all
          </button>
          <button className="text-xs text-zinc-400 hover:text-white" onClick={() => setSelected(new Set())}>
            Select none
          </button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onCancel} className="text-zinc-400">Cancel</Button>
          <Button
            disabled={selected.size === 0 || busy}
            onClick={() => { setBusy(true); onRestore([...selected]) }}
            className="bg-blue-600 hover:bg-blue-500"
          >
            Restore {selected.size} project{selected.size === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </div>
  )
}

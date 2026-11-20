import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookmarkPlus, Loader2, X } from 'lucide-react'
import { pathToFileUrl } from '../lib/file-url'
import { listPromptFolders, savePromptToLibrary } from '../lib/prompt-library-bridge'

/**
 * Also opened by the "Save prompt" button in the Generate prompt bar for any prompt in the box.
 * Opens right after Claude puts a prompt in the prompt box ("Prompt with Claude"): offers to save
 * it to a Prompt Manager folder with the reference image as its thumbnail. Claude can suggest a
 * folder; the user picks an existing one or types a new name. Nothing is saved unless they press Save.
 */
const NEW = '__new__'
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

export function SavePromptDialog({ prompt, imagePath, thumbnailOnly, suggestedFolder, onClose }: {
  prompt: string
  imagePath?: string
  thumbnailOnly?: boolean
  suggestedFolder?: string
  onClose: () => void
}) {
  const [folders, setFolders] = useState<string[] | null>(null)
  const [choice, setChoice] = useState<string>(NEW)
  const [newName, setNewName] = useState(suggestedFolder?.trim() ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void listPromptFolders().then(({ folders: list }) => {
      if (!alive) return
      const names = list.map(f => f.name)
      setFolders(names)
      const match = suggestedFolder ? names.find(n => norm(n) === norm(suggestedFolder)) : undefined
      if (match) setChoice(match)
    }).catch(() => { if (alive) setFolders([]) })
    return () => { alive = false }
  }, [suggestedFolder])

  const folderName = choice === NEW ? newName.trim() : choice
  const canSave = !!folderName && !saving && !done

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const r = await savePromptToLibrary({ prompt, folder: folderName, image_path: imagePath, thumbnail_only: thumbnailOnly })
      setDone(`Saved to "${r.folder}"${r.createdFolder ? ' (new folder)' : ''}${r.thumbnail === 'attached' ? ' with thumbnail' : ''}.`)
      setTimeout(onClose, 1200)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the prompt.')
    } finally {
      setSaving(false)
    }
  }

  const fieldCls = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500'

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-zinc-900 rounded-2xl border border-zinc-700/50 shadow-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <BookmarkPlus className="h-5 w-5 text-[rgb(var(--accent))]" />
            <h2 className="text-base font-bold text-white">Save this prompt?</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3">
            {imagePath && (
              <img src={pathToFileUrl(imagePath)} alt="" className="h-16 w-16 object-cover rounded-lg border border-zinc-700 flex-shrink-0" />
            )}
            <p className="text-xs text-zinc-400 leading-relaxed line-clamp-4">{prompt}</p>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-zinc-400">Prompt Manager folder</label>
            <select value={choice} onChange={(e) => setChoice(e.target.value)} className={fieldCls} disabled={folders === null}>
              <option value={NEW}>New folder…</option>
              {(folders ?? []).map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            {choice === NEW && (
              <input
                value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && canSave) void save() }}
                placeholder="Folder name" className={fieldCls}
              />
            )}
            {imagePath && !thumbnailOnly && (
              <p className="text-[11px] text-zinc-500">The reference image is kept with it: Inject will load it as the first frame again.</p>
            )}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {done && <p className="text-sm text-emerald-400">{done}</p>}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-zinc-800">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 hover:text-white text-sm transition-colors">
            Not now
          </button>
          <button
            onClick={() => void save()} disabled={!canSave}
            className="flex-1 py-2.5 rounded-xl bg-[rgb(var(--accent))] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm flex items-center justify-center gap-2 transition"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

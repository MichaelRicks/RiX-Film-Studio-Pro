import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { pathToFileUrl } from '../lib/file-url'
import type { LibFile } from './gpm/DownloadsBrowser'

/**
 * Pick images from the RiX library (the prompt/asset folders in the Studio Assets dock).
 * Click a thumbnail to add it; already-added images show as ticked.
 */
export function LibraryImagePicker({ selected, onPick, onClose }: {
  selected: string[]
  onPick: (path: string) => void
  onClose: () => void
}) {
  const [folders, setFolders] = useState<string[] | null>(null)
  const [files, setFiles] = useState<LibFile[]>([])
  const [folder, setFolder] = useState<string>('')

  useEffect(() => {
    let alive = true
    void window.electronAPI.gpmLibList().then(d => {
      if (!alive) return
      setFolders(d.folders)
      setFiles(d.files)
      const first = d.folders.find(f => d.files.some(x => x.folder === f && !x.isVideo && !x.isAudio))
      setFolder(first ?? d.folders[0] ?? '')
    }).catch(() => { if (alive) setFolders([]) })
    return () => { alive = false }
  }, [])

  const images = useMemo(
    () => files.filter(f => f.folder === folder && !f.isVideo && !f.isAudio).sort((a, b) => b.mtimeMs - a.mtimeMs),
    [files, folder],
  )

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-300">Pick from your library</span>
        <button type="button" onClick={onClose} className="text-xs text-zinc-500 hover:text-white">Close</button>
      </div>
      {folders === null ? (
        <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…</div>
      ) : folders.length === 0 ? (
        <p className="text-[11px] text-zinc-500">The library has no folders yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {folders.map(f => (
              <button key={f} type="button" onClick={() => setFolder(f)}
                className={`px-2.5 py-1 rounded-lg text-[11px] border transition-colors ${
                  folder === f ? 'border-[rgb(var(--accent))] bg-[rgb(var(--accent)/0.15)] text-white' : 'border-zinc-700 text-zinc-400 hover:text-white'}`}>
                {f}
              </button>
            ))}
          </div>
          {images.length === 0 ? (
            <p className="text-[11px] text-zinc-500">No images in this folder.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-1">
              {images.map(f => {
                const on = selected.includes(f.path)
                return (
                  <button key={f.path} type="button" onClick={() => { if (!on) onPick(f.path) }} title={f.name}
                    className={`relative aspect-square rounded-lg overflow-hidden border ${on ? 'border-emerald-400' : 'border-zinc-700 hover:border-zinc-400'}`}>
                    <img src={pathToFileUrl(f.path)} alt={f.name} loading="lazy" className="h-full w-full object-cover" />
                    {on && <span className="absolute inset-0 bg-emerald-500/30 flex items-center justify-center text-white text-lg">✓</span>}
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

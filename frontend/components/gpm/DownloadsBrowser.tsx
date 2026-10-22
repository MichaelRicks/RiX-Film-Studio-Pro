/**
 * Downloads Browser — a left-side media library backed by REAL folders/files
 * on disk (via Electron IPC under <Downloads>/PromptManagerPro). Create/rename/
 * delete folders, add images/videos/audio, move media between folders, and
 * drag to reorder folders. Folders are an accordion (like the extension) —
 * each expands inline to show its files. Unlike the browser extension
 * there's no directory-handle permission dance — it's the real filesystem.
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronsDownUp, FolderInput, FolderPlus, FolderOpen, GripVertical, Pencil, RefreshCw, Send, Trash2, Upload, X } from 'lucide-react'
import { pathToFileUrl } from '../../lib/file-url'
import { useProjects } from '../../contexts/ProjectContext'
import { MediaThumb } from './MediaThumb'
import { useDownloadsBrowserOpen, setDownloadsBrowserOpen } from './downloads-browser-store'
import { GPM_IMAGE_DND_TYPE, saveDataUrlToTempFile, type GpmDndImage } from './gpm-image-file'
import { setStudioAssetsTarget } from '../../lib/studio-assets-target'
import { C } from './gpm-theme'

export interface LibFile { folder: string; name: string; path: string; isVideo: boolean; isAudio: boolean; mtimeMs: number }
type TypeFilter = 'all' | 'image' | 'video' | 'audio'
const ORDER_KEY = 'gpm_dl_order'
export const FILE_DND = 'application/x-gpm-dl-file'
const FOLDER_DND = 'application/x-gpm-dl-folder'

function loadOrder(): string[] { try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '[]') as string[] } catch { return [] } }
function saveOrder(o: string[]) { localStorage.setItem(ORDER_KEY, JSON.stringify(o)) }
function applyOrder(folders: string[]): string[] {
  const ord = loadOrder().filter((f) => folders.includes(f))
  return [...ord, ...folders.filter((f) => !ord.includes(f))]
}

/** A solid, thick triangle disclosure indicator (matches the extension's look better than a thin chevron stroke). */
function Triangle({ open, color }: { open: boolean; color: string }) {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" style={{ color, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s', flexShrink: 0 }}>
      <path d="M1 0 L9 5 L1 10 Z" fill="currentColor" />
    </svg>
  )
}

function Dock({ onClose }: { onClose: () => void }) {
  const { setGenSpaceInputImagePath, setCurrentTab } = useProjects()
  const [folders, setFolders] = useState<string[]>([])
  const [files, setFiles] = useState<LibFile[]>([])
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set())
  const [newName, setNewName] = useState('')
  // Why the pending name can't be used, shown under the box until it changes.
  const [nameHint, setNameHint] = useState<string | null>(null)
  const newNameRef = useRef<HTMLInputElement>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [moveTarget, setMoveTarget] = useState<LibFile | null>(null)
  const [moveDest, setMoveDest] = useState('')
  const [dropLine, setDropLine] = useState<{ target: string; before: boolean } | null>(null)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [rootPath, setRootPath] = useState('')
  const dragFolder = useRef<string | null>(null)
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 1600) }

  const api = window.electronAPI
  const refresh = async () => {
    if (!api) return
    const d = await api.gpmLibList()
    const ordered = applyOrder(d.folders)
    setFolders(ordered)
    setFiles(d.files)
    setOpenFolders((prev) => new Set([...prev].filter((f) => ordered.includes(f))))
    const r = await api.gpmLibGetRoot()
    setRootPath(r.root)
  }
  useEffect(() => { void refresh() }, [])

  // Live-refresh from a filesystem watch on the library folder: files saved into
  // it (e.g. "Save video"/"Save frame") appear immediately, and only on real
  // disk changes — no re-listing on every window focus. A ref keeps the
  // subscription pinned to the latest refresh without re-subscribing each render.
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(() => {
    const unsubscribe = api?.onGpmLibChanged?.(() => void refreshRef.current())
    return () => unsubscribe?.()
  }, [])

  const chooseFolder = async () => {
    if (!api) return
    const r = await api.gpmLibChooseRoot()
    if (!r.root) return
    setOpenFolders(new Set())
    flash(`Library set to ${r.root}`)
    await refresh()
  }

  const toggleFolder = (name: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else { next.add(name); setStudioAssetsTarget(name) } // opening = "the folder I'm working in" → quick-save target
      return next
    })
  }
  const collapseAll = () => setOpenFolders(new Set())

  const createFolder = async () => {
    const n = newName.trim()
    // The name comes from the inline box, not a popup, so "where do I type the
    // name?" is the mistake to design against. Every refusal says why right under
    // the box and stays there until the name changes, and points the cursor at the
    // box: a toast at the top of the panel is nowhere near the button the user just
    // pressed and is gone in a second and a half, which reads as a dead button.
    if (!n) { setNameHint('Type a folder name in the box above, then click Create.'); newNameRef.current?.focus(); return }
    // Catch what the filesystem would reject anyway, while we can still name the
    // offending character instead of surfacing a raw EINVAL path.
    const badChars = [...new Set(n.match(/[\\/:*?"<>|]/g) ?? [])]
    if (badChars.length > 0) { setNameHint(`A folder name can't contain ${badChars.join(' ')}`); newNameRef.current?.focus(); return }
    // safeName() in the main process rejects ".." outright, so say so here rather
    // than letting a plausible name like "Take 1..3" come back as "Invalid name".
    if (n.includes('..')) { setNameHint(`A folder name can't contain ".."`); newNameRef.current?.focus(); return }
    const clash = folders.find((folder) => folder.toLowerCase() === n.toLowerCase())
    if (clash) { setNameHint(`"${clash}" already exists — pick another name.`); newNameRef.current?.focus(); return }
    if (!api) return
    const r = await api.gpmLibCreateFolder({ name: n })
    if (r.success) {
      // New folder at the TOP of the list (not appended below an expanded Inbox of
      // hundreds of files, where it looks like nothing happened).
      saveOrder([n, ...loadOrder().filter((f) => f !== n)]); setNewName(''); setNameHint(null)
      setOpenFolders((prev) => new Set(prev).add(n))
      setStudioAssetsTarget(n) // route quick-saves into the folder just created
      await refresh()
    } else {
      // The list can be a moment stale, so the clash check above isn't the last word.
      setNameHint(/EEXIST/.test(r.error) ? `"${n}" already exists — pick another name.` : r.error)
    }
  }
  const commitRename = async (from: string) => {
    const to = renameVal.trim(); setRenaming(null)
    if (!to || to === from || !api) return
    const r = await api.gpmLibRenameFolder({ from, to })
    if (r.success) {
      saveOrder(loadOrder().map((f) => (f === from ? to : f)))
      setOpenFolders((prev) => { const next = new Set(prev); if (next.delete(from)) next.add(to); return next })
      await refresh()
    } else flash(r.error)
  }
  const deleteFolder = async (name: string) => {
    if (!api || !window.confirm(`Delete folder "${name}" and its files?`)) return
    const r = await api.gpmLibDeleteFolder({ name })
    if (r.success) { saveOrder(loadOrder().filter((f) => f !== name)); await refresh() } else flash(r.error)
  }
  const addFiles = async (folder: string) => {
    if (!api || !folder) return
    const paths = await api.showOpenFileDialog({
      title: `Add to ${folder}`, properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Media', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'mp4', 'webm', 'mkv', 'mov', 'avi', 'mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a'] }],
    })
    if (!paths || paths.length === 0) return
    const r = await api.gpmLibAddFiles({ folder, srcPaths: paths })
    if (r.success) { flash(`Added ${r.added} file(s)`); await refresh() } else flash(r.error)
  }
  const moveFile = async (f: LibFile, toFolder: string) => {
    if (!api || f.folder === toFolder) return
    const r = await api.gpmLibMoveFile({ fromFolder: f.folder, name: f.name, toFolder })
    if (r.success) { await refresh() } else flash(r.error)
  }
  const deleteFile = async (f: LibFile) => {
    if (!api) return
    const r = await api.gpmLibDeleteFile({ folder: f.folder, name: f.name })
    if (r.success) await refresh(); else flash(r.error)
  }
  const sendToGenSpace = (f: LibFile) => {
    if (f.isVideo) return
    setGenSpaceInputImagePath(f.path)
    setCurrentTab('gen-space')
    flash('Sent to Create')
  }
  const openMove = (f: LibFile) => {
    setMoveTarget(f)
    setMoveDest(folders.find((x) => x !== f.folder) ?? '')
  }
  const confirmMove = async () => {
    if (!moveTarget || !moveDest) return
    await moveFile(moveTarget, moveDest)
    setMoveTarget(null)
  }

  // Drag-reorder folders, with a blue drop-line indicator like the extension.
  const onFolderDrop = (target: string, before: boolean) => {
    const dragged = dragFolder.current
    dragFolder.current = null
    setDropLine(null)
    if (!dragged || dragged === target) return
    const order = folders.filter((f) => f !== dragged)
    let idx = order.indexOf(target)
    if (!before) idx += 1
    order.splice(idx, 0, dragged)
    saveOrder(order); setFolders(order)
  }

  const filterFiles = (list: LibFile[]) => list.filter((f) => (
    typeFilter === 'all' ? true
      : typeFilter === 'video' ? f.isVideo
        : typeFilter === 'audio' ? f.isAudio
          : !f.isVideo && !f.isAudio
  ))

  return (
    <div className="fixed top-0 left-0 z-[75] h-screen w-[340px] flex flex-col" style={{ background: C.panel, borderRight: `1px solid ${C.border}`, boxShadow: '8px 0 24px rgba(0,0,0,0.4)' }}>
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: `1px solid ${C.border}` }}>
        <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: C.text }}><FolderOpen size={15} style={{ color: C.blue }} />Studio Assets</span>
        <div className="flex items-center gap-1">
          <button onClick={collapseAll} title="Collapse all folders" className="h-7 w-7 flex items-center justify-center rounded-md" style={{ color: C.muted }}><ChevronsDownUp size={14} /></button>
          <button onClick={() => void api?.gpmLibReveal({ folder: [...openFolders][0] })} title="Open folder in Explorer" className="h-7 w-7 flex items-center justify-center rounded-md" style={{ color: C.muted }}><FolderOpen size={14} /></button>
          <button onClick={() => void refresh()} title="Refresh" className="h-7 w-7 flex items-center justify-center rounded-md" style={{ color: C.muted }}><RefreshCw size={14} /></button>
          <button onClick={onClose} title="Close" className="h-7 w-7 flex items-center justify-center rounded-md" style={{ color: C.muted }}><X size={16} /></button>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ borderBottom: `1px solid ${C.border}` }}>
        <span className="flex-1 text-[10px] truncate" title={rootPath} style={{ color: C.faint }}>{rootPath}</span>
        <button onClick={() => void chooseFolder()} title="Choose a different folder for the Studio Assets panel" className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium shrink-0" style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}>
          <FolderInput size={11} />Set Folder
        </button>
      </div>

      <div className="px-3 py-2 shrink-0" style={{ borderBottom: `1px solid ${C.border}` }}>
        <div className="flex gap-2">
          <input
            ref={newNameRef} value={newName}
            onChange={(e) => { setNewName(e.target.value); setNameHint(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') void createFolder() }}
            placeholder="Type a folder name…" className="flex-1 rounded-md px-2 py-1.5 text-xs outline-none"
            style={{ background: C.elev, color: C.text, border: `1px solid ${nameHint ? C.amber : C.border}` }}
          />
          <button onClick={() => void createFolder()} title={newName.trim() ? 'Create folder' : 'Type a folder name in the box first'} className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-opacity" style={{ background: C.blue, color: '#fff', opacity: newName.trim() ? 1 : 0.45 }}><FolderPlus size={13} />Create</button>
        </div>
        {nameHint && <p className="mt-1.5 text-[10px] leading-snug" style={{ color: C.amber }}>{nameHint}</p>}
      </div>

      <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ borderBottom: `1px solid ${C.border}` }}>
        <span className="text-[10px] uppercase tracking-wide" style={{ color: C.faint }}>Filter</span>
        <select
          value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          className="rounded px-1.5 py-1 text-[10px] outline-none"
          style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}
        >
          <option value="all">All Files</option>
          <option value="image">Images</option>
          <option value="video">Videos</option>
          <option value="audio">Audio</option>
        </select>
      </div>

      {/* Folders — accordion: click a folder to expand its files inline. */}
      <div className="flex-1 overflow-y-auto">
        {folders.map((f) => {
          // Newest first: most-recently-saved/added files appear at the top of
          // each folder instead of the bottom (mtime desc), so fresh saves don't
          // require scrolling past the whole folder to find.
          const folderFiles = filterFiles(files.filter((x) => x.folder === f)).sort((a, b) => b.mtimeMs - a.mtimeMs)
          const isOpen = openFolders.has(f)
          return (
            <div
              key={f}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(FOLDER_DND) && !e.dataTransfer.types.includes(FILE_DND) && !e.dataTransfer.types.includes(GPM_IMAGE_DND_TYPE)) return
                e.preventDefault()
                if (dragFolder.current && dragFolder.current !== f) {
                  const r = e.currentTarget.getBoundingClientRect()
                  const before = e.clientY - r.top < r.height / 2
                  setDropLine({ target: f, before })
                }
              }}
              onDragLeave={() => setDropLine((d) => (d?.target === f ? null : d))}
              onDrop={(e) => {
                e.preventDefault()
                if (e.dataTransfer.types.includes(FILE_DND)) { const d = JSON.parse(e.dataTransfer.getData(FILE_DND)) as LibFile; void moveFile(d, f) }
                else if (e.dataTransfer.types.includes(GPM_IMAGE_DND_TYPE)) {
                  const raw = e.dataTransfer.getData(GPM_IMAGE_DND_TYPE)
                  if (raw && api) {
                    const { name, dataUrl } = JSON.parse(raw) as GpmDndImage
                    void saveDataUrlToTempFile(dataUrl, name)
                      .then((path) => api.gpmLibAddFiles({ folder: f, srcPaths: [path] }))
                      .then((r) => { if (r.success) { flash(`Added to ${f}`); void refresh() } else flash(r.error) })
                  }
                }
                else if (dragFolder.current) onFolderDrop(f, dropLine?.before ?? true)
              }}
            >
              <div
                draggable
                onDragStart={(e) => { dragFolder.current = f; e.dataTransfer.setData(FOLDER_DND, f); e.dataTransfer.effectAllowed = 'move' }}
                onDragEnd={() => { dragFolder.current = null; setDropLine(null) }}
                onClick={() => toggleFolder(f)}
                className="relative flex items-center gap-1.5 px-3 py-2.5 cursor-pointer group"
                style={{ background: isOpen ? 'rgb(var(--accent) / 0.12)' : 'transparent', borderLeft: `2px solid ${isOpen ? C.blue : 'transparent'}`, borderBottom: `1px solid ${C.border}` }}
              >
                {dropLine?.target === f && (
                  <div
                    className="absolute left-0 right-0 z-10 pointer-events-none"
                    style={{ [dropLine.before ? 'top' : 'bottom']: -1, height: 2, background: C.blue, boxShadow: `0 0 4px ${C.blue}` }}
                  />
                )}
                <GripVertical size={12} style={{ color: C.faint, cursor: 'grab' }} />
                <Triangle open={isOpen} color={isOpen ? C.blue : C.muted} />
                {renaming === f ? (
                  <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)} onClick={(e) => e.stopPropagation()} onBlur={() => void commitRename(f)} onKeyDown={(e) => { if (e.key === 'Enter') void commitRename(f) }} className="flex-1 rounded px-1 py-0.5 text-xs outline-none" style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }} />
                ) : (
                  <span className="flex-1 text-xs font-semibold uppercase tracking-wide truncate" style={{ color: isOpen ? C.blue : C.text }}>{f}</span>
                )}
                <span className="text-[10px] tabular-nums" style={{ color: C.faint }}>{folderFiles.length}</span>
                <Pencil size={11} className="opacity-0 group-hover:opacity-100" style={{ color: C.muted }} onClick={(e) => { e.stopPropagation(); setRenaming(f); setRenameVal(f) }} />
                <Trash2 size={11} className="opacity-0 group-hover:opacity-100" style={{ color: C.muted }} onClick={(e) => { e.stopPropagation(); void deleteFolder(f) }} />
              </div>

              {isOpen && (
                <div className="px-3 py-2" style={{ background: C.card, borderBottom: `1px solid ${C.border}` }}>
                  <div className="flex justify-end mb-2">
                    <button onClick={() => void addFiles(f)} className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium" style={{ background: C.green, color: '#fff' }}><Upload size={11} />Add files</button>
                  </div>
                  {folderFiles.length === 0
                    ? <p className="text-[11px] text-center py-6" style={{ color: C.faint }}>{files.filter((x) => x.folder === f).length === 0 ? 'Empty. Add files or drag media here.' : 'No files match this filter.'}</p>
                    : (
                      <div className="columns-2 gap-2">
                        {folderFiles.map((file) => (
                          <MediaThumb
                            key={file.path} src={pathToFileUrl(file.path)} isVideo={file.isVideo} isAudio={file.isAudio} name={file.name}
                            naturalAspect
                            className="rounded-md break-inside-avoid mb-2" style={{ border: `1px solid ${C.border}` }}
                            draggable
                            onDragStart={(e) => { e.dataTransfer.setData(FILE_DND, JSON.stringify(file)); e.dataTransfer.effectAllowed = 'copyMove' }}
                          >
                            <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100">
                              {!file.isVideo && !file.isAudio && (
                                <button onClick={() => sendToGenSpace(file)} title="Send to Create as input image" className="h-5 w-5 flex items-center justify-center rounded" style={{ background: C.green, color: '#fff' }}><Send size={11} /></button>
                              )}
                              <button onClick={() => openMove(file)} title="Move to folder…" className="h-5 w-5 flex items-center justify-center rounded" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}><FolderOpen size={11} /></button>
                              <button onClick={() => void deleteFile(file)} title="Delete" className="h-5 w-5 flex items-center justify-center rounded" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}><Trash2 size={11} /></button>
                            </div>
                          </MediaThumb>
                        ))}
                      </div>
                    )}
                </div>
              )}
            </div>
          )
        })}
        {folders.length === 0 && <p className="text-[11px] text-center py-4" style={{ color: C.faint }}>No folders yet.</p>}
      </div>

      {toast && <div className="absolute left-1/2 top-3 -translate-x-1/2 z-30 px-3 py-2 rounded-lg text-xs text-center" style={{ background: C.elev, border: `1px solid ${C.borderLt}`, color: C.text, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>{toast}</div>}

      <button
        onClick={onClose} title="Close Studio Assets"
        className="fixed top-1/2 -translate-y-1/2 z-[76] flex flex-col items-center justify-center gap-1.5"
        style={{ left: 340, width: 24, height: 110, background: C.blue, color: '#fff', borderRadius: '0 8px 8px 0', boxShadow: '3px 0 10px rgba(0,0,0,0.35)' }}
      >
        <ChevronLeft size={16} />
        <span className="text-xs font-semibold tracking-wide" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>Close</span>
      </button>

      {moveTarget && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={() => setMoveTarget(null)}>
          <div
            className="rounded-lg p-4 w-[280px]" style={{ background: C.card, border: `1px solid ${C.borderLt}`, boxShadow: '0 20px 50px rgba(0,0,0,0.6)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold mb-2" style={{ color: C.text }}>Move To Folder…</p>
            <p className="text-xs mb-1 truncate" style={{ color: C.text }}>"{moveTarget.name}"</p>
            <p className="text-[11px] mb-3" style={{ color: C.muted }}>From: <span style={{ color: C.blue }}>{moveTarget.folder}</span></p>
            <select
              value={moveDest} onChange={(e) => setMoveDest(e.target.value)}
              className="w-full rounded-md px-2 py-1.5 text-xs outline-none mb-3"
              style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}
            >
              {folders.filter((f) => f !== moveTarget.folder).map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setMoveTarget(null)} className="rounded-md px-3 py-1.5 text-xs font-medium" style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}>Cancel</button>
              <button onClick={() => void confirmMove()} disabled={!moveDest} className="rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-40" style={{ background: C.blue, color: '#fff' }}>Move</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function DownloadsBrowser() {
  const open = useDownloadsBrowserOpen()
  if (!open) {
    return (
      <button onClick={() => setDownloadsBrowserOpen(true)} title="Open Studio Assets" className="fixed top-1/2 -translate-y-1/2 left-0 flex flex-col items-center justify-center gap-1.5 opacity-50 hover:opacity-100 focus-visible:opacity-100 transition-opacity" style={{ width: 24, height: 160, background: C.blue, color: '#fff', borderRadius: '0 8px 8px 0', boxShadow: '3px 0 10px rgba(0,0,0,0.35)' }}>
        <ChevronLeft size={16} style={{ transform: 'rotate(180deg)' }} />
        <span className="text-xs font-semibold tracking-wide" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>Studio Assets</span>
      </button>
    )
  }
  return <Dock onClose={() => setDownloadsBrowserOpen(false)} />
}

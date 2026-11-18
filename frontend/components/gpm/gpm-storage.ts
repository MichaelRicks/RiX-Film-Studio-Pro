/**
 * Prompt Manager Pro — persistence layer (frontend, renderer-only).
 *
 * IndexedDB-backed, schema-compatible with the Grok "Prompt Manager Pro"
 * browser extension so its backup files (version "1.6") import/export cleanly.
 * Storage keys keep the `gpm_*` names to stay compatible with existing backups.
 *
 * NOTE: this is a frontend module (IndexedDB/DOM is fine here). It is NOT part
 * of the pure `gpm-core` engine package.
 */

/* ---- Types (mirror of the extension's backup shapes) --------------------- */
export interface GpmPrompt {
  id: string
  text: string
  _thumb?: string // optional thumbnail dataURL (stored separately, hydrated on demand)
}
export interface GpmPromptFolder {
  id: string
  name: string
  prompts: GpmPrompt[]
}
export interface GpmImageFolder {
  id: string
  name: string
}
export interface GpmImage {
  id: string
  name: string
  folderId: string | null
  dataUrl: string
  addedAt: number | null
  isVideo: boolean
}

export interface GpmWorkflowSlot {
  id: string
  role: string
  note: string
  filled: boolean
  imgId?: string
  imgName?: string
}
export interface GpmWorkflow {
  id: string
  name: string
  updatedAt: number
  slots: GpmWorkflowSlot[]
  directive: string
  aspectRatio: string
  motionHint: string
  performance: { enabled: boolean }
}

/** A saved Performance Studio setting. Family stored by NAME, never index —
 *  the emotion list is alphabetized and append-extensible, so an index would
 *  silently repoint. */
export interface GpmPerformance {
  id: string
  name: string
  updatedAt: number
  family: string
  intensity: number
  asymmetry: number
  dialogue: string
  delivery: string
  dialogueAuto: boolean
}

/** The in-progress Performance state, autosaved so it survives closing the
 *  dock (which unmounts it) and app restarts. Same shape minus the saved-record
 *  identity fields. */
export interface GpmWorkingPerf {
  family: string
  intensity: number
  asymmetry: number
  dialogue: string
  delivery: string
  dialogueAuto: boolean
}

export interface GpmPanorama {
  id: string
  name: string
  dataUrl: string
  addedAt: number
  sourceNote?: string
}

/** Backup envelope (extension format, version "1.6"). Unknown sections are
 *  preserved verbatim on import so re-export round-trips losslessly. */
export interface GpmBackup {
  version: string
  date: string
  folders: GpmPromptFolder[]
  imgFolders: GpmImageFolder[]
  imgAssignments: Record<string, string>
  imgImages: GpmImage[]
  workflows?: unknown[]
  dlFolders?: unknown[]
  dlAssignments?: Record<string, unknown>
  dlPanelWidth?: number
}

const DB_NAME = 'gpm_images_db'
const DB_VERSION = 2
const IMG_STORE = 'images'
const THUMB_STORE = 'prompt_thumbs'
const KV_STORE = 'kv'
const PANO_STORE = 'panoramas'

const KEY_PROMPTS = 'gpm_data_v2'
const KEY_IMG_FOLDERS = 'gpm_img_state_v1'
const KEY_WORKFLOWS = 'gpm_workflows_v1'
const KEY_PERFORMANCES = 'gpm_performances_v1'
const KEY_PERF_WORKING = 'gpm_perf_working_v1'
const KEY_PASSTHROUGH = 'gpm_backup_passthrough' // dl* kept for lossless re-export

export const BACKUP_VERSION = '1.6'
export const MAX_PANORAMAS = 20

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IMG_STORE)) db.createObjectStore(IMG_STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(THUMB_STORE)) db.createObjectStore(THUMB_STORE, { keyPath: 'promptId' })
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE, { keyPath: 'key' })
      if (!db.objectStoreNames.contains(PANO_STORE)) db.createObjectStore(PANO_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = fn(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

function getAll<T>(store: string): Promise<T[]> {
  return tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)
}

/* ---- KV helpers (folders/passthrough live here) -------------------------- */
interface KvRecord<T> { key: string; value: T }

async function kvGet<T>(key: string, fallback: T): Promise<T> {
  const rec = await tx<KvRecord<T> | undefined>(KV_STORE, 'readonly', (s) => s.get(key) as IDBRequest<KvRecord<T> | undefined>)
  return rec ? rec.value : fallback
}
function kvSet<T>(key: string, value: T): Promise<IDBValidKey> {
  return tx<IDBValidKey>(KV_STORE, 'readwrite', (s) => s.put({ key, value }))
}

/* ---- IDs ----------------------------------------------------------------- */
export function gpmId(): string {
  return Math.random().toString(36).slice(2, 9)
}

/* ---- Prompt folders ------------------------------------------------------ */
export function loadPromptFolders(): Promise<GpmPromptFolder[]> {
  return kvGet<GpmPromptFolder[]>(KEY_PROMPTS, [])
}
export function savePromptFolders(folders: GpmPromptFolder[]): Promise<IDBValidKey> {
  // Persist folders without inline thumbs (kept lean); thumbs live in THUMB_STORE.
  const lean = folders.map((f) => ({ ...f, prompts: f.prompts.map(({ id, text }) => ({ id, text })) }))
  return kvSet(KEY_PROMPTS, lean)
}

/** Downscale a (possibly large) image data URL into a compact JPEG thumbnail so
 *  the per-prompt visual cue stays light in IndexedDB. Falls back to the original
 *  data URL if the image can't be decoded. */
export function downscaleToThumb(dataUrl: string, maxW = 360): Promise<string> {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.onload = () => {
      try {
        const scale = Math.min(1, maxW / (img.naturalWidth || maxW))
        const w = Math.max(1, Math.round((img.naturalWidth || maxW) * scale))
        const h = Math.max(1, Math.round((img.naturalHeight || maxW) * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(dataUrl); return }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

/** Fired on `window` after something outside the Prompt Manager changes the saved prompts
 *  (Claude's save_prompt), so an open Prompts panel reloads instead of overwriting them. */
export const GPM_PROMPTS_CHANGED = 'gpm-prompts-changed'

interface ThumbRecord { promptId: string; _thumb: string }
export function getPromptThumb(promptId: string): Promise<string | undefined> {
  return tx<ThumbRecord | undefined>(THUMB_STORE, 'readonly', (s) => s.get(promptId) as IDBRequest<ThumbRecord | undefined>)
    .then((r) => r?._thumb)
}
/** Original (full-size) reference image per prompt, so Inject can load it as the first frame.
 *  The thumbnail itself is only 360px wide, far too small to generate from. */
const KEY_PROMPT_IMAGES = 'gpm_prompt_images_v1'
export async function getPromptImagePath(promptId: string): Promise<string | undefined> {
  return (await kvGet<Record<string, string>>(KEY_PROMPT_IMAGES, {}))[promptId]
}
export async function setPromptImagePath(promptId: string, path: string): Promise<void> {
  const map = await kvGet<Record<string, string>>(KEY_PROMPT_IMAGES, {})
  map[promptId] = path
  await kvSet(KEY_PROMPT_IMAGES, map)
}
export function setPromptThumb(promptId: string, thumb: string): Promise<IDBValidKey> {
  return tx<IDBValidKey>(THUMB_STORE, 'readwrite', (s) => s.put({ promptId, _thumb: thumb }))
}
export function deletePromptThumb(promptId: string): Promise<undefined> {
  return tx<undefined>(THUMB_STORE, 'readwrite', (s) => s.delete(promptId) as IDBRequest<undefined>)
}
/** Load every prompt thumbnail at once, keyed by promptId. */
export function loadAllPromptThumbs(): Promise<Record<string, string>> {
  return getAll<ThumbRecord>(THUMB_STORE).then((recs) => {
    const map: Record<string, string> = {}
    for (const r of recs) map[r.promptId] = r._thumb
    return map
  })
}

/* ---- Image folders + images ---------------------------------------------- */
export function loadImageFolders(): Promise<GpmImageFolder[]> {
  return kvGet<GpmImageFolder[]>(KEY_IMG_FOLDERS, [])
}
export function saveImageFolders(folders: GpmImageFolder[]): Promise<IDBValidKey> {
  return kvSet(KEY_IMG_FOLDERS, folders)
}
export function loadImages(): Promise<GpmImage[]> {
  return getAll<GpmImage>(IMG_STORE)
}
export function putImage(img: GpmImage): Promise<IDBValidKey> {
  return tx<IDBValidKey>(IMG_STORE, 'readwrite', (s) => s.put(img))
}
export function deleteImage(id: string): Promise<undefined> {
  return tx<undefined>(IMG_STORE, 'readwrite', (s) => s.delete(id) as IDBRequest<undefined>)
}

/* ---- Saved workflows ----------------------------------------------------- */
export function loadWorkflows(): Promise<GpmWorkflow[]> {
  return kvGet<GpmWorkflow[]>(KEY_WORKFLOWS, [])
}
export function saveWorkflows(list: GpmWorkflow[]): Promise<IDBValidKey> {
  return kvSet(KEY_WORKFLOWS, list)
}

/* ---- Saved performances + autosaved working performance ------------------ */
export function loadPerformances(): Promise<GpmPerformance[]> {
  return kvGet<GpmPerformance[]>(KEY_PERFORMANCES, [])
}
export function savePerformances(list: GpmPerformance[]): Promise<IDBValidKey> {
  return kvSet(KEY_PERFORMANCES, list)
}
export function loadWorkingPerf(): Promise<GpmWorkingPerf | null> {
  return kvGet<GpmWorkingPerf | null>(KEY_PERF_WORKING, null)
}
export function saveWorkingPerf(p: GpmWorkingPerf): Promise<IDBValidKey> {
  return kvSet(KEY_PERF_WORKING, p)
}

/* ---- Panoramas (Plates) -------------------------------------------------- */
export function loadPanoramas(): Promise<GpmPanorama[]> {
  return getAll<GpmPanorama>(PANO_STORE)
}
export function putPanorama(p: GpmPanorama): Promise<IDBValidKey> {
  return tx<IDBValidKey>(PANO_STORE, 'readwrite', (s) => s.put(p))
}
export function deletePanorama(id: string): Promise<undefined> {
  return tx<undefined>(PANO_STORE, 'readwrite', (s) => s.delete(id) as IDBRequest<undefined>)
}

/* Map a saved workflow to the extension's backup slot shape and back. */
function workflowToBackup(w: GpmWorkflow): Record<string, unknown> {
  return {
    id: w.id, name: w.name, updatedAt: w.updatedAt,
    directive: w.directive, aspectRatio: w.aspectRatio, motionHint: w.motionHint,
    performance: w.performance,
    slots: w.slots.map((s) => ({ id: s.id, imgId: s.imgId, imgName: s.imgName, role: s.role, note: s.note })),
  }
}
function workflowFromBackup(raw: unknown): GpmWorkflow | null {
  if (!raw || typeof raw !== 'object') return null
  const w = raw as Record<string, any>
  if (!w.id || !w.name) return null
  const slots: GpmWorkflowSlot[] = Array.isArray(w.slots)
    ? w.slots.map((s: any) => ({ id: String(s.id ?? gpmId()), role: String(s.role ?? 'general'), note: String(s.note ?? ''), filled: !!s.imgId, imgId: s.imgId || undefined, imgName: s.imgName || undefined }))
    : []
  return {
    id: String(w.id), name: String(w.name), updatedAt: Number(w.updatedAt) || Date.now(),
    slots, directive: String(w.directive ?? ''), aspectRatio: String(w.aspectRatio ?? '16:9'),
    motionHint: String(w.motionHint ?? ''), performance: { enabled: !!(w.performance && w.performance.enabled) },
  }
}

/* ---- Backup: export / import (extension v1.6 compatible) ----------------- */
export async function exportBackup(): Promise<GpmBackup> {
  const [folders, imgFolders, imgImages, workflows, passthrough] = await Promise.all([
    loadPromptFolders(),
    loadImageFolders(),
    loadImages(),
    loadWorkflows(),
    kvGet<Partial<GpmBackup>>(KEY_PASSTHROUGH, {}),
  ])
  // Re-inline prompt thumbnails for full fidelity with the extension format.
  const foldersWithThumbs: GpmPromptFolder[] = await Promise.all(
    folders.map(async (f) => ({
      ...f,
      prompts: await Promise.all(
        f.prompts.map(async (p) => {
          const thumb = await getPromptThumb(p.id)
          return thumb ? { ...p, _thumb: thumb } : p
        }),
      ),
    })),
  )
  const imgAssignments: Record<string, string> = {}
  for (const im of imgImages) if (im.folderId) imgAssignments[`__id__${im.id}`] = im.folderId

  return {
    version: BACKUP_VERSION,
    date: new Date().toISOString(),
    folders: foldersWithThumbs,
    imgFolders,
    imgAssignments,
    imgImages,
    workflows: workflows.map(workflowToBackup),
    dlFolders: passthrough.dlFolders ?? [],
    dlAssignments: passthrough.dlAssignments ?? {},
    dlPanelWidth: passthrough.dlPanelWidth ?? 416,
  }
}

export interface ImportResult {
  promptFolders: number
  prompts: number
  imageFolders: number
  images: number
  workflows: number
}

/** Import a backup, REPLACING current data. Returns counts for feedback. */
export async function importBackup(data: GpmBackup): Promise<ImportResult> {
  const folders = Array.isArray(data.folders) ? data.folders : []
  const imgFolders = Array.isArray(data.imgFolders) ? data.imgFolders : []
  const imgImages = Array.isArray(data.imgImages) ? data.imgImages : []

  // Split thumbnails out, persist prompt folders lean.
  await savePromptFolders(folders)
  let prompts = 0
  for (const f of folders) {
    for (const p of f.prompts ?? []) {
      prompts++
      if (p._thumb) await setPromptThumb(p.id, p._thumb)
    }
  }

  await saveImageFolders(imgFolders)
  for (const im of imgImages) {
    await putImage({
      id: im.id,
      name: im.name,
      folderId: im.folderId ?? null,
      dataUrl: im.dataUrl,
      addedAt: im.addedAt ?? null,
      isVideo: !!im.isVideo,
    })
  }

  // Workflows: map the extension's shape into our saved-workflow store.
  const workflows = (Array.isArray(data.workflows) ? data.workflows : [])
    .map(workflowFromBackup)
    .filter((w): w is GpmWorkflow => w !== null)
  await saveWorkflows(workflows)

  // Preserve sections the fork doesn't manage yet so re-export is lossless.
  await kvSet(KEY_PASSTHROUGH, {
    dlFolders: data.dlFolders ?? [],
    dlAssignments: data.dlAssignments ?? {},
    dlPanelWidth: data.dlPanelWidth ?? 416,
  })

  return { promptFolders: folders.length, prompts, imageFolders: imgFolders.length, images: imgImages.length, workflows: workflows.length }
}

/** Parse + validate a backup file's text. Throws on malformed input. */
export function parseBackup(text: string): GpmBackup {
  const data = JSON.parse(text) as Partial<GpmBackup>
  if (!data || typeof data !== 'object' || !Array.isArray(data.folders)) {
    throw new Error('Not a valid Prompt Manager Pro backup (missing "folders").')
  }
  return {
    version: data.version ?? BACKUP_VERSION,
    date: data.date ?? new Date().toISOString(),
    folders: data.folders,
    imgFolders: data.imgFolders ?? [],
    imgAssignments: data.imgAssignments ?? {},
    imgImages: data.imgImages ?? [],
    workflows: data.workflows ?? [],
    dlFolders: data.dlFolders ?? [],
    dlAssignments: data.dlAssignments ?? {},
    dlPanelWidth: data.dlPanelWidth ?? 416,
  }
}

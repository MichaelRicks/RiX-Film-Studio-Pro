import { migrateProjectData, projectSchema, type Project } from '../types/project-model'
import { logger } from './logger'
import { removeProjectBackup, saveProjectNow, scheduleProjectBackup } from './project-backup'

export const PROJECT_IDS_STORAGE_KEY = 'ltx-project-ids'
export const PROJECT_STORAGE_KEY_PREFIX = 'ltx-project-'

// Project records live on disk (<project assets>/<id>/project.rix.json, order in
// .project-ids.json — see electron/ipc/project-backup-handlers.ts). The API below
// stays synchronous: hydrateProjectStorage() loads everything into `records` once at
// startup, reads come from memory, and writes go to memory + a debounced disk save.
// localStorage used to hold all of this (~5 MB quota, per-origin, rolled back by bad
// shutdowns); it is now read once to migrate old data to disk and then cleared.
//
// `records` stays null when there is no Electron API (plain browser), and the old
// localStorage behavior applies.
let records: Map<string, string> | null = null
let idsCache: string[] = []

const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/

export function getProjectStorageKey(projectId: string): string {
  return `${PROJECT_STORAGE_KEY_PREFIX}${projectId}`
}

function updatedAtOf(raw: string): number {
  try {
    const value = Number((JSON.parse(raw) as { updatedAt?: unknown }).updatedAt)
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

function readLocalIds(): string[] {
  try {
    const stored = localStorage.getItem(PROJECT_IDS_STORAGE_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** Every project id that has a localStorage record (the list can lag behind the records). */
function localProjectKeys(): Map<string, string> {
  const keys = new Map<string, string>()
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key && key.startsWith(PROJECT_STORAGE_KEY_PREFIX) && key !== PROJECT_IDS_STORAGE_KEY) {
        keys.set(key.slice(PROJECT_STORAGE_KEY_PREFIX.length), key)
      }
    }
  } catch { /* storage unavailable */ }
  return keys
}

/**
 * Load the project store from disk (and migrate anything still in localStorage).
 * Call once, before the first render.
 */
export async function hydrateProjectStorage(): Promise<void> {
  const api = typeof window === 'undefined' ? undefined : window.electronAPI
  if (!api?.loadProjectStore || !api.saveProjectBackup) return
  try {
    const disk = await api.loadProjectStore()
    const loaded = new Map<string, string>()
    const updated = new Map<string, number>()
    for (const project of disk.projects) {
      loaded.set(project.projectId, project.data)
      updated.set(project.projectId, updatedAtOf(project.data))
    }

    // Take localStorage's copy where disk has none or an older one.
    const toUpload: string[] = []
    const localKeys = localProjectKeys()
    const localIds = readLocalIds()
    for (const [id, key] of localKeys) {
      if (!PROJECT_ID_PATTERN.test(id)) { logger.warn(`Not migrating project with unsupported id: ${id}`); continue }
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const localUpdatedAt = updatedAtOf(raw)
      const diskUpdatedAt = updated.get(id)
      if (diskUpdatedAt === undefined || localUpdatedAt > diskUpdatedAt) {
        loaded.set(id, raw)
        updated.set(id, localUpdatedAt)
        toUpload.push(id)
      }
    }

    // A project deleted since its record was written stays deleted.
    for (const { projectId, deletedAt } of disk.deleted) {
      if (loaded.has(projectId) && (updated.get(projectId) ?? 0) <= deletedAt) loaded.delete(projectId)
    }

    // Order: the old localStorage list (the user's ordering), then the saved disk
    // list, then anything else by recency.
    const order: string[] = []
    const add = (id: string) => { if (loaded.has(id) && !order.includes(id)) order.push(id) }
    localIds.forEach(add)
    ;(disk.ids ?? []).forEach(add)
    Array.from(loaded.keys())
      .sort((a, b) => (updated.get(b) ?? 0) - (updated.get(a) ?? 0))
      .forEach(add)

    records = loaded
    idsCache = order

    const idsChanged = JSON.stringify(order) !== JSON.stringify(disk.ids ?? [])
    if (toUpload.length === 0 && !idsChanged && localKeys.size === 0 && localIds.length === 0) return

    // Persist the merge, and only clear localStorage once everything is on disk.
    let allSaved = true
    for (const id of toUpload) {
      if (!(await saveProjectNow(id, loaded.get(id)!))) allSaved = false
    }
    if (idsChanged) {
      const result = await api.saveProjectIds({ ids: order })
      if (!result.success) allSaved = false
    }
    if (allSaved) {
      for (const key of localKeys.values()) {
        try { localStorage.removeItem(key) } catch { /* ignore */ }
      }
      try { localStorage.removeItem(PROJECT_IDS_STORAGE_KEY) } catch { /* ignore */ }
      if (toUpload.length > 0) logger.info(`Migrated ${toUpload.length} project(s) from localStorage to disk`)
    } else {
      logger.error('Project migration to disk incomplete; keeping localStorage copies')
    }
  } catch (error) {
    // Without the store in memory the app would show an empty project list, so fall
    // back to localStorage rather than start from nothing.
    records = null
    logger.error(`Failed to load project store from disk: ${error}`)
  }
}

export function readProjectIds(): string[] {
  if (records) return [...idsCache]
  try {
    const stored = localStorage.getItem(PROJECT_IDS_STORAGE_KEY)
    if (!stored) return []

    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) {
      logger.error('Project ids payload is not an array')
      return []
    }

    return parsed.filter((projectId): projectId is string => typeof projectId === 'string')
  } catch (error) {
    logger.error(`Failed to read project ids: ${error}`)
    return []
  }
}

export function writeProjectIds(projectIds: string[]): void {
  const unique = Array.from(new Set(projectIds))
  if (records) {
    idsCache = unique
    void window.electronAPI?.saveProjectIds?.({ ids: unique })
      .then(result => { if (!result.success) logger.error(`Failed to save project list: ${result.error}`) })
      .catch(error => logger.error(`Failed to save project list: ${error}`))
    return
  }
  localStorage.setItem(PROJECT_IDS_STORAGE_KEY, JSON.stringify(unique))
}

function readRawProject(projectId: string): string | null {
  return records ? (records.get(projectId) ?? null) : localStorage.getItem(getProjectStorageKey(projectId))
}

/** Store a project record exactly as given (the legacy-format migration writes these). */
export function writeRawProjectRecord(projectId: string, raw: string): void {
  if (records) {
    records.set(projectId, raw)
    scheduleProjectBackup(projectId, raw)
    return
  }
  localStorage.setItem(getProjectStorageKey(projectId), raw)
}

export function readProject(projectId: string): Project | null {
  try {
    const stored = readRawProject(projectId)
    if (!stored) return null

    const { project, migrated } = migrateProjectData(JSON.parse(stored))
    const normalizedProject = project.id === projectId
      ? project
      : projectSchema.parse({ ...project, id: projectId })

    if (migrated || normalizedProject.id !== project.id) {
      writeProject(projectId, normalizedProject)
    }

    return normalizedProject
  } catch (error) {
    logger.error(`Failed to read project ${projectId}: ${error}`)
    return null
  }
}

export function writeProject(projectId: string, project: Project): Project {
  const normalizedProject = projectSchema.parse({ ...project, id: projectId })
  const serialized = JSON.stringify(normalizedProject)
  if (records) records.set(projectId, serialized)
  else localStorage.setItem(getProjectStorageKey(projectId), serialized)
  scheduleProjectBackup(projectId, serialized)
  return normalizedProject
}

export function deleteProjectEntry(projectId: string): void {
  if (records) records.delete(projectId)
  else localStorage.removeItem(getProjectStorageKey(projectId))
  removeProjectBackup(projectId)
}

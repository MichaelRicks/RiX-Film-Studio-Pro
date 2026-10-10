import { logger } from './logger'

// Writes each project record to a file in its project folder (see
// electron/ipc/project-backup-handlers.ts). With the on-disk project store these
// files ARE the saved projects (project-storage.ts keeps an in-memory copy), so the
// debounce stays short.

const BACKUP_DEBOUNCE_MS = 400

export interface ProjectBackupInfo {
  projectId: string
  name: string
  updatedAt: number
  assetCount: number
}

const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; data: string }>()

const api = () => (typeof window === 'undefined' ? undefined : window.electronAPI)

function flush(projectId: string): void {
  const entry = pending.get(projectId)
  if (!entry) return
  clearTimeout(entry.timer)
  pending.delete(projectId)
  void api()?.saveProjectBackup({ projectId, data: entry.data })
    .then(result => {
      if (!result.success) logger.error(`Project backup failed for ${projectId}: ${result.error}`)
    })
    .catch(error => logger.error(`Project backup failed for ${projectId}: ${error}`))
}

/** Queue the latest serialized project for writing to disk (debounced per project). */
export function scheduleProjectBackup(projectId: string, data: string): void {
  if (!api()?.saveProjectBackup) return
  const existing = pending.get(projectId)
  if (existing) clearTimeout(existing.timer)
  pending.set(projectId, { data, timer: setTimeout(() => flush(projectId), BACKUP_DEBOUNCE_MS) })
}

/** Write a project to disk now and resolve whether it landed (used by the localStorage -> disk migration). */
export async function saveProjectNow(projectId: string, data: string): Promise<boolean> {
  const existing = pending.get(projectId)
  if (existing) { clearTimeout(existing.timer); pending.delete(projectId) }
  try {
    const result = await api()?.saveProjectBackup({ projectId, data })
    return !!result?.success
  } catch (error) {
    logger.error(`Project save failed for ${projectId}: ${error}`)
    return false
  }
}

/** Deleting a project removes its backup too, so it isn't offered for restore. */
export function removeProjectBackup(projectId: string): void {
  const existing = pending.get(projectId)
  if (existing) clearTimeout(existing.timer)
  pending.delete(projectId)
  void api()?.deleteProjectBackup?.({ projectId }).catch(error => logger.error(`Failed to delete project backup ${projectId}: ${error}`))
}

export async function listProjectBackups(): Promise<ProjectBackupInfo[]> {
  return (await api()?.listProjectBackups?.()) ?? []
}

/** Project id -> when it was deleted, for projects deleted from any copy of the project list. */
export async function listDeletedProjects(): Promise<Map<string, number>> {
  const deleted = (await api()?.listDeletedProjects?.()) ?? []
  return new Map(deleted.map(entry => [entry.projectId, entry.deletedAt]))
}

export async function readProjectBackup(projectId: string): Promise<unknown> {
  const result = await window.electronAPI.readProjectBackup({ projectId })
  if (!result.success) throw new Error(result.error)
  return JSON.parse(result.data)
}

// Don't lose the last edits when the window closes inside the debounce.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const projectId of Array.from(pending.keys())) flush(projectId)
  })
}

/**
 * "Back up all projects": make sure an open editor has flushed, let the debounced
 * disk write land, then ask the main process to copy every project's record to a
 * folder the user picks. The main process shows the result dialog.
 */
export async function backupAllProjects(): Promise<void> {
  window.dispatchEvent(new Event('ltx:flush-editor'))
  await new Promise(resolve => setTimeout(resolve, BACKUP_DEBOUNCE_MS + 800))
  const result = await api()?.backupAllProjects()
  if (result?.status === 'failed') {
    logger.error(`Project backup failed: ${result.error}`)
    window.alert(`Project backup failed: ${result.error}`)
  }
}

// The editor's Regenerate queue. The backend runs one generation at a time, so a shot
// regenerated while another is running waits here, with its prompt and settings frozen
// at the moment it was queued. Plain list operations; useRegeneration owns the state.

import type { GenerationParams } from '../../types/project-model'

export interface RegenJob {
  id: string
  assetId: string
  clipId?: string
  /** What the panel shows for the job. */
  label: string
  params: GenerationParams
}

let nextJobNumber = 1

export function makeRegenJob(job: Omit<RegenJob, 'id'>): RegenJob {
  return { ...job, id: `regen-${Date.now().toString(36)}-${nextJobNumber++}` }
}

const sameTarget = (a: RegenJob, b: Pick<RegenJob, 'assetId' | 'clipId'>) =>
  a.assetId === b.assetId && a.clipId === b.clipId

/** Adds a job at the back. Queuing the same shot again replaces its waiting job, in place,
 *  so changing your mind about a prompt does not make the shot render twice. */
export function enqueueRegen(queue: RegenJob[], job: RegenJob): RegenJob[] {
  const i = queue.findIndex(q => sameTarget(q, job))
  if (i === -1) return [...queue, job]
  const next = queue.slice()
  next[i] = job
  return next
}

export function removeRegen(queue: RegenJob[], id: string): RegenJob[] {
  return queue.some(q => q.id === id) ? queue.filter(q => q.id !== id) : queue
}

export function moveRegen(queue: RegenJob[], id: string, to: 'up' | 'down' | 'top'): RegenJob[] {
  const from = queue.findIndex(q => q.id === id)
  if (from === -1) return queue
  const target = to === 'top' ? 0 : to === 'up' ? from - 1 : from + 1
  if (target < 0 || target >= queue.length || target === from) return queue
  const next = queue.slice()
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved)
  return next
}

export function isRegenQueued(queue: RegenJob[], assetId: string, clipId?: string): boolean {
  return queue.some(q => sameTarget(q, { assetId, clipId }))
}

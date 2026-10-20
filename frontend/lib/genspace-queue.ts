// GenSpace's generation queue. A queued job is a closure over the screen as it was at the
// click (see startOrQueue in GenSpace.tsx), so it carries no data of its own to persist.

export interface QueuedLaunch {
  id: string
  /** What the queue panel shows. */
  label: string
  /** Starts the job. Called once, when the slot is free. */
  run: () => Promise<void> | void
}

export function removeQueuedLaunch<T extends { id: string }>(queue: T[], id: string): T[] {
  return queue.some(q => q.id === id) ? queue.filter(q => q.id !== id) : queue
}

export function moveQueuedLaunch<T extends { id: string }>(queue: T[], id: string, to: 'up' | 'down' | 'top'): T[] {
  const from = queue.findIndex(q => q.id === id)
  if (from === -1) return queue
  const target = to === 'top' ? 0 : to === 'up' ? from - 1 : from + 1
  if (target < 0 || target >= queue.length || target === from) return queue
  const next = queue.slice()
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved)
  return next
}

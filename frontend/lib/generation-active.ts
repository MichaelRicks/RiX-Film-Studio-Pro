import { useSyncExternalStore } from 'react'

// Local, live "is a generation running?" signal for the renderer UI.
// Ref-counted because generations can overlap.
let activeCount = 0
const listeners = new Set<() => void>()
function emit() { for (const l of listeners) l() }

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
function getSnapshot(): boolean {
  return activeCount > 0
}

export function useIsGenerationActive(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// The backend runs one generation at a time for the whole app and refuses a second request
// with 409. Create and the editor each have their own queue, and both can see the slot free up
// in the same instant and launch together. Generation requests therefore pass through this one
// lock in the renderer: the second simply waits for the first to finish.
let exclusiveTail: Promise<unknown> = Promise.resolve()
async function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const previous = exclusiveTail
  let release!: () => void
  exclusiveTail = new Promise<void>(resolve => { release = resolve })
  try {
    await previous.catch(() => undefined)
    return await fn()
  } finally {
    release()
  }
}

export interface GenerationActiveOptions {
  /** Take a turn on the app-wide generation lock. Set it for real generation requests; leave it
   *  off for short side requests (prompt enhancement) that may run alongside one. */
  exclusive?: boolean
}

// Local generation can starve the backend's event loop; withGenerationActive tells main so the
// liveness monitor doesn't kill a busy backend. We also keep a local count for the UI signal above.
export async function withGenerationActive<T>(fn: () => Promise<T>, options: GenerationActiveOptions = {}): Promise<T> {
  activeCount += 1; emit()
  const run = async (): Promise<T> => {
    void window.electronAPI.notifyGenerationActive({ active: true })
    try {
      return await fn()
    } finally {
      void window.electronAPI.notifyGenerationActive({ active: false })
    }
  }
  try {
    return await (options.exclusive ? runExclusive(run) : run())
  } finally {
    activeCount = Math.max(0, activeCount - 1); emit()
  }
}

/** A real generation request: waits its turn on the app-wide lock, then runs. */
export function withExclusiveGeneration<T>(fn: () => Promise<T>): Promise<T> {
  return withGenerationActive(fn, { exclusive: true })
}

/** Evaluate at job start and freeze — live Settings must not flip Stop mid-request. */
export function canCancelLocalJob(
  kind: 'video' | 'image',
  videoUsesLtxApi: boolean,
  imageUsesFalApi: boolean,
): boolean {
  if (kind === 'image') return !imageUsesFalApi
  if (kind === 'video') return !videoUsesLtxApi
  return false
}

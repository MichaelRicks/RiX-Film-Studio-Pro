// The IC-LoRA Output panel's finished clips: browsed with arrows, so a queue's results can be
// watched while the next one renders. Clearing only empties the panel; the clips are project
// assets and stay in the gallery.

export interface IcLoraOutputClip {
  path: string
  renderMs?: number
}

export interface IcLoraOutputHistory {
  clips: IcLoraOutputClip[]
  /** Index of the clip being watched, or null to follow the live run (the newest clip when idle). */
  view: number | null
}

export const EMPTY_IC_LORA_OUTPUT: IcLoraOutputHistory = { clips: [], view: null }

/** A finished clip: shown at once if the live run was being watched; otherwise the clip on
 *  screen stays put, so a queue never interrupts playback. */
export function addOutputClip(history: IcLoraOutputHistory, clip: IcLoraOutputClip): IcLoraOutputHistory {
  const clips = [...history.clips, clip]
  return { clips, view: history.view ?? clips.length - 1 }
}

/** A run started by pressing Generate (not by the queue) brings its progress on screen. */
export function followLiveRun(history: IcLoraOutputHistory): IcLoraOutputHistory {
  return history.view === null ? history : { ...history, view: null }
}

/** What the panel shows. While running, the live run is the last place after the finished clips. */
export function outputSelection(history: IcLoraOutputHistory, running: boolean) {
  const total = history.clips.length + (running ? 1 : 0)
  const index = history.view ?? Math.max(0, total - 1)
  return { total, index, clip: history.clips[index] as IcLoraOutputClip | undefined }
}

export function stepOutput(history: IcLoraOutputHistory, running: boolean, step: -1 | 1): IcLoraOutputHistory {
  const { total, index } = outputSelection(history, running)
  const next = Math.min(Math.max(index + step, 0), Math.max(0, total - 1))
  return { ...history, view: next >= history.clips.length ? null : next }
}

/** Drops clips that left the project (deleted from the gallery). */
export function keepOutputClips(history: IcLoraOutputHistory, existing: ReadonlySet<string>): IcLoraOutputHistory {
  if (history.clips.every(c => existing.has(c.path))) return history
  const clips = history.clips.filter(c => existing.has(c.path))
  const watched = history.view === null ? undefined : history.clips[history.view]
  if (history.view === null) return { clips, view: null }
  const at = watched ? clips.indexOf(watched) : -1
  const view = at >= 0 ? at : Math.min(history.view, clips.length - 1)
  return { clips, view: view >= 0 ? view : null }
}

// Timeline snapping. One helper shared by clip drag, trim and drop-from-Assets so
// every snap feels the same: a reach measured in screen pixels (not seconds, so it
// does not change with zoom), a single nearest target, and a lock that holds until
// the pointer pulls well away from it.

/** Pointer distance, in px, at which an edge grabs a target. */
export const SNAP_ENGAGE_PX = 10
/** Once locked, the pointer has to travel this far from the target to let go. */
export const SNAP_RELEASE_PX = 22
/** Dropping from the Assets panel reaches further: the aim is "next to the last clip". */
export const DROP_SNAP_ENGAGE_PX = 80

export interface SnapLock {
  /** Timeline time the edge is locked to. */
  target: number
  /** Which edge of the moving item is locked, as seconds from its start (0 = start edge). */
  edgeOffset: number
}

export interface SnapOptions {
  /** Where the moving item would start with no snapping. */
  start: number
  /** Edges of the moving item that may snap, as seconds from its start, e.g. [0, duration]. */
  edgeOffsets: number[]
  /** Times an edge can snap to. */
  targets: number[]
  pixelsPerSecond: number
  lock: SnapLock | null
  engagePx?: number
  releasePx?: number
}

export interface SnapResult {
  start: number
  /** The lock to carry into the next pointer move, or null when free. */
  lock: SnapLock | null
}

export function resolveSnap(opts: SnapOptions): SnapResult {
  const { start, edgeOffsets, targets, pixelsPerSecond, lock } = opts
  const engagePx = opts.engagePx ?? SNAP_ENGAGE_PX
  const releasePx = Math.max(opts.releasePx ?? SNAP_RELEASE_PX, engagePx)
  if (!(pixelsPerSecond > 0)) return { start, lock: null }

  // Stay locked while the pointer is still near: a hand tremor must not drop the snap.
  if (lock && targets.some(t => Math.abs(t - lock.target) < 1e-6)) {
    const distPx = Math.abs(start + lock.edgeOffset - lock.target) * pixelsPerSecond
    if (distPx <= releasePx) return { start: lock.target - lock.edgeOffset, lock }
  }

  let best: SnapLock | null = null
  let bestPx = engagePx
  for (const edgeOffset of edgeOffsets) {
    const edge = start + edgeOffset
    for (const target of targets) {
      const distPx = Math.abs(edge - target) * pixelsPerSecond
      if (distPx <= bestPx) {
        bestPx = distPx
        best = { target, edgeOffset }
      }
    }
  }
  if (!best) return { start, lock: null }
  return { start: best.target - best.edgeOffset, lock: best }
}

/** A music clip's beats on the timeline: its song's beat times, shifted to where the clip plays them. */
export function clipBeatTimes(clip: {
  type: string; startTime: number; duration: number; trimStart: number; speed: number
  asset?: { beats?: number[] } | null
}): number[] {
  const beats = clip.asset?.beats
  if (clip.type !== 'audio' || !beats || beats.length === 0) return []
  const speed = clip.speed || 1
  const times: number[] = []
  for (const beat of beats) {
    const t = clip.startTime + (beat - clip.trimStart) / speed
    if (t >= clip.startTime - 1e-6 && t <= clip.startTime + clip.duration + 1e-6) times.push(t)
  }
  return times
}

/** Every beat on the timeline from music clips other than `exclude` (the ones being dragged or trimmed). */
export function beatSnapTimes(
  clips: Array<Parameters<typeof clipBeatTimes>[0] & { id: string }>,
  exclude: ReadonlySet<string>,
): number[] {
  const times: number[] = []
  for (const clip of clips) if (!exclude.has(clip.id)) times.push(...clipBeatTimes(clip))
  return times
}

interface SnapClip {
  trackIndex: number
  startTime: number
  duration: number
}

/** Where a clip dropped at `rawStart` on `trackIndex` should start: flush against the
 *  clip behind it (or in front of the one after it) when close, otherwise exactly where
 *  it was dropped so a deliberate gap still works. */
export function snapDropStart(opts: {
  rawStart: number
  /** Dropped clip length, when known; lets its end snap to the next clip's start. */
  duration?: number
  trackIndex: number
  clips: SnapClip[]
  pixelsPerSecond: number
  engagePx?: number
}): number {
  const { rawStart, duration, trackIndex, clips, pixelsPerSecond } = opts
  const onTrack = clips.filter(c => c.trackIndex === trackIndex)
  if (onTrack.length === 0) return Math.max(0, rawStart)

  const lastEnd = Math.max(...onTrack.map(c => c.startTime + c.duration))
  const targets = [0]
  for (const c of onTrack) {
    targets.push(c.startTime + c.duration)
    if (duration && duration > 0) targets.push(c.startTime)
  }
  const edgeOffsets = duration && duration > 0 ? [0, duration] : [0]
  // A drop onto or past the end of the track is the "append" case; give it the reach.
  const appending = rawStart >= lastEnd - 1e-6
  const { start } = resolveSnap({
    start: Math.max(0, rawStart),
    edgeOffsets,
    targets,
    pixelsPerSecond,
    lock: null,
    engagePx: opts.engagePx ?? (appending ? DROP_SNAP_ENGAGE_PX : SNAP_ENGAGE_PX * 2),
  })
  return Math.max(0, start)
}

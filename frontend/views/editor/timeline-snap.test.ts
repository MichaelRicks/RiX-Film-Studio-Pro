import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { beatSnapTimes, clipBeatTimes, resolveSnap, snapDropStart, SNAP_ENGAGE_PX, SNAP_RELEASE_PX } from './timeline-snap.ts'

const PPS = 100 // 1 px = 0.01 s

describe('resolveSnap', () => {
  it('grabs a target inside the engage distance and ignores one outside it', () => {
    const near = resolveSnap({ start: 4.95, edgeOffsets: [0], targets: [5], pixelsPerSecond: PPS, lock: null })
    assert.equal(near.start, 5)
    assert.deepEqual(near.lock, { target: 5, edgeOffset: 0 })
    const far = resolveSnap({ start: 4.5, edgeOffsets: [0], targets: [5], pixelsPerSecond: PPS, lock: null })
    assert.equal(far.start, 4.5)
    assert.equal(far.lock, null)
  })

  it('measures reach in pixels, so zoom does not change the feel', () => {
    // 0.2 s away is 20 px at 100 px/s (free) but 2 px at 10 px/s (snaps).
    assert.equal(resolveSnap({ start: 4.8, edgeOffsets: [0], targets: [5], pixelsPerSecond: 100, lock: null }).lock, null)
    assert.equal(resolveSnap({ start: 4.8, edgeOffsets: [0], targets: [5], pixelsPerSecond: 10, lock: null }).start, 5)
  })

  it('picks the nearest of several targets, not the last one', () => {
    const r = resolveSnap({ start: 4.97, edgeOffsets: [0], targets: [4.92, 5.0, 5.05], pixelsPerSecond: PPS, lock: null })
    assert.equal(r.start, 5.0)
  })

  it('snaps the end edge too', () => {
    const r = resolveSnap({ start: 2.04, edgeOffsets: [0, 3], targets: [5], pixelsPerSecond: PPS, lock: null })
    assert.equal(r.start, 2)
    assert.deepEqual(r.lock, { target: 5, edgeOffset: 3 })
  })

  it('holds the lock past the engage distance and releases beyond the release distance', () => {
    const lock = { target: 5, edgeOffset: 0 }
    const held = resolveSnap({ start: 5 + (SNAP_ENGAGE_PX + 6) / PPS, edgeOffsets: [0], targets: [5], pixelsPerSecond: PPS, lock })
    assert.equal(held.start, 5)
    assert.deepEqual(held.lock, lock)
    const freed = resolveSnap({ start: 5 + (SNAP_RELEASE_PX + 6) / PPS, edgeOffsets: [0], targets: [5], pixelsPerSecond: PPS, lock })
    assert.ok(freed.start > 5)
    assert.equal(freed.lock, null)
  })

  it('drops a lock whose target no longer exists', () => {
    const r = resolveSnap({ start: 5.05, edgeOffsets: [0], targets: [9], pixelsPerSecond: PPS, lock: { target: 5, edgeOffset: 0 } })
    assert.equal(r.start, 5.05)
    assert.equal(r.lock, null)
  })
})

describe('snapDropStart', () => {
  const clips = [
    { trackIndex: 0, startTime: 0, duration: 5 },
    { trackIndex: 0, startTime: 5, duration: 4 },
    { trackIndex: 1, startTime: 0, duration: 20 },
  ]

  it('closes the gap when dropped a little past the last clip on that track', () => {
    assert.equal(snapDropStart({ rawStart: 9.6, trackIndex: 0, clips, pixelsPerSecond: PPS }), 9)
  })

  it('leaves a deliberate gap when dropped well away from the last clip', () => {
    assert.equal(snapDropStart({ rawStart: 12, trackIndex: 0, clips, pixelsPerSecond: PPS }), 12)
  })

  it('only looks at the track it was dropped on', () => {
    assert.equal(snapDropStart({ rawStart: 9.5, trackIndex: 2, clips, pixelsPerSecond: PPS }), 9.5)
  })

  it('starts at zero on an empty timeline', () => {
    assert.equal(snapDropStart({ rawStart: 0.3, trackIndex: 0, clips: [], pixelsPerSecond: PPS }), 0.3)
  })

  it('keeps the reach in pixels when zoomed out', () => {
    // At 10 px/s, 4 s past the end is only 40 px, still inside the append reach.
    assert.equal(snapDropStart({ rawStart: 13, trackIndex: 0, clips, pixelsPerSecond: 10 }), 9)
  })
})

describe('clipBeatTimes', () => {
  const song = { type: 'audio', asset: { beats: [0.5, 1, 1.5, 2, 2.5, 3] }, speed: 1 }

  it('places the beats of a song where the clip plays them', () => {
    const times = clipBeatTimes({ ...song, startTime: 10, duration: 3, trimStart: 0 })
    assert.deepEqual(times, [10.5, 11, 11.5, 12, 12.5, 13])
  })

  it('drops beats before the trimmed-in point and after the clip ends', () => {
    // plays the song from 1.2 s for 1 s: beats at 1.5 and 2 land at 0.3 s and 0.8 s into the clip
    const times = clipBeatTimes({ ...song, startTime: 20, duration: 1, trimStart: 1.2 })
    assert.equal(times.length, 2)
    assert.ok(Math.abs(times[0] - 20.3) < 1e-9 && Math.abs(times[1] - 20.8) < 1e-9)
  })

  it('squeezes the beats together when the clip plays faster', () => {
    const times = clipBeatTimes({ ...song, speed: 2, startTime: 0, duration: 1.5, trimStart: 0 })
    assert.deepEqual(times, [0.25, 0.5, 0.75, 1, 1.25, 1.5])
  })

  it('ignores clips that are not audio or have no beats', () => {
    assert.deepEqual(clipBeatTimes({ type: 'video', asset: { beats: [1] }, speed: 1, startTime: 0, duration: 5, trimStart: 0 }), [])
    assert.deepEqual(clipBeatTimes({ type: 'audio', asset: {}, speed: 1, startTime: 0, duration: 5, trimStart: 0 }), [])
  })

  it('beatSnapTimes leaves out the clips being moved', () => {
    const clips = [
      { id: 'a', ...song, startTime: 0, duration: 3, trimStart: 0 },
      { id: 'b', ...song, startTime: 100, duration: 3, trimStart: 0 },
    ]
    assert.deepEqual(beatSnapTimes(clips, new Set(['a'])), [100.5, 101, 101.5, 102, 102.5, 103])
  })
})

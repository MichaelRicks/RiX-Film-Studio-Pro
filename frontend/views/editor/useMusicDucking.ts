import { useCallback } from 'react'
import { buildDuckCurve, duckVolumeKeyframes, DEFAULT_DUCK_AMOUNT_DB, type AudioEnvelope, type DuckTrigger } from '../../../shared/music-ducking'
import type { TimelineClip } from '../../types/project-model'
import { selectAssets, selectClipPathFromAssets, selectClips, selectTracks } from './editor-selectors'
import { useEditorActions, useEditorGetState } from './editor-store'
import { volumeAtTime } from './video-editor-utils'

// Loudness per source file, fetched once from the main process.
const envelopeCache = new Map<string, Promise<AudioEnvelope>>()
function loadEnvelope(path: string): Promise<AudioEnvelope> {
  let pending = envelopeCache.get(path)
  if (!pending) {
    pending = window.electronAPI.audioEnvelope({ path }).catch(() => ({ hop: 0.05, db: [] }))
    envelopeCache.set(path, pending)
  }
  return pending
}

/** Library music, which never counts as a voice that other music ducks under. */
export const isLibraryMusic = (clip: TimelineClip): boolean => clip.type === 'audio' && clip.asset?.resolution === 'music'

/**
 * Auto-ducking as editable volume keyframes (see shared/music-ducking.ts). `apply` measures
 * the other audio on the timeline and writes the dips into each music clip's volume keyframes;
 * `remove` puts back what the clip had before, keeping the dips (with any hand edits) aside;
 * `enable` brings those kept dips back, and only measures when there are none. None of it runs
 * on its own afterwards: moving dialogue leaves the dips where they were until `apply` is run
 * again, which is what keeps keyframes dragged by hand from being overwritten behind the
 * user's back.
 */
export function useMusicDucking() {
  const getState = useEditorGetState()
  const actions = useEditorActions()

  /** Recalculate the dips for these clips. `amountDb` overrides each clip's own setting. */
  const apply = useCallback(async (clipIds: string[], amountDb?: number) => {
    const before = getState()
    const targets = new Set(clipIds)
    const clips = selectClips(before)
    const assets = selectAssets(before)
    const tracks = selectTracks(before)

    // Anything audible that is not music counts as a possible voice.
    const voices = clips.filter(clip =>
      clip.type === 'audio' && !isLibraryMusic(clip) && !targets.has(clip.id) && !clip.duck?.enabled
      && !clip.muted && clip.volume > 0
      && tracks[clip.trackIndex]?.enabled !== false && !tracks[clip.trackIndex]?.muted)
    const triggers = await Promise.all(voices.map(async (clip): Promise<DuckTrigger | null> => {
      const path = selectClipPathFromAssets(assets, clip)
      if (!path) return null
      return {
        startTime: clip.startTime, duration: clip.duration, trimStart: clip.trimStart, speed: clip.speed,
        reversed: clip.reversed, volume: clip.volume, envelope: await loadEnvelope(path),
      }
    }))
    const end = clips.reduce((max, clip) => Math.max(max, clip.startTime + clip.duration), 0)
    const curve = buildDuckCurve(triggers.filter((t): t is DuckTrigger => t !== null), end)

    // Read the clips again: the timeline may have changed while the envelopes loaded.
    const patches = selectClips(getState())
      .filter(clip => targets.has(clip.id) && clip.type === 'audio')
      .map(clip => {
        const base = clip.duck?.enabled ? (clip.duck.base ?? null) : (clip.volumeKeyframes?.length ? clip.volumeKeyframes : null)
        const amount = amountDb ?? clip.duck?.amountDb ?? DEFAULT_DUCK_AMOUNT_DB
        const baseAt = (t: number) => volumeAtTime(base ?? undefined, t, clip.volume)
        return {
          id: clip.id,
          duck: { enabled: true, amountDb: amount, base, keys: null },
          volumeKeyframes: duckVolumeKeyframes(curve, clip.startTime, clip.duration, baseAt, amount, base?.map(k => k.t)),
        }
      })
    if (patches.length > 0) actions.setClipsDuckState(patches)
  }, [actions, getState])

  /** Turn ducking off: the clip gets back the volume keyframes it had before, and the dips
   *  as they are now (hand edits included) are kept aside for `enable`. */
  const remove = useCallback((clipIds: string[]) => {
    const targets = new Set(clipIds)
    const patches = selectClips(getState())
      .filter(clip => targets.has(clip.id) && clip.duck?.enabled)
      .map(clip => ({
        id: clip.id,
        duck: {
          enabled: false,
          amountDb: clip.duck!.amountDb,
          base: null,
          keys: clip.volumeKeyframes?.length ? clip.volumeKeyframes : null,
        },
        volumeKeyframes: clip.duck!.base ?? undefined,
      }))
    if (patches.length > 0) actions.setClipsDuckState(patches)
  }, [actions, getState])

  /** Turn ducking on: restore the dips the clip had when it was switched off, else measure
   *  fresh ones. Clips that are already ducked are left alone. */
  const enable = useCallback(async (clipIds: string[]) => {
    const targets = new Set(clipIds)
    const todo = selectClips(getState()).filter(clip => targets.has(clip.id) && clip.type === 'audio' && !clip.duck?.enabled)
    const restorable = todo.filter(clip => clip.duck?.keys?.length)
    if (restorable.length > 0) {
      actions.setClipsDuckState(restorable.map(clip => ({
        id: clip.id,
        // What the clip has now is its un-ducked volume (it may have been changed while ducking was off).
        duck: { enabled: true, amountDb: clip.duck!.amountDb, base: clip.volumeKeyframes?.length ? clip.volumeKeyframes : null, keys: null },
        volumeKeyframes: clip.duck!.keys ?? undefined,
      })))
    }
    const fresh = todo.filter(clip => !clip.duck?.keys?.length).map(clip => clip.id)
    if (fresh.length > 0) await apply(fresh)
  }, [actions, apply, getState])

  /** Ducking for the clip(s) just made from this asset, when they were added with ducking on. */
  const applyForAsset = useCallback((assetId: string) => {
    const ids = selectClips(getState())
      .filter(clip => clip.type === 'audio' && clip.assetId === assetId && clip.duck?.enabled && !clip.volumeKeyframes?.length)
      .map(clip => clip.id)
    if (ids.length > 0) void apply(ids)
  }, [apply, getState])

  return { apply, remove, enable, applyForAsset }
}

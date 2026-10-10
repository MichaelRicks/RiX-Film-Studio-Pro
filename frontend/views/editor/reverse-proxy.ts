import { useMemo, useSyncExternalStore } from 'react'
import type { Asset, TimelineClip } from '../../types/project-model'
import { selectClipPathFromAssets } from './editor-selectors'

// Preview playback of reversed clips. A media element can't play backwards, so the
// main process renders a reversed copy of the source once (cached on disk) and the
// monitor and audio sync play that forward. Until it is ready, or if it can't be
// made, the clip keeps the old behaviour (a paused, seeked frame and no audio).
// The timeline model is untouched: only the copies handed to playback change.

const ready = new Map<string, string>() // source path -> reversed proxy path
const requested = new Set<string>()
const listeners = new Set<() => void>()
let version = 0

function emit(): void {
  version += 1
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function requestProxy(srcPath: string): void {
  if (!srcPath || requested.has(srcPath)) return
  requested.add(srcPath)
  const api = typeof window === 'undefined' ? undefined : window.electronAPI
  if (!api?.ensureReverseProxy) return
  api.ensureReverseProxy({ srcPath })
    .then(result => { if (result.status === 'ready') { ready.set(srcPath, result.path); emit() } })
    .catch(() => { /* keep the fallback */ })
}

function wantsProxy(clip: TimelineClip): boolean {
  return Boolean(clip.reversed) && clip.type !== 'image' && clip.type !== 'text' && clip.type !== 'adjustment'
}

let lastClips: TimelineClip[] | null = null
let lastAssets: Asset[] | null = null
let lastVersion = -1
let lastResult: TimelineClip[] = []

/**
 * The clips as playback should see them. A reversed clip with a ready proxy becomes
 * an ordinary forward clip on the reversed file: the proxy runs from the source's
 * end to its start, so the clip's trims swap and `reversed` clears.
 */
export function toPlaybackClips(clips: TimelineClip[], assets: Asset[]): TimelineClip[] {
  if (clips === lastClips && assets === lastAssets && version === lastVersion) return lastResult
  let changed = false
  const out = clips.map(clip => {
    if (!wantsProxy(clip)) return clip
    const src = selectClipPathFromAssets(assets, clip)
    if (!src) return clip
    requestProxy(src)
    const proxy = ready.get(src)
    if (!proxy) return clip
    changed = true
    return { ...clip, reversed: false, trimStart: clip.trimEnd, trimEnd: clip.trimStart, proxyPath: proxy } as TimelineClip
  })
  lastClips = clips
  lastAssets = assets
  lastVersion = version
  lastResult = changed ? out : clips
  return lastResult
}

/** Hook form for components: re-renders when a proxy becomes ready. */
export function usePlaybackClips(clips: TimelineClip[], assets: Asset[]): TimelineClip[] {
  const v = useSyncExternalStore(subscribe, () => version)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => toPlaybackClips(clips, assets), [clips, assets, v])
}

import { useEffect, useRef } from 'react'
import type { TimelineClip } from '../../types/project-model'
import { pathToFileUrl } from '../../lib/file-url'
import {
  selectAssets,
  selectClipPathFromAssets,
  selectClips,
  selectCurrentTime,
  selectIsPlaying,
  selectLiveAssetForClipFromAssets,
  selectTracks,
} from './editor-selectors'
import { useEditorGetState, useEditorStore } from './editor-store'
import { volumeAtTime } from './video-editor-utils'
import { toPlaybackClips } from './reverse-proxy'

interface UsePlaybackAudioSyncParams {
  playbackTimeRef: React.MutableRefObject<number>
}

type AudioEl = HTMLAudioElement & {
  __audioPlaying?: boolean
  __lastPlayRetry?: number
  __intendedPath?: string
  __awaitingCanplay?: boolean
  __gainNode?: GainNode
}

const PLAYING_LOOKAHEAD_SECONDS = 5
const PLAYING_LOOKBEHIND_SECONDS = 0.5
const PAUSED_LOOKAHEAD_SECONDS = 1
const PAUSED_LOOKBEHIND_SECONDS = 0.25
const PLAYING_PRELOAD_LOOKAHEAD_SECONDS = 3
const PAUSED_PRELOAD_LOOKAHEAD_SECONDS = 0.5
const ACTIVATION_SEEK_TOLERANCE_SECONDS = 0.12

function isAudioSourceClip(clip: TimelineClip): boolean {
  return clip.type === 'audio'
}

function clipOverlapsWindow(
  clip: TimelineClip,
  time: number,
  lookBehindSeconds: number,
  lookAheadSeconds: number,
): boolean {
  const clipStart = clip.startTime
  const clipEnd = clip.startTime + clip.duration
  return clipEnd >= time - lookBehindSeconds && clipStart <= time + lookAheadSeconds
}

/** Linear fade in/out gain (0..1) for a clip at a given TIMELINE time — mirrors
 *  the export's envelope so the preview sounds the same as the render. */
function fadeMultiplier(clip: TimelineClip, time: number): number {
  const fadeIn = clip.audioFadeIn ?? 0
  const fadeOut = clip.audioFadeOut ?? 0
  if (fadeIn <= 0 && fadeOut <= 0) return 1
  const t = time - clip.startTime
  let g = 1
  if (fadeIn > 0 && t < fadeIn) g *= Math.max(0, Math.min(1, t / fadeIn))
  if (fadeOut > 0 && t > clip.duration - fadeOut) g *= Math.max(0, Math.min(1, (clip.duration - t) / fadeOut))
  return g
}

/** Base gain from the volume-automation envelope (or the flat volume), before fades. */
function baseVolume(clip: TimelineClip, time: number): number {
  return volumeAtTime(clip.volumeKeyframes, time - clip.startTime, clip.volume)
}

function getClipStartTargetTime(clip: TimelineClip, mediaDuration: number): number {
  return clip.reversed
    ? Math.max(0, mediaDuration - clip.trimEnd)
    : Math.max(0, clip.trimStart)
}

export function usePlaybackAudioSync(params: UsePlaybackAudioSyncParams) {
  const { playbackTimeRef } = params
  const isPlaying = useEditorStore(selectIsPlaying)
  const currentTime = useEditorStore(selectCurrentTime)
  const assets = useEditorStore(selectAssets)
  const clips = useEditorStore(selectClips)
  const tracks = useEditorStore(selectTracks)
  const getEditorState = useEditorGetState()

  const audioElementsRef = useRef<Map<string, AudioEl>>(new Map())
  const audioContextRef = useRef<AudioContext | null>(null)

  // Volume can be boosted above 100% (gain > 1), which HTMLMediaElement.volume
  // doesn't support (browsers clamp it to 1.0) — route audio through a Web
  // Audio GainNode instead, which has no such ceiling. el.volume stays at 1
  // (unity) once routed; the GainNode carries the actual clip.volume value.
  const applyVolume = (el: AudioEl, volume: number): void => {
    const AudioContextCtor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) {
      el.volume = Math.min(1, volume)
      return
    }
    let ctx = audioContextRef.current
    if (!ctx) {
      ctx = new AudioContextCtor()
      audioContextRef.current = ctx
    }
    let node = el.__gainNode
    if (!node) {
      const source = ctx.createMediaElementSource(el)
      node = ctx.createGain()
      source.connect(node)
      node.connect(ctx.destination)
      el.__gainNode = node
    }
    el.volume = 1
    node.gain.value = volume
  }

  useEffect(() => {
    if (!isPlaying) return

    let lastTimestamp: number | null = null
    let animFrameId = 0

    const tick = (timestamp: number) => {
      const editorState = getEditorState()
      const currentAssets = selectAssets(editorState)
      // Reversed clips play from a cached reversed copy once it is ready (reverse-proxy.ts).
      const allClips = toPlaybackClips(selectClips(editorState), currentAssets)
      const currentTracks = selectTracks(editorState)
      const atTime = playbackTimeRef.current
      const audioMap = audioElementsRef.current

      if (lastTimestamp === null) {
        lastTimestamp = timestamp
      }

      const activeAudioIds = new Set<string>()
      const retainedAudioIds = new Set<string>()
      const retainedAudioPaths = new Map<string, string>()
      const preloadedAudioIds = new Set<string>()
      const anySoloed = currentTracks.some(track => track.solo)

      for (const clip of allClips) {
        if (!isAudioSourceClip(clip)) continue
        if (currentTracks[clip.trackIndex]?.enabled === false) continue
        const audioPath = selectClipPathFromAssets(currentAssets, clip)
        if (!audioPath) continue
        if (clipOverlapsWindow(clip, atTime, PLAYING_LOOKBEHIND_SECONDS, PLAYING_LOOKAHEAD_SECONDS)) {
          retainedAudioIds.add(clip.id)
          retainedAudioPaths.set(clip.id, audioPath)
        }
        if (atTime >= clip.startTime && atTime < clip.startTime + clip.duration) {
          activeAudioIds.add(clip.id)
        }
        if (clipOverlapsWindow(clip, atTime, 0, PLAYING_PRELOAD_LOOKAHEAD_SECONDS)) {
          preloadedAudioIds.add(clip.id)
        }
      }

      for (const [id, el] of audioMap) {
        if (!retainedAudioIds.has(id)) {
          el.pause()
          el.src = ''
          audioMap.delete(id)
          continue
        }
        if (!activeAudioIds.has(id)) {
          if (!el.paused) el.pause()
          el.__audioPlaying = false
          el.preload = preloadedAudioIds.has(id) ? 'auto' : 'metadata'
        }
      }

      for (const clip of allClips) {
        if (!retainedAudioIds.has(clip.id)) continue
        const audioPath = retainedAudioPaths.get(clip.id)
        if (!audioPath) continue

        let el = audioMap.get(clip.id)
        let isNewElement = false
        if (!el) {
          el = document.createElement('audio') as AudioEl
          el.src = pathToFileUrl(audioPath)
          el.__intendedPath = audioPath
          el.preload = preloadedAudioIds.has(clip.id) ? 'auto' : 'metadata'
          audioMap.set(clip.id, el)
          isNewElement = true
        } else if (el.__intendedPath !== audioPath) {
          el.src = pathToFileUrl(audioPath)
          el.__intendedPath = audioPath
          el.__audioPlaying = false
          el.preload = preloadedAudioIds.has(clip.id) ? 'auto' : 'metadata'
          isNewElement = true
        } else {
          el.preload = preloadedAudioIds.has(clip.id) ? 'auto' : 'metadata'
        }

        const computeTarget = (audioEl: AudioEl, time: number): number => {
          const assetDur = audioEl.duration || clip.duration
          const timeInClip = time - clip.startTime
          return clip.reversed
            ? Math.max(0, assetDur - clip.trimEnd - timeInClip * clip.speed)
            : Math.max(0, clip.trimStart + timeInClip * clip.speed)
        }

        const desiredRate = clip.reversed ? 1 : clip.speed

        if (el.readyState >= 2) {
          if (!activeAudioIds.has(clip.id)) {
            if (preloadedAudioIds.has(clip.id)) {
              const preloadTarget = getClipStartTargetTime(clip, el.duration || clip.duration)
              if (Math.abs(el.currentTime - preloadTarget) > 0.05) {
                el.currentTime = preloadTarget
              }
            }
            continue
          }

          const track = currentTracks[clip.trackIndex]
          const isSoloMuted = anySoloed && !track?.solo
          el.muted = clip.muted || track?.muted || isSoloMuted || false
          applyVolume(el, baseVolume(clip, atTime) * fadeMultiplier(clip, atTime))

          if (!el.__audioPlaying || isNewElement) {
            const target = computeTarget(el, atTime)
            if (isNewElement || Math.abs(el.currentTime - target) > ACTIVATION_SEEK_TOLERANCE_SECONDS) {
              el.currentTime = target
            }
            el.playbackRate = desiredRate
            if (clip.reversed) {
              el.pause()
              el.__audioPlaying = false
            } else {
              el.play().catch(() => {})
              el.__audioPlaying = true
              el.__lastPlayRetry = 0
            }
          } else {
            if (el.playbackRate !== desiredRate) el.playbackRate = desiredRate
            if (clip.reversed) {
              if (!el.paused) el.pause()
              el.__audioPlaying = false
            } else {
              const target = computeTarget(el, atTime)
              const drift = Math.abs(el.currentTime - target)
              if (drift > 1.5) {
                el.currentTime = target
              }
              if (el.paused) {
                const lastRetry = el.__lastPlayRetry || 0
                if (timestamp - lastRetry > 500) {
                  el.__lastPlayRetry = timestamp
                  el.play().catch(() => {})
                }
              }
            }
          }
        } else if (!el.__awaitingCanplay) {
          el.__awaitingCanplay = true
          const expectedPath = audioPath
          const onCanPlay = () => {
            el!.removeEventListener('canplay', onCanPlay)
            el!.__awaitingCanplay = false
            if (audioElementsRef.current.get(clip.id) !== el) return
            if (el!.__intendedPath !== expectedPath) return
            const freshTime = playbackTimeRef.current
            const activeNow = freshTime >= clip.startTime && freshTime < clip.startTime + clip.duration
            const shouldPreload = clipOverlapsWindow(clip, freshTime, 0, PLAYING_PRELOAD_LOOKAHEAD_SECONDS)
            if (!selectIsPlaying(getEditorState()) || !activeNow) {
              if (shouldPreload) {
                const preloadTarget = getClipStartTargetTime(clip, el!.duration || clip.duration)
                el!.currentTime = preloadTarget
              }
              return
            }
            const target = computeTarget(el!, freshTime)
            if (Math.abs(el!.currentTime - target) > ACTIVATION_SEEK_TOLERANCE_SECONDS) {
              el!.currentTime = target
            }
            el!.playbackRate = desiredRate
            if (clip.reversed) {
              el!.pause()
              el!.__audioPlaying = false
            } else {
              el!.play().catch(() => {})
              el!.__audioPlaying = true
              el!.__lastPlayRetry = 0
            }
          }
          el.addEventListener('canplay', onCanPlay)
        }
      }

      animFrameId = requestAnimationFrame(tick)
    }

    animFrameId = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(animFrameId)
      for (const [, el] of audioElementsRef.current) {
        if (!el.paused) el.pause()
        el.__audioPlaying = false
      }
    }
  }, [getEditorState, isPlaying, playbackTimeRef])

  useEffect(() => {
    if (isPlaying) return

    for (const [, el] of audioElementsRef.current) {
      if (!el.paused) el.pause()
      el.__audioPlaying = false
    }

    const retainedAudioClips = clips.filter(clip => {
      if (!isAudioSourceClip(clip)) return false
      if (tracks[clip.trackIndex]?.enabled === false) return false
      if (!selectClipPathFromAssets(assets, clip)) return false
      return clipOverlapsWindow(clip, currentTime, PAUSED_LOOKBEHIND_SECONDS, PAUSED_LOOKAHEAD_SECONDS)
    })
    const retainedAudioIds = new Set(retainedAudioClips.map(clip => clip.id))
    const preloadedAudioIds = new Set(
      retainedAudioClips
        .filter(clip => clipOverlapsWindow(clip, currentTime, 0, PAUSED_PRELOAD_LOOKAHEAD_SECONDS))
        .map(clip => clip.id),
    )

    for (const [id, el] of audioElementsRef.current) {
      if (!retainedAudioIds.has(id)) {
        el.pause()
        el.src = ''
        audioElementsRef.current.delete(id)
      }
    }

    for (const clip of retainedAudioClips) {
      const clipPath = selectClipPathFromAssets(assets, clip)
      if (!clipPath) continue

      let el = audioElementsRef.current.get(clip.id)
      if (!el) {
        el = document.createElement('audio') as AudioEl
        el.src = pathToFileUrl(clipPath)
        el.__intendedPath = clipPath
        el.preload = preloadedAudioIds.has(clip.id) ? 'auto' : 'metadata'
        audioElementsRef.current.set(clip.id, el)
      } else if (el.__intendedPath !== clipPath) {
        el.src = pathToFileUrl(clipPath)
        el.__intendedPath = clipPath
        el.preload = preloadedAudioIds.has(clip.id) ? 'auto' : 'metadata'
      } else {
        el.preload = preloadedAudioIds.has(clip.id) ? 'auto' : 'metadata'
      }

      const isAtPlayhead = currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration
      const liveAsset = selectLiveAssetForClipFromAssets(assets, clip)
      const assetDuration = liveAsset?.duration || clip.asset?.duration || clip.duration

      const anySoloed = tracks.some(track => track.solo)
      const track = tracks[clip.trackIndex]
      const isSoloMuted = anySoloed && !track?.solo
      el.muted = clip.muted || track?.muted || isSoloMuted || false
      applyVolume(el, baseVolume(clip, currentTime) * fadeMultiplier(clip, currentTime))

      if (el.readyState < 2) continue

      if (!isAtPlayhead) {
        if (preloadedAudioIds.has(clip.id)) {
          const preloadTarget = getClipStartTargetTime(clip, assetDuration)
          if (Math.abs(el.currentTime - preloadTarget) > 0.05) {
            el.currentTime = preloadTarget
          }
        }
        continue
      }

      const timeInClip = currentTime - clip.startTime
      const targetTime = clip.reversed
        ? Math.max(0, assetDuration - clip.trimEnd - timeInClip * clip.speed)
        : Math.max(0, clip.trimStart + timeInClip * clip.speed)

      if (Math.abs(el.currentTime - targetTime) > 0.05) {
        el.currentTime = targetTime
      }
    }
  }, [assets, clips, currentTime, isPlaying, tracks])

  useEffect(() => {
    return () => {
      for (const [, el] of audioElementsRef.current) {
        el.pause()
        el.src = ''
      }
      audioElementsRef.current.clear()
      void audioContextRef.current?.close()
      audioContextRef.current = null
    }
  }, [])
}

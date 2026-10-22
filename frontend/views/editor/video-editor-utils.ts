import React from 'react'
import {
  MousePointer2, ChevronRight, Scissors,
  ArrowLeftRight, GitMerge, MoveHorizontal, Gauge,
} from 'lucide-react'
import { formatKeyCombo, type ActionId, type KeyboardLayout } from '../../lib/keyboard-shortcuts'
export type { KeyboardLayout } from '../../lib/keyboard-shortcuts'
import type {
  TimelineClip, TransitionType, Track, ClipEffect, EffectMask, ClipLayer, ClipLayerFrame,
} from '../../types/project-model'
import { DEFAULT_CLIP_LAYER, DEFAULT_COLOR_CORRECTION } from '../../types/project-model'
import { filmLookFilterId } from '../../components/FilmLookDefs'
import { hasMotion, motionAt } from '../../../shared/clip-motion'

// ── Tool types & definitions ────────────────────────────────────────

export type ToolType = 'select' | 'trackForward' | 'blade' | 'slip' | 'slide' | 'ripple' | 'roll'

export type ToolDef = { id: ToolType; icon: any; label: string; actionId: ActionId }

export const PRIMARY_TOOLS: ToolDef[] = [
  { id: 'select', icon: MousePointer2, label: 'Selection Tool', actionId: 'tool.select' },
  { id: 'trackForward', icon: ChevronRight, label: 'Track Select Forward (Shift: single track)', actionId: 'tool.trackForward' },
  { id: 'blade', icon: Scissors, label: 'Blade Tool', actionId: 'tool.blade' },
]

export const TRIM_TOOLS: ToolDef[] = [
  { id: 'ripple', icon: ArrowLeftRight, label: 'Ripple Trim', actionId: 'tool.ripple' },
  { id: 'roll', icon: GitMerge, label: 'Roll Trim (A/B)', actionId: 'tool.roll' },
  { id: 'slip', icon: MoveHorizontal, label: 'Slip Tool', actionId: 'tool.slip' },
  { id: 'slide', icon: Gauge, label: 'Slide Tool', actionId: 'tool.slide' },
]

// ── Color Labels (Premiere-style) ────────────────────────────────────

export interface ColorLabelDef {
  id: string
  label: string
  color: string      // Tailwind-friendly hex for rendering
  bg: string         // Background class for timeline clips
  border: string     // Border class for timeline clips
  dot: string        // Dot color class for menus
}

export const COLOR_LABELS: ColorLabelDef[] = [
  { id: 'violet',    label: 'Violet',    color: '#8b5cf6', bg: 'bg-violet-700/50',  border: 'border-violet-500', dot: 'bg-violet-500' },
  { id: 'blue',      label: 'Blue',      color: '#3b82f6', bg: 'bg-blue-700/50',      border: 'border-blue-500',   dot: 'bg-blue-500' },
  { id: 'cyan',      label: 'Cyan',      color: '#06b6d4', bg: 'bg-cyan-700/50',      border: 'border-cyan-500',   dot: 'bg-cyan-500' },
  { id: 'teal',      label: 'Teal',      color: '#14b8a6', bg: 'bg-teal-700/50',      border: 'border-teal-500',   dot: 'bg-teal-500' },
  { id: 'green',     label: 'Green',     color: '#22c55e', bg: 'bg-green-700/50',     border: 'border-green-500',  dot: 'bg-green-500' },
  { id: 'yellow',    label: 'Yellow',    color: '#eab308', bg: 'bg-yellow-700/50',    border: 'border-yellow-500', dot: 'bg-yellow-500' },
  { id: 'orange',    label: 'Orange',    color: '#f97316', bg: 'bg-orange-700/50',    border: 'border-orange-500', dot: 'bg-orange-500' },
  { id: 'red',       label: 'Red',       color: '#ef4444', bg: 'bg-red-700/50',       border: 'border-red-500',    dot: 'bg-red-500' },
  { id: 'rose',      label: 'Rose',      color: '#f43f5e', bg: 'bg-rose-700/50',      border: 'border-rose-500',   dot: 'bg-rose-500' },
  { id: 'pink',      label: 'Pink',      color: '#ec4899', bg: 'bg-pink-700/50',      border: 'border-pink-500',   dot: 'bg-pink-500' },
]

export function getColorLabel(id: string | undefined): ColorLabelDef | undefined {
  if (!id) return undefined
  return COLOR_LABELS.find(c => c.id === id)
}

// ── Constants ────────────────────────────────────────────────────────

/** Debounce delay for auto-saving timeline changes to context (ms) */
export const AUTOSAVE_DELAY = 500

/** Tolerance in seconds for detecting adjacent clips (cut points) */
export const CUT_POINT_TOLERANCE = 0.05

/** Default cross-dissolve duration in seconds */
export const DEFAULT_DISSOLVE_DURATION = 0.5

/** Default text-overlay opacity fade (seconds) when the clip hasn't set one. */
export const DEFAULT_TEXT_FADE = 0.5

/** Default fade (seconds) at each end of a layer clip. Same reasoning as text:
 *  a graphic that pops on and off reads as a glitch, and hand-keyframing a fade
 *  onto every logo is busywork. */
export const DEFAULT_LAYER_FADE = 0.5

/** The fade a layer gets when it hasn't set one. Only graphics (images) fade by
 *  default; a video clip on an upper track is footage, and a silent half-second
 *  fade from black on every one of them is never what was asked for. */
export function defaultLayerFade(type: string | undefined): number {
  return type === 'image' ? DEFAULT_LAYER_FADE : 0
}

/**
 * Opacity multiplier (0..1) for a text overlay's fade in/out at absolute time
 * `time`. Fades default to DEFAULT_TEXT_FADE when unset and are each capped at
 * half the clip so a short overlay still reaches full opacity.
 */
export function textFadeMultiplier(
  startTime: number, duration: number, time: number,
  fadeIn: number | undefined, fadeOut: number | undefined,
): number {
  const half = duration / 2
  const fin = Math.min(fadeIn ?? DEFAULT_TEXT_FADE, half)
  const fout = Math.min(fadeOut ?? DEFAULT_TEXT_FADE, half)
  const t = time - startTime
  let g = 1
  if (fin > 0 && t < fin) g = Math.max(0, Math.min(1, t / fin))
  if (fout > 0 && t > duration - fout) g = Math.min(g, Math.max(0, (duration - t) / fout))
  return g
}

/** Linear interpolation over {t, value} keys (holds the end values). */
export function linearKeyframeValue(keys: { t: number; value: number }[], t: number): number {
  const sorted = keys.length > 1 && keys.some((k, i) => i > 0 && k.t < keys[i - 1].t)
    ? [...keys].sort((a, b) => a.t - b.t)
    : keys
  if (t <= sorted[0].t) return sorted[0].value
  const last = sorted[sorted.length - 1]
  if (t >= last.t) return last.value
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (t < b.t) return a.value + (b.value - a.value) * ((t - a.t) / Math.max(1e-6, b.t - a.t))
  }
  return last.value
}

/**
 * Opacity multiplier (0..1) for a layer clip's fade in/out at `timeInClip`
 * seconds from its start. Fades default to DEFAULT_LAYER_FADE and are each capped
 * at half the clip, so a short graphic still reaches full opacity. Multiplies
 * whatever opacity is otherwise in force, keyframed or flat — the export mirrors
 * this in the layer's alpha.
 */
export function layerFadeMultiplier(
  clip: { type?: string; duration: number; fadeIn?: number; fadeOut?: number; motion?: readonly unknown[] },
  timeInClip: number,
): number {
  const half = clip.duration / 2
  // A shot with motion still fills the frame, so it doesn't fade up like a logo.
  const dflt = clip.motion && clip.motion.length > 0 ? 0 : defaultLayerFade(clip.type)
  const fin = Math.min(clip.fadeIn ?? dflt, half)
  const fout = Math.min(clip.fadeOut ?? dflt, half)
  let g = 1
  if (fin > 0 && timeInClip < fin) g = Math.max(0, Math.min(1, timeInClip / fin))
  if (fout > 0 && timeInClip > clip.duration - fout) {
    g = Math.min(g, Math.max(0, Math.min(1, (clip.duration - timeInClip) / fout)))
  }
  return g
}

/** Smoothstep between two keys — the curve the Reframe editor and the export's
 *  keyframeExpr() both use, so layer motion matches on both sides. */
function smoothstepMix(a: number, b: number, s: number): number {
  const c = Math.max(0, Math.min(1, s))
  return a + (b - a) * c * c * (3 - 2 * c)
}

/**
 * Where a media clip's layer sits at `timeInClip` seconds from its start, and how
 * big it is. Keys are eased with smoothstep and hold their end values outside the
 * keyed range. No layer at all = DEFAULT_CLIP_LAYER (centered, full size), which
 * renders exactly as a clip with no layer ever did.
 */
export function clipLayerAt(
  clip: { layer?: ClipLayer | null },
  timeInClip: number,
): ClipLayerFrame {
  const layer = clip.layer
  if (!layer) return DEFAULT_CLIP_LAYER
  const keys = layer.keys
  if (!keys || keys.length === 0) return layer
  const sorted = keys.length > 1 && keys.some((k, i) => i > 0 && k.t < keys[i - 1].t)
    ? [...keys].sort((a, b) => a.t - b.t)
    : keys
  const first = sorted[0]
  if (timeInClip <= first.t) return first
  const last = sorted[sorted.length - 1]
  if (timeInClip >= last.t) return last
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (timeInClip >= b.t) continue
    const s = (timeInClip - a.t) / Math.max(1e-6, b.t - a.t)
    return {
      x: smoothstepMix(a.x, b.x, s),
      y: smoothstepMix(a.y, b.y, s),
      scaleX: smoothstepMix(a.scaleX, b.scaleX, s),
      scaleY: smoothstepMix(a.scaleY, b.scaleY, s),
    }
  }
  return last
}

/** Is this clip acting as a layer — i.e. does it no longer simply fill the frame,
 *  so the tracks below it have to show through? Transform, partial opacity and
 *  opacity keys all qualify, as does the explicit toggle. */
export function isLayerClip(clip: TimelineClip): boolean {
  if (clip.type !== 'video' && clip.type !== 'image') return false
  if (clip.composite) return true
  if ((clip.opacity ?? 100) < 100) return true
  if (clip.opacityKeyframes && clip.opacityKeyframes.length > 0) return true
  const layer = clip.layer
  if (!layer) return false
  if (layer.keys && layer.keys.length > 0) return true
  return layer.x !== 0.5 || layer.y !== 0.5 || layer.scaleX !== 1 || layer.scaleY !== 1
}

/** A media clip's opacity (0..1) at `timeInClip`: keyframed, else the flat
 *  `opacity`. The export mirrors this through colorchannelmixer's alpha gain. */
export function mediaClipOpacity(
  clip: { opacity?: number; opacityKeyframes?: { t: number; value: number }[] },
  timeInClip: number,
): number {
  const base = clip.opacityKeyframes && clip.opacityKeyframes.length > 0
    ? linearKeyframeValue(clip.opacityKeyframes, timeInClip)
    : clip.opacity ?? 100
  return Math.max(0, Math.min(1, base / 100))
}

/** Text-overlay opacity (0..1) at a timeline time: keyframed or static base
 *  opacity, times the fade in/out ramp. Mirrors the export's drawtext alpha. */
export function textClipOpacity(
  clip: { startTime: number; duration: number; textFadeIn?: number; textFadeOut?: number;
    opacityKeyframes?: { t: number; value: number }[]; textStyle?: { opacity: number } | null },
  time: number,
  /** Uncommitted slider value being previewed for this clip (0..100), if any. */
  previewOpacity?: number | null,
): number {
  const base = previewOpacity != null
    ? previewOpacity
    : clip.opacityKeyframes && clip.opacityKeyframes.length > 0
      ? linearKeyframeValue(clip.opacityKeyframes, time - clip.startTime)
      : clip.textStyle?.opacity ?? 100
  return Math.max(0, Math.min(1, base / 100)) *
    textFadeMultiplier(clip.startTime, clip.duration, time, clip.textFadeIn, clip.textFadeOut)
}

/** A single volume-automation keyframe: `t` seconds from clip start, `value` gain 0..2. */
export interface VolumeKeyframe { t: number; value: number }

/**
 * Piecewise-linear volume envelope sampled at time `t` (seconds from clip start).
 * Returns `flat` when there are no keyframes; clamps to the first/last keyframe
 * value before/after the envelope. Sorts defensively (arrays are tiny).
 */
export function volumeAtTime(keyframes: VolumeKeyframe[] | undefined, t: number, flat: number): number {
  if (!keyframes || keyframes.length === 0) return flat
  const ks = keyframes.length > 1 ? [...keyframes].sort((a, b) => a.t - b.t) : keyframes
  if (t <= ks[0].t) return ks[0].value
  const last = ks[ks.length - 1]
  if (t >= last.t) return last.value
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1]
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t
      return span <= 0 ? b.value : a.value + (b.value - a.value) * ((t - a.t) / span)
    }
  }
  return last.value
}

// ── Resizable layout constants ───────────────────────────────────────

export const LAYOUT_STORAGE_KEY = 'ltx-video-editor-layout'

export interface EditorLayout {
  leftPanelWidth: number   // px
  rightPanelWidth: number  // px
  timelineHeight: number   // px
  assetsHeight: number     // px – height of assets section in left panel (timelines gets the rest)
}

export const DEFAULT_LAYOUT: EditorLayout = {
  leftPanelWidth: 288,   // w-72
  rightPanelWidth: 256,   // w-64
  timelineHeight: 224,    // h-56
  assetsHeight: 0,        // 0 = auto (use flex proportions)
}

export const LAYOUT_LIMITS = {
  leftPanelWidth:  { min: 180, max: 480 },
  rightPanelWidth: { min: 200, max: 480 },
  timelineHeight:  { min: 120, max: 600 },
  assetsHeight:    { min: 120, max: 800 },
}

// ── Pure helper functions ────────────────────────────────────────────

/** Get the display shortcut string for an action from the active layout */
export function getShortcutLabel(layout: KeyboardLayout, actionId: ActionId): string {
  const combos = layout[actionId]
  if (!combos || combos.length === 0) return ''
  return formatKeyCombo(combos[0])
}

/** Returns `"label (shortcut)"` when a shortcut exists, or just `"label"` when it doesn't. */
export function tooltipLabel(label: string, shortcut: string): string {
  return shortcut ? `${label} (${shortcut})` : label
}

/**
 * Overwrite helper: given a moved/placed clip, trim or split any clips
 * on the same track that it overlaps. Returns the updated clips array.
 * `movedIds` = IDs of the clip(s) being moved (they should not be trimmed).
 */
export function resolveOverlaps(
  allClips: TimelineClip[],
  movedIds: Set<string>,
): TimelineClip[] {
  let result = [...allClips]

  for (const movedId of movedIds) {
    const moved = result.find(c => c.id === movedId)
    if (!moved) continue

    const movedStart = moved.startTime
    const movedEnd = moved.startTime + moved.duration

    const next: TimelineClip[] = []

    for (const c of result) {
      if (movedIds.has(c.id)) { next.push(c); continue }
      if (c.trackIndex !== moved.trackIndex) { next.push(c); continue }

      const cStart = c.startTime
      const cEnd = c.startTime + c.duration

      if (cEnd <= movedStart || cStart >= movedEnd) { next.push(c); continue }
      if (cStart >= movedStart && cEnd <= movedEnd) continue

      if (cStart < movedStart && cEnd > movedStart && cEnd <= movedEnd) {
        const newDuration = movedStart - cStart
        next.push({ ...c, duration: newDuration })
        continue
      }

      if (cStart >= movedStart && cStart < movedEnd && cEnd > movedEnd) {
        const trimAmount = movedEnd - cStart
        const newTrimStart = c.trimStart + trimAmount * c.speed
        next.push({
          ...c,
          startTime: movedEnd,
          duration: c.duration - trimAmount,
          trimStart: newTrimStart,
        })
        continue
      }

      if (cStart < movedStart && cEnd > movedEnd) {
        const leftDuration = movedStart - cStart
        next.push({ ...c, duration: leftDuration })

        const rightTrimAmount = (movedEnd - cStart) * c.speed
        const rightDuration = cEnd - movedEnd
        next.push({
          ...c,
          id: `${c.id}-split-${Date.now()}`,
          startTime: movedEnd,
          duration: rightDuration,
          trimStart: c.trimStart + rightTrimAmount,
        })
        continue
      }

      next.push(c)
    }

    result = next
  }

  return result
}

export function loadLayout(): EditorLayout {
  try {
    const stored = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return {
        leftPanelWidth: clampVal(parsed.leftPanelWidth ?? DEFAULT_LAYOUT.leftPanelWidth, LAYOUT_LIMITS.leftPanelWidth),
        rightPanelWidth: clampVal(parsed.rightPanelWidth ?? DEFAULT_LAYOUT.rightPanelWidth, LAYOUT_LIMITS.rightPanelWidth),
        timelineHeight: clampVal(parsed.timelineHeight ?? DEFAULT_LAYOUT.timelineHeight, LAYOUT_LIMITS.timelineHeight),
        assetsHeight: parsed.assetsHeight ? clampVal(parsed.assetsHeight, LAYOUT_LIMITS.assetsHeight) : 0,
      }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_LAYOUT }
}

export function saveLayout(layout: EditorLayout) {
  try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout)) } catch { /* ignore */ }
}

// ── Layout presets ──────────────────────────────────────────────────

export const LAYOUT_PRESETS_KEY = 'ltx-video-editor-layout-presets'

export interface LayoutPreset {
  id: string
  name: string
  layout: EditorLayout
}

export function loadLayoutPresets(): LayoutPreset[] {
  try {
    const stored = localStorage.getItem(LAYOUT_PRESETS_KEY)
    if (stored) return JSON.parse(stored) as LayoutPreset[]
  } catch { /* ignore */ }
  return []
}

export function saveLayoutPresets(presets: LayoutPreset[]) {
  try { localStorage.setItem(LAYOUT_PRESETS_KEY, JSON.stringify(presets)) } catch { /* ignore */ }
}

export function clampVal(val: number, limits: { min: number; max: number }): number {
  return Math.max(limits.min, Math.min(limits.max, val))
}

/** Migrate old clips that don't have new effect fields */
export function migrateClip(clip: TimelineClip): TimelineClip {
  return {
    ...clip,
    flipH: clip.flipH ?? false,
    flipV: clip.flipV ?? false,
    transitionIn: clip.transitionIn ?? { type: 'none', duration: 0.5 },
    transitionOut: clip.transitionOut ?? { type: 'none', duration: 0.5 },
    colorCorrection: clip.colorCorrection ?? { ...DEFAULT_COLOR_CORRECTION },
    opacity: clip.opacity ?? 100,
    isRegenerating: false,
  }
}

/**
 * Migrate tracks from old format (no kind) to new NLE layout.
 * Heuristic: if a track has no `kind`, infer from its name or position.
 */
export function migrateTracks(tracks: Track[]): Track[] {
  return tracks.map(t => {
    if (t.kind) return t
    if (t.type === 'subtitle') return t
    if (/^A\d/i.test(t.name)) return { ...t, kind: 'audio' as const }
    if (/^V\d/i.test(t.name)) return { ...t, kind: 'video' as const }
    return { ...t, kind: 'video' as const }
  })
}

/** Build CSS filter + transform strings from clip effects */
export function getClipEffectStyles(clip: TimelineClip, timeInClip?: number): React.CSSProperties {
  const cc = clip.colorCorrection || DEFAULT_COLOR_CORRECTION
  const filters: string[] = []

  // The film look goes first, so the manual sliders below trim a graded image.
  // The export orders them the same way (buildColorGradeFilters). The def this
  // points at is rendered by <FilmLookDefs> — see filmLookFilterId.
  const lookId = filmLookFilterId(clip.filmLook)
  if (lookId) filters.push(`url(#${lookId})`)

  if (cc.brightness !== 0) filters.push(`brightness(${1 + cc.brightness / 100})`)
  if (cc.contrast !== 0) filters.push(`contrast(${1 + cc.contrast / 100})`)
  if (cc.saturation !== 0) filters.push(`saturate(${1 + cc.saturation / 100})`)
  if (cc.exposure !== 0) filters.push(`brightness(${1 + cc.exposure / 200})`)
  if (cc.temperature !== 0) {
    const t = cc.temperature
    if (t > 0) {
      filters.push(`sepia(${t / 200})`)
      filters.push(`hue-rotate(-${t * 0.1}deg)`)
    } else {
      filters.push(`hue-rotate(${Math.abs(t) * 0.4}deg)`)
    }
  }
  if (cc.tint !== 0) {
    filters.push(`hue-rotate(${cc.tint * 1.2}deg)`)
  }
  if (cc.highlights !== 0) filters.push(`brightness(${1 + cc.highlights / 300})`)
  if (cc.shadows !== 0) filters.push(`contrast(${1 + cc.shadows / 300})`)

  /* EFFECTS HIDDEN - skip effects iteration because effects are not applied during export
  if (clip.effects) {
    for (const fx of clip.effects) {
      if (!fx.enabled) continue
      if (fx.mask?.enabled) continue // masked effects rendered as separate overlay
      const p = fx.params
      switch (fx.type) {
        case 'blur':
          if (p.amount > 0) filters.push(`blur(${p.amount}px)`)
          break
        case 'sharpen': {
          const s = p.amount / 100
          if (s > 0) filters.push(`contrast(${1 + s * 0.3})`)
          break
        }
        case 'glow': {
          const intensity = p.amount / 100
          const radius = p.radius || 10
          if (intensity > 0) {
            filters.push(`brightness(${1 + intensity * 0.3})`)
            filters.push(`drop-shadow(0 0 ${radius * intensity}px rgba(255,255,255,${intensity * 0.4}))`)
          }
          break
        }
        case 'vignette':
        case 'grain':
          break
        case 'lut-cinematic': {
          const t = (p.intensity ?? 100) / 100
          if (t > 0) {
            filters.push(`contrast(${1 + 0.1 * t})`)
            filters.push(`saturate(${1 - 0.15 * t})`)
            filters.push(`sepia(${0.15 * t})`)
            filters.push(`brightness(${1 - 0.05 * t})`)
          }
          break
        }
        case 'lut-vintage': {
          const t = (p.intensity ?? 100) / 100
          if (t > 0) {
            filters.push(`sepia(${0.4 * t})`)
            filters.push(`contrast(${1 - 0.1 * t})`)
            filters.push(`saturate(${1 - 0.2 * t})`)
            filters.push(`brightness(${1 + 0.05 * t})`)
          }
          break
        }
        case 'lut-bw': {
          const t = (p.intensity ?? 100) / 100
          if (t > 0) filters.push(`grayscale(${t})`)
          break
        }
        case 'lut-cool': {
          const t = (p.intensity ?? 100) / 100
          if (t > 0) {
            filters.push(`hue-rotate(${10 * t}deg)`)
            filters.push(`saturate(${1 - 0.1 * t})`)
            filters.push(`brightness(${1 + 0.02 * t})`)
          }
          break
        }
        case 'lut-warm': {
          const t = (p.intensity ?? 100) / 100
          if (t > 0) {
            filters.push(`sepia(${0.2 * t})`)
            filters.push(`hue-rotate(${-5 * t}deg)`)
            filters.push(`saturate(${1 + 0.1 * t})`)
          }
          break
        }
        case 'lut-muted': {
          const t = (p.intensity ?? 100) / 100
          if (t > 0) {
            filters.push(`saturate(${1 - 0.5 * t})`)
            filters.push(`contrast(${1 - 0.05 * t})`)
          }
          break
        }
        case 'lut-vivid': {
          const t = (p.intensity ?? 100) / 100
          if (t > 0) {
            filters.push(`saturate(${1 + 0.6 * t})`)
            filters.push(`contrast(${1 + 0.1 * t})`)
          }
          break
        }
      }
    }
  }
  EFFECTS HIDDEN */

  const transforms: string[] = []
  // Layer placement first, so the flips below mirror the clip's own pixels rather
  // than reflecting it across the frame. translate is in percentages of the
  // element, which is the full frame, matching x/y being fractions of the frame.
  let transformOrigin: string | undefined
  if ((clip.layer || hasMotion(clip.motion)) && timeInClip !== undefined) {
    let { x, y, scaleX, scaleY } = clipLayerAt(clip, timeInClip)
    let rotate = 0
    if (hasMotion(clip.motion)) {
      const m = motionAt(clip.motion, timeInClip, clip.duration)
      x += m.dx
      y += m.dy
      scaleX *= m.scale
      scaleY *= m.scale
      // The export turns the picture only while the clip has no placement of its own
      // (see the sub-pixel path in buildOverlayLayers), so the preview does the same.
      const placed = Boolean(clip.layer) && (
        (clip.layer!.keys?.length ?? 0) > 0
        || clip.layer!.x !== 0.5 || clip.layer!.y !== 0.5 || clip.layer!.scaleX !== 1 || clip.layer!.scaleY !== 1
      )
      rotate = placed ? 0 : m.rotate
    }
    if (x !== 0.5 || y !== 0.5) {
      transforms.push(`translate(${((x - 0.5) * 100).toFixed(4)}%, ${((y - 0.5) * 100).toFixed(4)}%)`)
    }
    // Between the move and the scale, so a stretched picture is turned as a whole
    // rather than sheared.
    if (rotate !== 0) {
      transforms.push(`rotate(${rotate.toFixed(4)}deg)`)
      transformOrigin = 'center'
    }
    if (scaleX !== 1 || scaleY !== 1) {
      transforms.push(`scale(${scaleX.toFixed(5)}, ${scaleY.toFixed(5)})`)
      transformOrigin = 'center'
    }
  }
  if (clip.flipH) transforms.push('scaleX(-1)')
  if (clip.flipV) transforms.push('scaleY(-1)')

  let opacity = timeInClip !== undefined && clip.opacityKeyframes && clip.opacityKeyframes.length > 0
    ? mediaClipOpacity(clip, timeInClip)
    : (clip.opacity ?? 100) / 100
  // A layer fades in and out by default; a clip that still fills the frame doesn't
  // (it would fade up from black at the top of every shot).
  if (timeInClip !== undefined && isLayerClip(clip)) {
    opacity *= layerFadeMultiplier(clip, timeInClip)
  }
  if (timeInClip !== undefined) {
    const tIn = clip.transitionIn
    const tOut = clip.transitionOut
    if (tIn && tIn.duration > 0 && timeInClip < tIn.duration) {
      if (tIn.type === 'fade-to-black' || tIn.type === 'fade-to-white') {
        opacity = Math.min(opacity, timeInClip / tIn.duration)
      }
    }
    if (tOut && tOut.duration > 0) {
      const timeFromEnd = clip.duration - timeInClip
      if (timeFromEnd < tOut.duration) {
        if (tOut.type === 'fade-to-black' || tOut.type === 'fade-to-white') {
          opacity = Math.min(opacity, timeFromEnd / tOut.duration)
        }
      }
    }
  }

  let clipPath: string | undefined
  if (timeInClip !== undefined) {
    const tIn = clip.transitionIn
    const tOut = clip.transitionOut
    if (tIn && tIn.type.startsWith('wipe-') && tIn.duration > 0 && timeInClip < tIn.duration) {
      const progress = timeInClip / tIn.duration
      clipPath = getWipeClipPath(tIn.type as TransitionType, progress, true)
    }
    if (tOut && tOut.type.startsWith('wipe-') && tOut.duration > 0) {
      const timeFromEnd = clip.duration - timeInClip
      if (timeFromEnd < tOut.duration) {
        const progress = timeFromEnd / tOut.duration
        clipPath = getWipeClipPath(tOut.type as TransitionType, progress, false)
      }
    }
  }

  const style: React.CSSProperties = {}
  if (filters.length > 0) style.filter = filters.join(' ')
  if (transforms.length > 0) style.transform = transforms.join(' ')
  if (transformOrigin) style.transformOrigin = transformOrigin
  if (opacity < 1) style.opacity = opacity
  if (clipPath) style.clipPath = clipPath

  return style
}

// ── Effect Mask Utilities ──────────────────────────────────────────────

/** Get the CSS filter string for a single effect */
export function getSingleEffectFilter(fx: ClipEffect): string {
  if (!fx.enabled) return ''
  const p = fx.params
  const filters: string[] = []
  switch (fx.type) {
    case 'blur':
      if (p.amount > 0) filters.push(`blur(${p.amount}px)`)
      break
    case 'sharpen': {
      const s = p.amount / 100
      if (s > 0) filters.push(`contrast(${1 + s * 0.3})`)
      break
    }
    case 'glow': {
      const intensity = p.amount / 100
      const radius = p.radius || 10
      if (intensity > 0) {
        filters.push(`brightness(${1 + intensity * 0.3})`)
        filters.push(`drop-shadow(0 0 ${radius * intensity}px rgba(255,255,255,${intensity * 0.4}))`)
      }
      break
    }
    case 'lut-cinematic': {
      const t = (p.intensity ?? 100) / 100
      if (t > 0) { filters.push(`contrast(${1 + 0.1 * t})`); filters.push(`saturate(${1 - 0.15 * t})`); filters.push(`sepia(${0.15 * t})`); filters.push(`brightness(${1 - 0.05 * t})`) }
      break
    }
    case 'lut-vintage': {
      const t = (p.intensity ?? 100) / 100
      if (t > 0) { filters.push(`sepia(${0.4 * t})`); filters.push(`contrast(${1 - 0.1 * t})`); filters.push(`saturate(${1 - 0.2 * t})`); filters.push(`brightness(${1 + 0.05 * t})`) }
      break
    }
    case 'lut-bw': {
      const t = (p.intensity ?? 100) / 100
      if (t > 0) filters.push(`grayscale(${t})`)
      break
    }
    case 'lut-cool': {
      const t = (p.intensity ?? 100) / 100
      if (t > 0) { filters.push(`hue-rotate(${10 * t}deg)`); filters.push(`saturate(${1 - 0.1 * t})`); filters.push(`brightness(${1 + 0.02 * t})`) }
      break
    }
    case 'lut-warm': {
      const t = (p.intensity ?? 100) / 100
      if (t > 0) { filters.push(`sepia(${0.2 * t})`); filters.push(`hue-rotate(${-5 * t}deg)`); filters.push(`saturate(${1 + 0.1 * t})`) }
      break
    }
    case 'lut-muted': {
      const t = (p.intensity ?? 100) / 100
      if (t > 0) { filters.push(`saturate(${1 - 0.5 * t})`); filters.push(`contrast(${1 - 0.05 * t})`) }
      break
    }
    case 'lut-vivid': {
      const t = (p.intensity ?? 100) / 100
      if (t > 0) { filters.push(`saturate(${1 + 0.6 * t})`); filters.push(`contrast(${1 + 0.1 * t})`) }
      break
    }
    default:
      break
  }
  return filters.join(' ')
}

/** Build CSS mask-image string from an EffectMask */
export function buildMaskImageValue(mask: EffectMask): string {
  const { shape, x, y, width, height, feather, invert, rotation } = mask

  // Ellipse without rotation: use CSS radial-gradient (simpler, more reliable)
  if (shape === 'ellipse' && rotation === 0) {
    const innerStop = Math.max(0, 100 - feather)
    if (invert) {
      return `radial-gradient(ellipse ${width}% ${height}% at ${x}% ${y}%, transparent ${innerStop}%, black 100%)`
    }
    return `radial-gradient(ellipse ${width}% ${height}% at ${x}% ${y}%, black ${innerStop}%, transparent 100%)`
  }

  // Rectangle or rotated ellipse: use inline SVG for precise shape + feather + rotation
  const svgW = 200
  const svgH = 200
  const cx = (x / 100) * svgW
  const cy = (y / 100) * svgH
  const w = (width / 100) * svgW
  const h = (height / 100) * svgH
  const featherDev = (feather / 100) * Math.max(w, h) * 0.5

  const bg = invert ? 'white' : 'black'
  const fg = invert ? 'black' : 'white'
  const rotAttr = rotation !== 0 ? ` transform="rotate(${rotation} ${cx} ${cy})"` : ''
  const filterDef = featherDev > 0.5 ? `<filter id="mf"><feGaussianBlur stdDeviation="${featherDev.toFixed(1)}"/></filter>` : ''
  const filterAttr = featherDev > 0.5 ? ' filter="url(#mf)"' : ''

  let shapeEl: string
  if (shape === 'ellipse') {
    shapeEl = `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${(w / 2).toFixed(1)}" ry="${(h / 2).toFixed(1)}" fill="${fg}"${rotAttr}/>`
  } else {
    shapeEl = `<rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fg}"${rotAttr}/>`
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}"><defs>${filterDef}</defs><rect width="${svgW}" height="${svgH}" fill="${bg}"/><g${filterAttr}>${shapeEl}</g></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

export interface MaskedEffectOverlay {
  effectId: string
  filterCSS: string
  maskImageValue: string
  mask: EffectMask
}

/** Get overlay data for each masked effect on a clip */
export function getMaskedEffectOverlays(clip: TimelineClip): MaskedEffectOverlay[] {
  if (!clip.effects) return []
  const overlays: MaskedEffectOverlay[] = []
  for (const fx of clip.effects) {
    if (!fx.enabled || !fx.mask?.enabled) continue
    const filterStr = getSingleEffectFilter(fx)
    if (!filterStr) continue
    overlays.push({
      effectId: fx.id,
      filterCSS: filterStr,
      maskImageValue: buildMaskImageValue(fx.mask),
      mask: fx.mask,
    })
  }
  return overlays
}

// Direction names describe which way the wipe motion travels (matching
// ffmpeg's own xfade transition naming, and the intuitive reading of "wipe
// left"), not which edge the reveal is anchored to.
export function getWipeClipPath(type: TransitionType, progress: number, isIn: boolean): string {
  const p = Math.max(0, Math.min(1, progress)) * 100
  switch (type) {
    case 'wipe-right':
      return isIn ? `inset(0 ${100 - p}% 0 0)` : `inset(0 0 0 ${100 - p}%)`
    case 'wipe-left':
      return isIn ? `inset(0 0 0 ${100 - p}%)` : `inset(0 ${100 - p}% 0 0)`
    case 'wipe-down':
      return isIn ? `inset(0 0 ${100 - p}% 0)` : `inset(${100 - p}% 0 0 0)`
    case 'wipe-up':
      return isIn ? `inset(${100 - p}% 0 0 0)` : `inset(0 0 ${100 - p}% 0)`
    default:
      return ''
  }
}

/** Get the background color for transition overlay */
export function getTransitionBgColor(type: TransitionType): string | null {
  if (type === 'fade-to-black') return 'black'
  if (type === 'fade-to-white') return 'white'
  return null
}

/** Format seconds into HH:MM:SS:FF timecode (24fps) */
export function formatTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const frames = Math.floor((seconds % 1) * 24)
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`
}

/** Parse HH:MM:SS:FF timecode string back to seconds (24fps) */
export function parseTime(tc: string): number | null {
  const cleaned = tc.replace(/[^0-9:;]/g, '').replace(/;/g, ':')
  const parts = cleaned.split(':')
  if (parts.length === 4) {
    const hrs = parseInt(parts[0], 10)
    const mins = parseInt(parts[1], 10)
    const secs = parseInt(parts[2], 10)
    const frames = parseInt(parts[3], 10)
    if (isNaN(hrs) || isNaN(mins) || isNaN(secs) || isNaN(frames)) return null
    return hrs * 3600 + mins * 60 + secs + frames / 24
  }
  if (parts.length === 3) {
    const mins = parseInt(parts[0], 10)
    const secs = parseInt(parts[1], 10)
    const frames = parseInt(parts[2], 10)
    if (isNaN(mins) || isNaN(secs) || isNaN(frames)) return null
    return mins * 60 + secs + frames / 24
  }
  if (parts.length === 2) {
    const mins = parseInt(parts[0], 10)
    const secs = parseInt(parts[1], 10)
    if (isNaN(mins) || isNaN(secs)) return null
    return mins * 60 + secs
  }
  if (parts.length === 1) {
    const secs = parseInt(parts[0], 10)
    if (isNaN(secs)) return null
    return secs
  }
  return null
}

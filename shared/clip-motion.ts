/**
 * Clip motion: the zoom / pan / shake / tilt presets of the editor's FILTERS panel.
 *
 * A clip stores a short list of { preset, strength, speed }. Everything else is
 * derived here, and BOTH renderers read the same derivation so they cannot drift:
 *
 *   motionAt()    -> numbers, for the preview's CSS transform
 *   motionExprs() -> ffmpeg expressions over the program clock, for the export
 *
 * Presets stack: every preset contributes an offset of the picture's centre, a zoom
 * factor and a rotation, and the stack adds the offsets, multiplies the zooms and
 * adds the rotations. The result is added on top of the clip's own layer transform
 * (position, scale and their keyframes), not in place of it. A stack that moves or
 * turns the picture also scales it up by a constant `edge` factor, sized from the
 * COMBINED movement, just enough that the edges never show black — so the user never
 * has to compensate by hand.
 */

export const MOTION_PRESET_IDS = [
  'zoom-in', 'zoom-out',
  'pan-left', 'pan-right', 'pan-up', 'pan-down',
  'drift',
  'handheld', 'earthquake', 'wobble',
  'pulse',
  'dutch-left', 'dutch-right', 'dutch-sway',
] as const

export type MotionPresetId = typeof MOTION_PRESET_IDS[number]

export interface ClipMotion {
  preset: MotionPresetId
  /** 0..100. How far it moves, zooms or tilts. */
  strength: number
  /** 0.25..4. Rate of the shaking presets; ignored by the ones that run over the clip. */
  speed: number
}

/** Most presets that can be stacked on one clip. */
export const MAX_STACKED_MOTIONS = 3

export const DEFAULT_MOTION_STRENGTH = 50
export const DEFAULT_MOTION_SPEED = 1
export const MOTION_SPEED_MIN = 0.25
export const MOTION_SPEED_MAX = 4

/** Degrees of tilt at full strength. */
const DUTCH_MAX_DEGREES = 20

/** Half the travel of a tilt up/down at full strength, as a fraction of frame height. */
const VERTICAL_PAN = 0.16

export interface MotionPreset {
  id: MotionPresetId
  name: string
  blurb: string
  group: 'Zoom & pan' | 'Shake' | 'Pulse' | 'Dutch angle'
  /** Whether the speed slider means anything for this preset. */
  usesSpeed: boolean
}

export const MOTION_PRESETS: readonly MotionPreset[] = [
  { id: 'zoom-in', name: 'Zoom in', blurb: 'Slow push toward the subject across the clip', group: 'Zoom & pan', usesSpeed: false },
  { id: 'zoom-out', name: 'Zoom out', blurb: 'Starts tight and pulls back across the clip', group: 'Zoom & pan', usesSpeed: false },
  { id: 'pan-left', name: 'Pan left', blurb: 'The shot slides left across the clip', group: 'Zoom & pan', usesSpeed: false },
  { id: 'pan-right', name: 'Pan right', blurb: 'The shot slides right across the clip', group: 'Zoom & pan', usesSpeed: false },
  { id: 'pan-up', name: 'Tilt up', blurb: 'The shot slides upward across the clip', group: 'Zoom & pan', usesSpeed: false },
  { id: 'pan-down', name: 'Tilt down', blurb: 'The shot slides downward across the clip', group: 'Zoom & pan', usesSpeed: false },
  { id: 'drift', name: 'Drift', blurb: 'Gentle diagonal glide with a slight push-in (Ken Burns)', group: 'Zoom & pan', usesSpeed: false },
  { id: 'handheld', name: 'Handheld', blurb: 'Subtle operator sway', group: 'Shake', usesSpeed: true },
  { id: 'earthquake', name: 'Earthquake', blurb: 'Hard, fast shaking', group: 'Shake', usesSpeed: true },
  { id: 'wobble', name: 'Wobble', blurb: 'Slow floating circle, like a boat or a drone hovering', group: 'Shake', usesSpeed: true },
  { id: 'pulse', name: 'Pulse', blurb: 'Rhythmic zoom beat', group: 'Pulse', usesSpeed: true },
  { id: 'dutch-left', name: 'Dutch left', blurb: 'Tilts the horizon to the left — a Dutch angle', group: 'Dutch angle', usesSpeed: false },
  { id: 'dutch-right', name: 'Dutch right', blurb: 'Tilts the horizon to the right — a Dutch angle', group: 'Dutch angle', usesSpeed: false },
  { id: 'dutch-sway', name: 'Dutch sway', blurb: 'Rocks the horizon left, then right, and back — speed sets the pace', group: 'Dutch angle', usesSpeed: true },
]

export const MOTION_PRESETS_BY_ID: ReadonlyMap<string, MotionPreset> = new Map(MOTION_PRESETS.map(p => [p.id, p]))

export function defaultMotion(preset: MotionPresetId): ClipMotion {
  return { preset, strength: DEFAULT_MOTION_STRENGTH, speed: DEFAULT_MOTION_SPEED }
}

/** The preset that cancels this one out entirely; picking one replaces the other. */
export function oppositeMotion(preset: MotionPresetId): MotionPresetId | null {
  if (preset === 'dutch-left') return 'dutch-right'
  if (preset === 'dutch-right') return 'dutch-left'
  return null
}

export function hasMotion(motion: readonly ClipMotion[] | undefined | null): motion is readonly ClipMotion[] {
  return Boolean(motion && motion.length > 0)
}

interface Wave { axis: 'x' | 'y'; amp: number; freq: number; phase: number }

interface PresetSpec {
  /** Offsets of the layer centre, as fractions of the frame, at the start and end of the clip. */
  x0: number; x1: number; y0: number; y1: number
  /** Zoom factor (>= 1) at the start and end of the clip. */
  z0: number; z1: number
  waves: Wave[]
  /** Zoom beat: multiplier 1 + amp * (0.5 - 0.5cos(2*pi*freq*t)). */
  pulse?: { amp: number; freq: number }
  /** Constant rotation in degrees, positive = clockwise. */
  rot: number
  /** Rocking rotation: -amp * sin(2*pi*freq*t) degrees, so it leans left first. */
  rotWave?: { amp: number; freq: number }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function presetSpec(m: ClipMotion): PresetSpec {
  const s = clamp(m.strength, 0, 100) / 100
  const sp = clamp(m.speed, MOTION_SPEED_MIN, MOTION_SPEED_MAX)
  const spec: PresetSpec = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 1, z1: 1, waves: [], rot: 0 }

  switch (m.preset) {
    case 'zoom-in': spec.z1 = 1 + 0.35 * s; break
    case 'zoom-out': spec.z0 = 1 + 0.35 * s; break
    case 'pan-left': spec.x0 = 0.1 * s; spec.x1 = -0.1 * s; break
    case 'pan-right': spec.x0 = -0.1 * s; spec.x1 = 0.1 * s; break
    // A frame is 16:9, so the same fraction of its height is a much shorter slide than
    // sideways; with the scale-up that hides the edges it then read as a plain zoom.
    case 'pan-up': spec.y0 = VERTICAL_PAN * s; spec.y1 = -VERTICAL_PAN * s; break
    case 'pan-down': spec.y0 = -VERTICAL_PAN * s; spec.y1 = VERTICAL_PAN * s; break
    case 'drift':
      spec.x0 = -0.05 * s; spec.x1 = 0.05 * s
      spec.y0 = 0.025 * s; spec.y1 = -0.025 * s
      spec.z1 = 1 + 0.12 * s
      break
    case 'handheld': {
      const a = 0.012 * s
      spec.waves = [
        { axis: 'x', amp: a * 0.6, freq: 0.9 * sp, phase: 0.3 },
        { axis: 'x', amp: a * 0.4, freq: 2.3 * sp, phase: 1.7 },
        { axis: 'y', amp: a * 0.6, freq: 1.1 * sp, phase: 2.1 },
        { axis: 'y', amp: a * 0.4, freq: 2.9 * sp, phase: 0.8 },
      ]
      break
    }
    case 'earthquake': {
      const a = 0.04 * s
      spec.waves = [
        { axis: 'x', amp: a * 0.55, freq: 7.1 * sp, phase: 0.4 },
        { axis: 'x', amp: a * 0.45, freq: 11.3 * sp, phase: 2.2 },
        { axis: 'y', amp: a * 0.55, freq: 8.7 * sp, phase: 1.3 },
        { axis: 'y', amp: a * 0.45, freq: 12.9 * sp, phase: 3.1 },
      ]
      break
    }
    case 'wobble': {
      const a = 0.015 * s
      spec.waves = [
        { axis: 'x', amp: a, freq: 0.35 * sp, phase: 0 },
        { axis: 'y', amp: a, freq: 0.35 * sp, phase: Math.PI / 2 },
      ]
      break
    }
    case 'pulse': spec.pulse = { amp: 0.08 * s, freq: 1.2 * sp }; break
    case 'dutch-left': spec.rot = -DUTCH_MAX_DEGREES * s; break
    case 'dutch-right': spec.rot = DUTCH_MAX_DEGREES * s; break
    case 'dutch-sway': spec.rotWave = { amp: DUTCH_MAX_DEGREES * s, freq: 0.25 * sp }; break
  }
  return spec
}

interface StackSpec {
  items: PresetSpec[]
  /** Constant scale-up that keeps the moving, turning edges off-screen. */
  edge: number
  /** Largest rotation the stack can reach, in degrees (what the edge scale-up covers). */
  rotMax: number
}

/** Aspect of the frame the picture has to keep covered. */
const FRAME_ASPECT = 16 / 9

function stackSpec(motions: readonly ClipMotion[]): StackSpec {
  const items = motions.map(presetSpec)
  // Furthest the picture's centre ever strays on each axis, in frame fractions. The
  // presets add, so their reaches do. Scaling by k pushes each edge out (k-1)/2 of
  // the frame, so k = 1 + 2*reach covers it.
  const reach = (axis: 'x' | 'y') => items.reduce((sum, p) => {
    const [a0, a1] = axis === 'x' ? [p.x0, p.x1] : [p.y0, p.y1]
    return sum + Math.max(Math.abs(a0), Math.abs(a1))
      + p.waves.filter(w => w.axis === axis).reduce((acc, w) => acc + w.amp, 0)
  }, 0)
  const r = Math.max(reach('x'), reach('y'))
  const rotMax = items.reduce((sum, p) => sum + Math.abs(p.rot) + (p.rotWave?.amp ?? 0), 0)
  // A frame turned by theta needs the picture scaled by cos + sin*aspect to still cover it.
  const theta = rotMax * Math.PI / 180
  const turn = rotMax === 0 ? 1 : Math.cos(theta) + Math.sin(theta) * FRAME_ASPECT + 0.002
  const move = r > 0 ? 1 + 2 * r + 0.002 : 1
  return { items, edge: move * turn, rotMax }
}

const ease = (p: number) => p * p * (3 - 2 * p)

/**
 * The stack's contribution at `t` seconds from the clip's start, for a clip lasting
 * `duration` seconds: how far to move the layer's centre (frame fractions), how much
 * to multiply its scale by, and how far to turn it (degrees, clockwise).
 */
export function motionAt(
  motions: readonly ClipMotion[],
  t: number,
  duration: number,
): { dx: number; dy: number; scale: number; rotate: number } {
  const stack = stackSpec(motions)
  const e = ease(duration > 0 ? clamp(t / duration, 0, 1) : 0)
  let dx = 0
  let dy = 0
  let scale = stack.edge
  let rotate = 0
  for (const p of stack.items) {
    rotate += p.rot
    if (p.rotWave) rotate -= p.rotWave.amp * Math.sin(2 * Math.PI * p.rotWave.freq * t)
    dx += p.x0 + (p.x1 - p.x0) * e
    dy += p.y0 + (p.y1 - p.y0) * e
    for (const w of p.waves) {
      const v = w.amp * Math.sin(2 * Math.PI * w.freq * t + w.phase)
      if (w.axis === 'x') dx += v
      else dy += v
    }
    scale *= p.z0 + (p.z1 - p.z0) * e
    if (p.pulse) scale *= 1 + p.pulse.amp * (0.5 - 0.5 * Math.cos(2 * Math.PI * p.pulse.freq * t))
  }
  return { dx, dy, scale, rotate }
}

/**
 * motionAt() as ffmpeg expressions. `local` is an expression for seconds from the
 * clip's start on the clock the filter evaluates (e.g. `(t-12.500000)`). The results
 * contain commas, so callers must escape them like keyframeExpr's. `rotation` is an
 * expression in radians, clockwise, or null when the stack doesn't turn the picture.
 */
export function motionExprs(
  motions: readonly ClipMotion[],
  local: string,
  duration: number,
): { dx: string; dy: string; scale: string; rotation: string | null } {
  const stack = stackSpec(motions)
  const n = (v: number) => v.toFixed(6)
  const p = `min(1,max(0,${local}/${n(Math.max(duration, 1e-3))}))`
  const e = `(${p}*${p}*(3-2*${p}))`
  const sine = (w: Wave) => `${n(w.amp)}*sin(${n(2 * Math.PI * w.freq)}*${local}+${n(w.phase)})`

  const axis = (ax: 'x' | 'y'): string => {
    const terms: string[] = []
    for (const spec of stack.items) {
      const [a0, a1] = ax === 'x' ? [spec.x0, spec.x1] : [spec.y0, spec.y1]
      if (a0 !== 0 || a1 !== 0) terms.push(a0 === a1 ? n(a0) : `${n(a0)}+(${n(a1 - a0)})*${e}`)
      for (const w of spec.waves) if (w.axis === ax) terms.push(sine(w))
    }
    return terms.length > 0 ? `(${terms.join('+')})` : '0'
  }

  let scale = n(stack.edge)
  for (const spec of stack.items) {
    if (spec.z0 !== spec.z1) scale += `*(${n(spec.z0)}+(${n(spec.z1 - spec.z0)})*${e})`
    else if (spec.z0 !== 1) scale += `*${n(spec.z0)}`
    if (spec.pulse) {
      scale += `*(1+${n(spec.pulse.amp)}*(0.5-0.5*cos(${n(2 * Math.PI * spec.pulse.freq)}*${local})))`
    }
  }
  const toRad = Math.PI / 180
  const turns: string[] = []
  for (const spec of stack.items) {
    if (spec.rot !== 0) turns.push(n(spec.rot * toRad))
    if (spec.rotWave) {
      turns.push(`-${n(spec.rotWave.amp * toRad)}*sin(${n(2 * Math.PI * spec.rotWave.freq)}*${local})`)
    }
  }
  return {
    dx: axis('x'), dy: axis('y'), scale: `(${scale})`,
    rotation: turns.length > 0 ? `(${turns.join('+')})` : null,
  }
}

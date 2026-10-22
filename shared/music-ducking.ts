/**
 * Auto-ducking: music dips while anything else on the timeline is speaking, and comes
 * back afterwards. A music clip carries `duck: { enabled, amountDb }`.
 *
 * "Anything else" is every audible clip that is not itself a ducked clip or music,
 * measured from its real audio: a loudness envelope per source file (see
 * electron/audio-envelope.ts) is read at the source time each timeline moment maps to,
 * and counts as speech when it is above DUCK_THRESHOLD_DB. The result is one smoothed
 * 0..1 "how ducked" curve over the timeline.
 *
 * The curve is turned into ordinary VOLUME KEYFRAMES on the music clip (duckVolumeKeyframes),
 * so the dips are drawn on the clip, can be dragged by hand, and the preview and the export
 * play them like any other volume automation. Nothing about ducking happens at playback.
 *
 * It cannot tell speech from other loud sound (a door slam ducks the music too), only
 * from quiet.
 */

/** Loudness of a source file over time: RMS in dBFS for each `hop` seconds. */
export interface AudioEnvelope {
  hop: number
  db: number[]
}

/** One clip that counts as possible dialogue. */
export interface DuckTrigger {
  startTime: number
  duration: number
  trimStart: number
  speed: number
  reversed: boolean
  /** Base gain of the clip (its volume), used to scale its measured loudness. */
  volume: number
  envelope: AudioEnvelope | null
}

/** Resolution of the duck curve, in samples per second. */
export const DUCK_RATE = 20
/** RMS above this (dBFS) counts as sound worth ducking for. */
export const DUCK_THRESHOLD_DB = -38
/** The music starts to dip this long BEFORE the sound does. */
const LOOKAHEAD = 0.15
/** And stays down this long after the sound stops, bridging the gaps between words. */
const HOLD = 0.45
/** Time constants of the dip and the recovery. */
const ATTACK_TAU = 0.05
const RELEASE_TAU = 0.35

export const DEFAULT_DUCK_AMOUNT_DB = 12
export const MIN_DUCK_AMOUNT_DB = 3
export const MAX_DUCK_AMOUNT_DB = 30

function triggerDb(trigger: DuckTrigger, t: number): number {
  const env = trigger.envelope
  if (!env || env.db.length === 0) return -Infinity
  const local = t - trigger.startTime
  if (local < 0 || local >= trigger.duration) return -Infinity
  const sourceTime = trigger.reversed
    ? trigger.trimStart + (trigger.duration - local) * trigger.speed
    : trigger.trimStart + local * trigger.speed
  const index = Math.floor(sourceTime / env.hop)
  if (index < 0 || index >= env.db.length) return -Infinity
  return env.db[index] + (trigger.volume > 0 ? 20 * Math.log10(trigger.volume) : -Infinity)
}

/**
 * The duck curve for a timeline `totalDuration` seconds long: DUCK_RATE samples per
 * second, each 0 (music at full level) to 1 (fully ducked).
 */
export function buildDuckCurve(triggers: readonly DuckTrigger[], totalDuration: number): Float32Array {
  const steps = Math.max(1, Math.ceil(totalDuration * DUCK_RATE) + 1)
  const dt = 1 / DUCK_RATE
  const curve = new Float32Array(steps)
  const holdSteps = Math.round(HOLD * DUCK_RATE)
  const aheadSteps = Math.round(LOOKAHEAD * DUCK_RATE)

  const active = new Uint8Array(steps)
  for (let i = 0; i < steps; i++) {
    const t = i * dt
    for (const trigger of triggers) {
      if (triggerDb(trigger, t) > DUCK_THRESHOLD_DB) { active[i] = 1; break }
    }
  }

  // Hold the sound's "on" state past its end, then look ahead so the dip lands first.
  const held = new Uint8Array(steps)
  let sinceActive = Infinity
  for (let i = 0; i < steps; i++) {
    sinceActive = active[i] ? 0 : sinceActive + 1
    held[i] = sinceActive <= holdSteps ? 1 : 0
  }

  const attack = 1 - Math.exp(-dt / ATTACK_TAU)
  const release = 1 - Math.exp(-dt / RELEASE_TAU)
  let level = 0
  for (let i = 0; i < steps; i++) {
    const target = held[Math.min(steps - 1, i + aheadSteps)]
    level += (target - level) * (target > level ? attack : release)
    curve[i] = level
  }
  return curve
}

/** A dip's four volume keyframes: down just before the sound, held, then back up. */
const DIP_LEAD = 0.15
const DIP_DROP = 0.05
const DIP_RECOVER = 0.6

/**
 * The volume keyframes for a ducked clip: its own volume (`baseAt`, clip-local seconds, so
 * any fades or automation it already had are kept) with a dip wherever the duck curve says
 * something is speaking. Each dip is four points (down, held, back up) so it is easy to drag;
 * dips closer together than their ramps are merged into one so the music does not pump.
 * `baseKeyTimes` are the clip-local times of the volume keyframes it already had, kept as
 * points so that automation survives between the dips. `t` is clip-local seconds.
 */
export function duckVolumeKeyframes(
  curve: Float32Array,
  clipStartTime: number,
  clipDuration: number,
  baseAt: (clipTime: number) => number,
  amountDb: number,
  baseKeyTimes: readonly number[] = [],
): { t: number; value: number }[] {
  // Spans (clip-local seconds) where the curve is past halfway down.
  let dips: Array<[number, number]> = []
  let open: number | null = null
  for (let i = 0; i < curve.length; i++) {
    const t = i / DUCK_RATE - clipStartTime
    const down = curve[i] >= 0.5
    if (down && open === null) open = t
    if (!down && open !== null) { dips.push([open, t]); open = null }
  }
  if (open !== null) dips.push([open, curve.length / DUCK_RATE - clipStartTime])
  dips = dips.filter(([a, b]) => b > 0 && a < clipDuration)
  const merged: Array<[number, number]> = []
  for (const dip of dips) {
    const last = merged[merged.length - 1]
    if (last && dip[0] - DIP_LEAD <= last[1] + DIP_RECOVER) last[1] = Math.max(last[1], dip[1])
    else merged.push([dip[0], dip[1]])
  }

  const level = Math.pow(10, -amountDb / 20)
  const clampT = (t: number) => Math.max(0, Math.min(clipDuration, t))
  const gainAt = (t: number): number => {
    for (const [a, b] of merged) {
      const pts: Array<[number, number]> = [[a - DIP_LEAD, 1], [a + DIP_DROP, level], [b, level], [b + DIP_RECOVER, 1]]
      if (t < pts[0][0] || t > pts[3][0]) continue
      for (let i = 0; i < 3; i++) {
        const [t0, g0] = pts[i]
        const [t1, g1] = pts[i + 1]
        if (t <= t1) return t1 <= t0 ? g1 : g0 + ((g1 - g0) * (t - t0)) / (t1 - t0)
      }
    }
    return 1
  }

  const times = new Set<number>([0, clipDuration, ...baseKeyTimes.map(clampT)])
  for (const [a, b] of merged) for (const t of [a - DIP_LEAD, a + DIP_DROP, b, b + DIP_RECOVER]) times.add(clampT(t))
  const round = (v: number) => Math.round(v * 1000) / 1000
  const sorted = [...times].map(round).sort((x, y) => x - y).filter((t, i, arr) => i === 0 || t - arr[i - 1] > 1e-3)
  return sorted.map(t => ({ t, value: round(baseAt(t) * gainAt(t)) }))
}

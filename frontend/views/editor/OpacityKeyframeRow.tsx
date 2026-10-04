import { Diamond, ChevronLeft, ChevronRight, Trash2, Eraser } from 'lucide-react'
import { linearKeyframeValue } from './video-editor-utils'

// The opacity control for a clip: static, or keyframed manually — set the slider,
// click ◆ to commit a key at the playhead. Sitting ON a key, the slider edits that
// key directly; between keys the value is pending until ◆, and shows amber until
// then so it's clear nothing has been committed.
//
// Shared by text overlays (whose static value lives on textStyle.opacity) and by
// video/image clips (whose static value is the clip's own `opacity`), which differ
// only in where that static value is written — hence `setStatic`.

export interface OpacityKey { t: number; value: number }

export interface PendingOpacity { clipId: string; t: number; value: number }

const KEY_EPS = 1 / 48
const iconBtn = 'p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent'

export interface OpacityKeyframeRowProps {
  clipId: string
  startTime: number
  duration: number
  keys: OpacityKey[]
  /** Opacity when there are no keys, 0..100. */
  staticValue: number
  currentTime: number
  pending: PendingOpacity | null
  setPending: (next: PendingOpacity | null) => void
  setKeys: (next: OpacityKey[] | undefined) => void
  setStatic: (value: number) => void
  /** Drop every key and keep `value` as the static opacity — one edit, one undo step. */
  clearKeys: (value: number) => void
  setCurrentTime: (time: number) => void
  /** Slider accent, to sit with the surrounding section. */
  accent?: string
  /** Row label and slider ceiling; defaults make it the opacity row (also used for Volume, 0..200%). */
  label?: string
  max?: number
}

export function OpacityKeyframeRow({
  clipId, startTime, duration, keys: rawKeys, staticValue, currentTime,
  pending: rawPending, setPending, setKeys, setStatic, clearKeys, setCurrentTime,
  accent = 'accent-cyan-500', label = 'Opacity', max = 100,
}: OpacityKeyframeRowProps) {
  const noun = label.toLowerCase()
  const keys = [...rawKeys].sort((a, b) => a.t - b.t)
  const localT = currentTime - startTime
  const inClip = localT >= -1e-3 && localT <= duration + 1e-3
  const t = Math.max(0, Math.min(duration, localT))
  const keyIdx = keys.findIndex(k => Math.abs(k.t - t) < KEY_EPS)
  const pending = rawPending && rawPending.clipId === clipId && Math.abs(rawPending.t - t) < KEY_EPS
    ? rawPending.value
    : null
  const value = pending ?? (keys.length ? Math.round(linearKeyframeValue(keys, t)) : staticValue)
  const upsert = (v: number) =>
    setKeys([...keys.filter(k => Math.abs(k.t - t) >= KEY_EPS), { t, value: v }].sort((a, b) => a.t - b.t))
  const prevKey = [...keys].reverse().find(k => k.t < t - KEY_EPS)
  const nextKey = keys.find(k => k.t > t + KEY_EPS)

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-400">{label}</span>
        <div className="flex items-center gap-1.5">
          <input
            type="range" min={0} max={max} value={value}
            disabled={keys.length > 0 && !inClip}
            onChange={e => {
              const v = parseInt(e.target.value)
              if (!keys.length) setStatic(v)                        // static opacity
              else if (keyIdx >= 0) upsert(v)                       // editing the key under the playhead
              else setPending({ clipId, t, value: v })              // new key: waits for ◆
            }}
            className={`w-20 ${accent}`}
          />
          <span className={`text-[10px] w-8 text-right tabular-nums ${pending != null ? 'text-amber-300' : 'text-zinc-300'}`}>{value}%</span>
          <button
            onClick={() => { upsert(value); setPending(null) }}
            disabled={!inClip}
            className={`${iconBtn} ${keyIdx >= 0 ? 'text-amber-300' : 'text-amber-300/70'} ${pending != null ? 'ring-1 ring-amber-400 animate-pulse' : ''}`}
            title={inClip ? `Set a ${noun} keyframe at the playhead with this value` : 'Move the playhead over this clip to add a keyframe'}
          >
            <Diamond className={`h-3 w-3 ${keyIdx >= 0 ? 'fill-current' : ''}`} />
          </button>
        </div>
      </div>
      {pending != null && (
        <p className="text-[9px] text-amber-300/90 pl-1">Click ◆ to keyframe {pending}% here.</p>
      )}
      {keys.length > 0 && (
        <div className="flex items-center justify-between pl-1">
          <span className="text-[9px] text-amber-300/80 tabular-nums">
            {keys.length} key{keys.length === 1 ? '' : 's'}{keyIdx >= 0 ? ` · on key ${keyIdx + 1}` : ''}
          </span>
          <div className="flex items-center gap-0.5">
            <button onClick={() => prevKey && setCurrentTime(startTime + prevKey.t)} disabled={!prevKey} className={iconBtn} title="Previous keyframe">
              <ChevronLeft className="h-3 w-3" />
            </button>
            <button onClick={() => nextKey && setCurrentTime(startTime + nextKey.t)} disabled={!nextKey} className={iconBtn} title="Next keyframe">
              <ChevronRight className="h-3 w-3" />
            </button>
            <button onClick={() => setKeys(keys.filter((_, i) => i !== keyIdx))} disabled={keyIdx < 0} className={iconBtn} title="Delete the keyframe at the playhead">
              <Trash2 className="h-3 w-3" />
            </button>
            <button
              onClick={() => clearKeys(value)}
              className={iconBtn}
              title={`Clear keyframes (keeps the current ${noun})`}
            >
              <Eraser className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

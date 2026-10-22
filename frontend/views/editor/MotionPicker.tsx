/**
 * The Motion section of the FILTERS panel: zoom / pan / shake / tilt presets that
 * stack (up to MAX_STACKED_MOTIONS), each with its own strength slider, plus a speed
 * slider for the ones that shake or beat. The presets and their math live in
 * shared/clip-motion.ts, which the export reads too.
 */

import { RotateCcw, X } from 'lucide-react'
import {
  MAX_STACKED_MOTIONS, MOTION_PRESETS, MOTION_PRESETS_BY_ID, MOTION_SPEED_MAX, MOTION_SPEED_MIN,
  defaultMotion, oppositeMotion,
  type ClipMotion, type MotionPreset,
} from '../../../shared/clip-motion'
import { Tooltip } from '../../components/ui/tooltip'

const GROUPS: readonly MotionPreset['group'][] = ['Zoom & pan', 'Shake', 'Pulse', 'Dutch angle']

export function MotionPicker({
  value,
  onChange,
}: {
  value: readonly ClipMotion[] | undefined
  onChange: (next: ClipMotion[] | undefined) => void
}) {
  const stack = value ?? []
  const full = stack.length >= MAX_STACKED_MOTIONS

  const emit = (next: ClipMotion[]) => onChange(next.length > 0 ? next : undefined)
  const toggle = (preset: MotionPreset) => {
    if (stack.some((m) => m.preset === preset.id)) {
      emit(stack.filter((m) => m.preset !== preset.id))
      return
    }
    // Dutch left and right cancel out, so picking one swaps the other.
    const opposite = oppositeMotion(preset.id)
    const rest = opposite ? stack.filter((m) => m.preset !== opposite) : stack
    if (rest.length >= MAX_STACKED_MOTIONS) return
    emit([...rest, defaultMotion(preset.id)])
  }
  const update = (preset: ClipMotion['preset'], patch: Partial<ClipMotion>) =>
    emit(stack.map((m) => (m.preset === preset ? { ...m, ...patch } : m)))

  return (
    <div className="space-y-2">
      {GROUPS.map((group) => (
        <div key={group}>
          <div className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">{group}</div>
          <div className="grid grid-cols-3 gap-1.5">
            {MOTION_PRESETS.filter((p) => p.group === group).map((preset) => {
              const selected = stack.some((m) => m.preset === preset.id)
              const blocked = !selected && full && !oppositeMotion(preset.id)
              return (
                <Tooltip
                  key={preset.id}
                  content={blocked ? `Up to ${MAX_STACKED_MOTIONS} at once — turn one off first` : preset.blurb}
                  side="right"
                >
                  <button
                    onClick={() => toggle(preset)}
                    className={`w-full rounded border px-1 py-1.5 text-[10px] truncate transition-colors ${
                      selected
                        ? 'border-blue-500 bg-blue-500/15 text-white'
                        : blocked
                          ? 'border-zinc-800 text-zinc-600 cursor-not-allowed'
                          : 'border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800/60'
                    }`}
                  >
                    {preset.name}
                  </button>
                </Tooltip>
              )
            })}
          </div>
        </div>
      ))}

      {stack.length > 0 && (
        <>
          <div className="space-y-2.5 pt-1">
            {stack.map((m) => {
              const preset = MOTION_PRESETS_BY_ID.get(m.preset)
              return (
                <div key={m.preset} className="rounded border border-zinc-800 px-2 py-1.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-zinc-300">{preset?.name ?? m.preset}</span>
                    <button
                      onClick={() => emit(stack.filter((s) => s.preset !== m.preset))}
                      className="text-zinc-600 hover:text-zinc-300 transition-colors"
                      title="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[11px] text-zinc-400">Strength</span>
                      <span className="text-[10px] text-zinc-500 tabular-nums">{Math.round(m.strength)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={m.strength}
                      onChange={(e) => update(m.preset, { strength: parseInt(e.target.value, 10) })}
                      className="w-full h-1.5 accent-blue-500"
                    />
                  </div>
                  {preset?.usesSpeed && (
                    <div>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[11px] text-zinc-400">Speed</span>
                        <span className="text-[10px] text-zinc-500 tabular-nums">{m.speed.toFixed(2)}×</span>
                      </div>
                      <input
                        type="range"
                        min={MOTION_SPEED_MIN}
                        max={MOTION_SPEED_MAX}
                        step={0.05}
                        value={m.speed}
                        onChange={(e) => update(m.preset, { speed: parseFloat(e.target.value) })}
                        className="w-full h-1.5 accent-blue-500"
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <p className="text-[10px] text-zinc-600 leading-snug">
            Pick up to {MAX_STACKED_MOTIONS} to combine. The clip is scaled up slightly while it moves so its edges never show. Stacks with the clip's own position and zoom.
          </p>

          <button
            className="flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-blue-400 transition-colors"
            onClick={() => onChange(undefined)}
          >
            <RotateCcw className="h-3 w-3" />
            Clear all
          </button>
        </>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { TimelineClip } from '../../types/project-model'
import { useColorMatte } from './useColorMatte'

/** Color picker for a color matte clip. Dragging inside the picker fires a change
 *  per move and each recolor writes a new PNG, so the pick is committed once it
 *  has been still for a moment. */
export function MatteColorRow({ clip }: { clip: TimelineClip }) {
  const { recolorMatte } = useColorMatte()
  const committed = clip.asset?.matteColor ?? '#000000'
  const [value, setValue] = useState(committed)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setValue(committed) }, [committed, clip.id])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const onPick = (color: string) => {
    setValue(color)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { if (color !== committed) void recolorMatte(clip, color) }, 500)
  }

  return (
    <div className="flex items-center gap-2 mt-3">
      <span className="text-[10px] text-zinc-400 w-12">Color</span>
      <input
        type="color"
        value={value}
        onChange={e => onPick(e.target.value)}
        className="w-9 h-6 rounded cursor-pointer border border-zinc-700 bg-transparent"
        title="Matte color"
      />
      <span className="text-[10px] text-zinc-400 tabular-nums">{value.toUpperCase()}</span>
    </div>
  )
}

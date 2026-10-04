import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

export interface VisibleTimeWindow { from: number; to: number }

/**
 * Seconds of timeline worth mounting clips for: the viewport plus a page of
 * overscan either side. The window moves in whole pages (not per scroll event), so
 * scrolling only re-renders the panel when it crosses a page boundary — per-scroll
 * state in the panel stutters (see TimelineRulerTicks).
 */
export function useVisibleTimeWindow(
  scrollContainerRef: RefObject<HTMLDivElement | null>,
  pixelsPerSecond: number,
): VisibleTimeWindow {
  const [range, setRange] = useState({ from: 0, to: 4000 })
  // The container can mount after this hook first runs; track the element itself so
  // the listener binds as soon as it exists.
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (scrollContainerRef.current !== container) setContainer(scrollContainerRef.current)
  })

  useEffect(() => {
    if (!container) return
    const update = () => {
      const page = Math.max(1000, container.clientWidth)
      const from = Math.max(0, (Math.floor(container.scrollLeft / page) - 1) * page)
      const to = (Math.floor(container.scrollLeft / page) + 3) * page
      setRange(prev => (prev.from === from && prev.to === to ? prev : { from, to }))
    }
    update()
    container.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    observer?.observe(container)
    return () => {
      container.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [container, pixelsPerSecond])

  return { from: range.from / pixelsPerSecond, to: range.to / pixelsPerSecond }
}

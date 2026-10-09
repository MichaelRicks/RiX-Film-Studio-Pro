import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

const MIN_THUMB_PX = 56

interface Metrics { scrollLeft: number; clientWidth: number; scrollWidth: number }

/**
 * Horizontal scrollbar for the timeline. The native one sizes its thumb by the
 * visible share of the content, so zoomed in on a long timeline it shrinks to a
 * sliver that is hard to grab and slow to travel with. This one never goes below
 * MIN_THUMB_PX, and a click on the track pages toward the click.
 */
export function TimelineScrollbar({
  containerRef,
  contentWidth,
}: {
  containerRef: RefObject<HTMLDivElement | null>
  /** Width of the scrolled content; re-measures when the zoom changes it. */
  contentWidth: number
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [m, setM] = useState<Metrics>({ scrollLeft: 0, clientWidth: 0, scrollWidth: 0 })
  const [dragging, setDragging] = useState(false)

  const measure = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    setM(prev => (
      prev.scrollLeft === el.scrollLeft && prev.clientWidth === el.clientWidth && prev.scrollWidth === el.scrollWidth
        ? prev
        : { scrollLeft: el.scrollLeft, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }
    ))
  }, [containerRef])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(el)
    return () => {
      el.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  }, [containerRef, measure])

  // Zooming changes scrollWidth without a scroll or a resize of the container.
  useEffect(measure, [contentWidth, measure])

  const maxScroll = Math.max(0, m.scrollWidth - m.clientWidth)
  if (maxScroll <= 0 || m.clientWidth <= 0) return <div className="h-0 flex-shrink-0" />

  const trackW = trackRef.current?.clientWidth || m.clientWidth
  const thumbW = Math.min(trackW, Math.max(MIN_THUMB_PX, (m.clientWidth / m.scrollWidth) * trackW))
  const travel = Math.max(1, trackW - thumbW)
  const thumbLeft = (m.scrollLeft / maxScroll) * travel

  const startDrag = (e: React.MouseEvent) => {
    const el = containerRef.current
    if (!el || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startScroll = el.scrollLeft
    setDragging(true)
    const onMove = (ev: MouseEvent) => {
      el.scrollLeft = startScroll + ((ev.clientX - startX) / travel) * maxScroll
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const pageToward = (e: React.MouseEvent) => {
    const el = containerRef.current
    const track = trackRef.current
    if (!el || !track || e.button !== 0) return
    const x = e.clientX - track.getBoundingClientRect().left
    const dir = x < thumbLeft ? -1 : 1
    el.scrollLeft += dir * el.clientWidth * 0.9
  }

  return (
    <div
      ref={trackRef}
      className="relative h-3.5 flex-shrink-0 bg-zinc-900 border-t border-zinc-800 select-none"
      onMouseDown={pageToward}
      title="Drag to scroll the timeline"
    >
      <div
        className={`absolute top-0.5 bottom-0.5 rounded-sm cursor-grab ${dragging ? 'bg-blue-500 cursor-grabbing' : 'bg-zinc-600 hover:bg-zinc-500'}`}
        style={{ left: thumbLeft, width: thumbW }}
        onMouseDown={startDrag}
      />
    </div>
  )
}

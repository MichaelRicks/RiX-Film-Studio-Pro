import React, { useEffect, useState } from 'react'
import { formatTime } from './video-editor-utils'

interface TimelineRulerTicksProps {
  /** The scrolling track area the ruler mirrors. */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  /** Seconds the ruler runs to. */
  extent: number
  pixelsPerSecond: number
  interval: number
  subInterval: number
}

// Major + minor ruler ticks. Only the pages around the visible one are built (an
// hour at full zoom is thousands of ticks), and the window lives in here so that
// scrolling re-renders the ticks alone, not the whole timeline.
export const TimelineRulerTicks = React.memo(function TimelineRulerTicks({
  scrollContainerRef, extent, pixelsPerSecond, interval, subInterval,
}: TimelineRulerTicksProps) {
  const [range, setRange] = useState({ from: 0, to: 4000 })

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const update = () => {
      const page = Math.max(1, container.clientWidth)
      const from = (Math.floor(container.scrollLeft / page) - 1) * page
      setRange(prev => (prev.from === from && prev.to === from + page * 4 ? prev : { from, to: from + page * 4 }))
    }
    update()
    container.addEventListener('scroll', update, { passive: true })
    return () => container.removeEventListener('scroll', update)
  }, [scrollContainerRef, pixelsPerSecond])

  const ticks: React.ReactNode[] = []
  const end = Math.min(extent + interval, range.to / pixelsPerSecond)
  const first = Math.max(0, Math.floor(range.from / pixelsPerSecond / subInterval))
  for (let n = first; n * subInterval < end; n++) {
    const t = +(n * subInterval).toFixed(4)
    const isMajor = Math.abs(t % interval) < 0.001 || Math.abs(t % interval - interval) < 0.001
    ticks.push(
      <div key={t} className="absolute top-0 bottom-0" style={{ left: `${t * pixelsPerSecond}px` }}>
        <div className={`h-full border-l ${isMajor ? 'border-zinc-700' : 'border-zinc-800'}`} />
        {isMajor && (
          <span className="absolute left-1 bottom-0.5 text-[10px] text-zinc-500 whitespace-nowrap leading-none">
            {formatTime(t)}
          </span>
        )}
      </div>,
    )
  }
  return <>{ticks}</>
})

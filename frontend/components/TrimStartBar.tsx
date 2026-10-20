import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

interface TrimStartBarProps {
  videoRef: RefObject<HTMLVideoElement | null>
  fps: number
  /** Frames to cut from the start (the box covers frame 0 up to this). */
  frames: number
  onChange: (frames: number) => void
}

/**
 * Track under the enlarged video that shows the clip's timeline with a bold box
 * over the part "Trim start" will cut. Drag the box's right edge (or click the
 * track) to set the cut; the video seeks to the new first frame as you drag so
 * you can see exactly where the clip will begin.
 */
export function TrimStartBar({ videoRef, fps, frames, onChange }: TrimStartBarProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [duration, setDuration] = useState(0)
  const [playhead, setPlayhead] = useState(0)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const readDuration = () => setDuration(Number.isFinite(v.duration) ? v.duration : 0)
    const readTime = () => setPlayhead(v.currentTime)
    readDuration()
    readTime()
    v.addEventListener('loadedmetadata', readDuration)
    v.addEventListener('durationchange', readDuration)
    v.addEventListener('timeupdate', readTime)
    v.addEventListener('seeked', readTime)
    return () => {
      v.removeEventListener('loadedmetadata', readDuration)
      v.removeEventListener('durationchange', readDuration)
      v.removeEventListener('timeupdate', readTime)
      v.removeEventListener('seeked', readTime)
    }
  }, [videoRef])

  const totalFrames = Math.max(1, Math.floor(duration * fps))
  // Keep at least one frame so the result is never empty.
  const maxFrames = Math.max(1, totalFrames - 1)

  const setFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current
    if (!track || duration <= 0) return
    const rect = track.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const next = Math.min(maxFrames, Math.max(1, Math.round(ratio * totalFrames)))
    onChange(next)
    const v = videoRef.current
    if (v) {
      // Show the frame the clip would start on.
      v.pause()
      v.currentTime = Math.min(duration, next / fps)
    }
  }, [duration, fps, maxFrames, onChange, totalFrames, videoRef])

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDragging(true)
    setFromClientX(e.clientX)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging) setFromClientX(e.clientX)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    setDragging(false)
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  }

  if (duration <= 0) return null

  const cutPct = Math.min(100, Math.max(0, (Math.min(frames, maxFrames) / totalFrames) * 100))
  const playheadPct = Math.min(100, Math.max(0, (playhead / duration) * 100))
  const cutSeconds = Math.min(frames, maxFrames) / fps

  return (
    <div className="mt-3 select-none">
      <div
        ref={trackRef}
        className="relative h-9 rounded-md bg-zinc-800 cursor-ew-resize touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* The part that will be cut: bold box from the clip's start. */}
        <div
          className="absolute inset-y-0 left-0 rounded-l-md border-2 border-red-500 bg-red-500/35"
          style={{ width: `${cutPct}%` }}
        >
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-white drop-shadow whitespace-nowrap overflow-hidden">
            {cutPct > 12 ? `Cut ${Math.min(frames, maxFrames)} frames (${cutSeconds.toFixed(2)}s)` : ''}
          </span>
        </div>
        {/* Drag handle on the box's right edge. */}
        <div
          className="absolute top-[-3px] bottom-[-3px] w-2 -translate-x-1/2 rounded bg-red-500 shadow"
          style={{ left: `${cutPct}%` }}
        />
        {/* Where the video is now. */}
        <div
          className="absolute inset-y-0 w-0.5 bg-white/80 pointer-events-none"
          style={{ left: `${playheadPct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-zinc-400">
        <span>Red = removed. The clip will start at {cutSeconds.toFixed(2)}s.</span>
        <span>{totalFrames} frames / {duration.toFixed(2)}s</span>
      </div>
    </div>
  )
}

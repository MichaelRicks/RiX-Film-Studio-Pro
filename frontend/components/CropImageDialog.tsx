import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X } from 'lucide-react'
import { pathToFileUrl } from '../lib/file-url'
import { saveDataUrlToTempFile } from './gpm/gpm-image-file'

/**
 * Drag a box over a picture and keep just that part (no AI, exact pixels). Used to cut one garment,
 * prop or face out of a bigger picture before it goes on a reference sheet.
 */
export function CropImageDialog({ path, onDone, onClose }: {
  path: string
  onDone: (newPath: string) => void
  onClose: () => void
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [sel, setSel] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Read through the main process so the canvas can be exported in the packaged app.
  useEffect(() => {
    let alive = true
    void window.electronAPI.gpmLibReadAsDataUrl({ path }).then(r => {
      if (!alive) return
      setSrc(r.success ? r.dataUrl : pathToFileUrl(path))
    }).catch(() => { if (alive) setSrc(pathToFileUrl(path)) })
    return () => { alive = false }
  }, [path])

  const point = (e: React.PointerEvent) => {
    const r = imgRef.current!.getBoundingClientRect()
    return {
      x: Math.min(Math.max(e.clientX - r.left, 0), r.width),
      y: Math.min(Math.max(e.clientY - r.top, 0), r.height),
    }
  }
  const down = (e: React.PointerEvent) => {
    if (!imgRef.current) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    start.current = point(e)
    setSel({ ...start.current, w: 0, h: 0 })
  }
  const move = (e: React.PointerEvent) => {
    if (!start.current || !imgRef.current) return
    const p = point(e)
    const s = start.current
    setSel({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) })
  }
  const up = () => { start.current = null }

  const apply = async () => {
    const im = imgRef.current
    if (!im || !sel || sel.w < 8 || sel.h < 8) { setError('Drag a box over the part you want to keep.'); return }
    setBusy(true)
    setError(null)
    try {
      const rect = im.getBoundingClientRect()
      const kx = im.naturalWidth / rect.width, ky = im.naturalHeight / rect.height
      const sx = Math.round(sel.x * kx), sy = Math.round(sel.y * ky)
      const sw = Math.max(1, Math.round(sel.w * kx)), sh = Math.max(1, Math.round(sel.h * ky))
      const cv = document.createElement('canvas')
      cv.width = sw; cv.height = sh
      const g = cv.getContext('2d')
      if (!g) throw new Error('no canvas')
      g.drawImage(im, sx, sy, sw, sh, 0, 0, sw, sh)
      const base = path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? 'image'
      onDone(await saveDataUrlToTempFile(cv.toDataURL('image/png'), `${base}-crop.png`))
    } catch (e) {
      setError(`Could not crop: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setBusy(false) }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={(e) => { e.stopPropagation(); onClose() }}>
      <div className="bg-zinc-900 rounded-2xl border border-zinc-700/50 shadow-2xl max-w-[92vw] max-h-[94vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <span className="text-sm font-semibold text-white">Crop: drag a box over the part to keep</span>
          <button onClick={onClose} className="p-1 rounded-lg text-zinc-500 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 overflow-auto flex items-center justify-center">
          {!src ? <Loader2 className="h-5 w-5 animate-spin text-zinc-400" /> : (
            <div className="relative inline-block select-none touch-none cursor-crosshair"
              onPointerDown={down} onPointerMove={move} onPointerUp={up}>
              <img ref={imgRef} src={src} alt="" draggable={false} className="block max-w-[88vw] max-h-[70vh] object-contain" />
              {sel && sel.w > 0 && sel.h > 0 && (
                <div className="absolute border-2 border-[rgb(var(--accent))] pointer-events-none"
                  style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h, boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }} />
              )}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center gap-2">
          {error && <span className="text-xs text-red-400 flex-1">{error}</span>}
          {!error && <span className="text-[11px] text-zinc-500 flex-1">For an outfit, keep the garment from the collar down so no face is included.</span>}
          <button onClick={() => setSel(null)} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white">Reset</button>
          <button onClick={() => void apply()} disabled={busy || !sel}
            className="px-4 py-1.5 rounded-lg bg-[rgb(var(--accent))] hover:brightness-110 disabled:opacity-40 text-white text-xs font-semibold transition">
            {busy ? 'Cropping…' : 'Use this crop'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

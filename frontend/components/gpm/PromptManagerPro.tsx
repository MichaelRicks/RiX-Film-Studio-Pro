/**
 * Prompt Manager Pro — collapsible dock.
 *
 * Real React UI matching the `ltx-gpm.jsx` prototype (C color tokens, tabbed
 * dock, collapsible Sections with collapse-all), wired to the REAL pure engines
 * in `@/gpm-core`. Every panel can Copy its assembled prompt or Inject it into
 * the LTX Gen Space prompt box (via ProjectContext). No generation simulation.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Camera, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, Download, Eraser, FolderPlus, GripVertical, Image as ImageIcon,
  Layers, Maximize2, Minimize2, Pencil, Plus, RotateCcw, Save, Search, Send, Trash2, Upload, Wand2, X,
} from 'lucide-react'
import {
  PERF_FAMILIES, assemblePerformance, perfLabel, defaultDialogueForFamily, familyIndexByName, type PerfDelivery,
  SHOT_PRESETS, SHOT_ANCHORS, buildShotPrompt, type ShotState,
  CAM_CATS, filterCameraCards, type CameraCategory,
  WF_ROLES, buildWorkflowPrompt, type WfState, type WfRole,
} from '@/gpm-core'
import { useProjects } from '@/contexts/ProjectContext'
import {
  type GpmPromptFolder, type GpmImageFolder, type GpmImage, gpmId,
  loadPromptFolders, savePromptFolders, loadImageFolders, saveImageFolders,
  loadImages, putImage, deleteImage, exportBackup, importBackup, parseBackup,
  loadAllPromptThumbs, setPromptThumb, deletePromptThumb,
  type GpmWorkflow, loadWorkflows, saveWorkflows,
  type GpmPerformance, loadPerformances, savePerformances, loadWorkingPerf, saveWorkingPerf,
  type GpmPanorama, loadPanoramas, putPanorama, deletePanorama, MAX_PANORAMAS,
} from './gpm-storage'
import { saveDataUrlToTempFile, GPM_IMAGE_DND_TYPE, type GpmDndImage } from './gpm-image-file'
import { FILE_DND, type LibFile } from './DownloadsBrowser'
import { usePromptManagerProOpen, setPromptManagerProOpen } from './prompt-manager-pro-store'
import { MediaThumb } from './MediaThumb'
import { QwenMultiAnglePanel, DEFAULT_QWEN_ANGLE_STATE, type QwenAngleState, type InjectTarget } from './QwenMultiAnglePanel'
import { C } from './gpm-theme'

// Camera reference thumbnails, bundled by Vite. Map filename -> resolved URL.
const CAM_IMAGE_URLS = import.meta.glob('../../assets/gpm-camera/*.jpg', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>
function camImageUrl(file?: string): string | undefined {
  if (!file) return undefined
  const hit = Object.entries(CAM_IMAGE_URLS).find(([p]) => p.endsWith('/' + file))
  return hit?.[1]
}

type GpmTab = 'performance' | 'shot' | 'camera' | 'workflow' | 'prompts' | 'images' | 'plates' | 'qwenAngle'

// DND mime types for folder drag-reorder, distinct per panel so a drag in one can't drop in the other.
const PROMPT_FOLDER_DND = 'application/x-gpm-pro-promptfolder'
const IMAGE_FOLDER_DND = 'application/x-gpm-pro-imagefolder'

interface PerfState {
  familyIndex: number
  intensity: number
  asymmetry: number
  dialogue: string
  delivery: PerfDelivery
  /** True while `dialogue` is the auto-filled per-family default (cleared on focus). */
  dialogueAuto: boolean
}

/* Section open-state shared across the dock, with a global collapse-all. */
interface SectionCtl {
  isOpen: (id: string) => boolean
  toggle: (id: string) => void
}

/* ---- UI atoms (ported from the prototype) -------------------------------- */
function Label({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${className}`} style={{ color: C.muted }}>
      {children}
    </div>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-1 rounded tabular-nums" style={{ background: C.elev, color: C.blue, fontSize: 9 }}>
      {children}
    </span>
  )
}

function Slider({
  value, min, max, step, onChange, left, mid, right,
}: {
  value: number; min: number; max: number; step: number
  onChange: (v: number) => void
  left?: string | number; mid?: string; right?: string | number
}) {
  return (
    <div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 cursor-pointer"
        style={{ accentColor: C.blue, background: 'transparent' }}
      />
      <div className="flex justify-between mt-1 text-[10px] tracking-wide" style={{ color: C.faint }}>
        <span>{left}</span><span>{mid}</span><span>{right}</span>
      </div>
    </div>
  )
}

/** A solid, thick triangle disclosure indicator — matches the Downloads Browser's folder accordion. */
function Triangle({ open, color }: { open: boolean; color: string }) {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" style={{ color, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s', flexShrink: 0 }}>
      <path d="M1 0 L9 5 L1 10 Z" fill="currentColor" />
    </svg>
  )
}

function Section({
  id, title, ctl, right, children, dragHandle, dropLine, onDragOver, onDragLeave, onDrop,
}: {
  id: string; title: React.ReactNode; ctl: SectionCtl
  right?: React.ReactNode; children: React.ReactNode
  /** Present only for reorderable (folder) sections — renders a grip handle in the header. */
  dragHandle?: { onDragStart: (e: React.DragEvent) => void; onDragEnd: () => void }
  dropLine?: 'before' | 'after' | null
  onDragOver?: (e: React.DragEvent) => void
  onDragLeave?: () => void
  onDrop?: (e: React.DragEvent) => void
}) {
  const open = ctl.isOpen(id)
  return (
    <div
      className="relative rounded-lg mb-2 overflow-hidden"
      style={{ border: `1px solid ${C.border}` }}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
    >
      {dropLine && (
        <div
          className="absolute left-0 right-0 z-10 pointer-events-none"
          style={{ [dropLine === 'before' ? 'top' : 'bottom']: -1, height: 2, background: C.blue, boxShadow: `0 0 4px ${C.blue}` }}
        />
      )}
      <button
        onClick={() => ctl.toggle(id)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide"
        style={{ background: C.card, color: C.text }}
      >
        <span className="flex items-center gap-1.5">
          {dragHandle && (
            <span
              draggable onDragStart={dragHandle.onDragStart} onDragEnd={dragHandle.onDragEnd}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center"
              style={{ cursor: 'grab' }}
            >
              <GripVertical size={12} style={{ color: C.faint }} />
            </span>
          )}
          <Triangle open={open} color={open ? C.blue : C.muted} />
          {title}
        </span>
        {right}
      </button>
      {open && <div className="p-3" style={{ borderTop: `1px solid ${C.border}` }}>{children}</div>}
    </div>
  )
}

function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md px-3 py-2" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <Search size={14} style={{ color: C.faint }} />
      <input
        value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="flex-1 bg-transparent outline-none text-xs" style={{ color: C.text }}
      />
    </div>
  )
}

/* Copy + Inject action row, shared by panels with a single assembled output. */
function ActionRow({
  text, onCopy, onInject,
}: { text: string; onCopy: (t: string) => void; onInject: (t: string) => void }) {
  const disabled = !text.trim()
  return (
    <div className="grid grid-cols-2 gap-2 mt-3">
      <button
        onClick={() => onCopy(text)} disabled={disabled}
        className="flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-40"
        style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}
      >
        <Copy size={13} />Copy prompt
      </button>
      <button
        onClick={() => onInject(text)} disabled={disabled}
        title="Send the assembled prompt to the LTX Create prompt box"
        className="flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-40"
        style={{ background: C.green, color: '#fff' }}
      >
        <Send size={13} />Inject into prompt
      </button>
    </div>
  )
}

/* ---- Performance Studio --------------------------------------------------- */
function PerformancePanel({
  perf, setPerf, ctl, onCopy, onInject, flash,
}: {
  perf: PerfState; setPerf: React.Dispatch<React.SetStateAction<PerfState>>
  ctl: SectionCtl; onCopy: (t: string) => void; onInject: (t: string) => void; flash: (m: string) => void
}) {
  const up = <K extends keyof PerfState>(k: K, v: PerfState[K]) => setPerf((p) => ({ ...p, [k]: v }))

  // Saved performances (persisted in IndexedDB, mirroring saved Workflows).
  const [savedPerfs, setSavedPerfs] = useState<GpmPerformance[]>([])
  const [perfName, setPerfName] = useState('')
  useEffect(() => { void loadPerformances().then(setSavedPerfs) }, [])
  const persistPerfs = (list: GpmPerformance[]) => { setSavedPerfs(list); void savePerformances(list) }
  const saveCurrentPerf = () => {
    const fam = PERF_FAMILIES[perf.familyIndex]
    const name = perfName.trim() || fam?.family || 'Untitled Performance'
    const rec: GpmPerformance = {
      id: gpmId(), name, updatedAt: Date.now(),
      family: fam?.family ?? '', intensity: perf.intensity, asymmetry: perf.asymmetry,
      dialogue: perf.dialogue, delivery: perf.delivery, dialogueAuto: perf.dialogueAuto,
    }
    persistPerfs([rec, ...savedPerfs])
    setPerfName('')
    flash(`Saved "${name}"`)
  }
  const loadPerf = (p: GpmPerformance) => {
    setPerf({
      familyIndex: familyIndexByName(p.family), intensity: p.intensity, asymmetry: p.asymmetry,
      dialogue: p.dialogue, delivery: p.delivery as PerfDelivery, dialogueAuto: p.dialogueAuto,
    })
    flash(`Loaded "${p.name}"`)
  }
  const deletePerf = (id: string) => persistPerfs(savedPerfs.filter((p) => p.id !== id))
  // Mirrors the extension: the dialogue box shows the family's default as a
  // placeholder (not a real value) until clicked; if the box is still empty,
  // the assembled prompt falls back to the placeholder text too.
  const placeholder = defaultDialogueForFamily(perf.familyIndex)
  const perfOut = useMemo(
    () => assemblePerformance({ ...perf, dialogue: perf.dialogue || placeholder }),
    [perf, placeholder],
  )

  // Family change: if the box currently holds a previous auto-filled default
  // (dialogueAuto), swap it for the new family's text. If the box is empty
  // and untouched, leave it empty — the placeholder above already updates.
  const changeFamily = (idx: number) => setPerf((p) => ({
    ...p, familyIndex: idx,
    dialogue: p.dialogueAuto ? defaultDialogueForFamily(idx) : p.dialogue,
  }))
  // Clicking into an empty box promotes the placeholder into a real, selected value.
  const onDialogueClick = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    if (perf.dialogue) return
    const v = defaultDialogueForFamily(perf.familyIndex)
    if (!v) return
    setPerf((p) => ({ ...p, dialogue: v, dialogueAuto: true }))
    const el = e.currentTarget
    requestAnimationFrame(() => el.select())
  }
  // Typing marks the field as user-owned so later family changes won't overwrite it.
  const onDialogueChange = (v: string) => setPerf((p) => ({ ...p, dialogue: v, dialogueAuto: false }))
  return (
    <div>
      <p className="text-[11px] mb-3" style={{ color: C.muted }}>
        {PERF_FAMILIES.length} emotion families with intensity, asymmetry, dialogue, and delivery pacing
      </p>
      <Section id="perf-controls" title="Controls" ctl={ctl}>
        <Label>Emotion Family</Label>
        <select
          value={perf.familyIndex} onChange={(e) => changeFamily(parseInt(e.target.value, 10))}
          className="w-full rounded-md px-3 py-2 text-sm mb-4 outline-none"
          style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}
        >
          {PERF_FAMILIES.map((f, i) => <option key={f.family} value={i}>{f.family}</option>)}
        </select>

        <div className="flex items-center justify-between">
          <Label>Intensity <span style={{ color: C.blue }}>{perfLabel(PERF_FAMILIES[perf.familyIndex], perf.intensity)}</span></Label>
          <span className="text-xs tabular-nums" style={{ color: C.blue }}>{perf.intensity.toFixed(2)}</span>
        </div>
        <Slider value={perf.intensity} min={0} max={1} step={0.01} onChange={(v) => up('intensity', v)} left="contained" mid="surfacing" right="breaking" />

        <div className="flex items-center justify-between mt-4">
          <Label>Asymmetry</Label>
          <span className="text-xs tabular-nums" style={{ color: C.blue }}>{perf.asymmetry.toFixed(2)}</span>
        </div>
        <Slider value={perf.asymmetry} min={0} max={1} step={0.01} onChange={(v) => up('asymmetry', v)} left="symmetric" mid="" right="acted" />

        <div className="mt-4 mb-1 flex items-center gap-2">
          <Label>Dialogue</Label>
          {!perf.dialogue
            ? <span className="text-[10px]" style={{ color: C.faint }}>click to use the default, or type your own</span>
            : perf.dialogue.trim() ? <span className="text-[10px]" style={{ color: C.amber }}>auto-appends lip sync</span> : null}
        </div>
        <div className="relative">
          <textarea
            value={perf.dialogue} placeholder={placeholder} onClick={onDialogueClick}
            onChange={(e) => onDialogueChange(e.target.value)} rows={2}
            className="w-full rounded-md px-3 py-2 pr-7 text-sm outline-none resize-none"
            style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}
          />
          {perf.dialogue && (
            <button
              type="button" title="Clear dialogue" tabIndex={-1}
              onClick={() => setPerf((p) => ({ ...p, dialogue: '', dialogueAuto: false }))}
              className="absolute top-1.5 right-1.5 h-5 w-5 flex items-center justify-center rounded"
              style={{ color: C.faint }}
            >
              <X size={12} />
            </button>
          )}
        </div>

        <Label className="mt-4">Delivery</Label>
        <select
          value={perf.delivery} onChange={(e) => up('delivery', e.target.value as PerfDelivery)}
          className="w-full rounded-md px-3 py-2 text-sm outline-none"
          style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}
        >
          <option value="natural">Natural (let emotion set the pace)</option>
          <option value="slow">Slow (weigh each word)</option>
          <option value="halting">Halting (start, stop, search)</option>
        </select>
      </Section>

      <Section id="perf-assembled" title={`Assembled · ${perfOut.label}`} ctl={ctl}>
        <div className="space-y-1.5">
          {perfOut.layers.map((l) => (
            <div key={l.k} className="text-[11px] leading-snug">
              <span className="font-semibold" style={{ color: C.muted }}>{l.k}: </span>
              <span style={{ color: C.text }}>{l.v}</span>
            </div>
          ))}
        </div>
      </Section>
      <ActionRow text={perfOut.text} onCopy={onCopy} onInject={onInject} />

      <Section id="perf-saved" title={`Saved Performances (${savedPerfs.length})`} ctl={ctl}>
        <div className="flex gap-2 mb-3">
          <input
            value={perfName} onChange={(e) => setPerfName(e.target.value)}
            placeholder={`${PERF_FAMILIES[perf.familyIndex]?.family ?? 'Performance'} name…`}
            className="flex-1 rounded-md px-2 py-1.5 text-xs outline-none"
            style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}
          />
          <button onClick={saveCurrentPerf} className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium" style={{ background: C.blue, color: '#fff' }}>
            <Save size={13} />Save
          </button>
        </div>
        {savedPerfs.length === 0 && <p className="text-[11px]" style={{ color: C.faint }}>No saved performances yet. Name it above and Save.</p>}
        <div className="space-y-2">
          {savedPerfs.map((p) => {
            const date = new Date(p.updatedAt).toLocaleDateString()
            return (
              <div key={p.id} className="rounded-lg p-2" style={{ background: C.elev, border: `1px solid ${C.border}` }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium truncate" style={{ color: C.text }}>{p.name}</span>
                  <span className="text-[9px] tabular-nums shrink-0 ml-2" style={{ color: C.faint }}>{p.family} · {date}</span>
                </div>
                {p.dialogue && <div className="text-[10px] mt-1 leading-snug italic" style={{ color: C.muted, maxHeight: 30, overflow: 'hidden' }}>“{p.dialogue}”</div>}
                <div className="flex gap-1.5 mt-2">
                  <button onClick={() => loadPerf(p)} className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold" style={{ background: C.blue, color: '#fff' }}><RotateCcw size={11} />Load</button>
                  <button onClick={() => deletePerf(p.id)} className="flex items-center gap-1 rounded px-2 py-1 text-[10px]" style={{ background: C.card, color: C.muted, border: `1px solid ${C.border}` }}><Trash2 size={11} />Delete</button>
                </div>
              </div>
            )
          })}
        </div>
      </Section>
    </div>
  )
}

/* ---- Shot Setup ----------------------------------------------------------- */
const SHOT_RANGES: Record<'rot' | 'tilt' | 'zoom', [number, number]> = { rot: [-90, 90], tilt: [-45, 45], zoom: [1, 20] }
const clampShot = (v: number, mn: number, mx: number) => Math.max(mn, Math.min(mx, v))

function ShotPanel({
  shot, setShot, ctl, onCopy, onInject, onUseImage, flash, srcImage, setSrcImage,
}: {
  shot: ShotState; setShot: React.Dispatch<React.SetStateAction<ShotState>>
  ctl: SectionCtl; onCopy: (t: string) => void; onInject: (t: string) => void
  onUseImage: (img: GpmImage) => void; flash: (m: string) => void
  srcImage: { name: string; dataUrl: string } | null
  setSrcImage: React.Dispatch<React.SetStateAction<{ name: string; dataUrl: string } | null>>
}) {
  const shotOut = useMemo(() => buildShotPrompt(shot), [shot])
  const setSlider = (k: 'rot' | 'tilt' | 'zoom', v: number) => setShot((s) => ({ ...s, [k]: v, preset: null }))
  const nudge = (k: 'rot' | 'tilt' | 'zoom', d: number) => setSlider(k, clampShot(shot[k] + d, SHOT_RANGES[k][0], SHOT_RANGES[k][1]))
  const toggleAnchor = (id: string) => setShot((s) => ({ ...s, anchors: { ...s.anchors, [id]: !s.anchors[id] } }))
  const sliders: Array<['rot' | 'tilt' | 'zoom', string, number, number]> = [
    ['rot', 'Rotate', -90, 90], ['tilt', 'Tilt', -45, 45], ['zoom', 'Zoom', 1, 20],
  ]

  // Source frame the virtual camera reframes (lifted to the Dock so it survives enlarge/shrink).
  const [library, setLibrary] = useState<GpmImage[]>([])
  const [picker, setPicker] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => { void loadImages().then(setLibrary) }, [])

  const readFile = (file: File) => {
    const r = new FileReader()
    r.onload = () => setSrcImage({ name: file.name, dataUrl: String(r.result) })
    r.readAsDataURL(file)
  }
  const onDropImg = (e: React.DragEvent) => {
    e.preventDefault()
    const gpm = e.dataTransfer.getData(GPM_IMAGE_DND_TYPE)
    if (gpm) { const d = JSON.parse(gpm) as { name: string; dataUrl: string }; setSrcImage(d); return }
    // A Studio Assets file (FILE_DND) or an image dragged from the Create gallery ('asset'):
    // read it off disk into a data URL and use it as the shot's source frame.
    const fileRaw = e.dataTransfer.getData(FILE_DND)
    const p = fileRaw
      ? (JSON.parse(fileRaw) as LibFile).path
      : e.dataTransfer.getData('asset')
        ? (JSON.parse(e.dataTransfer.getData('asset')) as { path: string }).path
        : null
    if (p) {
      const api = window.electronAPI
      if (!api) return
      const name = p.split(/[\\/]/).pop() || 'image'
      void api.gpmLibReadAsDataUrl({ path: p }).then((r) => { if (r.success) setSrcImage({ name, dataUrl: r.dataUrl }) })
      return
    }
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) readFile(file)
  }
  const onKey = (e: React.KeyboardEvent) => {
    const map: Record<string, () => void> = {
      w: () => nudge('zoom', 1), s: () => nudge('zoom', -1),
      a: () => nudge('rot', -5), d: () => nudge('rot', 5),
      q: () => nudge('tilt', 5), e: () => nudge('tilt', -5),
    }
    const fn = map[e.key.toLowerCase()]
    if (fn) { e.preventDefault(); fn() }
  }
  const scale = 0.6 + ((shot.zoom - 1) / 19) * 2.4
  const previewTransform = `perspective(600px) rotateX(${-shot.tilt * 0.7}deg) rotateY(${shot.rot * 0.7}deg) scale(${scale.toFixed(3)})`

  const applyShot = () => {
    if (shotOut.trim()) onInject(shotOut)
    if (srcImage) onUseImage({ id: gpmId(), name: srcImage.name, folderId: null, dataUrl: srcImage.dataUrl, addedAt: Date.now(), isVideo: false })
  }
  const resetView = () => setShot((s) => ({ ...s, rot: 0, tilt: 0, zoom: 8, preset: null }))

  return (
    <div>
      <p className="text-[11px] mb-3" style={{ color: C.muted }}>
        Virtual camera composer — a transformation applied to the selected shot's existing frame.
      </p>

      <Section id="shot-source" title="Source frame & preview" ctl={ctl}>
        {!srcImage ? (
          <div
            onDragOver={(e) => e.preventDefault()} onDrop={onDropImg}
            className="rounded-md py-6 px-3 text-center"
            style={{ border: `1px dashed ${C.borderLt}`, color: C.faint }}
          >
            <ImageIcon size={20} style={{ margin: '0 auto 6px' }} />
            <div className="text-[11px] mb-2">Drag an image here (from the Images tab or a file)</div>
            <div className="flex gap-2 justify-center">
              <button onClick={() => setPicker(true)} className="rounded px-2 py-1 text-[10px]" style={{ background: C.blue, color: '#fff' }}>Pick from library</button>
              <button onClick={() => fileRef.current?.click()} className="rounded px-2 py-1 text-[10px]" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}>Upload</button>
            </div>
          </div>
        ) : (
          <>
            <div
              tabIndex={0} onKeyDown={onKey} onDragOver={(e) => e.preventDefault()} onDrop={onDropImg}
              className="relative w-full rounded-md overflow-hidden outline-none"
              style={{ aspectRatio: '16/9', background: '#000', border: `1px solid ${C.border}` }}
              title="Click here, then WASD to move · Q/E tilt"
            >
              <div className="absolute inset-0 flex items-center justify-center" style={{ perspective: '600px' }}>
                <img src={srcImage.dataUrl} alt="" draggable={false} style={{ maxWidth: '100%', maxHeight: '100%', transform: previewTransform, transition: 'transform .08s' }} />
              </div>
              <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px]" style={{ background: 'rgba(0,0,0,0.6)', color: C.muted }}>
                W/S zoom · A/D rotate · Q/E tilt
              </div>
            </div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => setPicker(true)} className="rounded px-2 py-1 text-[10px]" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}>Change</button>
              <button onClick={() => fileRef.current?.click()} className="rounded px-2 py-1 text-[10px]" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}>Upload</button>
              <button onClick={resetView} title="Reset rotate/tilt/zoom to default" className="flex items-center gap-1 rounded px-2 py-1 text-[10px]" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}><RotateCcw size={11} />Reset</button>
              <button onClick={() => setSrcImage(null)} className="rounded px-2 py-1 text-[10px]" style={{ background: C.card, color: C.muted, border: `1px solid ${C.border}` }}>Remove</button>
            </div>
          </>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) readFile(f) }} />
      </Section>

      <Section id="shot-presets" title="Presets" ctl={ctl}>
        <div className="grid grid-cols-4 gap-1.5">
          {SHOT_PRESETS.map((p) => {
            const active = shot.preset?.name === p.name
            return (
              <button
                key={p.name}
                onClick={() => setShot({ rot: p.rot, tilt: p.tilt, zoom: p.zoom, preset: p, anchors: shot.anchors })}
                className="rounded-md py-1.5 text-[10px] flex flex-col items-center gap-0.5"
                style={{ background: active ? C.blue : C.elev, color: active ? '#fff' : C.muted, border: `1px solid ${active ? C.blue : C.border}` }}
              >
                <span style={{ fontSize: 13 }}>{p.icon}</span>{p.name}
              </button>
            )
          })}
        </div>
      </Section>
      <Section
        id="shot-camera" title="Camera" ctl={ctl}
        right={<span onClick={(e) => { e.stopPropagation(); resetView() }} className="flex items-center gap-1 text-[10px]" style={{ color: C.muted }}><RotateCcw size={11} />Reset</span>}
      >
        {sliders.map(([k, lbl, mn, mx]) => (
          <div key={k} className="mb-3">
            <div className="flex justify-between"><Label>{lbl}</Label><span className="text-xs tabular-nums" style={{ color: C.blue }}>{shot[k]}</span></div>
            <Slider value={shot[k]} min={mn} max={mx} step={1} onChange={(v) => setSlider(k, v)} left={mn} mid="" right={mx} />
          </div>
        ))}
      </Section>
      <Section id="shot-anchors" title="Consistency anchors" ctl={ctl}>
        <div className="flex flex-wrap gap-1.5">
          {SHOT_ANCHORS.map((a) => {
            const on = !!shot.anchors[a.id]
            return (
              <button
                key={a.id} onClick={() => toggleAnchor(a.id)}
                className="rounded-full px-2.5 py-1 text-[10px]"
                style={{ background: on ? 'rgb(var(--accent) / 0.15)' : C.elev, color: on ? C.blue : C.muted, border: `1px solid ${on ? C.blue : C.border}` }}
              >
                {a.label}
              </button>
            )
          })}
        </div>
      </Section>
      <div className="rounded-lg p-3 text-[11px] leading-snug" style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text }}>
        {shotOut}
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <button
          onClick={() => onCopy(shotOut)} disabled={!shotOut.trim()}
          className="flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-40"
          style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}
        >
          <Copy size={13} />Copy prompt
        </button>
        <button
          onClick={applyShot} disabled={!shotOut.trim()}
          title={srcImage ? 'Inject the shot prompt and send the source image to Create' : 'Inject the shot prompt'}
          className="flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-40"
          style={{ background: C.green, color: '#fff' }}
        >
          <Send size={13} />{srcImage ? 'Apply + image' : 'Inject into prompt'}
        </button>
      </div>

      {picker && (
        <ImagePicker library={library} onPick={(img) => { setSrcImage({ name: img.name, dataUrl: img.dataUrl }); setPicker(false); flash('Source frame set') }} onClose={() => setPicker(false)} />
      )}
    </div>
  )
}

/* ---- Camera techniques ---------------------------------------------------- */
function CameraPanel({
  search, setSearch, camCat, setCamCat, onInject, flash,
}: {
  search: string; setSearch: (v: string) => void
  camCat: 'All' | CameraCategory; setCamCat: (c: 'All' | CameraCategory) => void
  onInject: (t: string) => void; flash: (m: string) => void
}) {
  const cards = useMemo(() => filterCameraCards(camCat, search), [camCat, search])
  return (
    <div>
      <SearchBar value={search} onChange={setSearch} placeholder="Search camera techniques…" />
      <div className="flex flex-wrap gap-1.5 my-3">
        {CAM_CATS.map((cat) => {
          const active = camCat === cat
          return (
            <button
              key={cat} onClick={() => setCamCat(cat)}
              className="rounded-full px-2.5 py-1 text-[10px]"
              style={{ background: active ? C.blue : C.card, color: active ? '#fff' : C.muted, border: `1px solid ${active ? C.blue : C.border}` }}
            >
              {cat}
            </button>
          )
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {cards.map((c) => {
          const url = camImageUrl(c.image)
          return (
            <button
              key={c.id}
              onClick={() => { onInject(c.phrase); flash(`Injected "${c.label}"`) }}
              title={c.phrase}
              className="rounded-lg overflow-hidden text-left transition-transform hover:scale-[1.02]"
              style={{ border: `1px solid ${C.border}`, background: C.card }}
            >
              <div style={{ aspectRatio: '4/3', background: (url || c.svg) ? '#0f1117' : 'linear-gradient(135deg, #2b2620, #14110d)' }} className="relative flex items-end p-2 overflow-hidden">
                {url
                  ? <img src={url} alt={c.label} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                  : c.svg
                    ? <div className="absolute inset-0" dangerouslySetInnerHTML={{ __html: c.svg }} />
                    : <Camera size={14} style={{ color: C.amber, opacity: 0.7 }} />}
              </div>
              <div className="px-2 py-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.text }}>{c.label}</div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ---- Workflow ------------------------------------------------------------- */
function WorkflowPanel({
  wf, setWf, perfText, ctl, onCopy, onInject, onUseImage, flash,
}: {
  wf: WfState; setWf: React.Dispatch<React.SetStateAction<WfState>>; perfText: string
  ctl: SectionCtl; onCopy: (t: string) => void; onInject: (t: string) => void
  onUseImage: (img: GpmImage) => void; flash: (m: string) => void
}) {
  const wfOut = useMemo(() => buildWorkflowPrompt(wf, perfText), [wf, perfText])
  const upSlot = (id: string, patch: Partial<WfState['slots'][number]>) =>
    setWf((w) => ({ ...w, slots: w.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  const addSlot = () =>
    setWf((w) => ({ ...w, slots: [...w.slots, { id: 's' + Date.now(), role: 'general', note: '', filled: false }] }))
  const up = <K extends keyof WfState>(k: K, v: WfState[K]) => setWf((w) => ({ ...w, [k]: v }))
  const filledCount = wf.slots.filter((s) => s.filled).length

  // Bind reference images from the Images library to slots.
  const [library, setLibrary] = useState<GpmImage[]>([])
  useEffect(() => { void loadImages().then(setLibrary) }, [])
  const imgById = useMemo(() => {
    const m: Record<string, GpmImage> = {}
    for (const im of library) m[im.id] = im
    return m
  }, [library])
  const [pickerSlot, setPickerSlot] = useState<string | null>(null)
  const bindImage = (slotId: string, img: GpmImage) => {
    upSlot(slotId, { imgId: img.id, imgName: img.name, filled: true })
    setPickerSlot(null)
  }
  const unbindImage = (slotId: string) => upSlot(slotId, { imgId: undefined, imgName: undefined, filled: false })

  // Drag a reference image straight onto a slot — from the Images tab (already
  // in the library, so just bind by id) or the Downloads Browser (a real file,
  // so add it to the library first, mirroring ImagesPanel's addFromLibFile).
  const onSlotDrop = (e: React.DragEvent, slotId: string) => {
    e.preventDefault()
    const gpmRaw = e.dataTransfer.getData(GPM_IMAGE_DND_TYPE)
    if (gpmRaw) {
      const d = JSON.parse(gpmRaw) as GpmDndImage
      if (d.id && imgById[d.id]) { bindImage(slotId, imgById[d.id]); return }
      const img: GpmImage = { id: gpmId(), name: d.name, folderId: null, dataUrl: d.dataUrl, addedAt: Date.now(), isVideo: false }
      void putImage(img).then(() => { setLibrary((prev) => [img, ...prev]); bindImage(slotId, img) })
      return
    }
    const fileRaw = e.dataTransfer.getData(FILE_DND)
    if (fileRaw) {
      const f = JSON.parse(fileRaw) as LibFile
      const api = window.electronAPI
      if (!api) return
      void api.gpmLibReadAsDataUrl({ path: f.path }).then((r) => {
        if (!r.success) return
        const img: GpmImage = { id: gpmId(), name: f.name, folderId: null, dataUrl: r.dataUrl, addedAt: Date.now(), isVideo: f.isVideo }
        void putImage(img).then(() => { setLibrary((prev) => [img, ...prev]); bindImage(slotId, img) })
      })
      return
    }
    // An image dragged straight from the Create gallery (work-area canvas): read it off
    // disk, add it to the library, then bind it to the slot — same as the Downloads path.
    const assetRaw = e.dataTransfer.getData('asset')
    if (assetRaw) {
      const a = JSON.parse(assetRaw) as { path: string; type?: string }
      const api = window.electronAPI
      if (!api) return
      const name = a.path.split(/[\\/]/).pop() || 'image'
      void api.gpmLibReadAsDataUrl({ path: a.path }).then((r) => {
        if (!r.success) return
        const img: GpmImage = { id: gpmId(), name, folderId: null, dataUrl: r.dataUrl, addedAt: Date.now(), isVideo: a.type === 'video' }
        void putImage(img).then(() => { setLibrary((prev) => [img, ...prev]); bindImage(slotId, img) })
      })
    }
  }

  // Saved workflows (persisted in IndexedDB; round-trips in the backup).
  const [saved, setSaved] = useState<GpmWorkflow[]>([])
  const reloadSaved = () => { void loadWorkflows().then(setSaved) }
  useEffect(reloadSaved, [])
  const persistSaved = (list: GpmWorkflow[]) => { setSaved(list); void saveWorkflows(list) }
  const saveCurrent = () => {
    const name = wf.name.trim() || 'Untitled Workflow'
    const rec: GpmWorkflow = {
      id: gpmId(), name, updatedAt: Date.now(),
      slots: wf.slots, directive: wf.directive, aspectRatio: wf.aspectRatio,
      motionHint: wf.motionHint, performance: wf.performance,
    }
    persistSaved([rec, ...saved])
    flash(`Saved "${name}"`)
  }
  const loadSaved = (w: GpmWorkflow) => {
    setWf({
      name: w.name,
      slots: w.slots.map((s) => ({ id: s.id, role: s.role as WfRole, note: s.note, filled: s.filled, imgId: s.imgId, imgName: s.imgName })),
      directive: w.directive, aspectRatio: w.aspectRatio, motionHint: w.motionHint,
      performance: { enabled: w.performance.enabled },
    })
    flash(`Loaded "${w.name}"`)
  }
  const deleteSaved = (id: string) => persistSaved(saved.filter((w) => w.id !== id))

  // Bound images, in slot order. LTX's Gen Space takes a single input image,
  // so Inject sends the first bound image (and notes if there are more).
  const boundImages = wf.slots
    .filter((s): s is typeof s & { imgId: string } => !!s.imgId && !!imgById[s.imgId])
    .map((s) => imgById[s.imgId])
  const injectWorkflow = () => {
    if (wfOut.trim()) onInject(wfOut)
    if (boundImages.length > 0) {
      onUseImage(boundImages[0])
      if (boundImages.length > 1) flash(`Sent 1st of ${boundImages.length} images (LTX takes one input image)`)
    }
  }

  return (
    <div>
      <p className="text-[11px] mb-3" style={{ color: C.muted }}>
        Multi-reference assembly — each slot binds an image to a role as <Chip>@imageN</Chip>.
      </p>
      <Section
        id="wf-slots" title={`Reference slots (${filledCount} filled)`} ctl={ctl}
        right={
          <span onClick={(e) => { e.stopPropagation(); addSlot() }} className="flex items-center gap-1 text-[10px]" style={{ color: C.blue }}>
            <Plus size={11} /> Add
          </span>
        }
      >
        <div className="space-y-2">
          {wf.slots.map((s, i) => (
            <div key={s.id} className="rounded-lg p-2 flex gap-2 items-center" style={{ background: C.elev, border: `1px solid ${C.border}` }}>
              <div
                className="relative w-28 shrink-0"
                onDragOver={(e) => { if (e.dataTransfer.types.includes(GPM_IMAGE_DND_TYPE) || e.dataTransfer.types.includes(FILE_DND) || e.dataTransfer.types.includes('asset')) e.preventDefault() }}
                onDrop={(e) => onSlotDrop(e, s.id)}
              >
                <button
                  onClick={() => setPickerSlot(s.id)}
                  title={s.imgName ? `Bound: ${s.imgName} — click to change (or drag an image here)` : 'Bind a reference image (click, or drag one here)'}
                  className="w-full rounded flex items-center justify-center overflow-hidden text-[8px] text-center"
                  style={{ aspectRatio: '16/9', background: s.imgId ? '#000' : 'transparent', border: `1px dashed ${s.imgId ? C.border : C.borderLt}`, color: C.faint }}
                >
                  {s.imgId && imgById[s.imgId]
                    ? (imgById[s.imgId].isVideo
                        ? <video src={imgById[s.imgId].dataUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                        : <img src={imgById[s.imgId].dataUrl} alt="" className="w-full h-full object-cover" />)
                    : <ImageIcon size={15} style={{ color: C.faint }} />}
                </button>
                {s.imgId && (
                  <button
                    onClick={() => unbindImage(s.id)} title="Unbind image"
                    className="absolute -top-1.5 -right-1.5 h-4 w-4 flex items-center justify-center rounded-full"
                    style={{ background: C.card, border: `1px solid ${C.border}`, color: C.muted }}
                  >
                    <X size={9} />
                  </button>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[9px] px-1.5 py-0.5 rounded tabular-nums" style={{ background: C.card, color: C.blue }}>@image{i + 1}</span>
                  <select
                    value={s.role} onChange={(e) => upSlot(s.id, { role: e.target.value as WfRole })}
                    className="flex-1 rounded px-1.5 py-1 text-[11px] outline-none"
                    style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}
                  >
                    {WF_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <input
                  value={s.note} onChange={(e) => upSlot(s.id, { note: e.target.value })} placeholder="note (e.g. STORM)"
                  className="w-full rounded px-2 py-1 text-[11px] outline-none"
                  style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="wf-directive" title="Directive & output" ctl={ctl}>
        <Label>Directive</Label>
        <textarea
          value={wf.directive} onChange={(e) => up('directive', e.target.value)} rows={2}
          className="w-full rounded-md px-3 py-2 text-sm outline-none resize-none mb-3"
          style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}
        />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Aspect</Label>
            <select
              value={wf.aspectRatio} onChange={(e) => up('aspectRatio', e.target.value)}
              className="w-full rounded-md px-2 py-1.5 text-xs outline-none"
              style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}
            >
              {['16:9', '9:16', '1:1', '2.39:1'].map((a) => <option key={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <Label>Motion hint</Label>
            <input
              value={wf.motionHint} onChange={(e) => up('motionHint', e.target.value)}
              className="w-full rounded-md px-2 py-1.5 text-xs outline-none"
              style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}
            />
          </div>
        </div>
      </Section>

      <Section id="wf-perf" title="Performance (embedded)" ctl={ctl}>
        <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: C.text }}>
          <input
            type="checkbox" checked={wf.performance.enabled}
            onChange={(e) => setWf((w) => ({ ...w, performance: { enabled: e.target.checked } }))}
            style={{ accentColor: C.blue }}
          />
          Append the current Performance Studio prompt to this workflow
        </label>
      </Section>

      <Section id="wf-saved" title={`Saved Workflows (${saved.length})`} ctl={ctl}>
        <div className="flex gap-2 mb-3">
          <input
            value={wf.name} onChange={(e) => up('name', e.target.value)} placeholder="Workflow name…"
            className="flex-1 rounded-md px-2 py-1.5 text-xs outline-none"
            style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}
          />
          <button onClick={saveCurrent} className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium" style={{ background: C.blue, color: '#fff' }}>
            <Save size={13} />Save
          </button>
        </div>
        {saved.length === 0 && <p className="text-[11px]" style={{ color: C.faint }}>No saved workflows yet. Name it above and Save.</p>}
        <div className="space-y-2">
          {saved.map((w) => {
            const filled = w.slots.filter((s) => s.filled).length
            const date = new Date(w.updatedAt).toLocaleDateString()
            return (
              <div key={w.id} className="rounded-lg p-2" style={{ background: C.elev, border: `1px solid ${C.border}` }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium truncate" style={{ color: C.text }}>{w.name}</span>
                  <span className="text-[9px] tabular-nums shrink-0 ml-2" style={{ color: C.faint }}>{filled} img · {date}</span>
                </div>
                {w.directive && <div className="text-[10px] mt-1 leading-snug" style={{ color: C.muted, maxHeight: 30, overflow: 'hidden' }}>{w.directive}</div>}
                <div className="flex gap-1.5 mt-2">
                  <button onClick={() => loadSaved(w)} className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold" style={{ background: C.blue, color: '#fff' }}><RotateCcw size={11} />Load</button>
                  <button onClick={() => deleteSaved(w.id)} className="flex items-center gap-1 rounded px-2 py-1 text-[10px]" style={{ background: C.card, color: C.muted, border: `1px solid ${C.border}` }}><Trash2 size={11} />Delete</button>
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      <div className="rounded-lg p-3 text-[11px] leading-snug" style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text, minHeight: 44 }}>
        {wfOut || <span style={{ color: C.faint }}>Fill a slot or write a directive to assemble the prompt…</span>}
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <button
          onClick={() => onCopy(wfOut)} disabled={!wfOut.trim()}
          className="flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-40"
          style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}
        >
          <Copy size={13} />Copy prompt
        </button>
        <button
          onClick={injectWorkflow} disabled={!wfOut.trim() && boundImages.length === 0}
          title="Inject the prompt and send the first bound image to Create"
          className="flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-40"
          style={{ background: C.green, color: '#fff' }}
        >
          <Send size={13} />{boundImages.length > 0 ? `Inject + ${boundImages.length} img` : 'Inject into prompt'}
        </button>
      </div>

      {pickerSlot && (
        <ImagePicker library={library} onPick={(img) => bindImage(pickerSlot, img)} onClose={() => setPickerSlot(null)} />
      )}
    </div>
  )
}

/* Image library picker overlay for binding a reference image to a slot. */
function ImagePicker({ library, onPick, onClose }: { library: GpmImage[]; onPick: (img: GpmImage) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const items = library.filter((im) => !q || im.name.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl flex flex-col overflow-hidden"
        style={{ maxHeight: '80%', background: C.panel, border: `1px solid ${C.borderLt}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
          <span className="text-sm font-semibold" style={{ color: C.text }}>Bind reference image</span>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-md" style={{ color: C.muted }}><X size={16} /></button>
        </div>
        <div className="p-3"><SearchBar value={q} onChange={setQ} placeholder="Search images…" /></div>
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {items.length === 0
            ? <p className="text-[11px] text-center py-8" style={{ color: C.faint }}>No images in the library. Add some in the Images tab.</p>
            : (
              <div className="grid grid-cols-3 gap-2">
                {items.map((im) => (
                  <button
                    key={im.id} onClick={() => onPick(im)} title={im.name}
                    className="rounded-md overflow-hidden" style={{ aspectRatio: '16/9', background: '#000', border: `1px solid ${C.border}` }}
                  >
                    {im.isVideo
                      ? <video src={im.dataUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                      : <img src={im.dataUrl} alt={im.name} className="w-full h-full object-cover" />}
                  </button>
                ))}
              </div>
            )}
        </div>
      </div>
    </div>
  )
}

/* ---- 3D Scene Builder (panorama viewer in an iframe) --------------------- */
const SCENE_LENSES = ['12mm', '24mm', '35mm', '50mm', '85mm']
function SceneViewer({ pano, onPlate, onClose, lens, setLens, aimRef }: {
  pano: GpmPanorama; onPlate: (dataUrl: string, name: string) => void; onClose: () => void
  lens: string; setLens: (l: string) => void
  aimRef: React.MutableRefObject<{ yaw: number; pitch: number }>
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [ready, setReady] = useState(false)
  const reqId = useRef(0)
  const post = (msg: Record<string, unknown>) => iframeRef.current?.contentWindow?.postMessage(msg, '*')

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data as { type?: string; dataUrl?: string; yaw?: number; pitch?: number }
      if (!m || typeof m.type !== 'string' || !m.type.startsWith('gpm-scene-')) return
      if (m.type === 'gpm-scene-ready') {
        setReady(true)
        const w = iframeRef.current?.contentWindow
        w?.postMessage({ type: 'gpm-scene-load', dataUrl: pano.dataUrl }, '*')
        w?.postMessage({ type: 'gpm-scene-set-lens', lens }, '*')
        w?.postMessage({ type: 'gpm-scene-set-aim', yaw: aimRef.current.yaw, pitch: aimRef.current.pitch }, '*')
      } else if (m.type === 'gpm-scene-aim') {
        if (typeof m.yaw === 'number' && typeof m.pitch === 'number') aimRef.current = { yaw: m.yaw, pitch: m.pitch }
      } else if (m.type === 'gpm-scene-captured' && m.dataUrl) {
        onPlate(m.dataUrl, pano.name)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [pano, onPlate, lens, aimRef])
  useEffect(() => { if (ready) post({ type: 'gpm-scene-set-lens', lens }) }, [lens, ready])
  const resetAim = () => { aimRef.current = { yaw: 0, pitch: 0 }; post({ type: 'gpm-scene-reset-aim' }) }

  const src = `${import.meta.env.BASE_URL}gpm-scene/viewer.html`
  return (
    <div className="rounded-lg overflow-hidden mb-3" style={{ border: `1px solid ${C.blue}` }}>
      <div className="flex items-center justify-between px-2 py-1.5" style={{ background: C.card }}>
        <span className="text-[11px] font-semibold truncate" style={{ color: C.text }}>🎬 {pano.name}</span>
        <button onClick={onClose} className="h-6 w-6 flex items-center justify-center rounded" style={{ color: C.muted }} title="Close viewer"><X size={14} /></button>
      </div>
      <iframe ref={iframeRef} src={src} title="Scene viewer" style={{ width: '100%', aspectRatio: '16/9', border: 'none', background: '#000', display: 'block' }} />
      <div className="flex items-center gap-2 px-2 py-2" style={{ background: C.card }}>
        <span className="text-[10px]" style={{ color: C.muted }}>Lens</span>
        <select value={lens} onChange={(e) => setLens(e.target.value)} className="rounded px-1.5 py-1 text-[11px] outline-none" style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}>
          {SCENE_LENSES.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <button onClick={resetAim} className="flex items-center gap-1 rounded px-2 py-1 text-[10px]" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}><RotateCcw size={11} />Reset aim</button>
        <button onClick={() => post({ type: 'gpm-scene-capture', requestId: ++reqId.current, width: 1280, height: 720 })} disabled={!ready} className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold ml-auto disabled:opacity-40" style={{ background: C.green, color: '#fff' }}><Camera size={11} />Generate plate</button>
      </div>
      <div className="px-2 pb-2 text-[10px]" style={{ background: C.card, color: C.faint }}>Drag to look around · pick a lens · "Generate plate" sends the framed 1280×720 view to Create.</div>
    </div>
  )
}

/* ---- Plates (panorama library) ------------------------------------------- */
function PlatesPanel({ onUse, flash, activeId, setActiveId, sceneLens, setSceneLens, sceneAimRef }: {
  onUse: (img: GpmImage) => void; flash: (m: string) => void
  activeId: string | null; setActiveId: React.Dispatch<React.SetStateAction<string | null>>
  sceneLens: string; setSceneLens: (l: string) => void
  sceneAimRef: React.MutableRefObject<{ yaw: number; pitch: number }>
}) {
  const [panos, setPanos] = useState<GpmPanorama[]>([])
  const [dragActive, setDragActive] = useState(false)
  const openScene = (id: string) => { if (id !== activeId) sceneAimRef.current = { yaw: 0, pitch: 0 }; setActiveId(id) }
  const fileRef = useRef<HTMLInputElement | null>(null)
  const reload = () => { void loadPanoramas().then(setPanos) }
  useEffect(reload, [])

  const readDataUrl = (file: File) => new Promise<string>((res, rej) => {
    const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(file)
  })
  // Returns the new panorama's id (or null if the cap was hit), so a drop can open
  // it in the 3D viewer immediately instead of leaving the user to hunt for it.
  const addOne = async (name: string, dataUrl: string): Promise<string | null> => {
    const existing = await loadPanoramas()
    if (existing.length >= MAX_PANORAMAS) { flash(`Max ${MAX_PANORAMAS} panoramas reached`); return null }
    const id = gpmId()
    await putPanorama({ id, name, dataUrl, addedAt: Date.now() })
    return id
  }
  const addFiles = async (files: File[]) => {
    let n = 0
    let lastId: string | null = null
    for (const f of files) { if (!f.type.startsWith('image/')) continue; const id = await addOne(f.name, await readDataUrl(f)); if (id) { lastId = id; n++ } else break }
    if (n) { reload(); flash(`Added ${n} panorama${n !== 1 ? 's' : ''}`); if (lastId) openScene(lastId) }
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragActive(false)
    const gpm = e.dataTransfer.getData(GPM_IMAGE_DND_TYPE)
    if (gpm) { const d = JSON.parse(gpm) as { name: string; dataUrl: string }; void addOne(d.name, d.dataUrl).then((id) => { if (id) { reload(); flash('Panorama saved'); openScene(id) } }); return }
    // A Studio Assets file (FILE_DND) or an image dragged from the Create gallery ('asset'):
    // read it off disk and save it as a panorama, same as the Images-tab drop.
    const fileRaw = e.dataTransfer.getData(FILE_DND)
    const p = fileRaw
      ? (JSON.parse(fileRaw) as LibFile).path
      : e.dataTransfer.getData('asset')
        ? (JSON.parse(e.dataTransfer.getData('asset')) as { path: string }).path
        : null
    if (p) {
      const api = window.electronAPI
      if (!api) return
      const name = p.split(/[\\/]/).pop() || 'panorama'
      void api.gpmLibReadAsDataUrl({ path: p }).then((r) => {
        if (r.success) void addOne(name, r.dataUrl).then((id) => { if (id) { reload(); flash('Panorama saved'); openScene(id) } })
      })
      return
    }
    void addFiles(Array.from(e.dataTransfer.files ?? []))
  }
  const remove = (id: string) => { if (id === activeId) setActiveId(null); void deletePanorama(id).then(reload) }
  const active = panos.find((p) => p.id === activeId) ?? null
  const onPlate = (dataUrl: string, name: string) => {
    onUse({ id: gpmId(), name: `plate-${name}`, folderId: null, dataUrl, addedAt: Date.now(), isVideo: false })
    flash('Plate sent to Create')
  }

  return (
    <div>
      <div className="rounded-lg p-3 mb-3 text-center" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <Layers size={22} style={{ color: C.blue, margin: '0 auto 6px' }} />
        <div className="text-sm font-semibold mb-1" style={{ color: C.blue }}>Background Plate Builder</div>
        <p className="text-[11px]" style={{ color: C.muted }}>
          Import an equirectangular panorama, open it in 3D, aim the virtual camera, and generate clean
          background plates. Composite characters in via the Workflow Builder.
        </p>
      </div>

      {active && <SceneViewer key={active.id} pano={active} onClose={() => setActiveId(null)} onPlate={onPlate} lens={sceneLens} setLens={setSceneLens} aimRef={sceneAimRef} />}

      <div onDragOver={(e) => { e.preventDefault(); if (!dragActive) setDragActive(true) }} onDragLeave={() => setDragActive(false)} onDrop={onDrop}>
        <div className="flex items-center justify-between mb-2">
          <Label>Panoramas</Label>
          <span className="text-[10px] tabular-nums" style={{ color: C.faint }}>{panos.length}/{MAX_PANORAMAS}</span>
        </div>
        <button onClick={() => fileRef.current?.click()} className="w-full flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold mb-2" style={{ background: C.blue, color: '#fff' }}>
          <Upload size={13} />Import Panorama
        </button>
        <div
          className="rounded-md py-6 px-3 text-center text-xs font-medium mb-3 transition-colors"
          style={{
            border: `2px dashed ${dragActive ? C.blue : C.borderLt}`,
            background: dragActive ? 'rgb(var(--accent) / 0.14)' : 'transparent',
            color: dragActive ? C.blue : C.muted,
          }}
        >
          {dragActive ? 'Release to save as a panorama' : 'Drop an image here — from the Create gallery, Studio Assets, or the Images tab — to save as a panorama'}
        </div>

        {panos.length === 0
          ? <p className="text-[11px] text-center py-4" style={{ color: C.faint }}>No panoramas yet — import one to begin.</p>
          : (
            <div className="space-y-2">
              {panos.map((p) => (
                <div key={p.id} className="rounded-md overflow-hidden relative group" style={{ border: `1px solid ${p.id === activeId ? C.blue : C.border}`, background: '#000' }} title={p.name}>
                  <button onClick={() => openScene(p.id)} className="block w-full" title="Open in 3D scene">
                    <img src={p.dataUrl} alt={p.name} loading="lazy" style={{ width: '100%', aspectRatio: '2/1', objectFit: 'cover', display: 'block' }} />
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 px-2 py-1 text-[10px] truncate pointer-events-none" style={{ background: 'rgba(0,0,0,0.6)', color: C.text }}>{p.name}</div>
                  <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openScene(p.id)} title="Open in 3D scene" className="h-5 px-1.5 flex items-center justify-center rounded text-[9px] font-semibold" style={{ background: C.blue, color: '#fff' }}>3D</button>
                    <button onClick={() => remove(p.id)} title="Delete" className="h-5 w-5 flex items-center justify-center rounded" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}><Trash2 size={11} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; void addFiles(fs) }} />
    </div>
  )
}

/* ---- Backup (import / export) shared row --------------------------------- */
function BackupRow({ onAfterImport, flash }: { onAfterImport: () => void; flash: (m: string) => void }) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const doExport = async () => {
    try {
      const data = await exportBackup()
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url; a.download = `gpm-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click(); URL.revokeObjectURL(url)
      flash('Backup exported')
    } catch { flash('Export failed') }
  }
  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    if (!window.confirm('Import will REPLACE your current Prompt Manager Pro library. Continue?')) return
    try {
      const r = await importBackup(parseBackup(await file.text()))
      onAfterImport()
      flash(`Imported ${r.promptFolders} folders · ${r.prompts} prompts · ${r.images} images · ${r.workflows} workflows`)
    } catch (err) { flash('Import failed: ' + (err instanceof Error ? err.message : 'bad file')) }
  }
  return (
    <div className="flex gap-2 mb-3">
      <button onClick={() => fileRef.current?.click()} className="flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px]" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}>
        <Upload size={12} />Import / Restore
      </button>
      <button onClick={doExport} className="flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px]" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}>
        <Download size={12} />Export / Backup
      </button>
      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onPick} />
    </div>
  )
}

/* ---- Prompts (folders + cards) ------------------------------------------- */

// Downscale a (possibly large) image data URL into a compact JPEG thumbnail so
// the per-prompt visual cue stays light in IndexedDB. Falls back to the original
// data URL if the image can't be decoded.
function downscaleToThumb(dataUrl: string, maxW = 360): Promise<string> {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.onload = () => {
      try {
        const scale = Math.min(1, maxW / (img.naturalWidth || maxW))
        const w = Math.max(1, Math.round((img.naturalWidth || maxW) * scale))
        const h = Math.max(1, Math.round((img.naturalHeight || maxW) * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(dataUrl); return }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

// Pull an image data URL out of a drop from any of the app's drag sources:
// a Prompt Manager Pro image (carries its own data URL), a Studio Assets /
// Downloads Browser file, a Create-gallery asset, or an OS file drop.
async function dataUrlFromImageDrop(e: React.DragEvent): Promise<string | null> {
  const gpm = e.dataTransfer.getData(GPM_IMAGE_DND_TYPE)
  if (gpm) { const d = JSON.parse(gpm) as GpmDndImage; return d.dataUrl }
  const fileRaw = e.dataTransfer.getData(FILE_DND)
  const assetRaw = fileRaw ? '' : e.dataTransfer.getData('asset')
  const path = fileRaw
    ? (JSON.parse(fileRaw) as LibFile).path
    : assetRaw
      ? (JSON.parse(assetRaw) as { path: string; type?: string }).path
      : null
  if (path) {
    const r = await window.electronAPI?.gpmLibReadAsDataUrl?.({ path })
    return r?.success ? r.dataUrl : null
  }
  const file = e.dataTransfer.files?.[0]
  if (file?.type.startsWith('image/')) {
    return await new Promise<string>((res, rej) => {
      const reader = new FileReader()
      reader.onload = () => res(String(reader.result)); reader.onerror = () => rej(reader.error)
      reader.readAsDataURL(file)
    })
  }
  return null
}

function PromptsPanel({
  ctl, onCopy, onInject, flash, wide = false,
}: { ctl: SectionCtl; onCopy: (t: string) => void; onInject: (t: string) => void; flash: (m: string) => void; wide?: boolean }) {
  const [folders, setFolders] = useState<GpmPromptFolder[]>([])
  const [search, setSearch] = useState('')
  const [newFolder, setNewFolder] = useState('')
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const dragFolder = useRef<string | null>(null)
  const [dropLine, setDropLine] = useState<{ target: string; before: boolean } | null>(null)

  const reload = () => {
    void loadPromptFolders().then(setFolders)
    void loadAllPromptThumbs().then(setThumbs)
  }
  useEffect(reload, [])

  const persist = (next: GpmPromptFolder[]) => { setFolders(next); void savePromptFolders(next) }
  const addFolder = () => { const n = newFolder.trim(); if (!n) return; persist([{ id: gpmId(), name: n, prompts: [] }, ...folders]); setNewFolder('') }
  const commitRename = (id: string) => { const n = renameVal.trim(); if (n) persist(folders.map((f) => (f.id === id ? { ...f, name: n } : f))); setRenameId(null) }
  const deleteFolder = (id: string) => { if (window.confirm('Delete this folder and all its prompts?')) persist(folders.filter((f) => f.id !== id)) }
  const addPrompt = (fid: string) => { const p = { id: gpmId(), text: '' }; persist(folders.map((f) => (f.id === fid ? { ...f, prompts: [p, ...f.prompts] } : f))); setEditId(p.id); setDraft('') }
  const savePrompt = (fid: string, pid: string) => { persist(folders.map((f) => (f.id === fid ? { ...f, prompts: f.prompts.map((p) => (p.id === pid ? { ...p, text: draft } : p)) } : f))); setEditId(null); flash('Saved') }
  const deletePrompt = (fid: string, pid: string) => {
    persist(folders.map((f) => (f.id === fid ? { ...f, prompts: f.prompts.filter((p) => p.id !== pid) } : f)))
    if (thumbs[pid]) { void deletePromptThumb(pid); setThumbs((t) => { const n = { ...t }; delete n[pid]; return n }) }
  }

  // Drag an image onto a prompt card to attach it as a visual cue (thumbnail).
  // Accepts every app drag source; the image is downscaled before it's stored.
  const [dragThumbId, setDragThumbId] = useState<string | null>(null)
  const onPromptImageDrop = async (e: React.DragEvent, pid: string) => {
    e.preventDefault()
    setDragThumbId(null)
    try {
      const dataUrl = await dataUrlFromImageDrop(e)
      if (!dataUrl) return
      const thumb = await downscaleToThumb(dataUrl)
      await setPromptThumb(pid, thumb)
      setThumbs((t) => ({ ...t, [pid]: thumb }))
      flash('Visual cue attached')
    } catch {
      flash('Could not attach image')
    }
  }
  const removeThumb = (pid: string) => {
    void deletePromptThumb(pid)
    setThumbs((t) => { const n = { ...t }; delete n[pid]; return n })
  }
  const dropTypes = (e: React.DragEvent) =>
    e.dataTransfer.types.includes(GPM_IMAGE_DND_TYPE) ||
    e.dataTransfer.types.includes(FILE_DND) ||
    e.dataTransfer.types.includes('asset') ||
    e.dataTransfer.types.includes('Files')
  // Drag-reorder folders, with a blue drop-line indicator like the Studio Assets panel.
  const onFolderDrop = (target: string, before: boolean) => {
    const dragged = dragFolder.current
    dragFolder.current = null
    setDropLine(null)
    if (!dragged || dragged === target) return
    const order = folders.filter((f) => f.id !== dragged)
    const draggedFolder = folders.find((f) => f.id === dragged)
    if (!draggedFolder) return
    let idx = order.findIndex((f) => f.id === target)
    if (!before) idx += 1
    order.splice(idx, 0, draggedFolder)
    persist(order)
  }

  const q = search.trim().toLowerCase()
  return (
    <div>
      <BackupRow onAfterImport={reload} flash={flash} />
      <SearchBar value={search} onChange={setSearch} placeholder="Search prompts…" />
      <div className="flex gap-2 my-3">
        <input
          value={newFolder} onChange={(e) => setNewFolder(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addFolder() }}
          placeholder="New folder name…" className="flex-1 rounded-md px-2 py-1.5 text-xs outline-none"
          style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}
        />
        <button onClick={addFolder} className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium" style={{ background: C.blue, color: '#fff' }}>
          <FolderPlus size={13} />Add
        </button>
      </div>
      {folders.length === 0 && <p className="text-[11px] text-center py-6" style={{ color: C.faint }}>No folders yet. Create one or Import a backup.</p>}
      {folders.map((f) => {
        const cards = f.prompts.filter((p) => !q || p.text.toLowerCase().includes(q))
        if (q && cards.length === 0) return null
        return (
          <Section
            key={f.id} id={`pf-${f.id}`} ctl={ctl} title={`${f.name} (${f.prompts.length})`}
            dragHandle={{
              onDragStart: (e) => { dragFolder.current = f.id; e.dataTransfer.setData(PROMPT_FOLDER_DND, f.id); e.dataTransfer.effectAllowed = 'move' },
              onDragEnd: () => { dragFolder.current = null; setDropLine(null) },
            }}
            dropLine={dropLine?.target === f.id ? (dropLine.before ? 'before' : 'after') : null}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(PROMPT_FOLDER_DND)) return
              e.preventDefault()
              if (dragFolder.current && dragFolder.current !== f.id) {
                const r = e.currentTarget.getBoundingClientRect()
                const before = e.clientY - r.top < r.height / 2
                setDropLine({ target: f.id, before })
              }
            }}
            onDragLeave={() => setDropLine((d) => (d?.target === f.id ? null : d))}
            onDrop={(e) => { e.preventDefault(); if (dragFolder.current) onFolderDrop(f.id, dropLine?.before ?? true) }}
            right={
              <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <Plus size={13} style={{ color: C.blue, cursor: 'pointer' }} onClick={() => addPrompt(f.id)} />
                <Pencil size={11} style={{ color: C.muted, cursor: 'pointer' }} onClick={() => { setRenameId(f.id); setRenameVal(f.name) }} />
                <Trash2 size={11} style={{ color: C.muted, cursor: 'pointer' }} onClick={() => deleteFolder(f.id)} />
              </span>
            }
          >
            {renameId === f.id && (
              <div className="flex gap-2 mb-2">
                <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(f.id) }} className="flex-1 rounded px-2 py-1 text-xs outline-none" style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }} />
                <button onClick={() => commitRename(f.id)} className="rounded px-2 text-xs" style={{ background: C.blue, color: '#fff' }}>Save</button>
              </div>
            )}
            {cards.length === 0 && <p className="text-[11px]" style={{ color: C.faint }}>No prompts. Use + to add one.</p>}
            <div className={wide ? 'grid grid-cols-2 gap-2 items-start' : 'space-y-2'}>
              {cards.map((p) => (
                <div
                  key={p.id}
                  className="rounded-lg p-2"
                  style={{ background: C.elev, border: `1px solid ${dragThumbId === p.id ? C.blue : C.border}` }}
                  onDragOver={(e) => { if (dropTypes(e)) { e.preventDefault(); if (dragThumbId !== p.id) setDragThumbId(p.id) } }}
                  onDragLeave={() => setDragThumbId((d) => (d === p.id ? null : d))}
                  onDrop={(e) => { if (dropTypes(e)) void onPromptImageDrop(e, p.id) }}
                  title="Drag an image here to attach a visual cue"
                >
                  {editId === p.id ? (
                    <>
                      <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} className="w-full rounded px-2 py-1 text-[11px] outline-none resize-none" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }} />
                      <div className="flex gap-2 mt-1">
                        <button onClick={() => savePrompt(f.id, p.id)} className="rounded px-2 py-1 text-[10px]" style={{ background: C.blue, color: '#fff' }}>Save</button>
                        <button onClick={() => setEditId(null)} className="rounded px-2 py-1 text-[10px]" style={{ background: C.card, color: C.muted, border: `1px solid ${C.border}` }}>Cancel</button>
                      </div>
                    </>
                  ) : (
                    <>
                      {thumbs[p.id] && (
                        <div className="relative mb-2 group/thumb" style={{ width: '100%' }}>
                          <img
                            src={thumbs[p.id]} alt="" loading="lazy"
                            className="rounded object-cover"
                            style={{ width: '100%', aspectRatio: '16 / 9', display: 'block', background: '#000', border: `1px solid ${C.border}` }}
                          />
                          <button
                            onClick={() => removeThumb(p.id)}
                            className="absolute top-1 right-1 h-5 w-5 flex items-center justify-center rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                            style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
                            title="Remove visual cue"
                          ><X size={11} /></button>
                        </div>
                      )}
                      <div className="text-[11px] leading-snug mb-2" style={{ color: C.text, maxHeight: 66, overflow: 'hidden' }}>
                        {p.text || <span style={{ color: C.faint }}>(empty)</span>}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button onClick={() => onInject(p.text)} className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold" style={{ background: C.green, color: '#fff' }}><Send size={11} />Inject</button>
                        <button onClick={() => onCopy(p.text)} className="flex items-center gap-1 rounded px-2 py-1 text-[10px]" style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}><Copy size={11} />Copy</button>
                        <button onClick={() => { setEditId(p.id); setDraft(p.text) }} className="flex items-center gap-1 rounded px-2 py-1 text-[10px]" style={{ background: C.card, color: C.muted, border: `1px solid ${C.border}` }}><Pencil size={11} />Edit</button>
                        <button onClick={() => deletePrompt(f.id, p.id)} className="flex items-center gap-1 rounded px-2 py-1 text-[10px]" style={{ background: C.card, color: C.muted, border: `1px solid ${C.border}` }}><Trash2 size={11} />Delete</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )
      })}
    </div>
  )
}

/* ---- Images (folders + reference library) -------------------------------- */
function ImagesPanel({ ctl, onCopy, onUse, flash }: { ctl: SectionCtl; onCopy: (t: string) => void; onUse: (img: GpmImage) => void; flash: (m: string) => void }) {
  const [folders, setFolders] = useState<GpmImageFolder[]>([])
  const [images, setImages] = useState<GpmImage[]>([])
  const [newFolder, setNewFolder] = useState('')
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const targetFolder = useRef<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const dragFolder = useRef<string | null>(null)
  const [dropLine, setDropLine] = useState<{ target: string; before: boolean } | null>(null)

  const reload = () => { void loadImageFolders().then(setFolders); void loadImages().then(setImages) }
  useEffect(reload, [])

  // Drag-reorder folders, with a blue drop-line indicator like the Studio Assets panel.
  const onFolderDrop = (target: string, before: boolean) => {
    const dragged = dragFolder.current
    dragFolder.current = null
    setDropLine(null)
    if (!dragged || dragged === target) return
    const order = folders.filter((f) => f.id !== dragged)
    const draggedFolder = folders.find((f) => f.id === dragged)
    if (!draggedFolder) return
    let idx = order.findIndex((f) => f.id === target)
    if (!before) idx += 1
    order.splice(idx, 0, draggedFolder)
    setFolders(order); void saveImageFolders(order)
  }

  const addFolder = () => {
    const n = newFolder.trim(); if (!n) return
    const next = [{ id: gpmId(), name: n }, ...folders]; setFolders(next); void saveImageFolders(next); setNewFolder('')
  }
  const commitRename = (id: string) => {
    const n = renameVal.trim()
    if (n) { const next = folders.map((f) => (f.id === id ? { ...f, name: n } : f)); setFolders(next); void saveImageFolders(next) }
    setRenameId(null)
  }
  const deleteFolder = (id: string) => {
    if (!window.confirm('Delete this folder? Images inside are also removed.')) return
    const next = folders.filter((f) => f.id !== id); setFolders(next); void saveImageFolders(next)
    images.filter((im) => im.folderId === id).forEach((im) => void deleteImage(im.id))
    setImages(images.filter((im) => im.folderId !== id))
  }
  const pickFor = (folderId: string) => { targetFolder.current = folderId; fileRef.current?.click() }
  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []); e.target.value = ''
    const folderId = targetFolder.current
    for (const file of files) {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(file)
      })
      const img: GpmImage = { id: gpmId(), name: file.name, folderId, dataUrl, addedAt: Date.now(), isVideo: file.type.startsWith('video') }
      await putImage(img); setImages((prev) => [img, ...prev])
    }
    if (files.length) flash(`Added ${files.length} item(s)`)
  }
  const removeImage = (id: string) => { void deleteImage(id); setImages(images.filter((im) => im.id !== id)) }

  // Drop a file from the Downloads Browser into a folder — reads it off disk
  // via IPC and adds it as a real library image.
  const addFromLibFile = async (f: LibFile, folderId: string | null) => {
    const api = window.electronAPI
    if (!api) return
    const r = await api.gpmLibReadAsDataUrl({ path: f.path })
    if (!r.success) { flash(r.error); return }
    const img: GpmImage = { id: gpmId(), name: f.name, folderId, dataUrl: r.dataUrl, addedAt: Date.now(), isVideo: f.isVideo }
    await putImage(img); setImages((prev) => [img, ...prev])
    flash(`Added ${f.name}`)
  }
  const onLibFileDrop = (e: React.DragEvent, folderId: string | null) => {
    const raw = e.dataTransfer.getData(FILE_DND)
    if (raw) { e.preventDefault(); void addFromLibFile(JSON.parse(raw) as LibFile, folderId); return }
    // Also accept an image dragged straight from the Create gallery (work-area canvas),
    // so it lands directly in an Images folder instead of via the Studio Assets round-trip.
    const assetRaw = e.dataTransfer.getData('asset')
    if (assetRaw) {
      e.preventDefault()
      const a = JSON.parse(assetRaw) as { path: string; type?: string }
      const name = a.path.split(/[\\/]/).pop() || 'image'
      void addFromLibFile({ folder: '', name, path: a.path, isVideo: a.type === 'video', isAudio: false, mtimeMs: 0 }, folderId)
    }
  }

  const renderGrid = (items: GpmImage[]) => (
    <div className="grid grid-cols-2 gap-2">
      {items.map((im) => (
        <MediaThumb
          key={im.id} src={im.dataUrl} isVideo={im.isVideo} name={im.name}
          className="rounded-md" style={{ border: `1px solid ${C.border}` }}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(GPM_IMAGE_DND_TYPE, JSON.stringify({ id: im.id, name: im.name, dataUrl: im.dataUrl }))
            e.dataTransfer.effectAllowed = 'copy'
          }}
        >
          <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {!im.isVideo && (
              <button onClick={() => onUse(im)} title="Send to Create as input image" className="h-5 w-5 flex items-center justify-center rounded" style={{ background: C.green, color: '#fff' }}><Send size={11} /></button>
            )}
            <button onClick={() => onCopy(im.name)} title="Copy filename" className="h-5 w-5 flex items-center justify-center rounded" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}><Copy size={11} /></button>
            <button onClick={() => removeImage(im.id)} title="Delete" className="h-5 w-5 flex items-center justify-center rounded" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}><Trash2 size={11} /></button>
          </div>
        </MediaThumb>
      ))}
    </div>
  )

  const unassigned = images.filter((im) => !im.folderId || !folders.some((f) => f.id === im.folderId))
  return (
    <div>
      <BackupRow onAfterImport={reload} flash={flash} />
      <p className="text-[11px] mb-2" style={{ color: C.muted }}>Reference-image library organized in folders ({images.length} items).</p>
      <div className="flex gap-2 mb-3">
        <input
          value={newFolder} onChange={(e) => setNewFolder(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addFolder() }}
          placeholder="New image folder…" className="flex-1 rounded-md px-2 py-1.5 text-xs outline-none"
          style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }}
        />
        <button onClick={addFolder} className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium" style={{ background: C.blue, color: '#fff' }}>
          <FolderPlus size={13} />Add
        </button>
      </div>
      {folders.length === 0 && unassigned.length === 0 && (
        <p className="text-[11px] text-center py-6" style={{ color: C.faint }}>No image folders yet. Create one or Import a backup.</p>
      )}
      {folders.map((f) => {
        const items = images.filter((im) => im.folderId === f.id)
        return (
          <div
            key={f.id}
            onDragOver={(e) => { if (e.dataTransfer.types.includes(FILE_DND) || e.dataTransfer.types.includes('asset')) e.preventDefault() }}
            onDrop={(e) => onLibFileDrop(e, f.id)}
          >
          <Section
            id={`if-${f.id}`} ctl={ctl}
            title={<span className="flex items-center gap-1.5">{f.name} ({items.length})</span>}
            dragHandle={{
              onDragStart: (e) => { dragFolder.current = f.id; e.dataTransfer.setData(IMAGE_FOLDER_DND, f.id); e.dataTransfer.effectAllowed = 'move' },
              onDragEnd: () => { dragFolder.current = null; setDropLine(null) },
            }}
            dropLine={dropLine?.target === f.id ? (dropLine.before ? 'before' : 'after') : null}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(IMAGE_FOLDER_DND)) return
              e.preventDefault()
              if (dragFolder.current && dragFolder.current !== f.id) {
                const r = e.currentTarget.getBoundingClientRect()
                const before = e.clientY - r.top < r.height / 2
                setDropLine({ target: f.id, before })
              }
            }}
            onDragLeave={() => setDropLine((d) => (d?.target === f.id ? null : d))}
            onDrop={(e) => { if (dragFolder.current) { e.preventDefault(); onFolderDrop(f.id, dropLine?.before ?? true) } }}
            right={
              <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <Plus size={13} style={{ color: C.blue, cursor: 'pointer' }} onClick={() => pickFor(f.id)} />
                <Pencil size={11} style={{ color: C.muted, cursor: 'pointer' }} onClick={() => { setRenameId(f.id); setRenameVal(f.name) }} />
                <Trash2 size={11} style={{ color: C.muted, cursor: 'pointer' }} onClick={() => deleteFolder(f.id)} />
              </span>
            }
          >
            {renameId === f.id && (
              <div className="flex gap-2 mb-2">
                <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(f.id) }} className="flex-1 rounded px-2 py-1 text-xs outline-none" style={{ background: C.elev, color: C.text, border: `1px solid ${C.border}` }} />
                <button onClick={() => commitRename(f.id)} className="rounded px-2 text-xs" style={{ background: C.blue, color: '#fff' }}>Save</button>
              </div>
            )}
            {items.length === 0
              ? <button onClick={() => pickFor(f.id)} className="w-full rounded-md py-3 text-[11px] flex items-center justify-center gap-1.5" style={{ border: `1px dashed ${C.borderLt}`, color: C.faint }}><ImageIcon size={14} />Add images</button>
              : renderGrid(items)}
          </Section>
          </div>
        )
      })}
      {unassigned.length > 0 && (
        <div
          onDragOver={(e) => { if (e.dataTransfer.types.includes(FILE_DND) || e.dataTransfer.types.includes('asset')) e.preventDefault() }}
          onDrop={(e) => onLibFileDrop(e, null)}
        >
          <Section id="if-unassigned" ctl={ctl} title={`Unassigned (${unassigned.length})`}>
            {renderGrid(unassigned)}
          </Section>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={onFiles} />
    </div>
  )
}

/* ---- Dock ----------------------------------------------------------------- */
function Dock({ onClose }: { onClose: () => void }) {
  const { setGenSpacePromptInjection, setCurrentTab, setGenSpaceInputImagePath, clearGenSpacePrompt } = useProjects()

  const [gpmTab, setGpmTab] = useState<GpmTab>('performance')
  // Where every panel's "Inject" button sends its text: the main LTX Create
  // prompt box, or the Photo Edit + Multi-Angle panel's extra-prompt field.
  const [injectTarget, setInjectTarget] = useState<InjectTarget>('main')
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 1600) }

  // Collapsible state shared across tabs + collapse-all.
  //   sectionsOpen: per-section explicit overrides (from clicking a header).
  //   allOverride:  null until the user hits collapse/expand-all, then forces
  //                 every section to that state.
  // Fresh open (no override): image/prompt FOLDERS (ids "if-*"/"pf-*") start
  // COLLAPSED so a big library doesn't fill the panel, while functional panel
  // sections (Controls, Presets, …) still open expanded. Expand-all opens
  // everything including folders.
  const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>({})
  const [allOverride, setAllOverride] = useState<boolean | null>(null)
  const isFolderSection = (id: string) => id.startsWith('if-') || id.startsWith('pf-')
  const defaultOpen = (id: string) => allOverride ?? (isFolderSection(id) ? false : true)
  const allOpen = allOverride ?? true // drives the collapse/expand-all icon
  const toggleAll = () => { setAllOverride((v) => !(v ?? true)); setSectionsOpen({}) }
  const ctl: SectionCtl = {
    isOpen: (id) => sectionsOpen[id] ?? defaultOpen(id),
    toggle: (id) => setSectionsOpen((s) => ({ ...s, [id]: !(s[id] ?? defaultOpen(id)) })),
  }

  const [perf, setPerf] = useState<PerfState>({
    familyIndex: 0, intensity: 0.5, asymmetry: 0.25,
    dialogue: '', delivery: 'natural', dialogueAuto: false,
  })
  const perfText = useMemo(() => assemblePerformance(perf).text, [perf])
  // Persist the working performance so closing the dock (which unmounts it) and
  // restarts don't reset it to the first emotion with an empty prompt. Family is
  // stored by NAME (the list is alphabetized/extensible). Autosave only starts
  // after hydration so the initial default state can't clobber the stored value.
  const perfHydrated = useRef(false)
  useEffect(() => {
    void loadWorkingPerf().then((w) => {
      if (w) {
        setPerf({
          familyIndex: familyIndexByName(w.family), intensity: w.intensity, asymmetry: w.asymmetry,
          dialogue: w.dialogue, delivery: w.delivery as PerfDelivery, dialogueAuto: w.dialogueAuto,
        })
      }
      perfHydrated.current = true
    })
  }, [])
  useEffect(() => {
    if (!perfHydrated.current) return
    void saveWorkingPerf({
      family: PERF_FAMILIES[perf.familyIndex]?.family ?? '', intensity: perf.intensity,
      asymmetry: perf.asymmetry, dialogue: perf.dialogue, delivery: perf.delivery, dialogueAuto: perf.dialogueAuto,
    })
  }, [perf])

  const [shot, setShot] = useState<ShotState>({
    rot: 35, tilt: -8, zoom: 9, preset: SHOT_PRESETS[1], anchors: { faces: true },
  })
  // Ephemeral panel state lifted here so it survives the enlarge/shrink remount.
  const [shotSrcImage, setShotSrcImage] = useState<{ name: string; dataUrl: string } | null>(null)
  const [qwenAngleState, setQwenAngleState] = useState<QwenAngleState>(DEFAULT_QWEN_ANGLE_STATE)
  const [platesActiveId, setPlatesActiveId] = useState<string | null>(null)
  const [sceneLens, setSceneLens] = useState('50mm')
  const sceneAimRef = useRef<{ yaw: number; pitch: number }>({ yaw: 0, pitch: 0 })

  const [camCat, setCamCat] = useState<'All' | CameraCategory>('All')

  const [wf, setWf] = useState<WfState>({
    name: 'Untitled Workflow',
    slots: [
      { id: 's1', role: 'character', note: 'STORM', filled: true },
      { id: 's2', role: 'location', note: 'ruined town', filled: true },
      { id: 's3', role: 'general', note: '', filled: false },
    ],
    directive: 'STORM walks toward camera down the ruined main street, dust drifting.',
    aspectRatio: '16:9', motionHint: 'slow push-in',
    performance: { enabled: false },
  })

  const copyText = (txt: string) => { void navigator.clipboard?.writeText(txt); flash('Copied to clipboard') }
  const injectIntoPrompt = (txt: string) => {
    if (!txt.trim()) return
    if (injectTarget === 'qwen') {
      // Append to the Multi-Angle extra-prompt (comma-joined, matching how its
      // own controls build up that field) and surface the panel so the user
      // sees where it landed. Stays inside the Prompt Manager — no tab switch.
      setQwenAngleState((s) => ({
        ...s,
        extraPrompt: s.extraPrompt.trim() ? `${s.extraPrompt.trim()}, ${txt.trim()}` : txt.trim(),
      }))
      if (expanded) setExpandedTab('qwenAngle'); else setGpmTab('qwenAngle')
      flash('Injected into Multi-Angle')
      return
    }
    setCurrentTab('gen-space')
    setGenSpacePromptInjection(txt)
    flash('Injected into prompt')
  }
  const sendImageToGenSpace = async (img: GpmImage) => {
    try {
      const path = await saveDataUrlToTempFile(img.dataUrl, img.name)
      setGenSpaceInputImagePath(path)
      setCurrentTab('gen-space')
      flash('Image sent to Create')
    } catch (e) {
      flash('Send failed: ' + (e instanceof Error ? e.message : 'error'))
    }
  }

  const TABS: Array<[GpmTab, string]> = [
    ['prompts', 'Prompts'], ['images', 'Images'], ['camera', 'Camera'],
    ['shot', 'Shot Setup'], ['plates', 'Plates'], ['workflow', 'Workflow'],
    ['qwenAngle', 'Photo Edit + Multi-Angle'],
  ]
  const ALL_TABS: Array<[GpmTab, string]> = [...TABS, ['performance', 'Performance Studio']]

  // Enlarge a tab into a floating workspace that sits in the middle of the screen,
  // *without* covering the Downloads Browser (left) or this dock's own tab strip
  // (right) — so the user can keep dragging images out of the Images tab into
  // either of those while the enlarged workspace is open. The enlarged tab is
  // tracked independently of the docked `gpmTab` so switching the dock's own tab
  // (e.g. to Images, to grab an image to drag) doesn't change what's enlarged.
  const [expanded, setExpanded] = useState(false)
  const [expandedTab, setExpandedTab] = useState<GpmTab>('performance')
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  // Point injection at the Multi-Angle box while its enlarged workspace is
  // showing, and back at the LTX prompt when it shrinks — so the user never has
  // to remember to flip it, and can't accidentally inject Multi-Angle text into
  // Create. Manual toggling within a state is respected: this only reacts to the
  // enlarge/shrink transitions (deps), not to injectTarget itself. Switching the
  // *enlarged* view to another tab leaves it on 'qwen' so injecting a saved
  // prompt from there still lands in the Multi-Angle box.
  useEffect(() => {
    if (expanded && expandedTab === 'qwenAngle') setInjectTarget('qwen')
    else if (!expanded) setInjectTarget('main')
  }, [expanded, expandedTab])

  // `wide` is true only for the enlarged workspace, where the panel is roomy
  // enough for a 2-column prompt grid (the docked strip stays single-column).
  const renderPanel = (tab: GpmTab, wide = false) => (
    <>
      {tab === 'performance' && <PerformancePanel perf={perf} setPerf={setPerf} ctl={ctl} onCopy={copyText} onInject={injectIntoPrompt} flash={flash} />}
      {tab === 'shot' && <ShotPanel shot={shot} setShot={setShot} ctl={ctl} onCopy={copyText} onInject={injectIntoPrompt} onUseImage={sendImageToGenSpace} flash={flash} srcImage={shotSrcImage} setSrcImage={setShotSrcImage} />}
      {tab === 'camera' && <CameraPanel search={search} setSearch={setSearch} camCat={camCat} setCamCat={setCamCat} onInject={injectIntoPrompt} flash={flash} />}
      {tab === 'workflow' && <WorkflowPanel wf={wf} setWf={setWf} perfText={perfText} ctl={ctl} onCopy={copyText} onInject={injectIntoPrompt} onUseImage={sendImageToGenSpace} flash={flash} />}
      {tab === 'prompts' && <PromptsPanel ctl={ctl} onCopy={copyText} onInject={injectIntoPrompt} flash={flash} wide={wide} />}
      {tab === 'images' && <ImagesPanel ctl={ctl} onCopy={copyText} onUse={sendImageToGenSpace} flash={flash} />}
      {tab === 'plates' && <PlatesPanel onUse={sendImageToGenSpace} flash={flash} activeId={platesActiveId} setActiveId={setPlatesActiveId} sceneLens={sceneLens} setSceneLens={setSceneLens} sceneAimRef={sceneAimRef} />}
      {tab === 'qwenAngle' && <QwenMultiAnglePanel state={qwenAngleState} setState={setQwenAngleState} onUse={sendImageToGenSpace} flash={flash} injectTarget={injectTarget} setInjectTarget={setInjectTarget} />}
    </>
  )
  // Don't render the docked panel for the tab that's currently enlarged: that mounted TWO live
  // copies of the same stateful panel (e.g. Multi-Angle) sharing one state — double progress
  // polling, duplicate hidden file inputs, and inputs that fought each other (the extra-prompt
  // box went dead until a generation forced things to settle). The enlarged workspace is the
  // single owner; switch the docked strip to another tab to use it alongside.
  const dockedDupsExpanded = expanded && expandedTab === gpmTab
  const activePanel = dockedDupsExpanded ? (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center" style={{ color: C.faint }}>
      <Maximize2 size={20} />
      <p className="text-[11px] px-6">Open in the enlarged workspace. Pick another tab here to use it side by side.</p>
    </div>
  ) : renderPanel(gpmTab)
  const expandedLabel = ALL_TABS.find(([id]) => id === expandedTab)?.[1] ?? ''

  return (
    <div
      className="fixed top-0 right-0 z-[75] h-screen w-[396px] flex flex-col"
      style={{ background: C.panel, borderLeft: `1px solid ${C.border}`, boxShadow: '-8px 0 24px rgba(0,0,0,0.4)' }}
    >
      {/* Side tab on the left edge (centered) to collapse the panel. */}
      <button
        onClick={onClose}
        title="Close Prompt Manager Pro"
        className="absolute top-1/2 -translate-y-1/2 -left-6 flex flex-col items-center justify-center gap-1.5"
        style={{ width: 24, height: 110, background: C.blue, color: '#fff', borderRadius: '8px 0 0 8px', boxShadow: '-3px 0 10px rgba(0,0,0,0.35)' }}
      >
        <ChevronRight size={16} />
        <span className="text-xs font-semibold tracking-wide" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>Close</span>
      </button>

      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: `1px solid ${C.border}` }}>
        <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: C.text }}>
          <Wand2 size={15} style={{ color: C.blue }} />Prompt Manager Pro
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { clearGenSpacePrompt(); flash('Prompt box cleared') }}
            title="Clear the LTX Create prompt box"
            className="text-[11px] flex items-center gap-1 px-2 py-1 rounded"
            style={{ color: C.muted, background: C.card, border: `1px solid ${C.border}` }}
          >
            <Eraser size={12} />Clear
          </button>
          <button
            onClick={toggleAll} title={allOpen ? 'Collapse all sections' : 'Expand all sections'}
            className="h-7 w-7 flex items-center justify-center rounded-md"
            style={{ color: C.muted }}
          >
            {allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
          </button>
          <button
            onClick={() => { setExpandedTab(gpmTab); setExpanded(true) }} title="Enlarge panel for a bigger workspace (Esc to shrink)"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-semibold"
            style={{ color: '#fff', background: C.blue }}
          >
            <Maximize2 size={13} />Enlarge
          </button>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-md" style={{ color: C.muted }} title="Close">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="p-3 grid grid-cols-3 gap-2 shrink-0" style={{ borderBottom: `1px solid ${C.border}` }}>
        {TABS.map(([id, lbl]) => {
          const active = gpmTab === id
          return (
            <button
              key={id} onClick={() => setGpmTab(id)}
              className="rounded-md py-2 text-xs font-medium transition-colors"
              style={{ background: active ? C.blue : C.card, color: active ? '#fff' : C.muted, border: `1px solid ${active ? C.blue : C.border}` }}
            >
              {lbl}
            </button>
          )
        })}
        <button
          onClick={() => {
            setGpmTab('performance')
            setSectionsOpen((s) => ({ ...s, 'perf-controls': true }))
          }}
          className="col-span-3 rounded-md py-2 text-xs font-semibold transition-colors"
          style={{
            background: gpmTab === 'performance' ? C.blue : C.card,
            color: gpmTab === 'performance' ? '#fff' : C.text,
            border: `1px solid ${gpmTab === 'performance' ? C.blue : C.border}`,
          }}
        >
          Performance Studio
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activePanel}
      </div>

      {expanded && (
        <div
          className="fixed z-[80] rounded-xl overflow-hidden flex flex-col"
          style={{
            top: 56, bottom: 56, left: 356, right: 412,
            background: C.panel, border: `2px solid ${C.blue}`, boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
          }}
        >
          <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: `1px solid ${C.border}` }}>
            <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: C.text }}>
              <Wand2 size={15} style={{ color: C.blue }} />{expandedLabel}
            </span>
            <button
              onClick={() => setExpanded(false)}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold"
              style={{ background: C.blue, color: '#fff' }}
            >
              <Minimize2 size={13} />Shrink
            </button>
          </div>
          <div className="px-4 py-2 flex flex-wrap gap-1.5 shrink-0" style={{ borderBottom: `1px solid ${C.border}` }}>
            {ALL_TABS.map(([id, lbl]) => {
              const active = expandedTab === id
              return (
                <button
                  key={id} onClick={() => setExpandedTab(id)}
                  className="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                  style={{ background: active ? C.blue : C.card, color: active ? '#fff' : C.muted, border: `1px solid ${active ? C.blue : C.border}` }}
                >
                  {lbl}
                </button>
              )
            })}
          </div>
          <div className="overflow-y-auto p-5">
            {renderPanel(expandedTab, true)}
          </div>
        </div>
      )}

      {toast && (
        <div
          className="absolute left-1/2 bottom-4 -translate-x-1/2 flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium"
          style={{ background: C.elev, border: `1px solid ${C.borderLt}`, color: C.text, boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}

/* ---- Self-mounting launcher ---------------------------------------------- */
export function PromptManagerPro() {
  const open = usePromptManagerProOpen()
  if (!open) {
    return (
      <button
        onClick={() => setPromptManagerProOpen(true)} title="Open Prompt Manager Pro"
        className="fixed top-1/2 -translate-y-1/2 right-0 z-[75] flex flex-col items-center justify-center gap-1.5 opacity-50 hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        style={{ width: 24, height: 160, background: C.blue, color: '#fff', borderRadius: '8px 0 0 8px', boxShadow: '-3px 0 10px rgba(0,0,0,0.35)' }}
      >
        <ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} />
        <span className="text-xs font-semibold tracking-wide" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>Prompt Manager</span>
      </button>
    )
  }
  return <Dock onClose={() => setPromptManagerProOpen(false)} />
}

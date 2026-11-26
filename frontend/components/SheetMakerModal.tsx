import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, Loader2, Sparkles, X } from 'lucide-react'
import { pathToFileUrl } from '../lib/file-url'
import { layoutSheet } from '../lib/sheet-layout'
import { useClaudeRun } from '../hooks/use-claude-run'
import { LibraryImagePicker } from './LibraryImagePicker'
import { CropImageDialog } from './CropImageDialog'
import { FILE_DND, type LibFile } from './gpm/DownloadsBrowser'
import { GPM_IMAGE_DND_TYPE, saveDataUrlToTempFile, type GpmDndImage } from './gpm/gpm-image-file'
import { imagePathsFromDataTransfer } from '../lib/keyframe-drop'

/**
 * "Prompt with Claude" in Image mode: asks the questions the rix-ingredients-sheet skill needs
 * (what goes on the sheet, who/what it is, style), then has the user's own Claude write the
 * still-image prompt for a reference sheet and put it in the prompt box with set_generation_prompt.
 * The sheet is then generated with the normal Image mode and used as the Ingredients input.
 */

type Style = 'photoreal' | 'illustrated' | '3d'
type Aspect = '16:9' | '3:2' | '1:1'

export interface SheetBrief {
  character: boolean
  characterCount: 1 | 2
  characterText: string
  outfits: boolean
  outfitsText: string
  location: boolean
  locationText: string
  props: boolean
  propsText: string
  style: Style
  aspect: Aspect
  // Existing images Claude should read and fold into the sheet (character, outfit, place, prop,
  // or a finished sheet to convert). Several allowed.
  refs: RefImage[]
  // With a character image: keep what they wear in it, or use the outfit described below.
  keepOutfit: boolean
  // 'describe': Claude studies the images and writes a brand-new sheet from detailed text alone (no
  // image goes to the image model). 'attach': the images are also attached as likeness references.
  refUse: 'describe' | 'attach'
}

export type RefRole = 'character' | 'outfit' | 'location' | 'prop' | 'sheet' | 'turnaround' | 'face'
export interface RefImage { path: string; role: RefRole }

/** The bottom-row tiles of the built layout, left to right: outfits, then props, then the location. */
export function bottomTiles(refs: RefImage[]): RefImage[] {
  return (['outfit', 'prop', 'location'] as RefRole[]).flatMap(role => refs.filter(r => r.role === role))
}

// What the user last had in the window, so closing it to clean a background doesn't lose the images.
let rememberedRefs: RefImage[] = []

const CLEANUP_PROMPTS: Partial<Record<RefRole, string>> = {
  prop: 'Isolate the object on a plain, seamless light-grey studio backdrop with soft even light and a faint contact shadow. Keep the object exactly as it is: the same shape, colour, material, wear and scale. Remove everything else in the picture.',
  outfit: 'Show ONE garment only, the front view of the main outfit, as an invisible-mannequin product shot on a plain, seamless light-grey studio backdrop with soft even light. Remove the head, neck, face, hair, arms, hands and legs completely: no person and no face anywhere, only the empty garment (and its shoes if shown) holding its shape. Discard every other view, every smaller picture and any accessories or props. Keep the garment exactly as it is: the same cut, colour, material, pattern and trim.',
  character: 'Place this same person on a plain, seamless light-grey studio backdrop with soft even light. Keep the face, hair, skin, clothes and pose exactly as they are. Remove everything else in the picture.',
}

const ROLES: { id: RefRole; label: string; text: string }[] = [
  { id: 'character', label: 'Character', text: 'a character: copy this exact likeness (face, hair, skin, build)' },
  { id: 'outfit', label: 'Outfit', text: 'an outfit or garment: describe it exactly' },
  { id: 'location', label: 'Location', text: 'a location: describe the place and its light exactly' },
  { id: 'prop', label: 'Prop', text: 'a prop: describe its shape, material, colour and wear exactly' },
  { id: 'face', label: 'Face close-up', text: 'a finished face close-up of the character: copy this face exactly' },
  { id: 'turnaround', label: 'Turnaround', text: 'a finished turnaround of the character: copy the face, hair and outfit exactly' },
  { id: 'sheet', label: 'Existing sheet', text: 'an existing reference sheet to convert: read every panel, keep its character and items, and rebuild it in the Ingredients layout' },
]

const STYLES: { id: Style; label: string; text: string }[] = [
  { id: 'photoreal', label: 'Photoreal', text: 'photoreal live action' },
  { id: 'illustrated', label: 'Illustrated', text: 'illustrated / painted' },
  { id: '3d', label: '3D animated', text: 'stylised 3D animation' },
]
const ASPECTS: Aspect[] = ['16:9', '3:2', '1:1']

export function buildSheetBrief(b: SheetBrief): string {
  const none = '(not given: invent a distinctive, specific choice and tell me what you chose)'
  const parts: string[] = []
  if (b.character) parts.push(b.characterCount === 2 ? 'two characters' : 'one character')
  // An image given a role puts that item on the sheet even if its toggle above is off.
  const has = (role: RefRole) => b.refs.some(r => r.role === role)
  if (b.outfits || has('outfit')) parts.push(b.outfits ? 'several outfits of the character' : 'the outfit')
  if (b.location || has('location')) parts.push('a location')
  if (b.props || has('prop')) parts.push('props')
  return [
    'Write the still-image prompt for a reference sheet for RiX\'s Ingredients IC-LoRA, using the rix-ingredients-sheet skill. My answers to its questions are below, so do not ask me anything. Pick the layout yourself from the content. Then put the finished image prompt in RiX\'s prompt box with set_generation_prompt (the prompt text only: no image_path, folder "Reference Sheets"). Do not generate anything.',
    '',
    `The sheet holds: ${parts.join(', ')}.`,
    ...(b.character ? [`Character${b.characterCount === 2 ? 's' : ''}: ${b.characterText.trim() || none}`] : []),
    ...(b.outfits ? [`Outfits (one panel each): ${b.outfitsText.trim() || none}`] : []),
    ...(b.location ? [`Location: ${b.locationText.trim() || none}`] : []),
    ...(b.props ? [`Props: ${b.propsText.trim() || none}`] : []),
    `Style: ${STYLES.find(s => s.id === b.style)?.text}.`,
    `Aspect ratio: ${b.aspect}. This is mandatory: state it as the canvas size in the first sentence of the prompt and again in the last, and make the prompt a NEW image of that shape, never an edit that keeps the shape of any attached image. Every panel, including the face close-up, is its own separate, crisp, fully opaque tile.`,
    ...(b.refs.length > 0
      ? [
          `I attached ${b.refs.length} existing image${b.refs.length === 1 ? '' : 's'}. Look at EACH with inspect_media (frames 1, width 1280 or more, one call per image) and follow the "Character from a reference image" and "Converting an existing sheet or several images" sections of the skill. Describe exactly what each shows; do not invent or "improve" anything. The text I wrote above is only changes or extras to what the images show.`,
          b.refUse === 'describe'
            ? 'TEXT-ONLY SHEET: these images are for you to study. None of them will be attached in the image tool: the image model sees only your words and draws a brand-new sheet from them. Follow the "Text-only sheet" section of the skill: describe every person, garment, place and prop in full, concrete detail, never write a likeness line, and never mention an attached, reference or uploaded image in the prompt.'
            : 'ATTACHED: I will also attach the images in my image tool as likeness references.',
          ...b.refs.map((r, i) => `Image ${i + 1}: ${r.path}\n  Role: ${ROLES.find(x => x.id === r.role)?.text}.`),
          ...(b.refs.some(r => r.role === 'location' || r.role === 'prop' || r.role === 'outfit')
            ? [`Every image above with the role Outfit, Location or Prop gets its own panel on the sheet (${b.refs.map((r, i) => r.role === 'location' || r.role === 'prop' || r.role === 'outfit' ? `Image ${i + 1}: ${ROLES.find(x => x.id === r.role)?.label}` : '').filter(Boolean).join(', ')}). Do not drop any of them: count the panels against this list before you finish.`]
            : []),
          ...(b.refs.some(r => r.role === 'outfit')
            ? ['Outfit: an Outfit image is attached, so the character WEARS that outfit in every full-body view of the turnaround (and its neckline or collar in the face close-up). It also gets its own garment panel, shown whole, front and back, never cropped. Ignore what the character wears in their own image, but keep their hair, headwear-free face and any accessories I did not replace.']
            : []),
          ...(b.refs.some(r => r.role === 'character') && !b.refs.some(r => r.role === 'outfit')
            ? [
                b.keepOutfit
                  ? 'Outfit: keep what the character wears in their image.'
                  : 'Outfit: do not use the outfit in the character image; use the outfit I described.',
                ...(b.refUse === 'attach'
                  ? ['Start the sheet prompt by telling the image model to use the attached reference image as the exact likeness of the person in every panel.']
                  : []),
              ]
            : []),
          ...(b.refUse === 'attach' ? ['Tell me which of these images to attach in my image tool for the sheet.'] : []),
        ]
      : ['No existing images.']),
    '',
    'Reply in a few lines: the layout you chose, anything you invented, and how many versions to generate before picking one. Remind me to test the finished sheet with one short Ingredients video.',
  ].join('\n')
}

export function SheetMakerModal({ inputImage = null, onUseCanvas, onCleanup, onClearInput, onClose }: {
  /** Clears RiX's Image input, so a text-only sheet is a brand-new image, not an edit of a photo. */
  onClearInput?: () => void
  /** Loads an image as the Image input and fills the prompt box (for the clean-background helper). */
  onCleanup?: (path: string, prompt: string) => void
  /** Sets the Image-mode input image (used for the 16:9 canvas helper). */
  onUseCanvas?: (path: string) => void
  /** The Image-mode input image, if one is loaded: offered as the character reference. */
  inputImage?: string | null
  onClose: () => void
}) {
  const c = useClaudeRun()
  const [opening, setOpening] = useState(false)
  const [followUp, setFollowUp] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [libOpen, setLibOpen] = useState(false)
  const [cropIndex, setCropIndex] = useState<number | null>(null)
  const [brief, setBrief] = useState<SheetBrief>({
    character: true, characterCount: 1, characterText: '',
    outfits: false, outfitsText: '',
    location: false, locationText: '',
    props: false, propsText: '',
    style: 'photoreal', aspect: '16:9', refs: rememberedRefs.length ? rememberedRefs : inputImage ? [{ path: inputImage, role: 'character' }] : [], keepOutfit: true, refUse: 'describe',
  })
  const set = <K extends keyof SheetBrief>(k: K, v: SheetBrief[K]) => setBrief(b => ({ ...b, [k]: v }))

  rememberedRefs = brief.refs
  const hasContent = brief.character || brief.location || brief.props || brief.refs.length > 0
  const needsCharacterForOutfits = brief.outfits && !brief.character
  const valid = hasContent && !needsCharacterForOutfits
  const prompt = buildSheetBrief(brief)

  const close = () => { c.cancel(); onClose() }
  const writeHere = () => {
    if (brief.refUse === 'describe' && inputImage) onClearInput?.()
    void c.startRun(prompt)
  }
  const sendFollowUp = () => {
    const t = followUp.trim()
    if (!t || !c.run?.sessionId) return
    setFollowUp('')
    void c.startRun(`${t}\n\nRevise the sheet prompt and call set_generation_prompt again with the complete new prompt (prompt text only, no image_path).`, c.run.sessionId)
  }
  const openInClaude = async () => {
    setOpening(true)
    c.setError(null)
    try {
      const r = await window.electronAPI.openClaudeCode({ prompt })
      if (!r.success) { c.setError(r.error); return }
      onClose()
    } finally { setOpening(false) }
  }
  const addRefs = async () => {
    const paths = await window.electronAPI.showOpenFileDialog({
      title: 'Select reference images',
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile', 'multiSelections'],
    })
    if (paths) addPaths(paths)
  }
  const addPaths = (paths: string[]) => {
    if (paths.length === 0) return
    setBrief(b => {
      const have = new Set(b.refs.map(r => r.path))
      let hasChar = b.refs.some(r => r.role === 'character')
      const fresh: RefImage[] = []
      for (const p of paths) {
        if (have.has(p)) continue
        have.add(p)
        fresh.push({ path: p, role: hasChar ? 'prop' : 'character' })
        hasChar = true
      }
      return { ...b, refs: [...b.refs, ...fresh].slice(0, 8) }
    })
  }
  // Drop: library files, Prompt Manager images, project assets, or files from the desktop.
  const onDropRefs = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const dt = e.dataTransfer
    const gpm = dt.getData(GPM_IMAGE_DND_TYPE)
    if (gpm) {
      try {
        const { name, dataUrl } = JSON.parse(gpm) as GpmDndImage
        void saveDataUrlToTempFile(dataUrl, name).then(p => addPaths([p])).catch(() => {})
      } catch { /* ignore a malformed drag */ }
      return
    }
    const lib = dt.getData(FILE_DND)
    if (lib) {
      try {
        const f = JSON.parse(lib) as LibFile
        if (!f.isVideo && !f.isAudio) addPaths([f.path])
      } catch { /* ignore */ }
      return
    }
    addPaths(imagePathsFromDataTransfer(dt))
  }
  // Image-mode edits keep the input's shape, so a 16:9 sheet needs a 16:9 input: put the character
  // photo as the top-left tile on a grey 1920x1080 canvas. The model still generates the whole
  // sheet (the photo is a likeness reference, not kept as a tile).
  const [canvasBusy, setCanvasBusy] = useState(false)
  const [finalMsg, setFinalMsg] = useState<string | null>(null)
  const [finalPath, setFinalPath] = useState<string | null>(null)
  const [libFolders, setLibFolders] = useState<string[]>([])
  const [saveFolder, setSaveFolder] = useState('Reference Sheets')
  // Read through the main process as a data URL: a canvas that has drawn file:// pictures is
  // tainted in the packaged app and can't be exported.
  const loadImg = async (src: string) => {
    let url = pathToFileUrl(src)
    try {
      const r = await window.electronAPI.gpmLibReadAsDataUrl({ path: src })
      if (r.success) url = r.dataUrl
    } catch { /* fall back to the file URL */ }
    return new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image()
      im.onload = () => res(im)
      im.onerror = () => rej(new Error(`Could not open ${src.split(/[\/]/).pop()}`))
      im.src = url
    })
  }
  const makeCanvas = async () => {
    const src = (brief.refs.find(r => r.role === 'character') ?? brief.refs[0])?.path
    if (!src || !onUseCanvas) return
    setCanvasBusy(true)
    setFinalMsg(null)
    try {
      const img = await loadImg(src)
      const W = 1920, H = 1080
      const cv = document.createElement('canvas')
      cv.width = W; cv.height = H
      const g = cv.getContext('2d')
      if (!g) return
      g.fillStyle = '#2a2a2a'
      g.fillRect(0, 0, W, H)
      const tile = { x: W * 0.01, y: H * 0.02, w: W * 0.27, h: H * 0.5 }
      g.fillStyle = '#8a8a8a'
      g.fillRect(tile.x, tile.y, W * 0.98 - tile.x, H * 0.96)
      const k = Math.min(tile.w / img.naturalWidth, tile.h / img.naturalHeight)
      g.drawImage(img, tile.x, tile.y, img.naturalWidth * k, img.naturalHeight * k)
      onUseCanvas(await saveDataUrlToTempFile(cv.toDataURL('image/png'), 'character-16x9-canvas.png'))
    } catch (e) {
      c.setError(`Could not build the 16:9 canvas: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setCanvasBusy(false) }
  }

  // "Assemble my images": no AI. Tiles the finished pictures exactly as they are into one 16:9 sheet
  // (top row: face close-up or character photo, then a finished turnaround; bottom row: outfits,
  // props, location), each row sized so the pictures keep their shape, then files it in the library.
  const saveFinal = async () => {
    if (!finalPath) return
    const api = window.electronAPI
    const folder = saveFolder.trim() || 'Reference Sheets'
    try {
      if (!libFolders.some(f => f.toLowerCase() === folder.toLowerCase())) {
        const cr = await api.gpmLibCreateFolder({ name: folder })
        if (!cr.success) { setFinalMsg(`Could not save: ${cr.error}`); return }
      }
      const target = libFolders.find(f => f.toLowerCase() === folder.toLowerCase()) ?? folder
      const r = await api.gpmLibAddFiles({ folder: target, srcPaths: [finalPath], baseName: 'ingredients sheet' })
      if (!r.success) { setFinalMsg(`Could not save: ${r.error}`); return }
      if (!r.added) { setFinalMsg('Could not save: the library did not accept the file.'); return }
      const root = (await api.gpmLibGetRoot()).root
      setFinalMsg(`Saved to the library folder "${target}" (${root}). Use it as the Ingredients input.`)
    } catch (e) {
      setFinalMsg(`Could not save: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const assemble = async () => {
    setFinalPath(null)
    const top: RefImage[] = [
      ...(brief.refs.filter(r => r.role === 'face').slice(0, 1).length ? brief.refs.filter(r => r.role === 'face').slice(0, 1) : brief.refs.filter(r => r.role === 'character').slice(0, 1)),
      ...brief.refs.filter(r => r.role === 'turnaround'),
    ]
    // Character first (face close-up or photo, then turnarounds), then outfits, props, location.
    const order = [...top, ...bottomTiles(brief.refs)]
    if (order.length === 0) return
    setCanvasBusy(true)
    setFinalMsg(null)
    try {
      const W = 1920, H = 1080
      const imgs = await Promise.all(order.map(x => loadImg(x.path)))
      const tiles = layoutSheet(
        imgs.map((im, i) => ({
          aspect: im.naturalWidth / im.naturalHeight,
          keepTop: ['character', 'face', 'turnaround'].includes(order[i].role),
          weight: ['character', 'face', 'turnaround'].includes(order[i].role) ? 1.5 : 1,
        })),
        W, H, 24, 28,
      )
      const cv = document.createElement('canvas')
      cv.width = W; cv.height = H
      const g = cv.getContext('2d')
      if (!g) return
      // Looks like a reference sheet (light grey board, clear gaps, small role labels), so the
      // Ingredients IC-LoRA reads it as a sheet and not as a split-screen frame to animate.
      g.fillStyle = '#c9c9c9'
      g.fillRect(0, 0, W, H)
      g.font = '600 20px Arial, sans-serif'
      g.textBaseline = 'middle'
      for (const t of tiles) {
        const im = imgs[t.index]
        const nw = im.naturalWidth, nh = im.naturalHeight
        g.drawImage(im, t.sx * nw, t.sy * nh, t.sw * nw, t.sh * nh, t.dx, t.dy, t.dw, t.dh)
        const label = (ROLES.find(x => x.id === order[t.index].role)?.label ?? '').toUpperCase()
        if (label) {
          const tw = g.measureText(label).width
          g.fillStyle = 'rgba(20,20,20,0.75)'
          g.fillRect(t.dx + 10, t.dy + 10, tw + 20, 32)
          g.fillStyle = '#ffffff'
          g.fillText(label, t.dx + 20, t.dy + 26)
        }
      }
      const p = await saveDataUrlToTempFile(cv.toDataURL('image/png'), 'ingredients-sheet-assembled-16x9.png')
      setFinalPath(p)
      // Offer the library folders; default to a sheet-like one, else a new "Reference Sheets".
      try {
        const d = await window.electronAPI.gpmLibList()
        setLibFolders(d.folders)
        const same = d.folders.find(f => f.toLowerCase() === 'reference sheets') ?? d.folders.find(f => /sheet/i.test(f))
        setSaveFolder(same ?? 'Reference Sheets')
      } catch { setLibFolders([]); setSaveFolder('Reference Sheets') }
      setFinalMsg('Built. Pick a library folder and save it, or drag it from the preview.')
    } catch (e) {
      setFinalMsg(`Could not assemble those images: ${e instanceof Error ? e.message : String(e)}`)
    } finally { setCanvasBusy(false) }
  }
  const setRole = (i: number, role: RefRole) => setBrief(b => ({ ...b, refs: b.refs.map((r, j) => j === i ? { ...r, role } : r) }))
  const removeRef = (i: number) => setBrief(b => ({ ...b, refs: b.refs.filter((_, j) => j !== i) }))
  const hasCharacterRef = brief.refs.some(r => r.role === 'character')

  const fieldCls = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500'
  const labelCls = 'block text-xs font-medium text-zinc-400 mb-1.5'
  const pill = (on: boolean) => `px-3 py-1.5 rounded-lg text-xs border transition-colors ${
    on ? 'border-[rgb(var(--accent))] bg-[rgb(var(--accent)/0.15)] text-white' : 'border-zinc-700 text-zinc-400 hover:text-white'}`
  const { conn, auth, run } = c

  const Toggle = ({ k, label, hint }: { k: 'character' | 'outfits' | 'location' | 'props'; label: string; hint: string }) => (
    <button type="button" onClick={() => set(k, !brief[k])} title={hint}
      className={`flex-1 py-2 rounded-lg text-sm border transition-colors ${
        brief[k] ? 'border-[rgb(var(--accent))] bg-[rgb(var(--accent)/0.15)] text-white' : 'border-zinc-700 text-zinc-400 hover:text-white'}`}>
      {label}
    </button>
  )

  const cropping = cropIndex !== null ? brief.refs[cropIndex] : null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={close}>
      <div className="bg-zinc-900 rounded-2xl border border-zinc-700/50 shadow-2xl w-full max-w-lg relative overflow-hidden max-h-[calc(100dvh-2rem)] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-5 w-5 text-[rgb(var(--accent))]" />
            <h2 className="text-lg font-bold text-white">Make an Ingredients sheet</h2>
          </div>
          <button onClick={close} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {conn && !c.connected ? (
            <div className="rounded-xl border border-[rgb(var(--accent)/0.5)] bg-[rgb(var(--accent)/0.08)] px-4 py-3.5 space-y-2.5">
              <span className="text-sm font-semibold text-white">Connect Claude (one-time setup)</span>
              {conn.claudeFound ? (
                <>
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    Claude runs in your own Claude app, on your own plan. Connecting installs the RiX skills and lets Claude fill the prompt box.
                  </p>
                  <button onClick={() => void c.connect()} disabled={c.connecting}
                    className="px-4 py-2 rounded-lg bg-[rgb(var(--accent))] hover:brightness-110 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2 transition">
                    {c.connecting && <Loader2 className="h-4 w-4 animate-spin" />}
                    Connect Claude
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    Claude Code wasn't found on this computer. Install Claude Desktop, sign in, open its <span className="text-white">Code</span> tab once, then come back here.
                  </p>
                  <button onClick={() => void window.electronAPI.openExternalUrl({ url: 'https://claude.com/download' })}
                    className="px-4 py-2 rounded-lg border border-zinc-600 hover:border-zinc-400 text-white text-sm font-medium flex items-center gap-2 transition-colors">
                    <ExternalLink className="h-4 w-4" />Get Claude Desktop
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-3 space-y-2">
              <div className="flex items-center gap-2.5 text-xs text-zinc-300">
                <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${c.status?.running ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                {c.status?.running ? 'Connected to Claude' : 'Connected to Claude, but RiX is closed to it. Turn on "Allow Claude to use RiX" in Prompt with Claude (Video mode).'}
              </div>
              {conn && !conn.skillCurrent && (
                <button onClick={() => void c.connect(true)} disabled={c.connecting}
                  className="text-[11px] text-amber-300 hover:text-amber-200 underline underline-offset-2"
                  title="Installs the new sheet skill. Updating keeps a backup of any old file.">
                  Update the RiX skills
                </button>
              )}
            </div>
          )}

          {!run && c.connected && auth && auth.cliFound && !auth.loggedIn && (
            <div className="rounded-xl border border-[rgb(var(--accent)/0.5)] bg-[rgb(var(--accent)/0.08)] px-4 py-3.5 space-y-2.5">
              <span className="text-sm font-semibold text-white">One more step to write prompts here</span>
              <p className="text-xs text-zinc-300 leading-relaxed">
                Sign in once to your Claude account so Claude can run in the background. Your browser opens, you approve it, and you're done.
                You can still use "Open in the Claude app" without this.
              </p>
              <button onClick={() => void c.signIn()} disabled={c.signingIn}
                className="px-4 py-2 rounded-lg bg-[rgb(var(--accent))] hover:brightness-110 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2 transition">
                {c.signingIn && <Loader2 className="h-4 w-4 animate-spin" />}
                {c.signingIn ? 'Waiting for sign-in in your browser…' : 'Sign in to Claude'}
              </button>
            </div>
          )}

          {!run && (<>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Claude writes the image prompt for a reference sheet and puts it in the prompt box. Generate it here in Image mode,
              then use the result as the Ingredients input in IC-LoRA.{brief.refs.length > 0 ? ' Note: in RiX Image mode an input image is edited, so the result keeps that image\'s shape. For a 16:9 sheet use the button below, or generate with no input image.' : ''}
            </p>

            <div>
              <label className={labelCls}>What goes on the sheet?</label>
              <div className="flex gap-2">
                <Toggle k="character" label="Character" hint="One or two people, full body and face" />
                <Toggle k="outfits" label="Outfits" hint="Several outfits of the same character, one panel each" />
                <Toggle k="location" label="Location" hint="An empty wide plate of the place" />
                <Toggle k="props" label="Props" hint="Key objects, shown on their own" />
              </div>
              {!hasContent && <p className="mt-1.5 text-[11px] text-amber-300/80">Pick at least a character, a location or props, or add an image.</p>}
              {needsCharacterForOutfits && <p className="mt-1.5 text-[11px] text-amber-300/80">Outfits need a character. Turn Character on.</p>}
            </div>

            <div className={`rounded-xl border px-3 py-3 space-y-2.5 transition-colors ${dragOver ? 'border-[rgb(var(--accent))] bg-[rgb(var(--accent)/0.08)]' : 'border-zinc-800 bg-zinc-950/50'}`}
              onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true) }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false) }}
              onDrop={onDropRefs}>
              <div className="text-xs font-medium text-zinc-300">Images you already have (optional)</div>
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                Drop images here, add them, or pick them from your library: a character, an outfit, a location, a prop, or a finished sheet to convert. Claude reads each one, describes it exactly and builds the Ingredients sheet from them.
              </p>
              {brief.refs.map((r, i) => (
                <div key={r.path} className="flex items-center gap-2.5">
                  <img src={pathToFileUrl(r.path)} alt="" className="h-12 w-12 object-cover rounded-lg border border-zinc-700 flex-shrink-0" />
                  <select value={r.role} onChange={(e) => setRole(i, e.target.value as RefRole)}
                    className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-blue-500">
                    {ROLES.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500" title={r.path}>{r.path.split(/[\\/]/).pop()}</span>
                  <button type="button" title="Keep only part of this picture (exact pixels, no AI)"
                    onClick={() => setCropIndex(i)}
                    className="px-2 py-1 text-[11px] text-zinc-400 hover:text-white underline underline-offset-2">Crop</button>
                  {onCleanup && CLEANUP_PROMPTS[r.role] && (
                    <button type="button" title="Closes this window, loads the image as the Image input and fills the prompt box. Generate, then add the result back here."
                      onClick={() => { onCleanup(r.path, CLEANUP_PROMPTS[r.role] as string); onClose() }}
                      className="px-2 py-1 text-[11px] text-zinc-400 hover:text-white underline underline-offset-2">Clean background</button>
                  )}
                  <button type="button" onClick={() => removeRef(i)} className="px-2 py-1 text-xs text-zinc-500 hover:text-white">Remove</button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void addRefs()} disabled={brief.refs.length >= 8}
                  className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 text-xs text-zinc-300 transition-colors">
                  Add images
                </button>
                <button type="button" onClick={() => setLibOpen(o => !o)} disabled={brief.refs.length >= 8}
                  className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 text-xs text-zinc-300 transition-colors">
                  From library
                </button>
                {inputImage && !brief.refs.some(r => r.path === inputImage) && (
                  <button type="button" onClick={() => setBrief(bb => ({ ...bb, refs: [...bb.refs, { path: inputImage, role: 'character' }] }))}
                    className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 text-xs text-zinc-300 transition-colors">
                    Use the input image
                  </button>
                )}
              </div>
              {brief.refs.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {onUseCanvas && (
                    <button type="button" onClick={() => void makeCanvas()} disabled={canvasBusy}
                      title="Image mode edits keep the input image's shape. This puts the character on a 16:9 canvas and loads it as the Image input, so the sheet comes out 16:9."
                      className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 text-xs text-zinc-300 transition-colors">
                      {canvasBusy ? 'Working…' : 'Put the character on a 16:9 canvas → Image input'}
                    </button>
                  )}
                  <button type="button" onClick={() => void assemble()} disabled={canvasBusy}
                    title="No AI: tiles your finished pictures exactly as they are into one 16:9 sheet and saves it to the library. Add a face close-up and a turnaround (roles below) for the character row."
                    className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 text-xs text-zinc-300 transition-colors">
                    Assemble my images into a sheet (no AI)
                  </button>
                </div>
              )}
              {finalMsg && <p className={`text-[11px] ${finalMsg.startsWith('Could not') ? 'text-red-400' : 'text-emerald-300'}`}>{finalMsg}</p>}
              {finalPath && <img src={pathToFileUrl(finalPath)} alt="" className="w-full rounded-lg border border-zinc-700" />}
              {finalPath && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-zinc-400">Save to folder</span>
                  <input list="sheet-save-folders" value={saveFolder} onChange={(e) => setSaveFolder(e.target.value)}
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-blue-500" />
                  <datalist id="sheet-save-folders">{libFolders.map(f => <option key={f} value={f} />)}</datalist>
                  <button type="button" onClick={() => void saveFinal()}
                    className="px-3 py-1.5 rounded-lg bg-[rgb(var(--accent))] hover:brightness-110 text-white text-xs font-semibold transition">Save</button>
                </div>
              )}
              {libOpen && (
                <LibraryImagePicker selected={brief.refs.map(r => r.path)}
                  onPick={(p) => addPaths([p])} onClose={() => setLibOpen(false)} />
              )}
              {brief.refs.length > 0 && (
                <div className="space-y-1">
                  <div className="flex gap-1.5">
                    {([['describe', 'Describe them in words (new sheet)'], ['attach', 'Also attach as likeness']] as ['describe' | 'attach', string][]).map(([v, label]) => (
                      <button key={v} type="button" onClick={() => set('refUse', v)} className={pill(brief.refUse === v)}>{label}</button>
                    ))}
                  </div>
                  <p className="text-[11px] text-zinc-500 leading-relaxed">
                    {brief.refUse === 'describe'
                      ? 'Claude studies each image and writes a detailed description; the image model draws a brand-new sheet from the words alone. Any Image input is cleared when you start.'
                      : 'The images also go to the image model as references (an edit). Closer likeness, but the sheet can keep the photo\'s shape or background.'}
                  </p>
                </div>
              )}
              {hasCharacterRef && !brief.refs.some(r => r.role === 'outfit') && (
                <div className="flex gap-1.5">
                  {([[true, 'Keep their outfit'], [false, 'Use my outfit text']] as [boolean, string][]).map(([v, label]) => (
                    <button key={label} type="button" onClick={() => set('keepOutfit', v)} className={pill(brief.keepOutfit === v)}>{label}</button>
                  ))}
                </div>
              )}
            </div>

            {brief.character && (
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-zinc-400">
                      {hasCharacterRef ? 'Anything to change or add?' : 'Who is the character?'}
                    </label>
                    <div className="flex gap-1.5">
                      {([1, 2] as const).map(n => (
                        <button key={n} type="button" onClick={() => set('characterCount', n)} className={pill(brief.characterCount === n)}>
                          {n === 1 ? 'One' : 'Two'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea value={brief.characterText} onChange={(e) => set('characterText', e.target.value)} rows={3}
                    placeholder={hasCharacterRef
                      ? 'Optional. A name, or what to change: e.g. "Rosa. Dusty black duster coat instead of the jacket"'
                      : 'Name, age, build, a distinctive face, what they wear. e.g. Rosa, 34, lean, weathered face with a scar through one eyebrow, black leather vest and boots'}
                    className={`${fieldCls} resize-none`} />
                </div>
              </div>
            )}

            {brief.outfits && (
              <div>
                <label className={labelCls}>Which outfits? (one per line, up to four)</label>
                <textarea value={brief.outfitsText} onChange={(e) => set('outfitsText', e.target.value)} rows={3}
                  placeholder={'e.g.\nBlack leather vest and denim\nLong brown duster coat\nWhite nightdress'}
                  className={`${fieldCls} resize-none`} />
              </div>
            )}

            {brief.location && (
              <div>
                <label className={labelCls}>What is the location?</label>
                <textarea value={brief.locationText} onChange={(e) => set('locationText', e.target.value)} rows={2}
                  placeholder="e.g. a dim frontier saloon, long wooden bar, oil lamps, dusty window light"
                  className={`${fieldCls} resize-none`} />
              </div>
            )}

            {brief.props && (
              <div>
                <label className={labelCls}>Which props?</label>
                <textarea value={brief.propsText} onChange={(e) => set('propsText', e.target.value)} rows={2}
                  placeholder="e.g. a worn silver revolver, a leather satchel"
                  className={`${fieldCls} resize-none`} />
              </div>
            )}

            <div>
              <label className={labelCls}>Style</label>
              <div className="flex gap-2">
                {STYLES.map(s => (
                  <button key={s.id} type="button" onClick={() => set('style', s.id)} className={`flex-1 ${pill(brief.style === s.id)} py-2 text-sm`}>{s.label}</button>
                ))}
              </div>
            </div>

            <div>
              <label className={labelCls}>Shape of the image</label>
              <div className="flex gap-2">
                {ASPECTS.map(a => (
                  <button key={a} type="button" onClick={() => set('aspect', a)} className={`flex-1 ${pill(brief.aspect === a)} py-2 text-sm`}>{a}</button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-zinc-500 leading-relaxed">16:9 suits a full sheet. 3:2 or 1:1 suits a character on their own.</p>
            </div>

            <details className="rounded-xl border border-zinc-800 bg-zinc-950/50">
              <summary className="px-4 py-2.5 text-xs text-zinc-400 cursor-pointer select-none">What Claude will receive</summary>
              <pre className="px-4 pb-3 text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap font-mono">{prompt}</pre>
            </details>
          </>)}

          {run && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-4 space-y-3">
              <ul className="space-y-1.5">
                {run.lines.map((l, i) => {
                  const last = i === run.lines.length - 1
                  return (
                    <li key={l} className="flex items-center gap-2 text-sm text-zinc-300">
                      {run.phase === 'running' && last
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[rgb(var(--accent))]" />
                        : <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 mx-1" />}
                      {l}
                    </li>
                  )
                })}
              </ul>
              {run.phase !== 'running' && run.reply && (
                <p className={`text-sm leading-relaxed whitespace-pre-wrap ${run.phase === 'error' ? 'text-red-400' : 'text-zinc-200'}`}>{run.reply}</p>
              )}
              {run.phase === 'done' && (
                <p className="text-[11px] text-zinc-500">The sheet prompt is in the prompt box. Generate it in Image mode.</p>
              )}
              {run.phase === 'done' && run.sessionId && (
                <div className="flex gap-2 pt-1">
                  <input value={followUp} onChange={(e) => setFollowUp(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') sendFollowUp() }}
                    placeholder="Ask for a change, e.g. add a second prop, make her older"
                    className={fieldCls} autoFocus />
                  <button onClick={sendFollowUp} disabled={!followUp.trim()}
                    className="px-4 rounded-lg bg-[rgb(var(--accent))] hover:brightness-110 disabled:opacity-40 text-white text-sm font-semibold transition">
                    Send
                  </button>
                </div>
              )}
            </div>
          )}

          {c.error && <p className="text-sm text-red-400">{c.error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-zinc-800 space-y-2">
          {!run ? (
            <>
              <button onClick={writeHere} disabled={!c.canRunHere || !valid}
                className="w-full py-3 rounded-xl bg-[rgb(var(--accent))] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm flex items-center justify-center gap-2 transition">
                <Sparkles className="h-4 w-4" />
                Write the sheet prompt here
              </button>
              <button onClick={() => void openInClaude()} disabled={!c.ready || opening || !valid}
                className="w-full py-2 rounded-xl border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-300 text-sm flex items-center justify-center gap-2 transition-colors">
                {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                Open in the Claude app instead
              </button>
            </>
          ) : run.phase === 'running' ? (
            <button onClick={c.cancel}
              className="w-full py-3 rounded-xl border border-zinc-600 hover:border-zinc-400 text-white text-sm font-medium transition-colors">
              Stop
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => c.setRun(null)}
                className="flex-1 py-3 rounded-xl border border-zinc-700 hover:border-zinc-500 text-zinc-300 text-sm transition-colors">
                Change answers
              </button>
              <button onClick={onClose}
                className="flex-1 py-3 rounded-xl bg-[rgb(var(--accent))] hover:brightness-110 text-white font-semibold text-sm transition">
                Done
              </button>
            </div>
          )}
        </div>
      </div>
      {cropping && cropIndex !== null && (
        <CropImageDialog path={cropping.path} onClose={() => setCropIndex(null)}
          onDone={(np) => { setBrief(b => ({ ...b, refs: b.refs.map((r, j) => j === cropIndex ? { ...r, path: np } : r) })); setCropIndex(null) }} />
      )}
    </div>,
    document.body,
  )
}

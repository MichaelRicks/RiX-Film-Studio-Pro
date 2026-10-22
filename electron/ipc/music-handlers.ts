import { app, dialog, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { getMainWindow } from '../window'
import { logger } from '../logger'
import { resolveLibraryRoot } from '../gpm-library-root'
import { computeAudioEnvelope } from '../audio-envelope'
import { findFfmpegPath } from '../export/ffmpeg-utils'
import { handle } from './typed-handle'

// The editor's Music tab. Songs live in one folder on the user's computer; an optional
// catalogue.json beside them gives each song a title, genre, mood and tempo. Without
// one, every audio file in the folder is listed under its filename, so pointing the tab
// at any folder of music works. Where the files come from (copied in by hand today,
// downloaded on demand later) does not matter to this code.

const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'])
const PACK_FOLDER = 'RiX Film Studio Pro Music'
const CATALOGUE = 'catalogue.json'

const configPath = () => path.join(app.getPath('userData'), 'music-library-root.json')
let cachedOverride: string | null | undefined

function loadOverride(): string | null {
  if (cachedOverride !== undefined) return cachedOverride
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf-8')) as { root?: string }
    cachedOverride = parsed.root && fs.existsSync(parsed.root) ? parsed.root : null
  } catch {
    cachedOverride = null
  }
  return cachedOverride
}

function setOverride(root: string | null): void {
  cachedOverride = root
  try { fs.writeFileSync(configPath(), JSON.stringify({ root })) } catch { /* best effort */ }
}

/** The folder the tab reads: the user's choice, else Music/<pack> inside the RiX library
 *  folder if it exists, else a `music` folder in the app's data directory. */
function musicRoot(): string {
  const override = loadOverride()
  if (override) return override
  const inLibrary = path.join(resolveLibraryRoot(), 'Music', PACK_FOLDER)
  if (fs.existsSync(inLibrary)) return inLibrary
  return path.join(app.getPath('userData'), 'music')
}

type Vocal = 'instrumental' | 'vocal' | 'unknown'
type Energy = 'low' | 'medium' | 'high' | 'unknown'

interface Track {
  id: string; path: string; title: string; version: string; genre: string; mood: string[]
  vocal: Vocal; energy: Energy; seconds: number; bpm: number; reviewNote: string
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

function readLibrary() {
  const root = musicRoot()
  const exists = fs.existsSync(root)
  if (!exists) return { root, exists, hasCatalogue: false, license: '', tracks: [] as Track[] }

  const files = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile() && AUDIO_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)

  const cataloguePath = path.join(root, CATALOGUE)
  if (fs.existsSync(cataloguePath)) {
    try {
      const doc = JSON.parse(fs.readFileSync(cataloguePath, 'utf-8')) as { license?: unknown; tracks?: unknown }
      const tracks: Track[] = []
      for (const raw of Array.isArray(doc.tracks) ? doc.tracks : []) {
        const t = raw as Record<string, unknown>
        const file = str(t.file)
        // A catalogue entry only counts if its audio file is actually in the folder.
        if (!file || !files.includes(file)) continue
        tracks.push({
          id: str(t.id, file),
          path: path.join(root, file),
          title: str(t.title, path.basename(file, path.extname(file))),
          version: str(t.version),
          genre: str(t.genre, 'Other'),
          mood: Array.isArray(t.mood) ? t.mood.filter((m): m is string => typeof m === 'string') : [],
          vocal: oneOf(t.vocal, ['instrumental', 'vocal', 'unknown'] as const, 'unknown'),
          energy: oneOf(t.energy, ['low', 'medium', 'high', 'unknown'] as const, 'unknown'),
          seconds: num(t.seconds),
          bpm: Math.round(num(t.bpm)),
          reviewNote: str(t.reviewNote),
        })
      }
      return { root, exists, hasCatalogue: true, license: str(doc.license), tracks }
    } catch (e) {
      logger.warn(`music catalogue unreadable, listing files instead: ${e}`)
    }
  }

  const tracks: Track[] = files.sort((a, b) => a.localeCompare(b)).map((file) => ({
    id: file,
    path: path.join(root, file),
    title: path.basename(file, path.extname(file)),
    version: '', genre: 'Other', mood: [], vocal: 'unknown', energy: 'unknown', seconds: 0, bpm: 0, reviewNote: '',
  }))
  return { root, exists, hasCatalogue: false, license: '', tracks }
}

export function registerMusicHandlers(): void {
  handle('musicLibList', () => readLibrary())

  // Loudness over time of a clip's source file, for auto-ducking (see shared/music-ducking.ts).
  handle('audioEnvelope', async ({ path: filePath }) => {
    const ffmpegPath = findFfmpegPath()
    return ffmpegPath ? computeAudioEnvelope(ffmpegPath, filePath) : { hop: 0.05, db: [] }
  })

  handle('musicLibChooseRoot', async () => {
    const win = getMainWindow()
    const options = { title: 'Choose your music folder', properties: ['openDirectory' as const] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { root: null }
    setOverride(result.filePaths[0])
    return { root: result.filePaths[0] }
  })

  handle('musicLibResetRoot', () => {
    setOverride(null)
    return { root: musicRoot() }
  })

  handle('musicLibReveal', () => {
    try {
      const root = musicRoot()
      fs.mkdirSync(root, { recursive: true })
      void shell.openPath(root)
      return { success: true as const }
    } catch (e) {
      logger.warn(`musicLibReveal failed: ${e}`)
      return { success: false as const, error: 'reveal failed' }
    }
  })
}

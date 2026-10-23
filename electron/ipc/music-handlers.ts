import { app, dialog, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import http from 'http'
import https from 'https'
import { pipeline } from 'stream/promises'
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

/** Where the song pack is published: a GitHub release holding catalogue.json and one MP3 per song,
 *  under file names that survive GitHub's renaming (no spaces). RIX_MUSIC_PACK_URL overrides it for testing. */
const PACK_BASE = (process.env.RIX_MUSIC_PACK_URL || 'https://github.com/MichaelRicks/RiX-Film-Studio-Pro/releases/download/music-v1').replace(/\/$/, '')

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
  vocal: Vocal; energy: Energy; seconds: number; bpm: number; beats: number[]; reviewNote: string
  /** Whether the file is in the music folder; if not, `remote` names it in the song pack. */
  local: boolean; remote: string; bytes: number
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
        // A catalogue entry counts if its file is in the folder, or can be downloaded from the pack.
        const remote = str(t.remote)
        if (!file || (!files.includes(file) && !remote)) continue
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
          beats: Array.isArray(t.beats) ? t.beats.filter((b): b is number => typeof b === 'number' && Number.isFinite(b)) : [],
          reviewNote: str(t.reviewNote),
          local: files.includes(file),
          remote,
          bytes: num(t.bytes),
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
    version: '', genre: 'Other', mood: [], vocal: 'unknown', energy: 'unknown', seconds: 0, bpm: 0, beats: [], reviewNote: '', local: true, remote: '', bytes: 0,
  }))
  return { root, exists, hasCatalogue: false, license: '', tracks }
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try { return await fetch(url, { signal: controller.signal }) } finally { clearTimeout(timer) }
}

/**
 * Brings the default music folder's catalogue up to date with the published song pack: songs the
 * pack has that the catalogue does not are added (their files are downloaded later, when used).
 * Never touches a folder the user chose themselves, nor a catalogue entry they already have.
 */
async function syncWithPack(): Promise<{ online: boolean; added: number }> {
  if (loadOverride()) return { online: false, added: 0 }
  let remote: { license?: unknown; tracks?: unknown }
  try {
    const res = await fetchWithTimeout(`${PACK_BASE}/${CATALOGUE}`, 8000)
    if (!res.ok) return { online: false, added: 0 }
    remote = await res.json() as typeof remote
  } catch {
    return { online: false, added: 0 }
  }
  const root = musicRoot()
  fs.mkdirSync(root, { recursive: true })
  const cataloguePath = path.join(root, CATALOGUE)
  let local: { name?: string; license?: string; tracks: Array<Record<string, unknown>> } = { tracks: [] }
  try { local = JSON.parse(fs.readFileSync(cataloguePath, 'utf-8')) } catch { /* no catalogue yet */ }
  if (!Array.isArray(local.tracks)) local.tracks = []

  const known = new Set(local.tracks.flatMap((t) => [str(t.id), str(t.file)]))
  let added = 0
  for (const raw of Array.isArray(remote.tracks) ? remote.tracks : []) {
    const t = raw as Record<string, unknown>
    if (!str(t.id) || !str(t.file) || !str(t.remote) || known.has(str(t.id)) || known.has(str(t.file))) continue
    local.tracks.push(t)
    added += 1
  }
  if (!local.license && typeof remote.license === 'string') local.license = remote.license
  if (added > 0 || !fs.existsSync(cataloguePath)) {
    fs.writeFileSync(cataloguePath, JSON.stringify(local, null, 2) + '\n', 'utf-8')
  }
  return { online: true, added }
}

/** GET a URL, following redirects (a GitHub release download redirects to its file host). */
function openUrl(url: string, redirectsLeft = 5): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https:') ? https.get : http.get
    const req = get(url, { headers: { 'User-Agent': 'RiX-Film-Studio-Pro' } }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        if (redirectsLeft <= 0) { reject(new Error('The download kept redirecting.')); return }
        resolve(openUrl(new URL(res.headers.location, url).toString(), redirectsLeft - 1))
        return
      }
      resolve(res)
    })
    req.setTimeout(30_000, () => req.destroy(new Error('The download timed out.')))
    req.on('error', reject)
  })
}

const downloading = new Map<string, Promise<string>>()

/** Downloads one song of the pack into the music folder (if it is not there) and returns its path. */
function downloadTrack(id: string): Promise<string> {
  const track = readLibrary().tracks.find((t) => t.id === id)
  if (!track) return Promise.reject(new Error('That song is not in the library.'))
  if (track.local) return Promise.resolve(track.path)
  if (!track.remote) return Promise.reject(new Error('That song has no download.'))
  const inFlight = downloading.get(id)
  if (inFlight) return inFlight

  const job = (async () => {
    const partial = `${track.path}.part`
    try {
      const res = await openUrl(`${PACK_BASE}/${encodeURIComponent(track.remote)}`)
      if (res.statusCode !== 200) { res.resume(); throw new Error(`The download failed (${res.statusCode ?? 'no answer'}).`) }
      await pipeline(res, fs.createWriteStream(partial))
      const size = fs.statSync(partial).size
      if (track.bytes > 0 && size !== track.bytes) throw new Error('The download was incomplete. Try again.')
      fs.renameSync(partial, track.path)
      return track.path
    } catch (e) {
      try { fs.rmSync(partial, { force: true }) } catch { /* nothing to clean */ }
      throw e
    } finally {
      downloading.delete(id)
    }
  })()
  downloading.set(id, job)
  return job
}

/** `Name.mp3`, or `Name (2).mp3` and so on if that is taken. */
function uniqueName(dir: string, name: string): string {
  const ext = path.extname(name)
  const base = path.basename(name, ext)
  let candidate = name
  for (let n = 2; fs.existsSync(path.join(dir, candidate)); n++) candidate = `${base} (${n})${ext}`
  return candidate
}

/**
 * Copies songs into the music folder. When the folder has a catalogue each song also gets an entry
 * (title from the file name, genre "My music"; length measured, no beats); without one the files
 * are simply listed by name, so a folder the user chose keeps working as it did.
 */
async function importSongs(paths: string[]): Promise<{ added: number; skipped: number }> {
  const root = musicRoot()
  fs.mkdirSync(root, { recursive: true })
  const cataloguePath = path.join(root, CATALOGUE)
  let catalogue: { tracks: Array<Record<string, unknown>> } | null = null
  if (fs.existsSync(cataloguePath)) {
    try { catalogue = JSON.parse(fs.readFileSync(cataloguePath, 'utf-8')) } catch { catalogue = null }
    if (catalogue && !Array.isArray(catalogue.tracks)) catalogue.tracks = []
  }
  const ffmpegPath = findFfmpegPath()
  const ids = new Set((catalogue?.tracks ?? []).map((t) => str(t.id)))

  let added = 0
  let skipped = 0
  for (const source of paths) {
    const ext = path.extname(source).toLowerCase()
    if (!AUDIO_EXT.has(ext) || !fs.existsSync(source) || !fs.statSync(source).isFile()) { skipped += 1; continue }
    // Already in the folder (picked from there): nothing to copy.
    if (path.resolve(path.dirname(source)) === path.resolve(root)) { skipped += 1; continue }
    const file = uniqueName(root, path.basename(source))
    fs.copyFileSync(source, path.join(root, file))
    added += 1
    if (!catalogue) continue

    const title = path.basename(file, path.extname(file)).replace(/_+/g, ' ').trim()
    let id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song'
    for (let n = 2; ids.has(id); n++) id = `${id.replace(/-\d+$/, '')}-${n}`
    ids.add(id)
    const envelope = ffmpegPath ? await computeAudioEnvelope(ffmpegPath, path.join(root, file)) : null
    catalogue.tracks.push({
      id, file, title, version: '', genre: 'My music', mood: [], vocal: 'unknown', energy: 'unknown',
      seconds: envelope ? Math.round(envelope.db.length * envelope.hop * 10) / 10 : 0, bpm: 0,
    })
  }
  if (catalogue && added > 0) fs.writeFileSync(cataloguePath, JSON.stringify(catalogue, null, 2) + '\n', 'utf-8')
  return { added, skipped }
}

export function registerMusicHandlers(): void {
  handle('musicLibSync', () => syncWithPack())

  handle('musicLibImport', async ({ paths }) => {
    try {
      let chosen = paths
      if (!chosen) {
        const win = getMainWindow()
        const options = {
          title: 'Add music to your library',
          properties: ['openFile' as const, 'multiSelections' as const],
          filters: [{ name: 'Audio', extensions: [...AUDIO_EXT].map((e) => e.slice(1)) }],
        }
        const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
        if (result.canceled) return { success: true as const, added: 0, skipped: 0 }
        chosen = result.filePaths
      }
      return { success: true as const, ...(await importSongs(chosen)) }
    } catch (e) {
      logger.warn(`musicLibImport failed: ${e}`)
      return { success: false as const, error: e instanceof Error ? e.message : 'Could not add the music.' }
    }
  })

  handle('musicLibDownload', async ({ id }) => {
    try { return { success: true as const, path: await downloadTrack(id) } }
    catch (e) { return { success: false as const, error: e instanceof Error ? e.message : 'download failed' } }
  })

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

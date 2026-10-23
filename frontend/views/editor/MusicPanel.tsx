/**
 * MUSIC: browse the songs in the music folder, preview them, and add one to the timeline.
 * The folder and its optional catalogue.json are read by the main process
 * (electron/ipc/music-handlers.ts); this panel only lists, plays and adds.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Cloud, FolderOpen, Loader2, Music, Pause, Play, Plus, Search } from 'lucide-react'
import type { ElectronAPI } from '../../../shared/electron-api-schema'
import { addGenericAssetToProject } from '../../lib/asset-copy'
import { pathToFileUrl } from '../../lib/file-url'
import { logger } from '../../lib/logger'
import type { Asset } from '../../types/project-model'
import { selectClips, selectCurrentTime } from './editor-selectors'
import { useEditorActions, useEditorStore } from './editor-store'
import { MUSIC_DND, defaultMusicDuck, getAutoDuckDefault, getFitDefault, setAutoDuckDefault, setFitDefault } from './music-settings'
import { isLibraryMusic, useMusicDucking } from './useMusicDucking'

type MusicLibrary = Awaited<ReturnType<ElectronAPI['musicLibList']>>
type MusicTrack = MusicLibrary['tracks'][number]

function formatLength(seconds: number): string {
  if (!(seconds > 0)) return ''
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** The audio file's real length; the catalogue's figure is only to one decimal. */
function measureAudio(url: string, fallback: number): Promise<number> {
  return new Promise((resolve) => {
    const media = document.createElement('audio')
    media.preload = 'metadata'
    media.src = url
    media.onloadedmetadata = () => resolve(Number.isFinite(media.duration) && media.duration > 0 ? media.duration : fallback)
    media.onerror = () => resolve(fallback)
  })
}

export function MusicPanel({ currentProjectId }: { currentProjectId: string | null }) {
  const { addAudioAssetOnFreeTrack } = useEditorActions()
  const ducking = useMusicDucking()
  const clips = useEditorStore(selectClips)
  const currentTime = useEditorStore(selectCurrentTime)

  const [library, setLibrary] = useState<MusicLibrary | null>(null)
  const [query, setQuery] = useState('')
  const [genre, setGenre] = useState<string | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<ReadonlySet<string>>(new Set())
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null)
  const [downloadError, setDownloadError] = useState('')
  const [importNote, setImportNote] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [autoDuckDefault, setAutoDuckDefaultState] = useState(getAutoDuckDefault)
  const [fitToVideo, setFitToVideo] = useState(getFitDefault)
  // The box shows what the music already on the timeline is doing; with none, the default for new music.
  const musicOnTimeline = useMemo(() => clips.filter(isLibraryMusic), [clips])
  const autoDuck = musicOnTimeline.length > 0 ? musicOnTimeline.some(c => c.duck?.enabled) : autoDuckDefault
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const reload = useCallback(async () => {
    try { setLibrary(await window.electronAPI.musicLibList()) } catch (e) { logger.warn(`music library load failed: ${e}`) }
  }, [])

  // Show what is on disk straight away, then ask the song pack for anything new.
  useEffect(() => {
    void reload()
    void window.electronAPI.musicLibSync().then((r) => { if (r.added > 0) void reload() }).catch(() => {})
  }, [reload])

  /** The song's file path, downloading it from the pack first if it is not on this computer yet. */
  const ensureLocal = useCallback(async (track: MusicTrack): Promise<string | null> => {
    if (track.local) return track.path
    setDownloadError('')
    setDownloading((prev) => new Set(prev).add(track.id))
    try {
      const result = await window.electronAPI.musicLibDownload({ id: track.id })
      if (!result.success) { setDownloadError(result.error); return null }
      setLibrary((lib) => lib && { ...lib, tracks: lib.tracks.map((t) => (t.id === track.id ? { ...t, local: true } : t)) })
      return result.path
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : 'The download failed.')
      return null
    } finally {
      setDownloading((prev) => { const next = new Set(prev); next.delete(track.id); return next })
    }
  }, [])

  /** Copies songs into the music folder: the ones picked in the file dialog, or `paths` dropped on the panel. */
  const importMusic = async (paths?: string[]) => {
    setImportNote('')
    const result = await window.electronAPI.musicLibImport({ paths }).catch((e: unknown) => ({ success: false as const, error: String(e) }))
    if (!result.success) { setImportNote(result.error); return }
    if (result.added > 0) {
      setImportNote(`Added ${result.added} song${result.added === 1 ? '' : 's'}.`)
      await reload()
    } else if (paths) {
      setImportNote('Drop MP3, WAV, M4A, OGG, FLAC or AAC files to add them.')
    }
  }

  const downloadAll = async () => {
    const todo = (library?.tracks ?? []).filter((t) => !t.local)
    setBulk({ done: 0, total: todo.length })
    for (let i = 0; i < todo.length; i++) {
      if (!(await ensureLocal(todo[i]))) break
      setBulk({ done: i + 1, total: todo.length })
    }
    setBulk(null)
  }

  const stop = useCallback(() => {
    audioRef.current?.pause()
    setPlayingId(null)
    setProgress(0)
  }, [])

  // One audio element for previews, dropped when the tab closes.
  useEffect(() => () => {
    const audio = audioRef.current
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() }
  }, [])

  const togglePlay = async (track: MusicTrack) => {
    if (playingId === track.id) { stop(); return }
    if (!(await ensureLocal(track))) return
    if (!audioRef.current) {
      const audio = new Audio()
      audio.onended = () => { setPlayingId(null); setProgress(0) }
      audio.ontimeupdate = () => setProgress(audio.duration > 0 ? audio.currentTime / audio.duration : 0)
      audioRef.current = audio
    }
    const audio = audioRef.current
    audio.src = pathToFileUrl(track.path)
    setProgress(0)
    setPlayingId(track.id)
    audio.play().catch((e) => { logger.warn(`music preview failed: ${e}`); setPlayingId(null) })
  }

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current
    if (!audio || !(audio.duration > 0)) return
    const rect = e.currentTarget.getBoundingClientRect()
    audio.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * audio.duration
  }

  const addToTimeline = async (track: MusicTrack) => {
    if (addingId) return
    setAddingId(track.id)
    try {
      if (!(await ensureLocal(track))) return
      // Copy into the project like any imported audio, so the project keeps working
      // when the music folder moves; fall back to the library file if the copy fails.
      const copied = currentProjectId ? await addGenericAssetToProject(track.path, currentProjectId) : null
      const path = copied?.path ?? track.path
      const duration = await measureAudio(pathToFileUrl(path), track.seconds || 5)
      const asset: Asset = {
        id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        type: 'audio',
        path,
        prompt: `Music: ${track.title}${track.version ? ` (${track.version})` : ''}`,
        resolution: 'music',
        duration,
        createdAt: Date.now(),
        ...(track.beats.length > 0 ? { beats: track.beats } : {}),
      }
      addAudioAssetOnFreeTrack({ asset, startTime: currentTime, duck: defaultMusicDuck(), fitToProgram: fitToVideo })
      ducking.applyForAsset(asset.id)
    } finally {
      setAddingId(null)
    }
  }

  const genres = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of library?.tracks ?? []) counts.set(t.genre, (counts.get(t.genre) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([g]) => g)
  }, [library])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (library?.tracks ?? []).filter((t) => {
      if (genre && t.genre !== genre) return false
      if (!q) return true
      return [t.title, t.version, t.genre, ...t.mood].some((s) => s.toLowerCase().includes(q))
    })
  }, [library, query, genre])

  const total = library?.tracks.length ?? 0
  const status = !library ? 'Loading…'
    : total === 0 ? 'No music found yet.'
      : `${visible.length === total ? total : `${visible.length} of ${total}`} songs. Double-click or drag to add. Hold Alt while moving a clip to snap to the beats.`

  return (
    <div
      className={`flex flex-col min-h-0 h-full border-r border-zinc-800 ${dragOver ? 'ring-1 ring-inset ring-blue-500/70 bg-blue-500/5' : ''}`}
      onDragOver={(e) => {
        // Audio files from Explorer. Songs being dragged out of this list are not files, so they pass through.
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!dragOver) setDragOver(true)
      }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false) }}
      onDrop={(e) => {
        setDragOver(false)
        if (e.dataTransfer.files.length === 0) return
        e.preventDefault()
        const paths = Array.from(e.dataTransfer.files).map((file) => window.electronAPI.getPathForFile(file)).filter(Boolean)
        void importMusic(paths)
      }}
    >
      <div className="p-4 pb-2 flex-shrink-0">
        <h3 className="text-sm font-semibold tracking-wider text-white">MUSIC</h3>
        <p className="mt-0.5 text-[11px] text-zinc-500">{status}</p>
      </div>

      {total > 0 && (
        <div className="px-4 pb-2 flex-shrink-0 space-y-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-600" />
            <input
              type="text"
              placeholder="Search title, genre or mood"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-7 pr-2 py-1.5 bg-zinc-800/70 rounded-md text-[11px] text-white placeholder-zinc-600 outline-none border border-zinc-700/40 focus:border-blue-500/50"
            />
          </div>
          {genres.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {[null, ...genres].map((g) => (
                <button
                  key={g ?? 'all'}
                  onClick={() => setGenre(g)}
                  className={`px-2 py-0.5 rounded-full text-[10px] transition-colors ${
                    genre === g ? 'bg-blue-500/20 text-blue-300 border border-blue-500/50' : 'text-zinc-400 border border-zinc-700 hover:border-zinc-500'
                  }`}
                >
                  {g ?? 'All'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto px-2 pb-2 custom-scrollbar">
        {library && total === 0 && (
          <div className="px-2 py-6 text-center text-[11px] text-zinc-500 space-y-3">
            <Music className="h-6 w-6 mx-auto text-zinc-700" />
            <p>Add music files (MP3, WAV…) with Import music, drop them here, or choose a folder that has some.</p>
          </div>
        )}
        {visible.map((track) => {
          const playing = playingId === track.id
          const meta = [track.genre, ...track.mood.slice(0, 2)].join(' · ')
          const facts = [formatLength(track.seconds), track.bpm > 0 ? `~${track.bpm} BPM` : '', track.vocal === 'vocal' ? 'vocals' : ''].filter(Boolean).join(' · ')
          return (
            <div
              key={track.id}
              onDoubleClick={() => { void addToTimeline(track) }}
              draggable={track.local}
              onDragStart={(e) => {
                e.dataTransfer.setData(MUSIC_DND, JSON.stringify({ path: track.path, title: track.title, beats: track.beats }))
                e.dataTransfer.effectAllowed = 'copy'
              }}
              className={`group rounded-md px-2 py-1.5 transition-colors ${playing ? 'bg-zinc-800/80' : 'hover:bg-zinc-800/50'}`}
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { void togglePlay(track) }}
                  title={playing ? 'Stop preview' : track.local ? 'Preview' : 'Download and preview'}
                  className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center transition-colors ${
                    playing ? 'bg-blue-500 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  {downloading.has(track.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3 ml-px" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-zinc-100 truncate">{track.title}</span>
                    {track.version && <span className="text-[9px] text-zinc-500 flex-shrink-0">{track.version}</span>}
                    {track.reviewNote && (
                      <span title={track.reviewNote} className="flex-shrink-0 text-amber-400"><AlertTriangle className="h-3 w-3" /></span>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-500 truncate">{meta}</div>
                  {(facts || !track.local) && (
                    <div className="text-[10px] text-zinc-600 truncate flex items-center gap-1">
                      {!track.local && <Cloud className="h-2.5 w-2.5 flex-shrink-0" aria-label="Not on this computer yet" />}
                      {[facts, !track.local && track.bytes > 0 ? `${(track.bytes / 1048576).toFixed(1)} MB` : ''].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => { void addToTimeline(track) }}
                  disabled={addingId !== null}
                  title="Add to the timeline at the playhead"
                  className="w-7 h-7 rounded-md flex-shrink-0 flex items-center justify-center text-zinc-500 hover:text-white hover:bg-zinc-700 disabled:opacity-40 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              {playing && (
                <div onClick={seek} className="mt-1.5 h-1.5 rounded-full bg-zinc-700 cursor-pointer overflow-hidden">
                  <div className="h-full bg-blue-500" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex-shrink-0 px-4 py-2 border-t border-zinc-800/80 space-y-1">
        {library && library.tracks.some((t) => !t.local) && (
          <div className="pb-1">
            <button
              className="flex items-center gap-1.5 text-[10px] text-zinc-400 hover:text-blue-400 disabled:opacity-60 transition-colors"
              disabled={bulk !== null}
              onClick={() => { void downloadAll() }}
              title="Download every song that is not on this computer yet"
            >
              <Cloud className="h-3 w-3" />
              {bulk
                ? `Downloading ${bulk.done} of ${bulk.total}…`
                : `Download all ${library.tracks.filter((t) => !t.local).length} songs (${(library.tracks.filter((t) => !t.local).reduce((sum, t) => sum + t.bytes, 0) / 1048576).toFixed(0)} MB)`}
            </button>
          </div>
        )}
        {downloadError && <p className="text-[10px] text-red-400 leading-snug">{downloadError}</p>}
        {importNote && <p className="text-[10px] text-zinc-400 leading-snug">{importNote}</p>}
        <label className="flex items-center gap-2 cursor-pointer" title="A song longer than the video is cut where the video ends, with a fade-out. You can also fit any clip from its properties.">
          <input
            type="checkbox"
            checked={fitToVideo}
            onChange={(e) => { setFitToVideo(e.target.checked); setFitDefault(e.target.checked) }}
            className="rounded bg-zinc-800 border-zinc-600"
          />
          <span className="text-[11px] text-zinc-300">Fit new music to the video</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer pb-1" title="Music lowers itself while other clips on the timeline are speaking. This switches it for all the music on this timeline and for music you add next. The dips are volume keyframes on each clip that you can drag.">
          <input
            type="checkbox"
            checked={autoDuck}
            onChange={(e) => {
              setAutoDuckDefaultState(e.target.checked)
              setAutoDuckDefault(e.target.checked)
              const ids = musicOnTimeline.map(c => c.id)
              if (e.target.checked) void ducking.enable(ids)
              else ducking.remove(ids)
            }}
            className="rounded bg-zinc-800 border-zinc-600"
          />
          <span className="text-[11px] text-zinc-300">Auto-duck music under dialogue</span>
        </label>
        {library?.license && <p className="text-[9px] text-zinc-600 leading-snug">{library.license}</p>}
        <p className="text-[9px] text-zinc-600 truncate" title={library?.root}>{library?.root}</p>
        <div className="flex items-center gap-3">
          <button
            className="flex items-center gap-1 text-[10px] text-zinc-300 hover:text-blue-400 transition-colors"
            onClick={() => { void importMusic() }}
            title="Add songs from your computer to this library. You can also drop audio files onto this panel."
          >
            <Plus className="h-3 w-3" />
            Import music
          </button>
          <button
            className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-blue-400 transition-colors"
            onClick={() => { void window.electronAPI.musicLibReveal() }}
          >
            <FolderOpen className="h-3 w-3" />
            Open folder
          </button>
          <button
            className="text-[10px] text-zinc-500 hover:text-blue-400 transition-colors"
            onClick={() => { stop(); void window.electronAPI.musicLibChooseRoot().then((r) => { if (r.root) void reload() }) }}
          >
            Choose folder…
          </button>
          <button
            className="text-[10px] text-zinc-500 hover:text-blue-400 transition-colors"
            onClick={() => { stop(); void window.electronAPI.musicLibResetRoot().then(() => reload()) }}
          >
            Reset
          </button>
          <button className="ml-auto text-[10px] text-zinc-500 hover:text-blue-400 transition-colors" onClick={() => { void reload() }}>
            Refresh
          </button>
        </div>
      </div>
    </div>
  )
}

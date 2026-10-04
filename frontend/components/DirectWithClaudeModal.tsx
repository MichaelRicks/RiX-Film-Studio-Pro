import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clapperboard, ExternalLink, Loader2, X } from 'lucide-react'
import type { Asset } from '../types/project-model'

/**
 * "Edit with Claude": turns a short brief into a prompt and opens it, prefilled,
 * in Claude Desktop's Code tab. Claude runs in the user's OWN Claude app on their
 * own plan (no API keys / per-call billing) and edits the timeline through the RiX
 * MCP server + rix-editor skill. The user presses Send in Claude.
 */

type Aspect = '9:16' | '16:9' | '1:1'

type ClipTransition = 'cut' | 'dissolve' | 'dip-to-black'

const TRANSITION_OPTIONS: Array<{ value: ClipTransition; label: string; brief: string }> = [
  { value: 'cut', label: 'Straight cuts', brief: 'straight cuts between clips (a fade from black at the start and to black at the end is fine)' },
  { value: 'dissolve', label: 'Cross dissolve', brief: 'cross dissolve between every clip' },
  { value: 'dip-to-black', label: 'Dip to black', brief: 'dip to black between every clip' },
]

type DirectorMode = 'new' | 'revise'

export interface DirectorBrief {
  mode: DirectorMode
  // Revise mode: the existing timeline to change, and whether to work on a copy of it
  timelineId: string
  reviseCopy: boolean
  lengthSec: number
  aspect: Aspect
  folder: string // '' = let Claude choose from all footage
  musicPath: string // '' = no music
  transition: ClipTransition
  title: string
  notes: string
  shotListFirst: boolean
  exportWhenDone: boolean
}

function buildRevisePrompt(
  brief: DirectorBrief,
  project: { id: string; name: string },
  timeline: { id: string; name: string } | undefined,
): string {
  const tl = timeline ?? { id: brief.timelineId, name: '(unknown)' }
  const transition = (TRANSITION_OPTIONS.find(t => t.value === brief.transition) ?? TRANSITION_OPTIONS[0])
  const copyName = `${tl.name} - ${transition.label.toLowerCase()}`
  const lines = [
    'Revise an existing timeline in RiX with the rix-editor tools, following the rix-editor skill ("Revise mode").',
    '',
    `Project: "${project.name}" (project_id ${project.id}). Confirm with rix_status that this is still the open project before editing; if it isn't, stop and ask me.`,
    `Timeline: "${tl.name}" (timeline id ${tl.id}).`,
    '',
    'Change:',
    `- Transitions between clips → ${transition.brief}. Leave the opening fade-in and closing fade-out as they are.`,
    ...(brief.notes.trim() ? [`- Also: ${brief.notes.trim()}`] : []),
    '',
    'Keep everything else exactly as it is: every clip, in/out point, start time, track, audio level, fade, duck and title.',
    brief.reviseCopy
      ? `Work on a copy so my original stays untouched: duplicate_timeline it as "${copyName}", then change the copy.`
      : 'Edit this timeline in place.',
    `Review every join with render_frames, then ${brief.exportWhenDone
      ? 'export it and tell me the file path.'
      : "stop and tell me it's ready — don't export, I'll review it in RiX first."}`,
  ]
  return lines.join('\n')
}

export function buildDirectorPrompt(
  brief: DirectorBrief,
  project: { id: string; name: string },
  timelines: Array<{ id: string; name: string }> = [],
): string {
  if (brief.mode === 'revise') return buildRevisePrompt(brief, project, timelines.find(t => t.id === brief.timelineId))
  const lines = [
    'Cut a video in RiX with the rix-editor tools, following the rix-editor skill.',
    '',
    `Project: "${project.name}" (project_id ${project.id}). Confirm with rix_status that this is still the open project before editing; if it isn't, stop and ask me.`,
    '',
    'Brief:',
    `- Length: about ${brief.lengthSec}s, aspect ${brief.aspect}`,
    brief.folder
      ? `- Footage: my Studio Assets folder "${brief.folder}" (this project's own clips are fair game too)`
      : '- Footage: choose the best matching clips from my Studio Assets library and this project',
    brief.musicPath ? `- Music: ${brief.musicPath}` : '- Music: none',
    `- Transitions: ${(TRANSITION_OPTIONS.find(t => t.value === brief.transition) ?? TRANSITION_OPTIONS[0]).brief}`,
    ...(brief.title.trim() ? [`- End on a title: "${brief.title.trim()}"`] : []),
    ...(brief.notes.trim() ? [`- Notes: ${brief.notes.trim()}`] : []),
    '',
    brief.shotListFirst
      ? 'Show me your shot list and wait for my OK before building.'
      : "Build it without waiting for my approval.",
    `Build on a new timeline, review your cut with render_frames, then ${brief.exportWhenDone
      ? 'export it and tell me the file path.'
      : "stop and tell me it's ready — don't export, I'll review it in RiX first."}`,
  ]
  return lines.join('\n')
}

type McpStatus = Awaited<ReturnType<typeof window.electronAPI.mcpGetStatus>>
type ConnectStatus = Awaited<ReturnType<typeof window.electronAPI.claudeConnectStatus>>

function agoLabel(ts: number | null | undefined): string {
  if (!ts) return 'never'
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  return `${Math.round(s / 3600)} h ago`
}

export function DirectWithClaudeModal({ project, projectAudio, timelines, onClose, onOpened }: {
  project: { id: string; name: string }
  projectAudio: Asset[]
  timelines: Array<{ id: string; name: string }>
  onClose: () => void
  onOpened: (message: string) => void
}) {
  const [folders, setFolders] = useState<string[]>([])
  const [libraryAudio, setLibraryAudio] = useState<Array<{ name: string; path: string; folder: string }>>([])
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [brief, setBrief] = useState<DirectorBrief>({
    mode: 'new', timelineId: timelines[timelines.length - 1]?.id ?? '', reviseCopy: true,
    lengthSec: 30, aspect: '16:9', folder: '', musicPath: '', transition: 'cut', title: '', notes: '',
    shotListFirst: true, exportWhenDone: true,
  })
  const set = <K extends keyof DirectorBrief>(k: K, v: DirectorBrief[K]) => setBrief(b => ({ ...b, [k]: v }))

  useEffect(() => {
    void window.electronAPI.gpmLibList().then(lib => {
      setFolders(lib.folders)
      setLibraryAudio(lib.files.filter(f => f.isAudio).map(f => ({ name: f.name, path: f.path, folder: f.folder })))
    }).catch(() => {})
  }, [])

  // One-time "Connect Claude" setup: are RiX's tools registered with the user's
  // Claude Code (for THIS install's address + token) and is the skill installed?
  const [conn, setConn] = useState<ConnectStatus | null>(null)
  const [connecting, setConnecting] = useState(false)
  const refreshStatus = useCallback(() => {
    void window.electronAPI.mcpGetStatus().then(setStatus).catch(() => {})
    void window.electronAPI.claudeConnectStatus().then(setConn).catch(() => {})
  }, [])
  const connected = !!conn?.mcpRegistered && !!conn?.skillInstalled

  const connect = async (updateSkill = false) => {
    setConnecting(true)
    setError(null)
    try {
      const r = await window.electronAPI.claudeConnect({ updateSkill })
      if (!r.success) setError(r.error)
    } finally {
      setConnecting(false)
      refreshStatus()
    }
  }
  const disconnect = async () => {
    const r = await window.electronAPI.claudeDisconnect()
    if (!r.success) setError(r.error)
    refreshStatus()
  }
  useEffect(() => {
    refreshStatus()
    const t = setInterval(refreshStatus, 3000)
    return () => clearInterval(t)
  }, [refreshStatus])

  const prompt = useMemo(() => buildDirectorPrompt(brief, project, timelines), [brief, project, timelines])
  const revising = brief.mode === 'revise'
  const ready = !!status?.running && connected && (!revising || !!brief.timelineId)

  const openInClaude = async () => {
    setOpening(true)
    setError(null)
    try {
      const r = await window.electronAPI.openClaudeCode({ prompt })
      if (!r.success) { setError(r.error); return }
      onOpened('Opened in Claude — review the brief and press Send')
      onClose()
    } finally {
      setOpening(false)
    }
  }

  const fieldCls = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500'
  const labelCls = 'block text-xs font-medium text-zinc-400 mb-1.5'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 rounded-2xl border border-zinc-700/50 shadow-2xl w-full max-w-xl relative overflow-hidden max-h-[calc(100vh-2rem)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Clapperboard className="h-5 w-5 text-[rgb(var(--accent))]" />
            <h2 className="text-lg font-bold text-white">Edit with Claude</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {/* Connection: one-time Connect Claude setup, then a live status line. */}
          {conn && !connected ? (
            <div className="rounded-xl border border-[rgb(var(--accent)/0.5)] bg-[rgb(var(--accent)/0.08)] px-4 py-3.5 space-y-2.5">
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full flex-shrink-0 bg-zinc-500" />
                <span className="text-sm font-semibold text-white">
                  {conn.mcpRegistered || conn.skillInstalled ? 'Finish connecting Claude' : 'Connect Claude (one-time setup)'}
                </span>
              </div>
              {conn.claudeFound ? (
                <>
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    Claude runs in your own Claude app, on your own Claude plan. Connecting does two things on this computer:
                  </p>
                  <ul className="text-xs text-zinc-400 leading-relaxed list-disc pl-5 space-y-0.5">
                    <li>adds RiX's editing tools to Claude Code{conn.mcpRegistered ? ' — done' : ''}</li>
                    <li>installs the RiX editing skill in your Claude skills folder{conn.skillInstalled ? ' — done' : ''}</li>
                  </ul>
                  <button
                    onClick={() => void connect()}
                    disabled={connecting}
                    className="mt-1 px-4 py-2 rounded-lg bg-[rgb(var(--accent))] hover:brightness-110 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2 transition"
                  >
                    {connecting && <Loader2 className="h-4 w-4 animate-spin" />}
                    Connect Claude
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    Claude Code wasn't found on this computer. Install Claude Desktop, sign in, open its <span className="text-white">Code</span> tab once, then come back here.
                  </p>
                  <button
                    onClick={() => void window.electronAPI.openExternalUrl({ url: 'https://claude.com/download' })}
                    className="mt-1 px-4 py-2 rounded-lg border border-zinc-600 hover:border-zinc-400 text-white text-sm font-medium flex items-center gap-2 transition-colors"
                  >
                    <ExternalLink className="h-4 w-4" />Get Claude Desktop
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${
                    !status?.running ? 'bg-zinc-600' : status?.lastClient ? 'bg-emerald-400' : 'bg-amber-400'
                  }`} />
                  <div className="text-xs min-w-0">
                    {!status?.running ? (
                      <span className="text-zinc-300">Connected to Claude, but the editor is closed to it — turn on the switch.</span>
                    ) : status?.lastClient ? (
                      <span className="text-zinc-300">
                        Connected to Claude · last used by <span className="text-white">{status.lastClient.name}</span>, {agoLabel(status.lastClient.at)}
                      </span>
                    ) : (
                      <span className="text-zinc-300">Connected to Claude · ready for your first brief.</span>
                    )}
                  </div>
                </div>
                {status && !status.forcedOn && (
                  <label className="flex items-center gap-2 text-xs text-zinc-300 flex-shrink-0 cursor-pointer" title="Lets your Claude app edit timelines in RiX through a private, local-only connection">
                    <input
                      type="checkbox"
                      checked={status.enabled}
                      onChange={(e) => void window.electronAPI.mcpSetEnabled({ enabled: e.target.checked }).then(refreshStatus)}
                      className="accent-[rgb(var(--accent))]"
                    />
                    Allow Claude to control the editor
                  </label>
                )}
              </div>
              {conn && (
                <div className="flex items-center gap-3 pl-5 text-[11px] text-zinc-500">
                  {!conn.skillCurrent && (
                    <button onClick={() => void connect(true)} disabled={connecting} className="text-amber-300 hover:text-amber-200 underline underline-offset-2"
                      title="Your installed RiX skill differs from the one in this version of RiX. Updating keeps a backup of the old file.">
                      Update the RiX skill
                    </button>
                  )}
                  <button onClick={() => void disconnect()} className="hover:text-zinc-300 underline underline-offset-2"
                    title="Removes RiX's tools from Claude Code. The skill file is left in place.">
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            {([['new', 'New cut'], ['revise', 'Revise a timeline']] as Array<[DirectorMode, string]>).map(([m, label]) => (
              <button key={m} onClick={() => set('mode', m)}
                className={`flex-1 py-2 rounded-lg text-sm border transition-colors ${
                  brief.mode === m ? 'border-[rgb(var(--accent))] bg-[rgb(var(--accent)/0.15)] text-white' : 'border-zinc-700 text-zinc-400 hover:text-white'
                }`}
              >{label}</button>
            ))}
          </div>

          {revising && (
            <div>
              <label className={labelCls}>Timeline to revise</label>
              {timelines.length > 0 ? (
                <select value={brief.timelineId} onChange={(e) => set('timelineId', e.target.value)} className={fieldCls}>
                  {timelines.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              ) : (
                <p className="text-xs text-zinc-500">This project has no timelines yet.</p>
              )}
              <p className="mt-1.5 text-[11px] text-zinc-500">Claude keeps every clip, trim, audio level and title as it is and changes only what you pick below.</p>
            </div>
          )}

          {!revising && (<>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Length (seconds)</label>
              <input type="number" min={5} max={600} value={brief.lengthSec}
                onChange={(e) => set('lengthSec', Math.max(5, Math.min(600, Number(e.target.value) || 30)))} className={fieldCls} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Aspect</label>
              <div className="flex gap-2">
                {(['9:16', '16:9', '1:1'] as Aspect[]).map(a => (
                  <button key={a} onClick={() => set('aspect', a)}
                    className={`flex-1 py-2 rounded-lg text-sm border transition-colors ${
                      brief.aspect === a ? 'border-[rgb(var(--accent))] bg-[rgb(var(--accent)/0.15)] text-white' : 'border-zinc-700 text-zinc-400 hover:text-white'
                    }`}
                  >{a}</button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className={labelCls}>Footage</label>
            <select value={brief.folder} onChange={(e) => set('folder', e.target.value)} className={fieldCls}>
              <option value="">Let Claude choose from all my footage</option>
              {folders.map(f => <option key={f} value={f}>Studio Assets › {f}</option>)}
            </select>
          </div>

          <div>
            <label className={labelCls}>Music</label>
            <select value={brief.musicPath} onChange={(e) => set('musicPath', e.target.value)} className={fieldCls}>
              <option value="">No music</option>
              {projectAudio.length > 0 && (
                <optgroup label="This project">
                  {projectAudio.map(a => <option key={a.id} value={a.path}>{a.path.split(/[\\/]/).pop()}</option>)}
                </optgroup>
              )}
              {libraryAudio.length > 0 && (
                <optgroup label="Studio Assets">
                  {libraryAudio.map(a => <option key={a.path} value={a.path}>{a.folder} › {a.name}</option>)}
                </optgroup>
              )}
            </select>
          </div>
          </>)}

          <div>
            <label className={labelCls}>{revising ? 'Change transitions between clips to' : 'Transitions between clips'}</label>
            <select value={brief.transition} onChange={(e) => set('transition', e.target.value as ClipTransition)} className={fieldCls}>
              {TRANSITION_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {!revising && (
            <div>
              <label className={labelCls}>End on a title (optional)</label>
              <input value={brief.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. TRICK OR TREAT" className={fieldCls} />
            </div>
          )}

          <div>
            <label className={labelCls}>{revising ? 'Anything else to change (optional)' : 'Notes for Claude (optional)'}</label>
            <textarea value={brief.notes} onChange={(e) => set('notes', e.target.value)} rows={3}
              placeholder={revising ? 'Leave empty to change only the transitions' : "Mood, pacing, shots to include or avoid, keep the witch's dialogue…"}
              className={`${fieldCls} resize-none`} />
          </div>

          <div className="flex flex-col gap-2 text-sm text-zinc-300">
            {revising ? (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={brief.reviseCopy} onChange={(e) => set('reviseCopy', e.target.checked)} className="accent-[rgb(var(--accent))]" />
                Work on a copy (keeps the original timeline untouched)
              </label>
            ) : (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={brief.shotListFirst} onChange={(e) => set('shotListFirst', e.target.checked)} className="accent-[rgb(var(--accent))]" />
                Show me the shot list before building
              </label>
            )}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={brief.exportWhenDone} onChange={(e) => set('exportWhenDone', e.target.checked)} className="accent-[rgb(var(--accent))]" />
              Export when done (to Studio Assets › RiX Edits)
            </label>
          </div>

          <details className="rounded-xl border border-zinc-800 bg-zinc-950/50">
            <summary className="px-4 py-2.5 text-xs text-zinc-400 cursor-pointer select-none">What Claude will receive</summary>
            <pre className="px-4 pb-3 text-[11px] leading-relaxed text-zinc-300 whitespace-pre-wrap font-mono">{prompt}</pre>
          </details>

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-zinc-800 space-y-2">
          <button
            onClick={() => void openInClaude()}
            disabled={!ready || opening}
            className="w-full py-3 rounded-xl bg-[rgb(var(--accent))] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm flex items-center justify-center gap-2 transition"
          >
            {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            Open in Claude
          </button>
          <p className="text-[11px] text-zinc-500 text-center">
            Opens Claude Desktop's Code tab with this brief filled in — you press Send. Runs on your own Claude plan; RiX never sees your Claude login.
          </p>
        </div>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, Loader2, Sparkles, X } from 'lucide-react'
import { pathToFileUrl } from '../lib/file-url'

/**
 * "Prompt with Claude": turns a short idea (+ the reference image, if any) into a brief and
 * opens it, prefilled, in Claude Desktop's Code tab. Claude runs in the user's OWN Claude app
 * on their own plan (no API keys / per-call billing). It looks at the image through the RiX MCP
 * server, writes a multi-shot prompt (rix-prompt skill) and puts it in the prompt box with
 * set_generation_prompt. The user presses Send in Claude, then comes back to review it.
 */

type ShotCount = 2 | 3 | 4

export interface PromptBrief {
  imagePath: string | null
  idea: string
  shots: ShotCount
  dialogue: boolean
  existingPrompt: string
}

export function buildPromptBrief(brief: PromptBrief): string {
  const lines = [
    'Write a multi-shot video prompt for RiX with the rix-prompt skill, then put it in RiX\'s prompt box with set_generation_prompt.',
    '',
    brief.imagePath
      ? `Reference image (it becomes the first frame; look at it with inspect_media): ${brief.imagePath}`
      : 'Reference image: none. Write the prompt from the idea alone.',
    `Idea: ${brief.idea.trim() || '(none given: pick a simple, fitting scene from the image)'}`,
    `Shots: ${brief.shots}`,
    brief.dialogue
      ? 'Dialogue: include a few short spoken lines if they suit the scene.'
      : 'Dialogue: none. Sound and ambience only.',
    ...(brief.existingPrompt.trim()
      ? ['', `The prompt box currently says (treat it as rough notes, not as text to keep): ${brief.existingPrompt.trim()}`]
      : []),
    '',
    'Write it, call set_generation_prompt, then tell me the shot count and the duration to set. Do not generate anything.',
  ]
  return lines.join('\n')
}

type McpStatus = Awaited<ReturnType<typeof window.electronAPI.mcpGetStatus>>
type ConnectStatus = Awaited<ReturnType<typeof window.electronAPI.claudeConnectStatus>>

export function PromptWithClaudeModal({ imagePath, existingPrompt, onClose }: {
  imagePath: string | null
  existingPrompt: string
  onClose: () => void
}) {
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [conn, setConn] = useState<ConnectStatus | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [brief, setBrief] = useState<PromptBrief>({
    imagePath, idea: '', shots: 3, dialogue: true, existingPrompt,
  })
  const set = <K extends keyof PromptBrief>(k: K, v: PromptBrief[K]) => setBrief(b => ({ ...b, [k]: v }))

  const refreshStatus = useCallback(() => {
    void window.electronAPI.mcpGetStatus().then(setStatus).catch(() => {})
    void window.electronAPI.claudeConnectStatus().then(setConn).catch(() => {})
  }, [])
  useEffect(() => {
    refreshStatus()
    const t = setInterval(refreshStatus, 3000)
    return () => clearInterval(t)
  }, [refreshStatus])

  const connected = !!conn?.mcpRegistered && !!conn?.skillInstalled
  const ready = !!status?.running && connected

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

  const prompt = useMemo(() => buildPromptBrief(brief), [brief])

  const openInClaude = async () => {
    setOpening(true)
    setError(null)
    try {
      const r = await window.electronAPI.openClaudeCode({ prompt })
      if (!r.success) { setError(r.error); return }
      onClose()
    } finally {
      setOpening(false)
    }
  }

  const fieldCls = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500'
  const labelCls = 'block text-xs font-medium text-zinc-400 mb-1.5'

  // Portaled to <body>: inside GenSpace an ancestor clips/offsets `fixed`, cutting off the footer.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-zinc-900 rounded-2xl border border-zinc-700/50 shadow-2xl w-full max-w-lg relative overflow-hidden max-h-[calc(100dvh-2rem)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-5 w-5 text-[rgb(var(--accent))]" />
            <h2 className="text-lg font-bold text-white">Prompt with Claude</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {conn && !connected ? (
            <div className="rounded-xl border border-[rgb(var(--accent)/0.5)] bg-[rgb(var(--accent)/0.08)] px-4 py-3.5 space-y-2.5">
              <span className="text-sm font-semibold text-white">
                {conn.mcpRegistered || conn.skillInstalled ? 'Finish connecting Claude' : 'Connect Claude (one-time setup)'}
              </span>
              {conn.claudeFound ? (
                <>
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    Claude runs in your own Claude app, on your own Claude plan. Connecting adds RiX's tools to Claude Code and
                    installs the RiX skills in your Claude skills folder.
                  </p>
                  <button
                    onClick={() => void connect()}
                    disabled={connecting}
                    className="px-4 py-2 rounded-lg bg-[rgb(var(--accent))] hover:brightness-110 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2 transition"
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
                    className="px-4 py-2 rounded-lg border border-zinc-600 hover:border-zinc-400 text-white text-sm font-medium flex items-center gap-2 transition-colors"
                  >
                    <ExternalLink className="h-4 w-4" />Get Claude Desktop
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0 text-xs text-zinc-300">
                  <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${status?.running ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                  {status?.running ? 'Connected to Claude' : 'Connected to Claude, but RiX is closed to it — turn on the switch.'}
                </div>
                {status && !status.forcedOn && (
                  <label className="flex items-center gap-2 text-xs text-zinc-300 flex-shrink-0 cursor-pointer" title="Lets your Claude app talk to RiX through a private, local-only connection">
                    <input
                      type="checkbox"
                      checked={status.enabled}
                      onChange={(e) => void window.electronAPI.mcpSetEnabled({ enabled: e.target.checked }).then(refreshStatus)}
                      className="accent-[rgb(var(--accent))]"
                    />
                    Allow Claude to use RiX
                  </label>
                )}
              </div>
              {conn && !conn.skillCurrent && (
                <button onClick={() => void connect(true)} disabled={connecting} className="text-[11px] text-amber-300 hover:text-amber-200 underline underline-offset-2"
                  title="Your installed RiX skills differ from the ones in this version of RiX. Updating keeps a backup of any old file.">
                  Update the RiX skills
                </button>
              )}
            </div>
          )}

          <div className="flex items-start gap-3">
            {imagePath ? (
              <img src={pathToFileUrl(imagePath)} alt="" className="h-20 w-32 object-cover rounded-lg border border-zinc-700 flex-shrink-0" />
            ) : (
              <div className="h-20 w-32 rounded-lg border border-dashed border-zinc-700 flex items-center justify-center text-[11px] text-zinc-500 flex-shrink-0 text-center px-2">
                No image
              </div>
            )}
            <p className="text-xs text-zinc-400 leading-relaxed">
              {imagePath
                ? 'Claude will look at this image and write shot 1 to match it exactly, then carry the same look through every cut.'
                : 'No first-frame image is set. Claude will write the prompt from your idea alone. Add an image first for the best consistency.'}
            </p>
          </div>

          <div>
            <label className={labelCls}>What should the scene be about?</label>
            <textarea value={brief.idea} onChange={(e) => set('idea', e.target.value)} rows={4} autoFocus
              placeholder="e.g. She discovers the orb is showing her something she doesn't want to see"
              className={`${fieldCls} resize-none`} />
          </div>

          <div>
            <label className={labelCls}>Shots</label>
            <div className="flex gap-2">
              {([2, 3, 4] as ShotCount[]).map(n => (
                <button key={n} onClick={() => set('shots', n)}
                  className={`flex-1 py-2 rounded-lg text-sm border transition-colors ${
                    brief.shots === n ? 'border-[rgb(var(--accent))] bg-[rgb(var(--accent)/0.15)] text-white' : 'border-zinc-700 text-zinc-400 hover:text-white'
                  }`}
                >{n}</button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={brief.dialogue} onChange={(e) => set('dialogue', e.target.checked)} className="accent-[rgb(var(--accent))]" />
            Include short spoken lines
          </label>

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
          <p className="text-[11px] text-zinc-500 text-center leading-relaxed">
            Opens Claude Desktop's Code tab with this brief filled in — you press Send. Claude writes the prompt straight into the
            prompt box here. Runs on your own Claude plan; RiX never sees your Claude login. The image is shown to Claude by your own
            Claude app.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  )
}

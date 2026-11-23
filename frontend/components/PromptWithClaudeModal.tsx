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

// 1 = a single continuous shot (reference sheets only; rix-prompt-sheet has a single-shot mode)
type ShotCount = 1 | 2 | 3 | 4
// 'first-frame': the image is the opening frame. 'sheet': a character/prop/location reference
// sheet used only as an ingredient (rix-prompt-sheet skill), never shown or animated.
type ImageKind = 'first-frame' | 'sheet'

// Visual look, handled by the rix-lens skill. 'natural' adds nothing (plain rix-prompt wording);
// 'cinematic' adds lens character with soft readable light; 'blockbuster' adds the full lens +
// hard-light lock. Flare is a separate switch.
// 'keep' only exists in Revise mode: leave whatever look the prompt already has alone.
type Look = 'keep' | 'natural' | 'cinematic' | 'blockbuster'
const KEEP_LOOK = { id: 'keep' as Look, label: 'Keep', hint: 'Leave the look the prompt already has as it is.' }
const LOOKS: { id: Look; label: string; hint: string }[] = [
  { id: 'natural', label: 'Natural', hint: 'Plain, realistic light. Best for dialogue and groups.' },
  { id: 'cinematic', label: 'Cinematic', hint: 'Film lens look (oval bokeh, shallow focus, grain) with soft, readable light.' },
  { id: 'blockbuster', label: 'Blockbuster', hint: 'Film lens look with hard light, rim light and deep shadow.' },
]

export interface PromptBrief {
  // 'new' writes a fresh prompt; 'revise' changes the prompt already in the box and keeps the rest.
  mode: 'new' | 'revise'
  change: string
  resultVideoPath: string | null
  lookAtResult: boolean
  imagePath: string | null
  imageKind: ImageKind
  // The sheet is attached as the Ingredients IC-LoRA reference (IC-LoRA mode), not as a first frame.
  ingredients: boolean
  idea: string
  shots: ShotCount
  dialogue: boolean
  look: Look
  // Lens flare strength 0 to 1 (0 = off), set with a slider.
  flare: number
  existingPrompt: string
}

/** Plain words for the flare slider, so rix-lens knows how strong to make it. */
function flareWords(v: number): string {
  if (v <= 0) return 'off'
  const pct = Math.round(v * 100)
  if (v <= 0.3) return `${pct}% strength: a barely visible, very faint streak off one light source`
  if (v <= 0.6) return `${pct}% strength: a thin, faint streak off one light source (keep it off face close-ups)`
  if (v <= 0.85) return `${pct}% strength: a clearly visible streak off one light source, no blowout (keep it off face close-ups)`
  return `${pct}% strength: a bold, bright streak off one light source, the strongest you can write without washing out the frame (keep it off face close-ups)`
}

/** The look lines shared by both modes. 'keep' (Revise only) adds nothing. */
function lookLines(brief: PromptBrief, sheet: boolean): string[] {
  if (brief.look === 'keep') return []
  if (brief.look === 'natural') {
    return brief.mode === 'revise'
      ? ['Look: Natural. Remove any lens, bokeh, film-grain, flare or hard-light wording and keep plain, realistic light.']
      : []
  }
  return [
    `Look: ${brief.look === 'cinematic' ? 'Cinematic' : 'Blockbuster'}. Use the rix-lens skill to build the look lock and restate it in the same words in every shot${brief.mode === 'revise' ? ', replacing any look wording already in the prompt' : ''}. Flare (scale 0 to 1, see the flare strength section of rix-lens): ${flareWords(brief.flare)}.`,
    ...(brief.imagePath && !sheet ? ['The first-frame image\'s own light and framing win: describe them as they are in shot 1 and add the look from the first cut.'] : []),
  ]
}

function buildReviseBrief(brief: PromptBrief): string {
  const sheet = brief.imageKind === 'sheet' && !!brief.imagePath
  return [
    'Revise the existing RiX video prompt below. Follow the rix-prompt skill\'s recipe (or rix-prompt-sheet\'s two-part format if the prompt below is in that format). Change ONLY what I ask for. Keep every other word, shot, line of dialogue and detail exactly as written, and keep the shot count unless I ask otherwise. Then put the COMPLETE revised prompt in RiX\'s prompt box with set_generation_prompt.',
    '',
    'Current prompt:',
    brief.existingPrompt.trim(),
    '',
    `What to change: ${brief.change.trim()}`,
    ...(brief.imagePath ? [`Reference image (look at it with inspect_media if it helps): ${brief.imagePath}`] : []),
    ...(brief.lookAtResult && brief.resultVideoPath
      ? [`The video this prompt just produced is at ${brief.resultVideoPath}. Look at a few frames with inspect_media and use what you see to fix real problems (warped hands, flat light, wrong framing). The prompt above is still the source of truth for what I intended.`]
      : []),
    ...lookLines(brief, sheet),
    '',
    'Keep the whole revised prompt under 4500 characters (the LTX API refuses over 5000).',
    'Reply in one or two lines: what you changed, and the duration to set. Do not generate anything.',
  ].join('\n')
}

export function buildPromptBrief(brief: PromptBrief): string {
  if (brief.mode === 'revise') return buildReviseBrief(brief)
  const sheet = brief.imageKind === 'sheet' && !!brief.imagePath
  const lines = [
    sheet
      ? 'Write a multi-shot video prompt for RiX with the rix-prompt-sheet skill, then put it in RiX\'s prompt box with set_generation_prompt.'
      : 'Write a multi-shot video prompt for RiX with the rix-prompt skill, then put it in RiX\'s prompt box with set_generation_prompt.',
    '',
    brief.imagePath
      ? sheet
        ? brief.ingredients
          ? `Reference sheet (look at it with inspect_media, width 1280 or more): ${brief.imagePath}
It is attached to the Ingredients IC-LoRA as an appearance reference ONLY. Follow the "Ingredients IC-LoRA" section of the skill. The sheet may mix character, outfit, location and prop panels: take from each only what my idea needs. The video is a NEW scene: never show, copy or animate the sheet, its layout, borders, labels or its poses.`
          : `Reference sheet (look at it with inspect_media). It is an ingredient only: the video is a NEW scene that borrows the character, props and place from it. Never show or animate the sheet or its panels: ${brief.imagePath}`
        : `Reference image (it becomes the first frame; look at it with inspect_media): ${brief.imagePath}`
      : 'Reference image: none. Write the prompt from the idea alone.',
    `Idea: ${brief.idea.trim() || (sheet ? '(none given: invent a fitting location and a simple scene for this character)' : '(none given: pick a simple, fitting scene from the image)')}`,
    brief.shots === 1
      ? 'Shots: 1. Use the SINGLE-shot mode of rix-prompt-sheet: one continuous shot, one camera, no cuts.'
      : `Shots: ${brief.shots}`,
    brief.dialogue
      ? 'Dialogue: include a few short spoken lines if they suit the scene.'
      : 'Dialogue: none. Sound and ambience only.',
    ...lookLines(brief, sheet),
    ...(brief.existingPrompt.trim()
      ? ['', `The prompt box currently says (treat it as rough notes, not as text to keep): ${brief.existingPrompt.trim()}`]
      : []),
    '',
    'Keep the whole prompt under 4500 characters (the LTX API refuses over 5000).',
    'Write it, call set_generation_prompt, then tell me the shot count and the duration to set. Do not generate anything.',
  ]
  return lines.join('\n')
}

interface Run {
  runId: string
  sessionId?: string
  phase: 'running' | 'done' | 'error'
  lines: string[]
  reply: string
}

type McpStatus = Awaited<ReturnType<typeof window.electronAPI.mcpGetStatus>>
type ConnectStatus = Awaited<ReturnType<typeof window.electronAPI.claudeConnectStatus>>

export function PromptWithClaudeModal({ imagePath, existingPrompt, lastVideoPath, ingredients = false, onClose }: {
  imagePath: string | null
  /** IC-LoRA mode with Ingredients: the image is a reference sheet, never a first frame. */
  ingredients?: boolean
  existingPrompt: string
  /** The video the last generation made, so Revise mode can let Claude look at the result. */
  lastVideoPath?: string | null
  onClose: () => void
}) {
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [conn, setConn] = useState<ConnectStatus | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [auth, setAuth] = useState<{ cliFound: boolean; loggedIn: boolean } | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [run, setRun] = useState<Run | null>(null)
  const [followUp, setFollowUp] = useState('')
  const [brief, setBrief] = useState<PromptBrief>({
    mode: existingPrompt.trim() ? 'revise' : 'new', change: '',
    resultVideoPath: lastVideoPath ?? null, lookAtResult: !!lastVideoPath,
    imagePath, imageKind: ingredients ? 'sheet' : 'first-frame', ingredients, idea: '', shots: 3, dialogue: true,
    look: existingPrompt.trim() ? 'keep' : 'natural', flare: 0, existingPrompt,
  })
  const set = <K extends keyof PromptBrief>(k: K, v: PromptBrief[K]) => setBrief(b => ({ ...b, [k]: v }))

  const refreshStatus = useCallback(() => {
    void window.electronAPI.mcpGetStatus().then(setStatus).catch(() => {})
    void window.electronAPI.claudeConnectStatus().then(setConn).catch(() => {})
  }, [])
  // The sign-in check starts a process, so it runs once and after sign-in, not on the 3 s poll.
  const refreshAuth = useCallback(() => {
    void window.electronAPI.claudeAuthStatus().then(setAuth).catch(() => {})
  }, [])
  useEffect(() => { refreshAuth() }, [refreshAuth])
  const signIn = async () => {
    setSigningIn(true)
    setError(null)
    try {
      const r = await window.electronAPI.claudeAuthLogin()
      if (!r.success) setError(r.error)
    } finally {
      setSigningIn(false)
      refreshAuth()
    }
  }
  useEffect(() => {
    refreshStatus()
    const t = setInterval(refreshStatus, 3000)
    return () => clearInterval(t)
  }, [refreshStatus])

  const connected = !!conn?.mcpRegistered && !!conn?.skillInstalled
  const ready = !!status?.running && connected
  // Background runs also need Claude Code signed in on its own (Claude Desktop's login isn't shared).
  const canRunHere = ready && !!auth?.loggedIn

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

  // Always the LIVE prompt box text: after a revision lands, a second revision must build on it.
  const prompt = useMemo(() => buildPromptBrief({ ...brief, existingPrompt }), [brief, existingPrompt])

  // Progress from the background Claude run (see electron/mcp/claude-runner.ts).
  useEffect(() => window.electronAPI.onClaudeRunEvent((e) => {
    setRun((r) => {
      if (!r || r.runId !== e.runId) return r
      switch (e.kind) {
        case 'session': return { ...r, sessionId: e.sessionId ?? r.sessionId }
        case 'status': return e.text && !r.lines.includes(e.text) ? { ...r, lines: [...r.lines, e.text] } : r
        case 'done': return { ...r, phase: 'done', sessionId: e.sessionId ?? r.sessionId, reply: e.text ?? '' }
        case 'error': return { ...r, phase: 'error', reply: e.text ?? 'Something went wrong.' }
      }
    })
  }), [])

  const startRun = async (text: string, sessionId?: string) => {
    setError(null)
    const r = await window.electronAPI.claudeRunStart({ prompt: text, sessionId })
    if (!r.success) { setError(r.error); return }
    setRun({ runId: r.runId, sessionId, phase: 'running', lines: ['Starting Claude…'], reply: '' })
  }
  const revise = brief.mode === 'revise'
  const sheetKind = brief.imageKind === 'sheet' && !!imagePath
  const needsChange = revise && !brief.change.trim()
  const setMode = (m: 'new' | 'revise') => setBrief(b => ({ ...b, mode: m, look: m === 'revise' ? 'keep' : (b.look === 'keep' ? 'natural' : b.look) }))
  const writeHere = () => { void startRun(prompt) }
  const sendFollowUp = () => {
    const t = followUp.trim()
    if (!t || !run?.sessionId) return
    setFollowUp('')
    void startRun(`${t}\n\nRevise the prompt and call set_generation_prompt again with the complete new prompt. Then tell me the shot count and the duration to set.`, run.sessionId)
  }
  const close = () => {
    if (run?.phase === 'running') void window.electronAPI.claudeRunCancel({ runId: run.runId })
    onClose()
  }

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={close}>
      <div
        className="bg-zinc-900 rounded-2xl border border-zinc-700/50 shadow-2xl w-full max-w-lg relative overflow-hidden max-h-[calc(100dvh-2rem)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-5 w-5 text-[rgb(var(--accent))]" />
            <h2 className="text-lg font-bold text-white">Prompt with Claude</h2>
          </div>
          <button onClick={close} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors">
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
                    installs the RiX skills in your Claude skills folder. It also lets Claude read your image and fill the prompt box without asking at each step.
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

          {!run && connected && auth && auth.cliFound && !auth.loggedIn && (
            <div className="rounded-xl border border-[rgb(var(--accent)/0.5)] bg-[rgb(var(--accent)/0.08)] px-4 py-3.5 space-y-2.5">
              <span className="text-sm font-semibold text-white">One more step to write prompts here</span>
              <p className="text-xs text-zinc-300 leading-relaxed">
                To run Claude in the background, sign in once to your Claude account. Your browser opens, you approve it, and you're done.
                It uses your own Claude plan and RiX never sees your login. You can still use "Open in the Claude app" without this.
              </p>
              <button
                onClick={() => void signIn()}
                disabled={signingIn}
                className="px-4 py-2 rounded-lg bg-[rgb(var(--accent))] hover:brightness-110 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2 transition"
              >
                {signingIn && <Loader2 className="h-4 w-4 animate-spin" />}
                {signingIn ? 'Waiting for sign-in in your browser…' : 'Sign in to Claude'}
              </button>
            </div>
          )}

          {!run && existingPrompt.trim() && (
            <div className="flex gap-2">
              {([['revise', 'Revise this prompt'], ['new', 'Write a new one']] as ['new' | 'revise', string][]).map(([m, label]) => (
                <button key={m} onClick={() => setMode(m)}
                  className={`flex-1 py-2 rounded-lg text-sm border transition-colors ${
                    brief.mode === m ? 'border-[rgb(var(--accent))] bg-[rgb(var(--accent)/0.15)] text-white' : 'border-zinc-700 text-zinc-400 hover:text-white'
                  }`}
                >{label}</button>
              ))}
            </div>
          )}

          {!run && (<>
          <div className="flex items-start gap-3">
            {imagePath ? (
              <img src={pathToFileUrl(imagePath)} alt="" className="h-20 w-32 object-cover rounded-lg border border-zinc-700 flex-shrink-0" />
            ) : (
              <div className="h-20 w-32 rounded-lg border border-dashed border-zinc-700 flex items-center justify-center text-[11px] text-zinc-500 flex-shrink-0 text-center px-2">
                No image
              </div>
            )}
            <div className="space-y-2 min-w-0">
              {imagePath && !ingredients && (
                <div className="flex gap-2">
                  {([['first-frame', 'First frame'], ['sheet', 'Reference sheet (Ingredients)']] as [ImageKind, string][]).map(([k, label]) => (
                    <button key={k} onClick={() => set('imageKind', k)}
                      className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                        brief.imageKind === k ? 'border-[rgb(var(--accent))] bg-[rgb(var(--accent)/0.15)] text-white' : 'border-zinc-700 text-zinc-400 hover:text-white'
                      }`}
                    >{label}</button>
                  ))}
                </div>
              )}
              <p className="text-xs text-zinc-400 leading-relaxed">
                {!imagePath
                  ? ingredients
                    ? 'No reference sheet is loaded. Import one above first, so Claude can describe it.'
                    : 'No first-frame image is set. Claude will write the prompt from your idea alone. Add an image first for the best consistency.'
                  : brief.imageKind === 'sheet'
                    ? ingredients
                      ? 'Claude will read this sheet (character, outfit, location, props) and write a new scene that uses only the parts your idea needs. The sheet is appearance reference only and is kept out of the picture.'
                      : 'Claude will read this sheet for the character, props and place, then write a new scene with them. The sheet itself is only a reference and is kept out of the prompt\'s scene.'
                    : 'Claude will look at this image and write shot 1 to match it exactly, then carry the same look through every cut.'}
              </p>
            </div>
          </div>

          {revise && (
            <div className="space-y-3">
              <div>
                <label className={labelCls}>What should change?</label>
                <textarea value={brief.change} onChange={(e) => set('change', e.target.value)} rows={3} autoFocus
                  placeholder="e.g. slower camera, make the alien less dominant, darker and more tense"
                  className={`${fieldCls} resize-none`} />
                <p className="mt-1.5 text-[11px] text-zinc-500 leading-relaxed">Claude keeps everything else in your prompt exactly as written and changes only this.</p>
              </div>
              {lastVideoPath && (
                <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                  <input type="checkbox" checked={brief.lookAtResult} onChange={(e) => set('lookAtResult', e.target.checked)} className="accent-[rgb(var(--accent))]" />
                  Let Claude look at the video I just made
                </label>
              )}
            </div>
          )}

          {!revise && (<>
          <div>
            <label className={labelCls}>What should the scene be about?</label>
            <textarea value={brief.idea} onChange={(e) => set('idea', e.target.value)} rows={4} autoFocus
              placeholder="e.g. She discovers the orb is showing her something she doesn't want to see"
              className={`${fieldCls} resize-none`} />
          </div>

          <div>
            <label className={labelCls}>Shots</label>
            <div className="flex gap-2">
              {((sheetKind ? [1, 2, 3, 4] : [2, 3, 4]) as ShotCount[]).map(n => (
                <button key={n} onClick={() => set('shots', n)}
                  className={`flex-1 py-2 rounded-lg text-sm border transition-colors ${
                    brief.shots === n ? 'border-[rgb(var(--accent))] bg-[rgb(var(--accent)/0.15)] text-white' : 'border-zinc-700 text-zinc-400 hover:text-white'
                  }`}
                >{n === 1 ? 'Single' : n}</button>
              ))}
            </div>
          </div>

          </>)}

          <div>
            <label className={labelCls}>Look</label>
            <div className="flex gap-2">
              {(revise ? [KEEP_LOOK, ...LOOKS] : LOOKS).map(l => (
                <button key={l.id} onClick={() => set('look', l.id)} title={l.hint}
                  className={`flex-1 py-2 rounded-lg text-sm border transition-colors ${
                    brief.look === l.id ? 'border-[rgb(var(--accent))] bg-[rgb(var(--accent)/0.15)] text-white' : 'border-zinc-700 text-zinc-400 hover:text-white'
                  }`}
                >{l.label}</button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-zinc-500 leading-relaxed">{[KEEP_LOOK, ...LOOKS].find(l => l.id === brief.look)?.hint}</p>
            {(brief.look === 'cinematic' || brief.look === 'blockbuster') && (
              <div className="mt-2 flex items-center gap-3 text-sm text-zinc-300">
                <span className="flex-shrink-0">Lens flare</span>
                <input type="range" min={0} max={1} step={0.1} value={brief.flare}
                  onChange={(e) => set('flare', Number(e.target.value))}
                  className="flex-1 accent-[rgb(var(--accent))]" />
                <span className="w-10 text-right text-xs text-zinc-400 tabular-nums">{brief.flare <= 0 ? 'Off' : brief.flare.toFixed(1)}</span>
              </div>
            )}
            {(brief.look === 'cinematic' || brief.look === 'blockbuster') && imagePath && brief.imageKind === 'first-frame' && (
              <p className="mt-1.5 text-[11px] text-amber-300/80 leading-relaxed">
                Your first-frame image sets the light. To change the light itself, use a different image.
              </p>
            )}
          </div>

          {!revise && (
            <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
              <input type="checkbox" checked={brief.dialogue} onChange={(e) => set('dialogue', e.target.checked)} className="accent-[rgb(var(--accent))]" />
              Include short spoken lines
            </label>
          )}

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
                <p className="text-[11px] text-zinc-500">The prompt is in the prompt box. RiX will offer to save it.</p>
              )}
              {run.phase === 'done' && run.sessionId && (
                <div className="flex gap-2 pt-1">
                  <input value={followUp} onChange={(e) => setFollowUp(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') sendFollowUp() }}
                    placeholder="Ask for a change, e.g. make it darker, add a shot"
                    className={fieldCls} autoFocus />
                  <button onClick={sendFollowUp} disabled={!followUp.trim()}
                    className="px-4 rounded-lg bg-[rgb(var(--accent))] hover:brightness-110 disabled:opacity-40 text-white text-sm font-semibold transition">
                    Send
                  </button>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-zinc-800 space-y-2">
          {!run ? (
            <>
              <button
                onClick={writeHere}
                disabled={!canRunHere || needsChange}
                className="w-full py-3 rounded-xl bg-[rgb(var(--accent))] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm flex items-center justify-center gap-2 transition"
              >
                <Sparkles className="h-4 w-4" />
                {revise ? 'Revise the prompt here' : 'Write the prompt here'}
              </button>
              <button
                onClick={() => void openInClaude()}
                disabled={!ready || opening || needsChange}
                className="w-full py-2 rounded-xl border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-300 text-sm flex items-center justify-center gap-2 transition-colors"
              >
                {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                Open in the Claude app instead
              </button>
              <p className="text-[11px] text-zinc-500 text-center leading-relaxed">
                Claude runs in the background in your own Claude app, on your own Claude plan, and writes the prompt straight into the
                prompt box here. RiX never sees your Claude login. The image is shown to Claude by your own Claude app.
              </p>
            </>
          ) : run.phase === 'running' ? (
            <button onClick={() => void window.electronAPI.claudeRunCancel({ runId: run.runId })}
              className="w-full py-3 rounded-xl border border-zinc-600 hover:border-zinc-400 text-white text-sm font-medium transition-colors">
              Stop
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setRun(null)}
                className="flex-1 py-3 rounded-xl border border-zinc-700 hover:border-zinc-500 text-zinc-300 text-sm transition-colors">
                Change options
              </button>
              <button onClick={onClose}
                className="flex-1 py-3 rounded-xl bg-[rgb(var(--accent))] hover:brightness-110 text-white font-semibold text-sm transition">
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, Loader2, Sparkles, X } from 'lucide-react'
import { pathToFileUrl } from '../lib/file-url'
import { useClaudeRun } from '../hooks/use-claude-run'

/**
 * "Prompt with Claude" in Image mode: asks the questions the rix-sheet-maker skill needs
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
  // A picture of the character to copy (face, hair, build). Claude describes it exactly.
  matchImagePath: string | null
  // With a reference image: keep what they wear in it, or use the outfit described below.
  keepOutfit: boolean
}

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
  if (b.outfits) parts.push('several outfits of the character')
  if (b.location) parts.push('a location')
  if (b.props) parts.push('props')
  return [
    'Write the still-image prompt for a reference sheet for RiX\'s Ingredients IC-LoRA, using the rix-sheet-maker skill. My answers to its questions are below, so do not ask me anything. Pick the layout yourself from the content. Then put the finished image prompt in RiX\'s prompt box with set_generation_prompt (the prompt text only: no image_path, folder "Reference Sheets"). Do not generate anything.',
    '',
    `The sheet holds: ${parts.join(', ')}.`,
    ...(b.character ? [`Character${b.characterCount === 2 ? 's' : ''}: ${b.characterText.trim() || none}`] : []),
    ...(b.outfits ? [`Outfits (one panel each): ${b.outfitsText.trim() || none}`] : []),
    ...(b.location ? [`Location: ${b.locationText.trim() || none}`] : []),
    ...(b.props ? [`Props: ${b.propsText.trim() || none}`] : []),
    `Style: ${STYLES.find(s => s.id === b.style)?.text}.`,
    `Aspect ratio: ${b.aspect}.`,
    ...(b.matchImagePath
      ? [
          `Character reference image: ${b.matchImagePath}`,
          'Look at it with inspect_media (width 1280 or more) and follow the "Character from a reference image" section of the skill. This is a real likeness to copy: describe the face, hair, skin, age, build and every visible detail exactly as the image shows them. Do not invent or "improve" features. The text I wrote under the character is only changes or extras to that person.',
          b.keepOutfit
            ? 'Outfit: keep what they wear in the image.'
            : 'Outfit: do not use the outfit in the image; use the outfit I described.',
          'Start the sheet prompt by telling the image model to use the attached reference image as the exact likeness of the person in every panel.',
        ]
      : ['No character reference image.']),
    '',
    'Reply in a few lines: the layout you chose, anything you invented, and how many versions to generate before picking one. Remind me to test the finished sheet with one short Ingredients video.',
  ].join('\n')
}

export function SheetMakerModal({ inputImage = null, onClose }: {
  /** The Image-mode input image, if one is loaded: offered as the character reference. */
  inputImage?: string | null
  onClose: () => void
}) {
  const c = useClaudeRun()
  const [opening, setOpening] = useState(false)
  const [followUp, setFollowUp] = useState('')
  const [brief, setBrief] = useState<SheetBrief>({
    character: true, characterCount: 1, characterText: '',
    outfits: false, outfitsText: '',
    location: false, locationText: '',
    props: false, propsText: '',
    style: 'photoreal', aspect: '16:9', matchImagePath: inputImage, keepOutfit: true,
  })
  const set = <K extends keyof SheetBrief>(k: K, v: SheetBrief[K]) => setBrief(b => ({ ...b, [k]: v }))

  const hasContent = brief.character || brief.location || brief.props
  const needsCharacterForOutfits = brief.outfits && !brief.character
  const valid = hasContent && !needsCharacterForOutfits
  const prompt = buildSheetBrief(brief)

  const close = () => { c.cancel(); onClose() }
  const writeHere = () => { void c.startRun(prompt) }
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
  const browseMatch = async () => {
    const paths = await window.electronAPI.showOpenFileDialog({
      title: 'Select a character reference image',
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (paths && paths.length > 0) set('matchImagePath', paths[0])
  }

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

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={close}>
      <div className="bg-zinc-900 rounded-2xl border border-zinc-700/50 shadow-2xl w-full max-w-lg relative overflow-hidden max-h-[calc(100dvh-2rem)] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-5 w-5 text-[rgb(var(--accent))]" />
            <h2 className="text-lg font-bold text-white">Make a reference sheet</h2>
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
              then use the result as the Ingredients input in IC-LoRA.{brief.matchImagePath ? ' With a character image, load that same image as the Image-mode input too, so the image model can see the person.' : ''}
            </p>

            <div>
              <label className={labelCls}>What goes on the sheet?</label>
              <div className="flex gap-2">
                <Toggle k="character" label="Character" hint="One or two people, full body and face" />
                <Toggle k="outfits" label="Outfits" hint="Several outfits of the same character, one panel each" />
                <Toggle k="location" label="Location" hint="An empty wide plate of the place" />
                <Toggle k="props" label="Props" hint="Key objects, shown on their own" />
              </div>
              {!hasContent && <p className="mt-1.5 text-[11px] text-amber-300/80">Pick at least a character, a location or props.</p>}
              {needsCharacterForOutfits && <p className="mt-1.5 text-[11px] text-amber-300/80">Outfits need a character. Turn Character on.</p>}
            </div>

            {brief.character && (
              <div className="space-y-3">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 px-3 py-3 flex items-start gap-3">
                  {brief.matchImagePath ? (
                    <img src={pathToFileUrl(brief.matchImagePath)} alt="" className="h-24 w-20 object-cover rounded-lg border border-zinc-700 flex-shrink-0" />
                  ) : (
                    <div className="h-24 w-20 rounded-lg border border-dashed border-zinc-700 flex items-center justify-center text-[11px] text-zinc-500 text-center px-1 flex-shrink-0">No image</div>
                  )}
                  <div className="min-w-0 space-y-2">
                    <div className="text-xs font-medium text-zinc-300">Character reference image (optional)</div>
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                      Have a picture of the person? Claude copies their face, hair and build exactly instead of inventing them.
                      {inputImage && brief.matchImagePath !== inputImage ? ' Your Image-mode input image is available too.' : ''}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => void browseMatch()}
                        className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 text-xs text-zinc-300 transition-colors">
                        {brief.matchImagePath ? 'Change image' : 'Choose image'}
                      </button>
                      {inputImage && brief.matchImagePath !== inputImage && (
                        <button type="button" onClick={() => set('matchImagePath', inputImage)}
                          className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 text-xs text-zinc-300 transition-colors">
                          Use the input image
                        </button>
                      )}
                      {brief.matchImagePath && (
                        <button type="button" onClick={() => set('matchImagePath', null)} className="px-2 py-1.5 text-xs text-zinc-500 hover:text-white">Remove</button>
                      )}
                    </div>
                    {brief.matchImagePath && (
                      <div className="flex gap-1.5">
                        {([[true, 'Keep their outfit'], [false, 'Use my outfit text']] as [boolean, string][]).map(([v, label]) => (
                          <button key={label} type="button" onClick={() => set('keepOutfit', v)} className={pill(brief.keepOutfit === v)}>{label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-zinc-400">
                      {brief.matchImagePath ? 'Anything to change or add?' : 'Who is the character?'}
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
                    placeholder={brief.matchImagePath
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
    </div>,
    document.body,
  )
}

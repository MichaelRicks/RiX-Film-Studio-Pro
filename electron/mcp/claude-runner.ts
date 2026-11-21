import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { logger } from '../logger'
import { getMainWindow } from '../window'
import { listLibrary } from '../ipc/library-handlers'
import { findClaudeCli, ALLOW_RULES } from './claude-connect'
import type { ClaudeRunEvent } from '../../shared/electron-api-schema'

/**
 * "Prompt with Claude", in the background: runs the user's OWN Claude Code (print mode) with a
 * brief, so the prompt appears in the Generate box without switching to the Claude app. It uses
 * their Claude login and plan: we never touch credentials, and any API-key env vars are removed
 * from the child so it cannot fall back to per-call API billing.
 *
 * Only the tools "Connect Claude" already allows can run (inspect_media, set_generation_prompt,
 * the prompt-folder tools and the RiX skills). Everything that edits files or runs commands is
 * explicitly denied, and print mode cannot ask for approval, so nothing else can happen.
 */

const RUN_TIMEOUT_MS = 6 * 60 * 1000
const DENIED_TOOLS = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent']

const runs = new Map<string, { child: ChildProcess; stop: () => void }>()

const emit = (e: ClaudeRunEvent) => getMainWindow()?.webContents.send('claude-run-event', e)

/** A short, friendly status line for a tool call, or null to stay quiet. */
function statusFor(toolName: string): string | null {
  const name = toolName.split('__').pop() ?? toolName
  switch (name) {
    case 'inspect_media': return 'Looking at your image…'
    case 'set_generation_prompt': return 'Putting the prompt in the prompt box…'
    case 'list_prompt_folders': return 'Checking your prompt folders…'
    case 'save_prompt': return 'Saving the prompt…'
    case 'Skill': return 'Loading the prompt skill…'
    default: return null
  }
}

export function startClaudeRun(opts: { prompt: string; sessionId?: string }): { success: true; runId: string } | { success: false; error: string } {
  const prompt = opts.prompt.trim()
  if (!prompt) return { success: false, error: 'Empty brief' }
  const cli = findClaudeCli()
  if (!cli) return { success: false, error: "Couldn't find Claude Code on this computer. Install Claude Desktop, sign in, and open its Code tab once." }

  const args = [
    '-p', '--output-format', 'stream-json', '--verbose',
    '--allowedTools', ALLOW_RULES.join(','),
    '--disallowedTools', DENIED_TOOLS.join(','),
    ...(opts.sessionId ? ['--resume', opts.sessionId] : []),
  ]
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN

  const runId = randomUUID()
  let child: ChildProcess
  try {
    child = spawn(cli, args, { cwd: listLibrary().root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (e) {
    return { success: false, error: `Couldn't start Claude: ${e instanceof Error ? e.message : String(e)}` }
  }
  let buffer = ''
  let stderrTail = ''
  let finished = false
  let sessionId = opts.sessionId
  let lastText = ''
  const finish = (e: ClaudeRunEvent) => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    runs.delete(runId)
    emit(e)
  }

  const handleLine = (line: string) => {
    let msg: Record<string, unknown>
    try { msg = JSON.parse(line) as Record<string, unknown> } catch { return }
    if (typeof msg.session_id === 'string' && msg.session_id !== sessionId) {
      sessionId = msg.session_id
      emit({ runId, kind: 'session', sessionId })
    }
    if (msg.type === 'assistant') {
      const content = (msg.message as { content?: unknown } | undefined)?.content
      if (!Array.isArray(content)) return
      for (const part of content as Array<{ type?: string; text?: string; name?: string }>) {
        if (part.type === 'tool_use' && part.name) {
          const s = statusFor(part.name)
          if (s) emit({ runId, kind: 'status', text: s })
        } else if (part.type === 'text' && part.text) {
          lastText = part.text
        }
      }
    } else if (msg.type === 'result') {
      const text = typeof msg.result === 'string' && msg.result ? msg.result : lastText
      if (msg.is_error === true) finish({ runId, kind: 'error', text: text || 'Claude stopped with an error.', sessionId })
      else finish({ runId, kind: 'done', text, sessionId })
    }
  }

  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) handleLine(line)
    }
  })
  child.stderr?.on('data', (chunk: Buffer) => { stderrTail = (stderrTail + chunk.toString('utf8')).slice(-2000) })
  child.on('error', (e) => finish({ runId, kind: 'error', text: `Couldn't run Claude: ${e.message}` }))
  child.on('close', (code) => {
    if (buffer.trim()) handleLine(buffer.trim())
    if (finished) return
    logger.warn(`[Claude run] exited ${code} without a result: ${stderrTail.slice(-400)}`)
    const loginHint = /log ?in|auth|credential/i.test(stderrTail) ? ' Open Claude Desktop and make sure you are signed in.' : ''
    finish({ runId, kind: 'error', text: `Claude stopped before finishing.${loginHint}`, sessionId })
  })
  const timer = setTimeout(() => {
    child.kill()
    finish({ runId, kind: 'error', text: 'Claude took too long and was stopped.', sessionId })
  }, RUN_TIMEOUT_MS)
  runs.set(runId, {
    child,
    stop: () => { child.kill(); finish({ runId, kind: 'error', text: 'Stopped.', sessionId }) },
  })

  child.stdin?.on('error', () => { /* process ended early; close handler reports it */ })
  child.stdin?.end(prompt)
  logger.info(`[Claude run] started ${runId}${opts.sessionId ? ' (follow-up)' : ''}`)
  return { success: true, runId }
}

export function cancelClaudeRun(runId: string): void {
  runs.get(runId)?.stop()
}

export function stopAllClaudeRuns(): void {
  for (const r of [...runs.values()]) r.stop()
}

// ---- Sign-in for background runs --------------------------------------------------------------
// Claude Desktop keeps its login to itself, so the Claude Code program RiX starts needs its own
// one-time sign-in (`claude auth login`, the user's Claude subscription). The program stores that
// login itself; RiX never sees or handles credentials.

const cleanEnv = () => {
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  return env
}

/** Is the Claude Code program found, and is it signed in with a Claude account? */
export function claudeAuthStatus(): Promise<{ cliFound: boolean; loggedIn: boolean }> {
  const cli = findClaudeCli()
  if (!cli) return Promise.resolve({ cliFound: false, loggedIn: false })
  return new Promise((resolve) => {
    let out = ''
    const child = spawn(cli, ['auth', 'status', '--json'], { env: cleanEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    const timer = setTimeout(() => child.kill(), 15000)
    child.stdout?.on('data', (c: Buffer) => { out += c.toString('utf8') })
    child.on('error', () => { clearTimeout(timer); resolve({ cliFound: true, loggedIn: false }) })
    child.on('close', () => {
      clearTimeout(timer)
      try { resolve({ cliFound: true, loggedIn: (JSON.parse(out) as { loggedIn?: boolean }).loggedIn === true }) }
      catch { resolve({ cliFound: true, loggedIn: false }) }
    })
  })
}

let loginInFlight: Promise<{ success: true } | { success: false; error: string }> | null = null

/** Opens the user's browser to sign in to their Claude subscription. Resolves when sign-in finishes. */
export function claudeAuthLogin(): Promise<{ success: true } | { success: false; error: string }> {
  if (loginInFlight) return loginInFlight
  const cli = findClaudeCli()
  if (!cli) return Promise.resolve({ success: false, error: "Couldn't find Claude Code on this computer." })
  loginInFlight = new Promise((resolve) => {
    const child = spawn(cli, ['auth', 'login', '--claudeai'], { env: cleanEnv(), windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] })
    const timer = setTimeout(() => child.kill(), 5 * 60 * 1000)
    const done = async () => {
      clearTimeout(timer)
      loginInFlight = null
      const s = await claudeAuthStatus()
      resolve(s.loggedIn ? { success: true } : { success: false, error: 'Sign-in was not completed. Try again, and finish signing in in your browser.' })
    }
    child.on('error', () => { void done() })
    child.on('close', () => { void done() })
  })
  return loginInFlight
}

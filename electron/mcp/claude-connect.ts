import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getCurrentDir, isDev } from '../config'
import { logger } from '../logger'

/**
 * "Connect Claude": one-time setup so the USER'S OWN Claude Code (their plan, their
 * login — RiX never touches Claude credentials) can drive the RiX editor:
 *   1. registers this install's MCP endpoint (url + bearer token) as a user-scope
 *      MCP server named "rix-editor" in Claude Code;
 *   2. installs the bundled skills (rix-editor, rix-prompt, rix-prompt-sheet) into ~/.claude/skills;
 *   3. allows the two calls "Prompt with Claude" needs (inspect_media, set_generation_prompt) and its
 *      two skills in ~/.claude/settings.json, so Claude doesn't ask before each step. Neither call
 *      generates, edits or deletes anything. The editor's cut/export tools still ask.
 * Only runs when the user clicks Connect. Everything it writes is listed in the UI.
 */

// rix-editor: cutting/exporting in the Video Editor. rix-prompt: "Prompt with Claude" on Generate.
// rix-prompt-sheet: the same, when the image is a character/reference sheet.
const SKILL_NAMES = ['rix-editor', 'rix-prompt', 'rix-prompt-sheet'] as const
type SkillName = (typeof SKILL_NAMES)[number]
// Dev builds register under their own name: they have a different token than an
// installed build on the same machine, and sharing one name would make each
// build's Connect overwrite the other's registration.
const SERVER_NAME = isDev ? 'rix-editor-dev' : 'rix-editor'

const claudeConfigPath = () => path.join(os.homedir(), '.claude.json')
const claudeSettingsPath = () => path.join(os.homedir(), '.claude', 'settings.json')
const ALLOW_RULES = [
  `mcp__${SERVER_NAME}__inspect_media`,
  `mcp__${SERVER_NAME}__set_generation_prompt`,
  'Skill(rix-prompt)',
  'Skill(rix-prompt-sheet)',
]
const skillDir = (name: SkillName) => path.join(os.homedir(), '.claude', 'skills', name)
const skillPath = (name: SkillName) => path.join(skillDir(name), 'SKILL.md')
const bundledSkillPath = (name: SkillName) => (isDev
  ? path.join(getCurrentDir(), 'resources', 'claude', name, 'SKILL.md')
  : path.join(process.resourcesPath, 'claude', name, 'SKILL.md'))

const sha = (file: string): string | null => {
  try { return createHash('sha256').update(fs.readFileSync(file)).digest('hex') } catch { return null }
}

/** A runnable Claude Code CLI binary, or null. `.cmd` shims are skipped (they need a
 *  shell, and the auth header contains spaces) — the config-file path covers those. */
function findClaudeCli(): string | null {
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const candidates: string[] = []
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8', timeout: 5000 })
  if (which.status === 0) candidates.push(...which.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean))
  candidates.push(path.join(os.homedir(), '.local', 'bin', exe))
  if (process.platform === 'win32' && process.env.APPDATA) {
    // Claude Desktop bundles the CLI per version: %APPDATA%\Claude\claude-code\<version>\claude.exe
    const root = path.join(process.env.APPDATA, 'Claude', 'claude-code')
    try {
      const versions = fs.readdirSync(root).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      for (const v of versions) candidates.push(path.join(root, v, exe))
    } catch { /* Claude Desktop not installed */ }
  } else {
    candidates.push('/usr/local/bin/claude', '/opt/homebrew/bin/claude')
  }
  return candidates.find(c => !/\.(cmd|bat|ps1)$/i.test(c) && fs.existsSync(c)) ?? null
}

type Endpoint = { port: number; token: string }
const endpointUrl = (e: Endpoint) => `http://127.0.0.1:${e.port}/mcp`
const authHeader = (e: Endpoint) => `Bearer ${e.token}`

function readClaudeConfig(): Record<string, unknown> | null {
  try { return JSON.parse(fs.readFileSync(claudeConfigPath(), 'utf8')) as Record<string, unknown> } catch { return null }
}

export function claudeConnectStatus(endpoint: Endpoint) {
  const cfg = readClaudeConfig()
  const entry = (cfg?.mcpServers as Record<string, { url?: string; headers?: Record<string, string> }> | undefined)?.[SERVER_NAME]
  return {
    /** Claude Code has been set up on this machine (CLI present, or it has written its config). */
    claudeFound: findClaudeCli() !== null || cfg !== null,
    /** Registered AND pointing at this install's current address + token. */
    mcpRegistered: !!entry && entry.url === endpointUrl(endpoint) && entry.headers?.Authorization === authHeader(endpoint),
    skillInstalled: SKILL_NAMES.every(n => sha(skillPath(n)) !== null),
    /** Every installed skill is byte-identical to the one this build ships. */
    skillCurrent: SKILL_NAMES.every(n => { const i = sha(skillPath(n)); return i !== null && i === sha(bundledSkillPath(n)) }),
  }
}

function registerViaCli(cli: string, endpoint: Endpoint): boolean {
  const run = (args: string[]) => spawnSync(cli, args, { encoding: 'utf8', timeout: 30000, windowsHide: true })
  run(['mcp', 'remove', SERVER_NAME, '--scope', 'user']) // ok if it wasn't there
  const r = run(['mcp', 'add', '--transport', 'http', SERVER_NAME, endpointUrl(endpoint),
    '--header', `Authorization: ${authHeader(endpoint)}`, '--scope', 'user'])
  if (r.status !== 0) logger.warn(`[Connect Claude] CLI registration failed (exit ${r.status}); falling back to the config file`)
  return r.status === 0
}

/** Merge our server entry into ~/.claude.json (backup first, atomic replace). */
function registerViaConfig(endpoint: Endpoint): void {
  const file = claudeConfigPath()
  const cfg = readClaudeConfig()
  if (!cfg) throw new Error("Claude Code's settings file wasn't found. Open Claude Desktop's Code tab once, then try again.")
  fs.copyFileSync(file, `${file}.rix-backup`)
  const servers = { ...((cfg.mcpServers as Record<string, unknown> | undefined) ?? {}) }
  servers[SERVER_NAME] = { type: 'http', url: endpointUrl(endpoint), headers: { Authorization: authHeader(endpoint) } }
  const tmp = `${file}.rix-tmp`
  fs.writeFileSync(tmp, JSON.stringify({ ...cfg, mcpServers: servers }, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

/** Install (or, when asked, update) the bundled skill. A differing existing file is
 *  never silently replaced: it is kept unless `update`, and backed up when replaced. */
function installSkill(name: SkillName, update: boolean): 'installed' | 'updated' | 'kept' | 'current' {
  const bundled = bundledSkillPath(name)
  if (!fs.existsSync(bundled)) throw new Error(`The ${name} skill is missing from this build.`)
  const target = skillPath(name)
  const existing = sha(target)
  if (existing === sha(bundled)) return 'current'
  if (existing !== null && !update) return 'kept'
  fs.mkdirSync(skillDir(name), { recursive: true })
  if (existing !== null) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    fs.copyFileSync(target, path.join(skillDir(name), `SKILL.md.bak-${stamp}`))
  }
  fs.copyFileSync(bundled, target)
  return existing === null ? 'installed' : 'updated'
}

/** Add our allow rules to ~/.claude/settings.json (backup first, atomic replace, nothing else touched). */
function allowPromptCalls(): void {
  const file = claudeSettingsPath()
  let cfg: Record<string, unknown> = {}
  if (fs.existsSync(file)) {
    try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown> } catch { return } // unreadable: leave it alone
    fs.copyFileSync(file, `${file}.rix-backup`)
  }
  const perms = { ...((cfg.permissions as Record<string, unknown> | undefined) ?? {}) }
  const allow = Array.isArray(perms.allow) ? (perms.allow as string[]) : []
  const missing = ALLOW_RULES.filter(r => !allow.includes(r))
  if (missing.length === 0) return
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.rix-tmp`
  fs.writeFileSync(tmp, JSON.stringify({ ...cfg, permissions: { ...perms, allow: [...allow, ...missing] } }, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

export function connectClaude(endpoint: Endpoint, opts: { updateSkill?: boolean } = {}) {
  const cli = findClaudeCli()
  let via: 'cli' | 'config'
  if (cli && registerViaCli(cli, endpoint)) via = 'cli'
  else { registerViaConfig(endpoint); via = 'config' }
  const results = SKILL_NAMES.map(n => installSkill(n, opts.updateSkill === true))
  try { allowPromptCalls() } catch (e) { logger.warn(`[Connect Claude] could not update permissions: ${String(e)}`) }
  // One summary value for the UI: anything installed/updated wins over kept/current.
  const skill = (['updated', 'installed', 'kept', 'current'] as const).find(r => results.includes(r)) ?? 'current'
  logger.info(`[Connect Claude] registered via ${via}; skill ${skill}`)
  return { via, skill }
}

/** Remove the RiX server from Claude Code. The skill file is left in place. */
export function disconnectClaude(): void {
  const cli = findClaudeCli()
  if (cli && spawnSync(cli, ['mcp', 'remove', SERVER_NAME, '--scope', 'user'], { timeout: 30000, windowsHide: true }).status === 0) return
  const file = claudeConfigPath()
  const cfg = readClaudeConfig()
  const servers = cfg?.mcpServers as Record<string, unknown> | undefined
  if (!cfg || !servers || !(SERVER_NAME in servers)) return
  fs.copyFileSync(file, `${file}.rix-backup`)
  const { [SERVER_NAME]: _removed, ...rest } = servers
  const tmp = `${file}.rix-tmp`
  fs.writeFileSync(tmp, JSON.stringify({ ...cfg, mcpServers: rest }, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

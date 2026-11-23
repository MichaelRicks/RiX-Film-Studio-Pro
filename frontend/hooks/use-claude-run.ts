import { useCallback, useEffect, useState } from 'react'

/**
 * Shared plumbing for the "with Claude" dialogs: is Claude connected, is Claude Code signed in, and
 * a background run (progress lines, reply, follow-ups) through electron/mcp/claude-runner.ts.
 * PromptWithClaudeModal has its own older copy of this; SheetMakerModal uses the hook.
 */

export interface ClaudeRun {
  runId: string
  sessionId?: string
  phase: 'running' | 'done' | 'error'
  lines: string[]
  reply: string
}

type McpStatus = Awaited<ReturnType<typeof window.electronAPI.mcpGetStatus>>
type ConnectStatus = Awaited<ReturnType<typeof window.electronAPI.claudeConnectStatus>>

export function useClaudeRun() {
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [conn, setConn] = useState<ConnectStatus | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [auth, setAuth] = useState<{ cliFound: boolean; loggedIn: boolean } | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [run, setRun] = useState<ClaudeRun | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refreshStatus = useCallback(() => {
    void window.electronAPI.mcpGetStatus().then(setStatus).catch(() => {})
    void window.electronAPI.claudeConnectStatus().then(setConn).catch(() => {})
  }, [])
  const refreshAuth = useCallback(() => {
    void window.electronAPI.claudeAuthStatus().then(setAuth).catch(() => {})
  }, [])
  useEffect(() => { refreshAuth() }, [refreshAuth])
  useEffect(() => {
    refreshStatus()
    const t = setInterval(refreshStatus, 3000)
    return () => clearInterval(t)
  }, [refreshStatus])

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

  const startRun = async (prompt: string, sessionId?: string) => {
    setError(null)
    const r = await window.electronAPI.claudeRunStart({ prompt, sessionId })
    if (!r.success) { setError(r.error); return }
    setRun({ runId: r.runId, sessionId, phase: 'running', lines: ['Starting Claude…'], reply: '' })
  }
  const cancel = () => {
    if (run?.phase === 'running') void window.electronAPI.claudeRunCancel({ runId: run.runId })
  }

  const connected = !!conn?.mcpRegistered && !!conn?.skillInstalled
  const ready = !!status?.running && connected
  return {
    status, conn, auth, run, setRun, error, setError, connecting, signingIn,
    connected, ready, canRunHere: ready && !!auth?.loggedIn,
    connect, signIn, startRun, cancel, refreshStatus,
  }
}

import { AlertCircle, Check, Download, Loader2, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppSettings } from '../contexts/AppSettingsContext'
import { useHfAuth } from '../hooks/use-hf-auth'
import { useHfModelAccess } from '../hooks/use-hf-model-access'
import { ApiClient } from '../lib/api-client'
import { formatBytes } from '../lib/format'
import { logger } from '../lib/logger'
import { HfModelAccessGate } from './HfModelAccessGate'
import { Button } from './ui/button'

export const DFR_LORA_CP_ID = 'ltx-2.5-dfr-detail-lora' as const
// Module-level so the access check's dependency stays stable between renders.
const DFR_CP_IDS = [DFR_LORA_CP_ID]
const DFR_LORA_SIZE_BYTES = 327_322_640
const POLL_INTERVAL_MS = 1000

/**
 * Gets the gated DFR detail LoRA: Hugging Face sign-in, license acceptance on the model's own
 * page (only the user can do that), then a normal model download. Mount it only while open.
 * Closing does not stop a running download; reopening picks its progress back up.
 */
export function DfrDownloadModal({ onClose, onInstalled }: { onClose: () => void; onInstalled: () => void }) {
  const { notifyModelsChanged } = useAppSettings()
  const { hfAuthStatus, hfAuthPolling, startHuggingFaceLogin } = useHfAuth(true)
  const { accessMap, allAuthorized, checking, checkError, recheckAccess } = useHfModelAccess(DFR_CP_IDS, hfAuthStatus)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [percent, setPercent] = useState(0)
  const [starting, setStarting] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onInstalledRef = useRef(onInstalled)
  onInstalledRef.current = onInstalled

  const finish = useCallback(() => {
    setSessionId(null)
    setInstalled(true)
    notifyModelsChanged()
    onInstalledRef.current()
  }, [notifyModelsChanged])

  // Already installed, or a download for it is already running.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const described = await ApiClient.describeCheckpoints({ cp_ids: [...DFR_CP_IDS] })
      if (cancelled) return
      if (described.ok && described.data.checkpoints[0]?.downloaded) {
        finish()
        return
      }
      const active = await ApiClient.getActiveDownload()
      if (cancelled || !active.ok || !active.data.session_id) return
      if (active.data.cp_ids?.includes(DFR_LORA_CP_ID)) setSessionId(active.data.session_id)
    })()
    return () => { cancelled = true }
  }, [finish])

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    let done = false
    const poll = async () => {
      const result = await ApiClient.getModelDownloadProgress({ sessionId })
      if (cancelled || done) return
      if (!result.ok) {
        logger.error(`DFR LoRA progress poll failed: ${result.error.message}`)
        return
      }
      const progress = result.data
      if (progress.status === 'downloading') {
        setPercent(Math.round(progress.total_progress))
      } else if (progress.status === 'error') {
        done = true
        setSessionId(null)
        setError(progress.error || 'Download failed.')
      } else if (progress.status === 'complete') {
        done = true
        finish()
      }
    }
    void poll()
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [sessionId, finish])

  const download = async () => {
    setError(null)
    setPercent(0)
    setStarting(true)
    const result = await ApiClient.startModelDownload({ type: 'download', cp_ids: [...DFR_CP_IDS] })
    setStarting(false)
    if (!result.ok) {
      setError(result.error.message || 'Failed to start the download.')
      // Access may have changed since the last check.
      recheckAccess()
      return
    }
    if (result.data.status !== 'started') {
      setError('Unexpected response while starting the download.')
      return
    }
    setSessionId(result.data.sessionId)
  }

  const busy = starting || sessionId !== null

  return createPortal(
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { e.stopPropagation(); onClose() }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-zinc-700/50 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Download the DFR detail LoRA"
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Sparkles className="h-4 w-4 text-amber-400" />
            DFR detail LoRA
          </h2>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <p className="text-xs leading-relaxed text-zinc-300">
            DFR adds a detail pass for sharper video, and usually takes longer to render. It needs one extra
            file ({formatBytes(DFR_LORA_SIZE_BYTES)}) from Hugging Face, with its own license for you to
            accept, even if you already have access to LTX 2.5. Normal generation does not need it.
          </p>

          {installed ? (
            <div className="flex items-center gap-2 text-xs text-green-400">
              <Check className="h-3.5 w-3.5 flex-shrink-0" />
              Installed. You can use DFR now.
            </div>
          ) : (
            <HfModelAccessGate
              accessMap={accessMap}
              allAuthorized={allAuthorized}
              hfAuthStatus={hfAuthStatus}
              hfAuthPolling={hfAuthPolling}
              startHuggingFaceLogin={() => { void startHuggingFaceLogin() }}
              checkError={checkError}
              onRetryCheck={recheckAccess}
            />
          )}

          {sessionId && (
            <div className="space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full bg-blue-500 transition-all" style={{ width: `${percent}%` }} />
              </div>
              <p className="text-[11px] text-zinc-500">
                Downloading… {percent}%. You can close this window; the download continues.
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-1.5 text-xs text-red-400">
              <AlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <Button size="sm" variant="outline" onClick={onClose} className="border-zinc-700 text-xs text-zinc-300">
            {installed ? 'Done' : 'Close'}
          </Button>
          {!installed && (
            <Button
              size="sm"
              onClick={() => void download()}
              disabled={busy || checking || !allAuthorized}
              className="bg-blue-600 text-xs text-white hover:bg-blue-500"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {error ? 'Try again' : 'Download'}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

import { useCallback, useState } from 'react'
import { ApiClient, type ApiRequestBodyOf } from '../lib/api-client'
import { withExclusiveGeneration } from '../lib/generation-active'
import { logger } from '../lib/logger'

export type EnhanceDetailParams = ApiRequestBodyOf<'enhanceDetail'>

interface EnhanceDetailState {
  isEnhancingDetail: boolean
  enhanceDetailError: string | null
  enhanceDetailResult: { videoPath: string } | null
}

const IDLE: EnhanceDetailState = { isEnhancingDetail: false, enhanceDetailError: null, enhanceDetailResult: null }

/** FORK: runs "Enhance detail" on a finished clip. Local only, so Stop always works. */
export function useEnhanceDetail() {
  const [state, setState] = useState<EnhanceDetailState>(IDLE)

  const submitEnhanceDetail = useCallback(async (params: NonNullable<EnhanceDetailParams>) => {
    setState({ ...IDLE, isEnhancingDetail: true })
    await withExclusiveGeneration(async () => {
      const result = await ApiClient.enhanceDetail(params)
      if (!result.ok) {
        logger.error(`Enhance detail error: ${result.error.message}`)
        setState({ ...IDLE, enhanceDetailError: result.error.message })
        return
      }
      const payload = result.data
      if (payload.status !== 'cancelled' && 'video_path' in payload) {
        setState({ ...IDLE, enhanceDetailResult: { videoPath: payload.video_path } })
        return
      }
      setState(IDLE)
    })
  }, [])

  const cancelEnhanceDetail = useCallback(async () => {
    const result = await ApiClient.cancelGeneration()
    if (!result.ok) logger.error(`Failed to stop Enhance detail: ${result.error.message}`)
  }, [])

  const resetEnhanceDetail = useCallback(() => setState(IDLE), [])

  return { ...state, submitEnhanceDetail, cancelEnhanceDetail, resetEnhanceDetail }
}

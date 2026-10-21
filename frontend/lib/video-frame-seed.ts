/**
 * Seed the prompt bar's start-frame slot from a video.
 *
 * Dropping a clip on the image slot means "re-roll this shot": the slot takes
 * the clip's opening frame, which is where that shot began (for an i2v gen it
 * is the original input image). Only the frame travels. A clip's prompt, model,
 * seed and LoRAs live on the project's asset record, not on the file, so a clip
 * dragged in from Studio Assets carries none of them.
 */

import { logger } from './logger'
import { flashToast } from './video-save-actions'

export async function frameSeedFromVideo(videoPath: string, seekTime?: number): Promise<string | null> {
  const api = window.electronAPI
  if (!api?.extractVideoSeedFrame) {
    flashToast('Restart the app to drop videos here', true)
    return null
  }
  try {
    const res = await api.extractVideoSeedFrame({ videoPath, seekTime })
    return res?.path || null
  } catch (err) {
    logger.error(`Could not extract the frame at ${seekTime ?? 0}s of ${videoPath}: ${err}`)
    flashToast('Could not read that video', true)
    return null
  }
}

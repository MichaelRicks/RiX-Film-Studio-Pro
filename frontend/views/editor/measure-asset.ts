import type { Asset } from '../../types/project-model'
import { pathToFileUrl } from '../../lib/file-url'
import { probeVideoDuration } from '../../lib/probe-video-duration'

// A clip dropped on the timeline takes its length from `asset.duration`, and falls back to 5
// seconds when there is none. Auto-length generations are saved without one, and a stored length
// is the requested one, not the file's. Reading the file settles it: the whole clip goes in.
const PROBE_TIMEOUT_MS = 4000
const probed = new Map<string, Promise<number | undefined>>()

function fileDuration(path: string): Promise<number | undefined> {
  let pending = probed.get(path)
  if (!pending) {
    // A file that never reports its length must not stall the drop: give up and use the stored one.
    pending = Promise.race([
      probeVideoDuration(pathToFileUrl(path)),
      new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), PROBE_TIMEOUT_MS)),
    ])
    probed.set(path, pending)
  }
  return pending
}

/** The asset with its duration read from its media file; stills and other asset types come back unchanged. */
export async function withMeasuredDuration(asset: Asset): Promise<Asset> {
  if ((asset.type !== 'video' && asset.type !== 'audio') || !asset.path) return asset
  const actual = await fileDuration(asset.path)
  if (!actual || Math.abs(actual - (asset.duration ?? 0)) <= 0.05) return asset
  return { ...asset, duration: actual }
}

export function withMeasuredDurations(assets: Asset[]): Promise<Asset[]> {
  return Promise.all(assets.map(withMeasuredDuration))
}

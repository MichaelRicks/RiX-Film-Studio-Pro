import { useEffect, useMemo } from 'react'
import { selectAssets, selectClips } from './editor-selectors'
import { useEditorActions, useEditorStore } from './editor-store'
import { withMeasuredDuration } from './measure-asset'

/**
 * Keeps the stored length of every media file on the timeline equal to the file's real length.
 * A clip can only be dragged out as far as its media goes, so that length has to be true: assets
 * saved without one (Auto-length generations) could be stretched forever, and ones that stored
 * the requested length could be stretched past the file, which breaks playback.
 */
export function useCorrectedAssetDurations() {
  const assets = useEditorStore(selectAssets)
  const clips = useEditorStore(selectClips)
  const { correctAssetDurations } = useEditorActions()

  const used = useMemo(() => {
    const ids = new Set<string>()
    for (const clip of clips) if (clip.assetId) ids.add(clip.assetId)
    return assets.filter(a => (a.type === 'video' || a.type === 'audio') && a.path && ids.has(a.id))
  }, [assets, clips])
  // Re-check only when the set of files or their stored lengths change, not on every clip drag.
  const signature = useMemo(() => used.map(a => `${a.id}|${a.path}|${a.duration ?? ''}`).join(';'), [used])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const fixes: Record<string, number> = {}
      for (const asset of used) {
        const measured = await withMeasuredDuration(asset)
        if (measured.duration && measured.duration !== asset.duration) fixes[asset.id] = measured.duration
      }
      if (!cancelled && Object.keys(fixes).length > 0) correctAssetDurations(fixes)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, correctAssetDurations])
}

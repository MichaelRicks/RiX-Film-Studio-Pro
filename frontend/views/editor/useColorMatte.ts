import { useCallback } from 'react'
import type { Asset, TimelineClip } from '../../types/project-model'
import { saveDataUrlToTempFile } from '../../components/gpm/gpm-image-file'
import { useProjects } from '../../contexts/ProjectContext'
import { buildAssetFromPath } from './dropped-media-asset'
import { selectClips, selectCurrentTime, selectTotalDuration, selectTracks } from './editor-selectors'
import { useEditorActions, useEditorGetState } from './editor-store'

// A color matte is a solid-color still: a real PNG registered as an image asset,
// so the monitor, the layer compositing, transitions and the ffmpeg export all
// treat it exactly like any other image clip. The asset's `matteColor` is what
// marks it as one, and what the properties panel recolors.

export const DEFAULT_MATTE_COLOR = '#202020'
const MATTE_WIDTH = 1920
const MATTE_HEIGHT = 1080
const MIN_MATTE_DURATION = 10

async function createMatteAsset(color: string, projectId: string | null, duration: number): Promise<Asset> {
  const canvas = document.createElement('canvas')
  canvas.width = MATTE_WIDTH
  canvas.height = MATTE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.fillStyle = color
  ctx.fillRect(0, 0, MATTE_WIDTH, MATTE_HEIGHT)
  const path = await saveDataUrlToTempFile(canvas.toDataURL('image/png'), `matte_${color.replace('#', '')}.png`)
  const asset = await buildAssetFromPath(path, false, projectId, `Color Matte ${color}`)
  return {
    ...asset,
    prompt: `Color Matte ${color}`,
    resolution: `${MATTE_WIDTH}x${MATTE_HEIGHT}`,
    duration,
    matteColor: color,
  }
}

export function useColorMatte() {
  const actions = useEditorActions()
  const getState = useEditorGetState()
  const { activeProject } = useProjects()
  const projectId = activeProject?.id ?? null

  /** Put a matte on the lowest video track that is free where it lands, from the
   *  playhead to the end of the program, and select it. The lowest free track
   *  keeps it behind the footage; it only ever sits above a clip that is already
   *  a layer, which draws over it regardless. */
  const addColorMatte = useCallback(async (color = DEFAULT_MATTE_COLOR) => {
    const state = getState()
    const start = selectCurrentTime(state)
    const duration = Math.max(MIN_MATTE_DURATION, +(selectTotalDuration(state) - start).toFixed(2))
    const tracks = selectTracks(state)
    const clips = selectClips(state)
    const trackIndex = tracks.findIndex((track, i) =>
      track.kind === 'video' && !track.locked &&
      !clips.some(c => c.trackIndex === i && c.startTime < start + duration && c.startTime + c.duration > start))
    if (trackIndex < 0) {
      window.alert('No free video track at the playhead. Add a video track, or clear space, then add the matte again.')
      return
    }
    const asset = await createMatteAsset(color, projectId, duration)
    actions.addAssetToEditor(asset)
    actions.insertAssetsToTimeline({ assets: [asset], trackIndex, startTime: start })
    const placed = selectClips(getState()).find(c => c.assetId === asset.id)
    if (placed) actions.selectClip(placed.id)
  }, [actions, getState, projectId])

  /** Swap a matte clip to a new color. Assets can be shared between clips, so this
   *  points the clip at a fresh asset instead of repainting the old one. */
  const recolorMatte = useCallback(async (clip: TimelineClip, color: string) => {
    const asset = await createMatteAsset(color, projectId, clip.duration)
    actions.addAssetToEditor(asset)
    actions.updateClip(clip.id, { assetId: asset.id, asset })
  }, [actions, projectId])

  return { addColorMatte, recolorMatte }
}

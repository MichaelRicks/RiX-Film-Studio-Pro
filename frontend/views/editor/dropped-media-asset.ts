/**
 * Builds a full project `Asset` from an image/video dropped from the Prompt
 * Manager Pro Downloads Browser (`FILE_DND`) or Images tab (`GPM_IMAGE_DND_TYPE`)
 * — neither is a registered project Asset yet, so this copies the file into
 * project storage and probes duration/dimensions, mirroring the file-picker
 * import path in `useEditorMediaImport.ts`.
 */
import type { Asset } from '../../types/project-model'
import { GPM_IMAGE_DND_TYPE, saveDataUrlToTempFile, type GpmDndImage } from '../../components/gpm/gpm-image-file'
import { FILE_DND, type LibFile } from '../../components/gpm/DownloadsBrowser'
import { addGenericAssetToProject, addVisualAssetToProject } from '../../lib/asset-copy'
import { pathToFileUrl } from '../../lib/file-url'

function getMediaDuration(url: string, isAudio = false): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement(isAudio ? 'audio' : 'video')
    v.src = url
    v.onloadedmetadata = () => resolve(v.duration)
    v.onerror = () => resolve(5)
  })
}

export async function buildAssetFromPath(path: string, isVideo: boolean, currentProjectId: string | null, name: string, isAudio = false): Promise<Asset> {
  if (isAudio) {
    // Audio has no thumbnails/dimensions; registering it as an image makes the
    // metadata migration fail on it forever (the "flashing" lock-up).
    let persistentPath = path
    const duration = await getMediaDuration(pathToFileUrl(path), true)
    if (currentProjectId) {
      const copied = await addGenericAssetToProject(path, currentProjectId)
      if (copied?.path) persistentPath = copied.path
    }
    return {
      id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      type: 'audio',
      path: persistentPath,
      prompt: `Imported: ${name}`,
      resolution: 'imported',
      duration,
      createdAt: Date.now(),
    }
  }
  let persistentPath = path
  let bigThumbnailPath: string | undefined
  let smallThumbnailPath: string | undefined
  let width: number | undefined
  let height: number | undefined
  let duration = 5
  if (isVideo) duration = await getMediaDuration(pathToFileUrl(path))
  if (currentProjectId) {
    const copied = await addVisualAssetToProject(path, currentProjectId, isVideo ? 'video' : 'image')
    if (copied) {
      persistentPath = copied.path
      bigThumbnailPath = copied.bigThumbnailPath
      smallThumbnailPath = copied.smallThumbnailPath
      width = copied.width
      height = copied.height
    }
  }
  return {
    id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    type: isVideo ? 'video' : 'image',
    path: persistentPath,
    bigThumbnailPath,
    smallThumbnailPath,
    width,
    height,
    prompt: `Imported: ${name}`,
    resolution: 'imported',
    duration,
    createdAt: Date.now(),
  }
}

export function isDroppedMediaEvent(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(FILE_DND) || e.dataTransfer.types.includes(GPM_IMAGE_DND_TYPE)
}

/** True when the drag carries a native in-app asset (dragged from the Assets panel grid). */
export function isNativeAssetDragEvent(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes('asset') || e.dataTransfer.types.includes('assetId') || e.dataTransfer.types.includes('assetIds')
}

/** Resolves a native in-app asset drag (from the Assets panel grid) to the already-registered Asset. */
export function readDroppedAsset(e: React.DragEvent, assets: Asset[]): Asset | null {
  const assetIdsJson = e.dataTransfer.getData('assetIds')
  if (assetIdsJson) {
    try {
      const ids: string[] = JSON.parse(assetIdsJson)
      const found = ids.map((id) => assets.find((a) => a.id === id)).filter(Boolean) as Asset[]
      if (found.length > 0) return found[0]
    } catch { /* ignore parse errors */ }
  }
  const assetData = e.dataTransfer.getData('asset')
  if (assetData) {
    try { return JSON.parse(assetData) as Asset } catch { /* ignore parse errors */ }
  }
  const assetId = e.dataTransfer.getData('assetId')
  if (assetId) return assets.find((a) => a.id === assetId) ?? null
  return null
}

/** Reads a Downloads Browser / Images tab drop payload and resolves it to a full Asset, or null if neither type is present. */
export function readDroppedMediaAsset(e: React.DragEvent, currentProjectId: string | null): Promise<Asset | null> {
  const dlData = e.dataTransfer.getData(FILE_DND)
  if (dlData) {
    const f = JSON.parse(dlData) as LibFile
    return buildAssetFromPath(f.path, f.isVideo, currentProjectId, f.name, f.isAudio)
  }
  const gpmData = e.dataTransfer.getData(GPM_IMAGE_DND_TYPE)
  if (gpmData) {
    const { name, dataUrl } = JSON.parse(gpmData) as GpmDndImage
    return saveDataUrlToTempFile(dataUrl, name).then((path) => buildAssetFromPath(path, false, currentProjectId, name))
  }
  return Promise.resolve(null)
}

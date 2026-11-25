/**
 * "Save this prompt?" return path for Prompt with Claude. Claude's `list_prompt_folders` and
 * `save_prompt` MCP calls land here (via the editor bridge) and read/write the Prompt Manager Pro
 * prompt library, so a prompt Claude wrote doesn't have to be copied into a folder by hand.
 */
import {
  gpmId, loadPromptFolders, savePromptFolders, setPromptThumb, setPromptImagePath, setPromptLoras, downscaleToThumb, GPM_PROMPTS_CHANGED,
  type GpmPromptFolder, type PromptLora,
} from '../components/gpm/gpm-storage'

export interface PromptFolderSummary { name: string; prompts: number }

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

export async function listPromptFolders(): Promise<{ folders: PromptFolderSummary[] }> {
  const folders = await loadPromptFolders()
  return { folders: folders.map(f => ({ name: f.name, prompts: f.prompts.length })) }
}

export interface SavePromptArgs { folder?: unknown; prompt?: unknown; image_path?: unknown; thumbnail_only?: unknown; loras?: PromptLora[] }
export interface SavePromptResult {
  ok: true
  folder: string
  createdFolder: boolean
  duplicate: boolean
  thumbnail: 'attached' | 'none' | 'failed'
}

export async function savePromptToLibrary(args: SavePromptArgs): Promise<SavePromptResult> {
  const text = typeof args.prompt === 'string' ? args.prompt.trim() : ''
  if (!text) throw new Error('"prompt" is required and must be non-empty text.')
  const folderName = typeof args.folder === 'string' ? args.folder.trim().replace(/\s+/g, ' ') : ''
  if (!folderName) throw new Error('"folder" is required (an existing folder name or a new one to create).')

  const folders = await loadPromptFolders()
  let folder: GpmPromptFolder | undefined = folders.find(f => norm(f.name) === norm(folderName))
  const createdFolder = !folder
  if (!folder) {
    folder = { id: gpmId(), name: folderName, prompts: [] }
    folders.unshift(folder)
  }

  const existing = folder.prompts.find(p => p.text.trim() === text)
  const target = existing ?? { id: gpmId(), text }
  if (!existing) folder.prompts.unshift(target)

  // Only (re)write the folders when something changed; a duplicate may still gain a thumbnail below.
  if (!existing) await savePromptFolders(folders)

  // The LoRAs selected in Create when saving from RiX (Claude's own save_prompt sends none, so it
  // never wipes ones saved earlier).
  if (args.loras && args.loras.length > 0) await setPromptLoras(target.id, args.loras)

  let thumbnail: SavePromptResult['thumbnail'] = 'none'
  const imagePath = typeof args.image_path === 'string' ? args.image_path.trim() : ''
  if (imagePath) {
    try {
      const r = await window.electronAPI?.gpmLibReadAsDataUrl?.({ path: imagePath })
      if (r?.success) {
        await setPromptThumb(target.id, await downscaleToThumb(r.dataUrl))
        if (args.thumbnail_only !== true) await setPromptImagePath(target.id, imagePath)
        thumbnail = 'attached'
      } else {
        thumbnail = 'failed'
      }
    } catch {
      thumbnail = 'failed'
    }
  }

  window.dispatchEvent(new Event(GPM_PROMPTS_CHANGED))
  return { ok: true, folder: folder.name, createdFolder, duplicate: !!existing, thumbnail }
}

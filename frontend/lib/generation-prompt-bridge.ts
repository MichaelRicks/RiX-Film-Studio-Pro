/**
 * "Prompt with Claude" return path. Claude (running in the user's own Claude app)
 * calls the `set_generation_prompt` MCP tool; the main process forwards it to the
 * renderer, which lands here. The mounted Generate screen registers a target, so
 * the prompt goes through the same undo/redo history as an Enhance result.
 */
type PromptTarget = (prompt: string) => void

// On globalThis so a dev hot-reload of this file doesn't drop the mounted screen's registration.
const registry = ((globalThis as Record<string, unknown>).__rixGenPromptTarget ??= { target: null }) as {
  target: PromptTarget | null
}

/** Called by the mounted Generate screen; returns an unregister function. */
export function registerGenerationPromptTarget(target: PromptTarget): () => void {
  registry.target = target
  return () => { if (registry.target === target) registry.target = null }
}

export function setGenerationPrompt(prompt: unknown): { ok: true; chars: number } {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('"prompt" is required and must be non-empty text.')
  if (!registry.target) {
    throw new Error('The RiX Generate screen is not open. Ask the user to open Generate in RiX, then retry.')
  }
  registry.target(prompt.trim())
  return { ok: true, chars: prompt.trim().length }
}

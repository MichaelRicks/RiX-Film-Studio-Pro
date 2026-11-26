/**
 * Character cards for LoRAs. A LoRA file trained on the LTX website carries no trigger word or
 * description, so Claude can't tell who it draws. The user fills a short card once per LoRA
 * (trigger word, what the character looks like, optionally a reference photo) and Prompt with
 * Claude passes it along whenever that LoRA is selected. Kept per viewer in localStorage, keyed by
 * the LoRA's models-folder-relative path.
 */
export interface LoraCard {
  trigger: string
  description: string
  imagePath?: string
}

const KEY = 'rix_lora_cards_v1'
const keyFor = (ref: string) => ref.replace(/\\/g, '/').toLowerCase()

function readAll(): Record<string, LoraCard> {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Record<string, LoraCard>) : {}
  } catch {
    return {}
  }
}

/** First guess at a trigger word: the LoRA's folder name (e.g. loras/Storm01/...), lower-cased. */
export function guessTrigger(ref: string): string {
  const parts = ref.replace(/\\/g, '/').split('/').filter(Boolean)
  const folder = parts.length >= 2 ? parts[parts.length - 2] : ''
  return folder && folder.toLowerCase() !== 'loras' ? folder.toLowerCase() : ''
}

export function getLoraCard(ref: string): LoraCard {
  return readAll()[keyFor(ref)] ?? { trigger: guessTrigger(ref), description: '' }
}

export function setLoraCard(ref: string, card: LoraCard): void {
  try {
    const all = readAll()
    all[keyFor(ref)] = card
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* storage unavailable: the card still applies to this window */
  }
}

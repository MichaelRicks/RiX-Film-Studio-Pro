/**
 * A clip on the timeline is often one segment of a longer multi-shot generation, but its
 * stored prompt still describes every shot. These helpers spot that case and write the
 * brief that asks Claude (in the user's own Claude app, as with "Prompt with Claude") to cut
 * the prompt down to the shot the clip actually shows.
 */

/** True when the prompt reads as several shots (numbered shots, "cut to", scene headings). */
export function looksMultiShot(prompt: string): boolean {
  const text = prompt || ''
  const shotMarkers = new Set<string>()
  for (const m of text.matchAll(/\b(?:shot|scene)\s*(\d+|one|two|three|four|five)\b/gi)) {
    shotMarkers.add(m[1].toLowerCase())
  }
  if (shotMarkers.size >= 2) return true
  if (/\bcut(?:s|ting)? to\b/i.test(text)) return true
  // Numbered or "Shot N:" lines, one per shot.
  const lines = text.split('\n').filter(l => /^\s*(?:[-*]\s*)?(?:\*\*)?(?:shot|scene)\s*\d+/i.test(l) || /^\s*\d+[.)]\s+\S/.test(l))
  return lines.length >= 2
}

const fmt = (seconds: number) => `${Math.max(0, seconds).toFixed(1)}s`

export interface TrimPromptBriefInput {
  /** The clip's video file (the take the timeline shows). */
  videoPath: string
  /** The part of that file the clip uses, in seconds. */
  start: number
  end: number
  /** The prompt the clip was generated from. */
  prompt: string
}

export function buildTrimPromptBrief({ videoPath, start, end, prompt }: TrimPromptBriefInput): string {
  return [
    'Trim a RiX video prompt down to the shot(s) one clip actually shows. Use RiX\'s set_generation_prompt tool to hand the result back.',
    '',
    `The clip (look at it with inspect_media): ${videoPath}`,
    `It is a segment of a longer generation. Only the part from ${fmt(start)} to ${fmt(end)} of that file is used on the timeline.`,
    '',
    'The full prompt the file was generated from (it describes every shot):',
    prompt.trim(),
    '',
    `Rewrite it so it describes ONLY what happens between ${fmt(start)} and ${fmt(end)}: the shot(s) in that window, with their sound and dialogue.`,
    '- Keep the original wording, style and format for the shots you keep. Do not invent or embellish.',
    '- Drop everything about shots outside the window, and any reference-sheet instructions that no longer apply.',
    '- Match the shots to the footage by looking at it, not by guessing from their order.',
    '',
    'Call set_generation_prompt with the trimmed prompt, then tell me in one line what you kept. Do not generate anything.',
  ].join('\n')
}

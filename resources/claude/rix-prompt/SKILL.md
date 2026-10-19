---
name: rix-prompt
description: Write a multi-shot video prompt for RiX Film Studio Pro's Generate screen (LTX 2.5) from a reference image and the user's idea, then put it in the prompt box with the set_generation_prompt tool. Use when the user asks to "prompt with Claude" or to write/turn a scene idea into a RiX or LTX video prompt, especially with a first-frame image.
---

# RiX Prompt (Prompt with Claude)

You write the prompt; RiX's LTX 2.5 model renders it. The rix-editor MCP server gives you
`inspect_media` (to LOOK at the reference image) and `set_generation_prompt` (to put the finished
prompt in the Generate screen's prompt box). Don't call `rix_status`: there is no project or
timeline to check here.

## Steps
1. If the brief names a reference image, `inspect_media` it with `frames: 1` and a width of 768.
   Look before you write; the file name and the user's words are not the image.
2. Write ONE prompt following the recipe below.
3. Call `set_generation_prompt` with the prompt text only: no title, no quotes around it, no notes.
4. Reply in a few lines: the shot count, the duration to set (below), and anything in the image you
   had to guess or left out on purpose (an odd hand, unreadable text). Do not generate anything.

If the tool says the Generate screen isn't open, give the user the prompt in a code block instead.

## The recipe (this is what makes the cuts hold together)
**Shot 1 describes the image exactly as it is.** The image becomes the first frame, so the first
shot must match it: who or what is in frame, their face and age, hair, clothing, expression, where
they are looking, framing (close-up, medium, wide), light direction and colour, the room or
setting, and every prop that is visible and where it sits in the frame. Describe, don't interpret.
Never swap the subject for what the user's idea would prefer; if the idea conflicts with the image,
the image wins for shot 1 and the idea takes over from the first cut.

**Every later shot re-describes the subject and the place.** The model carries identity across cuts
from the words, not from the image. At each cut repeat the identifying details (age, hair,
clothing, the one or two props, the lighting and the setting) in the same words as shot 1. This is
the single biggest factor in consistency.

**Name each transition in plain language:** "A hard cut transitions to…", "The view cuts to…",
"A match cut connects…", "The image dissolves into…". Then restate the new framing: shot scale,
camera angle, who is in frame, and the light if it changed.

**Audio.** Say what is heard in shot 1 and carry it across every cut ("the low hum continues").
Dialogue: keep each line short, quote it, and describe the voice once ("in a thin, cracked
voice"), then reuse that description whenever the same person speaks. Give a different, clearly
contrasting voice to a second speaker.

**Shape.** 2 to 4 shots; default to 3 for "a scene", 2 for a short or simple idea. One flowing
paragraph in chronological order, roughly 120 to 250 words. No numbered lists, no headings, no
"Shot 1:" labels, no screenplay format, no negative prompts. Concrete and literal beats poetic:
say what the camera sees and the sound it hears.

**Respect the user's idea.** Use their story, mood and any dialogue they gave. Fill gaps with
restrained choices that fit the image's look. Don't add new characters unless asked: extra people
are what breaks consistency. A single character, or one character plus one prop, is safest.

## Duration and settings to tell the user
- 2 shots: 8 seconds or more. 3 shots: 10 seconds or more. 4 shots: 12 seconds or more.
- Leave Enhance off for these prompts: the enhancer rewrites for a single continuous shot and can
  merge the cuts.

## Worked example
Image: a close-up of an elderly woman with long straight grey-streaked light-brown hair and a black
knit garment, leaning over a glowing glass orb at the lower right, dim hazy room, one warm lamp
behind. Idea: she wakes the orb.

> A medium close-up of an elderly woman with deeply wrinkled pale skin, pale grey-blue eyes, and
> long straight light-brown hair streaked with grey, wearing a heavy black knit garment, leaning
> forward in a dim, hazy room to study a glowing glass orb held at the lower right of the frame, a
> single warm lamp glowing softly in the dark background, drifting dust in the air. Her eyes widen
> slightly as the orb's blue light flickers across her face, and she whispers in a thin, cracked
> voice, "There you are." A low, ominous hum underlies the scene. A hard cut transitions to an
> extreme close-up of the orb itself, same dim room and same warm lamp glow blurred behind it,
> swirling blue and amber specks moving inside the glass as her wrinkled hand hovers just beside
> it, the same low hum continuing. The view cuts to a wide shot from behind and above of the same
> elderly woman, same long grey-streaked light-brown hair and black knit garment, hunched over the
> glowing orb in the center of the dark room, the single warm lamp still visible at the far wall,
> the orb's blue light spilling across the floor as the hum swells and her thin, cracked voice
> murmurs, "Show me."

Note how shot 1 is the image, and the second and third shots repeat her hair, clothing, the lamp
and the hum.

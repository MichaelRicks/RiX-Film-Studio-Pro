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
   Also pass `image_path` (the reference image's absolute path) and `folder` (a suggested Prompt
   Manager folder: the character or project name from the idea).
4. Reply in a few lines: the shot count, the duration to set (below), and anything in the image you
   had to guess or left out on purpose (an odd hand, unreadable text). Do not generate anything.

If the tool says the Generate screen isn't open, give the user the prompt in a code block instead.

## Saving it
Nothing is saved automatically. The user saves prompts worth keeping with the **Save prompt** button
under RiX's prompt box (your suggested folder is prefilled there). So do NOT ask about saving, do not
mention a save dialog, and do not call `save_prompt` unless the user asks you to. If they ask for
changes, revise and call `set_generation_prompt` again.

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

**Name the subject in every shot. Pronouns give the model nothing to hold onto.** Give each
character one short fixed identity phrase from shot 1 ("the same woman in the same scarlet gown")
and use it, word for word, as the first mention in every later shot, before the other repeated
details. Never let "she", "he", "they", "her face" or "his hand" be what introduces a character in a
shot, including in close-ups of a face or hand. A pronoun is fine only later in the same sentence,
when one character is in view. With two characters, give each a clearly different phrase and use the
phrases instead of pronouns.
Weak: "...her face turns into the light."
Better: "...the face of the same woman in the same scarlet gown turns into the light."

**Carry the action through the cut.** When something is already happening (a walk, a pour, a slow
head turn), the next shot continues it in the new framing: say that the cut continues it, then
restate the action at the same pace and in the same direction. Don't just name the new framing.
Weak: "Hard cut to a close-up of her face."
Better: "Hard cut to a close-up from the side that continues the walk: the same woman in the same
scarlet gown walks on at the same slow pace."
Keep the carried action as small and simple as the anatomy rule below requires. If nothing is in
motion, carry the held pose, gaze or sound across instead of inventing movement.

**Every cut is a hard cut.** Write each one as an instant cut, in these words: "Hard cut to
[the new framing]..." or "The view cuts instantly to...". Never write dissolve, fade, blend, morph,
"transitions to" or "slowly becomes": the model renders those as soft cross-dissolves. Make every
cut an obvious jump so there is nothing to blend: change the shot scale AND the camera angle at
each cut (wide to close-up, front to side or from behind). Unless an action is being carried through
the cut, end the shot before it on a still, held moment. Use a dissolve only when the user asks for
one. Then restate the new framing: shot scale, camera angle, who is in frame, and the light if it
changed.

**Audio.** Say what is heard in shot 1 and carry it across every cut ("the low hum continues").
Dialogue: keep each line short, quote it, and describe the voice once ("in a thin, cracked
voice"), then reuse that description whenever the same person speaks. Give a different, clearly
contrasting voice to a second speaker.

**Pauses between lines.** Never put two quoted lines back to back. Between lines, write the
silence as something seen and heard, with a length: "She stops, and for a long moment there is only
the low hum. Then she says...", "He looks down; a beat of silence passes before he answers...". A
"beat" is about 1 second; "a long pause" or "a few seconds of silence" is about 2. For hesitation
inside one line, use an ellipsis or a dash: "I... I don't know." The cleanest separation is one
line per shot, with the cut itself as the pause. Each pause needs about 1 more second of
duration.

**Shape.** 2 to 4 shots; default to 2 (clips are 5 seconds by default). One flowing
paragraph in chronological order, roughly 120 to 250 words. No numbered lists, no headings, no
"Shot 1:" labels, no screenplay format, no negative prompts. Concrete and literal beats poetic:
say what the camera sees and the sound it hears.

**Anatomy and motion (prevents warped limbs and twisting).** The user has seen malformed, twisting
bodies and limbs, so build this into every prompt, in positive wording only (no negative prompts):
- Keep movement small and slow: one simple, deliberate action per shot ("slowly turns her head",
  "her hand rests still on the armrest"). No spins, flips, fast turns, big full-body motion, or
  several actions at once.
- State where the limbs are and let them stay put: "both hands resting on the armrests", "arms at her
  sides", "legs crossed and still". Name the pose once in shot 1 and reuse it at each cut.
- Add a short anatomy clause to each shot: "natural human proportions, two arms and two legs, fingers
  relaxed and naturally shaped, smooth natural movement". Hands are the weak spot: prefer hands
  resting, holding one prop, or out of frame over hands gesturing or crossing.
- Prefer framings that hide the hard parts (close-ups of the face, wide shots with the body still)
  over mid-action full-body shots. Avoid crossed or tangled limbs, bodies twisting away from the
  camera, and people overlapping each other.
- With armor, props or crowds, keep them still too: "the fallen warriors lie motionless".

**Respect the user's idea.** Use their story, mood and any dialogue they gave. Fill gaps with
restrained choices that fit the image's look. Don't add new characters unless asked: extra people
are what breaks consistency. A single character, or one character plus one prop, is safest.

## Character LoRA (when the brief names one)
A character LoRA draws one specific person. Claude can't see inside it, so the brief gives a trigger
word, a description and sometimes a photo. That character IS the main character: never invent a
different person, and add no other main character unless the user's idea asks for one.
- Write the trigger word as the character's name at their first mention in every shot, exactly as
  given ("storm01, a woman in her early thirties..."), never with @ or quotes around it.
- Describe the character with the brief's words (or what the photo shows), the same words in every
  shot. Nothing may contradict them: no new hair colour, eye colour, age or build.
- With no description, keep appearance words few and plain (age, build, clothing) and let the LoRA
  supply the face. Don't invent distinctive features.
- A first-frame image still wins for shot 1's framing, light and setting. If it shows a different
  person from the LoRA's character, say so in your reply.

## Duration and settings to tell the user
- Default to 5 seconds; 6 for dialogue with a pause. A brief that sets the length wins.
- Don't recommend more than 6 seconds: 8 and longer can fail on local hardware. At 5 or 6 seconds
  write at most 2 shots and one or two short lines. If the user asks for 3 or 4 shots, write them
  with tiny actions and say they may feel rushed.
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
> voice, "There you are." A low, ominous hum underlies the scene. Hard cut to an extreme close-up
> from the side that continues the study of the orb: the wrinkled hand of the same elderly woman in
> the same black knit garment rests still beside the glass, a lock of the same long grey-streaked
> light-brown hair at the edge of the frame, swirling blue and amber specks moving inside the orb,
> the same dim room and warm lamp glow blurred behind, the same low hum continuing. The view cuts
> instantly to a wide shot from behind and above that continues the same still lean over the orb:
> the same elderly woman in the same black knit garment, with the same long grey-streaked
> light-brown hair, bends toward the glowing orb in the center of the dark room, the single warm
> lamp still visible at the far wall, the orb's blue light spilling across the floor as the hum
> swells and the same thin, cracked voice murmurs, "Show me."

Note how shot 1 is the image, and the second and third shots name the same elderly woman in the same
black knit garment before anything else about her, then repeat the hair, the lamp and the hum. Each
cut carries on what was already happening (studying the orb, leaning over it), jumps scale and angle
(medium close-up, extreme close-up from the side, wide from behind and above), and each line of
dialogue sits in its own shot.

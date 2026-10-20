---
name: rix-prompt-sheet
description: Write a video prompt for RiX Film Studio Pro's Generate screen (LTX 2.5) when the reference image is a reference sheet (character turnaround, prop sheet, location sheet, or a combined sheet with several panels), then put it in the prompt box with the set_generation_prompt tool. Supports single-shot and multi-shot output. Use when the user says "character reference sheet", "reference sheet", "ingredients", or the image shows several labelled panels of a character, props or a setting.
---

# RiX Prompt: Reference Sheet

For sheets with several panels (character views, props, a location). The sheet is an ingredient:
the video is a NEW scene that borrows the character, props and place from the sheet. It does not
start on the sheet and must never show the panel layout. For a single plain image used as the
first frame, use `rix-prompt` instead.

Tools: `inspect_media` (look at the sheet) and `set_generation_prompt` (fill the prompt box).
Don't call `rix_status`: there is no project or timeline to check here.

## Inputs
- Sheet image path, the user's idea (may be empty), mode: **single** (default) or **multi** with a
  shot count (2 to 4, default 3), and whether to include dialogue.

## Steps
1. `inspect_media` the sheet with `frames: 1` and a width of 1280 or more, so small panels and
   printed notes are legible. Look before you write.
2. Map the panels: for each one, note its position (Top Row Left, Middle Row Right, Bottom Row,
   Left Column...) and whether it is a Character, Prop, or Setting. Read any printed notes (wardrobe,
   age, personality) and use them as extra detail.
3. Write the prompt in the two-part format below.
4. Call `set_generation_prompt` with the prompt text only.
5. Reply in a few lines: panels found, shot count, the duration to set, and anything you guessed
   or left out (unreadable text, odd hands, a panel that was unclear). Do not generate anything.

If the tool says the Generate screen isn't open, give the prompt in a code block instead.

## Format (always both parts, in this order, plain text)

**Part 1: `### Reference Sheet Description`**
One entry per panel group, each starting with its position and role in bold, for example
`**Top Row Left (Character):**`, `**Top Row Right (Prop):**`, `**Bottom Row (Setting):**`.
Describe what is actually there, concretely: for a character, age, hair, skin, build, face, each
garment with colour and material, shoes, accessories, and the views shown (front, side, back); for
a prop, shape, colour, material, parts, views; for a setting, layout, furniture, materials, plants,
colours, and every light source with its colour and position. No story here, only description.

**Part 2: `### Target Description`**
The scene. Reuse the exact wording from Part 1 for every identifying detail (hair, each garment,
prop, set pieces, light sources), so each can be traced to a panel. Include the camera, the
action, the expression changes, the light on the subject and the sound. Use only elements that
exist on the sheet unless the user's idea requires more. Never add new characters. Never mention
panels, rows or the sheet inside Part 2.

### Keep the sheet out of the video (applies to both modes)
The video model may be conditioned on the sheet image and will copy its layout unless the text
pulls it away. So Part 2 must read as a brand-new live-action scene, not as an animation of the
sheet:
- Open Part 2 with a positive full-frame statement that names the place and the framing, for
  example "A single full-frame, live-action cinematic scene inside a dimly lit bedroom at night,
  filmed as one unbroken view." Never open with the character alone against a blank background.
- Put the character already inside the setting from the first words, doing something. No posing,
  no turning to show outfit angles, no standing in a line, no neutral studio look.
- Give a physical action in the first beat (sitting down, reaching, walking in, picking up the
  prop), so the picture changes right away.
- Use the setting panel's light and background as the whole frame, edge to edge. Part 2 describes
  one camera view at a time and one scene only; never split-screen, collage, grid or inset views.
- Part 1 starts with one plain line before the panel entries: "The sheet below is layout only.
  Its labels, borders and repeated views are not part of the scene." Then the panel entries.

### Single-shot mode
Part 2 is one continuous shot, one paragraph, about 150 to 250 words. State the camera once
("The camera holds a steady, static medium shot", or a slow push-in or pan) and keep it. Give the
action as a sequence of beats with a clear emotional turn. Dialogue: short quoted lines with the
voice described once. Describe the ambient sound. Finish with the background and light so the
location stays anchored.

### Multi-shot mode (2 to 4 shots)
Part 2 is one flowing paragraph. Every shot re-describes the character, the key prop and the
place using the same words as Part 1, and cuts are named in plain language ("A hard cut
transitions to...", "The view cuts to...", "A match cut connects..."), each followed by the new
framing (scale, angle, who is in frame, light if it changed). Carry the sound across cuts. Reuse
the same voice description whenever the same person speaks. No "Shot 1:" labels or numbered lists.
Because shot 1 is not tied to a first frame, open on the most informative angle for the
character and place (a medium shot that shows both), then vary scale at each cut.

## Dialogue
Keep lines short and in quotes. Describe the voice once, then reuse the description. Give a
second speaker (only if the sheet has one) a contrasting voice. Off-screen speakers are fine:
write them as heard, not seen.

## Style rules
- Concrete and literal: what the camera sees and what is heard. No poetic filler, no negative
  prompts, no headings other than the two above, no markdown beyond the bold panel labels.
- Do not invent dimensions, brand names or text that is not on the sheet.
- Keep one consistent lighting story that matches the setting panel.
- Don't add new characters unless asked.

## Duration and settings to tell the user
- Single shot: 8 seconds or more (10 if there is dialogue).
- Multi-shot: 2 shots 8s+, 3 shots 10s+, 4 shots 12s+.
- Leave Enhance off: the prompt is already detailed and the enhancer may rewrite or merge it.
- Attach the sheet as the reference/ingredient image. If RiX only offers "first frame", warn the
  user that the video may open on the sheet for a moment; the prompt is written to move off it on
  the first beat, and the fallback is to crop the best character view and use that as the first
  frame.

## Worked example (single shot)
Sheet: young woman character views, a black game controller, an olive graphic t-shirt, a dim
wood-and-plants bedroom with a glowing circular wall light.

> ### Reference Sheet Description
> The sheet below is layout only. Its labels, borders and repeated views are not part of the scene.
> **Top Row Left (Character):** A young woman with long, slightly wavy brown hair parted down the
> middle, warm complexion, wearing a dark olive ribbed tank top and dark, baggy cargo pants with
> large side pockets, shown from front, side and back. **Top Row Right (Prop):** A sleek, modern
> black video game controller with two joysticks, a D-pad and action buttons, shown from several
> angles. **Middle Row Right (Prop):** A dark olive short-sleeved t-shirt with a retro print of an
> orange sun setting behind dark pine silhouettes. **Bottom Row (Setting):** A dimly lit bedroom at
> night with wood-paneled accents, a neatly made low bed with green bedding, string lights, a
> gaming desk with dual monitors, and a circular wall light with a warm yellow-orange ring above
> the bed.
> ### Target Description
> A single full-frame, live-action cinematic scene inside a dimly lit bedroom at night with
> wood-paneled accents, filmed as one unbroken view. The camera holds a steady, static medium shot. A young woman with long, slightly wavy brown hair
> parted down the middle and a warm complexion sits on the edge of her neatly made low bed with
> green bedding, gripping the sleek, modern black video game controller in both hands, thumbs
> moving on the joysticks. She wears the dark olive short-sleeved t-shirt with the retro orange
> sun and pine print, with dark, baggy cargo pants. The circular wall light casts a warm
> yellow-orange glow across her face. Her expression is intense focus, then a triumphant smile as
> she laughs and says to someone off-screen, in a smug, playful voice, "Not today!" The dual
> monitors on the desk behind her stay softly blurred.

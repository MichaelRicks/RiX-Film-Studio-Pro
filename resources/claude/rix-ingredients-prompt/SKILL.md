---
name: rix-ingredients-prompt
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
   Left Column...) and whether it is a Character, Outfit, Prop, or Setting. Read any printed notes
   (wardrobe, age, personality) and use them as extra detail. Count every panel, small ones at the
   edges and in the bottom row included, and give EACH its own entry in Part 1; skipping one means
   the video never sees it. A small tile that shows a garment (a clothing sheet, a flat-lay, a
   figure in a different outfit) is an **Outfit** panel and normally wins over the clothing worn in
   the big character photo. If the outfit tile is too small to read, inspect the sheet again at
   width 1920 and describe what you can see: colour, material, cut, trim, pattern.
3. Write the prompt in the two-part format below.
4. Call `set_generation_prompt` with the prompt text only, plus `image_path` (the sheet's absolute
   path), `thumbnail_only: true` (the sheet is never a first frame) and `folder` (a suggestion: the
   character or project name, or "Reference Sheets").
5. Reply in a few lines: panels found, shot count, the duration to set, and anything you guessed
   or left out (unreadable text, odd hands, a panel that was unclear). Do not generate anything.

If the tool says the Generate screen isn't open, give the prompt in a code block instead.

## Saving it
RiX opens its own "Save this prompt?" dialog as soon as `set_generation_prompt` lands, with your suggested
folder preselected and the sheet as the thumbnail. So do NOT ask about saving in chat and do not call
`save_prompt` unless the user asks you to. If they ask for changes, revise and call
`set_generation_prompt` again. End your reply by saying the save dialog is waiting in RiX.

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

## Ingredients IC-LoRA (the sheet is attached as a reference, not a first frame)
When the brief says the sheet is the Ingredients IC-LoRA reference, the sheet is used for
appearance only. The video must be a different picture from it:
- Treat every panel as a source of identity, never as a layout. The sheet may mix character,
  outfit, location and prop panels; pull from each only what the scene needs, and use only the
  panels the idea calls for (a location panel can be ignored if the idea sets the scene elsewhere).
- Describe what each panel shows (Part 1) so the model can match it, then put it to work in Part 2
  with the same words. Use the single plain opening line from the Format section for Part 1 and do
  not add more talk about layout, borders or panels: naming them can prime the video to show them.
- Open Part 2 with the full-frame statement, the place, the framing and a first-beat action, as in
  the rules above. Never start on a pose that matches a sheet panel (no front/side/back turnaround
  stance, no neutral standing).
- Keep the camera, scene and action entirely from the user's idea. The sheet supplies who and what,
  not where the camera is or what happens.
- Keep the wording of each identifying detail identical between Part 1 and Part 2 and across every
  shot, because the LoRA binds the text to the sheet's appearance.
- **Outfit changes (the sheet shows the character in one outfit and an outfit panel shows another).**
  The model copies whatever clothing sits next to the face, so the prompt must say which wins.
  In Part 1, describe the character panel by face, hair and build only, and say plainly that the
  clothing, veil, scarf or other headwear in that panel is not used in the scene ("her clothing in
  this panel is not worn"). Describe the outfit panel as the garment she wears, by colour,
  material and trim. In Part 2 state it at the first mention and again in every shot ("wearing the
  navy brocade qipao, bare-headed, no veil"), and name any headwear or accessory from the character
  photo that must NOT appear. Say it positively: she wears X.
  If the outfit tile shows a person (a model or figure wearing the garment), her face, hair, skin
  and body are NOT used: say so in Part 1 ("the figure's face and hair in this panel are not used,
  only the garment"), because the model otherwise swaps the face. The face always comes from the
  Character panel.
- If the sheet carries several outfits or locations, name the one in use ("the black leather vest
  and denim outfit") so it is not blended with the others.

### What the official Ingredients example does (copy these habits)
The LTX model card's own sample sheet has a character in front, side and back views, a controller
shown from three angles, a t-shirt, and a wide bedroom. Its prompt shows:
- Panel entries are named by where they really are on the sheet, in a grid vocabulary: Top Row
  Left, Top Row Right, Middle Row Right, Bottom Row, each with a role in brackets: (Character),
  (Prop), (Setting). Name each panel by its actual position, one entry per panel or panel group.
- A prop panel can become clothing in the scene. The t-shirt sits on the sheet as a Prop, and in the
  target the woman wears it. Say so plainly ("She wears the dark olive short-sleeved t-shirt...").
- The sheet's views (front, side, back) are described in Part 1 as views, then Part 2 uses the
  person once, in one action, never as a turnaround.
- Part 2 opens on the place, then the camera ("The camera holds a steady, static medium shot"),
  then the character already doing something, then the light on her face, then expression beats
  with short pauses ("She pauses for a split second..."), dialogue in quotes, and ends by naming
  the softly blurred background. One flowing paragraph, no lists.
- Part 1 stays pure description of the sheet; every detail is worded again, identically, in Part 2.

## Anatomy and motion (prevents warped limbs and twisting)
The user has seen malformed, twisting bodies and limbs. Use positive wording only:
- Keep movement small and slow: one simple, deliberate action per shot. No spins, flips, fast turns,
  big full-body motion, or several actions at once.
- State where the limbs are and let them stay put ("both hands resting on the armrests", "arms at
  her sides"); name the pose once and reuse it at each cut.
- Add a short clause to each shot: "natural human proportions, two arms and two legs, fingers
  relaxed and naturally shaped, smooth natural movement". Prefer hands resting, holding one prop, or
  out of frame over gesturing or crossing.
- Prefer close-ups of the face and still wide shots over mid-action full-body shots. Avoid crossed
  or tangled limbs, bodies twisting away from the camera, and overlapping people.
- Keep armor, props and any crowd still ("the fallen warriors lie motionless").

## Length limit (hard)
The LTX API rejects any prompt over 5000 characters, and RiX falls back to it whenever the local text
encoder isn't downloaded. RiX's `set_generation_prompt` also refuses anything over 5000 characters and
tells you so; if that happens, shorten and call it again. Aim for 4000 to 4500 in total (Part 1 plus
Part 2, spaces included). You cannot run a counter, so write to these budgets, which already add up:
- **Part 1** (Reference Sheet Description): about 1200 characters, roughly 180 words. One to three
  short sentences per panel. Keep identifying detail (hair, each garment with colour and material,
  prop shape, light sources); drop everything else and any panel the scene doesn't use.
- **Part 2, single shot:** about 1400 to 1600 characters (150 to 250 words, the range above).
- **Part 2, multi-shot:** about 2800 characters in all: 2 shots up to 1400 each, 3 shots about 950
  each, 4 shots about 700 each. Re-describe the character in each shot in one short clause using
  the Part 1 words, not a full paragraph.
- Dialogue and the look lock count too. If a look lock or dialogue pushes it over, shorten the shot
  descriptions, not the lock words.
- Before calling the tool, estimate: about 6 characters per word including the space. Over 700
  words is too long. Say the rough length in your reply.

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

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
- Sheet image path, the user's idea (may be empty), mode: **single** (default) or **multi** (only
  when the user or the brief asks for 2 or more shots), and whether to include dialogue.

## Steps
1. `inspect_media` the sheet with `frames: 1` and a width of 1280 or more, so small panels and
   printed notes are legible. Look before you write.
2. Map the panels: for each one, note its position (Top Row Left, Middle Row Right, Bottom Row,
   Left Column...) and whether it is a Character, Outfit, Prop, or Setting. Read any printed notes
   (wardrobe, age, personality) and use them as extra detail. Count every panel, small ones at the
   edges and in the bottom row included, and give EACH its own entry under `Reference sheet:`;
   skipping one means the video never sees it. A small tile that shows a garment (a clothing sheet, a flat-lay, a
   figure in a different outfit) is an **Outfit** panel and normally wins over the clothing worn in
   the big character photo. If the outfit tile is too small to read, inspect the sheet again at
   width 1920 and describe what you can see: colour, material, cut, trim, pattern.
3. Do the panel check below, then write the prompt in the two-part format.
4. Call `set_generation_prompt` with the prompt text only, plus `image_path` (the sheet's absolute
   path), `thumbnail_only: true` (the sheet is never a first frame) and `folder` (a suggestion: the
   character or project name, or "Reference Sheets").
5. Reply in a few lines: panels found, shot count, the duration to set, **any panel the idea needs
   that the sheet lacks** (say what to add), and anything you guessed or left out (unreadable text,
   odd hands, a panel that was unclear). Do not generate anything.

If the tool says the Generate screen isn't open, give the prompt in a code block instead.

## Saving it
Nothing is saved automatically. The user saves prompts worth keeping with the **Save prompt** button
under RiX's prompt box (your suggested folder is prefilled there). So do NOT ask about saving, do not
mention a save dialog, and do not call `save_prompt` unless the user asks you to. If they ask for
changes, revise and call `set_generation_prompt` again.

## The five model-card rules (these win over everything else here)
1. **Two labelled parts, no trigger word:** `Reference sheet: {panels}.` then
   `Generated video: {action}.`
2. **Only what is on the sheet gets seen.** The model won't invent an identity. Every character,
   creature, hand-held prop, vehicle and location that appears on screen needs its own panel.
3. **The model was trained on 121 frames at 24 fps, about 5 seconds**, on a wide 768x448 frame.
   Write what fits in that.
4. LoRA strength is about 1.4 (RiX's default for Ingredients).
5. The card's negative prompt (worst quality, inconsistent motion, blurry, jittery, distorted) is a
   separate input, not prompt text. RiX's Ingredients mode has no box for it. **Never write those
   words, or any "no ..." list, into the prompt:** naming a fault can produce it.

## Panel check (before writing; this is where generations fail)
List every person, creature, prop, vehicle and place the idea would put on screen, and match each
to a panel. For anything with no panel:
- **A second person** (bartender, enemy, crowd): keep them off-screen. They may be heard, or looked
  at ("she aims at someone beyond the right edge of the frame"), but they are never seen: no
  shoulder in the foreground, no distant figure, no hit or falling body.
- **A prop** (beer mug, gun, phone): cut it and the action that needs it, or use a prop that has a
  panel.
- **A location** (a church, a saloon, when the setting panel shows a garage): set the scene in the
  sheet's setting instead. Never describe a place that has no panel.
- If the idea cannot work without the missing thing, still write the closest version that uses only
  the sheet, and open your reply by saying what is missing and that the sheet needs a panel for it.
Incidental surfaces that belong to the setting panel (its walls, floor, sky, furniture) are fine.
A sheet with no setting panel has no location to render: say so in your reply and keep the
background plain and softly blurred.

## Format (exactly two parts, plain text)
Two paragraphs separated by one blank line, each starting with its label. No headings, bold,
bullets, markdown, caps trigger word or preamble. Nothing before `Reference sheet:` and nothing
after the action.

**`Reference sheet:`** what each panel shows, one clause or short sentence per panel, separated by
semicolons. Characters first, then outfits and props, then the setting. Name the role in plain
words ("the same woman's face in close-up", "a heavy black pistol shown from the side"). For a
character: age, hair, skin, build, face, each garment with colour and material, shoes, accessories
and the views shown. For a prop: shape, colour, material. For a setting: layout, materials, colours
and light. Only what is visibly there; no story. Do not mention grids, positions, borders, labels
or layout.

**`Generated video:`** one flowing paragraph. Open with the visual style (match the sheet:
live-action stays live-action, 3D stays 3D), full-frame, then the place and framing, then the
character already inside that place doing something: "Generated video: a full-frame live-action
cinematic scene on the quiet street outside the red brick garage, ...". Then the camera, the
action, the light, and the sound. Reuse the exact wording from `Reference sheet:` for every
identifying detail (hair, each garment, prop, set pieces, light), so each traces to a panel. Never
mention the sheet or panels here.

### Sign text (copy it exactly)
Without the words, the model makes up gibberish for a sign. For every large, readable sign,
lettering or print that belongs to the thing in a panel (a storefront sign, a name on a vehicle,
wording on a shirt or prop):
- Quote the exact words in double quotes, with their spelling and punctuation, in **both** parts:
  `a pale storefront sign reading "JOE'S GARAGE" in faded blue lettering`. Repeat the quote in every
  shot where the sign is in view.
- Read it from the image. If you can't make it out, inspect again at width 1920. If it is still
  unreadable, leave the words out, never guess, and say so in your reply.
- Quote only the main lettering; skip tiny engravings and small posters.
- The sheet's own panel labels, captions and printed notes ("CHARACTER", "PROP", "LOCATION") are
  not sign text: never put them in the prompt.

### Keep the sheet out of the video (applies to both modes)
- Put the character in the setting from the first words. No posing, turning to show the outfit,
  standing in a line or neutral studio look.
- Give a small physical action in the first moment, so the picture changes right away.
- The setting's light and background fill the whole frame, edge to edge. One camera view at a time;
  never split-screen, collage, grid or inset views.

### Single-shot mode (the default)
One continuous shot, about 80 to 150 words. State the camera once ("The camera holds a steady,
static medium shot", or one slow push-in) and keep it. One main action with at most one change of
expression, small enough to finish in 5 seconds. At most one short spoken line (about 8 words or
fewer). Describe the ambient sound. End on a still, held moment.

### Multi-shot mode (only when asked for)
Cuts are a risk with this LoRA: it learned 5-second clips. Use **2 shots** at 6 seconds, with very
small actions. Write 3 or 4 only when the brief insists, and warn in your reply that shots may be
dropped or smeared. `Generated video:` stays one paragraph. Each shot
repeats the character, key prop and place in one short clause using the same words. Every cut is a
hard cut, written "Hard cut to..." followed by the new framing (scale, angle, who is in frame).
Never write dissolve, fade, blend, morph or "transitions to". Change both shot scale and camera
angle at each cut. No "Shot 1:" labels. Open on a medium shot that shows both character and place.

- **Name the character in every shot; pronouns give the model nothing to hold onto.** Make one
  short identity phrase from wording already under `Reference sheet:` ("the same woman in the same
  scarlet gown") and use it, word for word, as the first mention in every later shot, close-ups of a
  face or hand included. Never let "she", "he", "they", "her face" or "his hand" introduce the
  character. Weak: "her face turns into the light." Better: "the face of the same woman in the same
  scarlet gown turns into the light."
- **Carry the action through the cut.** When something is already happening, say that the cut
  continues it and restate the action at the same pace and in the same direction. Weak: "Hard cut to
  a close-up of her face." Better: "Hard cut to a close-up from the side that continues the walk:
  the same woman in the same scarlet gown walks on at the same slow pace." Keep it as small as the
  anatomy rules allow. If nothing is in motion, carry the held pose, gaze or sound across.
- Unless an action is being carried through a cut, end the shot on a still, held moment. The last
  shot always ends on one.

## Dialogue
Keep lines short and in quotes. Describe the voice once, then reuse the description. An off-screen
speaker is heard, never seen. In a 5-second clip use one line at most. Never put two quoted lines
back to back: between lines, write the silence as something seen and heard ("a beat of silence
passes" is about 1 second, "a long pause" about 2). Each pause needs about 1 more second of
duration.

## Ingredients IC-LoRA (the sheet is attached as a reference, not a first frame)
When the brief says the sheet is the Ingredients IC-LoRA reference, the sheet is used for
appearance only. The video must be a different picture from it:
- Treat every panel as a source of identity, never as a layout. Use only the panels the idea calls
  for, but describe every panel under `Reference sheet:`.
- The user's idea decides the camera and the action. The sheet decides who, what and where: the
  panel check above limits what the idea can show.
- Never start on a pose that matches a sheet panel (turnaround stance, neutral standing).
- Keep each identifying detail worded identically in both parts and across every shot.
- **Outfit changes (the sheet shows the character in one outfit and an outfit panel shows another).**
  The model copies whatever clothing sits next to the face, so the prompt must say which wins. Under
  `Reference sheet:` describe the character panel by face, hair and build, and the outfit panel as
  the garment worn in the scene, by colour, material and trim. In `Generated video:` say positively
  that the character wears it, at the first mention and in every shot, with the head as it should
  look ("bare-headed, long black hair loose"). If the outfit panel shows a figure or model, say only
  the garment is taken from it, and that the face is the one from the character panel.
- If the sheet carries several outfits or locations, name the one in use so it is not blended with
  the others.
- A prop panel can become clothing: "She wears the dark olive short-sleeved t-shirt...".

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
- **Fights and gunplay smear this model badly.** "A gunfight" becomes one held pose: she stands or
  kneels braced, aims, fires once, holds. No running, diving, rolling, ducking, explosions, flying
  debris, shattering glass or a moving camera. Return fire is heard, not shown. Tell the user you
  toned the action down and why.

## Length limit (hard)
The LTX API rejects any prompt over 5000 characters, and RiX falls back to it whenever the local text
encoder isn't downloaded. RiX's `set_generation_prompt` also refuses anything over 5000 characters.
Longer is not better here. Aim for:
- `Reference sheet:` 400 to 900 characters.
- `Generated video:` 500 to 900 characters for a single shot, up to 1800 for 2 shots.
- Whole prompt under 2800 characters (under 4000 if the user insisted on 3 or 4 shots).
A look lock and dialogue count too; shorten the shot descriptions to make room, and keep any look
lock to one short sentence. Say the rough length in your reply.

## Style rules
- Concrete and literal: what the camera sees and what is heard. No poetic filler.
- Positive wording only: describe what is there.
- Do not invent dimensions, brand names or text that is not on the sheet.
- Keep one consistent lighting story that matches the setting panel.
- Never add a character, prop or place that has no panel, even if the idea asks for it.

## Character LoRA (when the brief names one)
(The "no trigger word" rule above is about the Ingredients LoRA; a character LoRA's own trigger
word is still used.)
A character LoRA draws one specific person. Claude can't see inside it, so the brief gives a trigger
word, a description and sometimes a photo. That character IS the main character: never invent a
different person, and add no other on-screen character without a panel.
- Write the trigger word as the character's name at their first mention in every shot, exactly as
  given ("storm01, a woman in her early thirties..."), never with @ or quotes around it.
- Describe the character with the brief's words (or what the photo shows), the same words in every
  shot. Nothing may contradict them: no new hair colour, eye colour, age or build.
- With no description, keep appearance words few and plain (age, build, clothing) and let the LoRA
  supply the face. Don't invent distinctive features.
- A first-frame image still wins for shot 1's framing, light and setting. If it shows a different
  person from the LoRA's character, say so in your reply.

## Duration and settings to tell the user
- Single shot: 5 seconds (the trained length and RiX's default). 6 if a spoken line needs room.
- 2 shots: 6 seconds.
- Don't recommend more than 6 seconds: 8 and longer can fail on local hardware. Use a longer length
  only when the brief sets it, and say it may fail. A brief that sets the length wins.
- LoRA strength 1.4. Use a wide sheet: RiX takes the video's shape from the sheet image, so a tall
  sheet makes a tall video. Say so if the sheet is not landscape.
- Bigger, cleaner panels hold identity better. If the face panel is small or a needed panel is
  missing, say so.
- Leave Enhance off: the enhancer may rewrite or merge the two parts.

## Worked example (single shot, 5 seconds)
Sheet: a young woman in several views, a black game controller, an olive graphic t-shirt, a dim
wood-and-plants bedroom with a glowing circular wall light. Idea: "she wins a game against her
brother". There is no panel for the brother, so he stays off-screen and unseen.

> Reference sheet: a young woman with long, slightly wavy brown hair parted down the middle and a
> warm complexion, in dark, baggy cargo pants with large side pockets, shown from front, side and
> back; a sleek black video game controller with two joysticks, shown from several angles; a dark
> olive short-sleeved t-shirt with a retro print of an orange sun behind dark pine silhouettes; a
> dimly lit bedroom at night with wood-paneled walls, a low bed with green bedding, a desk with two
> monitors and a circular wall light with a warm yellow-orange ring.
>
> Generated video: a full-frame live-action cinematic scene in the dimly lit bedroom at night with
> wood-paneled walls. The camera holds a steady, static medium shot. The young woman with long,
> slightly wavy brown hair, wearing the dark olive short-sleeved t-shirt with the retro orange sun
> print and dark, baggy cargo pants, sits on the low bed with green bedding, both hands holding the
> sleek black video game controller, thumbs moving on the joysticks. The circular wall light casts a
> warm yellow-orange glow across her face. Her focused expression breaks into a triumphant smile and
> she says toward someone beyond the frame, in a smug, playful voice, "Not today!" Natural human
> proportions, two arms and two legs, fingers naturally shaped, smooth natural movement. Soft game
> sounds and a quiet room tone. She holds the smile, still.

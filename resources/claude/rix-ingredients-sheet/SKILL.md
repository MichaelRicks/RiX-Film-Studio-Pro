---
name: rix-ingredients-sheet
description: Write the still-image prompts that make a reference sheet for RiX Film Studio Pro's Ingredients IC-LoRA (LTX 2.5): one sheet that can hold a character, outfits, a location and props as separate panels. Picks a panel layout, writes the sheet prompt for the image model (Grok Imagine, Midjourney, etc.), and says how to test it and hand it to rix-ingredients-prompt. Use when the user says make a character sheet, reference sheet, ingredients sheet, outfit sheet, location sheet, prop sheet, or turnaround.
---

# RiX Sheet Maker: reference sheets for Ingredients

The Ingredients IC-LoRA takes ONE image plus a text prompt and keeps the people, clothes, places and
props from that image consistent in a NEW video. This skill writes the prompt that makes that image.
The video prompt is written afterwards by `rix-ingredients-prompt`, which reads the finished sheet panel by
panel. So the sheet has to be easy to read: few panels, each one clear, each one a single job.

Tools: `inspect_media` to look at images that already exist (frames: 1, width 1280 or more) and
`set_generation_prompt`. Nothing here generates; the user runs the prompt in an image tool and brings
the result back.

**From RiX's "Prompt with Claude" in Image mode** the brief already carries the answers to the
questions below (contents, descriptions, style, aspect ratio). Do not ask again. Pick the layout,
write the prompt, and call `set_generation_prompt` with the prompt text only: no `image_path` (there
is no image yet) and `folder` "Reference Sheets". RiX then offers to save it. If the tool says the
Generate screen isn't open, give the prompt in a code block instead. Reply in a few lines: layout,
what you invented, how many versions to generate.

## Start by asking (one short message, skip what they already said)
1. **What goes on the sheet?** Any mix of: character (one or two), outfit(s), location, props. The
   lists below set the layout from this.
2. **Who or what is it?** Name, age and build, one design signature, or an existing image to match.
   If they have a face or a character already, ask for the image and look at it with `inspect_media`.
3. **Style:** photoreal (default), or illustrated / stylised. Match what the video should look like.
4. **Era, mood and the main light in the location**, if there is a location panel.

If the user gives a one-line idea ("a gunslinger woman in a saloon"), don't interrogate: invent the
missing details with restrained, specific choices, say what you chose, and let them change it.

## Character from a reference image
When the user supplies a picture of the character (a photo, a render, a Grok image), the sheet must
be that person, not a lookalike:
1. `inspect_media` it with `frames: 1` and a width of 1280 or more. Look at the face most closely.
2. Write down what is really there: apparent age, face shape, eyes (colour, shape), brows, nose, lips,
   skin tone and texture, scars, freckles or marks, hair (colour, length, texture, parting, style),
   build, and every garment with colour, material and fit, plus shoes and accessories. Use the
   image's own wording for colours. Never swap in a "better" feature, and never add a mark that
   isn't visible. Say plainly in your reply what you could not see (the back of the head, the
   shoes, the side profile) and what you assumed.
3. Outfit: keep the image's outfit unless the brief says to use a different one. If the image is a
   close-up with no outfit visible, invent one that fits and say so.
4. Open the sheet prompt with the canvas line and then the likeness line, in this order:
   "Create a new landscape 16:9 image, 1920 by 1080, a tiled grid of separate hard-edged panels.
   The attached picture is a likeness reference only: its size, framing and background are not
   reused." then "Use the attached reference image as the exact likeness of this person: identical
   face, hair, skin and age in every panel." Then the layout and the facts from step 2. The prompt
   must still stand on its own, because some image tools ignore the attachment.
5. Other panels (props, location) come from the user's text as usual.
6. Tell the user to attach the same image in their image tool as a reference (in RiX's Image mode,
   load it as the input image; raise the image strength if the face drifts, lower it if the
   sheet layout won't form), and to check the face against the original before approving: the
   face close-up panel is where likeness is won or lost.
7. If they bring the first result back, `inspect_media` both images and name the differences (eye
   shape, hair line, age) so the prompt can be corrected, rather than rerolling blindly.

## Converting an existing sheet or several images into an Ingredients sheet
The user may bring a finished character sheet (any layout, maybe turnaround only) or a few separate
images: a character, an outfit, a location, a prop. The brief names each image and its role.
1. `inspect_media` EVERY image, `frames: 1`, width 1280 or more, one call per image.
2. Per image, write down exactly what is there (see the likeness steps below for people; for a
   place: layout, materials, furniture, plants, every light source with colour and position; for a
   prop: shape, material, colour, wear, parts; for a garment: cut, colour, material, print).
   Use the image's own colours. Never "improve" or add anything.
3. An existing sheet that is already usable may only need panels added. Say so, name the panels it
   has and the ones missing, and write the prompt for the new sheet with ALL panels (the image
   tool makes one picture), pointing at the old sheet as the likeness source.
4. Choose the layout from the roles supplied (usually F for four or more items, C for three, A/B
   for a character with one extra) and write the sheet prompt. Open it with the likeness line
   when a character image exists. Ignore any text, labels or borders in the old sheet; do not copy
   them.
5. Outfit image supplied: the character WEARS that outfit in every full-body view and its collar
   shows in the face close-up; the outfit also gets its own panel with the whole garment visible,
   front and back, not cropped. What the character wore in their own photo is dropped (hair, face
   and accessories stay). A prop or location image gets its own panel the same way.
6. Tell the user which images to attach in their image tool (all of them, each as a reference), and
   which panel each one feeds. If the tool only takes one image, say which to attach (the
   character) and that the rest are carried by the written description.

## Layouts (choose by content; fewer panels is better)
The panel names match what `rix-ingredients-prompt` reports back, so use these exact positions (Top Row Left, Top Row Right, Middle Row, Bottom Row Left, Bottom Row Right).

**A. Character only** (the quickest, most reliable)
Left column: full body front, standing, relaxed, arms at the sides. Right: one large face close-up.
Optional: a small side or back view under it.

**B. Character + outfit detail**
Top Row Left: full body front. Top Row Right: face close-up. Bottom Row: three-quarter and back
views, plus up to three small inserts of costume items (boots, belt, jacket collar).

**C. Character + prop + location** (the full sheet)
- Top Row Left (Character): full body front and a face close-up beside it.
- Top Row Right (Prop): the key prop, isolated, one or two angles.
- Bottom Row (Setting): the location as one wide, full-bleed panel, no people in it.

**D. Two characters**
Each gets a column: full body and face. Add a shared setting row only if there is room. More than two
characters: make separate sheets and say so.

**E. Several outfits**
One character, one panel per outfit, full body, identical face. Label each outfit in the video
prompt later by what it is ("the black leather vest and denim outfit"), not by panel number. Four
outfits is the limit for a readable sheet.

**F. Full production sheet** (the layout of the official LTX Ingredients samples; 16:9 only)
A tiled grid with the character on top, items in the middle and the place at the bottom:
- Top Row Left (Character): a large face and shoulders close-up (or two close-ups at slightly
  different angles).
- Top Row Right (Character): the turnaround, one wide panel holding four full-body views side by
  side (front, three-quarter, side, back), identical costume and proportions.
- Middle Row (Props / Outfit): two to three small panels, each ONE item alone: a garment shown
  front and back, a drink can or bottle shown from three angles, and so on.
- Bottom Row Left (Prop): the hero prop, one large panel, one clear angle.
- Bottom Row Right (Setting): the location as one wide full-bleed plate, no people.
Every panel sits on a plain light-grey backdrop except the setting. Gaps between panels are thin,
plain and dark. Write one sentence per panel, each with the colour-and-material detail from the
panel rules. Use F when the user wants character, outfit, props AND a location on one sheet; use
C when there is only one prop.

Hard limits: no more than 6 panels for layouts A to E, and no more than 7 for F (the four-view
turnaround counts as one panel, and so does a front-and-back garment pair). Small panels lose
detail, and the LoRA can only copy what is legible. Landscape 16:9 for full sheets; a
character-only sheet can be 3:2 or 4:3.

## Panel rules (apply to every sheet)
- **Character panels:** neutral mid-grey seamless backdrop, soft even studio light, standing relaxed,
  arms down, hands visible and resting. The face close-up is the panel that matters most: sharp,
  true skin with pores and fine texture, eyes open, neutral expression, no hair covering the face.
  Name the hair, skin, eyes, every garment with colour and material, shoes and accessories.
- **Canvas and tiles (always):** state the canvas size at the START and again at the END of the
  prompt ("landscape 16:9, 1920 by 1080", or the aspect the brief gives). Every panel is its own
  separate, hard-edged, fully opaque tile with a thin plain dark gap around it. The face close-up
  is a crisp, fully sharp, evenly lit tile of its own, the same strength as the others: never
  faded, ghosted, blended into the background, overlaid on another tile or fading out at the
  edges. With a reference image, the picture is a likeness source only, so the sheet is a new
  composition: the reference photo is not enlarged behind the tiles or left in the frame.
- **Same person everywhere:** write "identical face, hair, costume and proportions in every panel".
- **Outfit panels:** full body, one outfit each, garments described by colour and material.
  Costume inserts are close photographs of the item on a plain backdrop.
- **Prop panels:** the object alone on the neutral backdrop, one to three angles, scale shown by
  nothing but the object. State shape, material, colour, wear and parts.
- **Location panel:** a clean wide plate with no people, full-bleed in its panel, with every light
  source named by colour and position. Rich enough to be a believable place: layout, furniture,
  materials, practical lights, a little depth. Even exposure on the sheet is fine; the video prompt
  carries the dramatic light.
- **Text:** ask for NO text, labels, captions or watermarks. Image models garble lettering and the
  video model can copy it. The video prompt names each panel's role instead. If the user wants
  labels anyway, keep them as short plain words in a margin, and expect `rix-ingredients-prompt` to treat
  them as layout only.
- **Layout markers:** panels separated by thin, plain white or dark gaps, no decorative frames, no
  drop shadows, no numbering.
- **Positive wording only** (the closing "no text, no watermark" line is the one exception, as in
  `rix-lens`).
- **Look:** keep the sheet's lighting even and neutral for every look. Cinematic and Blockbuster
  drama (hard light, lens flare, oval bokeh) belongs in the video prompt via `rix-lens`, not baked
  into the sheet, or it fights the scene light later.

## Templates
Fill in the brackets. Keep the whole prompt readable: about 120 to 220 words.

**A. Character only**
Character reference sheet of [NAME], [age], [build], [one-line design signature]. Layout: on the left
a full-body front view standing relaxed with arms at the sides; on the right one large close-up of the
face. Hair: [colour, length, style]. Skin: [tone and texture]. Eyes: [colour]. Wearing [each garment
with colour and material], [shoes], [accessories]. Neutral mid-grey seamless backdrop, soft even
studio light, true-to-life skin with pores and fine texture, real fabric weight and wear. Identical
face, hair, costume and proportions in every view. Photoreal, thin plain gaps between panels, no
text, no watermark. Aspect ratio 16:9.

**C. Character + prop + location**
Reference sheet with three sections on a plain white grid. Top left: [NAME], [age, build, signature],
full-body front view and a face close-up, [hair, skin, eyes, each garment with colour and material,
shoes, accessories], on a neutral mid-grey backdrop. Top right: [PROP], [shape, material, colour,
wear, parts], shown from [one or two angles] on the same neutral backdrop. Bottom: a wide empty
[LOCATION], [layout, furniture, materials, plants], lit by [each light source with colour and
position], no people. Soft even studio light on the character and prop panels, true-to-life texture,
identical face and costume wherever the character appears. Photoreal, thin plain gaps between
panels, no text, no watermark. Aspect ratio 16:9.

For B, D and E, take template A and swap the layout sentence for the layout above, adding one
sentence of description per extra panel in the same colour-and-material detail.

## Getting a sheet that holds up
- **Generate wide, pick narrow.** One to three generations, then choose the best. Every chained edit
  softens the image and that softness carries into the video. For a new outfit or pose, regenerate;
  don't edit an edit.
- **One-shot sheet vs built in steps.** Try the full one-shot sheet first. If the face drifts between
  panels or the panels look crowded, make a clean character sheet first, then generate the location
  and prop as their own images and either combine them in a single reference image, or run the video
  with the character sheet alone and describe the place in text.
- **Likeness:** a distinctive face beats "handsome man" or "pretty woman". Use real photos only if the
  user owns the rights.
- **Check before approving:** same face in every panel; crisp skin; hands with five fingers; the prop
  clearly visible; the location empty of people; nothing that looks like text.
- **Test in motion** with one short Ingredients video before building a scene on it. About half of
  stills that look fine fall apart in motion. Put `inspect_media` on the result if the user brings it
  back, and name what to fix.

## Handing off
When the sheet is approved: tell the user to load it as the Ingredients input, click **Prompt with
Claude**, and describe the scene they want. `rix-ingredients-prompt` (and `rix-lens` for the look) take it
from there. Mention the sheet's contents when you hand over ("character on the left, the revolver top
right, the saloon along the bottom") so it is easy to check the panel mapping later.

## Failure fixes
- **Face changes between panels:** fewer panels, state "identical face" once per panel, or build the
  character sheet alone first.
- **Panels run together or have borders and shadows:** ask for "thin plain gaps", "no frames".
- **Garbled text appears:** add "no text, no labels" and remove any word that sounds like a caption.
- **Props or hands deformed:** simplify the pose, hands relaxed and visible, one prop angle.
- **Location has people in it:** say "empty, no people, no figures" and name a few still objects.
- **Everything too stylised or too glossy:** add "true-to-life skin texture, matte fabric, real wear".
- **Costume details too small to read:** drop a panel, or give the garment its own larger insert.

## Quick check
- Content and layout chosen, no more than 6 panels (7 for layout F).
- One job per panel; every character panel names hair, skin, each garment, shoes.
- Location panel empty of people, lights named.
- No text or labels requested; even neutral light on the sheet.
- Next step named: generate, pick, test in motion, then Prompt with Claude.

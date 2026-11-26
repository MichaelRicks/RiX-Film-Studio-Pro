---
name: rix-lens
description: Blockbuster anamorphic look for RiX Film Studio Pro (LTX 2.5), with four selectable looks (Natural, Cinematic, Blockbuster, Phone) and a lens-flare switch. Writes still-image prompts for character sheets, anamorphic location plates, hard-light lighting plates and ordinary phone-photo first frames (first frames and ingredients), and builds a compact LOOK LOCK to restate in every shot of a rix-prompt or rix-ingredients-prompt prompt. Use when the user says LENS, anamorphic, blockbuster look, cinematic look, lens flare, lighting plate, location plate, phone look, phone photo, real photo, found footage, looks AI, or says their videos look flat.
---

# RiX LENS: selectable cinematic looks

Adapted from PJ Ace's LENS skill for Seedance. Seedance takes many tagged reference images; RiX
takes ONE first-frame or ingredient image plus text. So here:
1. Bake the look into the still image that becomes the first frame or sheet.
2. Restate a short LOOK LOCK in words at every cut, because later shots get the look from text only.
3. Keep it compact: video prompts are 120 to 250 words with no negative prompts (see rix-prompt).

Status: tested on LTX 2.5 (2026-11-20, clockmaker, same seed, text-only, 2 shots, night and
daylight). With the lock the frames had directional light, rim light, vertical oval bokeh and film
texture; without it they were natural, evenly lit and documentary-like. Both looks were liked, which
is why there is a selector. The cut held the light in shot 2 in both tests.
CINEMATIC CONFIRMED (2026-11-20): the Cinematic v1 prompt (soft open-sky light, lens wording, no
flare) run text-only on the same seed gave a front-lit readable face, oval bokeh, shallow focus,
no flare, and shot 2 held the light. Earlier Cinematic runs (v1 to v3) were backlit with a red flare
only because they were run WITH a backlit first-frame image. LESSON: a first-frame image locks
composition and light and overrides the text. With an image, describe its light as it is; if the
user wants a different look, change the first-frame still (Stage 2), not just the text. Minor: the
close-up framed tighter than asked, and the wide drifted off the doorstep.

## Start every job by asking
- The LOOK (below): Natural, Cinematic, Blockbuster or Phone, and flare on or off (Phone has no
  flare). If the user already said ("Cinematic, no flare"), don't ask again. If they didn't, ask ONE
  short question with the four looks and the flare default.
- What are we making: a character sheet prompt, a location plate, a lighting plate, or a look lock
  for a video prompt?
- The scene: mood, time of day (night or daylight), the main light source in the world.
- What images already exist (sheets, plates, approved frames)? Use `inspect_media` (frames: 1,
  width 768, or 1280 for sheets) to look at them before writing.

Work one stage at a time and ask before moving on. Still-image prompts are plain English in a code
block, titled with what they feed. Positive wording only: say what is there, not what is absent
(exception: the short closing "no text, no watermark" line on still-image prompts, which is for the
image model, not the video prompt).

## THE LOOKS (the selector)
The lock has three independent parts: LENS (how the camera sees), LIGHT (how the scene is lit) and
FLARE. The looks switch them on and off.

| Look | LENS part | LIGHT part | Use for |
|---|---|---|---|
| **Natural** | off | off (plain rix-prompt wording) | Dialogue, groups, comedy, documentary realism. Default for rix-prompt and rix-ingredients-prompt. |
| **Cinematic** | on | soft version: one direction, gentle falloff, face readable | Filmic without the risk. Safe for faces. |
| **Blockbuster** | on | hard version: hard key, rim, deep textured shadow, shadow-side line when it suits | Hero shots, night, tension, trailers. |
| **Phone** | off (no anamorphic words at all) | plain, unflattering real-world light | Everyday realism, "looks like a real phone photo", found footage, vlogs, anything that must not look AI. |

**Flare switch:** On or Off, separate from the look. Default OFF for Natural and Cinematic, ON for
Blockbuster wides and establishing shots, and OFF in Blockbuster face close-ups (in testing the
flare crossed the face and forehead both times). If the user turns it on for everything, keep it
thin and faint and say once that it may cross a face.

**Flare strength (slider 0 to 1):** RiX's slider sends a strength, with 0 = off. Map it to words and
keep the same words in every shot that carries flare:
- 0.1 to 0.3: "a barely visible, very faint horizontal flare off [source]".
- 0.4 to 0.6: "one thin faint horizontal flare off [source]" (the default wording below).
- 0.7 to 0.85: "a clearly visible horizontal streak flare off [source]", no blowout.
- 0.9 to 1.0: "a bold bright horizontal streak flare off [source] that glows across the lens".
Above 0.6 the flare is more likely to cross a face: keep it off face close-ups, and say once in
your reply that it may still drift. A slider value overrides the "thin and faint" defaults here.

Natural needs no lock at all: just write the rix-prompt as usual. Say so, and offer the other two.

## STAGE 1: Character sheet (image model)
- Likeness first: a distinctive face, not "handsome man". Real reference photos only if the user owns
  the rights.
- Generate wide, pick narrow. One or two generations max: every chained edit softens the image and
  the mush carries into the video. For a costume change, regenerate the pose rather than editing an
  edit.
- The face close-up is the one that matters. Light the sheet evenly (all looks); drama comes from the
  lighting plates and the video prompt.
- Before approving, run one or two short test videos. About half of stills that look fine fall apart
  in motion.

Template:
Character reference sheet of [NAME], [age, build, one-line design signature]. Panels on a neutral
mid-grey seamless backdrop: full body front, three-quarter, profile, back; one large face close-up
panel; costume detail inserts of [items]. Face panel framed like an 85mm portrait, body panels like
a 50mm. Soft even studio light, true-to-life skin with pores and fine texture, real fabric weight
and wear. Identical face, costume and proportions in every panel. Photoreal, no text, no watermark.

Hand the result to `rix-ingredients-prompt`.

## STAGE 2: Anamorphic location plate (Cinematic and Blockbuster)
Pick the lens before the shot:
- Location or establishing: 24mm.
- Location with a hero object or depth layers: 35mm.
- Tight interior, corridor, vehicle: 40mm.
- Faces: 50mm or 85mm. Never 24mm on a face.

Lens profile, every trait written as visible evidence:
- Bokeh: elongated vertical oval highlights, named on what they sit on (lamp bulbs, wet floor,
  window glow, sunlit leaves or cobbles).
- Focus: one named focus point, camera 1 to 3 m from it, lens wide open, and name the layers that
  melt away.
- Edges: soft focus falloff toward the frame edges, a slight barrel bend.
- Flare (only if the flare switch is on): ONE thin, faint horizontal streak off ONE named source.
  Blue for cool sources, warm orange for tungsten, fire or sun. A kiss, never a blowout.
- Texture: 35mm film grain; tungsten 500-speed for night and interiors, daylight 250-speed for day.
- Frame: 2.39:1, three-quarter angle, camera to one side looking diagonally into the depth, at knee,
  waist or chest height.
- Drop any trait the user doesn't want (barrel bend, chromatic aberration) and say so in the prompt.

Template:
Cinematic film still. [Location in one line], [mood]. Three-quarter angle, camera set to one side
looking diagonally into the depth, lens at [height]. In frame, foreground to background: [layers].
Palette: [60% / 30% / 10% colours]. Light: [source, colour, direction, contrast]. Focus locked on
[named object], camera [1-3] m from it, lens wide open; [foreground] melts into creamy out-of-focus,
[background] dissolves into soft blur; anamorphic bokeh with elongated vertical oval highlights on
[surface]; [flare clause if on: one thin faint horizontal [blue / warm-orange] streak flare off
[source]]; soft focus falloff and a slight bend toward the frame edges. Shot on real 35mm film,
[stock] colour negative grain, anamorphic [24/35/40]mm lens. Realistic physics: [haze / dust / rain
backlit in visible streaks]. Indistinguishable from a real photograph. Clean environment, no
characters, no text, no watermark. Aspect ratio 2.39:1.

To use a plate as a first frame, it should contain the character; generate the plate with the
character in it, or use the plate as an ingredient. A plate with no characters suits establishing
shots and `rix-ingredients-prompt` Setting panels.

## STAGE 2B: Phone-photo still (Phone look)
Adapted from a Krea-2 "real photo" prompt recipe (2026-11-24; untested on LTX so far). Use it for
the first-frame still or an ingredient image when the user wants a photo that looks 100% real and
unedited. It works with any image model, as it is plain prose. Never mix it with the anamorphic
words of Cinematic or Blockbuster: no 35mm film, no oval bokeh, no flare, no 2.39:1.

Write ONE paragraph of 120 to 220 words, plain everyday language, the way a person describes a photo
on a friend's phone. Output only the prompt, in a code block.
- **How it was taken:** open with it ("A slightly tilted phone photo of...", "A quick mirror selfie
  of...") and say who took it (the subject, a friend, someone in a hurry). Casual framing: tilted
  horizon, off-centre subject, a little too much floor or ceiling, slightly high or low angle.
- **Subject:** ordinary people, not models. Rough adult age, build, expression, caught mid-action
  (talking, laughing, looking at a phone, squinting in the sun).
- **Skin, hair, clothes:** visible pores, slight redness, forehead shine, small blemishes; messy,
  damp or carelessly tied hair; wrinkled, faded or oversized clothes with lint or worn edges.
- **Props and place:** everyday clutter (receipts, cables, half-empty bottles, keys, scuffed walls,
  worn furniture). Generic descriptions, no brand names. Background people are busy with their own
  thing.
- **Light and colour:** realistic and usually unflattering: overhead fluorescent tubes, a dim yellow
  bulb, hard midday sun, direct phone flash with a dark background, mismatched window and lamp
  light. Say which way auto white balance went (too warm, too green, too blue).
- **Capture flaws, at least three, concrete:** noise in the dark areas, slight blur, focus on the
  wrong thing, blown highlights, crushed shadows, off white balance, haze around lights from a
  smudged lens, flash glare, JPEG softness, wide-lens distortion up close.
- **Text in the image:** transcribe exactly in double quotes and say if it is blurry or partly hidden.
- **Ending:** one short sentence calling it casual, unposed and unedited.
- **Banned words in this look** (they make images look AI): cinematic, editorial, masterpiece,
  stunning, beautiful, gorgeous, breathtaking, ethereal, dreamy, ultra-detailed, highly detailed,
  intricate, 8k, 4k, HDR, award-winning, professional, studio lighting, softbox, bokeh, golden hour,
  perfect, flawless, refined, aesthetic, sharp focus, rich textures, color grading, vibrant, moody,
  epic, dramatic lighting, rim light, hyperrealistic, photorealistic.

**Video-safe rule (this is for a first frame, so it differs from a plain photo prompt):** the flaws
carry into the clip, so choose ones that survive motion. Good: noise, off white balance, flat
unflattering light, haze, JPEG softness, a slightly tilted frame. Avoid: the face or head cut off by
the frame, mid-blink eyes, a hand blurred mid-motion, a finger over the lens. Keep the face and both
hands fully in frame and sharp enough to animate. The clip's motion rules still apply (slow, simple).

Template:
A slightly tilted phone photo of [subject, rough age, build] [doing a simple thing] in [ordinary
place], taken by [who]. [Framing quirks.] [Clothes, hair, skin with specific imperfections.]
[Everyday clutter and background people.] [Unflattering light and the white-balance slant.]
[Three or more video-safe capture flaws.] [Any text in quotes.] Casual, unposed and unedited, like
it was snapped quickly and never looked at again.

## STAGE 3: Lighting plate (Blockbuster; a soft version for Cinematic)
Video models pull every shot toward even exposure; typing "darker" only goes so far. Make light that
can't be misread:
- One dominant key with a clear direction and a hard edge (Cinematic: soft edge).
- A backlight or rim that separates subject from background.
- Deep shadow that still holds texture.
- Motivated practicals (lamps, fire, screens) as small accents.
- Warm/cool contrast between key and fill, or key and sky.
- Shadow side: key beyond the subject, camera on the unlit side, so the still already shows the
  falloff the video should have.

Template:
Lighting reference plate of [location]. Hard directional [colour temp] key from [direction] raking
across [surfaces]; strong [colour] backlight rimming [edges]; deep shadow on the [side] with
readable texture; [practicals] as small warm accents; [haze or steam] catching the light in visible
shafts. Key from beyond the subject, camera on the shadow side. High contrast, low-key exposure,
natural material colour. Same anamorphic lens profile as the location plate. No characters, no text.

## STAGE 4: The LOOK LOCK for video prompts
LTX has no reference tagging, so the lock is text, and it must be restated in the same words in
EVERY shot (the same trick rix-prompt uses for identity). Keep it to roughly 25 to 40 words per shot.
Build it from the chosen look:

**LENS part** (Cinematic and Blockbuster; reuse across a whole project):
"Anamorphic 35mm film look: vertical oval bokeh on the [named lights or surfaces] behind the
subject, shallow focus on the subject, soft edge falloff, fine film grain, wide 2.39:1 framing."
Use "50mm" or "85mm" wording for face close-ups, "24mm" for wide establishing shots. Use "fine
daylight film grain" by day, "fine film grain" at night.

**FLARE part** (only if the switch is on): "one thin faint horizontal [blue / warm-orange] flare off
[the window / the sun / the lamp]". Blue for cool sources, warm orange for sun, tungsten or fire.

**LIGHT part** (one per location; write it from the lighting plates or the scene):
- Blockbuster, night/interior example: "A single hard warm tungsten lamp from the upper left rakes
  across his face, deep shadow on the right side that holds texture, a cool blue rim light from a
  window behind him separates him from the dark workshop, small warm bulbs behind him."
- Blockbuster, daylight example: "A single hard warm sun from the upper right, in front of and beside
  him, lights his right cheek with crisp-edged shadow; a bright rim of sunlight catches his white
  hair and beard; deep shadow on the left side of his face holds texture with gentle warm bounce off
  the pale stone wall and cool blue sky fill; his face stays clearly readable."
- Cinematic (soft): "Soft [window / open-sky] light from the [left], gentle falloff from light to
  shadow, a faint cool fill, natural colour, face clearly readable."
Every LIGHT part names: key source and direction, colour temperature, rim, shadow with texture,
bounce or fill, and what the light stays ("stays cool and low-key", "stays crisp, high-contrast
sunlight"). Phrase the stay as a positive.

**PHONE look lock** (replaces LENS, FLARE and LIGHT parts; Phone has none of those). About 20 to 30
words, restated in the same words in every shot: "Handheld phone-video look: slightly uneven
framing, flat [fluorescent / window / overcast] light, auto white balance a little [warm / green],
soft phone-camera noise in the shadows, nothing staged." Describe the light as the first-frame image
shows it. No lens, bokeh, film-grain or flare words. Keep the camera mostly still or one slow drift;
no shake instructions, and keep hands resting (anatomy rules).

**Daylight cautions:** the sun may land behind the subject if you only say "from the upper right";
say "in front of and beside him" and "face clearly readable". Keep the flare to the wide shot.

**Shadow-side line** (Blockbuster only; dialogue, night, tension, hero close-ups):
"Key light from beyond the subject, camera on the unlit side of the face; strong falloff from light
to shadow, rim light separating subject from background; shadows hold texture and the face stays
readable."
Skip it for comedy beats, wides where several faces must read, daylight exteriors and fast action.

**How to apply it with the other skills:**
- `rix-prompt`: shot 1 must still describe the first-frame image exactly. Put the lock in the
  lighting and framing words of shot 1 (matching what the image shows) and repeat the same LENS,
  LIGHT (and FLARE) words at each cut, after the subject re-description. Hard cuts only, no
  dissolves.
- `rix-ingredients-prompt`: put the lock in the `Generated video:` part only, never `Reference sheet:`, and keep it to one short sentence.
- Respect the anatomy and motion rules. Keep hands resting; slow, simple motion still applies.
- Busy scene, many cuts: fewer lock words per shot (the LIGHT part plus "anamorphic film look").
  A two-hander or single master shot can carry the full lock.
- If the user wants the lock written into a prompt now, write the full prompt with the relevant
  skill's recipe and put it in the box with `set_generation_prompt` as that skill describes.
- Leave Enhance off, as the other skills say.
- When the user is unsure, offer an A/B: the same prompt in two looks, same seed.

## Failure fixes
- Everything sharp: name a focus point, camera 1 to 3 m from it, "wide open".
- Round bokeh: "elongated vertical oval highlights" and name what they sit on (foliage gives less
  than lamp bulbs; name sunlit leaves or cobbles).
- Flare crosses the face or turns red: switch flare off for the close-up, keep it for the wide, or
  use "thin faint warm-orange flare off the sun".
- Fisheye look: add "rectilinear", drop to 35mm.
- Stretched face: a person was shot on 24mm; use 50mm or 85mm.
- Flat or even light: the light part is too soft or missing; name direction and "deep shadow on the
  [side]", add the shadow-side line, or move from Cinematic to Blockbuster.
- Light drifts between shots: restate the LIGHT part word for word and add what it stays.
- Face too dark or sun behind the subject: "in front of and beside him", "gentle bounce on the
  shadow side", "face clearly readable", or drop to Cinematic.
- Too stylised for the scene: drop to Cinematic or Natural.
- Phone look still comes out glossy or model-pretty: a banned word crept in, or the light is too
  nice; name the ugly light source and add one more small imperfection.
- Phone look clip morphs or the head cuts off: the still had a cropped head or a blurred hand; redo
  the still with the face and both hands fully in frame (see the video-safe rule).
- Soft or splotchy still: too many chained edits; go back to the earliest clean generation.
- A brand or logo appears: a product name crept in; describe the look instead.

## Quick check before generating
- Look and flare chosen (or asked).
- Sheet: same face in every panel, crisp skin. Test in motion first.
- Plate: vertical oval bokeh, one named focus point.
- Lighting plate: clear key direction, rim, textured deep shadow.
- Video prompt: the same LENS, LIGHT (and FLARE) words appear in every shot.

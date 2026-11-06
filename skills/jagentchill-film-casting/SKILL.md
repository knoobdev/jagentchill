---
name: jagentchill-film-casting
description: Character, location and prop analysis, appearance variants, reference images for consistency, and voice assignment.
---

# Film casting

## Extract
Read the script and list every character, location and prop that appears on screen. For each, note the scenes it is in and what the text says about it. Merge duplicates (a nickname, a description, a title) into one entry.

## Characters
Describe each in fixed order: age, build, face, hair, clothing, one distinguishing mark. Add an appearance variant only when the story changes the look (older, injured, in uniform), and say in which scenes it applies.

## Reference images
Generate one reference per character and variant with `jc_generate_image` on a plain background, front and three-quarter view. Approve it before any panel is made; every later prompt names that reference. Do the same for locations (an establishing plate) and for props that matter to the plot.

## Voices
List voices with `jc_voice_list` and assign one per speaking character; design one with `jc_voice_design` only when none fits. No two characters in the same scene share a voice. Record the delivery in three words.

## Keeping it consistent
Add or change a character with `jc_film_upsert_character`; places and props are changed on the Assets screen. When a reference changes, every panel that used it is stale: list them before changing.

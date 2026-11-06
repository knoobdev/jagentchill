---
name: jagentchill-film-shots
description: Panel image prompts, first and last frame video prompts, regeneration and candidate selection.
---

# Film shots

## Panel images
Write each prompt in the same order: character with its reference, action, location with its plate, framing, light, the style clause from the bible. Name what must not appear only when it keeps appearing.

The pictures themselves are made by Film Studio (its pipeline, or the Storyboard screen), each drawn with the reference pictures of the characters and the place it shows. Ask for few candidates per panel: more cost more and rarely fix a bad prompt.

## Choosing
Pick by, in order: continuity with neighbouring panels, the character matching its reference, clear action, then beauty. A handsome frame that breaks continuity is the wrong one.

## Video
Give the first frame (the chosen panel), the motion in one sentence, and the last frame when the next shot depends on it. One camera move and one subject action per clip. Keep clips as short as the shot needs.

## Regenerating
Change one thing per attempt and note it. After two failed attempts, change the framing or split the shot instead of repeating. Keep the previous candidate until a better one is selected.

Add or change a panel with `jc_film_upsert_shot`; remove one with `jc_film_delete_shot` (it asks the author first).

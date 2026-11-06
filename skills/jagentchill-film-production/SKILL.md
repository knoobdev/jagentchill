---
name: jagentchill-film-production
description: "The overall film pipeline: stages, readiness and stale markers, and which stage tool to call next."
---

# Film production

## Stages, in order
Story, script, assets, storyboard, video, voice, sound, timeline. A stage is **ready** when its inputs are approved, **done** when its output is approved, and **stale** when something upstream changed after it was made.

## Finding the next action
Read the film with `jc_film_get`. Work on the earliest stage that is not done. Never polish a stage while an earlier one is stale: its work will be thrown away.

The stages run from Film Studio's own pipeline; the assistant changes the film itself with `jc_film_upsert_scene`, `jc_film_upsert_shot` and `jc_film_upsert_character`, and removes with `jc_film_delete_scene`, `jc_film_delete_shot` and `jc_film_delete_character` (each delete asks the author first). Reorder scenes with `jc_film_reorder_scenes`.

## Stale work
When a change makes later stages stale, list them and what regenerating each would cost before doing anything. Regenerate only what the change really touches: a new line of dialogue stales that panel's voice, not the whole episode.

## Asking
Ask the author in the chat for decisions that belong to them: an ending, a character's look, a spend. Offer two or three concrete options.

## Episodes
Treat each episode as its own run of the stages, sharing characters, locations and the style bible from the film.

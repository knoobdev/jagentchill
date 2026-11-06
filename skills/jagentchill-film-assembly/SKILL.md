---
name: jagentchill-film-assembly
description: Assemble panels, dialogue, captions and music into the timeline and export the whole film.
---

# Film assembly

## Build order
1. Picture in story order, each clip at its planned length.
2. Dialogue under its shots, then adjust picture to speech, never the reverse.
3. Captions from the final dialogue.
4. Music and effects.
5. Titles and credits.

Plan with `jc_video_assemble_plan` and place clips with `jc_clip_add`.

## Checks before export
Run `jc_video_checks` and resolve what it finds. Then confirm by hand: no gap or black frame, no line cut off, captions in sync, music ducked under speech, the same loudness from episode to episode.

## Placeholders
Anything not final (a missing shot, a temporary voice) is listed with its timecode. Do not export a "final" film with placeholders in it.

## Export
Start with `jc_export_start`, follow with `jc_export_status`. Export one master at the film's native settings, then derive other formats from it.

## Hand-over
Report duration, what was regenerated at this stage, and what remains open.

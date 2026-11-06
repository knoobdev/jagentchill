---
name: jagentchill-captioning
description: Caption generation, line breaking, reading speed, bilingual layout, and burn-in versus sidecar files.
---

# Captioning

## Generate, then correct
Create a transcript with `jc_transcript_create` and captions with `jc_caption_generate`. Automatic text is a draft: check names, numbers and places against the script before anything else.

## Lines people can read
- At most two lines, about 37 characters each for 16:9 and 20 for vertical video.
- Break at a phrase boundary: before a conjunction or preposition, never between an article and its noun.
- Keep a caption on screen at least one second and no longer than seven; aim for 15 to 17 characters per second, slower for children or dense subjects.
- Do not let a caption cross a cut by more than a few frames.

Fix text and timing with `jc_caption_edit`; set appearance with `jc_caption_style`.

## Two languages
Translate with `jc_caption_translate`. Put the viewer's language on the lower line and keep the two lines visually distinct by weight, not by colour alone. Shorten the translation rather than shrinking the type.

## Burn-in or sidecar
Burn captions in for social video that plays muted. Deliver a sidecar file with `jc_caption_export` for platforms with their own caption player and for anything that needs more than one language.

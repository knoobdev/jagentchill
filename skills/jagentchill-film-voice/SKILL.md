---
name: jagentchill-film-voice
description: Voice lines, speaker assignment, text-to-speech direction, and lip-sync preparation.
---

# Film voice

## Lines
Take dialogue from the approved script, one line per panel or beat. Do not rewrite a line to fit a voice; flag it to the author instead.

## Speakers
Every line has exactly one speaker with an assigned voice. Narration is a speaker too. Check that a character keeps the same voice across episodes.

## Direction
Give each line three things at most: emotion, pace, emphasis word. Punctuation is direction: a comma is a breath, a dash is a turn. Write numbers and abbreviations the way they are spoken.

Generate with `jc_generate_voice`. Listen to the first line of each character before generating the rest.

## Timing
Compare each line's length with its panel. If speech is longer, lengthen the shot or split the line; do not speed the voice beyond natural.

## Lip-sync
Prepare a shot for `jc_lipsync_run` only when the face is visible, lit and mostly frontal, and the line fits the clip. Profile shots, crowds and fast motion are covered with a cutaway instead.

---
name: jagentchill-sound-design
description: Music selection, sound-effect placement, voice levels, ducking and loudness targets.
---

# Sound design

## Voice comes first
Set the voice level before anything else and leave it alone. Everything else is mixed around it.

## Music
Choose music for tempo and mood against the cut, not for itself. Find the beats with `jc_audio_beats` and move cuts to them only where it does not hurt the story. Search the library with `jc_library_search` before generating with `jc_generate_music`.

Duck music under speech with `jc_audio_duck`: lower it by roughly 10 to 14 dB, starting a little before the first word and recovering after the last. Join two pieces with `jc_audio_crossfade` on a bar line.

## Effects
An effect earns its place by explaining something on screen: a door, a swipe, an impact. Place it on the frame of the event, not before. Three layered effects are usually two too many. Generate with `jc_generate_sfx` only what the library does not hold.

## Loudness
Aim for about -14 LUFS integrated for online video and -23 LUFS for broadcast, with true peaks below -1 dBTP. Check the loud passage and the quiet one, not only the average.

## Clean-up
Fade every clip edge a few frames to avoid clicks, using `jc_audio_edit`. Listen once on small speakers before calling it done.

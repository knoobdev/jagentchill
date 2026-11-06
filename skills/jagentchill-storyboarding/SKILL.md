---
name: jagentchill-storyboarding
description: Break a script into shots and panels with framing, movement, continuity notes and image and video prompt structure.
---

# Storyboarding

## From scene to shots
For each scene decide what the viewer must see to follow it, then give every such moment one panel. A panel that carries no new information is removed.

Each panel states:
- **Framing**: wide, medium, close or detail, and the subject's place in the frame.
- **Movement**: of the camera (static, pan, push, track) and of the subject, one of each at most.
- **Duration**: seconds on screen.
- **Continuity**: screen direction, eyeline, wardrobe, props and time of day carried from the previous panel.

## Prompt structure
Write image prompts in a fixed order so results stay consistent: subject, action, setting, framing, light, style. Keep the style clause identical across a sequence. For video, describe the first frame, the change, and the last frame; do not describe a cut inside one clip.

## Continuity first
Before generating, check each character against its reference and each location against its plate. A panel that breaks continuity is fixed in the prompt, not in the edit.

## Handing over
Give the editor the panel list in order with durations and the intended cut type. Generate stills with `jc_generate_image` and motion with `jc_generate_video` only after the list is agreed.

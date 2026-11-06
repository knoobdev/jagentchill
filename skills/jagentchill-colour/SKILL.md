---
name: jagentchill-colour
description: Grading order, matching shots, and using adjustment layers and LUTs.
---

# Colour

## Fixed order
1. **Balance**: exposure and white balance per shot, until skin and neutrals look right.
2. **Match**: bring the shots of a scene to one reference shot.
3. **Look**: one creative grade over the whole sequence.

Doing the look first hides the faults you then have to chase shot by shot.

## Balancing and matching
Adjust with `jc_color_adjust`. Judge by a neutral object and a face, not by the whole frame. Match a scene with `jc_color_match` against the shot with the best exposure, then correct by eye what the match missed, usually saturation and shadows.

## The look
Put the look on an adjustment layer above the sequence instead of on each clip, so it can be changed or removed in one place. Apply a LUT as a filter with `jc_filter_apply` after balancing, at reduced strength; a LUT on unbalanced footage exaggerates every fault.

## Limits
Keep skin within a believable range, do not crush blacks to hide noise, and check the grade at both ends of the film. If two shots still do not match, a cut between them is not ready.

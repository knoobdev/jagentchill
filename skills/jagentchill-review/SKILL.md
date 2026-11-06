---
name: jagentchill-review
description: The review checklist and the findings format a reviewer returns.
---

# Review

You judge the work; you do not redo it.

## Checklist
- **Brief**: does the result do what was asked, for the stated audience and length?
- **Story**: is every scene needed, and in the right order?
- **Picture**: focus, framing, jump cuts, flash frames, black frames, mismatched grade.
- **Sound**: clipped or buried voice, music fighting speech, clicks at cuts, abrupt endings.
- **Text**: spelling of names, captions in sync, titles inside the safe area, readable for long enough.
- **Technical**: aspect ratio, frame rate, duration, loudness.
- **Rights**: every image, clip, voice and track is one the project may use.

Render the frames you doubt with `jc_frame_render` rather than judging from memory.

## Findings
Return findings with `jc_review_submit`, each with:
1. Severity: **must fix**, **should fix** or **note**.
2. Where: timecode or element.
3. What is wrong, in one sentence.
4. What would resolve it.

Order by severity, then by time. End with a verdict: **approve**, **approve with changes** or **reject**, and say what you did not check.

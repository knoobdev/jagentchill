# CapCut mobile editor — observed layout (Mobbin, iOS)

Source: Mobbin MCP, app "CapCut", iOS, 16 editor screens reviewed 2026-10-05. Mobbin returned no
CapCut screens for web/desktop (the web query returned other editors), so the desktop layout
benchmark comes from `capcut-parity-benchmark.md` (web research), not from screenshots.

This file records the *interaction structure* JAgentChill's mobile editor must match. Visual styling
(colors, type, radii, components) follows `devin-ui-reference.md`; no CapCut brand assets are used.

## Editor screen structure (portrait)

```
┌──────────────────────────────────────────┐
│ ✕  ?            [Pro] [1080P ▾] [Export] │  top bar: close, help, resolution/format, export
├──────────────────────────────────────────┤
│                                          │
│              Preview canvas              │  selected element shows bounding box; text shows
│                                          │  corner handles (delete ✕, edit ✎, copy, scale/rotate)
├──────────────────────────────────────────┤
│ ⛶          ▶ / ❚❚            ◇+  ↶  ↷    │  fullscreen · play · keyframe add · undo · redo
│ 00:03 / 01:09   · 00:02 · 00:04 · 00:06  │  current/total + ruler
├──────────────────────────────────────────┤
│ [Mute clip audio] [Cover] ▮▮▮▮▮▮▮▮▮ [+]  │  main track: mute toggle, cover editor, filmstrip, add clip
│            + Add audio                   │  placeholder row for audio
│        [overlay / text / effect bars]    │  secondary tracks as colored bars under main track
│                  │ fixed center playhead │  timeline scrolls under a fixed vertical playhead
├──────────────────────────────────────────┤
│ Edit  Audio  Text  Effects  Overlay      │  root toolbar (horizontal scroll):
│ Captions  Filters  Templates  …          │
└──────────────────────────────────────────┘
```

- Playhead is fixed at screen center; the timeline content scrolls. Pinch zooms the timeline.
- Main track is a continuous filmstrip (frame thumbnails across time, not one repeated thumbnail);
  clips sit edge to edge (magnetic main track). "+" at the right end appends media.
- Selecting a clip shows white trim handles on both ends and a duration badge ("22.1s"); speed badge
  ("5.0x", curve name "Hero") and mute icon render on the clip.
- Secondary items (text, captions, filters, effects, extracted audio, music) render as colored bars
  with a label; selected bar gets white handles. Audio bars show a waveform.
- Root toolbar → tapping a group replaces the toolbar with a sub-toolbar preceded by a "«" back
  button. Selecting a clip switches to that clip type's tool strip.

## Observed tool strips

| Context | Tools seen (left→right, horizontally scrollable) |
|---|---|
| Root | Edit · Audio · Text · Effects · Overlay · Captions · Filters · Templates |
| Video clip selected | Split · Speed · Animations · Volume · Delete · Enhance voice · … · Relight (Pro) · Auto reframe (Pro) · Camera tracking (New) · Opacity · Reverse · Mask |
| Video clip → transform | Mirror · Rotate · Resize |
| Speed | Normal · Curve · Velocity effects |
| Speed → Curve | None · Custom · Montage · Hero · Bullet · Jump Cut … (curve thumbnails), ✓ confirm |
| Audio | Sounds · Extract · Voiceover · Sound FX · Text to audio · Copyright · Brand music |
| Caption selected | Split · Style · Edit captions (New) · Duplicate · Delete · Text to … ; batch: Batch edit · Style · Voice · Volume · Delete · Separate |
| Filter / effect bar selected | Adjust · Replace · Duplicate · Object · Delete · Layers ; Adjust · Duplicate · Split · Delete · Layers |
| Enhance voice panel | title + collapse, toggle "Enhance voice", slider "Noise cleanup" 0–100 |

- Panels opened from a tool replace the toolbar area with a titled sheet (title centered, ✓ / ⌄ at
  right) while the preview and a compact timeline stay visible.
- Export control: resolution chip ("1080P ▾") or format chip ("GIF ▾") left of the Export button.
- Template editor variant: top bar with back, audio selector chip, Export; segment chips under the
  preview; bottom tabs Media · Audio · Text.

## Rules carried into JAgentChill mobile

1. Preview on top, fixed-center playhead timeline in the middle, context toolbar at the bottom.
2. Two-level toolbars with back chevron; clip selection swaps the toolbar to clip tools.
3. Tool panels are bottom sheets that never cover the preview.
4. Main track is magnetic with per-clip mute, cover editor entry, and end "+" add button.
5. Undo/redo, keyframe add, play and fullscreen live in the transport row between preview and timeline.

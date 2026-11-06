# CapCut parity benchmark (for the JAgentChill spec)

Research date: 2026-10-05. Method: web search and page extraction only. No CapCut build was installed or operated for this document, so nothing here is first-hand observation of the app.

## 0. How to read this document

**Evidence tags**

- `[C]` backed by a CapCut-owned page (capcut.com help centre, tool pages, resource articles, CapCut's YouTube channel, CapCut's App Store listing text).
- `[T]` backed only by a third-party tutorial, review or reference site.
- `UNVERIFIED` no source found in this research pass. These items are widely believed to exist in CapCut but must be checked against a real build before they are treated as parity requirements.

**Platform tags**: `[desktop]` (Windows/macOS app), `[mobile]` (iOS/Android app), `[web]` (capcut.com/editor). A tag is present only when a source confirmed the feature on that platform. **A missing tag means "not confirmed", not "absent".**

**Caveats that apply to the whole document**

1. CapCut ships frequently, runs phased and regional rollouts, and gates features by plan. Its own help pages say so ("available only for users in certain regions or during phased rollouts" [S24d]; export options "depend on the platform and device" [S19c]). Label names and positions vary by version.
2. Free vs Pro gating changes often and is deliberately **not** tracked here, except where a source states it.
3. CapCut's marketing/resource articles are written for SEO and sometimes describe the web and desktop editors interchangeably. Where an article did not say which platform it described, the platform tag was left off.
4. Counts of presets (number of transitions, filters, fonts, effects) were not found in any source and are not given.
5. A fourth client, "CapCut Pad" (tablet), appears in capcut.com navigation [S24a]. It was not researched.

Source keys (`[S1]` etc.) resolve in section 6.

---

## 1. Editor layout per platform

### 1.1 CapCut desktop (Windows / macOS)

**Home / launcher** (before the editor opens)

- "New project" / "Create project" button opens the editor [C][S1][S15b].
- "AI video maker" entry on the home page [C][S24c][S24e]; "Script to Video" entry with "AI Writer" [C][S24b].
- Draft list; drafts can also live in a cloud "Space" [C][S1][S20a].
- Templates tab; its position is described inconsistently (wikiHow: "in the menu bar to the right on Desktop") [T][S10]. Exact placement UNVERIFIED.
- QR-code login to link the desktop app to the mobile account [C][S20e].

**Editor: four regions** [T][S5][S10][S35b], consistent with [C][S1]

| Region | Position | Role |
|---|---|---|
| Media & assets panel ("library panel") | top left | import, plus all asset libraries as tabs |
| Player | top centre | preview, playback, direct manipulation |
| Properties panel (also "Details" when nothing is selected) | top right | per-selection inspector tabs |
| Timeline with its toolbar | bottom | multi-track editing |

**Left panel tabs** (asset libraries)

| Tab | Sub-areas confirmed | Evidence |
|---|---|---|
| Media (also labelled Import) | Import (local); Library (stock video: AI materials, trending, green screen, life, scenery, intro...); import from CapCut Space | [C][S1] |
| Audio | Music; Sound effects | [C][S1], [T][S10] |
| Text | Add text; text presets; text effects; Text templates | [C][S1][S26b] |
| Stickers | sticker categories; "AI generated" tab (prompt to sticker) | [C][S1] |
| Effects | Video effects (trending, nature, spark, love, lens, retro, distortion...); Body effects (axis rotation, lighting, love-struck...) | [C][S1] |
| Transitions | categories listed in 2.6 | [C][S1][S25] |
| Captions | auto captions (spoken language, bilingual language, Generate) | [T][S7], [C][S17e] |
| Filters | categories (mono, retro, style, food, night scene, Movie, Portrait...) | [C][S1][S15d] |
| Adjustment | adjustment-layer presets; LUT (Import .cube/.3dl) | [C][S15c], [T][S7] |
| Templates | project templates | [T][S10]; placement UNVERIFIED |

One third-party source lists the tab row as "Import, Audio, Text, Stickers, Effects, Transitions, Captions, Filters, Adjustment" [T][S7].

**Player** [C][S2], [T][S21a][S35b]

- Play/pause, timecode, fullscreen, zoom in/out, zoom-to-fit.
- Aspect-ratio control for the project.
- Snap/alignment guides when dragging in the player (hold Cmd/Ctrl to cancel alignment) [C][S2].
- Preview quality / play-speed control to lower playback load [T][S21b].

**Right panel (inspector) tabs when a video clip is selected**: Video, Audio, Speed, Animation, Tracking, Adjustment [T][S7][S21c], consistent with [C][S1].

| Tab | Sub-tabs / controls confirmed | Evidence |
|---|---|---|
| Video > Basic | position, scale, rotate; Blend (mode + opacity); Stabilize; "Removing video flickers"; Filter strength; Auto reframe; Relight; Motion tracking | [C][S1], [T][S10] |
| Video > Cutout (also "Remove BG") | Auto cutout; Custom removal (Smart brush, Smart eraser, Simple eraser); Chroma key | [C][S1][S30a] |
| Video > Mask | mask shapes, feather, invert, position/size/rotation | [C][S1][S16a] |
| Video > Retouch | face/body retouch | [C][S23b] (tab placement UNVERIFIED) |
| Audio | Volume; Fade in/out; Loudness normalization; Noise reduction; Enhance voice; Vocal isolation; Voice changer tab | [C][S1][S18], [T][S10] |
| Speed | Normal; Curve; Velocity effects | [C][S1], [T][S10] |
| Animation | In / Out / (Combo or Loop) | [T][S10][S21d]; label of third group UNVERIFIED |
| Tracking | motion/camera tracking | [T][S21c], [C][S1] |
| Adjustment | Basic; HSL; Curves; Color wheel | [C][S1][S15] |

With nothing selected, the right panel shows project **Details** (name, aspect ratio, resolution, save path) and a **Modify** button that opens Project settings with tabs **Details** and **Performance** [T][S21a][S21b][S35b].

With a text clip selected the tabs include Basic (content, font, style), Animation (In / Out / Loop), and Text-to-speech [C][S26], tracking tab UNVERIFIED.

**Timeline toolbar** (icon row above the tracks; icons have no text labels [T][S6])

Left group, in order [C][S1], [T][S5][S6]:

1. Cursor mode dropdown: Select, Split, Select leftward, Select rightward
2. Undo, Redo
3. Split
4. Delete left ("split and delete left")
5. Delete right
6. Delete
7. Add marker
8. Freeze
9. Reverse
10. Mirror
11. Rotate
12. Crop

Context quick-access tools listed by one third-party source: Transcript, Split scenes, Remove background, Auto adjust, Enhance visual, Extract audio, Enhance audio, Voiceover [T][S5]; "Mark beats" (AI) for audio clips [T][S29b].

Right group [C][S2], [T][S5][S34]: Record (voiceover), Main track magnet, Auto snapping, Linkage, Preview axis, Zoom slider, Zoom to fit.

**Track header** controls: Hide track, Lock track, Mute track [T][S5][S34].

**Top bar**: Menu (File, Settings...), **Shortcuts** button (opens the rebinding dialog), **Export** button top right [C][S2], [T][S21e].

### 1.2 CapCut mobile (iOS / Android)

**Home** [T][S9][S10]

- Projects panel: grid of saved projects; tap a tile to reopen. Projects auto-save as drafts [T][S7b].
- "+ New video" / "New project" tile opens the camera-roll picker; items get a numbered badge that sets initial timeline order; "Add" confirms.
- Bottom tab bar includes **Templates** (browse by category, search, "Use template", fill placeholder slots, Preview, Export) [T][S9]. The full set of bottom tabs (commonly Edit / Templates / Inbox / Me) is UNVERIFIED.
- Home shortcut tiles (AutoCut, photo editor, camera, teleprompter, etc.) UNVERIFIED.

**Editor regions** (top to bottom) [T][S8][S9][S11]

1. Top bar: close/back, resolution label (opens export settings), **Export** (top right).
2. Preview window: pinch, drag and rotate elements directly.
3. Transport row: play, undo/redo (on the right side on mobile [T][S10]), fullscreen.
4. Timeline: main track with "+" add-clip button, transition slot (white square) between clips, "Add sound" lane under the video, overlay/text/sticker/effect lanes. Pinch to zoom; long-press and drag to reorder.
5. Bottom toolbar: context-sensitive. The **main toolbar** shows when nothing is selected; a **sub-toolbar** replaces it when a group or a clip is selected. A back arrow at the far left returns one level [T][S36b].

**Main toolbar** (nothing selected). Two sources give near-identical lists:

- [T][S7]: Edit, Audio, Text, Effects, Overlay, Captions, Aspect Ratio, Filters, Adjust, Media, Stickers, Background.
- [T][S8]: Edit, Audio, Text, Stickers, Overlay, FX, Filters, Adjustment, Background, Canvas, Format.

Order and labels vary by version ("Aspect ratio" / "Ratio" / "Format"; "Background" / "Canvas").

**Sub-toolbars**

| Group | Items confirmed | Evidence |
|---|---|---|
| Edit (same as the per-clip strip for a video clip) | Split, Speed, Animations, Effects, Delete, Enhance voice, Isolate voice, Retouch, Remove BG, Camera tracking, Volume, Transform, AI expand, Adjust, Video quality, Filters, Overlay, Basic, Mask, Duplicate, Replace, Extract audio, Opacity, Reverse, Freeze, Audio effects, Beats, Link. Listed as Pro: Auto frame (auto reframe), Relight, Motion blur, Stabilize, Reduce noise | [T][S7] |
| Edit > Transform | Rotate (90 degree steps), Mirror/Flip, Crop, Advanced > Rotate slider | [T][S10][S36c] |
| Edit > Speed | Normal (0.1x to 100x, pitch option), Curve (presets + Custom + Edit), Velocity effects | [T][S9][S10] |
| Edit > Remove BG | Auto removal, Custom removal, Chroma key | [C][S12] |
| Edit > Camera tracking | follow face, body, hands or a custom-selected area; "AI movement" styles | [C][S12] |
| Audio | Sounds (CapCut library tab; Folder icon > Device for local files), Sound FX, Record (voiceover) | [T][S9][S10] |
| Audio clip strip | Volume, Fade, Beats (manual tap or Auto generate with Light-to-Intense slider), Voice effects/Voice changer, Reduce noise, Extract, Split, Delete | [T][S29a][S10]; exact list UNVERIFIED |
| Text | Add text, Auto captions, Text templates, Auto lyrics, Stickers, Draw | Add text / Auto captions [T][S9]; Draw [T][S36d]; others UNVERIFIED on mobile |
| Text editor tabs | Style (font, colour, size, background), Effects, Bubble, Animation; "Text to audio" (TTS) | [T][S9][S11], [C][S12] |
| Stickers | category tabs, search, add image from phone as sticker | [T][S10] |
| Overlay | "Add overlay"; overlay clip gets the same edit strip; double-arrow returns to main timeline | [C][S33a], [T][S11] |
| Effects | Video effects, Body effects, Photo effects, AI effects / Style | [T][S7][S10] |
| Filters / Adjust | three tabs on one sheet: Filters, Adjust, Video quality | [T][S21c] |
| Aspect ratio | ratio presets (9:16, 16:9, 1:1, 4:5... full list UNVERIFIED) | [T][S9] |
| Background | colour, blur, image | [C][S31] (platform not stated) |
| Transition slot | category tabs (Basic, Trendy, MG...), search, Duration slider, confirm | [T][S9][S10] |

### 1.3 CapCut web (capcut.com/editor)

- **Workspace home**: drafts, Spaces, "Create with AI" and "AI voiceover" entry cards, team settings under Profile > Teams > Team Settings [C][S20b][S24c].
- **Left sidebar tabs** (as rendered by the live editor page): Media, Templates, Elements, Audio, Text, Captions, Transcript, Effects, Transitions, Filters, Brand Kit [C][S13]. "Elements" is the web name for stickers/shapes; "Plugins" was not seen in this research.
- **Media upload sources**: device, drag and drop, cloud space, Google Drive, Dropbox, QR-code scan from a phone [C][S16a][S23a].
- **Canvas / player** in the centre, with ratio selector above it [C][S31b].
- **Right sidebar tabs**: Basic (includes Mask), Background, Smart tools (Retouch, etc.), Audio (Basic > Noise reduction; Voice changer), Speed, Animation [C][S16a][S18d][S23a][S19e][S26c]. Full list UNVERIFIED.
- **Timeline** at the bottom, multi-track, with snapping [T][S32].
- **Top right**: "..." menu (Transfer editing permission), **Export** (Download, share for review, share as presentation, share to social) [C][S20a][S20c].
- A separate **image editor** with its own interface exists on web [T][S32].

---

## 2. Feature inventory by area

One line per discrete feature. Platform and evidence tags as defined in section 0.

### 2.1 Project and canvas

- Create a new blank project from the home screen. [desktop][mobile][web] [C][S1][S20a], [T][S9]
- Project/draft list with reopen; drafts auto-save. [desktop][mobile][web] [T][S7b][S9], [C][S20a]
- Rename and delete projects. [web] [T][S32]; desktop/mobile UNVERIFIED
- Project settings: name, save location, aspect ratio, resolution, frame rate. [desktop] [T][S21a][S35b]
- Aspect-ratio presets for social platforms; 9:16, 16:9, 1:1, 4:5 confirmed. [desktop][mobile][web] [C][S31][S31b], [T][S9]. Full preset list (4:3, 3:4, 2:1, 2.35:1, 1.85:1, 5.8", custom) UNVERIFIED.
- Changing ratio re-fits clips; manual reposition may be needed. [desktop][mobile] [T][S19a][S9]
- Canvas background: solid colour. [C][S31]
- Canvas background: blur of the clip. [C][S31]
- Canvas background: image. [C][S31]
- Apply background to all clips. UNVERIFIED
- Cover: edit the video cover at export. [desktop] [C][S1]
- Cover: pick a frame or upload an image, add cover text/template (mobile "Cover" button). UNVERIFIED
- Remove/disable the auto-appended CapCut ending clip. [mobile] [T][S9]

### 2.2 Media import and library

- Import local video, image, audio (button or drag and drop). [desktop][web] [C][S1]
- Import shortcut. [desktop] [C][S2]
- Pick from camera roll with ordered multi-select. [mobile] [T][S9]
- Add more clips with the timeline "+" button. [mobile] [T][S10]
- Stock video library with categories (trending, green screen, intro, scenery...). [desktop][web] [C][S1], [T][S32]
- AI-generated materials category in the library. [desktop] [C][S1]
- Import from CapCut cloud Space. [desktop][web] [C][S1][S16a]
- Import from Google Drive / Dropbox. [web] [C][S16a]
- Import from phone via QR-code scan. [web] [C][S16a]
- Paste media from clipboard. UNVERIFIED
- Smart Search across media by objects, speech, people, environments. [desktop] [C][S24b]
- Record from webcam/screen. UNVERIFIED
- Media "Media" button on the mobile main toolbar (stock/AI image). [mobile] [T][S7][S36a]

### 2.3 Timeline editing

- Multi-track timeline: video, overlay, audio, text, sticker, effect, filter and adjustment lanes. [desktop][mobile][web] [C][S33a], [T][S5][S11]
- Trim by dragging clip edges (non-destructive). [desktop][mobile][web] [T][S9][S10]
- Split at playhead. [desktop][mobile][web] [C][S1], [T][S9]
- Split all tracks at playhead. [desktop] [C][S2]
- Split mode (click to cut) vs Select mode. [desktop] [C][S2], [T][S5]
- Delete left / Delete right of playhead. [desktop] [C][S1][S2]
- Delete clip. [desktop][mobile][web] [C][S1], [T][S9]
- Select all clips to the left / to the right of the playhead. [desktop] [T][S5], [C][S2]
- Duplicate clip. [mobile] [T][S7]; desktop copy/paste UNVERIFIED
- Replace clip (keeps edits). [mobile] [T][S7][S36b]; desktop UNVERIFIED
- Reorder clips (drag; long-press drag on mobile). [desktop][mobile] [T][S9]
- Reverse clip. [desktop][mobile][web] [C][S1][S24f], [T][S7]
- Freeze frame (inserts a still clip at the playhead; adjustable duration). [desktop][mobile] [C][S1], [T][S10]
- Crop clip (with ratio options). [desktop][mobile][web] [C][S1], [T][S10]
- Rotate 90 degrees; free rotation by value/knob. [desktop][mobile] [C][S1], [T][S10]
- Mirror / flip. [desktop][mobile][web] [C][S1][S24f], [T][S10]
- Transform: position, scale (uniform), in panel and by direct manipulation in the player. [desktop][mobile][web] [C][S1], [T][S10][S32]
- Main track magnet (ripple: gaps close automatically on the main track; toggle). [desktop] [C][S2]
- Auto snapping (clips snap to edges/playhead; toggle). [desktop][web] [C][S2], [T][S32]
- Linkage (keeps main-track clips and attached overlay/text/audio moving together; toggle). [desktop] [C][S2]; exact semantics [T][S34]
- Preview axis (hover scrub line in the timeline; toggle). [desktop] [C][S2]
- Link/unlink video and its audio ("Link" in the mobile edit strip). [mobile] [T][S7]
- Group / ungroup clips. [desktop] [C][S2]
- Compound clip (create / undo). [desktop] [C][S2], [T][S5]
- Activate / deactivate (disable) a clip. [desktop] [T][S3]
- Markers: add, add with new colour, edit, jump next/previous. [desktop] [C][S1], [T][S3][S34]
- In/out range for partial export. [desktop] [C][S2]
- Overlay / picture-in-picture tracks (multiple). [desktop][mobile][web] [C][S33a], [T][S11]
- Move clip between main track and overlay ("Layer & Main Track"). [mobile] [T][S36a]
- Track hide / lock / mute. [desktop] [T][S5][S34]
- Timeline zoom in/out, zoom to fit. [desktop][mobile] [C][S2], [T][S9]
- Jump to previous/next cut point; frame step; multi-frame step. [desktop] [C][S2]
- JKL shuttle playback. [desktop] [C][S2]
- Undo / redo. [desktop][mobile][web] [T][S10][S34]
- Split scenes (automatic scene detection cuts). [desktop][web] [T][S5], [C][S24g]
- Transcript-based editing (edit video by deleting text). [desktop][mobile][web] [C][S18c], [T][S35a][S36d]
- Remove filler words / pauses automatically. [desktop][mobile] [C][S24b], [T][S34][S36d]
- Multi-camera editing. UNVERIFIED

### 2.4 Speed

- Normal (constant) speed, 0.1x to 100x. [desktop][mobile] [C][S27], [T][S9][S10]
- Duration field tied to speed. [desktop] [T][S27b]; UNVERIFIED in detail
- Pitch option on speed change (keep or change pitch). [desktop][mobile] [T][S10]
- Speed curve presets: Montage, Hero (Hero time), Bullet, Jump Cut, Flash In, Flash Out. [desktop][mobile][web] [C][S1][S14]
- Custom speed curve: drag nodes (0.1x to 10x per node), add point, reset. [desktop][mobile] [C][S14], [T][S10][S27b]
- Velocity effects: speed patterns synced to music beats (music source, beat, speed options). [desktop][mobile] [T][S10]
- Smooth slow-mo by optical flow. [mobile] [C][S27]; desktop option and the "frame blending" alternative UNVERIFIED
- Optical flow at export (match frame rate for smoother playback). [mobile] [T][S19f]
- Audio speed and pitch control. [web] [C][S18c]

### 2.5 Animation and keyframes

- Clip animations with category tabs and a duration/strength slider. [desktop][mobile][web] [T][S10][S32]
- Animation groups for video clips: In, Out, and a third group (Combo). [desktop][mobile] In/Out [T][S21d]; "Combo" label UNVERIFIED
- Keyframes on position, scale, rotation, opacity (diamond icon per property; auto-keyframe on change). [desktop][mobile][web] [C][S22a][S27]
- Keyframes on other parameters (mask, filter/adjust, volume, effects: "available for all settings"). [mobile] [C][S27], [T][S22d]; per-property coverage on desktop/web UNVERIFIED
- Keyframe panel show/hide; add keyframe in panel. [desktop] [T][S3]
- Keyframe easing presets: In (Ease In, Quad In, Cubic In), Out (Ease Out, Quad Out, Cubic Out), Ease (four variants). [desktop] [T][S22b][S22c]
- Keyframe graph editor with bezier handles ("Show keyframe animation"). [desktop] [T][S22b], [C][S22a]
- Previous/next keyframe navigation, delete keyframe. UNVERIFIED (shortcut bindings not found)
- AI movement / camera-motion styles (zoom, shake, soft, dynamic). [desktop][mobile] [C][S1][S12][S24a]
- Motion blur. [mobile] [T][S7]

### 2.6 Transitions

- Add a transition between two adjacent clips (mobile: tap the white square; desktop/web: drag from the Transitions tab). [desktop][mobile][web] [T][S9][S10], [C][S25a]
- Categories: Trending, Basic, Camera, Overlay, Light Effect, Split, Distortion, Glitch, Blur, Social Media, Slide, MG, Mask. [C][S25a][S25b]
- Transition duration control. [desktop][mobile] [T][S9][S10]
- Search transitions. [desktop][mobile] [T][S10]
- Apply to all cuts. UNVERIFIED
- Audio transitions (crossfade as a transition object). UNVERIFIED

### 2.7 Video effects and body effects

- Video effects library by category (trending, nature, spark, love, lens, retro, distortion; grain, glitch, blur, light leak). [desktop][mobile][web] [C][S1], [T][S9]
- Body effects (person-tracked effects). [desktop][mobile] [C][S1], [T][S9]
- Photo effects. [mobile] [T][S7]
- AI effects / Style effects. [mobile] [T][S7][S10]
- Effect applied to one clip, or as its own timeline segment affecting everything beneath it. [desktop][mobile] [T][S11b][S9]
- Effect parameter sliders. [desktop][mobile] [T][S10]
- Effect search. [desktop][mobile] [T][S10]
- Stacking multiple effects on one clip. UNVERIFIED

### 2.8 Filters

- Filter library by category (Movie, Night scene, Portrait, Retro, Mono, Style, Food, Film, Vintage...). [desktop][mobile][web] [C][S1][S15d], [T][S9]
- Filter intensity slider. [desktop][mobile] [C][S15d], [T][S9]
- Filter as its own timeline segment vs applied to a clip; remove filter from a clip. [desktop] [T][S10]
- Apply filter to all. UNVERIFIED

### 2.9 Adjustment (colour)

- Basic: brightness, contrast, saturation, sharpness, highlights, shadows. [desktop][mobile] [T][S9][S10], [C][S15a]
- Basic: temperature, hue/tint. [desktop] [C][S15e]
- Basic: exposure, vibrance, fade, vignette, grain, clarity. UNVERIFIED
- Auto adjust (one-click colour correction). [desktop] [C][S15d]
- HSL: per-colour hue, saturation, lightness over seven colour channels. [desktop] [C][S1][S15d]
- Curves. [desktop] [C][S1][S15a]
- Colour wheels (shadows / midtones / highlights). [desktop] [C][S15a]
- LUT: import .cube / .3dl, apply, adjust. [desktop] [C][S15c]
- Colour match between clips. [desktop] [C][S15f][S15g]
- Save adjustment as preset. [C][S15f]
- Adjustment layer (adjustment as a timeline segment). [desktop] [T][S7]; behaviour UNVERIFIED
- AI colour correction. [desktop] [C][S15e]
- Video quality / enhance tools ("Video quality" tab, "Enhance visual"). [desktop][mobile] [T][S5][S21c]
- HSL, curves, colour wheels on mobile/web. UNVERIFIED (CapCut's own article points mobile users to desktop for "a broader range of options" [C][S15d])
- Scopes (waveform, vectorscope, histogram). UNVERIFIED

### 2.10 Masks

- Mask shapes: Split (linear), Filmstrip, Circle, Rectangle, Heart, Star; also listed as Horizontal and Mirror. [desktop][mobile][web] [C][S16a], [T][S16b][S16c][S16d]
- A third-party tutorial says the desktop build offers nine mask types in total. [T][S16c]; the remaining names UNVERIFIED
- Mask controls: position, size, rotation, feather, invert. [desktop][mobile][web] [C][S16a], [T][S16d]
- Rectangle mask corner radius. [desktop] [T][S16c]
- Keyframe-animated masks. [mobile] [T][S16d]
- Draw / pen custom mask. [T][S16b] (table says "Draw masking: yes"); UNVERIFIED in a CapCut source
- Text mask, mask stroke. UNVERIFIED

### 2.11 Blend modes and opacity

- Opacity slider per clip. [desktop][mobile][web] [T][S7][S32], [C][S22a]
- Blend modes on overlays; Overlay, Screen, Multiply confirmed by name. [desktop][mobile][web] [C][S1][S33b], [T][S32]
- Full blend-mode list (Darken, Lighten, Color burn, Color dodge, Soft light, Hard light, Linear burn, etc.). UNVERIFIED

### 2.12 Chroma key

- Chroma key: pick a colour and key it out. [desktop][mobile][web] [C][S1][S12][S27], [T][S32]
- Chroma key parameters (colour picker, intensity/strength, shadow, edge). UNVERIFIED (control names not found)

### 2.13 Cutout / background removal

- Auto cutout / Auto removal (AI person segmentation on video). [desktop][mobile][web] [C][S1][S12], [T][S32]
- Custom removal with Smart brush, Smart eraser, Simple eraser. [desktop] [C][S30a]
- Custom removal on mobile. [mobile] [C][S12]
- Cutout stroke/outline styles. UNVERIFIED
- Replace background after removal (colour, image, video). [C][S30b]
- AI Remove (erase objects from video). [C][S24h] (platform not stated); UNVERIFIED on desktop/mobile
- AI text remover. [web] [C][S24g]

### 2.14 Stabilisation and cleanup

- Stabilize checkbox/tool. [desktop][mobile] [C][S1][S27], [T][S7]
- Stabilisation levels (stronger level = more crop). [T][S19b]; level names UNVERIFIED
- Remove video flicker. [desktop] [C][S1]
- Reduce image noise / enhance / upscale. UNVERIFIED as a timeline tool (web "Image Enhancer" exists for photos [C][S24i])

### 2.15 Retouch / beauty

- Face retouch: smooth skin, brighten skin, skin tone, remove dark circles, smile lines, whiten teeth, blemish removal. [desktop][mobile][web] [C][S23a][S23c]
- Makeup presets. [desktop] [C][S23b][S23c]
- Reshape face features; slim cheeks. [desktop] [C][S23a][S23b]
- Body reshape. [desktop] [C][S23b]
- Multi-face detection; one-click Auto Styles. [C][S23c]
- Relight. [desktop][mobile] [C][S1], [T][S7]
- AI eye contact. [mobile] [T][S36a]

### 2.16 Text

- Add text with font, size, colour. [desktop][mobile][web] [C][S26b], [T][S9]
- Font library; import local fonts. [mobile] [C][S27]; desktop import UNVERIFIED
- Text style: background fill. [mobile] [T][S9]
- Text style: shadow. [mobile] [T][S11]
- Text style: stroke/outline, glow, curve, spacing, alignment, bold/italic/underline. UNVERIFIED
- Text effects (WordArt-style presets). [desktop][mobile] [C][S1], [T][S11]
- Text bubbles. [mobile] [T][S11]
- Text templates (pre-animated, editable). [desktop][mobile] [C][S26b][S27]
- Text animations: In, Out, Loop, with duration slider (named examples: Typewriter, Inhale, Wipe Right, Writing). [desktop][web] [C][S26a][S26b][S26c]; mobile [T][S9]
- Keyframe text position/scale/opacity. [desktop] [C][S26b]
- Text-to-speech from a text clip, multiple languages and voices, pace/tone/speed. [desktop][mobile][web] [C][S1][S12][S27]
- Text tracking (attach text to a moving subject). UNVERIFIED (motion tracking is confirmed for video layers only)
- AI text templates / AI-generated text styles. [C][S24h]
- Draw (freehand) tool. [mobile] [T][S36d]

### 2.17 Stickers

- Sticker library with categories and search. [desktop][mobile][web] [C][S1], [T][S10]
- Static and animated stickers. [C][S1]
- AI-generated stickers from a prompt. [desktop] [C][S1]
- Use a photo from the device as a sticker. [mobile] [T][S10]
- Sticker transform (move, scale, rotate), timing by timeline segment. [desktop][mobile] [T][S10]
- Sticker animation and tracking. UNVERIFIED
- Shapes / "Elements" tab. [web] [C][S13]

### 2.18 Captions and lyrics

- Auto captions from speech; choose spoken language; 20+ languages. [desktop][mobile][web] [C][S17a][S17b]
- Choose caption source (video, audio clip, voiceover). [mobile] [T][S10]
- Bilingual captions (second, translated language line). [desktop][mobile] [C][S17a][S17c]
- Caption templates / styles applied to all captions. [desktop][mobile] [T][S9][S10]
- Edit caption text and timing per segment. [desktop][mobile] [T][S9]
- Auto lyrics. [desktop] [C][S17e]
- Export captions as SRT or TXT (uncheck video to export captions only). [desktop] [C][S17b][S17c][S17d]
- Import SRT/caption file. UNVERIFIED
- Transcript panel generated from the timeline toolbar; captions from transcript. [desktop] [T][S10]
- Video translation / translated captions. [desktop][mobile] [C][S17c], [T][S36a]
- Word-level highlight (karaoke) caption animation. UNVERIFIED

### 2.19 Audio

- Music library by genre/mood. [desktop][mobile][web] [C][S1], [T][S9][S32]
- Sound effects library by category. [desktop][mobile] [C][S1], [T][S9]
- Import own audio from device. [desktop][mobile] [T][S9]
- Extract audio from a video clip (separate / restore). [desktop][mobile][web] [C][S18a], [T][S10]
- Voiceover recording into the timeline. [desktop][mobile][web] [C][S1], [T][S9][S32]
- Voiceover options: Voice enhancer while recording; "Mute project" while recording. [desktop] [T][S10]
- Volume per clip. [desktop][mobile][web] [T][S10][S32]
- Volume nudge +/-0.1 dB. [desktop] [C][S2]
- Fade in / fade out. [desktop][mobile][web] [C][S1][S18a], [T][S32]
- Mute clip / mute track. [desktop][web] [T][S5][S32]
- Noise reduction. [desktop][mobile][web] [C][S1][S18a][S18d]
- Enhance voice (strength slider). [desktop][mobile] [C][S1][S12]
- Vocal isolation (keep or remove vocals). [desktop][mobile] [C][S1][S18b], [T][S7]
- Voice changer / voice effects (e.g. Vinyl, Synth, Electronic, echo, deep, tremble). [desktop][mobile][web] [C][S1][S18e], [T][S32]
- Loudness normalization ("Loudness adjustment" on mobile). [desktop][mobile] [C][S1], [T][S10]
- Beat detection: manual beat markers. [desktop][mobile] [T][S29a][S29b]
- Beat detection: automatic ("Mark beats" on desktop; "Auto generate" with Light-to-Intense slider on mobile). [desktop][mobile] [T][S29a][S29b], [C][S18a]
- Audio speed and pitch. [web] [C][S18c]
- Copyright check for music. [desktop][web] [C][S1][S19e]; mobile "Copyright" tab [T][S36b]
- Audio keyframes (volume automation). [C][S1] ("video and audio properties"); UI UNVERIFIED
- Audio waveform on clips. UNVERIFIED (assumed)
- Equaliser, compressor, audio ducking. UNVERIFIED
- AI lip sync. [C][S24a]

### 2.20 Templates

- Template gallery with categories and search. [mobile][web] [T][S9][S32], [C][S24a]
- Use template: fill placeholder slots with own media, preview, export. [mobile] [T][S9]
- Edit template text/audio and per-slot media with the edit strip. [mobile] [T][S36e]
- Templates lock structure (fonts, timings, effects). [mobile] [T][S9]
- Templates on desktop. [desktop] [T][S10]
- Publish own project as a template. UNVERIFIED
- Brand kit (logos, fonts, colours). [web] [C][S13]

### 2.21 AI tools

- Script to video (AI Writer drafts a script; "Smart generation" builds a video with subtitles, voiceover, music). [desktop] [C][S24b][S24h]
- AI video maker (topic or script, aspect ratio, style, per-scene editing, avatars, voice, music). [desktop][web] [C][S24c][S24e]
- AI video generation models (text/image to video; Seedance, Veo, Kling, PixVerse are named). [desktop][web] [C][S24a][S24c]
- AI image generator; image-to-image. [web] [C][S24a][S24i]
- AI avatars / AI character (lip-synced presenter). [desktop][web] [C][S24c][S24h]
- Long video to shorts (highlight detection, duration choice, captions, 20+ languages). [desktop][web] [C][S24g][S24h]
- Auto reframe (keep subject centred for another ratio; stabilisation and camera speed options). [desktop][mobile] [C][S1][S12]
- Auto Cut (beat sync, speech-pause detection, script-based). [desktop][mobile] [C][S24d]; explicitly **not** on web
- Camera tracking / motion tracking. [desktop][mobile] [C][S1][S12]
- AI movement. [desktop][mobile] [C][S1][S12]
- Relight. [desktop][mobile] [C][S1], [T][S7]
- AI expand (outpaint the frame). [mobile] [T][S7]
- AI Remove (object removal). UNVERIFIED on a named platform; "object removal" claimed generally [C][S24j]
- Remove filler words. [desktop] [C][S24b]
- Smart Search. [desktop] [C][S24b]
- AI stickers. [desktop] [C][S1]
- AI lip sync. [C][S24a]
- AI voiceover / text to speech. [desktop][mobile][web] [C][S24c][S12]
- AI dialogue scene (multi-character from a photo). [C][S24k]
- Teleprompter, AI poster, product photos. UNVERIFIED as editor features (AI product photography exists as a web tool [C][S24l])

### 2.22 Export

- Export button top right; export dialog. [desktop][mobile][web] [C][S1], [T][S9]
- File name / title and save location. [desktop] [C][S1]
- Resolution: 480p, 720p, 1080p, 2K, 4K. [desktop][mobile][web] [C][S19e], [T][S19d][S19f]; availability depends on platform/device/source [T][S19c]
- Frame rate: 24, 25, 30, 50, 60 fps. [desktop][mobile][web] [C][S19e], [T][S19a][S19c]
- Bit rate: Lower, Recommended, Higher, Custom ("Code rate" on mobile). [desktop][mobile][web] [C][S19g][S19e], [T][S19a][S19d]
- Codec: H.264, HEVC (H.265). [desktop][mobile] [T][S19a][S19b]
- Container: MP4, MOV. [desktop][web] [C][S1][S19e]
- Colour space SDR (Rec.709) / HDR. [desktop] [T][S19a][S19c][S19b]; mobile "Smart HDR" toggle [T][S19h]
- Estimated file size shown. [mobile] [T][S19d]
- Audio-only export: MP3, WAV, AAC, FLAC ("Export audio" checkbox). [desktop] [C][S1], [T][S19a]
- GIF export ("Export GIF" option on desktop; "Download GIF" 240P to 640P with duration on web). [desktop][web] [C][S28a][S28b]; mobile [C][S28c]
- Caption file export SRT / TXT. [desktop] [C][S17b]
- Export only the in/out range. [desktop] [C][S2]
- Still-frame export. [desktop][mobile] [T][S19c]
- Cover editing at export. [desktop] [C][S1]
- Copyright check before export. [desktop][web] [C][S1][S19e]
- Share targets after export: TikTok, YouTube (desktop); TikTok, Instagram, YouTube, WhatsApp, Facebook (mobile); Facebook, YouTube, Instagram, TikTok (web). [desktop][mobile][web] [C][S1][S20c][S27], [T][S9]
- TikTok share options: title, visibility, allow comments/duets/stitches. [desktop] [C][S1]
- Share as review link (comments) or as presentation. [web] [C][S20a][S25c]
- Transparent-background (alpha) video export, ProRes. UNVERIFIED
- Batch export. UNVERIFIED
- Watermark: none on from-scratch projects per third-party sources; template branding may remain. [T][S9]

### 2.23 Cloud, sync, collaboration

- Cloud space storage with sections Drafts, Exported files, Materials, Trash. [web] [C][S20d]
- Free storage quota and number of spaces (an older CapCut article says 15 GB and up to 3 spaces; treat as out of date). [C][S20d]; current quota UNVERIFIED
- Upload a draft to the cloud and open it on another device. [desktop][mobile][web] [C][S20a][S20e]
- Link mobile and PC accounts by QR-code login to sync projects. [desktop][mobile] [C][S20e]
- Team Space: invite members by link or email. [web] [C][S20c]
- Roles: Admin (manage all files) and Collaborator (manage own files). [web] [C][S20c]
- Single-editor lock: "Transfer editing permission" hands the draft to another member; others are view-only. No simultaneous co-editing. [web] [C][S20a][S20c]
- Share finished video for review and comments. [web] [C][S20a]
- Team settings are managed only on web; desktop and mobile can use team projects but cannot configure them. [desktop][mobile][web] [C][S20b]
- Auto-sync images from Google Drive / Dropbox into a space. [web] [C][S20d]

### 2.24 Keyboard shortcuts (desktop defaults)

Confirmed against CapCut's own shortcut tutorial video [C][S2] unless marked. Windows uses Ctrl where macOS uses Cmd, and Alt where macOS uses Option. Rows marked [T] come from a community transcription of the in-app shortcut sheet [S3][S4].

| Action | Windows | macOS | Evidence |
|---|---|---|---|
| New project | Ctrl+N | Cmd+N | [C][S2] |
| Import media | Ctrl+I | Cmd+I | [C][S2] |
| Fullscreen (app) | UNVERIFIED | Cmd+Ctrl+F; Esc to exit | [C][S2] |
| Split | Ctrl+B | Cmd+B | [C][S2] |
| Split all tracks | Ctrl+Shift+B | Cmd+Shift+B | [C][S2] |
| Split mode | B | B | [C][S2] |
| Select mode | A | A | [C][S2] |
| Delete left of playhead | Q | Q | [C][S2] |
| Delete right of playhead | W | W | [C][S2] |
| Delete selected | Delete / Backspace | Delete | [T][S34] |
| Select previous / next clip | [ / ] | [ / ] | [C][S2] ([S3] labels them "Select to the left/right") |
| Shuttle left / stop / right | J / K / L | J / K / L | [C][S2] |
| Play / pause | Space | Space | [C][S2] |
| Main track magnet toggle | P | P | [C][S2] |
| Auto snapping toggle | N | N | [C][S2] |
| Linkage toggle | ~ | ~ | [C][S2] |
| Preview axis toggle | S | S | [C][S2] |
| Extract / restore audio | Ctrl+Shift+S | Cmd+Shift+S | [C][S2], [T][S10] |
| Previous / next frame | Left / Right | Left / Right | [C][S2] |
| Step several frames back / forward | Shift+Left / Shift+Right | same | [C][S2] ([S3] has the two labels swapped) |
| Previous / next cut point | Up / Down | Up / Down | [C][S2] |
| First / last frame | Home / End | Home / End | [T][S3] |
| Select by clip (range) | Shift+X | Shift+X | [C][S2] |
| Deselect | Alt+X | Option+X | [C][S2] |
| Group / ungroup | Ctrl+G / Ctrl+Shift+G | Cmd+G / Cmd+Shift+G | [C][S2] |
| Show speed panel | Ctrl+R | Cmd+R (UNVERIFIED on Mac) | [C][S2], [T][S3] |
| Curve speed | Shift+B | Shift+B | [C][S2] |
| Create / undo compound clip | Alt+G / Alt+Shift+G | Option+G / Option+Shift+G | [C][S2] |
| Volume +0.1 dB / -0.1 dB | Ctrl+. / Ctrl+, | Cmd+. / Cmd+, | [C][S2] |
| Zoom timeline to fit | Shift+Z | Shift+Z | [C][S2] |
| Timeline zoom in / out | Ctrl++ / Ctrl+- ; Ctrl+scroll | Cmd equivalents | [T][S3] |
| Timeline scroll left/right | Alt+scroll | Option+scroll | [T][S3] |
| In point / out point | I / O | I / O | [C][S2] |
| Add marker | M | M | [T][S3] |
| Add marker with new colour | Alt+M | Option+M | [T][S3] |
| Next / previous marker | Shift+M / Alt+Shift+M | same with Option | [T][S3] |
| Activate / deactivate clip | V | V | [T][S3] |
| Show / hide keyframe panel | Alt+K | Option+K | [T][S3] |
| Add keyframe in keyframe panel | Shift+click | Shift+click | [T][S3] |
| Player fullscreen | Ctrl+Shift+F | Cmd+Shift+F | [C][S2] |
| Player zoom in / out | Alt+Shift++ / Alt+Shift+- | Option+Shift++ / - | [C][S2] |
| Player zoom to fit | Alt+Shift+Z | Option+Shift+Z | [C][S2] |
| Cancel player alignment (snap) | hold Ctrl | hold Cmd | [C][S2] |
| Undo / redo | Ctrl+Z / Ctrl+Y | UNVERIFIED on Mac | [T][S34] |
| Copy / cut / paste, select all, save, export, duplicate | UNVERIFIED | UNVERIFIED | one site lists the actions with blank bindings [S3b]; another lists Ctrl+O, Ctrl+S, and Ctrl+Shift+S as "Save As", which conflicts with the confirmed Extract-audio binding [S3c] |

**Shortcut customisation** [C][S2], [T][S21e]: a Shortcuts button in the top bar opens a dialog with five preset slots and four tabs (Timeline, Player, Basic, Other). Click a binding and press a new combination to rebind; reset per tab or per preset.

### 2.25 Settings (desktop)

- Global settings dialog with tabs Draft (also called Project), Edit, Performance, Language. [desktop] [T][S21a][S21c]
- Draft/project save location. [desktop] [T][S21a][S21c]
- Default image duration, default frame rate, timecode and similar editing defaults (Edit tab). [desktop] [T][S21a] (chapter exists); individual options UNVERIFIED
- Notification/sound when export completes. [desktop] [T][S21a]
- Hardware acceleration: speed up hardware encoding, speed up hardware decoding, render interface with GPU. [desktop] [T][S21a][S21b]
- Proxy: on/off, proxy resolution 720p or 540p (also in per-project Performance tab). [desktop] [T][S21a][S21b]
- Proxy/cache size and cache clearing. [desktop] [T][S21b][S21f]
- Player preview quality / play speed. [desktop] [T][S21b]
- Free layer (overlap clips freely on the main track). UNVERIFIED
- UI language. [desktop] [T][S21a]
- Auto-save interval. UNVERIFIED
- Mobile settings: disable the ending card. [mobile] [T][S9]

---

## 3. OpenCut classic gap

Basis for the "OpenCut classic" column: the summary supplied with this research task ("one blur effect only; no transitions, filters, colour adjustment, crop/flip, chroma key, text stroke/shadow, speed curves, reverse, freeze frame, audio fades, templates; export only MP4/WebM at project resolution").

**Path note**: the file `docs/research/opencut-classic-inventory.md` named in the task did not exist when this was written. The only OpenCut file in `docs/research/` was `opencut-inventory.md`, which covers the *rewrite* clone (a skeleton) plus CHANGELOG-ONLY claims about classic. Those changelog claims are used below as hints and are labelled "changelog"; they are unverified against code. Every "to verify" cell should be resolved against the classic inventory once it exists.

| CapCut feature group | OpenCut classic | Gap |
|---|---|---|
| Project list, create, auto-save | to verify against docs/research/opencut-classic-inventory.md (changelog: project thumbnails, persistent storage) | likely small |
| Canvas ratio presets, custom size | changelog: presets + custom width/height; to verify | likely small |
| Canvas background (colour, blur, image) | changelog: blur, solid colour, gradient; image background to verify | partial |
| Cover editor | to verify; not mentioned anywhere | full gap likely |
| Media import (local, drag-drop, paste) | changelog: clipboard paste, grid cards, multi-select; to verify | small |
| Stock video / music / SFX libraries | to verify; not mentioned | full gap likely |
| Cloud/Drive/Dropbox/QR import | to verify; not mentioned | full gap likely |
| Split, trim, delete, multi-track | to verify (changelog: trim handles, ripple mode, multi-select move/resize) | small |
| Duplicate, replace clip | to verify | unknown |
| Reverse | **No** (task summary) | full gap |
| Freeze frame | **No** (task summary) | full gap |
| Crop, flip/mirror | **No** (task summary) | full gap |
| Rotate, position, scale | changelog: yes, in panel and in preview; to verify | none/small |
| Main track magnet (ripple), snapping | changelog: ripple editing mode, snap guides, Shift disables snapping; to verify | small |
| Linkage, preview axis | to verify; not mentioned | gap likely |
| Group, compound clip | to verify; not mentioned | gap likely |
| Markers | changelog: bookmarks with notes, colours, duration; to verify | small |
| Overlay / PIP tracks | changelog: overlay + main + audio scene tracks; to verify | small |
| Track lock / hide / mute | to verify (inventory says "status unknown") | unknown |
| Speed: normal + pitch | changelog: speed with maintain-pitch; to verify | none/small |
| Speed curves, velocity, smooth slow-mo | **No** (task summary: no speed curves) | full gap |
| Clip animations (in/out/combo presets) | to verify; not mentioned | gap likely |
| Keyframes + graph editor | changelog: keyframes, bezier graph editor, copy/paste keyframes; to verify | none/small |
| Transitions | **No** (task summary) | full gap |
| Video effects library | **Blur only** (task summary) | near-full gap |
| Body effects | **No** (blur only) | full gap |
| Filters | **No** (task summary) | full gap |
| Adjustment: basic, HSL, curves, wheels, LUT | **No** (task summary) | full gap |
| Masks | changelog: split, rectangle, ellipse, star, heart, diamond, cinematic bars with feather and stroke; to verify | small (filmstrip = cinematic bars; invert to verify) |
| Blend modes + opacity | changelog: Multiply, Screen, Overlay "etc."; to verify | small |
| Chroma key | **No** (task summary) | full gap |
| Cutout / background removal | to verify; not mentioned | full gap likely |
| Stabilisation, flicker removal | to verify; not mentioned | full gap likely |
| Retouch / beauty, relight | to verify; not mentioned | full gap likely |
| Text: fonts, size, colour, background, spacing | changelog: 1,000+ fonts, system fonts, line height, letter spacing, background; to verify | small |
| Text stroke / shadow | **No** (task summary) | full gap |
| Text effects, bubbles, templates, animations | to verify; not mentioned | gap likely |
| Text-to-speech | to verify; not mentioned | full gap likely |
| Tracking (motion/camera/text) | to verify; not mentioned | full gap likely |
| Stickers | changelog: country flags and shapes only; to verify | large |
| Auto captions | changelog: yes, plus transcript-file import; to verify | small |
| Bilingual captions, lyrics, SRT/TXT export, caption templates | to verify; not mentioned | gap likely |
| Audio: volume, waveform | changelog: yes; to verify | none |
| Audio fades | **No** (task summary) | full gap |
| Extract audio, voiceover recording | to verify (inventory: "audio separation ... status unknown") | unknown |
| Noise reduction, enhance voice, vocal isolation, voice changer, normalisation | to verify; not mentioned | full gap likely |
| Beat detection / beat markers | to verify; not mentioned | full gap likely |
| Templates | **No** (task summary) | full gap |
| AI tools (script-to-video, long-to-shorts, avatars, generation, reframe, remove, relight) | to verify; changelog mentions auto transcription only | full gap likely |
| Export: resolution choice | **No**: project resolution only (task summary) | full gap |
| Export: frame rate, bitrate, codec choice | to verify (inventory: "export settings ... status unknown") | gap likely |
| Export: MP4 | **Yes** (task summary) | none |
| Export: MOV | **No** (MP4/WebM only) | gap |
| Export: WebM | **Yes** (task summary); CapCut does not offer WebM in any source found | OpenCut extra |
| Export: GIF, audio-only, captions file, cover | to verify; task summary implies no | gap likely |
| Share targets | to verify; not mentioned | gap likely |
| Cloud space, cross-device sync, team spaces | to verify; not mentioned (classic has db/migrations dirs) | gap likely |
| Keyboard shortcuts + rebinding | to verify (inventory: full default list UNVERIFIED) | unknown |
| Settings: proxy, hardware acceleration, cache, language | to verify; not mentioned | gap likely |
| Mobile editor UI (bottom toolbar + sub-toolbars) | to verify; classic is a web app | full gap likely |

---

## 4. CAPCUT-PARITY-CHECKLIST

Flat list, one feature per line. Platform tags show where a source confirmed the feature (missing tag = not confirmed, see section 0). `UNVERIFIED` at the end of a line means no source confirmed the feature at all.

### Project and canvas
- CC-001 Create new blank project [desktop] [mobile] [web]
- CC-002 Project/draft list with reopen [desktop] [mobile] [web]
- CC-003 Auto-save drafts [mobile] [web]
- CC-004 Rename / delete project [web]
- CC-005 Project settings: name, save path, ratio, resolution, frame rate [desktop]
- CC-006 Aspect-ratio presets (9:16, 16:9, 1:1, 4:5) [desktop] [mobile] [web]
- CC-007 Extended ratio presets (4:3, 3:4, 2:1, 2.35:1, 1.85:1, custom) UNVERIFIED
- CC-008 Canvas background: solid colour
- CC-009 Canvas background: blur
- CC-010 Canvas background: image
- CC-011 Apply background to all clips UNVERIFIED
- CC-012 Edit cover at export [desktop]
- CC-013 Cover editor (frame pick, upload, cover text/template) UNVERIFIED
- CC-014 Remove/disable auto ending clip [mobile]

### Media import and library
- CC-015 Import local video/image/audio [desktop] [web]
- CC-016 Drag-and-drop import [desktop] [web]
- CC-017 Camera-roll picker with ordered multi-select [mobile]
- CC-018 Add clip from timeline "+" [mobile]
- CC-019 Stock video library with categories [desktop] [web]
- CC-020 AI materials in library [desktop]
- CC-021 Import from cloud Space [desktop] [web]
- CC-022 Import from Google Drive / Dropbox [web]
- CC-023 Import from phone by QR scan [web]
- CC-024 Smart Search in media (objects, speech, people) [desktop]
- CC-025 Paste media from clipboard UNVERIFIED
- CC-026 Screen/webcam recording UNVERIFIED

### Timeline editing
- CC-027 Multi-track timeline (video, overlay, audio, text, sticker, effect lanes) [desktop] [mobile] [web]
- CC-028 Trim by edge drag, non-destructive [desktop] [mobile] [web]
- CC-029 Split at playhead [desktop] [mobile] [web]
- CC-030 Split all tracks [desktop]
- CC-031 Split (blade) mode vs select mode [desktop]
- CC-032 Delete left of playhead [desktop]
- CC-033 Delete right of playhead [desktop]
- CC-034 Delete clip [desktop] [mobile] [web]
- CC-035 Select all left / all right of playhead [desktop]
- CC-036 Duplicate clip [mobile]
- CC-037 Replace clip [mobile]
- CC-038 Reorder clips by drag [desktop] [mobile]
- CC-039 Reverse clip [desktop] [mobile] [web]
- CC-040 Freeze frame [desktop] [mobile]
- CC-041 Crop clip [desktop] [mobile] [web]
- CC-042 Rotate 90 degrees [desktop] [mobile]
- CC-043 Free rotation by value [desktop] [mobile]
- CC-044 Mirror / flip [desktop] [mobile] [web]
- CC-045 Position and scale in panel [desktop] [mobile] [web]
- CC-046 Direct manipulation in player (drag, pinch, rotate) [desktop] [mobile] [web]
- CC-047 Main track magnet toggle [desktop]
- CC-048 Auto snapping toggle [desktop] [web]
- CC-049 Linkage toggle [desktop]
- CC-050 Preview axis toggle [desktop]
- CC-051 Link/unlink clip audio [mobile]
- CC-052 Group / ungroup [desktop]
- CC-053 Compound clip create / undo [desktop]
- CC-054 Activate / deactivate clip [desktop]
- CC-055 Markers: add, colour, edit [desktop]
- CC-056 Marker navigation next/previous [desktop]
- CC-057 In/out range selection [desktop]
- CC-058 Overlay / PIP tracks [desktop] [mobile] [web]
- CC-059 Move clip between main track and overlay [mobile]
- CC-060 Track hide [desktop]
- CC-061 Track lock [desktop]
- CC-062 Track mute [desktop]
- CC-063 Timeline zoom in/out [desktop] [mobile]
- CC-064 Zoom timeline to fit [desktop]
- CC-065 Jump to previous/next cut point [desktop]
- CC-066 Frame step and multi-frame step [desktop]
- CC-067 JKL shuttle [desktop]
- CC-068 Undo / redo [desktop] [mobile] [web]
- CC-069 Split scenes (auto scene detection) [desktop] [web]
- CC-070 Transcript-based editing [desktop] [mobile] [web]
- CC-071 Remove filler words/pauses [desktop] [mobile]
- CC-072 Multi-camera editing UNVERIFIED

### Speed
- CC-073 Constant speed 0.1x to 100x [desktop] [mobile]
- CC-074 Pitch keep/change on speed [desktop] [mobile]
- CC-075 Curve preset: Montage [desktop] [mobile] [web]
- CC-076 Curve preset: Hero [desktop] [mobile] [web]
- CC-077 Curve preset: Bullet [desktop] [mobile] [web]
- CC-078 Curve preset: Jump Cut [desktop] [mobile] [web]
- CC-079 Curve preset: Flash In [desktop] [mobile] [web]
- CC-080 Curve preset: Flash Out [desktop] [mobile] [web]
- CC-081 Custom speed curve with draggable/addable points [desktop] [mobile]
- CC-082 Velocity effects synced to beats [desktop] [mobile]
- CC-083 Smooth slow-mo (optical flow) [mobile]
- CC-084 Smooth slow-mo (frame blending option) UNVERIFIED
- CC-085 Optical flow at export [mobile]
- CC-086 Audio speed/pitch [web]

### Animation and keyframes
- CC-087 Clip animation: In [desktop] [mobile]
- CC-088 Clip animation: Out [desktop] [mobile]
- CC-089 Clip animation: Combo UNVERIFIED
- CC-090 Animation duration/strength slider [desktop] [mobile]
- CC-091 Keyframes: position, scale, rotation, opacity [desktop] [mobile] [web]
- CC-092 Keyframes on all settings (mask, colour, volume, effects) [mobile]
- CC-093 Keyframe panel show/hide [desktop]
- CC-094 Keyframe easing presets (Ease/Quad/Cubic In, Out; Ease variants) [desktop]
- CC-095 Keyframe graph editor with bezier handles [desktop]
- CC-096 Keyframe navigation and delete UNVERIFIED
- CC-097 AI movement / camera-motion styles [desktop] [mobile]
- CC-098 Motion blur [mobile]

### Transitions
- CC-099 Add transition between adjacent clips [desktop] [mobile] [web]
- CC-100 Transition categories (Trending, Basic, Camera, Overlay, Light Effect, Split, Distortion, Glitch, Blur, Social Media, Slide, MG, Mask)
- CC-101 Transition duration [desktop] [mobile]
- CC-102 Transition search [desktop] [mobile]
- CC-103 Apply transition to all cuts UNVERIFIED

### Effects
- CC-104 Video effects library by category [desktop] [mobile] [web]
- CC-105 Body effects [desktop] [mobile]
- CC-106 Photo effects [mobile]
- CC-107 AI / Style effects [mobile]
- CC-108 Effect on a clip [desktop] [mobile]
- CC-109 Effect as a standalone timeline segment [desktop] [mobile]
- CC-110 Effect parameter sliders [desktop] [mobile]
- CC-111 Effect search [desktop] [mobile]
- CC-112 Stack multiple effects on one clip UNVERIFIED

### Filters
- CC-113 Filter library by category [desktop] [mobile] [web]
- CC-114 Filter intensity slider [desktop] [mobile]
- CC-115 Filter as timeline segment / on clip, removable [desktop]
- CC-116 Apply filter to all UNVERIFIED

### Adjustment
- CC-117 Brightness [desktop] [mobile]
- CC-118 Contrast [desktop] [mobile]
- CC-119 Saturation [desktop] [mobile]
- CC-120 Sharpness [mobile]
- CC-121 Highlights [desktop] [mobile]
- CC-122 Shadows [desktop] [mobile]
- CC-123 Temperature [desktop]
- CC-124 Hue / tint [desktop]
- CC-125 Exposure, vibrance, fade, vignette, grain UNVERIFIED
- CC-126 Auto adjust [desktop]
- CC-127 HSL per colour channel [desktop]
- CC-128 Curves [desktop]
- CC-129 Colour wheels (shadows/midtones/highlights) [desktop]
- CC-130 LUT import (.cube, .3dl) [desktop]
- CC-131 Colour match between clips [desktop]
- CC-132 Save adjustment preset
- CC-133 Adjustment layer segment [desktop]
- CC-134 Video quality / enhance visual [desktop] [mobile]
- CC-135 Scopes (waveform/vectorscope/histogram) UNVERIFIED

### Masks
- CC-136 Mask: Split / linear [desktop] [mobile] [web]
- CC-137 Mask: Filmstrip [desktop] [web]
- CC-138 Mask: Circle [desktop] [mobile] [web]
- CC-139 Mask: Rectangle [desktop] [mobile] [web]
- CC-140 Mask: Heart [desktop] [web]
- CC-141 Mask: Star [desktop] [web]
- CC-142 Mask: Mirror
- CC-143 Mask position / size / rotation [desktop] [mobile] [web]
- CC-144 Mask feather [desktop] [mobile] [web]
- CC-145 Mask invert [desktop] [web]
- CC-146 Rectangle mask corner radius [desktop]
- CC-147 Keyframed mask [mobile]
- CC-148 Pen / drawn custom mask UNVERIFIED

### Blend, opacity, keying, cutout
- CC-149 Opacity [desktop] [mobile] [web]
- CC-150 Blend modes (Overlay, Screen, Multiply confirmed) [desktop] [mobile] [web]
- CC-151 Full blend-mode set (Darken, Lighten, Color burn/dodge, Soft/Hard light...) UNVERIFIED
- CC-152 Chroma key (pick colour) [desktop] [mobile] [web]
- CC-153 Chroma key intensity / shadow / edge controls UNVERIFIED
- CC-154 Auto cutout / auto background removal [desktop] [mobile] [web]
- CC-155 Custom removal: smart brush, smart eraser, eraser [desktop]
- CC-156 Custom removal [mobile]
- CC-157 Cutout stroke styles UNVERIFIED
- CC-158 Replace background after removal
- CC-159 AI Remove (object removal) UNVERIFIED
- CC-160 AI text remover [web]

### Stabilise and retouch
- CC-161 Stabilize [desktop] [mobile]
- CC-162 Stabilisation levels UNVERIFIED
- CC-163 Remove video flicker [desktop]
- CC-164 Face retouch: smooth, brighten, tone, dark circles, teeth, blemish [desktop] [mobile] [web]
- CC-165 Makeup presets [desktop]
- CC-166 Face reshape / slim [desktop]
- CC-167 Body reshape [desktop]
- CC-168 Multi-face detection, auto styles
- CC-169 Relight [desktop] [mobile]
- CC-170 AI eye contact [mobile]

### Text
- CC-171 Add text: font, size, colour [desktop] [mobile] [web]
- CC-172 Import local fonts [mobile]
- CC-173 Text background fill [mobile]
- CC-174 Text shadow [mobile]
- CC-175 Text stroke / glow / curve / spacing / alignment UNVERIFIED
- CC-176 Text effects presets [desktop] [mobile]
- CC-177 Text bubbles [mobile]
- CC-178 Text templates [desktop] [mobile]
- CC-179 Text animation: In [desktop] [mobile] [web]
- CC-180 Text animation: Out [desktop] [mobile] [web]
- CC-181 Text animation: Loop [desktop] [web]
- CC-182 Text keyframes [desktop]
- CC-183 Text-to-speech from text clip [desktop] [mobile] [web]
- CC-184 Text tracking UNVERIFIED
- CC-185 Draw (freehand) [mobile]

### Stickers
- CC-186 Sticker library with categories and search [desktop] [mobile] [web]
- CC-187 Animated stickers
- CC-188 AI-generated stickers [desktop]
- CC-189 Custom image as sticker [mobile]
- CC-190 Sticker transform and timing [desktop] [mobile]
- CC-191 Sticker animation / tracking UNVERIFIED
- CC-192 Elements / shapes tab [web]

### Captions
- CC-193 Auto captions with language selection [desktop] [mobile] [web]
- CC-194 Caption source selection (video / audio / voiceover) [mobile]
- CC-195 Bilingual captions [desktop] [mobile]
- CC-196 Caption templates / batch style [desktop] [mobile]
- CC-197 Edit caption text and timing [desktop] [mobile]
- CC-198 Auto lyrics [desktop]
- CC-199 Export captions SRT [desktop]
- CC-200 Export captions TXT [desktop]
- CC-201 Import caption file UNVERIFIED
- CC-202 Transcript panel [desktop] [web]
- CC-203 Video translation [desktop] [mobile]
- CC-204 Word-highlight caption animation UNVERIFIED

### Audio
- CC-205 Music library [desktop] [mobile] [web]
- CC-206 Sound effects library [desktop] [mobile]
- CC-207 Import own audio [desktop] [mobile]
- CC-208 Extract / separate audio from video [desktop] [mobile] [web]
- CC-209 Voiceover recording [desktop] [mobile] [web]
- CC-210 Voice enhancer / mute project during recording [desktop]
- CC-211 Clip volume [desktop] [mobile] [web]
- CC-212 Fade in [desktop] [mobile] [web]
- CC-213 Fade out [desktop] [mobile] [web]
- CC-214 Mute clip/track [desktop] [web]
- CC-215 Noise reduction [desktop] [mobile] [web]
- CC-216 Enhance voice [desktop] [mobile]
- CC-217 Vocal isolation [desktop] [mobile]
- CC-218 Voice changer / voice effects [desktop] [mobile] [web]
- CC-219 Loudness normalisation [desktop] [mobile]
- CC-220 Manual beat markers [desktop] [mobile]
- CC-221 Automatic beat detection [desktop] [mobile]
- CC-222 Copyright check [desktop] [mobile] [web]
- CC-223 Volume keyframes UNVERIFIED
- CC-224 EQ / compressor / ducking UNVERIFIED
- CC-225 AI lip sync

### Templates
- CC-226 Template gallery with categories and search [mobile] [web]
- CC-227 Use template: fill slots, preview, export [mobile]
- CC-228 Edit template text/audio/slots [mobile]
- CC-229 Templates on desktop [desktop]
- CC-230 Publish own template UNVERIFIED
- CC-231 Brand kit [web]

### AI tools
- CC-232 Script to video with AI Writer [desktop]
- CC-233 AI video maker (topic/script to scenes) [desktop] [web]
- CC-234 AI video generation models [desktop] [web]
- CC-235 AI image generation [web]
- CC-236 AI avatars / AI character [desktop] [web]
- CC-237 Long video to shorts [desktop] [web]
- CC-238 Auto reframe [desktop] [mobile]
- CC-239 Auto Cut (beat sync / pause detection / script) [desktop] [mobile]
- CC-240 Camera / motion tracking [desktop] [mobile]
- CC-241 AI expand [mobile]
- CC-242 AI voiceover [desktop] [mobile] [web]
- CC-243 AI dialogue scene

### Export
- CC-244 Export dialog with file name and save path [desktop]
- CC-245 Resolution 480p / 720p / 1080p / 2K / 4K [desktop] [mobile] [web]
- CC-246 Frame rate 24 / 25 / 30 / 50 / 60 [desktop] [mobile] [web]
- CC-247 Bitrate Lower / Recommended / Higher / Custom [desktop] [mobile] [web]
- CC-248 Codec H.264 [desktop] [mobile]
- CC-249 Codec HEVC [desktop] [mobile]
- CC-250 Format MP4 [desktop] [mobile] [web]
- CC-251 Format MOV [desktop] [web]
- CC-252 Colour space SDR / HDR [desktop]
- CC-253 Estimated file size [mobile]
- CC-254 Audio-only export MP3 / WAV / AAC / FLAC [desktop]
- CC-255 GIF export [desktop] [mobile] [web]
- CC-256 Export in/out range only [desktop]
- CC-257 Still-frame export [desktop] [mobile]
- CC-258 Share to TikTok [desktop] [mobile] [web]
- CC-259 Share to YouTube [desktop] [mobile] [web]
- CC-260 Share to Instagram / Facebook / WhatsApp [mobile] [web]
- CC-261 Share as review link / presentation [web]
- CC-262 Alpha / ProRes export UNVERIFIED
- CC-263 Batch export UNVERIFIED

### Cloud and collaboration
- CC-264 Cloud space (drafts, exports, materials, trash) [web]
- CC-265 Cross-device draft sync [desktop] [mobile] [web]
- CC-266 QR-code account link mobile to PC [desktop] [mobile]
- CC-267 Team space with member invite [web]
- CC-268 Roles Admin / Collaborator [web]
- CC-269 Transfer editing permission (single-editor lock) [web]
- CC-270 View-only mode for non-editors [web]
- CC-271 Review comments on shared video [web]

### Shortcuts and settings
- CC-272 Default desktop shortcut set (section 2.24) [desktop]
- CC-273 Shortcut rebinding with presets and reset [desktop]
- CC-274 Settings: draft location [desktop]
- CC-275 Settings: hardware encode/decode, GPU interface rendering [desktop]
- CC-276 Settings: proxy on/off and proxy resolution [desktop]
- CC-277 Settings: cache size / clear cache [desktop]
- CC-278 Settings: preview quality [desktop]
- CC-279 Settings: UI language [desktop]
- CC-280 Settings: free layer UNVERIFIED
- CC-281 Settings: auto-save interval UNVERIFIED

### Layout
- CC-282 Desktop four-region layout (assets, player, inspector, timeline) [desktop]
- CC-283 Desktop asset tabs (Media, Audio, Text, Stickers, Effects, Transitions, Captions, Filters, Adjustment, Templates) [desktop]
- CC-284 Desktop inspector tabs (Video, Audio, Speed, Animation, Tracking, Adjustment) [desktop]
- CC-285 Desktop timeline icon toolbar [desktop]
- CC-286 Mobile home with project grid and Templates tab [mobile]
- CC-287 Mobile context-sensitive bottom toolbar with sub-toolbars and back arrow [mobile]
- CC-288 Mobile main toolbar (Edit, Audio, Text, Stickers, Overlay, Effects, Filters, Adjust, Captions, Aspect ratio, Background, Media) [mobile]
- CC-289 Mobile per-clip edit strip [mobile]
- CC-290 Web left sidebar (Media, Templates, Elements, Audio, Text, Captions, Transcript, Effects, Transitions, Filters, Brand Kit) [web]
- CC-291 Web right sidebar (Basic, Background, Smart tools, Audio, Speed, Animation) [web]

---

## 5. Where sources were thin

1. **Mobile sub-toolbar contents** for Audio, Text and audio-clip strips: only the Edit strip has a full itemised list, and it comes from one third-party page [S7].
2. **Mobile home screen**: bottom tabs and tool tiles are unconfirmed.
3. **Web right sidebar and web feature coverage**: assembled from scattered tool pages; no single authoritative layout source. Many web tags are missing for that reason.
4. **Aspect-ratio preset list, blend-mode list, mask list beyond six shapes, stabilisation level names, chroma-key control names**: not stated in any source found.
5. **Text styling detail** (stroke, glow, curve, alignment, spacing) and **text/sticker tracking**: no source.
6. **Clip animation group names** ("Combo") and preset names: no CapCut source.
7. **Settings dialog options**: tab names come from video chapter lists and transcripts; individual options under Edit are unknown.
8. **Shortcuts**: about two thirds confirmed by CapCut's own video; clipboard, save, export and keyframe-navigation bindings are unconfirmed, and one community list contradicts another.
9. **Cover editor, batch export, alpha export, multi-cam, scopes, audio EQ**: no source either way.
10. **Free vs Pro gating and current cloud quota**: intentionally not established.
11. **CapCut help centre**: only three help-centre pages surfaced in search (team collaboration, Auto Cut, account linking). Most [C] evidence is from CapCut marketing/resource articles, which are less precise than help pages. No release notes were found.
12. **OpenCut classic column**: the referenced inventory file does not exist yet, so most cells are "to verify".

---

## 6. Sources

**CapCut-owned**

- [S1] https://www.capcut.com/resource/how-to-use-capcut (desktop walkthrough: toolbar, right panel, export, AI and pro tools, asset tabs)
- [S2] https://www.youtube.com/watch?v=eYM2KPJS5iU (CapCut channel: "Full Guide to Desktop Keyboard Shortcuts")
- [S12] https://apps.apple.com/ca/iphone/story/id1745127492 (App Store editorial: text to speech, enhance voice, camera tracking, auto reframe, Remove BG paths on mobile)
- [S13] https://www.capcut.com/editor (web editor tab row)
- [S14] https://www.capcut.com/tools/speed-ramp
- [S15a] https://www.capcut.com/resource/capcut-color-grading
- [S15b] https://www.capcut.com/resource/color-grading-in-after-effects
- [S15c] https://www.capcut.com/resource/luts-for-color-grading
- [S15d] https://www.capcut.com/resource/how-to-change-colors-in-video-with-capcut
- [S15e] https://www.capcut.com/resource/color-grading-vs-color-correction
- [S15f] https://www.capcut.com/ideas/seedance-2-0-for-color-grading
- [S15g] same as [S15b] (colour match)
- [S16a] https://www.capcut.com/tools/mask-video-online
- [S17a] https://www.capcut.com/tools/auto-caption-app
- [S17b] https://www.capcut.com/resource/subtitle-extractor
- [S17c] https://www.capcut.com/resource/english-to-ukrainian
- [S17d] https://www.capcut.com/resource/transcribe-video-to-text-guide
- [S17e] https://www.capcut.com/resource/add-text-in-openshot
- [S18a] https://www.capcut.com/resource/extract-audio-from-video-online
- [S18b] https://www.capcut.com/resource/audio-visualizer-software
- [S18c] https://www.capcut.com/resource/mp3-from-mp4-extractor
- [S18d] https://www.capcut.com/resource/clean-up-audio
- [S18e] https://www.capcut.com/resource/voice-changer-app
- [S19e] https://www.capcut.com/resource/text-to-speech-for-reading (web export options)
- [S19g] https://www.capcut.com/resource/what-is-a-bitrate-in-video
- [S20a] https://www.capcut.com/resource/collaborate-on-capcut-online
- [S20b] https://www.capcut.com/help/team-collaboration-feature
- [S20c] https://www.capcut.com/resource/google-drive-share
- [S20d] https://www.capcut.com/resource/enterprise-file-transfer
- [S20e] https://www.capcut.com/help/link-capcut-mobile-and-pc-account
- [S22a] https://www.capcut.com/tools/keyframe-animation
- [S23a] https://www.capcut.com/tools/face-retouching
- [S23b] https://www.capcut.com/resource/best-beauty-filters
- [S23c] https://www.capcut.com/ideas/seedance-2-0-for-skin-smoothing
- [S24a] https://www.capcut.com/tools
- [S24b] https://www.capcut.com/tools/desktop-ai-power
- [S24c] https://www.capcut.com/tools/ai-video-generator
- [S24d] https://www.capcut.com/help/auto-cut-in-capcut
- [S24e] https://www.capcut.com/tools/ai-video-editor
- [S24f] https://www.capcut.com/tools/online-video-editor
- [S24g] https://www.capcut.com/tools/ai-long-video-to-short-video
- [S24h] https://www.capcut.com/resource/capcut-ai
- [S24i] https://www.capcut.com
- [S24j] https://www.capcut.com/resource/most-powerful-free-online-ai-video-editors
- [S24k] https://www.capcut.com/resource/top-6-ai-dialogue-scene-tools-for-professional-studios
- [S24l] https://www.capcut.com/tools/ai-product-photography
- [S25a] https://www.capcut.com/tools/free-video-transitions
- [S25b] https://www.capcut.com/resource/add-video-transition-online
- [S25c] https://www.capcut.com/resource/tiktok-upload
- [S26a] https://www.capcut.com/resource/loading-text-animations
- [S26b] https://www.capcut.com/resource/text-animation-in-daVinci-resolve
- [S26c] https://www.capcut.com/resource/online-text-video-editor
- [S27] CapCut App Store listing text, as mirrored at https://www.popvortex.com/apps/charts/top-free-ipad-apps.php (speed 0.1x to 100x, optical flow, chroma key, stabilising, keyframes "for all settings", local font import, share targets)
- [S28a] https://www.capcut.com/resource/gif-maker
- [S28b] https://www.capcut.com/tools/free-online-gif-editor
- [S28c] https://www.capcut.com/resource/gif-transparent-maker
- [S30a] https://www.capcut.com/resource/how-to-remove-background-in-capcut
- [S30b] https://www.capcut.com/resource/capcut-tutorial-for-beginners
- [S31] https://www.capcut.com/resource/change-video-aspect-ratio
- [S31b] https://www.capcut.com/resource/how-to-change-canvas-size
- [S33a] https://www.capcut.com/resource/overlay-picture-on-video
- [S33b] https://www.capcut.com/resource/overlay-video-on-video

**Third-party**

- [S3] https://defkey.com/capcut-video-editor-shortcuts (transcribed from a Reddit screenshot of the in-app shortcut sheet)
- [S3b] https://www.skillademia.com/shortcuts/capcut-shortcuts (action names; bindings did not extract)
- [S3c] https://quizlet.com/study-guides/capcut-desktop-hotkeys-e8fa2635-616f-489b-94ae-d1f910cd8ce9
- [S4] https://gist.github.com/natthasath/cbcfad46ab260007b009d0b6889d5109 (same list as [S3])
- [S5] https://filmora.wondershare.com/advanced-video-editing/capcut-timeline.html (competitor's article)
- [S6] https://techpp.com/2025/05/27/capcut-desktop-icons-symbols-meaning
- [S7] https://influencermarketinghub.com/capcut-statistics (mobile main toolbar, 27-item Edit list, PC tab rows)
- [S7b] https://influencermarketinghub.com/what-is-capcut
- [S8] https://www.youtube.com/watch?v=Fo5Rld_gN90 (mobile interface lesson)
- [S9] https://store.hollyland.com/blogs/creator-hub/use-capcut (mobile walkthrough)
- [S10] https://www.wikihow.com/Edit-Videos-with-CapCut (desktop + mobile, step by step)
- [S11] https://www.videoproc.com/video-editor/how-to-use-capcut.htm
- [S11b] https://www.youtube.com/watch?v=yMbu1A5N-jc
- [S16b] https://filmora.wondershare.com/video-editing/capcut-mask.html (competitor's article)
- [S16c] https://www.youtube.com/watch?v=mF6rK8AW0_4
- [S16d] https://www.youtube.com/watch?v=FRlKUxVuP84
- [S19a] https://store.hollyland.com/blogs/creator-hub/best-export-settings-from-capcut-desktop-for-youtube-shorts (states CapCut PC 8.5.0)
- [S19b] https://www.miracamp.com/learn/capcut/how-to-render
- [S19c] https://capcutguide.com/capcut-export-settings (checked 2026-09-13 per the page)
- [S19d] https://www.youtube.com/watch?v=QOC1Yr748bc
- [S19f] https://www.youtube.com/watch?v=DgTJvcIl_N0
- [S19h] https://www.instagram.com/reel/DGLvwrfOhcY
- [S21a] https://www.youtube.com/watch?v=ngGfOTv2GWw (settings walkthrough)
- [S21b] https://editlogic.io/tutorial-blueprint-how-to-fix-capcut-desktop-lagging
- [S21c] https://www.skillshare.com/en/classes/capcut-video-editing-the-complete-desktop-and-mobile-course-for-beginners/596926217
- [S21d] https://www.yared-coding.com.et/blog/mastering-capcut-features
- [S21e] https://www.youtube.com/watch?v=44EjK25bFyw (shortcut customisation)
- [S21f] https://www.instagram.com/reel/DdHHf1zEu1h
- [S22b] https://www.youtube.com/watch?v=fKNDlT5JbTY
- [S22c] https://www.youtube.com/watch?v=BxHHyGRdmvk
- [S22d] https://capcutguide.com/how-to-use-keyframes-in-capcut
- [S27b] https://www.winxdvd.com/edit-video/how-to-speed-up-a-video-on-capcut.htm
- [S29a] https://www.youtube.com/watch?v=wrzxXQW4C3Q
- [S29b] https://www.tourboxtech.com/en/news/how-to-add-music-to-capcut.html
- [S32] https://www.dailymotion.com/video/x9myagw (CapCut Web Editor course; lesson titles used as evidence of web features)
- [S34] https://www.youtube.com/watch?v=Vzdjjh9Vpwc (layout and timeline)
- [S35a] https://www.youtube.com/watch?v=EMDrgqepVhM
- [S35b] https://www.youtube.com/watch?v=j5_471mO14c
- [S36a] https://www.youtube.com/watch?v=H-TmIUV-Wko (mobile course chapter list)
- [S36b] https://www.newsmediahelpdesk.org/capcut-app-vertical-video-editing-guide
- [S36c] https://techmodena.com/how/how-to-use-capcut-app
- [S36d] https://www.youtube.com/watch?v=yMbu1A5N-jc
- [S36e] https://www.storyblocks.com/resources/tutorials/how-to-use-capcut

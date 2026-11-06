# ai-editing-tools — normative catalogue

This file is normative. `ai-editing-tools` requirements cite its sections by name. A CI check compares every table
with the shipped data files (`packages/media/models/manifest.json`, the tool registry, the preset files)
and fails on any difference. All content here is authored for this project; no third-party preset is copied.

## Tool table

"Runs" is `device` (on this device; also "Run on host" with `host-analysis`), `host` (host, host-local
model, no provider) or `provider` (host provider through the named role and task route).

| Tool id | UI label | Accepted selection | Runs | Owning requirement |
|---|---|---|---|---|
| `cutout.image` | Remove background | image | device | Background removal for images; Person matte for body effects; Interactive cutout and propagation |
| `cutout.video` | Remove background | video | device | Background removal for video; Person matte for body effects; Interactive cutout and propagation |
| `reframe` | Auto reframe | video, image, or project | device | Auto reframe |
| `track` | Tracking | video | device | Motion tracking |
| `stabilise` | Stabilise | video | device | Video stabilisation |
| `deflicker` | Remove flicker | video | device | Flicker removal |
| `relight` | Relight | video, image | device | Relight |
| `retouch` | Retouch | video, image | device | Face retouch; Makeup presets; Face reshape; Body reshape; Multi-face retouch and auto styles |
| `eye-contact` | Eye contact | video | device | Eye contact correction |
| `motion-style` | Motion styles | video, image | device | AI movement |
| `auto-cut` | Auto cut | video, audio, or main track | device (script mode: provider `editor`) | Auto cut by silence, fillers and script |
| `beat-sync` | Beat sync | 2+ adjacent clips and a music clip | device | Beat sync |
| `smart-search` | Smart search | project media | device | Smart search of media |
| `separate.stems` | Isolate vocals | audio, video with audio | host | Stem separation |
| `upscale` | Enhance | video, image | provider `image` / `video`, route `upscale` | Upscale and enhance |
| `restyle` | AI style | video, image | provider `image` / `video`, route `restyle` | Restyle |
| `remove.object` | Remove object / Remove text | video, image | provider `image` / `video`, route `inpaint` | Object and text removal |
| `expand.image` | AI expand | image, video frame | provider `image`, route `expand` | AI expand |
| `generate.image` | Generate image | none (generator) | provider `image` | AI image generation |
| `generate.video` | Generate video | none (generator) | provider `video` | AI video generation |
| `generate.music` | Generate music | none (generator) | provider `music` | AI music and sound effect generation |
| `generate.sfx` | Generate sound effect | none (generator) | provider `sfx` | AI music and sound effect generation |
| `tts` | Text to speech | text, captions, or typed text | provider `voice-tts` | Text to speech with voice selection |
| `voice-changer` | Voice changer | audio, video with audio | provider `voice-design`, route `convert` | AI voice changer |
| `lipsync` | Lip sync | video + audio | provider `lipsync` | Avatar and lip-sync |
| `avatar` | Avatar | image + speech | provider `lipsync`, route `avatar` | Avatar and lip-sync |
| `dialogue-scene` | Dialogue scene | none (generator) | provider `lipsync.avatar` + `voice-tts` | Dialogue scene |
| `dub` | Dubbing | clips or timeline | provider `translation`, `voice-tts` (+ `voice-design`, `lipsync`) | Dubbing |
| `captions.auto` | Auto captions | timeline, clips | entry point → `captions-subtitles` | Auto captions hand-off and shared transcript |
| `translate` | Translate captions | caption tracks | entry point → `captions-subtitles` | Caption translation |
| `voice-enhance` | Enhance voice | audio, video with audio | entry point → `audio-editing` | Voice enhance and noise cleanup |
| `script-to-video` | Script to video | none (project-level) | entry point → `script-studio`, `agent-workflows` | Script to video |
| `long-to-shorts` | Long video to shorts | one video of 2 min–3 h | entry point → `agent-workflows` (`tpl.long-to-shorts`) | Long video to shorts |

## Model manifest

One row per model the product can load. Every file is ONNX and runs on the runtime of
`ai-editing-tools.Inference runtime` (ONNX Runtime Web on devices, `onnxruntime-node` on the host). `sizeBytes` and
`sha256` are pinned in `packages/media/models/manifest.json`; the size column is the upper bound the manifest
value must not exceed. `peakMemoryMiB` is the admission value verified by the measurement test. All files are served
from the single content host of `security-privacy.Network egress control`.

**Licence columns are expectations, not verified facts.** "Code" and "Weights" give the licence this specification
expects for the upstream code and for the published weights. Each must be checked against the upstream repository and
recorded (`licenceVerified`) before the row is pinned (`ai-editing-tools.Model manifest`); rows marked ⚠ carry a known
question about the weights or their training data that the check must answer. "If the check fails" names the
replacement.

| Model id | Task | Upstream model · source | Code / Weights (to verify) | Input | Size ≤ (MB) | peakMemoryMiB | Bundled | Conversion | If the check fails |
|---|---|---|---|---|---|---|---|---|---|
| `seg-person` | person matte: Standard video cutout, body effects, body reshape | MediaPipe Selfie Segmentation (general) · github.com/google-ai-edge/mediapipe | Apache-2.0 / Apache-2.0 | 256×256 | 1 | 150 | yes | TFLite → ONNX | PP-HumanSeg lite (PaddleSeg) |
| `seg-person-hq` | human matting: High-quality video cutout | PP-Matting v2 (512) · github.com/PaddlePaddle/PaddleSeg | Apache-2.0 / Apache-2.0 ⚠ training data terms | 512 short side | 40 | 550 | no | Paddle → ONNX | MODNet is NOT acceptable (non-commercial weights); use BiRefNet-lite (MIT) on desktop and host |
| `seg-salient` | salient-object matte for images | IS-Net general-use (DIS) · github.com/xuebinqin/DIS | Apache-2.0 / Apache-2.0 ⚠ DIS5K dataset terms | 1024×1024 | 180 | 900 | no | PyTorch → ONNX | BiRefNet-lite (MIT) |
| `seg-salient-lite` | salient-object matte for images on low-memory devices | U²-Net-P · github.com/xuebinqin/U-2-Net | Apache-2.0 / Apache-2.0 ⚠ DUTS dataset terms | 320×320 | 5 | 300 | no | PyTorch → ONNX | `seg-person` for people only; other images run on host |
| `seg-click` | click-to-select object (smart brush, select object) | MobileSAM · github.com/ChaoningZhang/MobileSAM | Apache-2.0 / Apache-2.0 ⚠ SA-1B dataset terms | 1024×1024 | 45 | 600 | no | PyTorch → ONNX (encoder + decoder) | EfficientSAM-Ti (Apache-2.0) |
| `face-mesh` | face detection, 478 landmarks, iris | MediaPipe Face Landmarker (detector + mesh) · github.com/google-ai-edge/mediapipe | Apache-2.0 / Apache-2.0 | 192×192 detector, 256×256 mesh | 4 | 200 | yes | TFLite → ONNX | none known; retouch, eye contact and lip-sync pre-check become host-provider-only |
| `body-pose` | 33 body pose points | MediaPipe Pose Landmarker (full) · github.com/google-ai-edge/mediapipe | Apache-2.0 / Apache-2.0 | 256×256 | 10 | 250 | no | TFLite → ONNX | MoveNet Thunder (Apache-2.0), 17 points |
| `depth` | monocular depth for relight | Depth Anything V2 Small · github.com/DepthAnything/Depth-Anything-V2 | Apache-2.0 / Apache-2.0 (Small only) | 518 short side | 100 | 700 | no | PyTorch → ONNX | `depth-lite` everywhere |
| `depth-lite` | monocular depth on low-memory devices | MiDaS v2.1 small · github.com/isl-org/MiDaS | MIT / MIT | 256×256 | 70 | 300 | no | none (upstream ONNX) | relight uses the face mesh only (Scope: Face) |
| `text-detect` | on-screen text regions | PP-OCRv4 mobile detection · github.com/PaddlePaddle/PaddleOCR | Apache-2.0 / Apache-2.0 | 960 long side | 5 | 200 | no | Paddle → ONNX | "Detect text" is not offered |
| `speech-denoise` | speech denoise (used by `audio-editing`) | DeepFilterNet3 · github.com/Rikorose/DeepFilterNet | MIT OR Apache-2.0 / same | 48 kHz frames | 10 | 200 | no | none (upstream ONNX) | RNNoise (BSD-3-Clause) |
| `vad` | voice activity | Silero VAD · github.com/snakers4/silero-vad | MIT / MIT | 16 kHz, 512 samples | 3 | 100 | yes | none (upstream ONNX) | energy-based detection (no model) |
| `embed-clip` | image–text embedding for smart search | CLIP ViT-B/32 (8-bit quantised) · github.com/openai/CLIP | MIT / MIT | 224×224, 77 tokens | 160 | 900 | no | PyTorch → ONNX (image and text towers) | visual search is not offered |
| `face-embed` | face identity embedding for opt-in people search | SFace · github.com/opencv/opencv_zoo | Apache-2.0 / Apache-2.0 ⚠ training data terms | 112×112 | 40 | 200 | no | none (upstream ONNX) | people search is not offered |
| `whisper-tiny` | speech recognition | Whisper tiny (4-bit quantised) · github.com/openai/whisper | MIT / MIT | 30 s, 80 mel | 50 | 300 | no | PyTorch → ONNX | — |
| `whisper-base` | speech recognition | Whisper base (4-bit quantised) | MIT / MIT | 30 s, 80 mel | 90 | 500 | no | PyTorch → ONNX | — |
| `whisper-small` | speech recognition | Whisper small (4-bit quantised) | MIT / MIT | 30 s, 80 mel | 280 | 1 000 | no | PyTorch → ONNX | — |
| `whisper-medium` | speech recognition | Whisper medium (4-bit quantised) | MIT / MIT | 30 s, 80 mel | 800 | 3 000 | no | PyTorch → ONNX | — |
| `whisper-large-v3-turbo` | speech recognition | Whisper large-v3-turbo (4-bit quantised) | MIT / MIT | 30 s, 128 mel | 850 | 3 000 | no | PyTorch → ONNX | — |
| `stems-htdemucs` | two-stem separation (vocals, accompaniment) | Demucs htdemucs · github.com/facebookresearch/demucs | MIT / MIT ⚠ trained partly on MUSDB18-HQ (non-commercial dataset terms) | 44.1 kHz stereo, 7.8 s segments | 330 | 4 000 | no | PyTorch → ONNX (network only; STFT in product code) | Open-Unmix `umxl` is NOT acceptable (non-commercial weights); stem separation becomes provider-only |

20 models. Stabilisation, motion tracking, flicker removal, silence detection, beat sync, motion styles, eye-contact
warping, mask propagation between segmented frames and optical-flow slow motion (`speed-retime.Smooth slow motion`, a
GPU shader algorithm) use signal processing and the face mesh only and load no further model. No video-object
segmentation model is shipped: propagation is tracker-driven re-segmentation with `seg-click`
(`ai-editing-tools.Interactive cutout and propagation`).

## Platform availability

Result of the admission rule of `ai-editing-tools.On-device model management` per platform. **D** = runs on the device
(subject to the 25 % memory rule on that device); **H** = host only ("Run on host" with `host-analysis`); the three
desktop systems behave identically, and so do the two mobile systems (both additionally require the S6 inference row
to pass on that platform, else every D in their column becomes H).

| Model id | Web | macOS | Windows | Linux | iOS | Android | Host host |
|---|---|---|---|---|---|---|---|
| `seg-person` | D | D | D | D | D | D | yes |
| `seg-person-hq` | D | D | D | D | H (550 > 400) | H | yes |
| `seg-salient` | D | D | D | D | H (900 > 400) | H | yes |
| `seg-salient-lite` | D | D | D | D | D | D | yes |
| `seg-click` | D | D | D | D | H (600 > 400) | H | yes |
| `face-mesh` | D | D | D | D | D | D | yes |
| `body-pose` | D | D | D | D | D | D | yes |
| `depth` | D | D | D | D | H (700 > 400) | H | yes |
| `depth-lite` | D | D | D | D | D | D | yes |
| `text-detect` | D | D | D | D | D | D | yes |
| `speech-denoise` | D | D | D | D | D | D | yes |
| `vad` | D | D | D | D | D | D | yes |
| `embed-clip` | D | D | D | D | H (900 > 400) | H | yes |
| `face-embed` | D | D | D | D | D | D | yes (after the per-host confirmation) |
| `whisper-tiny` | D | D | D | D | D | D | yes |
| `whisper-base` | D | D | D | D | H (500 > 400) | H | yes |
| `whisper-small` | D | D | D | D | H | H | yes |
| `whisper-medium` | D | D | D | D | H | H | yes |
| `whisper-large-v3-turbo` | D | D | D | D | H | H | yes |
| `stems-htdemucs` | H | H | H | H | H | H | yes |

On web the WebGPU provider is used in browsers whose engine backend is `webgpu` and the WebAssembly provider otherwise;
a browser that does not report device memory is treated as 4 GiB, which leaves `whisper-medium` and
`whisper-large-v3-turbo` host-only there.

## Acceptance fixtures

Sets live under `packages/media/fixtures/ai/<set id>/` with ground truth in the set's `truth.json`.

| Set id | Contents | Tool | Metric | Threshold |
|---|---|---|---|---|
| `matte-image-40` | 40 images (20 people, 20 objects) with ground-truth mattes | `cutout.image` | mean IoU at alpha 0.5 | ≥ 0.92 (`seg-salient`), ≥ 0.85 (`seg-salient-lite`) |
| `matte-video-6` | exactly 6 clips of 5 s with per-frame mattes and static-region masks: 1 webcam head-and-shoulders, 2 full-body, 1 two-person, 1 moving-camera, 1 loose hair or clothing | `cutout.video`, person matte for body effects | mean IoU; lowest clip IoU; mean alpha change between consecutive frames in static regions | ≥ 0.90 (`seg-person-hq`), ≥ 0.82 (`seg-person`); ≥ 0.75; ≤ 2 % |
| `matte-custom-4` | 4 clips of 5 s (held object, rolling ball, pet, person from behind) with a first-frame prompt stroke and per-frame mattes | custom cutout propagation (`seg-click` + tracker) | mean IoU; lowest clip IoU | ≥ 0.80; ≥ 0.70 |
| `reframe-4` | 4 landscape clips with a labelled subject centre per frame | `reframe` | share of frames with the subject centre in the central 60 % of the 9:16 frame | ≥ 95 % |
| `track-6` | 6 clips with a labelled target centre per frame | `track` | share of frames with centre error ≤ 3 % of frame width | ≥ 90 % |
| `handheld-5` | 5 handheld clips with labelled static background features | `stabilise` | reduction of residual frame-to-frame translation at `recommended` | ≥ 60 % |
| `flicker-3` | 3 clips whose mean luminance oscillates by ±8 % | `deflicker` | residual oscillation at strength 50 | ≤ ±2 % |
| `retouch-10` | 10 portrait clips with skin, lip and eye region labels | `retouch`, `relight` | per-scenario measures stated in the requirements | as stated |
| `gaze-8` | 8 clips of a speaker looking 10° below the lens | `eye-contact` | face-mesh gaze estimate error at strength 100 | ≤ 3° on ≥ 90 % of in-limit frames |
| `speech-pauses-3` | 3 speech clips with labelled pause boundaries | `auto-cut` | boundary error of proposed cuts | ≤ 40 ms |
| `stems-3` | 3 mixes with reference vocal and accompaniment stems | `separate.stems` | vocal signal-to-distortion ratio | ≥ 5 dB each |
| `search-30` | 60 assets and 30 labelled text queries | `smart-search` | recall@5 over the queries | ≥ 0.7 |
| `speech-en-30` | 30 minutes of English speech with reference transcript and word timings | speech models | word error rate; median word-timing error | ≤ 12 % (`whisper-small`), ≤ 20 % (`whisper-tiny`); ≤ 150 ms |
| `lyrics-4` | 4 songs with sung vocals, reference lyrics and labelled line-break times | speech models in Lyrics mode | share of generated line breaks within 0.3 s of a labelled line break | 100 % |
| `beats-4` | 4 music clips with labelled beats (beat detection is owned by `audio-editing`) | `beat-sync` | share of cuts within one frame of a beat marker | 100 % |
| `motion-determinism` | 3 clips, each style applied twice | `motion-style` | keyframe sets equal between the two runs | identical |

## Relight presets

| Preset | Azimuth (°) | Elevation (°) | Intensity | Colour temperature (K) | Ambient | Scope |
|---|---|---|---|---|---|---|
| Front | 0 | 10 | 50 | 5 500 | 0 | Subject |
| Rim | 160 | 20 | 60 | 6 500 | −20 | Subject |
| Side left | −70 | 10 | 50 | 5 500 | −10 | Subject |
| Side right | 70 | 10 | 50 | 5 500 | −10 | Subject |
| Top | 0 | 75 | 45 | 6 000 | −10 | Subject |
| Warm evening | −40 | 15 | 55 | 3 200 | 10 | Whole frame |

## Makeup looks

Colour is sRGB hex; the number after it is the layer intensity (0–100) at look intensity 100. "—" means the layer is
not used by the look.

| # | Look | Lipstick | Blush | Eyeshadow | Eyeliner | Eyebrow | Contour |
|---|---|---|---|---|---|---|---|
| 1 | Natural | `#c9837a` 40 | `#e8a59c` 25 | `#b89684` 15 | `#3a2a24` 20 | `#4a3a30` 20 | `#8a6a58` 10 |
| 2 | Rosy | `#d4667a` 55 | `#f09aa8` 40 | `#d9a3ad` 30 | `#3a2a24` 25 | `#4a3a30` 20 | `#8a6a58` 10 |
| 3 | Coral | `#e8705a` 60 | `#f4a08a` 40 | `#e0b090` 25 | `#3a2a24` 25 | `#4a3a30` 25 | `#8a6a58` 15 |
| 4 | Berry | `#8e2f52` 70 | `#c56a86` 35 | `#7a4a60` 40 | `#1e1418` 45 | `#3a2a28` 30 | `#7a5a4c` 20 |
| 5 | Nude | `#b8866e` 45 | `#d4a48c` 20 | `#a88a72` 25 | `#3a2a24` 15 | `#4a3a30` 25 | `#8a6a58` 25 |
| 6 | Smoky | `#a05a5a` 45 | `#c98a80` 20 | `#3c3438` 65 | `#101010` 70 | `#2e2422` 35 | `#7a5a4c` 25 |
| 7 | Classic red | `#b3121f` 80 | `#e09088` 25 | `#b8a090` 15 | `#101010` 55 | `#3a2a28` 30 | `#8a6a58` 15 |
| 8 | Peach glow | `#eb8f6f` 50 | `#f7b89a` 45 | `#f0c8a0` 30 | `#4a342a` 20 | `#4a3a30` 20 | `#8a6a58` 10 |

## Retouch auto styles

Slider values at Amount 100. Sliders not listed stay 0. "Makeup" names a look of the table above and its intensity.

| Style | Smooth skin | Brighten skin | Dark circles | Smile lines | Whiten teeth | Blemishes | Brighten eyes | Skin tone | Slim face | Eye size | Makeup |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Natural | 30 | 10 | 20 | 10 | 10 | 40 | 10 | 0 | 0 | 0 | — |
| Fresh | 40 | 25 | 35 | 15 | 25 | 50 | 25 | −5 | 5 | 5 | Natural 30 |
| Soft | 60 | 20 | 40 | 30 | 15 | 60 | 15 | 5 | 5 | 0 | Rosy 30 |
| Defined | 35 | 10 | 30 | 10 | 20 | 50 | 20 | 0 | 15 | 10 | Nude 50 |
| Bright | 45 | 45 | 45 | 20 | 40 | 55 | 40 | −10 | 5 | 5 | Peach glow 40 |
| Studio | 55 | 30 | 50 | 35 | 35 | 70 | 30 | 0 | 10 | 5 | Classic red 45 |

## Motion styles

Values at Intensity 100; every amplitude scales linearly with Intensity / 100. `S0` is the element's scale before the
tool runs, `T` the clip duration. Zoom in, Zoom out, Shake and Soft sway use no detector; Push and Dynamic (no beats)
use the subject detector of `ai-editing-tools.Auto reframe`. Property paths: scale = `transform.scale.x` and
`transform.scale.y`, position = `transform.position.x` / `.y`, rotation = `transform.rotation`. All easing is ease-in-out (cubic bezier 0.42, 0, 0.58, 1) unless stated.

| Style | Scale | Position | Rotation | Keys |
|---|---|---|---|---|
| Zoom in | `S0` at 0 → `S0 × 1.30` at `T` | — | — | 2 scale keys |
| Zoom out | `S0 × 1.30` at 0 → `S0` at `T` | — | — | 2 scale keys |
| Push | `S0` → `S0 × 1.15` | from 0 toward the subject centre of the `Auto reframe` detector by up to 5 % of the canvas short side (canvas centre when no subject is found) | — | 2 scale keys, 2 position keys |
| Shake | constant `S0 × 1.08` | hash-noise offsets within ±2 % of the canvas short side, one key every 1/8 s, linear | hash-noise within ±1.5°, one key every 1/8 s, linear | 8 keys per second per property |
| Soft sway | constant `S0 × 1.05` | sine on x, amplitude 1.5 % of the canvas short side, period 4 s | sine, amplitude 0.8°, period 4 s, a quarter period behind position | 4 keys per period per property |
| Dynamic (beats) | on each beat marker `S0 × 1.00 → 1.12 → 1.00` over 0.25 s | — | — | 3 scale keys per beat |
| Dynamic (no beats) | constant `S0 × 1.10` | follows the subject of the `Auto reframe` detector so that it stays in the central 60 % of the canvas, at most 2 keys per second | — | position keys |

## Restyle styles

The descriptor is the project-authored text sent to the provider before any user prompt.

| Style id | Label | Descriptor |
|---|---|---|
| `anime` | Anime | "Redraw as a hand-drawn Japanese animation cel: clean ink outlines, flat colour fills with two-tone shading, large expressive eyes, simplified backgrounds. Keep the composition, poses and framing of the input." |
| `comic` | Comic | "Redraw as a western comic-book panel: bold black contour lines, halftone dot shading, saturated primary colours, strong shadows. Keep the composition, poses and framing of the input." |
| `oil-paint` | Oil paint | "Redraw as an oil painting on canvas: visible thick brush strokes, rich blended colour, soft edges, warm gallery lighting. Keep the composition, poses and framing of the input." |
| `watercolour` | Watercolour | "Redraw as a watercolour painting on textured paper: translucent washes, soft bleeding edges, light pencil underdrawing, pale background. Keep the composition, poses and framing of the input." |
| `clay` | Clay | "Redraw as a stop-motion clay model scene: rounded sculpted shapes, fingerprint texture, soft studio lighting, shallow depth of field. Keep the composition, poses and framing of the input." |
| `pixel-art` | Pixel art | "Redraw as low-resolution pixel art: hard square pixels, a palette of at most 32 colours, no anti-aliasing, dithering for gradients. Keep the composition, poses and framing of the input." |
| `sketch` | Sketch | "Redraw as a graphite pencil sketch on off-white paper: line work with cross-hatched shading, no colour. Keep the composition, poses and framing of the input." |
| `neon` | Neon | "Redraw as a night scene lit by neon signs: deep blue and magenta lighting, glowing edges, wet reflective surfaces, high contrast. Keep the composition, poses and framing of the input." |

## Filler words

Default lists; a project can add or remove entries. Matching is case-insensitive on whole transcript words or word
sequences. Entries marked (p) match only when a pause of at least 0.2 s precedes and follows them.

| Language | Entries |
|---|---|
| en | um, uh, er, ah, hmm, like (p), you know, I mean, sort of (p), kind of (p), basically (p), actually (p), literally (p), okay so, right (p) |
| vi | ờ, ừm, à (p), ừ (p), ờm, kiểu (p), kiểu như, nói chung là, đại khái là, ý là, thật ra thì, thì là |
| ja | えー, えーと, えっと, あの (p), あのー, その (p), まあ (p), なんか (p), うーん, こう (p) |

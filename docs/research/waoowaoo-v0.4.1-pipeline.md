# waoowaoo v0.4.1 — the staged novel-to-film pipeline (code-grounded)

Research target: `/Users/ngocchanh/Project/private/organisations/hdc/jagentchill/.refs/waoowaoo-v0.4.1`
Snapshot: tag `v0.4.1`, commit `531de26d48869602b5b2d730a3743cf077a0213f` ("update v0.4.1", 2026-04-03), `package.json` version `0.4.1`. The clone contains a single commit.
All paths are relative to that repo root unless stated otherwise.

Companion document: `docs/research/waoowaoo-reference.md` covers HEAD (v0.5.0-beta.1), a rewrite into chat assistant + node canvas on Temporal. This document covers what that rewrite removed: the fixed, staged pipeline on BullMQ.

Conventions:

- A statement followed by a path was read in that file.
- `UNVERIFIED` = not confirmed in code at this tag (inferred from UI strings, naming, or not traced end to end).
- `NOT PRESENT` = searched for and absent.
- `UNWIRED` = code exists in the tree but nothing reachable from the UI/API calls it.
- Prompt templates are described by function and output fields only. No prompt text is reproduced.

---

## 0. Headline differences from v0.5.0-beta.1

| Topic | v0.4.1 (this doc) | v0.5.0-beta.1 (previous doc) |
| --- | --- | --- |
| Product shape | Fixed stages: Story -> Script/Assets -> Storyboard -> Video (+ embedded Voice); "AI Editor" tab disabled | Free-form canvas + chat assistant, no stages |
| Orchestration | BullMQ on Redis, 4 queues, 40 task types, plus a "GraphRun" step/event layer for the two long LLM workflows | Temporal, 5 task types |
| Domain tables | `NovelPromotion*` (Episode, Clip, Storyboard, Panel, VoiceLine, Character, Location...) | `WorkspaceResource` file tree |
| Reasoning | Hard-coded prompt chain in workers (`lib/prompts/novel-promotion/*.txt`) | Codex agent reading Markdown skills |
| Lip-sync, per-line TTS, voice analysis | Present | Absent |
| License | No license file or statement anywhere (section 7) | Has license text (see previous doc) |

Three things the brief assumed that are **not** delivered at this tag:

1. **Timeline editor / final composition / single-file export**: a Remotion-based editor exists in `src/features/video-editor/**` but is UNWIRED (section 2.17). The shipped end product is a ZIP of per-panel video clips.
2. **Subtitles**: no subtitle generation or burn-in in the live pipeline (section 2.16).
3. **Music / SFX**: NOT PRESENT in the live pipeline (section 2.15).

---

## 1. Architecture and stack

### 1.1 Stack (`package.json`, `README_en.md` "Tech Stack")

| Concern | Choice | Evidence |
| --- | --- | --- |
| Framework | Next.js 15 (App Router, Turbopack dev) + React 19, TypeScript | `package.json` deps `next ^15.5.7`, `react ^19.1.2`; `src/app/**` |
| Styling | Tailwind CSS v4 | `package.json`, `postcss.config.mjs` |
| DB | MySQL 8 via Prisma 6 (`db push`, no migration run at boot) | `prisma/schema.prisma` (`provider = "mysql"`), `docker-compose.yml` (`npx prisma db push --skip-generate`) |
| Alt schema | A SQLite variant of the schema exists | `prisma/schema.sqlit.prisma` (usage UNVERIFIED) |
| Queue | BullMQ 5 on Redis 7 (ioredis) | `src/lib/task/queues.ts`, `src/lib/redis.ts` |
| Workers | Separate Node process run with `tsx`, 4 BullMQ workers | `src/lib/workers/index.ts`, script `start:worker` |
| Watchdog | Separate process: re-enqueues lost queued tasks, fails heartbeat-timeout tasks | `scripts/watchdog.ts`, script `start:watchdog` |
| Queue admin UI | Bull Board on Express, port 3010, path `/admin/queues`, optional basic auth | `scripts/bull-board.ts`, `.env.example` (`BULL_BOARD_*`) |
| Storage | Provider abstraction: `minio` (S3-compatible, default), `local` (dev), `cos` (declared, every method throws not-implemented) | `src/lib/storage/factory.ts`, `src/lib/storage/providers/{minio,local,cos}.ts`, `.env.example` |
| Media indirection | `MediaObject` rows with `publicId`, served through `/m/[publicId]`; signed URLs via `/api/storage/sign`; `/api/files/[...path]` for local | `prisma/schema.prisma` (`MediaObject`), `src/app/m/[publicId]`, `src/lib/media/**`, `src/lib/storage/signed-urls.ts` |
| Auth | NextAuth v4, Credentials provider (username + bcrypt password), JWT sessions, Prisma adapter tables | `src/lib/auth.ts`, `src/app/api/auth/register`, `src/app/api/auth/[...nextauth]` |
| i18n (UI) | next-intl, locales `zh` (default) and `en`, locale prefix always in URL | `src/i18n/routing.ts`, `messages/{zh,en}/*.json` (32 namespaces) |
| i18n (prompts) | Every prompt has `.zh.txt` and `.en.txt`; picked by task locale | `lib/prompts/**`, `src/lib/prompt-i18n/**`, `src/lib/task/resolve-locale.ts` |
| Client data | TanStack Query v5 + SSE-driven invalidation | `src/lib/query/**`, `src/app/api/sse/route.ts` |
| LLM SDKs | `openai`, `@google/genai`, `@openrouter/sdk`, Vercel `ai` v6 (assistant chat only) | `package.json`, `src/lib/llm/providers/{ark,google,openai-compat}.ts` |
| Media SDKs | `@fal-ai/client`, plain `fetch` for Ark/Vidu/MiniMax/Bailian | `src/lib/generators/**` |
| Image processing | `sharp` (label bar on asset images, format normalisation) | `src/lib/image-label.ts`, `src/lib/media/outbound-image.ts` |
| Document import | `mammoth` (.docx), plain text | `package.json`; `messages/en/smartImport.json` ("Supports Word, TXT") |
| ZIP export | `archiver` (server), `jszip` + `file-saver` (client) | `src/app/api/novel-promotion/[projectId]/download-videos/route.ts` |
| Video editor libs | `remotion`, `@remotion/player`, `@remotion/cli`, `@dnd-kit/*` | `src/features/video-editor/**` (UNWIRED) |
| Tests / guards | Vitest; ~35 custom "guard" scripts enforcing architecture rules | `package.json` scripts `check:*`, `scripts/guards/**` |

### 1.2 Process topology (`package.json` script `start`, `Dockerfile`, `docker-compose.yml`)

One app container runs four processes under `concurrently --kill-others`:

1. `next start` (web + API routes), port 3000
2. `tsx src/lib/workers/index.ts` (image, video, voice, text workers)
3. `tsx scripts/watchdog.ts`
4. `tsx scripts/bull-board.ts`, port 3010

Plus three infra containers: `mysql:8.0`, `redis:7-alpine` (AOF on), `minio`. Host ports: 13000 (app), 13010 (Bull Board), 13306, 16379, 19000/19001. An optional `caddyfile` gives local HTTPS on 1443 (README says HTTP limits concurrent browser connections, which matters because of SSE).

`src/instrumentation.ts` + `src/lib/server-boot.ts` + `/api/system/boot-id` expose a boot id so the client can detect server restarts (exact client behaviour UNVERIFIED).

### 1.3 Environment (`.env.example`)

`DATABASE_URL`, `STORAGE_TYPE`, `MINIO_*`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `INTERNAL_APP_URL` (server self-fetch), `CRON_SECRET`, `INTERNAL_TASK_TOKEN`, `API_ENCRYPTION_KEY`, `REDIS_*`, `WATCHDOG_INTERVAL_MS=30000`, `TASK_HEARTBEAT_TIMEOUT_MS=90000`, `QUEUE_CONCURRENCY_{IMAGE,VIDEO,VOICE,TEXT}`, `BULL_BOARD_*`, `LOG_*`, `BILLING_MODE=OFF`, `LLM_STREAM_EPHEMERAL_ENABLED=true`.

Note: no AI provider keys live in env. All provider keys are per-user, stored encrypted in the DB (section 4.4).

### 1.4 Layering inside `src/lib`

| Layer | Path | Role |
| --- | --- | --- |
| Task core | `task/` | create/dedupe/submit, queues, state, SSE publisher, reconcile |
| Workers | `workers/`, `workers/handlers/` | one handler per task type |
| Workflow engine | `workflow-engine/registry.ts`, `run-runtime/` | step graph, leases, events, checkpoints, artifacts, step retry for the two long LLM runs |
| Orchestrators | `novel-promotion/story-to-script/`, `novel-promotion/script-to-storyboard/` | pure step orchestration, model call injected as `runStep` |
| Prompts | `lib/prompts/**`, `src/lib/prompt-i18n/` | template files + id registry + variable substitution |
| LLM | `llm/`, `ai-runtime/`, `llm-observe/` | chat completion, streaming, reasoning options, stream-to-SSE bridge |
| Media generation | `generators/`, `generator-api.ts`, `model-gateway/`, `providers/` | provider adapters for image/video/audio |
| Lip-sync | `lipsync/` | provider adapters + audio pre-processing |
| Voice | `voice/` | per-line TTS, speaker-voice binding |
| Assets | `assets/` | unified asset service over characters / locations / props / voices, project and global |
| Model metadata | `model-capabilities/`, `model-pricing/`, `standards/**` | capability and price catalogs |
| Billing | `billing/` | quote, freeze, settle, rollback, ledger |
| Stage runtimes (client) | `novel-promotion/stages/` | React runtime hooks for video and voice stages |

---

## 2. The staged pipeline

### 2.0 Overview

Hierarchy: **Project -> Episode -> Clip -> Storyboard (1 per clip) -> Panel -> (image, video, lip-sync video)**, with **VoiceLine** rows per episode optionally bound to a panel, and project-level **Characters / Locations / Props**.

Stage tabs actually rendered (`src/app/[locale]/workspace/[projectId]/modes/novel-promotion/hooks/useWorkspaceStageNavigation.ts`):

| Tab id | Label (`messages/en/novel-promotion.json`) | Component | Ready when (`src/lib/novel-promotion/stage-readiness.ts`) |
| --- | --- | --- | --- |
| `config` | Story | `ConfigStage` -> `NovelInputStage` / `SmartImportWizard` | episode has `novelText` |
| `script` (alias `assets`) | Script | `ScriptStage` -> `ScriptView*` | any clip has `screenplay` |
| `storyboard` | Storyboard | `StoryboardStage` | any storyboard has panels |
| `videos` | Video | `VideoStageRoute` (voice toolbar embedded) | any panel has `videoUrl` |
| `editor` | AI Editor | none — `disabled: true`, tooltip "Coming soon" | n/a |

A standalone `voice` stage component also exists (`VoiceStageRoute`, routed in `components/WorkspaceStageContent.tsx`; `voice` is in `VALID_STAGES` in `src/app/[locale]/workspace/[projectId]/page.tsx`) but is not in the capsule nav; voice controls are embedded in the Video stage (`components/video-stage/VideoTimelinePanel.tsx`, `components/voice/EmbeddedVoiceToolbar.tsx`). An older `StageNavigation.tsx` listing a voice tab is still in the tree; which nav is mounted beyond `WorkspaceHeaderShell.tsx` is UNVERIFIED. A URL `?stage=editor` is coerced to `videos` (`page.tsx` line 112).

Two "one-click" long workflows drive the stage transitions (`hooks/useWorkspaceExecution.ts`):

- **Story -> Script** (`story_to_script_run`): character + location + prop analysis, clip split, screenplay conversion. On success the UI jumps to the Script tab.
- **Script -> Storyboard** (`script_to_storyboard_run`): 4-phase storyboard per clip + voice-line analysis. On success the UI jumps to the Storyboard tab.

Everything after that (asset images, panel images, videos, TTS, lip-sync) is per-item tasks the user triggers individually or in batch.

Ordered pipeline:

1. Project creation and config (ratio, art style, models)
2. Story input (paste / AI write / smart import)
3. Episode detection and splitting (marker-based or LLM)
4. Global asset analysis across all episodes (optional)
5. Character analysis -> profiles
6. Location analysis
7. Prop analysis
8. Clip splitting
9. Screenplay conversion
10. Character profile confirmation -> visual descriptions (appearance variants)
11. Asset image generation (character sheets, location plates, prop sheets) + selection
12. Storyboard phase 1: panel planning
13. Storyboard phase 2a: cinematography rules; phase 2b: acting direction (parallel)
14. Storyboard phase 3: detail refinement + video prompt
15. Voice-line analysis (part of the storyboard run)
16. Panel image generation + candidates / variants / edit
17. Panel video generation (normal or first/last-frame)
18. Speaker voice setup (upload / voice library / AI voice design)
19. TTS per line
20. Lip-sync per panel
21. Download (ZIP of images / videos / voices)

Common mechanics used by every LLM stage:

- **Model**: the project's `analysisModel` (LLM); resolved by `src/lib/workers/handlers/resolve-analysis-model.ts` and `src/lib/config-service.ts`.
- **Output parsing**: tolerant JSON parsing with repair (`src/lib/json-repair.ts`, dep `jsonrepair`). Every prompt instructs the model to return JSON only and to avoid raw double quotes inside string values.
- **Streaming**: text and reasoning tokens are streamed into the UI consoles (`components/WorkspaceRunStreamConsoles.tsx`, `src/components/llm-console/LLMStageStreamCard.tsx`) via SSE (`src/lib/workers/handlers/llm-stream.ts`, `src/lib/llm-observe/**`).
- **Reasoning controls**: payload may carry `reasoning`, `reasoningEffort`, `temperature` (`src/lib/workers/handlers/script-to-storyboard.ts` lines 70-72); allowed efforts come from capability metadata.

---

### 2.1 Project creation and config

- **Inputs**: project name/description (`src/app/[locale]/workspace/page.tsx`, `POST /api/projects`), or free text on the home page which creates a project and auto-starts the first workflow via `?autoRun=storyToScript` (`src/app/[locale]/home/page.tsx`, `hooks/useWorkspaceAutoRun.ts`).
- **Outputs**: `Project` + `NovelPromotionProject` rows; defaults copied from `UserPreference`.
- **Controls** (`messages/en/configModal.json`, `src/components/ui/config-modals/**`, `src/components/selectors/RatioStyleSelectors.tsx`):
  - Aspect ratio: 16:9, 9:16, 1:1, 3:2, 2:3, 4:3, 3:4, 5:4, 4:5, 21:9 (`src/lib/constants.ts` `ASPECT_RATIO_CONFIGS`); default 9:16.
  - Art style: `american-comic`, `chinese-comic`, `japanese-anime`, `realistic` (`src/lib/constants.ts` `ART_STYLES`); each maps to a style prompt fragment appended to image prompts. A "style preset" list exists with one disabled entry (`src/lib/style-presets.ts`).
  - Per-project model overrides: analysis, character, location, storyboard, edit, video, audio models; video resolution; TTS rate; per-model capability overrides (`NovelPromotionProject.capabilityOverrides`).
- **Model / queue**: none.

### 2.2 Story input

- **Component**: `components/NovelInputStage.tsx` + `src/components/story-input/StoryInputComposer.tsx`.
- **Inputs**: pasted novel / script / idea text for the current episode (IME-safe local buffering), ratio and style pickers.
- **Outputs**: `NovelPromotionEpisode.novelText`.
- **Controls**: word count; "AI write" modal; "Start creating" button; long-text prompt when text exceeds 1000 characters (`LONG_TEXT_THRESHOLD`) offering Smart Split vs. continue as single episode (`src/components/story-input/LongTextDetectionPrompt.tsx`).
- **Narration toggle**: props `enableNarration` exist on `NovelInputStage` but `ConfigStage` never passes them and no other file references them — UNWIRED.
- **AI write** (`ai_story_expand`, text queue; `src/lib/workers/handlers/ai-story-expand.ts`, `src/app/api/user/ai-story-expand`, `src/components/home/AiWriteModal.tsx`):
  - LLM. The prompt asks the model to expand a keyword, logline or outline into a compact, visually written third-person short story sized for a 1–2 minute film, without inventing characters or scenes the user did not mention.
  - Output: plain story text (no JSON, no headings), written straight into the story box.

### 2.3 Episode detection and splitting (Smart Import)

- **Component**: `components/SmartImportWizard.tsx` with steps `StepSource`, `StepParse`, `StepMapping`, `StepConfirm` (`components/smart-import/**`).
- **Inputs**: pasted text or uploaded `.docx` / `.txt` (max 30,000 words, 10 MB; `.doc` rejected) — limits from `messages/en/smartImport.json`.
- **Two split strategies**:
  1. **Marker split (free, no model)**: `src/lib/episode-marker-detector.ts` detects 11 marker families by regex (Chinese 第X集 / 第X章 / 第X幕, `X-Y【scene】`, numbered lines, escaped numbered, number+Chinese, `Episode X`, `Chapter X`, `**N**`, bare number lines) and previews the split. API: `POST .../episodes/split-by-markers`.
  2. **LLM split** (`episode_split_llm`, text queue; `src/lib/workers/handlers/episode-split.ts`, API `POST .../episodes/split`): the prompt asks the model to cut the whole text into length-balanced episodes at natural breakpoints with full, non-overlapping coverage, returning exact start/end marker snippets copied from the source so the server can locate boundaries. Output object: `analysis{totalWords, episodeCount, targetWordsPerEpisode, allowedRange}`, `episodes[]{number, title, summary, estimatedWords, startMarker, endMarker, startIndex, endIndex}`, `validation{maxWords, minWords, variance, isBalanced}`.
- **Outputs**: episode drafts -> `NovelPromotionEpisode` rows via `POST .../episodes/batch`; `NovelPromotionProject.importStatus`.
- **Controls**: edit each episode's title / summary / content, add / delete episodes, re-analyze, confirm; optional "Confirm & analyze assets" that triggers global analysis.
- **Regenerate / undo**: re-analyze replaces the draft list; cancel discards. No history.

### 2.4 Global asset analysis (cross-episode)

- **Task**: `analyze_global` (text queue). `src/lib/workers/handlers/analyze-global.ts` (+ `-prompt`, `-parse`, `-persist`).
- **Inputs**: concatenated text of all episodes, chunked by `CHUNK_SIZE`; existing character / location / prop library names.
- **What it does**: for each chunk, runs the same three extraction prompts as 2.5–2.7 (character profile, location selection, prop selection), then merges into project assets so later per-episode runs reuse canonical names.
- **Outputs**: new `NovelPromotionCharacter` (unconfirmed profile), `NovelPromotionLocation` (kind `location` or `prop`) rows; updates aliases / introductions of existing characters.
- **UI**: "Global Analysis" button in the asset toolbar (`components/assets/AssetToolbar.tsx`), blocking overlay while running (`AssetsStageStatusOverlays.tsx`).
- A simpler single-episode variant `analyze_novel` also exists (`src/lib/workers/handlers/analyze-novel.ts`, API `.../analyze`) using the same three prompts.

### 2.5 Character analysis -> profile (Story->Script step `analyze_characters`)

- **Inputs**: episode text; existing character library info (names, aliases, introductions).
- **Model**: LLM (`analysisModel`). Prompt id `NP_AGENT_CHARACTER_PROFILE` (`lib/prompts/novel-promotion/agent_character_profile.*.txt`).
- **Prompt function**: acts as a casting analyst. Identifies characters that need a visual identity (speakers, actors, plot drivers), drops nameless extras, resolves aliases and first-person narration to canonical names, and fills a structured casting profile used later for visual design. It separately reports brand-new characters and updates to already-known ones.
- **Output**: `characters[]` and `new_characters[]`, each `{name, aliases[], introduction, gender, age_range, role_level (S/A/B/C/D), archetype, personality_tags[], era_period, social_class, occupation, costume_tier (1–5), suggested_colors[], primary_identifier, visual_keywords[], expected_appearances[{id, change_reason}]}`; `updated_characters[]{name, updated_introduction, updated_aliases[]}`.
- **Persistence**: `NovelPromotionCharacter` with `profileData` (JSON) and `profileConfirmed = false`, `aliases`, `introduction` (`src/lib/workers/handlers/story-to-script-helpers.ts` lines 63–85).
- **Queueing**: runs inside the `story_to_script_run` task, in parallel with 2.6 and 2.7 (`src/lib/novel-promotion/story-to-script/orchestrator.ts` lines 286–337).

### 2.6 Location analysis (step `analyze_locations`)

- **Model**: LLM. Prompt id `NP_SELECT_LOCATION` (`select_location.*.txt`).
- **Prompt function**: extracts locations where meaningful action happens, deduplicates aliases, prefers existing library names, and writes three alternative wide-shot environment descriptions per location. It also defines 2–6 **available slots** — full descriptive placement phrases anchored on visible objects — so characters can later be placed consistently in that set.
- **Output**: `locations[]{name, summary, has_crowd, crowd_description, available_slots[], descriptions[3]}`.
- **Persistence**: `NovelPromotionLocation` (`assetKind = 'location'`) + one `LocationImage` row per description carrying `description` and `availableSlots`.

### 2.7 Prop analysis (step `analyze_props`)

- **Model**: LLM. Prompt id `NP_SELECT_PROP` (`select_prop.*.txt`).
- **Prompt function**: a deliberately conservative extractor for key story props that need visual consistency. It applies portability, replaceability and recurrence tests, excludes scene fixtures and ordinary objects, and usually returns few or zero items.
- **Output**: `props[]{name, summary, description}` — `summary` for humans, `description` purely visual for image generation.
- **Persistence**: props are stored as `NovelPromotionLocation` rows with `assetKind = 'prop'` plus a `LocationImage` row holding the description (`story-to-script-helpers.ts` lines 157–200; `src/lib/assets/services/location-backed-assets.ts`).

### 2.8 Clip splitting (step `split_clips`)

- **Inputs**: episode text; character, location and prop library names; character introductions.
- **Model**: LLM. Prompt id `NP_AGENT_CLIP` (`agent_clip.*.txt`).
- **Prompt function**: segments the episode into contiguous, ordered clips at natural scene boundaries with full coverage, without over-splitting. Each clip is identified by exact start and end text snippets copied from the source and is tagged with its location, characters and props using library names.
- **Output**: array of `{start, end, summary, location, characters[], props[]}`.
- **Boundary matching**: `src/lib/novel-promotion/story-to-script/clip-matching.ts` locates the snippets in the source with multiple match levels and a confidence score; if boundaries cannot be matched the split step is retried (`MAX_SPLIT_BOUNDARY_ATTEMPTS = 2`).
- **Persistence**: `NovelPromotionClip` `{startText, endText, summary, location, characters, props, content}`; existing clips are updated in place by position, surplus ones deleted (`story-to-script-helpers.ts` lines 216–267).
- Standalone variant: `clips_build` task (`src/lib/workers/handlers/clips-build.ts`, API `.../clips`).

### 2.9 Screenplay conversion (steps `screenplay_<clipId>`)

- **Model**: LLM, one call per clip, bounded parallelism. Prompt id `NP_SCREENPLAY_CONVERSION` (`screenplay_conversion.*.txt`).
- **Prompt function**: converts one clip's prose into a structured screenplay without adding story facts, keeping source order, resolving aliases to canonical character names and matching locations to the library.
- **Output**: `{clip_id, original_text, scenes[]{scene_number, heading{int_ext, location, time}, description, characters[], content[]}}` where each content item is `action{text}`, `dialogue{character, parenthetical, lines}` or `voiceover{character, text}`.
- **Persistence**: `NovelPromotionClip.screenplay` (JSON string). Partial failure is tolerated and reported (`screenplaySuccessCount` / `screenplayFailedCount` in the orchestrator summary).
- Standalone variant: `screenplay_convert` task (`src/lib/workers/handlers/screenplay-convert.ts`, API `.../screenplay-conversion`).

**Story->Script as a whole**

- **Trigger**: "Start creating" on the Story tab, or `autoRun`. API `POST .../story-to-script-stream`. Task `story_to_script_run`, text queue, **single BullMQ attempt** (`SINGLE_ATTEMPT_TASK_TYPES` in `src/lib/task/queues.ts`) because retries are handled per step.
- **Step graph** (`src/lib/workflow-engine/registry.ts`): `analyze_characters`, `analyze_locations`, `analyze_props` (parallel) -> `split_clips` -> `screenplay_convert` -> `persist_script_artifacts`.
- **Per-step retry**: up to 3 attempts per step when the error is retryable (`MAX_STEP_ATTEMPTS = 3`).
- **Rebuild guard**: if the episode already has storyboards/panels, a confirm dialog warns that downstream data will be cleared (`hooks/useRebuildConfirm.ts`, `messages/en/novel-promotion.json` `rebuildConfirm.*`).
- **Side effect**: sets `workflowMode = 'agent'` on the project (`useWorkspaceExecution.ts` line 195).

### 2.10 Script stage UI: screenplay review and per-clip asset binding

- **Components**: `components/ScriptStage.tsx`, `components/script-view/*` (`ScriptViewScriptPanel`, `ScriptViewAssetsPanel`, `SpotlightCards`), `components/storyboard/ScreenplayDisplay.tsx`.
- **Shows**: clip list ("N clips split"); per clip the formatted screenplay (scene heading INT/EXT + location + time, action / dialogue / narration blocks) with a tab to the original text; "In-Scene Assets" panel listing active characters (with chosen appearance), locations and props for the selected clip or all clips.
- **Editable**: clip content ("Click to edit"), add / remove characters (choosing primary or sub appearance) and locations per clip (`PATCH .../clips/[clipId]`), jump to generate a missing asset.
- **Gate**: a banner counts assets without images and asks the user to generate them before "Confirm and Start Drawing", which launches Script->Storyboard (`messages/en/scriptView.json` `generate.*`).
- The asset library is also available as a modal from the header at any stage (`components/WorkspaceAssetLibraryModal.tsx`, `components/AssetLibrary.tsx`, `components/AssetsStage.tsx`).

### 2.11 Character profile confirmation -> visual descriptions (appearance variants)

- **UI**: `components/assets/CharacterProfileCard.tsx`, `CharacterProfileDialog.tsx`, `hooks/useProfileManagement.ts`. A banner "AI Casting Complete" lists unconfirmed profiles.
- **Editable profile fields**: importance level S–D, archetype, personality tags, costume level 1–5, suggested colors, primary identifier, visual keywords, plus summary of gender / age / era / class / occupation (`messages/en/assets.json` `characterProfile.*`). Actions: Edit profile, Confirm & Generate, Use Existing, Delete, Confirm All.
- **Tasks**: `character_profile_confirm`, `character_profile_batch_confirm` (text queue; `src/lib/workers/handlers/character-profile.ts`; APIs `.../character-profile/confirm`, `.../batch-confirm`).
- **Model**: LLM. Prompt id `NP_AGENT_CHARACTER_VISUAL` (`agent_character_visual.*.txt`).
- **Prompt function**: turns the confirmed casting profile into image-ready appearance descriptions (face, hair, outfit, accessories) that respect era and costume tier and always include the primary identifier, while excluding expression, action, background, and skin / eye / lip colour. It emits one entry per expected appearance: the initial one is self-contained, later ones describe only what changes.
- **Output**: `characters[]{name, appearances[]{id, change_reason, descriptions[3]}}`.
- **Persistence**: one `CharacterAppearance` row per appearance (`appearanceIndex`, `changeReason`, `descriptions` JSON of 3 alternatives); `profileConfirmed = true`.

**Consistency model for characters**

- **Appearance variants**: `CharacterAppearance` rows per character; index 0 is the primary look, higher indexes are sub-appearances with a `changeReason` (e.g. changed clothes, injured). Users can add a sub-appearance manually and are told to describe only the changes ("face/body inherits from primary").
- **Reference chaining**: when generating a sub-appearance image, the primary appearance's main image is passed as a reference image (`src/lib/workers/handlers/character-image-task-handler.ts`, block under "子形象").
- **Panels reference a character by `{name, appearance, slot}`**; the appearance name is matched to `changeReason`.

### 2.12 Asset image generation (characters, locations, props)

| | Character | Location | Prop |
| --- | --- | --- | --- |
| Task | `image_character` | `image_location` | `image_location` with `type: 'prop'` |
| Handler | `handlers/character-image-task-handler.ts` | `handlers/location-image-task-handler.ts` | same |
| Model slot | project `characterModel` | project `locationModel` | project `locationModel` (UNVERIFIED which slot; same handler) |
| Aspect ratio | 3:2 (`CHARACTER_ASSET_IMAGE_RATIO`) | 1:1 (`LOCATION_IMAGE_RATIO`) | 3:2 (`PROP_IMAGE_RATIO`) |
| Prompt | description + fixed character-sheet suffix (front close-up left third, three full-body views right two-thirds, white background) + art style | description + required slot list + wide-shot spatial constraints (`src/lib/location-image-prompt.ts`) + art style | description + prop suffix (isolated asset sheet) + art style |
| Count | default 3, range 1–6 | default 3, range 1–6 | same handler |

- **Model type**: image generation (text-to-image, plus image references for sub-appearances). Queue: image.
- **Count picker**: per-scope stored preference (`src/lib/image-generation/count.ts`, `src/components/image-generation/ImageGenerationInlineCountButton.tsx`).
- **Label bar**: generated project asset images get a text bar burnt on top with "<name> - <appearance>" (`src/lib/image-label.ts`, sharp). When used as references the name is therefore visible to the image model. The bar is cropped off again for global copies (same file, `extract` branch).
- **Outputs**: `CharacterAppearance.imageUrls[]` + `imageUrl` + `selectedIndex`; `LocationImage.imageUrl` + `isSelected`, `NovelPromotionLocation.selectedImageId`.
- **User controls** (`components/assets/**`, `messages/en/assets.json`):
  - Generate / Regenerate single option, Regenerate Group (`regenerate_group` task), Generate All / Regenerate All (batch, `hooks/useBatchGeneration.ts`).
  - Select an option then **Confirm** ("delete others") — `.../character/confirm-selection`, `.../location/confirm-selection`, `.../cleanup-unselected-images`. Editing is only allowed after a selection is confirmed.
  - **Undo to previous version** — restores `previousImageUrl(s)` and `previousDescription(s)` (`POST .../undo-regenerate` -> `/api/assets/[assetId]/revert-render`; `src/lib/assets/services/asset-actions.ts`). One level only.
  - **Edit image** with instruction + optional reference images (`modify_asset_image`, image queue, project `editModel`; `handlers/image-task-handlers-core.ts`). After an image edit, the text description is re-synced by an LLM call (`handlers/modify-description-sync.ts`, prompts `NP_CHARACTER_DESCRIPTION_UPDATE`, `NP_LOCATION_DESCRIPTION_UPDATE`, `NP_PROP_DESCRIPTION_UPDATE`): each takes the old description, the edit instruction and optional image context and returns `{prompt}` (locations also return `available_slots[]`).
  - **AI modify description** without touching the image (`ai_modify_appearance` / `ai_modify_location` / `ai_modify_prop`, text queue; `handlers/shot-ai-prompt-{appearance,location,prop}.ts`; prompts `NP_CHARACTER_MODIFY`, `NP_LOCATION_MODIFY`, `NP_PROP_DESCRIPTION_UPDATE`): rewrites the full description applying only the requested change; returns `{prompt}` (+ `available_slots[]` for locations).
  - **AI design new asset** from a one-line request (`ai_create_character` / `ai_create_location`; `src/lib/asset-utils/ai-design.ts`; prompts `NP_CHARACTER_CREATE`, `NP_LOCATION_CREATE`): returns `{prompt}` for characters, `{prompt, available_slots[]}` for locations.
  - **Upload** own image / upload replacement (`.../upload-asset-image`).
  - **Reference image -> character sheet** (`reference_to_character`; `handlers/reference-to-character.ts`): (a) image-to-image call that redraws an uploaded picture as a clean character sheet in the chosen art style (prompt `CHARACTER_REFERENCE_TO_SHEET`), and (b) a vision LLM call that writes a plain-paragraph appearance description from the image, inferring unseen body parts (prompt `CHARACTER_IMAGE_TO_DESCRIPTION`; output is free text, not JSON).
  - Edit name, introduction (who "I" refers to, how others address them), per-asset art style, aliases; delete appearance / whole character.
  - **Import from Asset Hub** (`.../copy-from-global`, types character / location / voice).
  - Filter by episode, by generated/pending; download all images as ZIP (`.../download-images`).
  - "Click to regenerate (if stuck)" force-regenerate for hung tasks.

### 2.13 Storyboard generation (Script -> Storyboard, multi-phase)

- **Trigger**: "Confirm and Start Drawing". API `POST .../script-to-storyboard-stream`. Task `script_to_storyboard_run`, text queue, single BullMQ attempt.
- **Files**: `src/lib/novel-promotion/script-to-storyboard/orchestrator.ts`, `src/lib/workers/handlers/script-to-storyboard.ts`, `-helpers.ts`, `-atomic-retry.ts`, `src/lib/storyboard-phases.ts`.
- **Parallelism**: clips processed with bounded concurrency = user's `analysis` workflow concurrency (default 5). Within a clip, phase 2a and 2b run in parallel after phase 1; phase 3 after both.
- **Step keys**: `clip_<clipId>_phase1`, `clip_<clipId>_phase2_cinematography`, `clip_<clipId>_phase2_acting`, `clip_<clipId>_phase3_detail`, then `voice_analyze`. UI phase labels: Planning Storyboard, Cinematography Design, Acting Direction, Adding Details (`messages/en/storyboard.json` `phases.*`).
- **Context compiled for the prompts**: character library names, character introduction mapping, appearance list, full appearance descriptions (selected description per appearance), location descriptions including available slots, prop descriptions (`src/lib/assets/services/asset-prompt-context.ts`).

| Phase | Prompt id / file | What the prompt asks | Output fields |
| --- | --- | --- | --- |
| 1 Plan | `NP_AGENT_STORYBOARD_PLAN` / `agent_storyboard_plan` | As a storyboard director, cover the whole clip (screenplay JSON if present, else raw text) with a chronological panel sequence, using library characters / locations and, where a character is stably placed, copying one of the location's slot phrases verbatim. | array of `{panel_number, description, characters[{name, appearance, slot?}], location, scene_type, source_text, shot_type, camera_move, video_prompt, duration}` |
| 2a Cinematography | `NP_AGENT_CINEMATOGRAPHER` / `agent_cinematographer` | For every panel, produce a concise, directly actionable photography rule set that stays continuous across neighbouring panels and adapts to scene type; slots are preferred anchors, not hard limits. | array (exactly panel count) of `{panel_number, composition, lighting, color_palette, atmosphere, technical_notes}` |
| 2b Acting | `NP_AGENT_ACTING_DIRECTION` / `agent_acting_direction` | For every character in every panel, write one observable performance instruction (visible emotion, face, posture, micro-action, gaze), tuned to the scene type. | array (exactly panel count) of `{panel_number, characters[{name, acting}]}` |
| 3 Detail | `NP_AGENT_STORYBOARD_DETAIL` / `agent_storyboard_detail` | Refine each panel's visual description and write a concrete, motion-ready video prompt that refers to actors by age + gender rather than name; keep order, meaning and slots. | array of complete panel objects, same fields as phase 1 with `scene_type` in `daily / emotion / action / epic / suspense` |

- **Persistence** (`script-to-storyboard-helpers.ts`): upsert `NovelPromotionStoryboard` per clip, **delete all its panels and recreate** them; panel fields `panelIndex`, `panelNumber`, `shotType`, `cameraMove`, `description`, `location`, `characters` (JSON), `props`, `srtSegment` (source text), `duration`, `videoPrompt`, `sceneType`, `photographyRules` (JSON from 2a), `actingNotes` (JSON from 2b). `Storyboard.photographyPlan` stores the clip-level plan.
- **Retries**: 3 attempts per step with backoff (`computeRetryDelayMs`); **step-level retry from the UI** re-runs only the failed step and its dependents: retrying phase 1 invalidates 2a, 2b, 3 and voice analysis for that clip; retrying 2a/2b invalidates 3 and voice analysis (`workflow-engine/registry.ts` `resolveScriptToStoryboardInvalidation`, `script-to-storyboard-atomic-retry.ts`, API `POST /api/runs/[runId]/steps/[stepKey]/retry`).
- **Artifacts**: each phase output is stored as a `GraphArtifact` (`storyboard.clip.phase1`, `.phase2.cine`, `.phase2.acting`, `.phase3`, `voice.lines`).

**Storyboard stage UI** (`components/storyboard/**`, `messages/en/storyboard.json`)

- Layout: groups (one per clip/"segment") with header, expand/collapse, failed alert with Retry; panel cards in card or table view.
- Per group: Regenerate Text (`regenerate_storyboard_text` task — reruns the phases for that one storyboard), Generate All / generate missing images, Add Panel, add/insert group, move group, delete group (confirm).
- Per panel editable fields (`PanelEditForm.tsx`, `AIDataModal*.tsx`): shot type, camera move, scene description, video prompt, source text, location (picker), characters with appearance and slot (picker), duration; the **AI Data Editor** modal exposes everything sent to the image model — photography rules (lighting direction/quality, depth of field, colour tone, composition), per-character acting notes, slot, with a JSON preview.
- Panel CRUD: insert before/after, move up/down, delete (confirm), manual add. Saves are debounced through a save coordinator with retry (`hooks/panel-save-coordinator.ts`).
- **AI insert panel** (`insert_panel`, text queue; `src/lib/workers/text.worker.ts` `handleInsertPanelTask`; prompt `NP_AGENT_STORYBOARD_INSERT`): given the previous and next panel plus an optional user note, the model writes exactly one bridging panel with continuous action and staging. Output: a single panel object with the phase-1 fields.
- **AI modify shot prompt** (`ai_modify_shot_prompt`; `handlers/shot-ai-prompt-shot.ts`; prompt `NP_IMAGE_PROMPT_MODIFY`): rewrites the panel's image prompt and video prompt per a user instruction, which may `@`-mention library assets. Output `{image_prompt, video_prompt}`.
- Header: counts, Generate All Panels / Generate N panels without images, Download All (ZIP), concurrency-limit indicator, "Generate Video ->".

### 2.14 Panel image generation, candidates, variants, edit

- **Task**: `image_panel` (image queue). Handler `src/lib/workers/handlers/panel-image-task-handler.ts`. API `.../generate-image`, `.../regenerate-panel-image`, `.../regenerate-single-image`.
- **Model type**: image generation with multiple reference images, project `storyboardModel`. Aspect ratio = project `videoRatio`.
- **Prompt** (id `NP_SINGLE_PANEL_IMAGE`, `single_panel_image.*.txt`): instructs the image model to render exactly one clean frame (no text, no collage) at the given ratio from a JSON context, treating slots as preferred anchors and using references for identity/style only; source text wins over the storyboard if they conflict.
- **Context JSON sent** (`buildPanelPromptContext`): `panel{panel_id, shot_type, camera_move, description, image_prompt, video_prompt, location, characters[], source_text, photography_rules, acting_notes}` + `context{character_appearances[{name, appearance, description, slot}], location_reference{name, description, available_slots[]}}`.
- **Reference images** (`collectPanelReferenceImages` in `handlers/image-task-handler-shared.ts`): panel sketch image if any, each panel character's selected image for the named appearance, the location's selected image. **Prop images are not included** in the reference set (only prop text reaches the storyboard prompts) — verified in that function.
- **Candidates**: `candidateCount` 1–4 (default 1). First generation: candidate 0 becomes `imageUrl`, list stored in `candidateImages` if more than one. Regeneration: current image copied to `previousImageUrl`, new images stored in `candidateImages` only, and the user must pick.
- **Candidate selection** (`POST .../panel/select-candidate`, `components/storyboard/CandidateSelector.tsx`, `ImageSectionCandidateMode.tsx`): `action: 'select'` sets `imageUrl`, appends to `imageHistory`, clears candidates; `action: 'cancel'` clears candidates and keeps the current image.
- **Undo**: the panel card renders an "Undo to Previous Version" button when `previousImageUrl` exists (`ImageSectionActionButtons.tsx`), but no handler supplying `onUndo` was found in the storyboard component tree and there is no panel undo route — panel image undo is UNVERIFIED / likely UNWIRED. `imageHistory` is written but no UI reading it was found (UNVERIFIED).
- **Shot variants** (`components/storyboard/PanelVariantModal*.tsx`):
  - Analyse: `analyze_shot_variants` (text queue; `handlers/shot-ai-variants.ts`; prompt `NP_AGENT_SHOT_VARIANT_ANALYSIS`) — proposes at least three producible alternative shots for the panel that keep story, identity and location. Output array `{id, title, description, shot_type, camera_move, video_prompt, creative_score}`.
  - Generate: `panel_variant` (image queue; `handlers/panel-variant-task-handler.ts`; prompt `NP_AGENT_SHOT_VARIANT_GENERATE`) — creates a **new panel inserted after** the source and renders it using the source panel image plus optional character/location references (toggles "Include character reference", "Include location reference"); the prompt tells the image model to change framing/angle only. Custom free-text variant is also supported.
- **Edit image** (`modify_asset_image` via `.../modify-storyboard-image`, `components/storyboard/ImageEditModal*.tsx`): instruction + optional uploaded/pasted reference images + selected library assets; prompt `NP_STORYBOARD_EDIT` is declared in the prompt registry but the exact call site was not traced (UNVERIFIED).
- **Batch**: generate all missing panels with client-side concurrency and a success/failed summary (`hooks/useStoryboardBatchPanelGeneration.ts`).
- **Download**: all panel images as ZIP (`.../download-images`).
- Legacy: `NovelPromotionShot`, `SupplementaryPanel`, `Storyboard.storyboardImageUrl` / `panelCount` (grid storyboard) remain in the schema; a "prompts stage" (`components/prompts-stage/**`, shot table with SRT append) exists as components but is not routed in `WorkspaceStageContent.tsx` — UNWIRED / legacy.

### 2.15 Panel video generation (normal and first/last frame)

- **Task**: `video_panel` (video queue). Handler in `src/lib/workers/video.worker.ts`. API `POST .../generate-video` (single or `all: true` batch; dedupe key `video_panel:<panelId>`).
- **Model type**: image-to-video. The model is **required in the request payload** (`payload.videoModel`), chosen per panel or in the batch dialog; not silently defaulted.
- **Inputs**: panel `imageUrl` (as base64 first frame), prompt resolved in priority order: first/last custom prompt -> stored `firstLastFramePrompt` -> custom prompt -> `videoPrompt` -> `description`; project `videoRatio`; generation options (duration, resolution, fps, generateAudio, generation mode) validated against the model's capability metadata and pricing tiers.
- **First/last-frame mode**: the user **links** a panel to the next one (`linkedToNextPanel`, `POST .../panel-link`); generation then sends the next panel's image as the last frame. Requires a model whose capability has `firstlastframe: true`, else error `VIDEO_FIRSTLASTFRAME_MODEL_UNSUPPORTED`. A separate first/last-frame model and prompt can be chosen (`components/video/FirstLastFramePanel.tsx`, `src/lib/novel-promotion/stages/video-stage-runtime/useVideoFirstLastFrameFlow.ts`, `useVideoPanelLinking.ts`).
- **Native audio**: `generateAudio` toggle for models that support it ("With Audio").
- **Batch mode**: Ark `-batch` model variants (offline inference, cheaper, up to 24 h) surfaced as a toggle (`messages/en/video.json` `panelCard.batchMode*`).
- **Outputs**: `Panel.videoUrl`, `Panel.videoGenerationMode` (`normal` | `firstlastframe`). Regenerating overwrites; **no video candidates and no video undo**.
- **UI** (`components/video/**`, `components/video-stage/**`, `messages/en/video.json`): panel cards with image preview / player, model picker with capability-driven parameter controls, edit video prompt (modal with tip that video models do not know character names), Generate / Regenerate / Force regenerate (if stuck) / Retry failed, filter (all / generated / pending / failed), counts, jump to shot, Generate All with a batch config dialog, Download (single) and Download All (ZIP).
- **Provider polling**: generators submit and poll external jobs; the external id is stored on the task (`Task.externalId`) so a retried job resumes polling instead of resubmitting (`src/lib/async-submit.ts`, `async-poll.ts`, `src/lib/workers/utils.ts`).

### 2.16 Voice: analysis, speaker voices, voice design, TTS, lip-sync

**Voice-line analysis**

- Runs as the `voice_analyze` step at the end of Script->Storyboard, and standalone as task `voice_analyze` (text queue; `src/lib/workers/handlers/voice-analyze.ts`; API `.../voice-analyze`; UI "Analyze Lines" / "Re-analyze").
- **Model**: LLM. Prompt id `NP_VOICE_ANALYSIS` (`voice_analysis.*.txt`).
- **Prompt function**: extracts only the lines that should be voiced (direct speech, quoted speech, voiced inner speech — not narration or action), assigns each to a canonical speaker, estimates emotion intensity, and maps each line to the storyboard panel where it is spoken using order, speaker and meaning.
- **Output**: array `{lineIndex, speaker, content, emotionStrength (0.1–0.5), matchedPanel{storyboardId, panelIndex} | null}`.
- **Persistence**: upsert `NovelPromotionVoiceLine` by `(episodeId, lineIndex)`, delete stale lines; sets `matchedPanelId`, `matchedStoryboardId`, `matchedPanelIndex`. Up to `MAX_VOICE_ANALYZE_ATTEMPTS` tries.

**Speaker voices** (`components/voice/SpeakerVoiceBindingDialog.tsx`, `SpeakerVoiceStatus.tsx`, `src/lib/voice/provider-voice-binding.ts`)

- A speaker's voice comes from the matching character (`customVoiceUrl` reference audio, or `voiceId`) or, for speakers not in the asset library, from the episode-level map `NovelPromotionEpisode.speakerVoices` (JSON `speaker -> {provider: 'fal', audioUrl}` or `{provider: 'bailian', voiceId, previewAudioUrl}`; API `GET/PATCH .../speaker-voice`).
- Three ways to set a voice: upload reference audio (MP3/WAV/OGG/M4A/AAC, max 50 MB), pick from the global voice library, or AI voice design.
- Constraint surfaced in UI and enforced in code: uploaded reference audio works only with the FAL IndexTTS path; Bailian Qwen TTS needs a designed voice id (`src/lib/voice/generate-voice-line.ts` lines 204–212).

**Voice design** (`voice_design`, `asset_hub_voice_design`; voice queue; `src/lib/workers/handlers/voice-design.ts`, `src/lib/providers/bailian/voice-design.ts`)

- **Model type**: text-to-voice design (Bailian `qwen-voice-design`). Not an LLM prompt: inputs are a natural-language voice description, a preview sentence, a preferred name and language (`zh` | `en`), validated for length.
- **Output**: `voiceId`, target TTS model, preview audio (base64), sample rate, format.
- **UI** (`src/components/voice/VoiceDesignDialogBase.tsx`, `VoiceDesignGeneratorSection.tsx`): six style presets (male broadcaster, gentle female, mature male, lively girl, intellectual female, narrator) or custom description, editable preview text, generate N schemes (UI text says 3), listen to each, Confirm Use; replacing an existing voice asks for confirmation ("irreversible").
- Cleanup helpers for provider-side voices exist (`src/lib/providers/bailian/voice-cleanup.ts`, `voice-manage.ts`).

**TTS per line** (`voice_line`, voice queue; `src/lib/workers/voice.worker.ts`, `src/lib/voice/generate-voice-line.ts`; API `.../voice-generate` single or `all: true`)

- **Model type**: TTS, project `audioModel` (or per-request `audioModel`). Two provider paths:
  - FAL `fal-ai/index-tts-2/text-to-speech`: zero-shot cloning from reference audio; inputs text, reference audio, `emotion_prompt`, emotion strength (default 0.4).
  - Bailian `qwen3-tts-vd-2026-01-26`: synthesis with a designed `voiceId`.
- **Outputs**: `VoiceLine.audioUrl`, `audioDuration` (ms).
- **UI** (`components/voice/VoiceLineCard.tsx`, `EmotionSettingsPanel.tsx`, `VoiceToolbar.tsx`, `EmbeddedVoiceToolbar.tsx`): add / edit / delete line, edit speaker and content, **bind line to a shot**, emotion prompt (free text; empty = auto) and emotion strength slider (flat <-> intense), generate / regenerate one, Generate All (pending only), play, delete audio, locate bound shot, download all voices as ZIP (`.../download-voices`). No candidates, no undo (delete audio and regenerate).
- `ttsRate` exists on project / preference (default `+50%`) and `TTS_VOICES` lists Microsoft neural voices in `src/lib/constants.ts`, with "Microsoft Voice" strings in `messages/en/voice.json`; an Edge-TTS execution path was not found in `generate-voice-line.ts` — legacy / UNVERIFIED.

**Lip-sync** (`lip_sync`, video queue; `handleLipSyncTask` in `src/lib/workers/video.worker.ts`; `src/lib/lipsync/**`; API `.../lip-sync`)

- **Model type**: audio-driven video re-talk. User default `lipSyncModel` or per-request model. Providers: FAL (`fal-ai/kling-video/lipsync/audio-to-video`), Vidu (`vidu-lipsync`, endpoint `https://api.vidu.cn/ent/v2/lip-sync`), Bailian (`videoretalk`, with upload to Bailian temp storage first).
- **Inputs**: panel `videoUrl` + a chosen voice line's `audioUrl` (both signed for 2 h), known audio and video durations.
- **Pre-processing** (`src/lib/lipsync/preprocess.ts`): WAV audio shorter than 2 s is padded with silence to 2 s; audio longer than the video is trimmed to the video length. UI shows "(will auto-pad)".
- **Output**: `Panel.lipSyncVideoUrl` (original `videoUrl` is kept; card toggles Original / Synced). "Regenerate Lip Sync" overwrites.
- **UI** (`components/video/panel-card/runtime/hooks/usePanelLipSync.ts`, `usePanelVoiceManager.ts`): on a video card, pick which matched voice line to use, generate missing audio inline, start lip-sync; guards "generate video first" / "generate audio first".

**Subtitles**

- `src/lib/srt.ts` (parse, slice, duration, validate, extract text) and columns `Episode.srtContent`, `Panel.srtSegment / srtStart / srtEnd`, `Shot.srtStart/End` exist. In the current flow `srtSegment` just stores the panel's source text. `lib/srt` is imported by no pipeline file; `srtContent` is only read/written by the episode route and typed in the client. Strings "SRT Subtitle Preview" exist under `voice.tts.*` (legacy TTS-first flow). **No subtitle generation, styling or burn-in is active** — legacy / UNWIRED. The unwired editor defines a per-clip subtitle `{text, style: 'default' | 'cinematic'}`.

**Music / SFX**

- NOT PRESENT in the live pipeline. The only matches are the unwired editor's BGM track type and a `bgm` option inside the Vidu generator (`src/lib/generators/vidu.ts`). Video models with `generateAudio` can produce native ambient audio.

### 2.17 Editing / composition / timeline

- **Code present** (`src/features/video-editor/**`, ~1,960 lines): data model `VideoEditorProject {schemaVersion '1.0', config{fps,width,height}, timeline: VideoClip[], bgmTrack: BgmClip[]}`; `VideoClip {src, durationInFrames, trim{from,to}, attachment{audio{src,volume,voiceLineId}, subtitle{text,style}}, transition{type: none|dissolve|fade|slide, durationInFrames}, metadata{panelId, storyboardId}}`; magnetic single video track + attached voice + BGM track; Remotion composition and transitions; timeline with zoom and drag (dnd-kit); preview player; properties panel; `createProjectFromPanels` to seed from generated panels; Save and "Export Video".
- **Persistence API exists**: `GET/PUT/DELETE /api/novel-promotion/[projectId]/editor` stores `VideoEditorProject.projectData` (JSON).
- **Status at this tag — UNWIRED**:
  - No file outside `src/features/video-editor` imports it (repo-wide grep).
  - The "AI Editor" nav item is hard-disabled with "Coming soon" (`useWorkspaceStageNavigation.ts`).
  - `stage=editor` is redirected to `videos` (`page.tsx`).
  - The "Enter Editor" toolbar button only renders when `onEnterEditor` is passed, and nothing passes it.
  - The export call targets `/api/novel-promotion/[projectId]/editor/render`, **which does not exist** (only `editor/route.ts`). No server-side Remotion render or ffmpeg composition exists. `VideoEditorProject.renderStatus / renderTaskId / outputUrl` are never written.

### 2.18 Export / download

- ZIP of all panel videos for an episode/project: `GET/POST .../download-videos` — server streams an `archiver` ZIP named `<project>_videos.zip`; for each panel it prefers the lip-synced video over the raw one (or the reverse depending on a flag; lines 131–141).
- ZIP of images (`.../download-images`) and voices (`.../download-voices`); single video download via `.../video-proxy`; URL list via `.../video-urls`. Client-side packing progress in `src/lib/novel-promotion/stages/video-stage-runtime/useVideoDownloadAll.ts`.
- **No single merged final film file is produced at this tag.**

---

## 3. Data model (`prisma/schema.prisma`, MySQL, 1001 lines)

JSON-ish values are stored as `String @db.Text` and parsed in code unless noted.

### 3.1 Identity

| Model | Key fields | Notes |
| --- | --- | --- |
| `User` | `name` (unique login), `email?`, `password?` | relations to everything user-owned |
| `Account`, `Session`, `VerificationToken` | NextAuth standard | sessions actually JWT |
| `UserPreference` (1:1) | default models: `analysisModel`, `characterModel`, `locationModel`, `storyboardModel`, `editModel`, `videoModel`, `audioModel`, `lipSyncModel`, `voiceDesignModel`; `analysisConcurrency`, `imageConcurrency`, `videoConcurrency`; `videoRatio` (9:16), `videoResolution` (720p), `imageResolution` (2K), `artStyle`, `ttsRate`; `capabilityDefaults`; `customModels`, `customProviders` (JSON); legacy key columns `llmBaseUrl`, `llmApiKey`, `falApiKey`, `googleAiKey`, `arkApiKey`, `qwenApiKey` | API config lives here |

### 3.2 Project and pipeline

| Model | Key fields | Relations |
| --- | --- | --- |
| `Project` | `name`, `description`, `userId`, `lastAccessedAt` | 1:1 `NovelPromotionProject`; `UsageCost[]` |
| `NovelPromotionProject` | model overrides (`analysisModel`, `imageModel`, `characterModel`, `locationModel`, `storyboardModel`, `editModel`, `videoModel`, `audioModel`), `videoRatio`, `videoResolution`, `imageResolution`, `ttsRate`, `artStyle`, `artStylePrompt`, `globalAssetText`, `capabilityOverrides`, `workflowMode` (default `srt`, set to `agent` by the new flow), `lastEpisodeId`, `importStatus` | `characters[]`, `locations[]`, `episodes[]` |
| `NovelPromotionEpisode` | `episodeNumber` (unique per project), `name`, `description`, `novelText`, `audioUrl`/`audioMediaId` (legacy narration audio), `srtContent` (legacy), `speakerVoices` | `clips[]`, `storyboards[]`, `shots[]`, `voiceLines[]`, `editorProject?` |
| `NovelPromotionClip` | `startText`, `endText`, `summary`, `location`, `characters`, `props`, `content`, `screenplay`, `start/end/duration` (legacy SRT ints), `shotCount` | `storyboard?` (1:1), `shots[]` |
| `NovelPromotionStoryboard` | `clipId` (unique), `episodeId`, `panelCount` (default 9, legacy grid), `storyboardTextJson`, `storyboardImageUrl`, `imageHistory`, `candidateImages`, `photographyPlan`, `lastError` | `panels[]`, `supplementaryPanels[]` |
| `NovelPromotionPanel` | `panelIndex` (unique per storyboard), `panelNumber`, `shotType`, `cameraMove`, `description`, `location`, `characters`, `props`, `srtSegment`, `srtStart`, `srtEnd`, `duration`, `sceneType`, `photographyRules`, `actingNotes`, `imagePrompt`, `imageUrl`/`imageMediaId`, `candidateImages`, `imageHistory`, `previousImageUrl`/`previousImageMediaId`, `sketchImageUrl`/`sketchImageMediaId`, `videoPrompt`, `firstLastFramePrompt`, `videoUrl`/`videoMediaId`, `videoGenerationMode`, `linkedToNextPanel`, `lipSyncTaskId`, `lipSyncVideoUrl`/`lipSyncVideoMediaId` | `matchedVoiceLines[]` |
| `NovelPromotionVoiceLine` | `lineIndex` (unique per episode), `speaker`, `content`, `emotionPrompt`, `emotionStrength` (default 0.4), `audioUrl`/`audioMediaId`, `audioDuration`, `voicePresetId`, `matchedPanelId`, `matchedStoryboardId`, `matchedPanelIndex` | -> `Panel?` |
| `NovelPromotionCharacter` | `name`, `aliases`, `introduction`, `profileData`, `profileConfirmed`, `voiceId`, `voiceType`, `customVoiceUrl`/`customVoiceMediaId`, `sourceGlobalCharacterId` | `appearances[]` |
| `CharacterAppearance` | `appearanceIndex` (unique per character), `changeReason`, `description`, `descriptions` (array), `imageUrl`, `imageUrls` (array), `selectedIndex`, `previousImageUrl(s)`, `previousDescription(s)` | |
| `NovelPromotionLocation` | `name`, `summary`, `assetKind` (`location` | `prop`), `selectedImageId`, `sourceGlobalLocationId` | `images[]`, `selectedImage?` |
| `LocationImage` | `imageIndex` (unique per location), `description`, `availableSlots`, `imageUrl`, `isSelected`, `previousImageUrl`, `previousDescription` | |
| `VideoEditorProject` | `episodeId` (unique), `projectData`, `renderStatus`, `renderTaskId`, `outputUrl` | unwired |
| `NovelPromotionShot` | SRT-era shot (`srtStart/End`, `imagePrompt`, `scale`, `module`, `focus`, `pov`...) | legacy |
| `SupplementaryPanel` | `sourceType`, `sourcePanelId`, `description`, `imagePrompt`, `imageUrl` | legacy / usage UNVERIFIED |
| `VoicePreset` | `name`, `audioUrl`, `gender`, `isSystem` | usage UNVERIFIED |

### 3.3 Global asset hub

`GlobalAssetFolder` (per user) -> `GlobalCharacter` (+ `GlobalCharacterAppearance`, same shape as project appearance plus per-appearance `artStyle`, `globalVoiceId`), `GlobalLocation` (+ `GlobalLocationImage`; `assetKind` location/prop; `artStyle`), `GlobalVoice` (`voiceId`, `voiceType` `qwen-designed` | `custom`, `customVoiceUrl`, `voicePrompt`, `gender`, `language`).

### 3.4 Media

`MediaObject` — `publicId` (unique), `storageKey` (unique), `sha256`, `mimeType`, `sizeBytes`, `width`, `height`, `durationMs`; referenced by ~19 `*MediaId` foreign keys. `LegacyMediaRefBackup` is migration support.

### 3.5 Tasks and runs

| Model | Key fields |
| --- | --- |
| `Task` | `type`, `targetType`, `targetId`, `status`, `progress`, `attempt`, `maxAttempts` (5), `priority`, `dedupeKey` (unique), `externalId`, `payload`, `result`, `errorCode`, `errorMessage`, `billingInfo`, `billedAt`, `queuedAt/startedAt/finishedAt`, `heartbeatAt`, `enqueuedAt`, `enqueueAttempts`, `lastEnqueueError` |
| `TaskEvent` | autoincrement id, `taskId`, `projectId`, `eventType`, `payload` — the SSE replay log |
| `GraphRun` | `workflowType`, `taskType`, `taskId` (unique), target, `status`, `input`, `output`, `cancelRequestedAt`, `leaseOwner`, `leaseExpiresAt`, `heartbeatAt`, `workflowVersion`, `lastSeq` |
| `GraphStep` | `(runId, stepKey)` unique, `stepTitle`, `status`, `currentAttempt`, `stepIndex`, `stepTotal`, last error |
| `GraphStepAttempt` | `(runId, stepKey, attempt)` unique, `provider`, `modelKey`, `inputHash`, `input`, `outputText`, `outputReasoning`, `usageJson`, error |
| `GraphEvent` | `(runId, seq)` unique, `eventType`, `stepKey`, `attempt`, `lane` (`text` | `reasoning`), `payload` |
| `GraphCheckpoint` | `(runId, nodeKey, version)` unique, `stateJson`, `stateBytes` (max 64 KB) |
| `GraphArtifact` | `(runId, stepKey, artifactType, refId)` unique, `versionHash`, `payload` |

### 3.6 Billing

`UserBalance` (`balance`, `frozenAmount`, `totalSpent`, Decimal 18,6), `BalanceFreeze` (`amount`, `status`, `taskId`, `idempotencyKey` unique, `expiresAt`), `BalanceTransaction` (`type`, `amount`, `balanceAfter`, `freezeId`, `projectId`, `episodeId`, `taskType`, `billingMeta`, unique `(userId, type, idempotencyKey)`), `UsageCost` (`apiType`, `model`, `action`, `quantity`, `unit`, `cost`, `metadata`).

---

## 4. Provider / model configuration

### 4.1 Model types and keys

- Five unified model types: `llm`, `image`, `video`, `audio`, `lipsync` (`src/lib/model-config-contract.ts`).
- A model key is `provider::modelId` (`encodeModelKey` in `src/app/[locale]/profile/components/api-config/types.ts`). Guard scripts forbid guessing a provider from a bare model id (`scripts/guards/no-provider-guessing.mjs`, `no-model-key-downgrade.mjs`).

### 4.2 Providers

Preset providers (`PRESET_PROVIDERS` in `.../api-config/types.ts`): Volcengine Ark, Google AI Studio, Alibaba Bailian, OpenRouter, MiniMax Hailuo, Vidu, FAL. SiliconFlow has adapters and a display name but an empty catalog (`src/lib/providers/siliconflow/catalog.ts`). User-added providers can be `openai-compatible` or `gemini-compatible` with a base URL; a provider has `apiMode` (`gemini-sdk` | `openai-official`) and `gatewayRoute` (`official` | `openai-compat`).

| Type | Provider -> adapter | Preset models (from `PRESET_MODELS`) |
| --- | --- | --- |
| LLM | `src/lib/llm/providers/{ark,google,openai-compat}.ts`, `src/lib/model-gateway/**` | OpenRouter (Gemini 3.x, Claude Sonnet 4 / 4.5, GPT-5.4), Google (Gemini 3.1 Pro, 3 Flash, 3.1 Flash-Lite), Ark (Doubao Seed 1.6 / 1.8 / 2.0), Bailian (Qwen 3.5 Plus / Flash), MiniMax (M2 / M2.1 / M2.5) |
| Image | `src/lib/generators/factory.ts` `createImageGenerator`: fal, google (Gemini image, Gemini batch, Imagen), ark (Seedream), gemini-compatible, openai-compatible, bailian, siliconflow | FAL Banana Pro / Banana 2; Ark Seedream 4.0 / 4.5 / 5.0 Lite; Google Gemini 3 Pro Image (+batch), 3.1 Flash Image, 2.5 Flash Image, Imagen 4 / Ultra / Fast |
| Video | `createVideoGenerator`: fal, ark (Seedance), google (Veo), gemini-compatible, minimax, vidu, openai-compatible, bailian, siliconflow | Ark Seedance 1.0 Pro / Pro Fast / Lite, 1.5 Pro, 2.0, 2.0 Fast (+ `-batch` variants); Google Veo 2.0 / 3.0 / 3.1; Bailian Wan 2.2–2.7 i2v and kf2v; FAL Wan 2.6, Veo 3.1, Sora 2, Kling 2.5 Turbo Pro / 3 Standard / 3 Pro; MiniMax Hailuo 02 / 2.3 / 2.3 Fast, T2V-01(-director); Vidu Q1 / Q1 Classic / Q2 Pro / Pro Fast / Turbo / Q3 Pro / 2.0 |
| Audio (TTS) | `createAudioGenerator`: bailian, siliconflow; FAL IndexTTS called directly in `src/lib/voice/generate-voice-line.ts` | FAL IndexTTS 2; Bailian Qwen3 TTS; Bailian Qwen Voice Design |
| Lip-sync | `src/lib/lipsync/providers/{fal,vidu,bailian}.ts` | FAL Kling Lip Sync; Vidu Lip Sync; Bailian VideoRetalk |

OpenAI-compatible media: because third-party image/video endpoints differ, a per-model **media template** describes request/response mapping (`src/lib/openai-compat-media-template.ts`, `openai-compat-template-runtime.ts`, `src/lib/model-gateway/openai-compat/template-{image,video}.ts`). LLM protocol (`responses` vs `chat-completions`) is probed and cached per model (`/api/user/api-config/probe-model-llm-protocol`).

### 4.3 Per-capability model selection and capability metadata

- **Selection slots**: user defaults in `UserPreference`, project overrides in `NovelPromotionProject`: analysis (LLM), character image, location image, storyboard image, edit image, video, audio (TTS), lip-sync (user-level only), voice design (user-level only). Resolution: `src/lib/config-service.ts`, `src/lib/api-config.ts` `resolveModelSelection` / `resolveModelSelectionOrSingle`.
- **Capability catalog**: `standards/capabilities/image-video.catalog.json` (52 entries: image 8, video 37, LLM 7), loaded by `src/lib/model-capabilities/catalog.ts`, queried by `lookup.ts`. Guard `no-hardcoded-model-capabilities.mjs` forbids hard-coding these in code.
- **Capability fields** (`model-config-contract.ts`):
  - LLM: `reasoningEffortOptions[]`
  - Image: `resolutionOptions[]` (e.g. `1K`, `2K`, `4K`)
  - Video: `generationModeOptions[]` (`normal`, `firstlastframe`), `generateAudioOptions[]`, `durationOptions[]` (seconds), `fpsOptions[]`, `resolutionOptions[]` (e.g. `480p`, `720p`, `1080p`), `firstlastframe`, `supportGenerateAudio`
  - Audio: `voiceOptions[]`, `rateOptions[]`
  - Lip-sync: `modeOptions[]`
  - each with optional `fieldI18n` label/unit keys
  - Example (Seedance 2.0): modes normal + firstlastframe, audio on/off, durations 4–15 s, resolutions 480p/720p.
- **Aspect ratio** is not a per-model capability: it is the project-level `videoRatio` (10 ratios), adapted per provider by `src/lib/generators/resolution-adapter.ts`. Combination validity for video is computed in `src/lib/model-capabilities/video-effective.ts`.
- **Selections**: `capabilityDefaults` (user) and `capabilityOverrides` (project) are `{ modelKey: { field: value } }`, validated against the catalog (error codes `CAPABILITY_VALUE_NOT_ALLOWED` etc.).

### 4.4 API-key storage

- Keys are entered per user in Profile -> API Configuration and stored inside `UserPreference.customProviders` (JSON), encrypted with AES-256-GCM using a key derived by PBKDF2 (100k iterations, SHA-256) from `API_ENCRYPTION_KEY` or `NEXTAUTH_SECRET` (`src/lib/crypto-utils.ts`).
- The shipped default `API_ENCRYPTION_KEY` is a fixed public string in both `.env.example` and `docker-compose.yml` — anyone deploying must change it.
- API returns `hasApiKey` instead of the key; test endpoints `/api/user/api-config/test-connection`, `/test-provider`.

### 4.5 Pricing, billing, credits

- **Mode**: env `BILLING_MODE` = `OFF` (default) | `SHADOW` (record usage, do not charge) | `ENFORCE` (`src/lib/billing/mode.ts`). Profile shows "Open-source edition, no billing required" when off.
- **Pricing catalog**: `standards/pricing/image-video.pricing.json` (71 entries; apiTypes text, image, video, voice, voice-design, lip-sync). Two modes: `flat` (23) and `capability` (48) with `tiers[]{when{...}, amount}` keyed on token type (input/output) or capability values such as resolution, duration, audio (`src/lib/model-pricing/catalog.ts`, `lookup.ts`, `video-tier.ts`).
- **Custom model pricing**: user-defined models can carry `customPricing` (`llm{inputPerMillion, outputPerMillion}`, `image|video{basePrice, optionPrices}`).
- **Cost functions** (`src/lib/billing/cost.ts`): `calcText`, `calcImage`, `calcVideo`, `calcVideoByTokens`, `calcVoice` (per second), `calcVoiceDesign` (per call), `calcLipSync`; units `token | image | video | second | call`; `USD_TO_CNY = 7.2`; all markups 1.0.
- **Flow** (`src/lib/billing/service.ts`, `ledger.ts`, `src/lib/task/submitter.ts`): at submit, quote max cost and **freeze** balance (idempotent by key); insufficient funds fails the task with `INSUFFICIENT_BALANCE`; on success **settle** actual usage (LLM tokens, actual video tokens) into `BalanceTransaction` + `UsageCost`; on failure/cancel **rollback** the freeze. Compensation failure is surfaced as `BILLING_COMPENSATION_FAILED`.
- **All 40 task types are declared billable** (`src/lib/billing/task-policy.ts`).
- **Top-up**: `addBalance` exists in the ledger; no payment gateway or recharge route was found (UNVERIFIED how balances are credited). Maintenance scripts: `billing:cleanup-pending-freezes`, `billing:reconcile-ledger`.
- **Reporting**: `/api/user/balance`, `/api/user/costs`, `/api/user/costs/details`, `/api/user/transactions`, `/api/projects/[projectId]/costs`.

### 4.6 Concurrency limits

| Level | Mechanism | Default |
| --- | --- | --- |
| Queue worker | BullMQ `concurrency` from env `QUEUE_CONCURRENCY_*` | env example 50/50/20/50; code fallback image 20, video 4, voice 10, text 10 |
| Per user, per scope | In-process gate keyed by user for `image` and `video` (`src/lib/workers/user-concurrency-gate.ts`), limit from user's `imageConcurrency` / `videoConcurrency` | 5 each (`src/lib/workflow-concurrency.ts`) |
| Inside LLM workflows | `mapWithConcurrency` with user's `analysisConcurrency` | 5 |
| Duplicate suppression | `Task.dedupeKey` per target (e.g. `video_panel:<panelId>`) | n/a |

The per-user gate is an in-memory `Map`, so it only holds within one worker process. Configured in API Config as `workflowConcurrency{analysis, image, video}`.

---

## 5. User-facing screens and features

| Screen | Route / file | Features |
| --- | --- | --- |
| Landing | `src/app/[locale]/page.tsx` | marketing page (`messages/*/landing.json`) |
| Sign in / Sign up | `src/app/[locale]/auth/{signin,signup}/page.tsx` | username + password, strength indicator |
| Home | `src/app/[locale]/home/page.tsx` | typewriter hero, story composer with ratio/style pickers, "AI write" modal, "Start creation" (creates project and auto-runs Story->Script), recent projects |
| Project list | `src/app/[locale]/workspace/page.tsx` | paginated grid, search, create / edit / delete project, prompt to configure an analysis model |
| Project workspace | `src/app/[locale]/workspace/[projectId]/page.tsx` + `modes/novel-promotion/**` | episode sidebar/selector (`components/Sidebar.tsx`, add / rename / delete / switch episode), capsule stage nav, top actions (Asset Library, Project Config, Refresh), LLM run stream consoles, rebuild confirm dialog |
| Story stage | `components/ConfigStage.tsx` | section 2.2 / 2.3 |
| Script stage | `components/ScriptStage.tsx` | section 2.10 |
| Asset library (modal) | `components/AssetLibrary.tsx`, `AssetsStage.tsx`, `components/assets/**` | sections 2.11 / 2.12; character voice settings |
| Storyboard stage | `components/StoryboardStage.tsx`, `components/storyboard/**` | sections 2.13 / 2.14 |
| Video stage | `components/VideoStageRoute.tsx`, `components/video/**`, `components/video-stage/**` | sections 2.15 / 2.16 (embedded voice) |
| Voice stage | `components/VoiceStageRoute.tsx`, `components/voice-stage/**`, `components/voice/**` | standalone line list + control panel; reachable by URL `?stage=voice` (nav entry UNVERIFIED) |
| Editor | `src/features/video-editor/**` | UNWIRED (section 2.17) |
| Asset Hub (global) | `src/app/[locale]/workspace/asset-hub/page.tsx` | folders (create/rename/delete), tabs All / Characters / Locations / Props / Voices, add via manual form, AI design, or reference upload -> 3-view sheet; generate / regenerate / select / undo / edit image; character voice binding; voice creation (AI design or upload); voice picker; download all as ZIP. Uses the user's default models |
| Asset picker | `/api/asset-hub/picker`, `messages/*/assetPicker.json` | pick global assets from inside a project |
| Profile | `src/app/[locale]/profile/page.tsx` | balance / frozen / total spent, billing records with filters by type and action, per-project cost breakdown, transactions, download logs (`/api/admin/download-logs`), logout |
| API Configuration | `profile/components/api-config/**`, `api-config-tab/**` | provider cards (key, base URL, advanced fields), add custom provider, enable/disable models, add custom model with pricing and capabilities, default model cards per capability slot, capability defaults, workflow concurrency, connection test, protocol probe |
| Model template assistant | `provider-card/ModelTemplateAssistantModal.tsx`, `src/components/assistant/AssistantChatModal.tsx` | chat assistant (section 5.1) |
| Language switcher, update notice | `src/components/LanguageSwitcher.tsx`, `UpdateNoticeModal.tsx`, `src/lib/update-check.ts` | zh/en; new-version notice |
| Dev pages | `src/app/[locale]/dev/**` | internal UI experiments |
| Bull Board | port 3010 `/admin/queues` | operator queue dashboard |

### 5.1 Assistant / agent features

There is **no project-level creative agent** at this tag. The only assistant is a settings helper (`src/lib/assistant-platform/**`, API `/api/user/assistant/chat`, Vercel `ai` SDK with tools):

- Skill `api-config-template`: guides the user to describe a third-party image/video endpoint and calls tools `saveModelTemplate` / `saveModelTemplates` to validate and save OpenAI-compatible media templates into the current provider (`skills/api-config-template.ts`, system prompt `lib/prompts/skills/api-config-template.system.txt`; validation and probe routes `/api/user/api-config/assistant/{validate,probe}-media-template`).
- Skill `tutorial`: a product how-to helper with a short system prompt and no tools (`skills/tutorial.ts`).

The word "agent" in prompt file names (`agent_clip`, `agent_storyboard_plan`...) denotes fixed LLM roles in the chain, not autonomous agents.

---

## 6. Async task system

### 6.1 Task types (all 40, `src/lib/task/types.ts`) and queue routing (`src/lib/task/queues.ts`)

| Queue | Task types |
| --- | --- |
| `waoowaoo-image` | `image_panel`, `image_character`, `image_location`, `panel_variant`, `modify_asset_image`, `regenerate_group`, `asset_hub_image`, `asset_hub_modify` |
| `waoowaoo-video` | `video_panel`, `lip_sync` |
| `waoowaoo-voice` | `voice_line`, `voice_design`, `asset_hub_voice_design` |
| `waoowaoo-text` (default) | `story_to_script_run`, `script_to_storyboard_run`, `analyze_novel`, `analyze_global`, `clips_build`, `screenplay_convert`, `voice_analyze`, `episode_split_llm`, `ai_story_expand`, `regenerate_storyboard_text`, `insert_panel`, `ai_modify_appearance`, `ai_modify_location`, `ai_modify_prop`, `ai_modify_shot_prompt`, `analyze_shot_variants`, `ai_create_character`, `ai_create_location`, `reference_to_character`, `character_profile_confirm`, `character_profile_batch_confirm`, `asset_hub_ai_design_character`, `asset_hub_ai_design_location`, `asset_hub_ai_modify_character`, `asset_hub_ai_modify_location`, `asset_hub_ai_modify_prop`, `asset_hub_reference_to_character` |

Handler dispatch: `src/lib/workers/{image,video,voice,text}.worker.ts`. Note `reference_to_character` is routed to the text queue although it calls an image model.

### 6.2 States and events

- Task status: `queued`, `processing`, `completed`, `failed`, `canceled`, `dismissed`.
- Task events (persisted in `TaskEvent`): `task.created`, `task.processing`, `task.progress`, `task.completed`, `task.failed`.
- SSE event kinds: `task.lifecycle` (persisted, replayable) and `task.stream` (LLM token chunks; ephemeral when `LLM_STREAM_EPHEMERAL_ENABLED`).
- Run status: `queued`, `running`, `completed`, `failed`, `canceling`, `canceled`. Step status: `pending`, `running`, `completed`, `failed`, `canceled`.
- Run events: `run.start`, `step.start`, `step.chunk` (lane `text` | `reasoning`), `step.complete`, `step.error`, `run.complete`, `run.error`, `run.canceled`.

### 6.3 Submission (`src/lib/task/submitter.ts`, `service.ts`)

1. API route (all wrapped by `apiHandler`; guard scripts forbid routes calling an LLM directly) calls `submitTask`.
2. Payload normalised; locale resolved and stored on the job.
3. `createTask` with `dedupeKey`: an active task with the same key is returned as `deduped`; if the old task's BullMQ job is dead, the orphan is failed, its billing rolled back, the key released and a new task created.
4. For the two workflow types a `GraphRun` is created or an active one reused (`findReusableActiveRun`).
5. Billing prepared (quote + freeze) unless mode is OFF.
6. Job added to BullMQ with `jobId = taskId`; on enqueue failure the task is failed (`ENQUEUE_FAILED`) and billing rolled back.

### 6.4 Execution (`src/lib/workers/shared.ts` `withTaskLifecycle`)

- Marks processing, starts a heartbeat interval updating `Task.heartbeatAt`, publishes lifecycle events, runs the handler, then settles billing and marks completed.
- Handlers call `reportTaskProgress(job, percent, {stage, stageLabel, stepId, ...})` and `assertTaskActive(job, checkpoint)` before each persistence step so a cancelled task stops before writing.
- Progress messages are i18n keys resolved client-side (`src/lib/task/progress-message.ts`, `messages/*/progress.json`).

### 6.5 Progress and streaming to the browser

- `GET /api/sse?projectId=...&episodeId=...` (`src/app/api/sse/route.ts`): Redis pub/sub channel per project through one shared subscriber (`src/lib/sse/shared-subscriber.ts`), heartbeat events, and **replay** of missed lifecycle events from `TaskEvent` using the `Last-Event-ID` header. The global asset hub uses pseudo-project id `global-asset-hub`.
- `GET /api/runs/[runId]/events?afterSeq=N` returns ordered `GraphEvent`s for reconnect/replay of a workflow run; the client hooks `useStoryToScriptRunStream` / `useScriptToStoryboardRunStream` drive the stream consoles and detect "recovered running" runs after a page reload (`src/lib/run-runtime/recovery.ts`).
- `POST /api/task-target-states` returns the task state for a batch of targets so cards show spinners without polling (guard `task-target-states-no-polling-guard.mjs`); `GET /api/tasks`, `GET /api/tasks/[taskId]`.
- UI components: `src/components/task/TaskStatusInline.tsx`, `TaskStatusOverlay.tsx`, `ProgressToast.tsx`.

### 6.6 Retries

| Layer | Behaviour |
| --- | --- |
| BullMQ | default `attempts: 5`, exponential backoff starting at 2 s; removeOnComplete/Fail 500 (`queues.ts`) |
| Retry decision | only errors normalised as `retryable` are re-queued; a "retrying" progress event with attempt count and next backoff is published; otherwise the job is rethrown as `UnrecoverableError` (`shared.ts`, `src/lib/errors/{codes,normalize}.ts`) |
| Workflow tasks | `story_to_script_run` and `script_to_storyboard_run` get 1 BullMQ attempt; retries happen per step (3 attempts) inside the orchestrators |
| Step retry from UI | `POST /api/runs/[runId]/steps/[stepKey]/retry` -> `retryFailedStep` invalidates the step and its dependents and re-submits with `retryStepKey` |
| External job resume | `Task.externalId` lets a retried media task resume polling the provider job |
| Client-side | "Retry" on failed storyboard groups, "Retry failed" videos, "Force regenerate (if stuck)" |

### 6.7 Failure handling

- Errors are mapped to a unified code set with retryable flag and user-facing messages (`src/lib/errors/**`, `src/lib/task/error-message.ts`).
- On terminal failure: task `failed` with `errorCode` / `errorMessage`, billing rolled back, lifecycle event published; storyboard failures also recorded in `Storyboard.lastError`.
- `npm run stats:errors` aggregates task errors (`scripts/task-error-stats.ts`).

### 6.8 Cancellation

- `DELETE /api/tasks/[taskId]` -> `cancelTask`: marks canceled, rolls back billing, best-effort removes the BullMQ job, publishes an event.
- `POST /api/runs/[runId]/cancel` -> `requestRunCancel` sets `cancelRequestedAt` / `canceling`, cancels the bound task, emits `run.canceled`.
- Cancellation is cooperative: running handlers stop at the next `assertTaskActive` / `assertWorkflowRunActive`. An in-flight provider job is not aborted (UNVERIFIED for every provider).
- `POST /api/tasks/dismiss` marks failed tasks `dismissed` so their error badges disappear.

### 6.9 Recovery

- **Watchdog** (`scripts/watchdog.ts`, every 30 s): re-enqueues `queued` tasks whose job is missing (tracking `enqueueAttempts`, `lastEnqueueError`); for `processing` tasks with `heartbeatAt` older than 90 s either re-queues them or fails them with `WATCHDOG_TIMEOUT`.
- **Run leases** (`src/lib/run-runtime/workflow-lease.ts`): a worker claims a 30 s lease on a `GraphRun` and renews it; another worker cannot run the same run concurrently.
- **Reconcile** (`src/lib/task/reconcile.ts`, `src/lib/run-runtime/reconcile.ts`): aligns DB task state with BullMQ job state and run state with task state.
- **Checkpoints/artifacts**: step outputs persisted per run so a step retry reuses earlier phases instead of recomputing.
- `sweepStaleTasks` in `task/service.ts` fails stale tasks with billing rollback.

---

## 7. License

**At tag v0.4.1 the repository contains no license of any kind.**

Checks performed and results:

| Check | Result |
| --- | --- |
| Files named `LICENSE*`, `LICENCE*`, `COPYING*`, `NOTICE*` (case-insensitive, whole tree excluding `.git`) | none found |
| `package.json` `"license"` field | absent. The file has `"name": "waoowaoo"`, `"version": "0.4.1"`, `"private": true` and no `license` key |
| `README.md` (161 lines, Chinese) — grep for `licen`, `协议`, `许可`, `版权`, `copyright` | no matches |
| `README_en.md` — same grep plus `commercial` | no matches; no License section |
| `CHANGELOG.md` | no license mention; only describes v0.1 as "项目初始开源版本" (initial open-source version of the project) |
| Source headers — grep for `SPDX`, `Copyright`, `MIT License`, `Apache License`, `GPL` across the tree (excluding `node_modules`, `.git`, `package-lock.json`) | no matches |
| `Dockerfile`, `docker-compose.yml` | no license label |

The only ownership / contribution statements, quoted from `README_en.md`:

> "This project is maintained by the core team."
>
> "Submitting Pull Requests as references — we review every PR carefully for ideas, but the team implements fixes internally rather than merging external PRs directly"
>
> "**Made with ❤️ by waoowaoo team**"

Other self-descriptions that are not license grants: `.env.example` has `API_ENCRYPTION_KEY=waoowaoo-opensource-fixed-key-2026`; `messages/en/profile.json` has `"openSourceNoBilling": "Open-source edition, no billing required"`.

Implication: with no license text, no permission to copy, modify or redistribute is granted by this tag; default copyright applies. The project calls itself open source, but that wording is not a license. The HEAD README (see `waoowaoo-reference.md` section 7) says earlier releases "retain their original licenses" — for v0.4.1 there is no original license text in the tree to retain. Whether a license was published elsewhere for this release (GitHub repo metadata, release notes) is UNVERIFIED and cannot be determined from the clone. For JAgentChill: treat v0.4.1 as **reference for behaviour and architecture only**; do not copy code, prompt text, or assets. This is a factual reading of the repository, not legal advice.

---

## 8. FEATURE-CHECKLIST

Status tags: `[live]` reachable in the shipped UI/API, `[unwired]` code present but unreachable, `[legacy]` leftover schema/strings, `[absent]` not in the repo.

Account and workspace
- [live] Username/password sign-up and sign-in (NextAuth credentials, JWT)
- [live] Chinese / English UI switch with locale-prefixed URLs
- [live] Prompt language follows UI locale (zh/en template per prompt)
- [live] Home page quick-start: type an idea -> project created -> pipeline auto-runs
- [live] AI story expansion from keywords/outline ("AI write")
- [live] Project list with pagination, search, create, edit, delete
- [live] Multi-episode projects with episode switcher, add/rename/delete episode
- [live] New-version update notice

Project configuration
- [live] Video aspect ratio (10 options), default 9:16
- [live] Art style (4 presets) applied to all image prompts
- [live] Per-project model override per capability slot (analysis, character, location, storyboard, edit, video, audio)
- [live] Per-model capability parameter overrides (resolution, duration, fps, audio, reasoning effort)
- [live] Video resolution and image resolution defaults
- [legacy] TTS speech-rate setting and Microsoft voice list
- [unwired] Narration voiceover toggle

Import and episodes
- [live] Paste text or upload .docx/.txt (30,000-word / 10 MB limit)
- [live] Long-text detection (>1000 chars) suggesting smart split
- [live] Free regex episode-marker detection (11 marker families) with preview
- [live] LLM episode splitting with balanced lengths and source markers
- [live] Editable split preview (title, summary, content, add/delete episode, re-analyze)
- [live] Optional global asset analysis right after import

Analysis (LLM)
- [live] Character extraction with structured casting profile (role level, costume tier, archetype, identifiers, expected appearances)
- [live] Alias and first-person narrator resolution; updates to existing characters
- [live] Location extraction with 3 description variants and reusable placement slots
- [live] Conservative key-prop extraction (portability / replaceability / recurrence tests)
- [live] Global (all-episode, chunked) asset analysis for cross-episode consistency
- [live] Clip splitting with exact source-text boundaries and fuzzy boundary matching
- [live] Screenplay conversion per clip (scenes, headings, action / dialogue / voiceover)
- [live] Live streaming console of model output and reasoning per step
- [live] Rebuild confirmation when re-running would clear downstream data

Script stage
- [live] Clip list with formatted screenplay / original text tabs
- [live] Edit clip content
- [live] Per-clip add/remove characters (with appearance) and locations
- [live] Missing-asset-image gate before storyboard generation

Assets
- [live] Character profile review, edit, confirm, batch confirm
- [live] LLM visual description generation (3 variants per appearance)
- [live] Multiple appearances per character (primary + sub-appearances with change reason)
- [live] Sub-appearance image generation referencing the primary image
- [live] Character sheet image (close-up + three-view on white), 3:2
- [live] Location plate image (wide, slot-aware), 1:1
- [live] Prop sheet image, 3:2
- [live] Choose number of options (1–6, default 3)
- [live] Select option and confirm (deletes the others)
- [live] One-level undo to previous image + description
- [live] Regenerate single option / regenerate group / generate all / regenerate all
- [live] Instruction-based image edit with optional reference images
- [live] Automatic description re-sync after an image edit
- [live] AI rewrite of description by instruction (character / location / prop)
- [live] AI design of a new character or location from one line
- [live] Manual add character / location / prop; edit name, summary, introduction, per-asset art style
- [live] Upload own image / replacement
- [live] Reference photo -> three-view character sheet + auto description (vision)
- [live] Name label bar burnt onto project asset images
- [live] Filter assets by episode and by generated/pending
- [live] Download all asset images as ZIP
- [live] Force-regenerate for stuck tasks
- [live] Character voice settings (upload reference audio, AI design, pick from library, preview)

Global Asset Hub
- [live] User-level library of characters, locations, props, voices
- [live] Folders
- [live] Same generate / select / undo / edit / AI design / reference-to-sheet actions as in-project
- [live] Voice library entries (AI-designed or uploaded)
- [live] Copy global character / location / voice into a project
- [live] Asset picker inside projects
- [live] Download all as ZIP

Storyboard
- [live] One-click Script -> Storyboard workflow
- [live] Phase 1 panel planning (shot type, camera move, characters + appearance + slot, location, source text, duration, video prompt)
- [live] Phase 2a cinematography rules per panel
- [live] Phase 2b acting direction per character per panel
- [live] Phase 3 detail refinement and motion-ready video prompt
- [live] Parallel clips with user concurrency limit
- [live] Per-step retry with dependency invalidation
- [live] Regenerate storyboard text for one clip
- [live] Card view and table view
- [live] Edit all panel fields; AI Data Editor with JSON preview
- [live] Insert / move / delete panel; add / move / delete storyboard group
- [live] AI-generated bridging panel between two panels
- [live] AI rewrite of image + video prompt by instruction with @asset mentions
- [live] Screenplay display alongside panels

Panel images
- [live] Panel image generation with character + location reference images and JSON context
- [live] 1–4 candidates per generation
- [live] Candidate selection / cancel
- [live] Regenerate (keeps current until a candidate is chosen)
- [live] AI shot-variant suggestions with creativity score
- [live] Variant generation as a new inserted panel (toggle character/location references, custom instruction)
- [live] Instruction-based panel image edit with reference images and library assets
- [live] Batch generate all / only missing, with success/failure summary
- [live] Download all panel images as ZIP
- [unwired] Panel image undo button (previous image stored; handler not found)
- [absent] Prop images as panel reference images

Video
- [live] Per-panel image-to-video with selectable model
- [live] Capability-driven parameters (duration, resolution, fps, native audio, mode)
- [live] First/last-frame mode by linking a panel to the next
- [live] Separate first/last-frame model and prompt
- [live] Editable video prompt per panel
- [live] Batch "Generate all videos" with config dialog
- [live] Ark offline batch-mode models (cheaper, slower)
- [live] Filter by generated / pending / failed; retry failed; force regenerate
- [live] Inline player, single download, download all as ZIP
- [absent] Multiple video candidates / video undo

Voice
- [live] LLM voice-line extraction with speaker, emotion strength, panel matching
- [live] Add / edit / delete lines; rebind line to a shot
- [live] Speaker voice status list; inline voice binding for speakers not in the library
- [live] Upload reference audio (zero-shot cloning path)
- [live] AI voice design from description with presets, multiple schemes, preview
- [live] Per-line TTS with emotion prompt and strength
- [live] Generate all pending lines; play; delete audio; download voices as ZIP
- [live] Lip-sync per panel from a chosen voice line (3 providers)
- [live] Automatic audio padding (<2 s) and trimming (> video length) before lip-sync
- [live] Original / synced video toggle

Post-production
- [unwired] Timeline editor (Remotion preview, magnetic track, trims, transitions, attached voice, BGM track)
- [unwired] Subtitles per clip
- [absent] Server-side render / single merged film export
- [absent] Music or SFX generation
- [legacy] SRT parsing utilities and SRT-driven shot flow

Models and providers
- [live] Five model types: llm, image, video, audio, lipsync
- [live] Preset providers: Ark, Google, Bailian, OpenRouter, MiniMax, Vidu, FAL
- [live] Custom OpenAI-compatible and Gemini-compatible providers
- [live] Per-user encrypted API keys (AES-256-GCM)
- [live] Custom models with capabilities and pricing
- [live] Capability catalog (resolutions, durations, fps, modes, audio)
- [live] Default model per capability slot, incl. lip-sync and voice design
- [live] Connection test and LLM protocol probe
- [live] Chat assistant that builds and saves media templates for third-party endpoints
- [live] Tutorial assistant skill
- [absent] Project-level creative agent

Tasks and operations
- [live] 40 task types over 4 BullMQ queues
- [live] Task dedupe per target
- [live] SSE lifecycle + token stream with replay
- [live] Run / step / attempt / event / checkpoint / artifact model for long workflows
- [live] Automatic retry with exponential backoff for retryable errors
- [live] Step-level retry from UI
- [live] Cancel task / cancel run (cooperative)
- [live] Dismiss failed tasks
- [live] Heartbeat watchdog and queued-task re-enqueue
- [live] Run leases against double execution
- [live] Recovery of a running workflow after page reload
- [live] Per-user image/video concurrency limits and workflow concurrency setting
- [live] Bull Board admin dashboard
- [live] Structured JSON logging with redaction; log download

Billing
- [live] Billing modes OFF / SHADOW / ENFORCE (default OFF)
- [live] Price catalog with flat and capability-tiered pricing
- [live] Freeze -> settle -> rollback ledger with idempotency
- [live] Balance, frozen, total spent; transactions; per-project and per-action cost reports
- [absent] Payment / top-up gateway

Storage and deployment
- [live] MinIO/S3 and local storage providers; media indirection via public ids and signed URLs
- [unwired] Tencent COS provider (stub)
- [live] Single-image Docker Compose deployment (app + MySQL + Redis + MinIO), optional Caddy HTTPS

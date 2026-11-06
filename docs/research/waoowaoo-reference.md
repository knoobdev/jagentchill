# waoowaoo reference (code-grounded)

Research target: `/Users/ngocchanh/Project/private/organisations/hdc/jagentchill/.refs/waoowaoo`
Snapshot: shallow clone, HEAD `dfec20e` ("Update README.md"), `package.json` version `0.5.0-beta.1`.
All paths below are relative to that repo root unless stated otherwise.

Conventions used in this document:

- A statement followed by a path was read in that file.
- `UNVERIFIED` = not confirmed in code in this snapshot (inferred, only described in docs/README, or belonging to the cloud-only `ee/` tree that is physically absent).
- `NOT PRESENT` = I searched for it and the snapshot does not contain it.

---

## 0. Read this first: the snapshot is NOT the staged "novel promotion" pipeline

The brief assumed waoowaoo is a stage-by-stage pipeline (novel -> episodes -> clips -> characters/locations -> storyboard panels -> panel images -> per-shot video -> lip-sync -> TTS/dubbing -> subtitles -> editor -> export). **That product does not exist in this snapshot.** v0.5.0-beta.1 is a ground-up rewrite into a different shape:

- One **project = one file/folder tree** of `WorkspaceResource` rows, shown as a **node canvas** (`docs/architecture/modules/workspace-resource.md`, `docs/architecture/modules/canvas-node.md`).
- One **chat Assistant** (an OpenAI Codex `app-server` process per active project) that does all creative reasoning by reading five **Creative Skills** (Markdown method documents) and calling a small set of MCP tools (`src/lib/creative-skills/**`, `src/lib/wao-mcp/**`, `src/lib/codex-runtime/**`).
- Five async task types only: image, music audio, voice design, video, video merge (`src/lib/task/types.ts`).

The architecture docs state the removal explicitly:

- "不存在 Storyboard、Panel、VideoGroup、EditScript、Workflow stage 等专用流程节点" (no Storyboard / Panel / VideoGroup / EditScript / Workflow-stage nodes) - `docs/architecture/modules/canvas-node.md`.
- "Episode、Chapter、Scene、Shot、Canon 都是用户目录与文件内容，不是系统 scope、外键或第二状态机" (episodes/chapters/scenes/shots are just user folders and file content) - `docs/architecture/modules/workspace-resource.md`.
- "There is no fixed mainline, stage, next action, or hidden tool order" - `src/lib/ai-prompts/templates/project-agent/system/project-agent-system.txt`.
- BullMQ, outbox, DB leases were removed in favour of Temporal - `docs/architecture/modules/async-task-lifecycle.md`.

Search evidence in `src/` (case-insensitive file counts): `lipsync` 0, `lip-sync` 0, `voice_line` 0, `storyboard` 1 (a marketing string in `src/components/home/HomeShowcase.tsx`), `novel` 2 (unrelated), `episode` 1.

Leftovers of the old pipeline that still sit in the tree but are not wired to anything:

| Leftover | Path | Status |
| --- | --- | --- |
| Prompt canary fixtures for `screenplay_conversion`, `story_to_script_clips`, `storyboard_panels`, `voice_analysis` | `standards/prompt-canary/*.canary.json` | Not referenced by any file in `src/`, `scripts/`, `tests/` (grep for `prompt-canary` returns nothing). They show the OLD panel shape: `panel_number, description, characters[{name, appearance}], location, scene_type, source_text, shot_type, camera_move, video_prompt, duration`. |
| Retired resource schema ids | `src/lib/workspace-resource/schema-registry.ts` (`LEGACY_STYLE = 'project.style'`, `LONG_FORM_PLAN = 'project.long_form_plan'`) | Read-only; cannot be minted. |
| i18n namespaces `scriptView`, `assetLibrary`, parts of `assets`, `progress` | `messages/en/*.json` | `scriptView` has no `useTranslations` caller in `src/`. |
| `analysisConcurrency` preference, `buildCharactersIntroduction` helper | `prisma/schema.prisma` (`UserPreference`), `src/lib/constants.ts` | Field still exists; no "analysis" task type exists any more. |
| Legacy media ref backup table | `prisma/schema.prisma` (`LegacyMediaRefBackup`) | Migration support only. |

Consequence for JAgentChill: to model the old staged pipeline you need an older waoowaoo release (README says "Earlier releases retain their original licenses"), which this shallow clone does not contain. Everything below describes what **is** in the snapshot. Where the brief asked about a stage that no longer exists, section 2 says so explicitly and shows what replaced it.

---

## 1. Architecture and stack

### 1.1 Stack

| Concern | Choice | Evidence |
| --- | --- | --- |
| Framework | Next.js 16.3.4 (App Router, Turbopack), React 19, TypeScript, Node >= 22 | `package.json` |
| Styling / UI | Tailwind CSS v4, custom "Glass" primitives, lucide-react | `package.json`, `src/components/ui/primitives/*` |
| Canvas | `@xyflow/react` 12 | `package.json`, `src/features/project-workspace/canvas/**` |
| Chat UI | `@assistant-ui/react`, `@assistant-ui/react-ai-sdk`, `@ai-sdk/react`, `react-markdown` + `remark-gfm` | `package.json`, `src/features/project-workspace/components/workspace-assistant/**` |
| Client data | `@tanstack/react-query`, `@tanstack/react-virtual` | `package.json`, `src/lib/query/**` |
| Database | MySQL 8.0 via Prisma 6.19 (`prisma db push`, no migration runner in compose) | `prisma/schema.prisma`, `docker-compose.yml` (`app-schema` service runs `npm run db:push`) |
| Durable execution | Temporal 1.21 SDK, server image `temporalio/server:1.31.2`, namespace `waoowaoo`, task queue `waoowaoo-runtime`, mandatory worker versioning with blue/green worker slots | `src/lib/temporal/**`, `src/lib/temporal/config.ts`, `docker-compose.yml`, `.env.example` |
| Transport / cache | Redis 7 (`ioredis`): SSE pub/sub, SSE connection leases | `src/lib/sse/**`, `src/lib/redis` (imported by `src/lib/sse/connection-lease.ts`) |
| Object storage | S3 protocol only (`@aws-sdk/client-s3`); self-hosted = private MinIO read through an owner-aware app proxy; cloud = signed HTTPS S3 | `src/lib/storage/providers/s3.ts`, `src/lib/deployment/config.ts` (`mediaObjectDelivery`), `docs/architecture/modules/product-shell.md` PS-12 |
| Media tooling | `ffmpeg-ffprobe-static`, `sharp` | `package.json`, `src/lib/video-compose/**` |
| Auth | NextAuth v4 + Prisma adapter. Self-hosted: credentials provider with username + password (bcryptjs, min length 8). Cloud (`ee/`, absent): phone SMS, WeChat, Google - UNVERIFIED | `src/editions/self-hosted/auth.ts`, `src/lib/auth/password-policy.ts`, `src/editions/self-hosted/server.ts` |
| i18n | `next-intl` 4; locales `zh` (default) and `en`; locale prefix always in URL; 25 JSON namespaces per locale | `src/i18n/routing.ts`, `messages/en/*`, `messages/zh/*` |
| LLM / agent | OpenAI Codex CLI `@openai/codex@0.146.0` run as `app-server` inside a restricted Docker container per active project; Vercel AI SDK v6 for non-agent LLM calls | `Dockerfile.codex-runtime`, `src/lib/codex-runtime/**`, `src/lib/ai-exec/**` |
| Agent tool bridge | MCP server (`@modelcontextprotocol/sdk` 1.30.0) over HTTP at an internal route | `src/lib/wao-mcp/**`, `src/app/api/internal/codex-runtime/mcp/route.ts` |
| Validation | zod 4 everywhere (operation inputs, task payloads, skill outputs) | throughout `src/lib` |
| Tests | Vitest (unit, contracts/conformance, integration), Playwright (browser security) | `tests/**`, `package.json` scripts |

### 1.2 Process topology (self-hosted Docker Compose)

`docker-compose.yml` + `docker-compose.self-hosted.yml`:

- `caddy` (TLS terminator, `https://localhost:1443`, HTTP/2 needed for multiple SSE tabs - README).
- `app` - Next.js web (`npm run storage:init && npm run start:next`). Also hosts the Codex Runtime Session Manager and the MCP endpoint, and is therefore single-process for the control plane (`docs/architecture/modules/codex-runtime-rollout.md` CRR-11/12).
- `temporal-worker-blue` / `temporal-worker-green` - same image, run `src/lib/temporal/worker.ts`; upgraded by promote/retire script `scripts/temporal/worker-rollout.sh`.
- `codex-runtime` - image built from `Dockerfile.codex-runtime`; one container started per active `(userId, projectId)` with CPU/memory/PID limits (`CODEX_RUNTIME_CPU_LIMIT=2`, `CODEX_RUNTIME_MEMORY_BYTES=2147483648`, `CODEX_RUNTIME_PIDS_LIMIT=256`, idle stop `CODEX_RUNTIME_IDLE_TIMEOUT_MS=900000`) - `.env.example`, `src/lib/codex-runtime/runtime-config.ts`.
- `mysql`, `redis`, `minio` + `minio-init`, `temporal` (+ schema/bootstrap/namespace jobs, optional `temporal-ui`).

### 1.3 Editions

A compile-time "edition" switch (`DEPLOYMENT_EDITION` = `self-hosted` | `cloud`) binds `src/lib/edition/current/*` to an implementation. The self-hosted implementation is `src/editions/self-hosted/*`; the cloud implementation lives in `ee/`, which is removed from the public tree (`Dockerfile`, `docs/architecture/modules/product-shell.md` PS-17). Self-hosted feature flags (`src/editions/self-hosted/server.ts`): pricing/legal/recharge/subscription/billing pages off, password auth on (username identity), API config page on when `PROVIDER_CREDENTIAL_MODE=user-key`, update check on, workflow-concurrency settings UI off.

### 1.4 Core layering inside `src/lib`

| Layer | Path | Role |
| --- | --- | --- |
| Operations | `src/lib/operations/**` | The single registry of every server capability, each with `id`, `intent` (query/plan/act), `channels` (`tool`/`api`/`mcp`), `effects`, `confirmation`, zod input/output. HTTP routes and the agent both go through it. |
| Planning / approval | `src/lib/operations/planning.ts`, `operation-plan-snapshot.ts`, `planned-operation-invocation.ts` | Immutable plan + quote snapshot -> approval grant -> execution. |
| Task | `src/lib/task/**` | Task rows, handlers, provider invocation ledger, terminal writer. |
| Temporal | `src/lib/temporal/**` | Workflows (`task`, `user-task-scheduler`, `operation-execution`) and activities. |
| Provider gateway | `src/lib/ai-registry/**`, `src/lib/ai-exec/**`, `src/lib/ai-providers/**` | Model catalog, option normalisation, async polling, adapters. |
| Workspace resource | `src/lib/workspace-resource/**` | Resource tree, versions, lineage, materialiser, regeneration templates. |
| Assistant | `src/lib/assistant-runtime/**`, `src/lib/codex-runtime/**`, `src/lib/codex-model-gateway/**`, `src/lib/agent-turn/**`, `src/lib/wao-mcp/**` | Thread/turn persistence, runtime container management, LLM proxy, tool effects, MCP. |
| Billing | `src/lib/billing/**` | Credits, freezes, ledger, quotes. |

---

## 2. The production pipeline

### 2.0 How "the pipeline" works in this snapshot

There is no server-side stage machine. The order of work is produced by the Assistant following its system prompt and the Skills. The mapping is declared in one registry, `src/lib/creative-skills/output-registry.ts`:

| Domain | Skill (`src/lib/creative-skills/skills/<id>/SKILL.md`) | Version (`registry.ts`) | Output kind (strict JSON) | Saved-document schema id | Media operation |
| --- | --- | --- | --- | --- | --- |
| script | `script-development` | 6.0.0 | `screenplay` | `project.screenplay` | none |
| direction | `creative-direction` | 5.1.0 | `creative_direction` | `project.creative_direction` | none |
| assets | `asset-development` | 5.4.0 | `asset_generation_batch` | `project.asset_manifest` | `create_image` |
| video | `video-direction` | 4.3.0 | `video_generation_batch` | `project.video_prompt_set` | `create_video` |
| music | `music-direction` | 3.2.0 | `audio_generation_batch` | `project.music_direction` | `create_audio` |
| (shared base) | `creative-core` | 1.6.0 | - | - | - |

Rules that hold for every stage:

- **Prompts are written by the agent, never compiled server-side.** Each media item carries its complete final provider-ready prompt; the server "freezes it verbatim" (`src/lib/workspace-resource/generation-request.ts`, `finalPromptSchema`, max 100,000 chars; `docs/architecture/modules/workspace-resource.md` WR-16).
- **Models are not chosen per call.** One configured model per media category; model id is not a tool input (`project-agent-system.txt`, "Tool protocol").
- **Every billable media call needs a quote approval** (`confirmation: { kind: 'billable_media', required: true }` in `src/lib/operations/domains/workspace-resource/generation-ops.ts`).
- **Each generated item is one Resource.** `count` 1-6 on an item produces sibling "alternative" Resources grouped by `alternativeGroupExecutionId` + `memberIndex` (`generation-request.ts`, `prisma/schema.prisma` `WorkspaceResource`).
- **Batch ceiling:** 64 tasks per operation execution (`OPERATION_EXECUTION_MAX_TASKS`, `src/lib/temporal/operation-execution/contracts.ts`).
- **Retry vs regenerate vs revise** are three different actions (section 2.13).
- **Hard alignment checkpoints** (agent pauses with a decision card via the MCP tool `request_user_decision`, 2-4 options + optional free text - `src/lib/wao-mcp/user-decision.ts`) are declared by Skills: content direction choice, core presentation freeze, generated-asset review, score decision, plus one domain-independent "final expensive review" before the largest billable submission (`project-agent-system.txt`).

Agent system prompt files: `src/lib/ai-prompts/templates/project-agent/system/project-agent-base.txt` (generic working style, formatting, intermediary updates) and `project-agent-system.txt` (identity "WaooWaoo Creative Assistant", tool protocol, decision loop, resource rules, alignment tiers, billing/failure rules, one product topic restriction). Loaded by `src/lib/ai-prompts/project-agent-system.ts`, which injects the skill routing list into `{creative_skill_routing}`.

### 2.1 Input (idea / script / novel text / references)

| Aspect | Detail |
| --- | --- |
| Entry points | Home page one-line prompt + aspect ratio picker creates a project in one operation (`src/app/[locale]/HomeClient.tsx`, `src/components/story-input/StoryInputComposer.tsx`, `src/components/home/HomeVideoRatioSelect.tsx`, operation `create_project` in `src/lib/operations/domains/project/system-project-ops.ts`); then chat in the project workspace. |
| Text attachments | `.txt`, `.md`, `.docx` (mammoth); max 4 files, 8 MB each, 120,000 chars each (`src/lib/project-agent/text-attachments/types.ts`, `parser.ts`, route `src/app/api/assistant/text-attachments/route.ts`). A `LongTextDetectionPrompt` component exists (`src/components/story-input/LongTextDetectionPrompt.tsx`). |
| Media attachments / uploads | PNG, JPEG, WebP, MP3, WAV, OGG, MP4, WebM accepted by sniffed magic bytes (`src/lib/workspace-resource/upload-contract.ts`); limits 25 MB image / 100 MB audio / 512 MB video (`src/lib/http/body-size-constants.ts`). Uploads become ready Resources with schema `project.upload_image|audio|video` via `register_uploaded_media` (`src/lib/operations/domains/workspace-resource/uploaded-media-ops.ts`). |
| Pasted complete script | Agent must preserve "the exact contiguous user-authored excerpt"; it may transcribe a script visible in an attached image but must not invent obscured text (`project-agent-system.txt`, "Research and source material"). |
| Web research | Native Codex web search proxied to an OpenAI hosted search (`src/lib/web-search/**`, `src/lib/ai-providers/openai/hosted-web-search.ts`, route `src/app/api/internal/codex-runtime/model/alpha/search/route.ts`). Requires server env `OPENAI_API_KEY`; default search model `gpt-5.6-luna` per `.env.example`. Request = one research brief + up to 20 allowed domains; response = report, queries, 1-32 cited sources, up to 16 images (`src/lib/web-search/contracts.ts`). |
| Importing a web image as a reference | Schema id `project.web_reference_image` and a provenance contract exist (`src/lib/workspace-resource/web-reference-contract.ts`), but the operation pack is deliberately empty: "Importing remote bytes is deliberately absent" (`src/lib/operations/domains/workspace-resource/reference-image-ops.ts`). The system prompt still mentions a "declared web-reference import Operation" - that operation is NOT PRESENT in this snapshot. |
| Novel -> episode / clip splitting | NOT PRESENT as a stage. Long works are "organized by folder structure" using names like `第001集` (`project-agent-system.txt`, "Resource rules"); `creative-core` says to split long content by narrative/scene boundaries, not fixed word counts. |

### 2.2 Story analysis / script writing (`script-development`)

| Aspect | Detail |
| --- | --- |
| Inputs | User idea, attachments, optional adopted Creative Direction resource. |
| Output | One strict `screenplay` object: `title`, `logline`, `synopsis` (<= 12,000), `screenplayText` (<= 600,000 chars), `source {kind: generated|provided|revised, label}`, `assumptions[]`, `openQuestions[]` (`src/lib/creative-skills/output-registry.ts`). |
| Persistence | Not automatic. Saved only via `save_project_document` when the user asks or a downstream dependency needs an exact Resource (text up to 4 MB; `generation-ops.ts`, `src/lib/workspace-resource/content-store.ts`). |
| Prompt / method (`skills/script-development/SKILL.md`) | Classifies the need into three types - expressive (story/short drama -> screenplay), communication (ads/brand -> timed script with fixed duration), views-driven (feed short video -> vertical timed script with hook/retention/payoff). Defines the interview questions per type, a causal-engine method, three pacing gears (attention-grab: disturbance in ~2 s, hook by ~6 s, a real change every 8-10 s; standard; immersive), opening/ending rules, dialogue sharpness tests (hide-the-name test), duration control, and type-specific self-review rubrics. Includes commercial-script discipline (single claim, facts only from the user, CTA, safe zones for vertical feeds) and feed-video discipline. |
| Hard checkpoint | "Content direction choice": if the user gave only a high concept, one decision card with exactly three genuinely different complete directions + `otherLabel`. Skipped if content is given or the user says "you decide". |
| Model | The single Assistant LLM (`UserPreference.assistantModel`), via the Codex runtime. |
| User controls | Chat revision; choose direction; "complete everything without questions" or "confirm every step" mode overrides (`project-agent-system.txt`). |
| Authority rule | One project has exactly one source-text authority; never create a second competing script, revise the existing Resource (CS-12 in `docs/architecture/modules/creative-skills.md`). |
| Task/queue | None - synchronous in the agent turn. LLM usage is post-paid per call in cloud (BA-17), ignored in self-hosted (`src/editions/self-hosted/billing.ts`). |

### 2.3 Creative direction / style bible (`creative-direction`)

| Aspect | Detail |
| --- | --- |
| Output | `creative_direction`: `styleSummary`, `rawUserStyle`, `visual {visualStyle, assetImageStyle{lighting, texture}}`, `narrative`, `directing`, `editing`, `sound`, `assetPolicy`, `assumptions`, `warnings` (`src/lib/creative-direction/contracts.ts`, `output-registry.ts`). |
| Method (`skills/creative-direction/SKILL.md`) | Six domains, each written as executable policy (default + triggered exception + prohibition), not adjectives. `visual.visualStyle` must contain four hard elements: medium and technique, a palette of 3-6 hex colours with roles, line/edge policy, finish/detail density. Direction decides how to present, never what happens, and may not add screen time. Includes a web-research protocol (three source classes, cross-checking, untrusted-content rule). |
| Hard checkpoint | "Core presentation freeze" after source text, before assets: ask about the one or two decisions with the largest style space. |
| Style as an image asset | Explicitly forbidden - style is carried by text, not by a style-board image (`asset-development/SKILL.md`). The old `project.style` image schema is retired. |
| Task/queue | None. |

### 2.4 Character extraction and character images

| Aspect | Detail |
| --- | --- |
| Skill | `skills/asset-development/SKILL.md`. |
| Selection rule | An asset must pass three gates: actually appears on screen / carries visible action; identity must stay consistent across shots or be referenced independently; cannot be fully represented by another chosen asset. Mentioned-only entities, crowds, incidental objects are not registered. `decision: "no_assets"` with empty items is valid. |
| Asset kinds | Exactly three: `character`, `location`, `prop` -> schema ids `project.character_image`, `project.location_image`, `project.prop_image` (`generation-request.ts` superRefine, `src/lib/asset-generation/asset-image-format.ts`). |
| Output | `asset_generation_batch` (schemaVersion 2): `batchId`, `decision produce|no_assets`, `overview`, `items[]` each with `itemId`, `name`, `folderPath`, `count` (1-6), `prompt`, `schemaId`, `assetKind`, `references[]`, `aliases[]`, `stableDescription` (<= 16,000), `consumedByShots[]`, optional `options {resolution, quality}` (`generation-request.ts`). |
| Character design rules | Human: gender presentation, age feel, face shape, eyes (shape/size/colour), hair, build, skin tone and marks, full outfit including shoes, period-appropriate; no expression/pose/background/props; no hedging words; no abstract "aura". Non-human characters are not forced into the human template. Reverse-engineering from a reference image is covered. |
| Character sheet layout (written into the prompt) | One 4:3 landscape image split in halves: left = face close-up, right = unobstructed full body, pure white background, no other people/props/environment. |
| Aspect ratio | Fixed 4:3 by server policy; item must omit `aspectRatio` (`generation-request.ts`; error `ASSET_IMAGE_RATIO_UNSUPPORTED_BY_MODEL` in `generation-ops.ts` if the model cannot do it). |
| Consistency mechanism | (1) `stableDescription` kept separate from style; (2) the generated asset image becomes a `reference_image` input to later video segments with exact `resourceId + contentVersion`; (3) lineage rows record it (`WorkspaceResourceLineage`). There is NO per-character multi-appearance/"costume" table in the project scope; a lasting new state (injury, outfit change) becomes a new version or a new asset (`asset-development/SKILL.md`). |
| Hard checkpoint | "Generated asset review": after all new prerequisite visual assets are ready and before any dependent voice/video work, one card with fixed option order "satisfied, continue" / "pause" / free-text change request. |
| Operation | `create_image` (`generation-ops.ts`, `mediaOperationBase`); request kinds `new` and `retry`. |
| Task | `workspace_resource_image`, max 3 business attempts, scheduler class `image` (`src/lib/task/definition.ts`), handler `src/lib/task/execution/handlers/workspace-resource-image.ts`. |
| Models | See section 4. Image reference limits per model 14-16 (`src/lib/ai-providers/openrouter/models.ts`). |
| User controls | Canvas card actions: Run again (edit prompt/frame/params/references -> new card, original kept), Generate video (animate), Discuss with AI, Use as reference, Preview alternatives, Download, Retry (failed only), Delete (`src/features/project-workspace/canvas/registry/workspace-canvas-node-registry.ts`). |

### 2.5 Location / scene assets

Same skill, operation, task and controls as 2.4. Skill rules: start from a named concrete space; write architecture (walls/floor/ceiling/openings/scale/depth), materials, wear; foreground/mid/background layers; at least three stable spatial anchors with free floor around them for later character placement (invisible guidance, never drawn markers); physical light sources only; private spaces empty, naturally crowded spaces may have anonymous blurred crowds; no captions/watermarks/arrows. Layout: one 4:3 frontal view of the whole space, no people, no loose furniture/standalone props. Structurally different sub-spaces of one narrative place that each carry action are split into separate assets.

### 2.6 Prop assets

Same pipeline. Skill rules: static visual facts of the object only (structure, silhouette, counts, material, colour, finish, pattern, wear); no usage/plot/hands/background. Layout: 4:3, one centred complete unobstructed prop on pure white. Commercial products/packaging/brand objects are props; a user-supplied logo or pack shot is an identity reference and must not be redrawn as an "authoritative" brand asset.

### 2.7 Storyboard / shot generation

NOT PRESENT as a persisted entity or a panel-image stage. Shot design is folded into the **video prompt**:

- The `video-direction` skill requires an internal per-shot state table (character identity/costume/position/facing/eyeline, props, scene, information, sound) that is explicitly **not** an output field.
- Shots are written as time blocks inside each segment prompt: `[00:00-00:0X] 镜头1: shot size + camera position + subject placement | one main camera move`, then `画面/表演/台词/声音` lines.
- There are no storyboard panel images, no panel variants, no panel regeneration. If a first frame is wanted it is an ordinary generated image passed with `role=first_frame`.

`standards/prompt-canary/storyboard_panels.canary.json` documents the removed panel schema (see section 0).

### 2.8 Video generation per segment (`video-direction` + `create_video`)

| Aspect | Detail |
| --- | --- |
| Inputs | Source text, Creative Direction, ready asset Resources, voice reference Resources, entry state of the previous segment. |
| Output | `video_generation_batch` (schemaVersion 2): `items[]` each `itemId`, `name`, `folderPath`, `count` 1-6, `prompt`, `schemaId` (`project.video_segment`, `project.composite_video`, `project.rendered_video`, `generic.video`), `durationSeconds`, `references[]`, optional `options {aspectRatio, resolution, generateAudio}` (`generation-request.ts`). |
| Planning order | "whole-film timeline -> directing design -> pack into segments"; never assign a provider duration per shot and sum. `durationIntent.mode=fixed` (user gave a length: segment durations must sum exactly) vs `derive` (shortest clear duration from dialogue and non-parallel action). Speech rate rule lives only in `creative-core`: Chinese 4-5 chars/s, English 120-160 wpm. |
| Segment packing | A segment is an execution container, not a story beat. Use the fewest segments: the model's maximum allowed `durationSeconds`, with the tail filled by the fewest allowed durations. Scene changes are cuts inside one prompt, not a reason for a new segment. |
| Seams | Non-first segments must write `[入口状态]`, non-last `[出口状态]`; adjacent segments must have a real shot-size change and time moving forward. No claim of frame-level seamless interpolation. |
| Final prompt format | Ordered blocks: `[风格] [时长] [参考] [入口状态] [场景] [time block] ... [出口状态] [收尾] [整体声音] [约束]`. Fixed constraint sentences: characters do not look into the lens; no dissolves/cross-fades between shots; no subtitles, titles, watermark, collage, split screen or extra people. |
| Performance rules | Only visible physical facts, no emotion adverbs; prefer low-amplitude description; layered reactions (freeze -> confirm -> release), one layer per shot. |
| Reference roles | `first_frame`, `last_frame`, `reference_image`, `reference_audio`, `reference_video`, plus `context` (`videoGenerationReferenceSchema`). Input mode is derived server-side from roles: `text_to_video`, `first_frame`, `first_last_frame`, `reference`. Frame mode and reference mode are mutually exclusive; a last frame requires a first frame. In prompts references are addressed as `@图片N / @音频N / @视频N` (or `@Image N` ...). |
| First/last frame | Supported where the model declares it (Seedance 2.0 / 2.0 Fast / 2.5, MiniMax H3). MiniMax H3 Max accepts only a single first frame (`src/lib/ai-providers/openrouter/video-models.ts`). |
| Native audio | Models with `supportGenerateAudio` produce dialogue/SFX with the video (`generateAudio` option). Dialogue line format: `角色名（<=3 voice-quality words）：{verbatim line}`. BGM is never written into video prompts. |
| Lip-sync | NOT PRESENT as a separate stage or model type. Mouth sync relies on the video model's native audio generation plus a `reference_audio` voice sample. |
| Long works | > 15 s: must first have a text Creative Direction and the reusable assets, and an explicit score decision. > 180 s: organise as independently generated units in folders, passing state explicitly between units. |
| Operation | `create_video` with request kinds `new`, `retry`, and `revise_failed` (corrected prompt/references/duration regenerated in place on the same failed Resource; `videoGenerationRevisionBatchSchema`). |
| Task | `workspace_resource_video`, max 3 attempts, scheduler class `video`; handler `src/lib/task/execution/handlers/workspace-resource-video.ts` (progress 20 prepare -> 45 generate -> 90 persist; uploads result to storage, records provider route actually accepted). |
| Provider async protocol | Submit -> poll with separate queue and generation budgets: `PROVIDER_QUEUE_TIMEOUT_MS=1800000`, `PROVIDER_GENERATION_TIMEOUT_MS=1200000`, `PROVIDER_POLL_INTERVAL_MS=3000` (`.env.example`, `src/lib/ai-exec/async-wait.ts`, `async-poll.ts`). |

### 2.9 Voice design (`generate_voice`)

| Aspect | Detail |
| --- | --- |
| What it is | Voice **design** from a text description, producing a short preview clip saved as a `project.voice_reference` audio Resource. It is used later as `reference_audio` for video generation. It is not line-by-line TTS. |
| Input (`src/lib/operations/domains/voice/voice-ops.ts`) | `request.kind=new`: `name`, `description` (<= 4,000), `previewText` (<= 10,000, billed per character), `language`, `count` 1-6, `folderPath`; or `kind=retry` with up to 6 failed resource ids. |
| Validation | Preview text must be phonetically useful: >= 14 meaningful CJK characters or >= 7 words (`src/lib/voice/preview-contract.ts`). Actual audio duration is probed and stored so the video planner can check reference-audio limits before quoting (`workspace-resource-voice.ts`, AP-03/04 in `docs/architecture/modules/audio-production.md`). |
| Skill guidance | In `video-direction/SKILL.md`: when one character speaks in two or more independently generated segments, create and bind one stable voice before the dependent video prompts. |
| Models | ElevenLabs Voice Design v3 (`src/lib/ai-providers/elevenlabs/models.ts`, `voice.ts`), FAL "Qwen 3 TTS Voice Design 1.7B" (`src/lib/ai-providers/fal/models.ts`, `voice.ts`). |
| Task | `workspace_resource_voice`, max 3 attempts, scheduler class `image`. |
| Availability caveat | README: "Music and voiceover controls are not included in this preview"; the ElevenLabs and FAL manifests have `apiConfig.visibility: 'hidden'`, so a self-hosted user cannot configure them in the UI. Server code path exists; end-user reachability in self-hosted is UNVERIFIED. |

### 2.10 TTS narration, dubbing, subtitles

- Standalone TTS/narration per line: NOT PRESENT (no task type, no operation).
- Dubbing / voice replacement / lip-sync pass: NOT PRESENT.
- Subtitles (generation, burn-in, SRT export): NOT PRESENT. Video prompts actively forbid generated subtitles. The commercial-script skill only discusses on-screen text as creative content.

### 2.11 Music / score (`music-direction` + `create_audio`)

| Aspect | Detail |
| --- | --- |
| Hard checkpoint | "Score decision": for any complete work > 15 s once visuals are ready, one card with 2-3 concrete score directions plus an explicit "no music" option. `no_music` may never be inferred from silence. |
| Output | `audio_generation_batch` (schemaVersion 3): `decision produce|no_music`, `overview`, `globalContinuity`, `items[]` = cues. |
| Cue item | `compositionPlan { chunks[] }`, `startMs`, `fadeInMs`, `fadeOutMs`, `gainDb` (-60..12), exactly one reference `{channel: context, role: score_timeline}` pointing at the finished video (used for lineage and timeline bounds only; never uploaded to the music provider). `schemaId` defaults to `project.bgm_audio` (`generation-request.ts`, `src/lib/music/score-specification.ts`). |
| Composition plan limits (`src/lib/music/composition-plan.ts`) | 1-30 chunks; chunk 3-120 s; plan 3-600 s; up to 50 positive and 50 negative styles per chunk; `contextAdherence` low/medium/high; chunk fields `text`, `durationMs`, `positiveStyles`, `negativeStyles`. Cue duration = sum of chunk durations. Output format fixed MP3. |
| Skill rules | Decide where music is needed first; cues can be sparse and non-contiguous; English styles; instrumental by default; never name real artists/songs; leave mid-frequency room for dialogue; do not promise per-beat millisecond hits. |
| Models | Eleven Music v2 (`src/lib/ai-providers/elevenlabs/music.ts`, converter `toElevenLabsCompositionPlan`), also Lyria 3 Pro via FAL and Google (`fal/music.ts`, `google/music.ts`). |
| Task | `workspace_resource_audio`, billing policy `music`, max 3 attempts, scheduler class `image`; handler `workspace-resource-audio.ts`. |
| SFX | No separate SFX generation. Sound effects come from the video model's native audio. |
| Availability caveat | Same as 2.9 (hidden providers in the preview UI). |

### 2.12 Editing / composition / export (`merge_videos`)

There is no timeline editor UI. Assembly is one deterministic operation, `merge_videos` (`src/lib/operations/domains/workspace-resource/video-merge-ops.ts`, contract `src/lib/workspace-resource/video-merge-contract.ts`):

| Aspect | Detail |
| --- | --- |
| Input | `videos[]` (1-50 exact `resourceId + contentVersion`, each with optional `trim {startSeconds, endSeconds}`), optional `musicCues[]` (up to 50 BGM audio Resources), `output {aspectRatio, resolution 480p|720p|1080p (short edge), audioMode preserve|mute}`, `name`, `folderPath`. |
| Constraints | Music cues require exactly one untrimmed source video (i.e. score a previously merged cut) and `audioMode=preserve`; cue placement comes from the frozen cue specification, not from the merge call. |
| Video processing | `src/lib/video-compose/video-merge-ffmpeg.ts`: each clip normalised to 30 fps, frame-accurate trim, scale + letterbox pad to the target size, `yuv420p`, libx264 `veryfast` CRF 20; then concat demuxer with stream copy. |
| Audio processing | `src/lib/video-compose/video-merge-audio.ts`: two-pass `loudnorm` to -16 LUFS / -1.5 dBTP / LRA 11 for the main track; BGM target -6 LUFS; each cue gets `afade` in/out and `adelay` to `startMs`, mixed onto a silent bus (`amix`), ducked under dialogue with `sidechaincompress` (threshold 0.08, ratio 3, attack 80 ms, release 450 ms), final `alimiter`; 48 kHz stereo AAC 192k, `+faststart`. |
| Output | One `generic.video` Resource. `generationOptions.mergeMode` = `ordered_concat` or `score_cues`. |
| Task | `workspace_resource_video_merge`, not billable, max attempts 1, scheduler class `video`, no approval card (`confirmation: none`). |
| Transitions, titles, captions, overlays, colour, speed | NOT PRESENT. |
| Export | Download button per card (`download` action) and an authenticated video proxy route (`src/app/api/projects/[projectId]/video-proxy/route.ts`); Asset Hub has "Download All" as ZIP via `jszip` (`src/app/[locale]/workspace/asset-hub/page.tsx`). No project-level export package or NLE interchange (EDL/XML) - NOT PRESENT. |

### 2.13 Retry, regenerate, variants, candidate selection (cross-cutting)

| Action | Mechanism | Evidence |
| --- | --- | --- |
| Candidates at creation | `count` 1-6 per item -> N independent tasks/Resources in one alternative group; canvas shows them with a "Browse N independently generated results" preview. | `generation-request.ts`, `messages/en/project-workflow.json` (`preview.groupDescription`), `src/features/project-workspace/canvas/preview/WorkspaceResourcePreviewModal.tsx` |
| Selecting a candidate | No "selected" flag on project Resources. A Resource is used simply by referencing its exact id + version downstream; unwanted ones are deleted (soft delete). | `docs/architecture/modules/canvas-node.md` CN-02E |
| Exact retry | `request.kind=retry` with failed/canceled resource ids, or `rerun_failed_production_items`; replays the original frozen payload as a new task; needs a new quote. Only failed/canceled Resources. | `generation-ops.ts` |
| Corrected retry (video only) | `create_video request.kind=revise_failed` keeps identity/name/path of the failed Resource. | `generation-request.ts` `videoGenerationRevisionBatchSchema` |
| Run again ("regenerate") | Canvas editor loads a server-projected template (prompt, frame, parameters, duration, references), user edits, submits a `new` request -> a new card; original kept; requires a different name. Asset images have a locked aspect ratio. | `src/lib/workspace-resource/regeneration.ts`, `regeneration-projection.ts`, `src/features/project-workspace/canvas/details/WorkspaceNodeGenerationEditor.tsx` |
| Automatic retries | Temporal owns infrastructure retries (do not consume a business attempt). Business attempts up to 3 for media tasks, only when the failure record says replay is `safe`. Backoff base 15 s. Agent must never auto-retry after a terminal failure without the user asking. | `src/lib/task/retry-policy.ts`, `src/lib/task/definition.ts`, `project-agent-system.txt` |
| No auto fallback | A failing/unsupported model is never silently swapped. | `docs/architecture/modules/provider-gateway.md` PG-05 |
| Undo | Canvas history restores soft-deleted Resources (`⌘Z`); `MutationBatch`/`MutationEntry` tables record reversible mutation batches. | `src/features/project-workspace/canvas/hooks/useCanvasHistory.ts`, `prisma/schema.prisma` |
| Versions | User edits of text files append versions; `WorkspaceResourceVersion` rows are immutable. | `prisma/schema.prisma`, WR-04 |

### 2.14 Manual (non-agent) generation from the canvas

The canvas "create" menu offers Generate image / Generate video / Upload material (`src/features/project-workspace/canvas/create/WorkspaceCanvasCreateMenu.tsx`). A draft card collects a brief, frame, duration, advanced parameters (resolution, quality, generate audio) and references with roles, validated against live model capabilities (`src/app/api/projects/[projectId]/canvas-generation-capabilities/route.ts`, `src/lib/workspace-resource/canvas-generation-capabilities.ts`). Submitting does **not** call the provider directly: it composes a chat message to the Assistant ("Please generate one image on the canvas. My brief: ... Write the complete final prompt from my brief and submit the generation directly") - see `create.message.*` in `messages/en/project-workflow.json` and `src/lib/workspace-resource/canvas-generation-intent.ts`. Direct card actions (retry, run again, delete) do call operations through `src/app/api/projects/[projectId]/operations/[operationId]/plan|execute/route.ts` with a confirmation modal showing task count and max quoted credits.

---

## 3. Data model (`prisma/schema.prisma`, MySQL)

### 3.1 Identity and preferences

| Model | Key fields | Relations / notes |
| --- | --- | --- |
| `User` | `name` (unique login identity), `email?`, `password?` | Owns projects, tasks, resources, balance, subscription, preferences, asset hub. |
| `Account`, `Session`, `VerificationToken` | NextAuth standard | |
| `UserPreference` | `assistantModel` ("the single fixed model slot"), `analysisConcurrency`, `imageConcurrency`, `videoConcurrency`, `videoRatio` (default `9:16`), `videoResolution` (`720p`), `imageResolution` (`2K`), `capabilityDefaults` (JSON text of fixed per-model parameters), `assistantBillingConfirmationRequired` (default true), `llmBaseUrl` (default OpenRouter), encrypted `llmApiKey`, `falApiKey`, `googleAiKey`, `arkApiKey`, `customModels` (JSON), `customProviders` (JSON incl. encrypted keys) | 1:1 with User. |

### 3.2 Project and content

| Model | Key fields | Notes |
| --- | --- | --- |
| `Project` | `name`, `description`, `videoRatio?`, `videoResolution` (`720p`), `imageResolution` (`2K`), `workspaceResourceRevision` (monotonic projection watermark), `lastAccessedAt` | No episode/clip/character tables. |
| `WorkspaceResource` | id (32 chars), `workspacePath`, `activePath` (unique per project when not deleted), `resourceKind` (`file`/folder), `mediaType` (text/image/audio/video), `schemaId`, `name`, `status` (default `pending`), `currentVersion`, `sourceType`/`sourceId`, `memberIndex`, `prompt` (LongText), `modelKey`, `generationOptions` (JSON), `operationId`, `inputHash`, `taskId`, `operationExecutionId`, `alternativeGroupExecutionId`, `toolCallId`, `materializedAt`, `deletedAt` | The single entity for folders, documents and all media. Unique `(alternativeGroupExecutionId, memberIndex)` identifies candidates. |
| `WorkspaceResourceVersion` | `resourceId`, `version`, `contentKind`, `mediaId`, `sha256`, `sizeBytes`, `contentPreview` (<= 512), `sourceTurnId` | Immutable content versions pointing at `MediaObject`. |
| `WorkspaceResourceLineage` | `outputResourceId + outputVersion`, `inputResourceId + inputVersion`, `role`, `position` | Canvas edges come only from these rows (CN-10). |
| `MediaObject` | `publicId` (unique), `storageKey` (unique), `sha256`, `mimeType`, `sizeBytes`, `width`, `height`, `durationMs` | Shared by hub assets and resource versions. Served via `src/app/m/[publicId]/route.ts`. |
| `ProjectCanvasLayout` | `projectId`, `folderKey`, viewport `x/y/zoom` | One layout per folder (one folder = one canvas). |
| `ProjectCanvasNodeLayout` | `nodeKey`, `nodeType`, `targetType/targetId`, `x/y/width/height`, `zIndex`, `locked`, `collapsed` | Pure presentation. |
| `MutationBatch` / `MutationEntry` | `source`, `operationId`, `status` active/reverted/failed; entries `kind`, `targetType`, `targetId`, `payload` | Undo support. |

### 3.3 Asset Hub (user-global library)

| Model | Key fields |
| --- | --- |
| `GlobalAssetFolder` | `name`; one level, no nesting. |
| `GlobalCharacter` | `name`, `aliases`, `profileData`, `profileConfirmed`, `folderId?` |
| `GlobalCharacterAppearance` | `appearanceIndex`, `changeReason` (default `default`), `description`, `descriptions`, `imageUrl`/`imageMediaId`, `imageUrls`, `selectedIndex`, `previous*` fields for undo |
| `GlobalLocation` | `name`, `summary`, `assetKind` (default `location`; props are stored here with another `assetKind` - `src/lib/assets/services/location-backed-assets.ts`) |
| `GlobalLocationImage` | `imageIndex`, `description`, `imageUrl`/`imageMediaId`, `isSelected`, `previous*` |

This is the only place where multi-appearance characters and "selected candidate + undo" survive from the old model.

### 3.4 Assistant

| Model | Purpose |
| --- | --- |
| `ProjectAssistantThread` | One per `(projectId, userId, assistantId)`; `runtimeThreadId` (Codex thread), `messagesJson` (product view). |
| `ProjectAgentTurn` | `status` (default `queued`), `attempt`, `sourceKind/sourceId`, `payloadHash`, `userMessageJson`, `contextJson`, `planJson`, `runtimeTurnId`, `stopReason`, `failure`, cancel fields. |
| `ProjectAgentProviderAttempt` | Per LLM call: `providerKey`, `modelKey`, `requestHash`, `status`, `providerRequestId`, `providerGenerationId`, `failure`. |
| `AgentToolEffect` | Idempotent record of a tool call result `(turnId, callId)` with `operationId`, `contractRevision`, `inputHash`, `resultJson`. |
| `AgentTurnInteraction` | Approval / decision cards: `kind`, `status` (default `pending`), `payloadJson`, `responseJson`, `runtimeRequestId`. |
| `ProjectAssistantThreadArchive` | Hidden archive when a user clears a conversation (abuse/dispute tracing). |
| `ProjectAssistantMessageCommand` | Dedup tombstone for user messages `(projectId, userId, assistantId, sourceId)`. |
| `FollowUpBatch` / `FollowUpBatchMember` | A set of tasks started by one tool call; when all are terminal the agent is woken with a new turn exactly once. |

### 3.5 Execution, approval, billing

| Model | Purpose |
| --- | --- |
| `OperationPlanSnapshot` | Frozen `normalizedInput`, `planSnapshot`, `quoteSnapshot` with hashes. |
| `ApprovalGrant` | Authorises exactly one snapshot; `quoteCeiling`, `consumedAt`, `revokedAt`. |
| `OperationExecution` | One execution of an approved plan or direct command; `status`, `output`. |
| `Task` | `type`, `targetType/targetId`, `status` (default `queued`), `progress`, `attempt`, `dedupeKey` (unique), `payload`, `executionFingerprint`, `result`, `failure`, `billingInfo`, `billedAt`, timestamps, `parentTaskId`. |
| `TaskExecutionCheckpoint` | `(taskId, stepKey)` with `inputFingerprint`, `state`, `output` - the handler-result checkpoint that makes completion win over late cancel. |
| `TaskEvent` | Autoincrement id used as the SSE cursor; `eventType`, `idempotencyKey`, `payload`. |
| `UserBalance` | Two pools: `balance` (permanent) and `subscriptionCredits` (expires at `subscriptionExpiresAt`, spent first), `frozenAmount`, `totalSpent`. |
| `BalanceFreeze` | `amount`, `subscriptionAmount`, `status`, `taskId`, `idempotencyKey`, `expiresAt`. |
| `BalanceTransaction` | Ledger row: `type`, `amount`, `balanceAfter`, `freezeId`, `projectId`, `taskType`, `billingMeta`. |
| `UsageCost` | Per usage fact: `apiType`, `model`, `action`, `quantity`, `unit`, `cost` Decimal(18,6), `chargedCredits`. |
| `LlmBillingMeter` | Per-user micro-credit carry for real-time LLM settlement. |
| `Subscription` / `SubscriptionGrant` | One plan term per user; monthly credit grants keyed `(subscriptionId, termKey, periodIndex)`. |
| `PaidBetaCampaign` / `PaidBetaSeat` / `PaidBetaPaymentAttempt`, `PublicBetaWaitlistEntry`, `AnnouncementReceipt` | Cloud go-to-market features. |

---

## 4. Provider / model configuration

### 4.1 Providers and modalities in code

Model types (`UnifiedModelType`): `llm`, `image`, `video`, `music`, `voice` (`src/lib/ai-registry/api-config-catalog.ts`). There is no `lipsync` type and no TTS type.

Registered provider manifests (`src/lib/ai-providers/core-manifests.ts`, each `*/manifest.ts`):

| Provider key | API-config visibility | Modalities and notable models (from each `models.ts`) |
| --- | --- | --- |
| `openrouter` | **visible** (the only one shown in the settings UI) | LLM: Gemini 3.1 Pro, 3.5/3.6/3.8 Flash, Flash Lite; Claude Sonnet 4/4.5/4.6/5, Fable 5/5.1, Opus 5; GPT-5.5, GPT-5.6 Luna/Terra/Sol. Image: Seedream 5.0 Pro, GPT Image 2, Nano Banana Pro, Nano Banana 2, Nano Banana 2 Lite. Video: Seedance 2.0, 2.0 Fast, 2.5, MiniMax H3, MiniMax H3 Max. (`src/lib/ai-providers/openrouter/models.ts`, `video-models.ts`) |
| `ark` (Volcengine) | hidden | Seedream 5.0 Pro / Lite images, Seedance video, LLM (`src/lib/ai-providers/ark/*`). Listed as "featured" in the self-hosted edition (`src/editions/self-hosted/ai.ts`) but its manifest visibility is `hidden`. |
| `fal` | hidden | Banana Pro / Banana 2 / GPT Image 2; Wan 2.6, Veo 3.1, Happy Horse 1.0, Seedance 2.0 (+Fast), Kling 2.5 Turbo Pro, Kling O3 Std/Pro, Kling 3 Std/Pro; Lyria 3 Pro music; Qwen 3 TTS Voice Design. |
| `google` (AI Studio) | hidden | Gemini LLMs; Banana Pro (+batch), Nano Banana 2, Gemini 2.5 Flash Image, Imagen 4 / Ultra / Fast; Veo 2.0-3.1; Lyria 3 Pro Preview. |
| `elevenlabs` | hidden | Eleven Music v2, Voice Design v3. |
| `openai` | no API-config entry | Only the hosted web-search model, platform role, not user selectable (`docs/architecture/modules/web-search.md` WS-02). |

Video capability facts per model (`src/lib/ai-providers/openrouter/video-models.ts`):

| Model | Durations (s) | Resolutions | Input modes | Reference limits |
| --- | --- | --- | --- | --- |
| Seedance 2.0 | 4-15 | 480p/720p/1080p | text, first frame, first+last, reference | 9 images, 3 audio, 3 video, 12 files; audio needs a visual; audio 1.8 s min, 15.2 s total |
| Seedance 2.0 Fast | 4-15 | 480p/720p | same | same |
| Seedance 2.5 | 4-30 | 480p/720p | same | 30 images, 10 audio, 10 video, 50 files; audio/video 2-30 s each, 30 s total |
| MiniMax H3 | 5-15 | 2K | text, first frame, first+last, reference | 9 images |
| MiniMax H3 Max | 5-15 | 480p/768p | text, first frame only | none; no audio generation |

### 4.2 How users configure keys and models

- Page: Profile -> API Configuration (`src/app/[locale]/profile/components/ApiConfigTab.tsx`, `api-config-tab/*`, `api-config/*`). Provider cards with base fields and model rows; "model slot" cards; an "extension media" section; filters/toolbar.
- API: `GET/PUT src/app/api/user/api-config/route.ts`, connection tests `test-connection` and `test-provider`; model list `src/app/api/user/models/route.ts`. Operations `get_user_api_config`, `put_user_api_config`, `list_user_models`, `api_user_api_config_test_connection`, `api_user_api_config_test_provider`.
- Secrets are write-only: the view returns only whether a key is configured, never the key (PG-11). Keys are encrypted with `API_ENCRYPTION_KEY` (`.env.example`).
- Selection model: **one fixed Assistant LLM** (`UserPreference.assistantModel`) and **exactly one configured model per media category**; an ambiguous media selection is an error (`src/lib/ai-registry/media-model-selection.ts`, `src/lib/platform-models/catalog.ts`). Per-model fixed parameters live in `capabilityDefaults`; fixed values are not overridable by the agent, unfixed ones are filled by the agent from the live tool schema (PG-23, APO-07).
- Project-level settings: only output aspect ratio (`get_project_config` / `update_project_config`), plus `videoResolution` / `imageResolution` columns.
- Credential modes: `user-key` (self-hosted default, user brings keys) or `platform-key` (operator sets `PLATFORM_<PROVIDER>_*` env and `PLATFORM_ENABLED_{LLM,IMAGE,VIDEO,MUSIC,VOICE}_MODELS`, `PLATFORM_DEFAULT_ASSISTANT_MODEL`) - `src/lib/deployment/config.ts`, `src/lib/platform-models/catalog.ts`.
- Custom OpenAI-compatible providers and custom model lists: columns exist (`customProviders`, `customModels`) and `@ai-sdk/openai-compatible` is a dependency; the current UI path for adding one is UNVERIFIED.
- Capability catalog standard: `standards/capabilities/image-video.catalog.json`, checked by `scripts/check-capability-catalog.mjs`.

### 4.3 Pricing, billing, credits

- Unit: integer **credits**; 1 credit = 0.1 CNY, 10 credits per CNY; all charges rounded up (`src/lib/billing/credits.ts`). Provider USD prices convert at a fixed 7.2 CNY/USD (`src/lib/ai-registry/pricing-currency.ts`).
- Each catalog entry has provider `cost` and user `retail`; when retail is not declared it is derived by markup: text 1.75x, image 2.0x, video 1.8x, music 1.8x, voice 1.8x; minimum margin fuse 0.18 (`src/lib/ai-registry/pricing-retail.ts`).
- Units: token (LLM), image, second (video, music), character (voice), call (`src/lib/task/types.ts` `TaskBillingInfo.unit`). Examples in code: ElevenLabs voice $0.10 / 1K characters, music $0.15 / generated minute (`elevenlabs/models.ts`).
- Modes: `BILLING_MODE` = `OFF` | `SHADOW` | `ENFORCE`; self-hosted defaults to `OFF`, cloud must be `ENFORCE` (`src/lib/billing/mode.ts`).
- Flow for media: plan -> immutable quote -> user approval card (or a budget via `maxBudgetCredits`) -> freeze credits in the same transaction that creates the task -> settle on success / roll back on failure or cancel (`src/lib/billing/ledger.ts`, `service.ts`, `task-policy.ts`, `docs/architecture/modules/billing-approval.md`). The per-user toggle `assistantBillingConfirmationRequired` controls whether the agent shows a quote card (`src/features/project-workspace/components/workspace-assistant/WorkspaceAssistantSettings.tsx`).
- LLM: post-paid, settled per provider generation with a micro-credit meter; pre-check is only a balance gate (BA-17, `LlmBillingMeter`). Self-hosted ignores it.
- Web search: one usage fact per search (WS-07).
- Two credit pools, subscription pool spent first and expiring at period end (BA-15).
- Payments (Stripe checkout, plans, wallet, WeChat Pay mention), subscription plans, admin credit grants, balance/costs/transactions endpoints: route files exist but the self-hosted edition returns 404 for all of them (`src/editions/self-hosted/routes.ts`); implementations are in `ee/` - UNVERIFIED.
- Per-project cost summary: `src/app/api/projects/[projectId]/costs/route.ts`.

### 4.4 Concurrency limits

- Per-user slot limits by scheduler class `analysis` / `image` / `video` (`src/lib/workflow-concurrency.ts`): code defaults 5 / 20 / 20; `.env.example` sets `DEFAULT_WORKFLOW_CONCURRENCY_ANALYSIS=5`, `_IMAGE=20`, `_VIDEO=10`; a user's stored `UserPreference.*Concurrency` overrides the default.
- Enforcement is a long-lived Temporal workflow per user, `user-task-scheduler` (`src/lib/temporal/workflows/user-task-scheduler.ts`): enqueue via workflow Update, queued/active sets, slot limits versioned, `continueAsNew` for history bounding. Not Redis semaphores.
- Task class mapping: image, music and voice tasks use the `image` class; video and merge use `video` (`src/lib/task/definition.ts`).
- The concurrency settings UI is disabled in self-hosted (`showWorkflowConcurrency: false`).
- SSE connections: max 8 per user, 4 per user+project, 2,000 global; lease TTL 75 s (`src/lib/sse/connection-lease.ts`).
- One active agent turn per project; one runtime session per `(userId, projectId)` (ARL-02, CRR-01).

---

## 5. User-facing screens and features

Routes under `src/app/[locale]/`:

| Screen | Path | Features |
| --- | --- | --- |
| Landing / home | `page.tsx`, `home/page.tsx`, `HomeClient.tsx`, `src/components/home/*` | Typewriter hero, showcase, one-line idea input with aspect-ratio selector, "Start making", recent projects, warning when no Assistant model is configured. |
| Sign in / sign up | `auth/signin/page.tsx`, `src/editions/self-hosted/AuthEntryCard.tsx` | Single combined page; self-hosted username + password. |
| Projects list ("Workspace") | `workspace/page.tsx` | Search, create/edit/delete project, per-project stats (folders, images, videos), pagination (`messages/en/workspace.json`). |
| Project workspace | `workspace/[projectId]/page.tsx`, `src/features/project-workspace/ProjectWorkspace.tsx` | Canvas (left/centre) + resizable, collapsible Assistant sidebar (right). |
| Asset Hub | `workspace/asset-hub/page.tsx` + `components/*` | Folders (one level), characters with multiple appearances, locations, props; create/edit modals; upload image; pick among candidate images; undo to previous image; delete; "Download All" ZIP. Operations in `src/lib/operations/domains/asset-hub/*` and `api-only/asset-hub-api-ops.ts`, `assets-api-ops.ts` (`select-render`, `revert-render`, variant update). AI image generation inside the hub: labels exist in `messages/en/assetHub.json` ("Generate", "Regenerate") but no hub task type exists - UNVERIFIED / likely not functional. A `GlobalAssetPicker` component exists (`src/components/shared/assets/GlobalAssetPicker.tsx`) but I found no caller outside its own file and the picker route; importing hub assets into a project (ASO-05) is UNVERIFIED. |
| Profile / settings | `profile/page.tsx`, `ProfileSidebar.tsx`, `ApiConfigTab.tsx` | API configuration (self-hosted); account overview, balance, transactions, per-project usage, credit records (cloud only); logout. |
| Pricing, contact, privacy, terms, refund policy | `pricing/`, `contact/`, `privacy/`, `terms/`, `refund-policy/` | 404 in self-hosted (`src/editions/self-hosted/pages.tsx`). |
| Global chrome | `src/components/Navbar.tsx`, `navbar/NavbarAccountMenu.tsx`, `LanguageSwitcher.tsx`, `UpdateNoticeModal.tsx`, `ProgressToast.tsx` | Workspace / Asset Hub / Settings nav, language switch (zh/en) preserving the path, balance chip (cloud), update check notice, error pages. |

### 5.1 Canvas features (`src/features/project-workspace/canvas/**`)

- Two node kinds only: `resourceCard` and `folder` (`registry/workspace-canvas-node-registry.ts`).
- One folder = one canvas; folder navigation with breadcrumb/back, search with cursor pagination, "locate file on canvas", folder expansion policy (`controls/CanvasFolderNavigation.tsx`, `projection/workspace-canvas-expansion-policy.ts`).
- Viewport controls: fit view, zoom in/out, reset layout; layout persisted per project + folder (`hooks/useCanvasLayoutPersistence.ts`, API `canvas-layout/route.ts`).
- Edges drawn only from real lineage.
- Create menu: generate image, generate video, upload material; draft card with brief, frame picker, duration, advanced parameters, reference picker with roles and model-aware limits (`create/*`, `controls/*`).
- Upload queue with stages uploading -> materializing -> ready, retry and dismiss (`upload/*`).
- Card details panel: generation prompt, model, input resources, file content viewer for text/structured documents, generation editor for "Run again" (`details/*`).
- Card actions by media type: text = discuss, preview, use as reference, retry, delete; image = run again, generate video, discuss, preview, download, use as reference, retry, delete; audio = discuss, preview, download, use as reference, retry, delete; video = run again, discuss, preview, download, use as reference, retry, delete.
- Live status on cards: submitted / queued / generating (percent) / saving, "waited N min", failure with provider diagnostic.
- Multi-select, drag a card onto a draft/editor as a reference, undo of deletes, confirmation modal with task count and max credits (`hooks/useCanvasMultiSelection.ts`, `useCanvasReferenceDrop.ts`, `useCanvasHistory.ts`, `actions/CanvasOperationConfirmationModal.tsx`).
- Auto-focus on new batches (`hooks/useCanvasFocusFollow.ts`).

### 5.2 Assistant features (`src/features/project-workspace/components/workspace-assistant/**`, `messages/en/assistantAgent.json`)

- Streaming chat with Markdown, stop generating, resend, "continue unfinished work" after an interrupted turn, copy answer.
- Steering: a message sent during an active turn is injected into that turn (ARL-02).
- Attachments: text files and image/audio/video chips; canvas selection is passed as context ("Selected on Canvas").
- Plan card (native `update_plan`) with completed/total progress.
- Work trace: reasoning, tool calls grouped with counts and states (success / submitted / failed / stopped / needs action / running), shell and file-change items, web search items with source favicons and source count, "Read Skill: ..." items.
- Interaction cards: billing quote approval ("Generate 3 images ... estimated N credits"), destructive confirmation, user decision card (2-4 options + custom answer) (`src/app/api/projects/[projectId]/assistant/interactions/[interactionId]/route.ts`).
- Background follow-up: when submitted tasks finish, the agent is resumed automatically ("Reviewing completed task results...").
- Settings popover: toggle "Confirm generation charges".
- Context compaction notices for long conversations.
- Clear conversation (archived server-side) - `ProjectAssistantThreadArchive`.
- Agent tools (MCP, `channels.mcp: true`): `list_resources`, `get_resource`, `create_folder`, `move_resource`, `delete_resource`, `restore_resource`, `save_project_document`, `create_image`, `create_audio`, `create_video`, `generate_voice`, `merge_videos`, `rerun_failed_production_items`, `register_uploaded_media`, `delete_asset`, plus `request_user_decision`; plus Codex-native shell (sandbox scratch only), file edits, web search, view image, plan.
- The agent identity must never be disclosed as Codex/OpenAI/GPT (`project-agent-system.txt`).
- Content policy baked into the prompt: real people / public figures / photoreal are allowed with no added screening; production about Chinese politics is declined (`project-agent-system.txt`). Flag this for your own policy review rather than copying it.

---

## 6. Async task system

### 6.1 Types and definitions

`src/lib/task/types.ts`, `src/lib/task/definition.ts`:

| Task type | Billing policy | Max business attempts | Scheduler class | Model key required |
| --- | --- | --- | --- | --- |
| `workspace_resource_image` | image | 3 | image | yes |
| `workspace_resource_audio` | music | 3 | image | yes |
| `workspace_resource_voice` | voice | 3 | image | yes |
| `workspace_resource_video` | video | 3 | video | yes |
| `workspace_resource_video_merge` | none | 1 | video | no |

All use execution protocol `handler_result_checkpoint` and materialiser `workspace_resource`. Handlers: `src/lib/task/execution/handlers/*`, dispatched by `src/lib/task/execution/registry.ts`.

### 6.2 States and events

- Task status: `queued`, `processing`, `completed`, `failed`, `canceled`, `dismissed`.
- Task events: `task.created`, `task.processing`, `task.progress`, `task.completed`, `task.failed`, `task.canceled` (persisted in `TaskEvent`).
- Resource status (UI): pending, queued, processing, ready ("succeeded"), failed, canceled.
- "retrying" is a projection while attempts remain; final failure is written once as a `FailureRecord` owned by the Task (TL-23).

### 6.3 Lifecycle

1. Operation planning validates everything and produces a plan + quote snapshot (`src/lib/operations/planning.ts`).
2. Approval grant (card or budget) (`src/app/api/operation-approval-grants/route.ts`, `src/lib/wao-mcp/approval-proof.ts`).
3. `operation-execution` Temporal workflow runs one persistence activity that, in one DB transaction, writes the operation output, Task rows, pending Resources, billing freezes and the follow-up batch (`src/lib/temporal/workflows/operation-execution.ts`, `activities/operation-execution.ts`, `src/lib/task/transactional-create.ts`). No fire-and-forget after commit (DE-05, TL-01, TL-22).
4. The per-user scheduler workflow admits tasks within slot limits.
5. `task` workflow (`src/lib/temporal/workflows/task.ts`): `initializeTaskWorkflow` -> `beginTaskAttempt` -> `runTaskAttempt` (start-to-close 30 days, heartbeat timeout 45 s, waits for cancellation to complete) -> `commitTaskTerminal` -> `releaseTaskCapacity` -> `notifyTaskFollowUp`.
6. Provider calls go through an idempotency ledger (`src/lib/task/provider-invocation.ts`): logical identity, input fingerprint, route, external id, result; uncertain acceptance is written as `outcome_unknown` and is never blindly resubmitted (TL-08, DE-09).
7. Terminal commit is one transaction: Task terminal state, billing settlement, Resource + lineage materialisation, follow-up member update (`src/lib/task/terminal/service.ts`, `src/lib/workspace-resource/task-materializer.ts`).

### 6.4 Progress delivery (SSE)

- Endpoint: `GET /api/sse?projectId=...&connectionId=<uuid v4>` (`src/app/api/sse/route.ts`), Redis pub/sub per project channel (`src/lib/task/publisher.ts`, `src/lib/sse/shared-subscriber.ts`).
- Event types: `task.lifecycle`, `task.stream`, `resource.changed`, `assistant.view.changed`, `agent.turn.stream` (`src/lib/sse/events.ts`).
- Resume: cursor `v5;t=<taskEventId>` via `Last-Event-ID` header or `cursor` query (`src/lib/sse/protocol.ts`).
- Heartbeat every 15 s carrying `workspaceResourceRevision`; client timeout 45 s.
- Progress numbers are reported by handlers (for example 5 received, 20 prepare/submit, 30-80 polling by elapsed ratio, 85-90 persist) via `src/lib/task/execution/progress.ts`; the client also shows estimated progress (`src/lib/task/estimated-progress.ts`, `src/lib/query/hooks/useEstimatedTaskProgress.ts`).
- Polling fallbacks for state: `GET /api/tasks`, `GET /api/tasks/[taskId]`, `POST /api/task-target-states`.
- Agent text streaming uses the same SSE channel with monotonic chunk sequence numbers so a refresh can resume mid-turn (ARL-11).

### 6.5 Failure handling

- `FailureRecord` keeps native provider evidence plus a product interpretation (code, i18n) and a recovery fact; replay permission comes only from the operation registry, never from error codes or messages (`src/lib/errors/failure`, `src/lib/ai-providers/failure.ts`, `docs/architecture/modules/failure-governance.md`).
- Browser shows localised stable codes only, with optional "Provider error: ..." diagnostic (`messages/en/errors.json`, `project-workflow.json`).
- Statistics script: `scripts/task-error-stats.ts`.
- Queue timeout vs generation timeout are separate budgets; a queue timeout voids the old request, tries to cancel it and retries with a new request (`.env.example` comment).

### 6.6 Cancellation

- Task: operation `cancel_task` -> Temporal workflow Update `cancel` (`src/lib/operations/domains/task/task-ops.ts`, `src/lib/temporal/workflows/task.ts`). A committed handler result wins over a late cancel; provider-side cancel is a compensation that runs only after a canceled terminal receipt (TL-10, PG-06B).
- Agent turn: `POST /api/projects/[projectId]/assistant/turns/[turnId]/cancel`; cancelling a turn does not cancel background tasks (ARL-06, ARL-13).
- Clearing a thread closes its pending follow-up batches; late tasks only settle (DE-13).
- Project delete is refused while non-terminal tasks or active turns exist (ASO-10).

---

## 7. License and attribution

- License file: `LICENSE` = **Elastic License 2.0** (ELv2). README: "Starting with v0.5.0-beta.1, this distribution is licensed under Elastic License 2.0 ... This is source-available software, not OSI-approved open source. ... Earlier releases retain their original licenses; third-party components retain their respective licenses."
- So despite common description, this version is **not open source**. The licence of earlier (staged-pipeline) releases is UNVERIFIED from this snapshot.

Obligations and limits under ELv2 (from `LICENSE`):

| Rule | Text summary |
| --- | --- |
| Grant | Non-exclusive, royalty-free right to use, copy, distribute, make available and prepare derivative works. |
| Limitation 1 | You may not provide the software to third parties as a hosted or managed service that gives users access to any substantial set of its features. |
| Limitation 2 | You may not move, change, disable or circumvent licence-key functionality, or remove/obscure functionality protected by a licence key. |
| Limitation 3 | You may not alter, remove or obscure licensing, copyright or other notices of the licensor. Trademark use is subject to law. |
| Notices | Anyone receiving a copy of any part must also get the licence terms; modified copies must carry prominent notices that you modified the software. |
| Patents | Patent licence granted; terminates if you bring a patent claim against the software. |
| Termination | Automatic on violation; reinstated if cured within 30 days of notice, once. |

Practical reading for JAgentChill (not legal advice - have counsel confirm):

- Reading the code to learn product design, flows and ideas and then writing an independent implementation is a different act from copying. Copying or adapting waoowaoo source files, prompt/Skill text, or schema files into JAgentChill makes JAgentChill a derivative carrying ELv2 conditions, and offering that as a hosted product to third parties is exactly what limitation 1 prohibits without separate permission from the licensor.
- The Skill documents (`src/lib/creative-skills/skills/*/SKILL.md`) and system prompts are part of "the software". Treat them as reference to understand the method; do not paste them.
- If any waoowaoo code is redistributed, ship the ELv2 text and a prominent modification notice, and keep their notices intact.
- Third-party components keep their own licences (for example `ffmpeg-ffprobe-static`, Temporal, `@openai/codex`, Next.js). The Codex CLI itself is a separate product with its own terms - UNVERIFIED here.
- Trademark: the name "waoowaoo" / "WaooWaoo Creative Assistant" should not be used for your product.

---

## 8. FEATURE-CHECKLIST

Status tags: `[P]` present in code, `[P-hidden]` code path exists but README/manifest says not exposed in this preview, `[cloud]` only in the absent `ee/` tree (UNVERIFIED), `[absent]` not in this snapshot.

Project and workspace

- [P] Create project from a one-line idea plus aspect ratio in a single operation
- [P] Project list with search, edit name/description, delete, per-project stats
- [P] Project-level output aspect ratio setting (11 ratios: 16:9, 9:16, 1:1, 3:2, 2:3, 4:3, 3:4, 5:4, 4:5, 21:9, 9:21)
- [P] Project file/folder tree as the only content model (folders, text, image, audio, video)
- [P] Folder = canvas; folder navigation, back, breadcrumb
- [P] File search with cursor pagination and "locate on canvas"
- [P] Create folder, move/rename (atomic subtree move), soft delete, restore
- [P] Immutable content versions per resource
- [P] Lineage graph (input -> output edges with roles)
- [P] Canvas layout persistence per folder (position, size, z-index, lock, collapse, viewport)
- [P] Canvas fit view / zoom / reset layout
- [P] Canvas multi-select and undo of deletions
- [P] Upload image/audio/video to the current folder with upload queue and retry
- [P] Magic-byte upload validation; 25 MB image / 100 MB audio / 512 MB video
- [P] Per-project cost summary endpoint
- [absent] Episode / clip / scene / shot entities
- [absent] Timeline editor UI

Assistant

- [P] Project chat assistant with streaming and resumable mid-turn refresh
- [P] Stop turn, resend, continue interrupted work
- [P] Steer an in-flight turn with a new message
- [P] Text attachments (.txt, .md, .docx; 4 files, 8 MB, 120k chars)
- [P] Media attachments in chat
- [P] Canvas selection as chat context; "Discuss with AI" from a card
- [P] Plan card with progress
- [P] Work trace of reasoning, tools, shell, file changes, skills read
- [P] User decision cards (2-4 options + free text)
- [P] Billing quote approval cards; toggle to require confirmation
- [P] Destructive-action confirmation cards
- [P] Auto-resume of the agent when background tasks finish (follow-up batches)
- [P] Web search with cited sources (needs server `OPENAI_API_KEY`)
- [P] Context compaction for long conversations
- [P] Clear conversation with hidden server archive
- [P] Sandboxed per-project agent runtime container with CPU/memory/PID limits and idle stop
- [P] Single fixed Assistant model per user
- [absent] Import a web-search image as a project reference (schema exists, operation empty)
- [absent] Sub-agents / multi-agent delegation (explicitly disabled)

Writing and direction

- [P] Script/screenplay generation with three need types (story, commercial, feed video)
- [P] Three-candidate content direction choice before writing
- [P] Faithful preservation of a user-supplied script; transcription from an image
- [P] Explicit "save document" for screenplay / direction / batches (structured JSON resources)
- [P] Creative Direction document with six domains and mandatory hex palette
- [P] Duration discipline (fixed vs derived) with speech-rate estimation
- [P] Continuation anchoring for sequels/next episodes via exit states
- [absent] Automatic novel -> episode splitting stage
- [absent] Automatic clip splitting / screenplay conversion stage (only unreferenced canary fixtures remain)

Assets

- [P] Asset selection with three gates; explicit "no assets" outcome
- [P] Character sheet image (4:3, face close-up + full body, white background)
- [P] Location image (4:3 frontal full space, no people)
- [P] Prop image (4:3 single centred object, white background)
- [P] Fixed 4:3 asset aspect ratio enforced server-side
- [P] 1-6 candidates per asset item
- [P] Reference images as input to image generation (14-16 per model)
- [P] Post-generation asset review checkpoint
- [P] Global Asset Hub: folders, characters with multiple appearances, locations, props
- [P] Asset Hub image upload, candidate select, undo to previous image, delete, ZIP download
- [P] UNVERIFIED: AI generation inside the Asset Hub
- [P] UNVERIFIED: importing Asset Hub assets into a project
- [absent] Per-project character appearance/costume table
- [absent] Style reference image / mood board as an asset type

Video

- [P] Text-to-video
- [P] First-frame image-to-video
- [P] First + last frame video (model dependent; not MiniMax H3 Max)
- [P] Multi-reference video (images, audio, video) with per-model limits
- [P] Native audio generation toggle (dialogue and SFX from the video model)
- [P] Voice reference audio bound to a character in the prompt
- [P] Structured multi-shot segment prompt with entry/exit states
- [P] Segment durations 4-30 s depending on model
- [P] 1-6 candidates per video item
- [P] "Generate video" (animate) from an image card
- [P] "Run again" with edited prompt, frame, parameters, duration, references
- [P] Exact retry of failed items; batch rerun of failed items
- [P] In-place corrected regeneration of a failed video (`revise_failed`)
- [absent] Storyboard panels / panel images / panel variants
- [absent] Separate lip-sync stage or model
- [absent] Shot-level regeneration inside a segment

Audio

- [P-hidden] Voice design from description with preview clip (ElevenLabs Voice Design v3, FAL Qwen 3 TTS Voice Design)
- [P-hidden] Score cue generation from a composition plan (Eleven Music v2; Lyria 3 Pro)
- [P] Score decision checkpoint with explicit "no music"
- [P] Sparse multi-cue scoring with absolute start, fade in/out, gain
- [absent] Per-line TTS narration / dubbing
- [absent] Subtitles (generation, burn-in, export)
- [absent] Standalone SFX generation

Assembly and export

- [P] Trim and concatenate up to 50 clips, frame-aligned at 30 fps
- [P] Output aspect ratio with letterboxing; 480p/720p/1080p short edge
- [P] Preserve or mute audio
- [P] Mix score cues onto a merged video with loudness normalisation and dialogue ducking
- [P] Per-resource download
- [absent] Transitions, titles, captions, overlays, colour, speed controls
- [absent] Project export package / NLE interchange

Providers and configuration

- [P] OpenRouter API key + model configuration UI with connection test
- [P] Model types: LLM, image, video, music, voice
- [P] One model per media category; fixed per-model parameters
- [P] Model-aware parameter and reference validation before quoting
- [P] Write-only encrypted provider secrets
- [P] User-key and platform-key credential modes
- [P-hidden] Additional providers in code: Volcengine Ark, FAL, Google AI Studio, ElevenLabs
- [P] No automatic model fallback
- [P] SSRF-safe outbound media fetch; private-host allowlist
- [P] UNVERIFIED: custom OpenAI-compatible provider UI

Tasks and reliability

- [P] Durable tasks on Temporal with versioned blue/green workers
- [P] Five task types (image, music, voice, video, video merge)
- [P] Per-user concurrency slots by class (analysis/image/video)
- [P] Atomic task creation with resource reservation and billing freeze
- [P] Provider invocation idempotency ledger; `outcome_unknown` stop
- [P] Separate provider queue and generation timeouts
- [P] Up to 3 business attempts; infrastructure retries do not consume attempts
- [P] Task cancel with "committed result wins" rule and provider-side compensation
- [P] SSE progress with resumable cursor, heartbeat, connection leases
- [P] Structured failure records with native provider evidence and localised codes
- [P] Batch limit of 64 tasks per operation execution

Billing and account

- [P] Billing modes OFF / SHADOW / ENFORCE (self-hosted default OFF)
- [P] Integer credit ledger, freeze/settle/rollback, two credit pools
- [P] Quote before every billable media operation; optional budget ceiling
- [P] Retail markup rules per modality
- [cloud] Stripe payments, plans/subscriptions, wallet top-up, admin credit grants
- [cloud] Balance, transactions and usage pages
- [cloud] Phone SMS / WeChat / Google sign-in, account security page
- [cloud] Announcements, public-beta waitlist, paid-beta seats
- [P] Username + password auth (min length 8), rate limiting behind declared proxy hops
- [P] zh / en UI with language switcher
- [P] Update-available notice
- [P] Structured logging, audit log, optional agent trace debug

Deployment

- [P] Docker Compose stack: Caddy, app, MySQL, Redis, MinIO, Temporal, workers, codex-runtime
- [P] Private MinIO behind an owner-aware media proxy; signed S3 in cloud
- [P] Preflight/edition checks and many `check:*` governance scripts

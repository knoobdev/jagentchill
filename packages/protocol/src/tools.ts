import { z } from "zod";
import type { SyncPatchEntry } from "./sync.ts";

/** Tool-domain codes of `agent-editing-tools.Error codes`; the general ones are in `errors.ts`. */
export const TOOL_ERROR_CODES = [
  "PROJECT_NOT_FOUND", "SCENE_NOT_FOUND", "TRACK_NOT_FOUND", "ELEMENT_NOT_FOUND", "ASSET_NOT_FOUND", "ASSET_NOT_READY", "TRACK_LOCKED",
  "TRACK_KIND_MISMATCH", "OVERLAP_NOT_ALLOWED", "OUT_OF_RANGE", "SOURCE_EXHAUSTED", "UNSUPPORTED_FOR_ELEMENT", "LIBRARY_ITEM_NOT_FOUND",
  "LEASE_UNAVAILABLE", "WRITER_HELD", "DEVICE_REQUIRED", "PROPOSAL_NOT_FOUND", "PROPOSAL_CLOSED", "PROPOSAL_STALE", "PROPOSAL_TOO_LARGE",
  "PLAN_NOT_APPROVED", "MODE_READ_ONLY", "PROVIDER_ERROR", "CONTENT_BLOCKED", "JOB_NOT_FOUND", "RESULT_TOO_LARGE", "TOOL_NOT_AVAILABLE",
  // A call that waits for a person (`server-api.Approval and question resolution`) and a request answered twice.
  "APPROVAL_PENDING", "ALREADY_RESOLVED",
] as const;
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];
/** The only codes a tool error may be retried on. */
export const RETRYABLE_TOOL_CODES: readonly string[] = ["LEASE_UNAVAILABLE", "WRITER_HELD", "RATE_LIMITED", "ASSET_NOT_READY", "RENDERER_UNAVAILABLE", "TIMEOUT", "GATEWAY_UNAVAILABLE", "SESSION_UNBOUND", "APPROVAL_PENDING", "AGENT_BUSY", "AGENT_LIMIT_CHILDREN", "AGENT_LIMIT_CONCURRENT", "TEAM_LIMIT_CONCURRENT_PEERS"];

export const TOOL_NAME_PATTERN = /^jc_[a-z]+(_[a-z0-9]+)+$/;
export const TOOL_NAME_MAX = 48;
export const TOOL_DESCRIPTION_MAX = 600;
export const TOOL_RESULT_MAX_BYTES = 32 * 1024;
export const TOOL_LIST_DEFAULT_LIMIT = 50;
export const TOOL_LIST_MAX_LIMIT = 200;
export const TOOL_ARRAY_MAX = 200;
export const PROPOSAL_MAX_CHANGES = 2000;
export const PROPOSAL_EXPIRY_MS = 7 * 86_400_000;
export const PROPOSAL_INVERSE_RETENTION_MS = 30 * 86_400_000;
export const IDEMPOTENCY_RETENTION_MS = 86_400_000;
export const WRITER_IDLE_MS = 120_000;
export const DEVICE_FLUSH_WAIT_MS = 2000;
/** Per-session limits of `agent-editing-tools.Rate guard`. */
export const TOOL_RATE_LIMITS = { callsPerMinute: 120, callsPerTurn: 200, stagedChangesPerTurn: 600, questionsPerTurn: 10 } as const;
/** An unanswered permission request denies after 30 minutes; an unanswered question is skipped after 24 hours. */
export const APPROVAL_TIMEOUT_MS = 1_800_000;
export const QUESTION_EXPIRY_MS = 86_400_000;
/** The largest file `jc_media_import` takes from a URL, and how many redirects it follows. */
export const MEDIA_IMPORT_MAX_BYTES = 5 * 1024 * 1024 * 1024;
export const MEDIA_IMPORT_MAX_REDIRECTS = 3;

export const TOOL_FAMILIES = [
  "project", "scene", "media", "search", "timeline", "editor", "frame", "transcript", "track", "clip", "range", "multicam", "text", "caption", "audio", "effect",
  "filter", "transition", "color", "keyframe", "speed", "mask", "chroma", "cutout", "sticker", "shape", "marker", "template", "proposal", "session", "generate", "agent", "workflow", "film",
] as const;
export type ToolFamily = (typeof TOOL_FAMILIES)[number];

/** The family index of `agent-editing-tools.Tool naming and families` for the families this capability owns. */
export const TOOL_INDEX: Record<string, readonly string[]> = {
  project: ["jc_project_list", "jc_project_get", "jc_project_create", "jc_project_update", "jc_project_duplicate", "jc_project_trash", "jc_project_restore"],
  scene: ["jc_scene_list", "jc_scene_edit"],
  media: ["jc_media_list", "jc_media_get", "jc_media_import", "jc_media_organize", "jc_media_analyze", "jc_motion_scene"],
  search: ["jc_stock_search", "jc_library_search"],
  timeline: ["jc_timeline_snapshot", "jc_timeline_find"],
  editor: ["jc_editor_context", "jc_editor_focus"],
  frame: ["jc_frame_render", "jc_video_check"],
  transcript: ["jc_transcript_get", "jc_transcript_create"],
  track: ["jc_track_edit"],
  clip: [
    "jc_clip_add", "jc_clip_move", "jc_clip_trim", "jc_clip_split", "jc_clip_delete", "jc_clip_duplicate", "jc_clip_reorder", "jc_clip_group", "jc_clip_link", "jc_clip_compound",
    "jc_clip_replace_media", "jc_clip_set_enabled", "jc_clip_set_range", "jc_clip_transform", "jc_clip_animation", "jc_clip_detach_audio", "jc_clip_freeze", "jc_clip_stabilize", "jc_clip_rename",
  ],
  range: ["jc_range_delete", "jc_gap_close"],
  multicam: ["jc_multicam_create", "jc_multicam_switch", "jc_multicam_set_audio"],
  text: ["jc_text_add", "jc_text_update"],
  caption: ["jc_caption_generate", "jc_caption_import", "jc_caption_edit", "jc_caption_style", "jc_caption_translate", "jc_caption_export"],
  audio: ["jc_audio_edit", "jc_audio_duck", "jc_audio_crossfade", "jc_audio_beats"],
  effect: ["jc_effect_apply", "jc_effect_update", "jc_effect_remove"],
  filter: ["jc_filter_apply", "jc_filter_remove"],
  transition: ["jc_transition_set", "jc_transition_remove"],
  color: ["jc_color_adjust", "jc_color_match"],
  keyframe: ["jc_keyframe_set", "jc_keyframe_remove", "jc_keyframe_properties"],
  speed: ["jc_speed_set"],
  mask: ["jc_mask_set"],
  chroma: ["jc_chroma_set"],
  cutout: ["jc_cutout_set"],
  sticker: ["jc_sticker_add", "jc_sticker_update"],
  shape: ["jc_shape_add", "jc_shape_update"],
  marker: ["jc_marker_edit"],
  template: ["jc_template_apply", "jc_template_save", "jc_template_edit"],
  proposal: ["jc_proposal_begin", "jc_proposal_submit", "jc_proposal_status", "jc_proposal_discard", "jc_proposal_revert"],
  session: ["jc_session_ask"],
  agent: ["jc_agent_create", "jc_agent_list", "jc_agent_send", "jc_agent_status", "jc_agent_wait", "jc_agent_cancel", "jc_agent_handback", "jc_agent_handback_respond", "jc_agent_catalog", "jc_agent_activity", "jc_agent_archive", "jc_agent_update", "jc_agent_set_mode", "jc_agent_set_model", "jc_agent_handoff", "jc_agent_handoff_respond", "jc_team_bootstrap_lead", "jc_team_create_peer", "jc_team_accept_result", "jc_team_resolve_dissent", "jc_review_submit"],
  workflow: ["jc_workflow_list", "jc_workflow_get", "jc_workflow_create", "jc_workflow_edit", "jc_workflow_start", "jc_workflow_status", "jc_workflow_cancel"],
  film: ["jc_film_get", "jc_film_update_story", "jc_film_upsert_character", "jc_film_delete_character", "jc_film_upsert_scene", "jc_film_delete_scene", "jc_film_reorder_scenes", "jc_film_upsert_shot", "jc_film_delete_shot"],
  generate: ["jc_generate_image", "jc_generate_speech", "jc_generate_music", "jc_generation_status", "jc_generation_cancel"],
};

/**
 * The tool manifest: every `jc_*` tool the server serves, with its family. The MCP tool list is built from the server's
 * definitions and checked against this list; a tool of the index that is absent here is not served because the feature
 * behind it does not exist on this host (an agent never sees a tool that cannot work).
 */
export const TOOL_MANIFEST: readonly { name: string; family: ToolFamily }[] = [
  ...["jc_project_list", "jc_project_get", "jc_project_create", "jc_project_update", "jc_project_duplicate", "jc_project_trash", "jc_project_restore"].map((name) => ({ name, family: "project" as const })),
  ...["jc_scene_list", "jc_scene_edit"].map((name) => ({ name, family: "scene" as const })),
  ...["jc_media_list", "jc_media_get", "jc_media_import", "jc_media_organize", "jc_motion_scene"].map((name) => ({ name, family: "media" as const })),
  { name: "jc_library_search", family: "search" },
  ...["jc_timeline_snapshot", "jc_timeline_find"].map((name) => ({ name, family: "timeline" as const })),
  ...["jc_editor_context", "jc_editor_focus"].map((name) => ({ name, family: "editor" as const })),
  ...["jc_frame_render", "jc_video_check"].map((name) => ({ name, family: "frame" as const })),
  { name: "jc_track_edit", family: "track" },
  ...[
    "jc_clip_add", "jc_clip_move", "jc_clip_trim", "jc_clip_split", "jc_clip_delete", "jc_clip_duplicate", "jc_clip_reorder", "jc_clip_group", "jc_clip_link", "jc_clip_compound",
    "jc_clip_replace_media", "jc_clip_set_enabled", "jc_clip_set_range", "jc_clip_transform", "jc_clip_animation", "jc_clip_detach_audio", "jc_clip_freeze", "jc_clip_rename",
  ].map((name) => ({ name, family: "clip" as const })),
  ...["jc_range_delete", "jc_gap_close"].map((name) => ({ name, family: "range" as const })),
  ...["jc_text_add", "jc_text_update"].map((name) => ({ name, family: "text" as const })),
  { name: "jc_template_edit", family: "template" },
  ...["jc_caption_import", "jc_caption_edit", "jc_caption_style", "jc_caption_export"].map((name) => ({ name, family: "caption" as const })),
  ...["jc_audio_edit", "jc_audio_duck", "jc_audio_crossfade"].map((name) => ({ name, family: "audio" as const })),
  ...["jc_effect_apply", "jc_effect_update", "jc_effect_remove"].map((name) => ({ name, family: "effect" as const })),
  ...["jc_filter_apply", "jc_filter_remove"].map((name) => ({ name, family: "filter" as const })),
  ...["jc_transition_set", "jc_transition_remove"].map((name) => ({ name, family: "transition" as const })),
  { name: "jc_color_adjust", family: "color" },
  ...["jc_keyframe_set", "jc_keyframe_remove", "jc_keyframe_properties"].map((name) => ({ name, family: "keyframe" as const })),
  { name: "jc_speed_set", family: "speed" },
  { name: "jc_mask_set", family: "mask" },
  { name: "jc_chroma_set", family: "chroma" },
  ...["jc_sticker_add", "jc_sticker_update"].map((name) => ({ name, family: "sticker" as const })),
  ...["jc_shape_add", "jc_shape_update"].map((name) => ({ name, family: "shape" as const })),
  { name: "jc_marker_edit", family: "marker" },
  ...["jc_proposal_begin", "jc_proposal_submit", "jc_proposal_status", "jc_proposal_discard", "jc_proposal_revert"].map((name) => ({ name, family: "proposal" as const })),
  { name: "jc_session_ask", family: "session" },
  ...["jc_agent_create", "jc_agent_list", "jc_agent_send", "jc_agent_status", "jc_agent_wait", "jc_agent_cancel", "jc_agent_handback", "jc_agent_handback_respond", "jc_agent_catalog", "jc_agent_activity", "jc_agent_archive", "jc_agent_update", "jc_agent_set_mode", "jc_agent_set_model", "jc_agent_handoff", "jc_agent_handoff_respond", "jc_team_bootstrap_lead", "jc_team_create_peer", "jc_team_accept_result", "jc_team_resolve_dissent", "jc_review_submit"].map((name) => ({ name, family: "agent" as const })),
  ...["jc_workflow_list", "jc_workflow_get", "jc_workflow_create", "jc_workflow_edit", "jc_workflow_start", "jc_workflow_status", "jc_workflow_cancel"].map((name) => ({ name, family: "workflow" as const })),
  ...["jc_film_get", "jc_film_update_story", "jc_film_upsert_character", "jc_film_delete_character", "jc_film_upsert_scene", "jc_film_delete_scene", "jc_film_reorder_scenes", "jc_film_upsert_shot", "jc_film_delete_shot"].map((name) => ({ name, family: "film" as const })),
  ...["jc_generate_image", "jc_generate_speech", "jc_generate_music", "jc_generation_status", "jc_generation_cancel"].map((name) => ({ name, family: "generate" as const })),
];
/** Tools of the manifest that are served only while the host has what they need (a connected generation provider with an enabled model of the capability). */
export const TOOL_CONDITIONAL: readonly string[] = ["jc_generate_image", "jc_generate_speech", "jc_generate_music"];

export type ToolCatalogEntry = {
  name: string; family: ToolFamily; owner: "agent-editing-tools"; description: string; parametersSchema: Record<string, unknown>;
  readOnly: boolean; readsAmbientState: boolean; needsProject: boolean; needsWriterToken: boolean; costed: boolean;
  approval: "never" | "by-mode" | "always"; agentClasses: ("creative" | "workspace")[];
};

export type ToolError = { code: string; message: string; details?: Record<string, unknown>; retryable: boolean };
/** What every tool returns as its one JSON text block. */
export type ToolEnvelope = {
  ok: boolean; data?: unknown; warnings: string[]; revision?: number; proposalId?: string; changeIds?: string[]; summary?: string; replayed?: boolean; error?: ToolError;
};

// — Proposals —
export const PROPOSAL_STATES = ["open", "pending", "applying", "accepted", "partially_accepted", "rejected", "stale", "expired", "failed"] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];
export type ProposalChangeKind = "add" | "modify" | "remove" | "move";
export type ProposalEntity = "element" | "track" | "scene" | "marker" | "project";
export type ProposalChange = {
  changeId: string; kind: ProposalChangeKind; entity: ProposalEntity; entityId: string; label: string; tool: string; summary: string;
  before?: unknown; after?: unknown; dependsOn: string[];
};
export type ProposalFrame = { mime: string; dataBase64: string; time: number; width: number; height: number };
/** A proposal as `jagentchill.proposal.get` returns it and `jagentchill.proposal.updated` announces it. */
export type ProposalView = {
  proposalId: string; projectId: string; state: ProposalState; title: string; summary: string;
  author: { sessionId: string; agentId: string; agentTitle: string };
  baseRevision: number; created_ms: number; submitted_ms?: number; resolved_ms?: number; expires_ms?: number;
  changes: ProposalChange[];
  totals: { add: number; modify: number; remove: number; move: number };
  /** Elements the proposal adds, changes or removes, by id: what an editor outlines. */
  elements: { added: string[]; modified: string[]; removed: string[] };
  affectedDuration: number; durationBefore: number; proposedDuration: number;
  /** The frame rate of the project, for the timecodes a card shows. */
  fps?: { numerator: number; denominator: number };
  framesUnavailable: boolean; frames?: { before: ProposalFrame; after: ProposalFrame };
  /** The preview descriptor: the patch list a client applies to its copy at `baseRevision` to render the proposed state without committing. */
  preview: { baseRevision: number; patches: SyncPatchEntry[] };
  acceptedChangeIds?: string[]; feedback?: string; error?: ToolError;
  /** Set once accepted: the revision the batch produced, and what happened to it since. */
  appliedRevision?: number; revert?: { state: "available" | "reverted" | "expired"; reverted_ms?: number; revertedByDeviceId?: string; revertedByName?: string; until_ms?: number };
  /** The accepting device was not the one editing: the batch was sent to this device. */
  sentToDeviceName?: string;
};
/** A tool refused for a reason the chat shows as a card of its own (`PROJECT_NOT_SYNCED`, `WRITER_HELD`, `RENDERER_UNAVAILABLE`). */
export type ToolNotice = { noticeId: string; sessionKey: string; code: "PROJECT_NOT_SYNCED" | "WRITER_HELD" | "RENDERER_UNAVAILABLE" | "TURN_LIMIT"; projectId?: string; deviceName?: string; holderTitle?: string; tool: string; created_ms: number; /** A `TURN_LIMIT` line whose "Continue" was used. */ continued?: boolean };

// — Requests a tool puts to a person: permission for an effect outside the project, and questions —
export type PermissionDecision = "allow-once" | "allow-session" | "deny";
/**
 * A paid generation call on a permission card, as FACTS the screen words in its own language (the host's `toolLabel`
 * and `detail` are English sentences): what is made, the model by its name, the amount (null: price not known), where
 * the allowance a person set stands, and the words the call asks with.
 */
export type PermissionMoney = {
  capability: string; modelLabel: string; amountUsd: number | null; words: string;
  standing?: { kind: "message"; totalUsd: number; allowanceUsd: number } | { kind: "session"; spentUsd: number; allowanceUsd: number } | { kind: "session_unknown"; allowanceUsd: number };
};
/** A permission request as `permission_requested` announces it (`chat-agent.Permission request cards`). */
export type PermissionRequest = {
  requestId: string; sessionKey: string; kind: "out-of-project"; tool: string; toolLabel: string; detail: string; projectId?: string; actions: PermissionDecision[];
  requiredScope: string[]; adminOnly: boolean; state: "pending" | "allowed" | "denied" | "expired"; decision?: PermissionDecision; reason?: string;
  resolver?: { kind: "device"; deviceId: string; deviceName: string } | { kind: "system"; reason: string }; created_ms: number; decided_ms?: number; expires_ms: number;
  /** A generation prompt that copies 200 or more characters in a row of content from outside: the whole prompt, shown before anything is sent. */
  copiedPrompt?: string;
  /** A paid generation call: the facts of its title and money line, worded by the screen in its language (`detail` stays as the English fallback). */
  money?: PermissionMoney;
};
export type QuestionKind = "single" | "multi" | "text";
export type Question = { id: string; text: string; kind: QuestionKind; /** A few words naming the question: its tab when a card holds several. */ header?: string; options?: { label: string; description?: string }[] };
export type QuestionAnswer = { id: string; value?: string; values?: string[]; text?: string; skipped: boolean };
/** A question card: up to four questions the agent put in one call, answered together. */
export type QuestionRequest = {
  questionId: string; sessionKey: string; questions: Question[]; state: "pending" | "answered" | "skipped" | "expired"; answers?: QuestionAnswer[];
  answeredByDeviceId?: string; created_ms: number; resolved_ms?: number; expires_ms: number;
};

const proposalId = z.string().uuid();
export const TOOL_METHODS = {
  "jagentchill.tool.catalog": "jagentchill.projects.read",
  "jagentchill.proposal.get": "jagentchill.projects.read",
  "jagentchill.proposal.list": "jagentchill.projects.read",
  "jagentchill.proposal.resolve": "jagentchill.projects.write",
  "jagentchill.proposal.revert": "jagentchill.projects.write",
  "jagentchill.proposal.frames.put": "jagentchill.projects.read",
  "jagentchill.editor.context.report": "jagentchill.projects.read",
  "jagentchill.editor.frame.result": "jagentchill.projects.read",
  "jagentchill.chat.approval.list": "jagentchill.projects.read",
  // Answering needs `jagentchill.agent.use` and `jagentchill.projects.write`; the method checks the second itself.
  "jagentchill.chat.approval.resolve": "jagentchill.agent.use",
  "jagentchill.chat.question.list": "jagentchill.projects.read",
  "jagentchill.chat.question.answer": "jagentchill.agent.use",
} as const;
export type ToolMethod = keyof typeof TOOL_METHODS;
const sessionKey = z.string().min(1).max(200);
const frame = z.object({ mime: z.enum(["image/jpeg", "image/png"]), dataBase64: z.string().min(1).max(1_400_000), time: z.number().int().min(0), width: z.number().int().min(1).max(1280), height: z.number().int().min(1).max(1280) }).strict();
export const TOOL_PARAMS = {
  "jagentchill.tool.catalog": z.object({}).strict(),
  "jagentchill.proposal.get": z.object({ proposalId }).strict(),
  "jagentchill.proposal.list": z.object({ sessionKey: z.string().min(1).max(200).optional(), projectId: z.string().min(1).max(64).optional() }).strict(),
  "jagentchill.proposal.resolve": z.object({
    proposalId, action: z.enum(["accept", "accept_partial", "reject"]), changeIds: z.array(z.string().min(1).max(64)).max(PROPOSAL_MAX_CHANGES).optional(),
    includeDependencies: z.boolean().optional(), feedback: z.string().max(2000).optional(),
  }).strict(),
  "jagentchill.proposal.revert": z.object({ proposalId, force: z.boolean().optional() }).strict(),
  /** The before/after pair of a pending proposal, rendered by the device that has the project open. */
  "jagentchill.proposal.frames.put": z.object({ proposalId, before: frame, after: frame }).strict(),
  /** What the person has in the editor on this device; sent when it changes, at most a few times a second. */
  "jagentchill.editor.context.report": z.object({
    projectId: z.string().min(1).max(64), sceneId: z.string().min(1).max(64), playhead: z.number().int().min(0), selectedElementIds: z.array(z.string().min(1).max(64)).max(500),
    selectedRange: z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }).strict().nullable(), inPoint: z.number().int().min(0).nullable(), outPoint: z.number().int().min(0).nullable(),
    panel: z.string().max(40).nullable(), zoomWindow: z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }).strict().nullable(), focusedSessionKey: z.string().max(200).nullable(),
    /** Changes of this device that the host does not have yet. */
    pendingOps: z.number().int().min(0).optional(),
  }).strict(),
  "jagentchill.chat.approval.list": z.object({ sessionKey }).strict(),
  "jagentchill.chat.approval.resolve": z.object({ requestId: z.string().uuid(), decision: z.enum(["allow-once", "allow-session", "deny"]), reason: z.string().max(2000).optional() }).strict(),
  "jagentchill.chat.question.list": z.object({ sessionKey }).strict(),
  /** One answer per question of the card; `skipped: true` for every one of them is "Skip". */
  "jagentchill.chat.question.answer": z.object({
    questionId: z.string().uuid(),
    answers: z.array(z.object({ id: z.string().min(1).max(64), value: z.string().max(2000).optional(), values: z.array(z.string().max(2000)).max(6).optional(), text: z.string().max(2000).optional(), skipped: z.boolean().optional() }).strict()).min(1).max(4),
  }).strict(),
  "jagentchill.editor.frame.result": z.object({ requestId: z.string().uuid(), frames: z.array(frame.extend({ index: z.number().int().min(0).max(11) }).strict()).max(4), failed: z.array(z.number().int().min(0).max(11)).max(12), /** Assets of these frames that are not on the device: drawn as the preview's placeholder tile. */ missingAssetIds: z.array(z.string().min(1).max(64)).max(100).optional(), /** Why frames are in `failed`: "timeout", or what the device's engine reported. */ reason: z.string().max(300).optional() }).strict(),
} as const;
export const TOOL_EVENTS = [
  "jagentchill.proposal.updated", "jagentchill.tool.notice", "jagentchill.editor.focus", "jagentchill.editor.frame.request",
  // `permission_requested` / `permission_resolved` and `question_requested` / `question_resolved` of the session stream.
  "jagentchill.chat.permission.requested", "jagentchill.chat.permission.resolved", "jagentchill.chat.question.requested", "jagentchill.chat.question.resolved",
] as const;

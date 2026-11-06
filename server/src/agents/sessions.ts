import { randomUUID } from "node:crypto";
import { appendFileSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createSessionIndex, searchIndex, type HistoryPage } from "./session-index.ts";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  PRODUCT_MODES, QUEUE_MODES, RUNTIME_LIMITS, RUNTIME_METHOD_SCOPES, UNATTENDED_MODE_ID, modelRefSchema, sessionControlSetParams, sessionKeyParams,
  sessionQueueResolveParams, sessionRuntimeSwitchParams, sessionUnattendedSetParams, ROLE_SCOPES, type ModelRef, type Notice, type ProductMode, type QueueMode, type Role,
  type Scope, type SessionSelection,
} from "@jagentchill/protocol";
import type { Connection, RpcMethod } from "../channel/ws-channel.ts";
import type { DeviceRegistry } from "../devices/registry.ts";
import { ProtocolError } from "../errors.ts";
import type { OrcService } from "../orc/service.ts";
import { normalizeEngineError } from "../runtimes/engine-errors.ts";
import type { RuntimeService } from "../runtimes/service.ts";
import { audit } from "../store/database.ts";
import { buildHandover, type HistoryMessage } from "./handover.ts";
import { applicationRoots, commandOfRequest, grantOf, isCutInput, isRiskyCommand, isShellRequest, touchesApplication, type ApprovalGrant } from "./approval-rules.ts";
import { nativeMode } from "../runtimes/registry.ts";
import type { RuntimeAttachment, RuntimeClient, RuntimeEvent, RuntimeOpenOptions, RuntimePersistence, RuntimeSession } from "./runtime/types.ts";
import type { TranscriptMessage, TranscriptPart, TranscriptStore } from "./transcript.ts";
import { LOCAL_IMAGE_FEATURE, stripInjectedUserText } from "@jagentchill/protocol";
import { guessIntent, type PictureIntent } from "../local-models/intent.ts";
import { deniedToolNames, type ToolSurface } from "../tools/surfaces.ts";

export type SessionRecord = {
  sessionKey: string;
  ownerDeviceId: string;
  ownerState: "active" | "orphaned";
  agentId: string;
  access: "host" | "private";
  projectId?: string;
  /** The script the session was started from in the script studio. */
  scriptId?: string;
  toolSurface?: ToolSurface;
  origin: "device" | "automation" | "workflow" | "agent";
  title?: string;
  titleSource?: "auto" | "user";
  /** The model the session runs on: runtime, provider and model. */
  ref?: ModelRef;
  modeId: string;
  /** A mode chosen during a running turn on a runtime that cannot change it live; applied before the next turn. */
  pendingModeId?: string;
  thinkingOptionId: string | null;
  featureValues: Record<string, string | boolean | null>;
  unattended: boolean;
  parentSessionKey?: string;
  pinned: boolean;
  archived: boolean;
  created_ms: number;
};

type Row = {
  session_key: string; owner_device_id: string; owner_state: string; access: string;
  project_id: string | null; script_id?: string | null; tool_surface?: string | null; origin: string; title: string | null; created_ms: number;
  gateway_key: string | null; runtime_handle?: string | null; agent_id: string; runtime_id: string | null; provider_id: string | null; model_id: string | null; mode_id: string;
  pending_mode_id: string | null; thinking: string | null; features: string; unattended: number; title_source: string | null; parent_session_key: string | null;
  pinned: number; archived: number;
};
/** The application's own folders, worked out once (`applicationRoots`). */
const APPLICATION_ROOTS = applicationRoots();
const cleanAutoTitle = (title: string): string => stripInjectedUserText(title).replace(/\s+/g, " ").trim().slice(0, 60);
function commandSource(value: unknown): string {
  if (value === "skill") return "skill";
  if (value === "project" || value === "personal" || value === "claude-code" || value === "codex" || value === "builtin" || value === "claude-personal" || value === "claude-project" || value === "codex-prompt" || value === "codex-personal") return value;
  return "builtin";
}
type LocalSlashCommand = { name: string; description: string; source: string; template: string; argsHint?: string; acceptsArgs: boolean };
type HostCommandReply = { title: string; rows: Array<{ label: string; value: string }>; jobId?: string };
function markdownField(frontmatter: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:\\s*(.*)$`, "mi").exec(frontmatter);
  const value = match?.[1]?.trim();
  if (!value) return undefined;
  return value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_all, doubleQuoted: string, singleQuoted: string) => doubleQuoted ?? singleQuoted);
}
function readPromptMarkdown(file: string): { name?: string; description: string; argsHint?: string; template: string } | undefined {
  try {
    if (!lstatSync(file).isFile()) return undefined;
    const raw = readFileSync(file, "utf8").slice(0, 128_000);
    const front = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(raw);
    const metadata = front?.[1] ?? "";
    const template = front ? raw.slice(front[0].length).trim() : raw.trim();
    if (!template) return undefined;
    const name = markdownField(metadata, "name");
    const description = markdownField(metadata, "description") ?? template.split(/\r?\n/).find((line) => line.trim())?.slice(0, 180) ?? "";
    const argsHint = markdownField(metadata, "argument-hint") ?? markdownField(metadata, "argument_hint");
    return { ...(name ? { name } : {}), description, ...(argsHint ? { argsHint } : {}), template };
  } catch { return undefined; }
}
function markdownFiles(directory: string, max = 80, recursive = true): string[] {
  const found: string[] = [];
  const visit = (at: string, depth: number) => {
    if (depth > 5 || found.length >= max) return;
    let entries;
    try { entries = readdirSync(at, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (found.length >= max) break;
      const file = join(at, entry.name);
      if (recursive && entry.isDirectory()) visit(file, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) found.push(file);
    }
  };
  visit(directory, 0);
  return found;
}
function skillManifestFiles(directory: string, max = 80): string[] {
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return []; }
  return entries.filter((entry) => entry.isDirectory()).slice(0, max).flatMap((entry) => {
    const file = join(directory, entry.name, "SKILL.md");
    try { return lstatSync(file).isFile() ? [file] : []; } catch { return []; }
  });
}
function localSlashCommands(runtimeId: string, home: string, project?: string): LocalSlashCommand[] {
  const roots: Array<{ directory: string; source: string; kind: "command" | "skill" | "prompt" }> = [];
  if (runtimeId === "claude-code") {
    roots.push({ directory: join(home, ".claude", "commands"), source: "claude-personal", kind: "command" });
    if (project) roots.push({ directory: join(project, ".claude", "commands"), source: "claude-project", kind: "command" });
    roots.push({ directory: join(home, ".claude", "skills"), source: "skill", kind: "skill" });
    if (project) roots.push({ directory: join(project, ".claude", "skills"), source: "skill", kind: "skill" });
  } else if (runtimeId === "codex") {
    roots.push({ directory: join(home, ".codex", "prompts"), source: "codex-prompt", kind: "prompt" });
    roots.push({ directory: join(home, ".agents", "skills"), source: "skill", kind: "skill" });
    roots.push({ directory: join(home, ".codex", "skills"), source: "skill", kind: "skill" });
    if (project) {
      roots.push({ directory: join(project, ".agents", "skills"), source: "skill", kind: "skill" });
      roots.push({ directory: join(project, ".codex", "skills"), source: "skill", kind: "skill" });
    }
  }
  const found: LocalSlashCommand[] = [];
  for (const root of roots) for (const file of root.kind === "skill" ? skillManifestFiles(root.directory, 80 - found.length) : markdownFiles(root.directory, 80 - found.length, root.kind !== "prompt")) {
    const parsed = readPromptMarkdown(file);
    if (!parsed) continue;
    const name = root.kind === "skill" ? parsed.name ?? file.split(/[\\/]/).at(-2) ?? "" : file.split(/[\\/]/).at(-1)?.replace(/\.md$/i, "") ?? "";
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) continue;
    if (found.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) continue;
    found.push({ name, description: parsed.description, source: root.source, template: parsed.template, ...(parsed.argsHint ? { argsHint: parsed.argsHint } : {}), acceptsArgs: root.kind === "skill" || root.kind === "prompt" || /\$(?:ARGUMENTS\b|[1-9](?![0-9])|[A-Z][A-Z0-9_]*)/.test(parsed.template) });
  }
  return found;
}
function commandArguments(value: string): string[] {
  const unquote = (part: string) => part.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_all, doubleQuoted: string, singleQuoted: string) => (doubleQuoted ?? singleQuoted).replace(/\\([\\"'])/g, "$1"));
  return value.match(/(?:[A-Z][A-Z0-9_]*=(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s]+)|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s]+)/g)?.map((part) => {
    const named = /^([A-Z][A-Z0-9_]*)=([\s\S]*)$/.exec(part);
    return named ? `${named[1]}=${unquote(named[2]!)}` : unquote(part);
  }) ?? [];
}
function expandLocalCommand(command: LocalSlashCommand, args: string[]): string {
  const all = args.join(" ");
  const named = new Map(args.flatMap((argument) => {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/s.exec(argument);
    return match ? [[match[1]!, match[2]!] as const] : [];
  }));
  const positional = args.filter((argument) => !/^[A-Z][A-Z0-9_]*=/s.test(argument));
  const hasPlaceholder = /\$(?:ARGUMENTS\b|[1-9](?![0-9])|[A-Z][A-Z0-9_]*)/.test(command.template.replace(/\$\$/g, ""));
  const expanded = command.template.replace(/\$\$|\$([A-Z][A-Z0-9_]*|[1-9](?![0-9]))/g, (match, placeholder: string | undefined) => {
    if (match === "$$") return "\u0000";
    if (placeholder === "ARGUMENTS") return all;
    if (/^[1-9]$/.test(placeholder ?? "")) return positional[Number(placeholder) - 1] ?? "";
    return named.get(placeholder!) ?? "";
  }).replace(/\u0000/g, "$");
  if (!hasPlaceholder && all) return `${expanded}\n\nArguments: ${all}`;
  return expanded;
}
const toRecord = (row: Row): SessionRecord => ({
  sessionKey: row.session_key, ownerDeviceId: row.owner_device_id, ownerState: row.owner_state as SessionRecord["ownerState"], agentId: row.agent_id,
  access: row.access as SessionRecord["access"],
  ...(row.project_id ? { projectId: row.project_id } : {}), ...(row.script_id ? { scriptId: row.script_id } : {}),
  ...(row.tool_surface ? { toolSurface: row.tool_surface as ToolSurface } : {}),
  origin: row.origin as SessionRecord["origin"], ...(row.title ? { title: row.title_source === "auto" ? cleanAutoTitle(row.title) : row.title } : {}), ...(row.title_source ? { titleSource: row.title_source as "auto" | "user" } : {}),
  ...(row.runtime_id && row.provider_id && row.model_id ? { ref: { runtimeId: row.runtime_id, providerId: row.provider_id, modelId: row.model_id } } : {}),
  modeId: row.mode_id, ...(row.pending_mode_id ? { pendingModeId: row.pending_mode_id } : {}), thinkingOptionId: row.thinking,
  featureValues: JSON.parse(row.features) as SessionRecord["featureValues"], unattended: row.unattended === 1,
  ...(row.parent_session_key ? { parentSessionKey: row.parent_session_key } : {}), created_ms: row.created_ms,
  pinned: row.pinned === 1, archived: row.archived === 1,
});

const sessionKey = z.string().min(1).max(200);
const createParams = z.object({
  agentId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).default("main"),
  /** The model to run on. Without it the ORC route of `role` decides. */
  ref: modelRefSchema.optional(),
  role: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/).default("director"),
  modeId: z.enum(PRODUCT_MODES).optional(),
  thinkingOptionId: z.string().min(1).max(24).optional(),
  title: z.string().trim().min(1).max(120).optional(),
  projectId: z.string().min(1).max(64).optional(),
  scriptId: z.string().min(1).max(64).optional(),
  /** Product surface used to narrow the MCP tools the session's agent is offered. */
  toolSurface: z.enum(["editor", "team", "film", "workflow", "workflow-run", "general"]).optional(),
  /** The server marks sessions created for a workflow run so they remain unattended and attributable to that run. */
  origin: z.enum(["device", "automation", "workflow", "agent"]).optional(),
  /** An admin's explicit acknowledgement that the runtime runs with its own permissions on the host. */
  confirmFullAccess: z.boolean().optional(),
  /** The composer's "make pictures on this computer" switch was on: the session takes it before its first message. */
  pictures: z.boolean().optional(),
}).strict().refine((params) => !params.origin || params.origin === "device" || params.toolSurface === "workflow-run", "Only a workflow-run session may have a non-device origin.");
const keyParams = z.object({ sessionKey }).strict();
const commandInventoryParams = z.object({
  sessionKey: sessionKey.optional(),
  agentId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/).default("main"),
  ref: modelRefSchema.optional(),
  projectId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i).optional(),
}).strict().refine((value) => !!value.sessionKey || !!value.ref, "A session or model is required.");
const sendParams = z.object({
  sessionKey,
  message: z.string().min(1).max(200_000),
  /** The person's unannotated text, supplied internally by the attachment relay for automatic titles. */
  titleText: z.string().max(200_000).optional(),
  queueMode: z.enum(QUEUE_MODES).optional(),
  expectedRunId: z.string().min(1).max(120).optional(),
  /** Pictures the model is shown with the message (base64), passed to the runtime with the turn. */
  attachments: z.array(z.object({ type: z.literal("image"), mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]), fileName: z.string().min(1).max(120), content: z.string().min(1).max(2_000_000) }).strict()).min(1).max(4).optional(),
}).strict();
/** `maxChars`: the most characters of one text the transcript returns. Display cuts at 8 000; a caller that reads an answer as DATA (a workflow step, a film plan) asks for the whole text. */
const historyParams = z.object({ sessionKey, limit: z.number().int().min(1).max(500).default(100), maxChars: z.number().int().min(1000).max(500_000).optional(), /** A page further back: how many of the newest messages to skip (the `nextOffset` of the page before). */ offset: z.number().int().min(0).max(10_000_000).optional() }).strict();
// `allow-session`: this request and every later one its grant covers (`approval-rules.ts`) in this session, until the session ends or the server restarts.
const approvalParams = z.object({ approvalId: z.string().min(1).max(200), decision: z.enum(["allow-once", "allow-session", "deny"]) }).strict();
const accessParams = z.object({ sessionKey, access: z.enum(["host", "private"]) }).strict();
const updateParams = z.union([
  z.object({ sessionKey, title: z.string().trim().min(1).max(120) }).strict(),
  // The project a session works on: one at a time, or none.
  z.object({ sessionKey, patch: z.object({ projectId: z.string().min(1).max(64).nullable() }).strict() }).strict(),
]);
const listParams = z.object({ projectId: z.string().min(1).max(64).optional(), includeWorkflowRuns: z.boolean().default(false) }).strict();
const organizeParams = z.object({ sessionKey, pinned: z.boolean().optional(), archived: z.boolean().optional() }).strict().refine((value) => value.pinned !== undefined || value.archived !== undefined);
const forkParams = z.object({ sessionKey, boundary: z.object({ messageId: z.string().min(1).max(200) }).strict().optional() }).strict();
const rewindParams = z.object({ sessionKey, messageId: z.string().min(1).max(200), scope: z.array(z.enum(["conversation", "files", "project"])).min(1).max(3) }).strict();

const stepsParams = z.object({ sessionKey, limit: z.number().int().min(0).max(500).default(200), /** Steps before this position (a page further back); absent: the newest. */ before: z.number().int().min(0).optional() }).strict();
const searchParams = z.object({ sessionKey, query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(100).default(50) }).strict();
function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    // A selection that names a model without its runtime and provider is refused with the fields it lacks.
    const missing = parsed.error.issues.filter((issue) => issue.path[0] === "ref" && issue.code === "invalid_type").map((issue) => String(issue.path[1]));
    throw new ProtocolError("INVALID_PARAMS", missing.length ? `A model is named by runtimeId, providerId and modelId; missing: ${missing.join(", ")}.` : "The parameters do not match the expected shape.", {
      details: { path: parsed.error.issues[0]?.path.join(".") ?? "", ...(missing.length ? { missing } : {}) },
    });
  }
  return parsed.data;
}

export type PendingApproval = {
  approvalId: string;
  kind: "exec" | "plugin";
  sessionKey: string;
  title: string;
  detail: string;
  toolName?: string;
  /** The directory a command would run in, when the runtime names it. */
  cwd?: string;
  /** What "Always allow in this session" would cover; absent when the request cannot be granted for the session. */
  grant?: { scope: ApprovalGrant["scope"]; subject: string };
  requested_ms: number;
};

export type AgentRelayDeps = {
  db: DatabaseSync;
  devices: DeviceRegistry;
  now: () => number;
  /** The server's transcript of every session. */
  transcript: TranscriptStore;
  /** The client of a runtime (`agents/runtime/launcher.ts`); undefined when the runtime cannot be started on this host. */
  client: (runtimeId: string) => RuntimeClient | undefined;
  /** The address of the agent-tool endpoint for one session (the session is named in the URL) and its bearer. */
  mcp?: (sessionKey: string) => { url: string; token: string } | undefined;
  /** The folder an agent works in: its project's workspace, else a folder of its own. */
  workdir: (session: SessionRecord) => string;
  /** The environment a runtime's CLI is started with (the host's, without the server's secrets). */
  runtimeEnv?: (runtimeId: string) => Record<string, string> | undefined;
  /**
   * When the runtime runs on a stored key or an endpoint: the whole environment its CLI is started in and the
   * per-session configuration it takes (`providers/runtime-access.ts`); undefined on the CLI's own account, which gets
   * no key at all. Throws when the runtime is set to a key or endpoint that cannot be used now.
   */
  runtimeAccess?: (runtimeId: string, modelId: string | undefined) => { env: Record<string, string>; config?: Record<string, unknown>; signature: string } | undefined;
  /** Text every runtime adds to its own instructions: how the server's tools are used. */
  instructions?: string;
  /** Targeted delivery to connections that hold `scope` and pass `filter`. */
  broadcast: (scope: Scope, event: string, stream: string, payload: unknown, filter: (connection: Connection) => boolean) => void;
  runtimes: RuntimeService;
  orc: OrcService;
  /** Whether a device has a live connection: an approval is asked only when a device that may answer it is there. */
  isOnline?: (deviceId: string) => boolean;
  /** A turn failed on the runtime's own sign-in. */
  onAuthFailure?: (runtimeId: string) => void;
  redact: (text: string) => string;
  /** Whether a skill of that name is attached to the session; a runtime's request to load exactly that skill is then allowed. */
  skillAttached?: (sessionKey: string, skillName: string) => boolean;
  /** The skills attached to a session, with the file of each: the runtime is told where to read them. */
  skillFiles?: (sessionKey: string) => Array<{ name: string; file: string }>;
  /** The isolated host workspace for a project; only command/skill markdown metadata is read from it. */
  projectWorkspace?: (projectId: string) => string;
  /** Refuses the turn before anything is sent, e.g. when a spending limit of the session is reached. */
  beforeTurn?: (sessionKey: string) => void;
  /** The session a person's message in `sessionKey` is delivered to instead: the agent a conversation hand-off gave the lead of the conversation (`multi-agent-orchestration`). */
  answeringSession?: (sessionKey: string) => string | undefined;
  /** A plain chat message sent while a question card is open answers that card and starts the next turn. */
  answerPendingQuestion?: (sessionKey: string, text: string) => boolean;
  /** `/image <description>`: the person's own words go straight to the picture model on this computer, no agent rewrites them. */
  directImage?: (sessionKey: string, prompt: string, options?: { change?: boolean; quiet?: boolean }) => Promise<HostCommandReply>;
  /** What a message asks for while the session's pictures switch is on (read on this computer by a language model). */
  pictureIntent?: (sessionKey: string, message: string) => Promise<PictureIntent>;
  /** Whether the session already has a picture made on this computer (a later "sexier" changes that one). */
  hasLocalPicture?: (sessionKey: string) => boolean;
  /** The person pressed Stop: what else the session started (generations) is stopped as well. */
  onStopped?: (sessionKey: string) => void;
  /** A turn was accepted by the runtime: the run and the device that sent it. */
  onTurnStarted?: (sessionKey: string, runId: string, deviceId: string) => void;
  /** A turn ended, whatever its outcome (the agent tools submit what the turn staged). */
  onTurnEnded?: (sessionKey: string, state: "final" | "error" | "aborted") => void;
  /** Every event of a turn, as the runtime reported it (usage and the context meter follow them). */
  onRuntimeEvent?: (sessionKey: string, runId: string, event: RuntimeEvent) => void;
  /** Refuses a change of the session's project (a proposal awaits a decision). */
  beforeProjectChange?: (sessionKey: string) => void;
  /** The session is gone: what other services keep for it goes too. */
  onSessionDeleted?: (sessionKey: string) => void;
  /** A session was forked: the fork holds the conversation of its source (as a summary) — and so whatever marks that content carries. */
  onSessionForked?: (sourceKey: string, forkKey: string) => void;
  /**
   * What the agent must know about the session before it reads the person's message: the project the session is bound
   * to and what the editor shows right now. It is written anew for every turn and leads the message the runtime gets.
   */
  turnContext?: (session: SessionRecord) => string | undefined;
  /** A runtime's own "ask the user" tool raised a question; false when nobody can be shown it. */
  onRuntimeQuestion?: (session: SessionRecord, question: RuntimeQuestion) => boolean;
  /** A question closed by itself (the turn ended). */
  onRuntimeQuestionClosed?: (questionId: string) => void;
  /** Product-owned status facts and compaction action; never send their output through the runtime transcript. */
  contextState?: (sessionKey: string) => { context?: { usedTokens: number; maxTokens?: number; pct?: number }; limits: { session?: { usedTokens: number; limitTokens: number }; day?: { usedTokens: number; limitTokens: number } }; compactions: unknown[] } | undefined;
  /** The provider's token-free plan summary used by the context meter, when it is already available. */
  planState?: (runtimeId: string, providerId: string) => Promise<{ status: string; planLabel?: string; windows: Array<{ label: string; usedPct?: number; resetsAt_ms?: number }> } | undefined>;
  compactSession?: (sessionKey: string, connection: Connection) => Promise<{ compacted: boolean }>;
};

/** A question a runtime's own "ask the user" tool raised (Claude Code's `AskUserQuestion`, Codex's user input). */
export type RuntimeQuestion = {
  id: string; sessionKey?: string; expiresAtMs?: number;
  questions: Array<{ questionId: string; header?: string; question: string; options?: Array<{ label: string; description?: string }>; multiSelect?: boolean; isOther?: boolean }>;
};

/** How long a turn may show no sign of life before the person is told and offered a way on. */
export const TURN_QUIET_MS = 60_000;
/** How long Stop waits for the runtime to confirm before the turn is ended by the server. */
const STOP_WAIT_MS = 5000;
const CONTEXT_OPEN = "[JAgentChill editor context — written by the editor, not by the user]";
const CONTEXT_CLOSE = "[End of editor context. The user's message follows.]";
/** Puts the editor's context in front of a message; `stripTurnContext` takes it off again for display. */
export const withTurnContext = (context: string | undefined, message: string): string => (context ? `${CONTEXT_OPEN}\n${context}\n${CONTEXT_CLOSE}\n\n${message}` : message);
export function stripTurnContext(text: string): string {
  return stripInjectedUserText(text);
}
/** A transcript message as devices see it: the editor context the server put in front of the person's words is not theirs. */
function forDisplay<T>(message: T): T {
  const entry = message as { role?: unknown; content?: unknown; text?: unknown } | null;
  if (!entry || typeof entry !== "object" || entry.role !== "user") return message;
  const cleanText = (text: string) => {
    const attachmentMarker = /\[\[jc-attachments:[0-9a-f-]{36}\]\]/.exec(text)?.[0];
    const cleaned = stripTurnContext(text);
    return attachmentMarker ? `${cleaned}\n${attachmentMarker}` : cleaned;
  };
  if (typeof entry.content === "string") return { ...entry, content: cleanText(entry.content) } as T;
  if (Array.isArray(entry.content)) return { ...entry, content: entry.content.map((part: { type?: unknown; text?: unknown }) => (typeof part?.text === "string" ? { ...part, text: cleanText(part.text) } : part)) } as T;
  return typeof entry.text === "string" ? { ...entry, text: cleanText(entry.text) } as T : message;
}

const text = (value: unknown): string => (typeof value === "string" ? value : value === undefined || value === null ? "" : JSON.stringify(value));
/** What a tool returned, as text: MCP content parts are joined, anything else is written as JSON. */
function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return output.map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : part && typeof part === "object" && (part as { content?: { text?: unknown } }).content && typeof (part as { content: { text?: unknown } }).content.text === "string" ? (part as { content: { text: string } }).content.text : text(part))).join("\n");
  return text(output);
}
/** A server tool, however a runtime joins the MCP server's name and the tool's (`mcp__jagentchill__jc_x`, `jagentchill.jc_x`). */
export function productToolName(name: string): string | undefined {
  return /(?:^|__|[./:])jagentchill(?:__|[_./:])(jc_[a-z0-9_]+)$/.exec(name)?.[1] ?? (/^jc_[a-z0-9_]+$/.test(name) ? name : undefined);
}

/** A permission request of any runtime, in the terms of the approval rules. */
type PermissionView = { kind: "exec" | "plugin"; toolName: string; command?: string; description?: string; detail?: string; cwd: string; title: string; input?: unknown; question?: RuntimeQuestion["questions"] };
function viewPermission(event: Extract<RuntimeEvent, { type: "permission_requested" }>, cwd: string): PermissionView {
  const detail = (event.detail ?? {}) as Record<string, any>;
  const joined = (command: unknown) => (Array.isArray(command) ? command.map(String).join(" ") : typeof command === "string" ? command : undefined);
  // Claude Code: the tool and its input.
  if (typeof detail.name === "string" && "input" in detail) {
    const input = (detail.input ?? {}) as Record<string, any>;
    if (detail.name === "AskUserQuestion" && Array.isArray(input.questions)) {
      return { kind: "plugin", toolName: detail.name, cwd, title: "Question", input, question: input.questions.map((entry: any, index: number) => ({ questionId: String(index), ...(typeof entry?.header === "string" ? { header: entry.header } : {}), question: String(entry?.question ?? ""), ...(Array.isArray(entry?.options) ? { options: entry.options.map((option: any) => ({ label: String(option?.label ?? option), ...(typeof option?.description === "string" ? { description: option.description } : {}) })) } : {}), ...(entry?.multiSelect ? { multiSelect: true } : {}) })) };
    }
    const shell = /^bash$/i.test(detail.name);
    return { kind: shell ? "exec" : "plugin", toolName: detail.name, ...(shell ? { command: joined(input.command) } : {}), description: JSON.stringify(input), cwd: typeof input.cwd === "string" ? input.cwd : cwd, title: typeof input.description === "string" ? input.description : detail.name, input };
  }
  // Codex: a command, a file change, or questions for the person.
  if (/requestUserInput/i.test(event.kind) && Array.isArray(detail.questions)) {
    return { kind: "plugin", toolName: "request_user_input", cwd, title: "Question", question: detail.questions.map((entry: any, index: number) => ({ questionId: String(entry?.id ?? index), ...(typeof entry?.header === "string" ? { header: entry.header } : {}), question: String(entry?.question ?? ""), ...(Array.isArray(entry?.options) ? { options: entry.options.map((option: any) => ({ label: String(option?.label ?? option), ...(typeof option?.description === "string" ? { description: option.description } : {}) })) } : {}), ...(entry?.isOther ? { isOther: true } : {}) })) };
  }
  // Codex asking before it calls a tool of an MCP server: the server and the tool name it.
  if (/mcp/i.test(event.kind) && (typeof detail.tool === "string" || typeof detail.toolName === "string")) {
    const tool = String(detail.tool ?? detail.toolName), server = typeof detail.server === "string" ? detail.server : typeof detail.serverName === "string" ? detail.serverName : "";
    return { kind: "plugin", toolName: server ? `${server}__${tool}` : tool, description: JSON.stringify(detail.arguments ?? detail.input ?? {}), cwd, title: tool };
  }
  if (/commandExecution|execCommand/i.test(event.kind)) return { kind: "exec", toolName: "shell", command: joined(detail.command), cwd: typeof detail.cwd === "string" ? detail.cwd : cwd, title: typeof detail.reason === "string" ? detail.reason : "Run a command" };
  if (/fileChange|applyPatch/i.test(event.kind)) return { kind: "plugin", toolName: "apply_patch", detail: JSON.stringify(detail.changes ?? detail.fileChanges ?? detail), cwd: typeof detail.grantRoot === "string" ? detail.grantRoot : cwd, title: typeof detail.reason === "string" ? detail.reason : "Change files" };
  // ACP: a tool call with its kind and raw input.
  const call = (detail.toolCall ?? {}) as Record<string, any>, raw = (call.rawInput ?? {}) as Record<string, any>;
  const shell = call.kind === "execute" || typeof raw.command === "string" || Array.isArray(raw.command);
  return { kind: shell ? "exec" : "plugin", toolName: shell ? "shell" : String(call.title ?? call.kind ?? "tool"), ...(shell ? { command: joined(raw.command) } : {}), description: JSON.stringify(raw), cwd: typeof raw.cwd === "string" ? raw.cwd : cwd, title: String(call.title ?? "Tool call"), input: raw };
}

type ActiveRun = {
  /** A tool call ended the text so far: the next text starts a new paragraph. */
  afterTool?: boolean;
  runId: string; handoverId?: number;
  /** Stopped by the host or a person; the runtime has not reported the end yet. */
  stopped?: boolean;
  /** When the runtime last reported anything of this turn. */
  seen_ms: number; quietTold?: boolean;
  /** The answer so far: text and thinking not yet written to the transcript, the parts of the open assistant message. */
  parts: TranscriptPart[]; text: string; thinking: string; usage?: Extract<RuntimeEvent, { type: "usage" }>; model?: string;
  /** Tool calls already written, so a finished call without a reported start still gets one. */
  calls: Set<string>;
};
type Live = { session: RuntimeSession; runtimeId: string; signature: string; off: () => void; dead?: boolean };
/** A message held while a turn runs, sent when it ends. */
/** The language a person wrote in, for a reply the agent writes without seeing their words. */
const languageOf = (text: string) => (/[\u3040-\u30ff\u4e00-\u9fff]/.test(text) ? "Japanese" : /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(text) ? "Vietnamese" : "the language the user writes in");
type Queued = {
  message: string; attachments?: RuntimeAttachment[]; deviceId: string; idempotencyKey: string; hostNote?: boolean; userText?: string; handoverId?: number;
  /** A command of the runtime (`/review`, `/compact`): sent as written, with no skill note or summary in front. */
  command?: boolean;
  /** Run by the host itself (`/compact`): not a message of the conversation. */
  hidden?: boolean;
};

/**
 * Relays agent session traffic between devices and the runtimes the server drives. Devices never reach a runtime: every
 * call is checked against the caller's current role, the session's ownership record and the runtime policy here; every
 * event of a runtime is checked against the read rule before a device sees it, and every permission a runtime asks for
 * is decided by the approval rules or put to a person.
 */
export function createAgentRelay(deps: AgentRelayDeps) {
  const { db, runtimes, transcript } = deps;
  const subscribers = new Map<string, Set<Connection>>();
  /** Approval requests the runtimes raised for sessions the server owns, by approval id. */
  const approvals = new Map<string, PendingApproval & { live: Live }>();
  const activeRuns = new Map<string, ActiveRun>();
  const sessionWatchers = new Set<Connection>();
  /** Questions of a runtime waiting for a person, by question id: the session and how the answer goes back. */
  const runtimeQuestions = new Map<string, { sessionKey: string; live: Live; permissionId: string; input?: unknown; questions: RuntimeQuestion["questions"]; codex: boolean }>();
  /** Native tools a person allowed "for this session", by session. Kept in memory: a restart asks again. */
  const sessionGrants = new Map<string, Set<string>>();
  /** The open runtime session behind each product session. */
  const live = new Map<string, Live>();
  /** Opening a runtime session takes a moment: one opening per session at a time. */
  const opening = new Map<string, Promise<Live>>();
  /** Who waits for the end of a turn (a compaction run by the host), by run id. */
  const turnWaiters = new Map<string, (state: "final" | "error" | "aborted") => void>();
  /** Messages held while a turn runs. */
  const queued = new Map<string, Queued[]>();
  /** Sessions whose next turn starts a fresh runtime session and so carries the conversation so far. */
  const carryOver = new Set<string>();
  // Which messages of a transcript the HOST wrote (the editor's word to the agent, `deliver(…, { hostNote: true })`): the key
  // the host sent each with. The transcript keeps that key on the message; a device is told by this record alone,
  // never by a message's text, that a message is not a person's (`markAuthor`).
  db.exec("CREATE TABLE IF NOT EXISTS host_messages (idempotency_key TEXT PRIMARY KEY, session_key TEXT NOT NULL, ts_ms INTEGER NOT NULL) STRICT");
  const isHostMessage = db.prepare("SELECT 1 FROM host_messages WHERE idempotency_key = ?");
  db.exec("CREATE TABLE IF NOT EXISTS slash_command_messages (idempotency_key TEXT PRIMARY KEY, session_key TEXT NOT NULL, invocation TEXT NOT NULL, expansion TEXT NOT NULL, ts_ms INTEGER NOT NULL) STRICT");
  const slashCommandFor = db.prepare("SELECT invocation, expansion FROM slash_command_messages WHERE idempotency_key = ?");
  // `/image`: the person's words, kept with the picture they started (shown as its progress, then the result).
  db.exec("CREATE TABLE IF NOT EXISTS picture_messages (idempotency_key TEXT PRIMARY KEY, session_key TEXT NOT NULL, job_id TEXT NOT NULL, ts_ms INTEGER NOT NULL) STRICT");
  const pictureFor = db.prepare("SELECT job_id AS jobId FROM picture_messages WHERE idempotency_key = ?");
  /** A transcript message as devices see it, with who wrote it: `jagentchill.author = "host"` only by the host's own record. */
  function markAuthor<T>(message: T): T {
    const entry = forDisplay(message) as ({ role?: unknown; idempotencyKey?: unknown; jagentchill?: unknown } & object) | null;
    if (!entry || typeof entry !== "object" || entry.role !== "user") return entry as T;
    const carried = typeof entry.idempotencyKey === "string" ? entry.idempotencyKey : "";
    const { jagentchill: _unproven, ...rest } = entry;
    const key = carried.replace(/:user$/, "");
    const host = key && isHostMessage.get(key);
    const command = key && slashCommandFor.get(key);
    const picture = key && pictureFor.get(key) as { jobId: string } | undefined;
    return (host || command || picture ? { ...rest, jagentchill: { ...(host ? { author: "host" } : {}), ...(command ? { command } : {}), ...(picture ? { picture } : {}) } } : rest) as T;
  }
  /** The rule each waiting request would store, kept on the server: a device only ever sees what it covers. */
  const pendingRules = new Map<string, string>();

  // An unattended grant does not survive a restart of the server.
  db.exec("UPDATE agent_sessions SET unattended = 0, pending_mode_id = NULL");

  const find = (key: string): SessionRecord | undefined => {
    const row = db.prepare("SELECT * FROM agent_sessions WHERE session_key = ?").get(key) as Row | undefined;
    return row && toRecord(row);
  };
  const handleOf = (key: string): RuntimePersistence | undefined => {
    const row = db.prepare("SELECT runtime_handle FROM agent_sessions WHERE session_key = ?").get(key) as { runtime_handle: string | null } | undefined;
    if (!row?.runtime_handle) return undefined;
    try { return JSON.parse(row.runtime_handle) as RuntimePersistence; } catch { return undefined; }
  };
  const saveHandle = (key: string, handle: RuntimePersistence | undefined) => db.prepare("UPDATE agent_sessions SET runtime_handle = ? WHERE session_key = ?").run(handle ? JSON.stringify(handle) : null, key);

  /** Read rule, evaluated against the caller's current device record. */
  function canRead(session: SessionRecord, deviceId: string, role: Role | undefined): boolean {
    if (!role) return false;
    if (session.ownerDeviceId === deviceId || role === "admin") return true;
    return session.access === "host";
  }

  /** A session the caller cannot read answers NOT_FOUND, so its existence is not disclosed. */
  function requireRead(key: string, connection: Connection): SessionRecord {
    const session = find(key);
    if (!session || !canRead(session, connection.deviceId, connection.role())) throw new ProtocolError("NOT_FOUND", "No such session.");
    return session;
  }

  function requireAct(key: string, connection: Connection): SessionRecord {
    const session = requireRead(key, connection);
    const role = connection.role()!;
    if (role === "viewer") throw new ProtocolError("SCOPE_DENIED", "Viewers cannot act in a session.", { details: { requiredRole: "editor" } });
    const owner = session.ownerDeviceId === connection.deviceId;
    if (!owner && role !== "admin" && session.access !== "host") {
      throw new ProtocolError("SCOPE_DENIED", "Only the owner can act in this session.", { details: { reason: "not_owner" } });
    }
    return session;
  }

  /** A runtime failure reaches the device as a product error, never as a raw error object. */
  function engineError(err: unknown): ProtocolError {
    if (err instanceof ProtocolError) return err;
    const message = err instanceof Error ? err.message : String(err);
    const mapped = normalizeEngineError(message);
    console.error(`[agent-runtime] ${deps.redact(message).slice(0, 1000)}`);
    return new ProtocolError(mapped.code, mapped.message, { httpStatus: mapped.retryable ? 503 : 502, retryable: mapped.retryable, details: { userMessageKey: mapped.userMessageKey, action: mapped.action, ...mapped.details, raw: deps.redact(message).slice(0, 2000) } });
  }

  /** Changes of session records reach the connections that asked for them and may read the session. */
  const watching = (session: SessionRecord) => (connection: Connection) => sessionWatchers.has(connection) && canRead(session, connection.deviceId, connection.role());
  // A sub-agent's session is not in anybody's session list (`session.list` leaves it out), so its changes are not announced to the lists either.
  const publish = (session: SessionRecord) => { if (session.origin !== "agent") deps.broadcast("jagentchill.projects.read", "jagentchill.session.updated", "sessions", { session }, watching(session)); };

  function setColumns(key: string, columns: Record<string, string | number | null>): SessionRecord {
    const names = Object.keys(columns);
    db.prepare(`UPDATE agent_sessions SET ${names.map((name) => `${name} = ?`).join(", ")} WHERE session_key = ?`).run(...names.map((name) => columns[name]), key);
    const session = find(key)!;
    publish(session);
    return session;
  }

  // ---- the runtime session behind a product session ----

  /** What a runtime session is opened with; a session whose selection changed is opened again before its next turn. */
  function openOptions(session: SessionRecord): { options: RuntimeOpenOptions; signature: string } {
    const runtime = runtimes.runtime(session.ref?.runtimeId ?? "");
    const mode = runtime ? nativeMode(runtime.driver, session.modeId, session.unattended) : undefined;
    const tools = runtime?.capabilities.jcTools === "none" ? undefined : deps.mcp?.(session.sessionKey);
    const cwd = deps.workdir(session);
    const access = session.ref ? deps.runtimeAccess?.(session.ref.runtimeId, session.ref.modelId) : undefined;
    const env = access?.env ?? (session.ref ? deps.runtimeEnv?.(session.ref.runtimeId) : undefined);
    const options: RuntimeOpenOptions = {
      sessionKey: session.sessionKey, cwd, ...(session.ref?.modelId ? { model: session.ref.modelId } : {}), ...(mode ? { mode } : {}),
      ...(session.thinkingOptionId ? { thinking: session.thinkingOptionId } : {}), ...(tools ? { mcpUrl: tools.url, mcpToken: tools.token } : {}),
      ...(env ? { env } : {}), ...(access?.config ? { config: access.config } : {}), ...(deps.instructions ? { instructions: deps.instructions } : {}),
    };
    // A changed key or address (its fingerprint, kept in memory only) opens the runtime session again.
    return { options, signature: JSON.stringify([session.ref?.runtimeId, session.ref?.modelId, mode, session.thinkingOptionId, cwd, !!tools, access?.signature ?? null]) };
  }

  /** The runtime session of a product session, opened (or resumed from the runtime's own record) when there is none. */
  async function ensureLive(session: SessionRecord): Promise<Live> {
    const key = session.sessionKey;
    const { options, signature } = openOptions(session);
    const current = live.get(key);
    if (current && !current.dead && current.signature === signature && current.runtimeId === session.ref?.runtimeId) return current;
    const pendingOpen = opening.get(key);
    if (pendingOpen) return pendingOpen;
    const task = (async (): Promise<Live> => {
      if (current) await dropLive(key);
      if (!session.ref) throw new ProtocolError("runtime/switch-required", "Choose a model for this session first.");
      const client = deps.client(session.ref.runtimeId);
      const label = runtimes.runtime(session.ref.runtimeId)?.label ?? session.ref.runtimeId;
      if (!client) throw new ProtocolError("runtime/not-installed", `${label} is not installed on this host.`, { details: { runtimeId: session.ref.runtimeId } });
      if (options.cwd) mkdirSync(options.cwd, { recursive: true });
      const handle = handleOf(key);
      let opened: RuntimeSession;
      if (handle && handle.runtime === client.kind) {
        try { opened = await client.resumeSession(handle, options); }
        catch (err) {
          // The runtime no longer has that conversation: a new one starts from a summary of the server's transcript.
          console.warn(`[agent-runtime] ${key}: could not resume (${deps.redact(err instanceof Error ? err.message : String(err)).slice(0, 300)}); starting anew`);
          opened = await client.createSession(options);
          carryOver.add(key);
        }
      } else {
        opened = await client.createSession(options);
        // A runtime that never had this conversation (another runtime had it, or a resume record is missing) gets a
        // summary of it — unless a hand-over is already staged for its first message (a runtime switch).
        if (transcript.total(key) > 0 && !stagedHandover(key)) carryOver.add(key);
      }
      const entry: Live = { session: opened, runtimeId: session.ref.runtimeId, signature, off: () => undefined };
      entry.off = opened.subscribe((event) => {
        try { onRuntimeEvent(key, entry, event); } catch (err) { console.error(`[relay] a runtime event could not be handled: ${err instanceof Error ? err.message : err}`); }
      });
      live.set(key, entry);
      saveHandle(key, opened.persistence());
      return entry;
    })();
    opening.set(key, task);
    try { return await task; } finally { opening.delete(key); }
  }

  /** Closes the runtime session behind a product session; its process goes with it. */
  async function dropLive(key: string): Promise<void> {
    const entry = live.get(key);
    if (!entry) return;
    live.delete(key);
    entry.dead = true;
    entry.off();
    for (const [id, approval] of approvals) if (approval.live === entry) { approvals.delete(id); pendingRules.delete(id); deps.broadcast("jagentchill.host.exec", "jagentchill.approval.resolved", "approvals", { approvalId: id, sessionKey: approval.sessionKey }, (connection) => canAnswer(approval.sessionKey, connection)); }
    for (const [id, question] of runtimeQuestions) if (question.live === entry) { runtimeQuestions.delete(id); deps.onRuntimeQuestionClosed?.(id); }
    await Promise.race([entry.session.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 3000).unref())]);
  }

  // ---- events ----

  // Diagnosis of "the answer arrives late": with JAGENTCHILL_STREAM_TRACE=<file> every event of a turn is written there
  // with the time the relay had it, as it is forwarded.
  const STREAM_TRACE = process.env.JAGENTCHILL_STREAM_TRACE;
  function traceStream(event: RuntimeEvent, chars?: number): void {
    try { appendFileSync(STREAM_TRACE!, `${JSON.stringify({ t: Date.now(), event: event.type, ...(chars !== undefined ? { chars } : {}) })}\n`); } catch { /* a trace never breaks the relay */ }
  }

  /** The assistant text of each running turn so far, by product session key. */
  const liveText = new Map<string, { runId: string; text: string; seq: number }>();

  function toSubscribers(session: SessionRecord, event: string, payload: unknown): void {
    for (const connection of subscribers.get(session.sessionKey) ?? []) {
      if (canRead(session, connection.deviceId, connection.role())) connection.send(event, `session:${session.sessionKey}`, payload);
    }
  }
  /** One chat event to the devices that follow the session; the read rule is checked on every delivery. */
  function toChat(session: SessionRecord, channel: "stream" | "activity" | "message", payload: Record<string, unknown>): void {
    const listeners = subscribers.get(session.sessionKey);
    if (!listeners?.size) return;
    const body = { ...payload, sessionKey: session.sessionKey };
    for (const connection of listeners) {
      if (!canRead(session, connection.deviceId, connection.role())) { listeners.delete(connection); continue; }
      connection.send(`jagentchill.chat.${channel}`, `session:${session.sessionKey}`, body);
    }
  }
  /** A message written to the transcript reaches the devices at once (`jagentchill.chat.message`). */
  function record(session: SessionRecord, message: Omit<TranscriptMessage, "id"> & { id?: string }): TranscriptMessage {
    const stored = transcript.append(session.sessionKey, message);
    toChat(session, "message", { message: markAuthor(stored) });
    return stored;
  }
  /** The open assistant message of a turn: the text and thinking so far become its parts. */
  function settleText(run: ActiveRun): void {
    if (run.thinking) { run.parts.push({ type: "thinking", thinking: run.thinking }); run.thinking = ""; }
    if (run.text) { run.parts.push({ type: "text", text: run.text }); run.text = ""; }
  }
  function flushAssistant(session: SessionRecord, run: ActiveRun, final: boolean): TranscriptMessage | undefined {
    settleText(run);
    if (!run.parts.length && !(final && run.usage)) return undefined;
    const usage = final && run.usage ? {
      input: run.usage.inputTokens ?? 0, output: run.usage.outputTokens ?? 0, cacheRead: run.usage.cacheReadTokens ?? 0, cacheWrite: run.usage.cacheWriteTokens ?? 0,
      totalTokens: (run.usage.inputTokens ?? 0) + (run.usage.outputTokens ?? 0) + (run.usage.cacheReadTokens ?? 0) + (run.usage.cacheWriteTokens ?? 0),
      ...(typeof run.usage.costUsd === "number" ? { cost: { total: run.usage.costUsd } } : {}), ...(run.usage.contextWindow ? { contextWindow: run.usage.contextWindow } : {}),
    } : undefined;
    const message = record(session, { role: "assistant", content: run.parts, timestamp: deps.now(), runId: run.runId, ...(usage ? { usage } : {}), ...(run.model ?? session.ref?.modelId ? { model: run.model ?? session.ref?.modelId } : {}) });
    run.parts = [];
    return message;
  }

  /** Every event a runtime reports for a session: to the transcript, to the devices, and to the approval rules. */
  function onRuntimeEvent(key: string, entry: Live, event: RuntimeEvent): void {
    if (entry.dead && event.type !== "turn_cancelled" && event.type !== "turn_failed" && event.type !== "turn_completed") return;
    const session = find(key);
    if (!session) return;
    if (event.type === "permission_requested") return onPermission(session, entry, event);
    if (event.type === "permission_resolved") return onPermissionResolved(event.id);
    if (event.type === "question_requested" || event.type === "question_resolved") return;
    let run = activeRuns.get(key);
    if (event.type === "turn_started") {
      // The run exists before the runtime starts it (`startTurn`); this names it with the runtime's own id.
      if (!run) { run = newRun(event.turnId); activeRuns.set(key, run); }
      else if (!run.runId) run.runId = event.turnId;
      toChat(session, "activity", { runId: run.runId, stream: "lifecycle", data: { phase: "start" } });
      deps.onRuntimeEvent?.(key, run.runId, event);
      return;
    }
    if (!run) return;
    Object.assign(run, { seen_ms: deps.now(), quietTold: false });
    deps.onRuntimeEvent?.(key, run.runId, event);
    switch (event.type) {
      case "assistant_text_delta": {
        if (!event.text) return;
        if (run.thinking) settleText(run);
        // Text after a tool call is a new paragraph (Codex sends its messages without a line between them; a device
        // would continue the row above the call with it).
        if (run.afterTool) {
          run.afterTool = false;
          const sofar = liveText.get(key);
          if (sofar?.runId === run.runId && sofar.text && !/\n\s*$/.test(sofar.text) && !/^\s*\n/.test(event.text)) event = { ...event, text: `\n\n${event.text}` };
        }
        run.text += event.text;
        // A device is sent increments — never the whole text again, which grows with the square of the answer — each
        // with its place in the turn (`seq`) and the length the text has after it (`length`), so a device that missed one
        // notices and reads the text so far from `jagentchill.chat.subscribe`.
        const kept = liveText.get(key);
        const before = kept?.runId === run.runId ? kept.text : "";
        const whole = before + event.text, seq = (kept?.runId === run.runId ? kept.seq : 0) + 1;
        liveText.set(key, { runId: run.runId, text: whole, seq });
        if (STREAM_TRACE) traceStream(event, whole.length);
        toChat(session, "stream", { runId: run.runId, state: "delta", seq, deltaText: event.text, length: whole.length });
        return;
      }
      case "reasoning_delta":
        if (!event.text) return;
        if (run.text) settleText(run);
        run.thinking += event.text;
        toChat(session, "activity", { runId: run.runId, stream: "thinking", data: { delta: event.text } });
        return;
      case "tool_call_started": {
        // A tool call closes the text written before it: the transcript keeps the order things happened in.
        run.afterTool = true;
        settleText(run);
        run.parts.push({ type: "toolCall", id: event.id, name: event.name, arguments: event.input });
        run.calls.add(event.id);
        flushAssistant(session, run, false);
        toChat(session, "activity", { runId: run.runId, stream: "tool", data: { toolCallId: event.id, name: event.name, phase: "start", args: event.input } });
        return;
      }
      case "tool_call_updated":
        toChat(session, "activity", { runId: run.runId, stream: "tool", data: { toolCallId: event.id, phase: "update", ...(event.input !== undefined ? { args: event.input } : {}), ...(event.output !== undefined ? { partialResult: event.output } : {}) } });
        return;
      case "tool_call_finished": {
        run.afterTool = true;
        if (!run.calls.has(event.id)) {
          run.calls.add(event.id);
          settleText(run);
          run.parts.push({ type: "toolCall", id: event.id, name: event.name, arguments: event.input });
          flushAssistant(session, run, false);
        }
        record(session, { role: "toolResult", toolCallId: event.id, toolName: event.name, content: [{ type: "text", text: outputText(event.output) }], isError: event.status === "failed", timestamp: deps.now(), runId: run.runId });
        toChat(session, "activity", { runId: run.runId, stream: "tool", data: { toolCallId: event.id, name: event.name, phase: "result", result: event.output, isError: event.status === "failed" } });
        return;
      }
      case "usage": {
        const sum = (a?: number, b?: number) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0));
        run.usage = { type: "usage", inputTokens: sum(run.usage?.inputTokens, event.inputTokens), outputTokens: sum(run.usage?.outputTokens, event.outputTokens), cacheReadTokens: sum(run.usage?.cacheReadTokens, event.cacheReadTokens), cacheWriteTokens: sum(run.usage?.cacheWriteTokens, event.cacheWriteTokens), costUsd: sum(run.usage?.costUsd, event.costUsd), contextWindow: event.contextWindow ?? run.usage?.contextWindow };
        if (event.model) run.model = event.model;
        return;
      }
      case "compaction":
        toChat(session, "activity", { runId: run.runId, stream: "compaction", data: { phase: event.phase ?? "end", ...(event.phase === "start" ? {} : { completed: true }) } });
        return;
      case "turn_completed":
      case "turn_failed":
      case "turn_cancelled": {
        if (run.runId !== event.turnId && event.turnId) return;
        const state = event.type === "turn_completed" ? "final" : run.stopped || event.type === "turn_cancelled" ? "aborted" : "error";
        const message = flushAssistant(session, run, true);
        const errorMessage = event.type === "turn_failed" ? `${event.diagnostic || event.code}` : undefined;
        if (STREAM_TRACE) traceStream(event);
        // A runtime whose turn was cut off or that failed may have lost its process: the next turn opens it again (resume).
        if (event.type !== "turn_completed") void dropLive(key);
        else saveHandle(key, entry.session.persistence());
        void finishTurn(session, run, state, message, errorMessage).catch((err) => console.error(`[relay] after-turn bookkeeping failed: ${err instanceof Error ? err.message : err}`));
        return;
      }
    }
  }
  const newRun = (runId: string): ActiveRun => ({ runId, seen_ms: deps.now(), parts: [], text: "", thinking: "", calls: new Set() });

  /** The end of a turn, however it ended: the devices are told, the bookkeeping is done, and a held message is sent. */
  async function finishTurn(session: SessionRecord, run: ActiveRun, state: "final" | "error" | "aborted", message: TranscriptMessage | undefined, errorMessage: string | undefined): Promise<void> {
    if (activeRuns.get(session.sessionKey) !== run) return;
    activeRuns.delete(session.sessionKey);
    liveText.delete(session.sessionKey);
    turnWaiters.get(run.runId)?.(state);
    turnWaiters.delete(run.runId);
    // Questions of the runtime that are still open close with the turn.
    for (const [id, question] of runtimeQuestions) if (question.sessionKey === session.sessionKey) { runtimeQuestions.delete(id); deps.onRuntimeQuestionClosed?.(id); }
    toChat(session, "stream", { runId: run.runId, state, ...(message ? { message: { role: "assistant", content: message.content } } : {}), ...(errorMessage ? { errorMessage: deps.redact(errorMessage).slice(0, 2000) } : {}) });
    await onTurnEnded(session, state, run, errorMessage);
  }

  async function onTurnEnded(session: SessionRecord, state: "final" | "error" | "aborted", run: ActiveRun | undefined, errorMessage: string | undefined): Promise<void> {
    const runId = run?.runId;
    deps.broadcast(
      "jagentchill.projects.read", "jagentchill.chat.turn.ended", `session:${session.sessionKey}`,
      { sessionKey: session.sessionKey, state, ...(runId ? { runId } : {}) },
      (connection) => canRead(session, connection.deviceId, connection.role()),
    );
    try { deps.onTurnEnded?.(session.sessionKey, state); } catch (err) { console.error(`[relay] turn-end hook failed: ${err instanceof Error ? err.message : err}`); }
    // The hand-over counts as delivered only when the turn that carried it was answered; otherwise it is sent again.
    if (state === "final" && run?.handoverId !== undefined) {
      db.prepare("UPDATE runtime_handover SET status = 'delivered', delivered_ms = ? WHERE id = ? AND status = 'staged'").run(deps.now(), run.handoverId);
    }
    if (state === "error") {
      const error = normalizeEngineError(errorMessage ?? "");
      const raw = deps.redact(errorMessage ?? "").slice(0, 2000);
      const id = runId ? `e-${runId}` : `e-${randomUUID()}`;
      const inserted = db.prepare(`INSERT OR IGNORE INTO session_engine_errors (id, session_key, run_id, code, message, message_key, action, retryable, raw, ts_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, session.sessionKey, runId ?? null, error.code, error.message, error.userMessageKey, error.action, error.retryable ? 1 : 0, raw, deps.now());
      if (inserted.changes > 0) {
        toSubscribers(session, "jagentchill.chat.error", { sessionKey: session.sessionKey, id, ...(runId ? { runId } : {}), error: { code: error.code, message: error.message, retryable: error.retryable, details: { userMessageKey: error.userMessageKey, action: error.action, ...error.details, raw } } });
        if ((error.code === "runtime/signed-out" || error.code === "runtime/auth-failed") && session.ref) {
          deps.onAuthFailure?.(session.ref.runtimeId);
          void runtimes.reprobe(session.ref.runtimeId);
        }
      }
    }
    if (state === "final" && run) recordUsage(session, run);
    // A mode chosen during the turn is applied now, before the next one starts.
    let current = find(session.sessionKey);
    if (current?.pendingModeId && !activeRuns.has(session.sessionKey)) current = applyMode(current, current.pendingModeId);
    // A message held for the end of this turn starts the next one.
    const next = queued.get(session.sessionKey)?.shift();
    if (!queued.get(session.sessionKey)?.length) queued.delete(session.sessionKey);
    if (next && current && !activeRuns.has(session.sessionKey)) {
      await startTurn(current, next).catch((err) => {
        console.error(`[relay] a held message could not be sent: ${err instanceof Error ? err.message : err}`);
        toSubscribers(current, "jagentchill.chat.turn.pending", { sessionKey: current.sessionKey, cancelled: true, ts_ms: deps.now() });
      });
    }
  }

  /** Usage of the turn that just ended, as the runtime reported it. */
  function recordUsage(session: SessionRecord, run: ActiveRun): void {
    const usage = run.usage;
    // Slash commands and other local-only turns can carry an all-zero usage object. They did not make a model request.
    if (usage && (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) === 0) return;
    const reports = runtimes.runtime(session.ref?.runtimeId ?? "")?.capabilities.usage ?? "tokens";
    const reported = !!usage && reports !== "none";
    const total = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0) + (usage?.cacheReadTokens ?? 0) + (usage?.cacheWriteTokens ?? 0);
    db.prepare(
      `INSERT OR IGNORE INTO session_usage (session_key, run_id, runtime_id, provider_id, model_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, cost, reported, ts_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      session.sessionKey, run.runId, session.ref?.runtimeId ?? null, session.ref?.providerId ?? null, run.model ?? session.ref?.modelId ?? null,
      reported ? usage!.inputTokens ?? 0 : null, reported ? usage!.outputTokens ?? 0 : null, reported ? usage!.cacheReadTokens ?? 0 : null, reported ? usage!.cacheWriteTokens ?? 0 : null,
      reported ? total : null, reported && reports === "tokens-and-cost" ? usage!.costUsd ?? 0 : null, reported ? 1 : 0, deps.now(),
    );
    toSubscribers(session, "jagentchill.session.usage", { sessionKey: session.sessionKey, turn: usageOf(session.sessionKey).turns.at(-1) });
  }

  function usageOf(key: string) {
    const rows = db.prepare("SELECT * FROM session_usage WHERE session_key = ? ORDER BY id").all(key) as Array<Record<string, number | string | null>>;
    const turns = rows.map((row) => ({
      runId: row.run_id as string, runtimeId: row.runtime_id as string | null, providerId: row.provider_id as string | null, modelId: row.model_id as string | null,
      reported: row.reported === 1, inputTokens: row.input_tokens as number | null, outputTokens: row.output_tokens as number | null,
      cacheReadTokens: row.cache_read_tokens as number | null, cacheWriteTokens: row.cache_write_tokens as number | null, totalTokens: row.total_tokens as number | null,
      cost: row.cost as number | null, ts_ms: row.ts_ms as number,
    }));
    const reported = turns.filter((turn) => turn.reported);
    const sum = (pick: (turn: (typeof turns)[number]) => number | null) => reported.reduce((total, turn) => total + (pick(turn) ?? 0), 0);
    return {
      turns,
      // Totals cover reported turns only; a runtime that reports nothing is shown as "not reported", never as zero.
      totals: reported.length ? { inputTokens: sum((turn) => turn.inputTokens), outputTokens: sum((turn) => turn.outputTokens), totalTokens: sum((turn) => turn.totalTokens), cost: sum((turn) => turn.cost), turns: reported.length } : null,
      unreportedTurns: turns.length - reported.length,
    };
  }

  // ---- approvals and questions ----

  const answer = (entry: Live, id: string, allow: boolean, reply?: { updatedInput?: unknown; message?: string }) =>
    void entry.session.respondToPermission(id, allow ? "allow" : "deny", reply).catch((err) => console.warn(`[relay] a permission answer was not delivered: ${err instanceof Error ? err.message : err}`));

  /**
   * Every permission a runtime asks for is decided here: by the approval rules, or by a person on a device that may
   * answer it. A request nobody can answer is denied at once — a turn never waits for an answer that cannot come.
   */
  function onPermission(session: SessionRecord, entry: Live, event: Extract<RuntimeEvent, { type: "permission_requested" }>): void {
    const key = session.sessionKey;
    const request = viewPermission(event, deps.workdir(session));
    const run = activeRuns.get(key);
    if (run) Object.assign(run, { seen_ms: deps.now(), quietTold: false });
    // A runtime's own way of asking the person is shown as the product's question card and answered from there.
    if (request.question) {
      const question: RuntimeQuestion = { id: event.id, sessionKey: key, questions: request.question };
      let shown = false;
      try { shown = deps.onRuntimeQuestion?.(session, question) === true; } catch (err) { console.error(`[relay] a runtime question could not be shown: ${err instanceof Error ? err.message : err}`); }
      if (shown) { runtimeQuestions.set(event.id, { sessionKey: key, live: entry, permissionId: event.id, input: request.input, questions: request.question, codex: /requestUserInput/i.test(event.kind) }); return; }
      audit(db, deps.now(), "server", "question.auto_cancel", { questionId: event.id, sessionKey: key });
      return answer(entry, event.id, false, { message: "Nobody can answer this question now; go on without it." });
    }
    const toolName = request.toolName;
    // The server's own tools check the caller at the tool endpoint; asking a person for each call would add nothing.
    // The runtime's tool lookup has to pass too, or those tools cannot be loaded at all.
    if (toolName === "ToolSearch" || productToolName(toolName)) {
      audit(db, deps.now(), "server", "approval.auto_allow", { approvalId: event.id, sessionKey: key, toolName });
      return answer(entry, event.id, true);
    }
    // A CLI runtime loads a skill through its own `Skill` tool. Loading a skill a device attached to this session runs
    // nothing on the host, so it is allowed without a prompt; any other skill takes the ordinary path below.
    if (toolName === "Skill" && deps.skillAttached) {
      const wanted = (request.input as { skill?: unknown } | undefined)?.skill;
      if (typeof wanted === "string" && deps.skillAttached(key, wanted.split(":").pop()!)) {
        audit(db, deps.now(), "server", "approval.auto_allow", { approvalId: event.id, sessionKey: key, toolName, skill: wanted });
        return answer(entry, event.id, true);
      }
    }
    const cwd = request.cwd;
    // The application's own program files are not the user's project: reading or patching them is never the agent's
    // work, in any mode, and nobody is asked about it.
    if (touchesApplication({ command: commandOfRequest(request), cwd }, APPLICATION_ROOTS)) {
      audit(db, deps.now(), "server", "approval.auto_deny", { approvalId: event.id, sessionKey: key, toolName, reason: "application_files" });
      return answer(entry, event.id, false, { message: "The application's own files are not part of this work." });
    }
    // Running without asking (an admin's grant) is what it says.
    if (session.unattended) {
      audit(db, deps.now(), "server", "approval.auto_allow", { approvalId: event.id, sessionKey: key, toolName, reason: "unattended" });
      return answer(entry, event.id, true);
    }
    // Auto mode means what its card says: the agent goes on without asking for each step. Only a command that deletes,
    // raises privileges or changes the system (`isRiskyCommand`) still asks; so does a command seen only in part.
    if (session.modeId === "auto") {
      const shell = isShellRequest(request.kind, toolName), command = commandOfRequest(request);
      if (!shell || (!isCutInput(request) && command && !isRiskyCommand(command))) {
        audit(db, deps.now(), "server", "approval.auto_allow", { approvalId: event.id, sessionKey: key, toolName, reason: "auto_mode" });
        return answer(entry, event.id, true);
      }
    }
    // What the person allowed for the rest of this session is not asked about again: the same program or command line
    // in the same folder for a shell request, the same tool otherwise.
    const grant = grantOf({ kind: request.kind, toolName, command: commandOfRequest(request), cwd, partial: isCutInput(request) });
    if (grant && sessionGrants.get(key)?.has(grant.rule)) {
      audit(db, deps.now(), "server", "approval.auto_allow", { approvalId: event.id, sessionKey: key, toolName, reason: "session_grant", scope: grant.scope });
      return answer(entry, event.id, true);
    }
    // Anything else a runtime wants to do on the host with its own tools is put to a person. When no device that may
    // answer is connected, the request is denied at once.
    const reviewers = deps.devices.list().filter((device) => device.state === "active" && ROLE_SCOPES[device.role].includes("jagentchill.host.exec") && canRead(session, device.deviceId, device.role));
    if (deps.isOnline && !reviewers.some((device) => deps.isOnline!(device.deviceId))) {
      audit(db, deps.now(), "server", "approval.auto_deny", { approvalId: event.id, sessionKey: key, toolName, reason: "nobody_to_ask" });
      return answer(entry, event.id, false, { message: "Nobody can approve this now." });
    }
    const said = (value: unknown) => (typeof value === "string" ? deps.redact(value) : "");
    const pending: PendingApproval & { live: Live } = {
      approvalId: event.id, kind: request.kind, sessionKey: key, title: said(request.title).slice(0, 200),
      // What will run, whole: the command of a shell request, otherwise the tool's input as the runtime describes it.
      detail: (said(request.command) || said(request.description) || said(request.detail)).slice(0, 8000),
      ...(toolName ? { toolName } : {}), ...(cwd ? { cwd: said(cwd).slice(0, 500) } : {}), requested_ms: deps.now(),
      ...(grant ? { grant: { scope: grant.scope, subject: deps.redact(grant.subject).slice(0, 300) } } : {}), live: entry,
    };
    if (grant) pendingRules.set(pending.approvalId, grant.rule);
    approvals.set(pending.approvalId, pending);
    audit(db, deps.now(), "server", "approval.requested", { approvalId: pending.approvalId, sessionKey: key, toolName });
    deps.broadcast("jagentchill.host.exec", "jagentchill.approval.requested", "approvals", publicApproval(pending), (connection) => canAnswer(key, connection));
  }
  const publicApproval = ({ live: _live, ...approval }: PendingApproval & { live: Live }): PendingApproval => approval;
  function onPermissionResolved(id: string): void {
    const known = approvals.get(id);
    if (!known) return;
    approvals.delete(id);
    pendingRules.delete(id);
    deps.broadcast("jagentchill.host.exec", "jagentchill.approval.resolved", "approvals", { approvalId: known.approvalId, sessionKey: known.sessionKey }, (connection) => canAnswer(known.sessionKey, connection));
  }

  /** Turns that showed no sign of life for `TURN_QUIET_MS`: the person is told once, with the turn still stoppable. */
  function checkQuietTurns(): void {
    // A turn that waits for a person's answer or approval is not "quiet".
    const waiting = new Set([...[...runtimeQuestions.values()].map((question) => question.sessionKey), ...[...approvals.values()].map((approval) => approval.sessionKey)]);
    for (const [key, run] of activeRuns) {
      if (run.quietTold || waiting.has(key) || deps.now() - run.seen_ms < TURN_QUIET_MS) continue;
      const session = find(key);
      if (!session) continue;
      run.quietTold = true;
      toSubscribers(session, "jagentchill.chat.notice", { sessionKey: key, runId: run.runId, code: "turn-quiet", message: "The agent has not reported anything for a while.", quiet_ms: deps.now() - run.seen_ms, ts_ms: deps.now() });
    }
  }
  const quietTimer = setInterval(checkQuietTurns, 15_000);
  quietTimer.unref();

  function canAnswer(key: string, connection: Connection): boolean {
    const session = find(key);
    return !!session && canRead(session, connection.deviceId, connection.role());
  }

  // ---- runtime selection ----

  const selectionOf = (session: SessionRecord): SessionSelection | undefined =>
    session.ref && { ref: session.ref, modeId: session.unattended ? UNATTENDED_MODE_ID : session.modeId, thinkingOptionId: session.thinkingOptionId, featureValues: session.featureValues };

  /** A new mode: the runtime session takes it with its next opening (`ensureLive` compares what it was opened with). */
  function applyMode(session: SessionRecord, modeId: string): SessionRecord {
    return setColumns(session.sessionKey, { mode_id: modeId, pending_mode_id: null });
  }

  /** The check made at the start of every turn: the session's runtime and model must still be selectable for the caller. */
  async function guardTurn(session: SessionRecord, role: Role | undefined): Promise<void> {
    if (!session.ref) return;
    try {
      await runtimes.assertSelectable(session.ref, role);
    } catch (err) {
      if (err instanceof ProtocolError && err.code === "runtime/disabled") throw new ProtocolError("runtime/disabled", "This runtime was turned off — choose another", { details: err.details });
      throw err;
    }
    const runtime = runtimes.runtime(session.ref.runtimeId)!;
    if (runtime.requiresFullAccess && !session.unattended) {
      throw new ProtocolError("runtime/unattended-not-granted", `${runtime.label} runs with its own permissions on this host. An admin device must confirm “Run without asking” for this session.`, { details: { runtimeId: runtime.id } });
    }
  }

  function resolveQueue(session: SessionRecord, requested: QueueMode, expectedRunId?: string): { effective: QueueMode | "none"; downgradedFrom?: QueueMode; reason?: string } {
    const run = activeRuns.get(session.sessionKey);
    // A steer is meant for one turn: when that turn is no longer the active one, nothing is sent.
    if (requested === "steer" && expectedRunId && run?.runId !== expectedRunId) return { effective: "none", reason: "turn-changed" };
    const capabilities = runtimes.runtime(session.ref?.runtimeId ?? "")?.capabilities;
    if (requested === "steer" && capabilities && !capabilities.steer) return { effective: "followup", downgradedFrom: "steer", reason: "This runtime cannot take messages mid-turn" };
    return { effective: requested };
  }

  const stagedHandover = (key: string) =>
    db.prepare("SELECT id, text, item_count FROM runtime_handover WHERE session_key = ? AND status = 'staged' ORDER BY id DESC LIMIT 1").get(key) as { id: number; text: string; item_count: number } | undefined;

  /** The skills attached to a session, said where the runtime finds them; the skills' own text is not put into the prompt. */
  function skillNote(key: string): string | undefined {
    const files = deps.skillFiles?.(key) ?? [];
    if (!files.length) return undefined;
    return `Skills attached to this conversation — read each SKILL.md before you act and follow it:\n${files.map((skill) => `- ${skill.name}: ${skill.file}`).join("\n")}`;
  }

  /**
   * Starts a turn on the session's runtime: the message is written to the transcript, the runtime session is opened
   * (or resumed) when needed, and the turn is sent. The run id is the runtime's own id of the turn.
   */
  async function startTurn(session: SessionRecord, item: Queued): Promise<string> {
    const key = session.sessionKey;
    const entry = await ensureLive(session);
    let message = item.message;
    if (!item.command) {
      // A runtime session that never had this conversation is told what was said so far.
      if (carryOver.delete(key)) {
        const history = transcript.recent(key, 500);
        const built = buildHandover({ title: session.title ?? "Session", from: session.ref!, created_ms: session.created_ms, messages: history });
        if (built.itemCount) message = `${built.text}\n\n${message}`;
      }
      const note = skillNote(key);
      if (note) message = `${note}\n\n${message}`;
    }
    const parts: TranscriptPart[] = [{ type: "text", text: item.userText ?? item.message }, ...(item.attachments ?? []).flatMap((attachment): TranscriptPart[] => (attachment.data && attachment.mimeType ? [{ type: "image", mimeType: attachment.mimeType, data: attachment.data, ...(attachment.name ? { name: attachment.name } : {}) }] : []))];
    const run = newRun("");
    // The run exists before the runtime starts it, so the events the runtime reports at once find it; the person's
    // message is in the transcript before anything the agent answers.
    activeRuns.set(key, run);
    if (item.handoverId !== undefined) run.handoverId = item.handoverId;
    // A command the host runs on the runtime (`/compact`) is not a message of the conversation.
    const written = item.hidden ? undefined : record(session, { role: "user", content: parts, timestamp: deps.now(), idempotencyKey: item.idempotencyKey });
    let turnId: string;
    try {
      ({ turnId } = await entry.session.startTurn(message, item.attachments ?? []));
    } catch (err) {
      if (activeRuns.get(key) === run) activeRuns.delete(key);
      if (written) transcript.drop(key, written.id);
      void dropLive(key);
      throw engineError(err);
    }
    if (!run.runId) run.runId = turnId;
    deps.onTurnStarted?.(key, turnId, item.deviceId);
    return turnId;
  }

  /** Stops the running turn: the runtime is asked, and the turn is ended here when it does not confirm in time. */
  async function stopTurn(session: SessionRecord): Promise<{ run?: ActiveRun; confirmed: boolean }> {
    const key = session.sessionKey;
    queued.delete(key);
    const run = activeRuns.get(key);
    const entry = live.get(key);
    if (!run) { if (entry) void dropLive(key); return { confirmed: true }; }
    run.stopped = true;
    // Questions and approvals of the turn are answered "no": the turn does not wait for them while it stops.
    for (const [id, approval] of approvals) if (approval.sessionKey === key) { answer(approval.live, id, false); onPermissionResolved(id); }
    const asked = entry ? entry.session.interrupt().then(() => true, () => false) : Promise.resolve(false);
    const confirmed = await Promise.race([asked, new Promise<false>((resolve) => setTimeout(() => resolve(false), STOP_WAIT_MS).unref())]);
    // The runtime's own end of the turn may have come meanwhile; when it has not, the turn ends here and every device is told.
    if (activeRuns.get(key) === run) {
      const message = flushAssistant(session, run, true);
      await finishTurn(session, run, "aborted", message, undefined);
    }
    await dropLive(key);
    return { run, confirmed };
  }

  const methods = new Map<string, RpcMethod>();

  methods.set("jagentchill.approval.list", {
    scope: "jagentchill.host.exec",
    handle: (_raw, connection) => ({ approvals: [...approvals.values()].filter((approval) => canAnswer(approval.sessionKey, connection)).map(publicApproval) }),
  });

  methods.set("jagentchill.approval.resolve", {
    scope: "jagentchill.host.exec",
    async handle(raw, connection) {
      const params = parse(approvalParams, raw);
      const pending = approvals.get(params.approvalId);
      if (!pending || !canAnswer(pending.sessionKey, connection)) throw new ProtocolError("NOT_FOUND", "No such approval request.");
      // The server is the only reviewer the runtime knows, so the device that decided is recorded here.
      audit(db, deps.now(), `device:${connection.deviceId}`, "approval.resolve", {
        approvalId: pending.approvalId, sessionKey: pending.sessionKey, decision: params.decision, detail: pending.detail.slice(0, 2000),
      });
      const rule = pendingRules.get(pending.approvalId);
      try {
        await pending.live.session.respondToPermission(pending.approvalId, params.decision === "deny" ? "deny" : "allow");
      } catch (err) {
        throw engineError(err);
      }
      onPermissionResolved(pending.approvalId);
      if (params.decision === "allow-session" && rule) (sessionGrants.get(pending.sessionKey) ?? sessionGrants.set(pending.sessionKey, new Set()).get(pending.sessionKey)!).add(rule);
      return { approvalId: pending.approvalId, decision: params.decision };
    },
  });

  methods.set("jagentchill.session.create", {
    scope: "jagentchill.agent.use",
    async handle(raw, connection) {
      const params = parse(createParams, raw);
      const role = connection.role();
      if (!role) throw new ProtocolError("DEVICE_REVOKED", "The device is revoked.");
      // The model: the caller's explicit choice, otherwise the first target of the role's ORC route that can serve now.
      let chosen: Awaited<ReturnType<RuntimeService["assertSelectable"]>> | undefined;
      let ref = params.ref;
      let fromRoute: { thinking?: string; mode?: string } = {};
      const fallbacks: Array<{ ref: ModelRef; reason: string }> = [];
      if (ref) {
        chosen = await runtimes.assertSelectable(ref, role);
      } else {
        // Without an explicit model the session follows the role's route as an admin configured it. The server chooses
        // no model by itself.
        const resolution = deps.orc.resolve(params.role, "default", { projectId: params.projectId });
        if (!resolution.candidates.length && !resolution.skipped.length) {
          throw new ProtocolError("NO_ROUTE", "Choose a model", { details: { role: params.role, reason: "no-model-chosen" } });
        }
        for (const candidate of resolution.candidates) {
          try {
            chosen = await runtimes.assertSelectable(candidate.ref, role);
            ref = candidate.ref;
            fromRoute = { thinking: candidate.thinking, mode: candidate.mode };
            break;
          } catch (err) {
            fallbacks.push({ ref: candidate.ref, reason: err instanceof Error ? err.message : "not selectable" });
          }
        }
        if (!chosen || !ref) throw new ProtocolError("NO_ROUTE", "No AI runtime is ready", { details: { role: params.role, skipped: [...resolution.skipped, ...fallbacks.map((entry) => ({ ...entry.ref, reason: entry.reason }))] } });
      }
      const modeId = params.modeId ?? (fromRoute.mode as ProductMode | undefined) ?? (chosen.entry.defaultModeId as ProductMode);
      const toolSurface: ToolSurface = params.toolSurface ?? (params.agentId === "jagentchill-team" ? "team" : params.scriptId ? "film" : params.projectId ? "editor" : "general");
      let unattended = false;
      if (chosen.runtime.requiresFullAccess) {
        // This runtime decides by itself what it runs on the host, which is the unattended grant.
        if (role !== "admin" || !params.confirmFullAccess) {
          throw new ProtocolError(role === "admin" ? "runtime/unattended-not-granted" : "SCOPE_DENIED", `${chosen.runtime.label} runs commands and changes files on the host without asking. An admin device must confirm that.`, { details: { runtimeId: chosen.runtime.id, requires: "confirmFullAccess" } });
        }
        unattended = true;
      } else if (!chosen.entry.modes.find((mode) => mode.id === modeId)?.supported) {
        throw new ProtocolError("runtime/unsupported-capability", `${chosen.runtime.label} cannot run in this mode.`, { details: { runtimeId: chosen.runtime.id, capability: `productModes.${modeId}` } });
      }
      const thinking = params.thinkingOptionId ?? fromRoute.thinking ?? null;
      if (thinking && !chosen.model.thinkingOptions.some((option) => option.id === thinking)) {
        throw new ProtocolError("INVALID_PARAMS", "This model does not offer that thinking option.", { details: { path: "thinkingOptionId" } });
      }
      const key = `agent:${params.agentId}:jc:${randomUUID()}`;
      // The runtime session is opened with the first turn; until then the session is the server's record alone.
      db.prepare(
        `INSERT INTO agent_sessions (session_key, gateway_key, agent_id, owner_device_id, agent_class, project_id, script_id, tool_surface, origin, title, title_source, runtime_id, provider_id, model_id, mode_id, thinking, unattended, created_ms)
         VALUES (?, ?, ?, ?, 'creative', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(key, key, params.agentId, connection.deviceId, params.projectId ?? null, params.scriptId ?? null, toolSurface, params.origin ?? "device", params.title ?? null, params.title ? "user" : null,
        ref.runtimeId, ref.providerId, ref.modelId, modeId, thinking, unattended ? 1 : 0, deps.now());
      if (unattended) audit(db, deps.now(), `device:${connection.deviceId}`, "session.unattended.set", { sessionKey: key, enabled: true, runtimeId: ref.runtimeId, reason: "runtime-requires-full-access" });
      if (params.pictures) db.prepare("UPDATE agent_sessions SET features = ? WHERE session_key = ?").run(JSON.stringify({ [LOCAL_IMAGE_FEATURE]: true }), key);
      const session = find(key)!;
      publish(session);
      return { session, ...(fallbacks.length ? { fallback: { skipped: fallbacks } } : {}) };
    },
  });

  methods.set("jagentchill.session.list", {
    scope: "jagentchill.projects.read",
    handle(raw, connection) {
      const role = connection.role();
      const { projectId, includeWorkflowRuns } = parse(listParams, raw);
      // Newest first; with a project, only the sessions bound to it.
      const rows = (projectId ? db.prepare("SELECT * FROM agent_sessions WHERE project_id = ? ORDER BY created_ms DESC").all(projectId) : db.prepare("SELECT * FROM agent_sessions ORDER BY created_ms DESC").all()) as Row[];
      // A sub-agent is shown in its tree (`jagentchill.agent.tree.get`), not among the chat sessions.
      return { sessions: rows.map(toRecord).filter((session) => session.origin !== "agent" && (includeWorkflowRuns || (session.origin !== "workflow" && session.origin !== "automation")) && canRead(session, connection.deviceId, role)).map((session) => ({ ...session, running: activeRuns.has(session.sessionKey) })) };
    },
  });

  methods.set("jagentchill.session.subscribe", {
    scope: "jagentchill.projects.read",
    handle(_raw, connection) {
      sessionWatchers.add(connection);
      return { stream: "sessions" };
    },
  });
  methods.set("jagentchill.session.unsubscribe", { scope: "jagentchill.projects.read", handle: (_raw, connection) => void sessionWatchers.delete(connection) });

  methods.set("jagentchill.session.get", {
    scope: "jagentchill.projects.read",
    handle: (raw, connection) => ({ session: requireRead(parse(keyParams, raw).sessionKey, connection) }),
  });

  methods.set("jagentchill.session.access.set", {
    scope: "jagentchill.agent.use",
    handle(raw, connection) {
      const params = parse(accessParams, raw);
      const session = requireRead(params.sessionKey, connection);
      if (session.ownerDeviceId !== connection.deviceId && connection.role() !== "admin") {
        throw new ProtocolError("SCOPE_DENIED", "Only the owner or an admin can change access.", { details: { reason: "not_owner" } });
      }
      return { session: setColumns(session.sessionKey, { access: params.access }) };
    },
  });

  methods.set("jagentchill.session.update", {
    scope: "jagentchill.agent.use",
    handle(raw, connection) {
      const params = parse(updateParams, raw);
      const session = requireAct(params.sessionKey, connection);
      if ("patch" in params) {
        if (params.patch.projectId === (session.projectId ?? null)) return { session };
        deps.beforeProjectChange?.(session.sessionKey);
        audit(db, deps.now(), `device:${connection.deviceId}`, "session.project.set", { sessionKey: session.sessionKey, projectId: params.patch.projectId });
        // Every device that follows the session records learns it and says "Now working on <project>" with the project's
        // own name; the host holds no project names.
        return { session: setColumns(session.sessionKey, { project_id: params.patch.projectId }) };
      }
      // A title a person typed is never overwritten by automatic titling.
      return { session: setColumns(session.sessionKey, { title: params.title, title_source: "user" }) };
    },
  });

  methods.set("jagentchill.session.organize", {
    scope: "jagentchill.agent.use",
    handle(raw, connection) {
      const params = parse(organizeParams, raw);
      const session = requireAct(params.sessionKey, connection);
      if (session.ownerDeviceId !== connection.deviceId && connection.role() !== "admin") {
        throw new ProtocolError("SCOPE_DENIED", "Only the owner or an admin can organize this session.", { details: { reason: "not_owner" } });
      }
      const columns = { ...(params.pinned === undefined ? {} : { pinned: params.pinned ? 1 : 0 }), ...(params.archived === undefined ? {} : { archived: params.archived ? 1 : 0 }) };
      const updated = setColumns(session.sessionKey, columns);
      audit(db, deps.now(), `device:${connection.deviceId}`, "session.organize", { sessionKey: session.sessionKey, ...columns });
      return { session: updated };
    },
  });

  methods.set("jagentchill.session.delete", {
    scope: "jagentchill.agent.use",
    async handle(raw, connection) {
      const session = requireAct(parse(keyParams, raw).sessionKey, connection);
      if (session.ownerDeviceId !== connection.deviceId && connection.role() !== "admin") {
        throw new ProtocolError("SCOPE_DENIED", "Only the owner or an admin can delete a session.", { details: { reason: "not_owner" } });
      }
      // A running turn is stopped first; the runtime's process goes with the session.
      if (activeRuns.has(session.sessionKey)) await stopTurn(session).catch(() => undefined);
      await dropLive(session.sessionKey);
      // Usage records keep the session id; everything else of the session is removed.
      transcript.remove(session.sessionKey);
      db.prepare("DELETE FROM agent_sessions WHERE session_key = ?").run(session.sessionKey);
      db.prepare("DELETE FROM runtime_handover WHERE session_key = ?").run(session.sessionKey);
      db.prepare("DELETE FROM orc_overrides WHERE scope_kind = 'session' AND scope_id = ?").run(session.sessionKey);
      activeRuns.delete(session.sessionKey);
      queued.delete(session.sessionKey);
      subscribers.delete(session.sessionKey);
      sessionGrants.delete(session.sessionKey);
      deps.onSessionDeleted?.(session.sessionKey);
      audit(db, deps.now(), `device:${connection.deviceId}`, "session.delete", { sessionKey: session.sessionKey });
      deps.broadcast("jagentchill.projects.read", "jagentchill.session.deleted", "sessions", { sessionKey: session.sessionKey }, watching(session));
    },
  });

  methods.set("jagentchill.session.fork", {
    scope: "jagentchill.agent.use",
    async handle(raw, connection) {
      const params = parse(forkParams, raw);
      const source = requireAct(params.sessionKey, connection);
      if (!source.ref) throw new ProtocolError("runtime/unsupported-capability", "This session has no model selection to fork.", { details: { capability: "fork" } });
      const runtime = runtimes.runtime(source.ref.runtimeId);
      if (runtime?.requiresFullAccess) throw new ProtocolError("runtime/unsupported-capability", `${runtime.label} sessions cannot be forked: the unattended grant is not copied.`, { details: { runtimeId: runtime.id, capability: "fork" } });
      // The fork carries the conversation as a summary of the server's transcript, up to the chosen message.
      const history = params.boundary ? transcript.upTo(source.sessionKey, params.boundary.messageId) : transcript.recent(source.sessionKey, 500);
      if (!history) throw new ProtocolError("FORK_ANCHOR_GONE", "Selected timeline position is no longer available.");
      const key = `agent:${source.agentId}:jc:${randomUUID()}`;
      const title = `${source.title ?? "Session"} (fork)`.slice(0, 120);
      // The fork starts in the source's mode, never unattended, and copies no pending approval or queued message.
      db.prepare(
        `INSERT INTO agent_sessions (session_key, gateway_key, agent_id, owner_device_id, agent_class, project_id, origin, title, title_source, runtime_id, provider_id, model_id, mode_id, thinking, features, parent_session_key, created_ms)
         VALUES (?, ?, ?, ?, 'creative', ?, 'device', ?, 'auto', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(key, key, source.agentId, connection.deviceId, source.projectId ?? null, title,
        source.ref.runtimeId, source.ref.providerId, source.ref.modelId, source.modeId, source.thinkingOptionId, JSON.stringify(source.featureValues), source.sessionKey, deps.now());
      const handover = buildHandover({ title: source.title ?? "Session", from: source.ref, created_ms: source.created_ms, messages: history });
      if (handover.itemCount) {
        db.prepare("INSERT INTO runtime_handover (session_key, from_ref, to_ref, text, item_count, omitted_count, created_ms, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'staged')")
          .run(key, JSON.stringify(source.ref), JSON.stringify(source.ref), handover.text, handover.itemCount, handover.omittedCount, deps.now());
      }
      const session = find(key)!;
      deps.onSessionForked?.(source.sessionKey, key);
      publish(session);
      return { session, carried: "summary" };
    },
  });

  methods.set("jagentchill.session.rewind", {
    scope: "jagentchill.agent.use",
    async handle(raw, connection) {
      const params = parse(rewindParams, raw);
      const session = requireAct(params.sessionKey, connection);
      // No runtime the server drives can continue a conversation from an earlier message (`capabilities.rewind`).
      const scope = params.scope[0]!;
      throw new ProtocolError("runtime/unsupported-capability", scope === "project" ? "Project changes of this session cannot be rewound yet." : "This runtime cannot rewind that.", { details: { runtimeId: session.ref?.runtimeId ?? null, capability: `rewind.${scope}` } });
    },
  });

  methods.set("jagentchill.session.usage.list", {
    scope: "jagentchill.projects.read",
    handle(raw, connection) {
      const session = requireRead(parse(keyParams, raw).sessionKey, connection);
      const reports = runtimes.runtime(session.ref?.runtimeId ?? "")?.capabilities.usage ?? "tokens";
      return { sessionKey: session.sessionKey, reports, ...usageOf(session.sessionKey) };
    },
  });

  methods.set("jagentchill.chat.send", {
    scope: "jagentchill.agent.use",
    async handle(raw, connection) {
      const params = parse(sendParams, raw);
      let session = requireAct(params.sessionKey, connection);
      // A conversation the person handed to another agent of the session: what they write here starts that agent's turn.
      const routed = find(deps.answeringSession?.(session.sessionKey) ?? "");
      if (routed) session = routed;
      if (deps.answerPendingQuestion?.(session.sessionKey, params.message)) return { delivered: true, questionAnswered: true };
      const directImage = /^\/image(?:\s+([\s\S]*))?$/i.exec(params.message.trim());
      if (directImage && deps.directImage) {
        const prompt = (directImage[1] ?? "").trim();
        if (!prompt) return { delivered: true, hostReply: { title: "JAgentChill", rows: [{ label: "Picture", value: "Write what the picture shows after /image." }] } };
        const reply = await deps.directImage(session.sessionKey, prompt);
        if (!reply.jobId) return { delivered: true, hostReply: reply };
        // The words and the picture stay in the conversation (a device that opens it later sees both).
        const key = randomUUID();
        db.prepare("INSERT INTO picture_messages (idempotency_key, session_key, job_id, ts_ms) VALUES (?, ?, ?, ?)").run(key, session.sessionKey, reply.jobId, deps.now());
        if (!session.title) session = setColumns(session.sessionKey, { title: prompt.replace(/\s+/g, " ").trim().slice(0, 60), title_source: "auto" });
        record(session, { role: "user", content: [{ type: "text", text: prompt }], timestamp: deps.now(), idempotencyKey: key });
        return { delivered: true, picture: { jobId: reply.jobId } };
      }
      // The composer's "make pictures on this computer" switch: a message that asks for a picture (or a change of the last
      // one) is made by the person's model from their own words. The agent is not shown what the picture is — it is told
      // a picture is being made and does the rest — so its own model has nothing to judge.
      let picture: { jobId: string } | undefined;
      const picturesOn = deps.directImage && session.featureValues?.[LOCAL_IMAGE_FEATURE] === true && !params.attachments && !params.message.trim().startsWith("/") && !!params.message.trim();
      const intent = picturesOn ? await (deps.pictureIntent?.(session.sessionKey, params.message) ?? Promise.resolve(guessIntent(params.message, !!deps.hasLocalPicture?.(session.sessionKey)))) : "other";
      if (intent !== "other") {
        const reply = await deps.directImage!(session.sessionKey, params.message.trim(), { change: intent === "change", quiet: false });
        if (!reply.jobId) return { delivered: true, hostReply: reply };
        picture = { jobId: reply.jobId };
      }
      const requestedHostCommand = /^\/(status|help|compact)$/i.exec(params.message.trim())?.[1]?.toLowerCase();
      const hostRuntime = runtimes.runtime(session.ref?.runtimeId ?? "");
      const hostCommand = requestedHostCommand === "compact" && hostRuntime?.capabilities.compaction !== "host" ? undefined : requestedHostCommand;
      if (hostCommand) return { delivered: true, hostReply: await hostReply(hostCommand, session, connection) };
      await guardTurn(session, connection.role());
      deps.beforeTurn?.(session.sessionKey);
      const active = activeRuns.get(session.sessionKey), running = active?.stopped ? undefined : active;
      let queue: ReturnType<typeof resolveQueue> | undefined;
      if (running) {
        // A message sent during a turn waits for the turn to end, or replaces it.
        queue = resolveQueue(session, params.queueMode ?? "steer", params.expectedRunId);
        if (queue.effective === "none") return { delivered: false, effective: "none", reason: queue.reason };
      }
      if (!running && session.pendingModeId) session = applyMode(session, session.pendingModeId);
      const slashName = /^\/([a-z0-9][a-z0-9_-]*)(?:\s|$)/i.exec(params.message)?.[1]?.toLowerCase();
      const localCommandMatch = /^\/([a-z0-9][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i.exec(params.message);
      const localCommands = localCommandMatch && !params.attachments
        ? localSlashCommands(session.ref?.runtimeId ?? "", runtimes.homeDirectory(), session.projectId ? deps.projectWorkspace?.(session.projectId) : undefined)
        : [];
      const localCommand = localCommands.find((entry) => entry.name.toLowerCase() === slashName);
      // Any other slash command goes to the runtime as written: the CLI knows its own commands.
      const runtimeCommand = !!slashName && !localCommand && !params.attachments;
      const commandMessage = !!localCommand || runtimeCommand;
      const handover = running || commandMessage ? undefined : stagedHandover(session.sessionKey);
      // What the session works on leads every turn, written at this moment.
      const said = picture ? `[JAgentChill] The user asked for a picture. It is being made on this computer by the picture model the user chose, from the user's own words (jobId ${picture.jobId}); it is added to the media library by itself and you are told when it is there. Do not make a picture yourself and do not describe or judge it. Tell the user in ${languageOf(params.message)}, in one short line, that it is being made; when you are told it is ready, put it on the timeline (at the playhead, or replacing the picture it changes) unless the user said otherwise.` : params.message;
      const message = localCommand && localCommandMatch
        ? expandLocalCommand(localCommand, commandArguments(localCommandMatch[2] ?? ""))
        : commandMessage ? params.message : withTurnContext(deps.turnContext?.(session), handover ? `${handover.text}\n\n${said}` : said);
      // What the conversation shows is the person's own message.
      const shown = picture ? withTurnContext(deps.turnContext?.(session), params.message) : message;
      const idempotencyKey = randomUUID();
      if (localCommand && localCommandMatch) db.prepare("INSERT INTO slash_command_messages (idempotency_key, session_key, invocation, expansion, ts_ms) VALUES (?, ?, ?, ?, ?)")
        .run(idempotencyKey, session.sessionKey, params.message, message, deps.now());
      // The automatic title is the person's own words: a leading line that only names attached skills is not part of it.
      if (!session.title && !commandMessage) session = setColumns(session.sessionKey, { title: stripInjectedUserText(params.titleText ?? params.message).replace(/^(?:\$[a-z0-9-]+ ?)+\n\n/, "").replace(/\s+/g, " ").trim().slice(0, 60), title_source: "auto" });
      const attachments = params.attachments?.map((attachment): RuntimeAttachment => ({ mimeType: attachment.mimeType, data: attachment.content, name: attachment.fileName }));
      if (picture) db.prepare("INSERT INTO picture_messages (idempotency_key, session_key, job_id, ts_ms) VALUES (?, ?, ?, ?)").run(idempotencyKey, session.sessionKey, picture.jobId, deps.now());
      const item: Queued = { message, ...(attachments ? { attachments } : {}), deviceId: connection.deviceId, idempotencyKey, userText: shown, ...(handover ? { handoverId: handover.id } : {}), ...(commandMessage ? { command: true } : {}) };
      const extras = {
        ...(routed ? { routedTo: routed.sessionKey } : {}),
        ...(queue ? { effective: queue.effective, ...(queue.downgradedFrom ? { downgradedFrom: queue.downgradedFrom, reason: queue.reason } : {}) } : {}),
        ...(handover ? { handover: { itemCount: handover.item_count } } : {}),
      };
      if (running && queue?.effective === "steer" && !commandMessage && !attachments) {
        // Added to the turn that is running (Codex): the agent reads it at its next step. A runtime that refuses it
        // (its turn just ended) gets it as the next message instead.
        const steer = live.get(session.sessionKey)?.session.steer;
        if (steer && await steer(params.message)) {
          record(session, { role: "user", content: [{ type: "text", text: params.message }], timestamp: deps.now(), idempotencyKey });
          return { runId: running.runId, status: "steered", delivered: true, ...extras };
        }
        if (queue) { Object.assign(queue, { effective: "followup", downgradedFrom: "steer" }); Object.assign(extras, { effective: "followup", downgradedFrom: "steer" }); }
      }
      if (running && queue?.effective !== "interrupt") {
        // Held until the turn ends; the devices show it as queued.
        (queued.get(session.sessionKey) ?? queued.set(session.sessionKey, []).get(session.sessionKey)!).push(item);
        return { runId: running.runId, status: "queued", delivered: true, ...extras, ...(picture ? { picture } : {}) };
      }
      if (running) await stopTurn(session);
      try {
        const runId = await startTurn(session, item);
        return { runId, status: "started", delivered: true, ...extras, ...(picture ? { picture } : {}) };
      } catch (err) {
        if (localCommand && localCommandMatch) db.prepare("DELETE FROM slash_command_messages WHERE idempotency_key = ?").run(idempotencyKey);
        throw engineError(err);
      }
    },
  });

  /** `/status`, `/help` and `/compact`: answered by the host, never sent to the runtime. */
  async function hostReply(command: string, session: SessionRecord, connection: Connection): Promise<HostCommandReply> {
    const runtime = runtimes.runtime(session.ref?.runtimeId ?? "");
    const safe = (value: unknown, fallback = "Not available") => {
      const said = String(value ?? fallback);
      return /gateway|agent:main:|jagentchill-unset|oauth/i.test(said) ? fallback : said;
    };
    if (command === "compact") {
      if (!deps.compactSession) return { title: "JAgentChill", rows: [{ label: "Conversation", value: "Could not compact this conversation." }] };
      const result = await deps.compactSession(session.sessionKey, connection);
      return { title: "JAgentChill", rows: [{ label: "Conversation", value: result.compacted ? "Compacted" : "Could not compact this conversation." }] };
    }
    if (command === "help") {
      const labels: Record<string, string> = { builtin: "JAgentChill", skill: "Skills", "claude-code": runtime?.label ?? "Claude Code", "claude-personal": runtime?.label ?? "Claude Code", "claude-project": runtime?.label ?? "Claude Code", "codex-prompt": runtime?.label ?? "Codex", "codex-personal": runtime?.label ?? "Codex", "codex-project": runtime?.label ?? "Codex", codex: runtime?.label ?? "Codex" };
      const inventoryMethod = methods.get("jagentchill.chat.commands");
      const inventoryResult = inventoryMethod ? await Promise.resolve(inventoryMethod.handle({ sessionKey: session.sessionKey }, connection)).catch(() => undefined) : undefined;
      const inventory = inventoryResult && typeof inventoryResult === "object" ? inventoryResult as { commands?: Array<{ name?: string; source?: string }> } : undefined;
      const listed = inventory?.commands?.length ? inventory.commands : [
        { name: "status", source: "builtin" }, { name: "help", source: "builtin" },
        ...(runtime?.capabilities.compaction === "host" ? [{ name: "compact", source: "builtin" }] : []),
      ];
      const rows = listed.flatMap((entry) => typeof entry.name === "string" ? [{ label: safe(labels[entry.source ?? ""] ?? runtime?.label ?? "Commands"), value: safe(`/${entry.name}`) }] : []);
      return { title: "Available commands", rows };
    }
    const selectedRuntime = session.ref ? runtimes.snapshot().find((entry) => entry.runtimeId === session.ref!.runtimeId) : undefined;
    const model = selectedRuntime?.models.find((entry) => entry.providerId === session.ref?.providerId && entry.modelId === session.ref?.modelId);
    const context = deps.contextState?.(session.sessionKey);
    const plan = session.ref && deps.planState ? await deps.planState(session.ref.runtimeId, session.ref.providerId).catch(() => undefined) : undefined;
    const used = context?.context?.usedTokens;
    const max = context?.context?.maxTokens;
    const sessionUsage = usageOf(session.sessionKey);
    const costIsKnown = sessionUsage.turns.some((turn) => turn.reported && turn.cost !== null);
    const rows = [
      { label: "Runtime", value: safe(runtime?.label) },
      { label: "Model", value: safe(model?.label ?? session.ref?.modelId) },
      { label: "Thinking", value: safe(session.thinkingOptionId ?? "Default") },
      { label: "Permission", value: session.unattended ? "Run without asking" : "Guarded" },
      ...(typeof used === "number" ? [{ label: "Context", value: `${used.toLocaleString()}${typeof max === "number" ? ` / ${max.toLocaleString()} tokens${typeof context?.context?.pct === "number" ? ` · ${context.context.pct}%` : ""}` : " tokens"}` }] : []),
      ...(plan?.planLabel ? [{ label: "Plan", value: safe(plan.planLabel) }] : plan?.status === "sign-in-required" ? [{ label: "Plan", value: "Sign-in required" }] : []),
      ...(plan?.status === "available" ? plan.windows.flatMap((window) => typeof window.usedPct === "number" ? [{ label: `Plan limit · ${safe(window.label)}`, value: `${Math.round(window.usedPct)}% used${typeof window.resetsAt_ms === "number" ? ` · resets ${new Date(window.resetsAt_ms).toISOString().slice(0, 10)}` : ""}` }] : []) : []),
      ...(costIsKnown && sessionUsage.totals ? [{ label: "Session cost", value: `$${sessionUsage.totals.cost.toFixed(4)}` }] : []),
      ...(context?.limits.session ? [{ label: "Session limit", value: `${context.limits.session.usedTokens.toLocaleString()} / ${context.limits.session.limitTokens.toLocaleString()} tokens` }] : []),
      ...(context?.limits.day ? [{ label: "Daily limit", value: `${context.limits.day.usedTokens.toLocaleString()} / ${context.limits.day.limitTokens.toLocaleString()} tokens` }] : []),
      { label: "Compactions", value: String(context?.compactions.length ?? 0) },
    ];
    return { title: "Session status", rows };
  }

  methods.set("jagentchill.chat.commands", {
    scope: "jagentchill.projects.read",
    async handle(raw, connection) {
      const params = parse(commandInventoryParams, raw);
      const session = params.sessionKey ? requireRead(params.sessionKey, connection) : undefined;
      const ref = session?.ref ?? params.ref;
      const runtimeId = ref?.runtimeId ?? "";
      const capabilities = runtimes.runtime(runtimeId)?.capabilities;
      const reservedHostCommand = (name: string) => ["status", "help", ...(deps.directImage ? ["image"] : [])].includes(name.toLowerCase()) || (name.toLowerCase() === "compact" && capabilities?.compaction === "host");
      const commands: Array<{ name: string; description: string; source: string; argsHint?: string; acceptsArgs?: boolean }> = [];
      const projectId = session?.projectId ?? params.projectId;
      const projectPath = projectId ? deps.projectWorkspace?.(projectId) : undefined;
      const localCommands = localSlashCommands(runtimeId, runtimes.homeDirectory(), projectPath);
      commands.push(...localCommands.filter((entry) => entry.source !== "skill" && !reservedHostCommand(entry.name)).map(({ template: _template, ...entry }) => entry));
      commands.push(...localCommands.filter((entry) => entry.source === "skill" && !reservedHostCommand(entry.name) && !commands.some((command) => command.name.toLowerCase() === entry.name.toLowerCase())).map(({ template: _template, ...entry }) => entry));
      // A custom CLI profile may opt into the host-side `commands --json` inventory convention.
      const runtime = runtimes.runtime(runtimeId);
      if (runtime?.source === "custom" && runtime.entry?.command) {
        const listing = await runtimes.cliRun(runtimeId, ["commands", "--json"]).catch(() => undefined);
        if (listing?.code === 0) {
          try {
            const decoded = JSON.parse(listing.stdout) as unknown;
            const entries = Array.isArray(decoded) ? decoded : decoded && typeof decoded === "object" && Array.isArray((decoded as { commands?: unknown }).commands) ? (decoded as { commands: unknown[] }).commands : [];
            for (const rawEntry of entries) {
              if (!rawEntry || typeof rawEntry !== "object") continue;
              const entry = rawEntry as Record<string, unknown>;
              const name = typeof entry.name === "string" ? entry.name.replace(/^\//, "") : "";
              if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name) || reservedHostCommand(name) || commands.some((command) => command.name === name)) continue;
              const args = Array.isArray(entry.args) ? entry.args.filter((arg): arg is Record<string, unknown> => !!arg && typeof arg === "object") : [];
              const argsHint = typeof entry.argsHint === "string" ? entry.argsHint : args.map((arg) => `${arg.required ? "<" : "["}${typeof arg.name === "string" ? arg.name : "arg"}${arg.required ? ">" : "]"}`).join(" ");
              const listedSource = commandSource(entry.source);
              const source = listedSource === "builtin" || listedSource === "skill" ? runtimeId : listedSource;
              commands.push({ name, description: typeof entry.description === "string" ? entry.description : "", source, ...(argsHint ? { argsHint } : {}), acceptsArgs: entry.acceptsArgs === true || !!argsHint });
            }
          } catch { /* A CLI without the optional JSON listing exposes no additional slash commands. */ }
        }
      }
      commands.push({ name: "status", description: "Show this session's status.", source: "builtin", acceptsArgs: false });
      commands.push({ name: "help", description: "List available commands.", source: "builtin", acceptsArgs: false });
      if (capabilities?.compaction === "host") commands.push({ name: "compact", description: "Summarize this conversation to free context.", source: "builtin", acceptsArgs: false });
      const rank = (source: string) => source === "skill" ? 1 : source === "builtin" ? 2 : 0;
      commands.sort((left, right) => rank(left.source) - rank(right.source));
      return { commands, model: ref?.modelId ?? runtime?.label ?? "model", loaded: true };
    },
  });

  methods.set("jagentchill.chat.abort", {
    scope: "jagentchill.agent.use",
    async handle(raw, connection) {
      const session = requireAct(parse(keyParams, raw).sessionKey, connection);
      // The runtime is asked to stop, but Stop never waits on it for more than a few seconds: a runtime that does not
      // answer must not keep the turn alive. In every case the turn is ended and every device is told, so no screen
      // stays at "Working" or "Stopping".
      const { run } = await stopTurn(session);
      // Stop is for everything the session started: its pictures still being made stop too.
      deps.onStopped?.(session.sessionKey);
      return { aborted: true, ...(run ? { runId: run.runId } : {}) };
    },
  });

  methods.set("jagentchill.chat.history", {
    scope: "jagentchill.projects.read",
    async handle(raw, connection) {
      const params = parse(historyParams, raw);
      const session = requireRead(params.sessionKey, connection);
      // Paged: a device reads the newest page first and older ones as the person scrolls up.
      const history = transcript.page(session.sessionKey, { limit: params.limit, ...(params.maxChars ? { maxChars: params.maxChars } : {}), ...(params.offset !== undefined ? { offset: params.offset } : {}) });
      const messages = history.messages.map(markAuthor);
      const stored = params.offset === undefined || params.offset === 0
        ? db.prepare("SELECT id, run_id, code, message, message_key, action, retryable, raw, ts_ms FROM session_engine_errors WHERE session_key = ? ORDER BY ts_ms ASC LIMIT 100").all(session.sessionKey) as Array<{ id: string; run_id: string | null; code: string; message: string; message_key: string; action: string; retryable: number; raw: string; ts_ms: number }>
        : [];
      const errors = stored.map((entry) => ({ role: "error", id: entry.id, timestamp: entry.ts_ms, content: "", jagentchill: { error: { code: entry.code, message: entry.message, messageKey: entry.message_key, action: entry.action, retryable: entry.retryable === 1, raw: entry.raw, ...(entry.run_id ? { runId: entry.run_id } : {}) } } }));
      return { messages: [...messages, ...errors], ...(typeof history.nextOffset === "number" ? { nextOffset: history.nextOffset } : {}), hasMore: history.hasMore, totalMessages: history.totalMessages + stored.length };
    },
  });

  // What a pane cannot know from the page of messages it has loaded: the session's steps with their true total (Worklog),
  // and where a text stands in the whole conversation (find). Both read the whole transcript on the host (`session-index.ts`).
  const sessionIndex = createSessionIndex({ read: async (key, params) => transcript.page(key, { limit: params.limit, ...(params.offset !== undefined ? { offset: params.offset } : {}), ...(params.maxChars ? { maxChars: params.maxChars } : {}) }) as HistoryPage });
  methods.set("jagentchill.chat.steps", {
    scope: "jagentchill.projects.read",
    async handle(raw, connection) {
      const params = parse(stepsParams, raw);
      const session = requireRead(params.sessionKey, connection);
      const index = await sessionIndex.of(session.sessionKey);
      const end = Math.min(index.steps.length, params.before ?? index.steps.length), from = Math.max(0, end - params.limit);
      return { total: index.steps.length, from, steps: index.steps.slice(from, end), messages: index.total ?? index.raw, paged: index.paged };
    },
  });
  methods.set("jagentchill.chat.search", {
    scope: "jagentchill.projects.read",
    async handle(raw, connection) {
      const params = parse(searchParams, raw);
      const session = requireRead(params.sessionKey, connection);
      const index = await sessionIndex.of(session.sessionKey);
      return { ...searchIndex(index, params.query, params.limit), searched: index.messages.length, messages: index.total ?? index.raw, paged: index.paged };
    },
  });

  methods.set("jagentchill.chat.subscribe", {
    scope: "jagentchill.projects.read",
    async handle(raw, connection) {
      const session = requireRead(parse(keyParams, raw).sessionKey, connection);
      let listeners = subscribers.get(session.sessionKey);
      if (!listeners) subscribers.set(session.sessionKey, (listeners = new Set()));
      listeners.add(connection);
      // The server runs the turns itself: which turn is running is known here, and a pane recovers from it.
      const run = activeRuns.get(session.sessionKey);
      const activeRunIds = run?.runId ? [run.runId] : [];
      // The text of a turn that is running, for a device that joins late or missed an increment.
      const current = liveText.get(session.sessionKey);
      const currentLive = current && current.runId === run?.runId ? current : undefined;
      return { stream: `session:${session.sessionKey}`, ...(currentLive ? { live: currentLive } : {}), activeRunIds };
    },
  });

  methods.set("jagentchill.chat.unsubscribe", {
    scope: "jagentchill.projects.read",
    handle(raw, connection) {
      subscribers.get(parse(keyParams, raw).sessionKey)?.delete(connection);
    },
  });

  // ---- model, thinking, mode and features of a live session ----

  methods.set("jagentchill.session.control.set", {
    scope: RUNTIME_METHOD_SCOPES["jagentchill.session.control.set"],
    async handle(raw, connection) {
      const params = parse(sessionControlSetParams, raw);
      const session = requireAct(params.sessionKey, connection);
      if (!session.ref) throw new ProtocolError("runtime/switch-required", "Choose a model for this session first.");
      const notices: Notice[] = [];
      const resetFeatures: string[] = [];
      const entry = (await runtimes.settled(session.ref.runtimeId))!;
      const runtime = runtimes.runtime(session.ref.runtimeId)!;
      const running = activeRuns.has(session.sessionKey);
      // Everything is validated before anything changes, so a refused request changes nothing.
      let ref = session.ref;
      if (params.ref !== undefined) {
        const target = params.ref ?? (() => {
          const model = entry.models.find((candidate) => candidate.isDefault) ?? entry.models[0];
          return model && { runtimeId: entry.runtimeId, providerId: model.providerId, modelId: model.modelId };
        })();
        if (!target) throw new ProtocolError("runtime/model-unavailable", "This runtime lists no model.");
        if (target.runtimeId !== session.ref.runtimeId) throw new ProtocolError("runtime/switch-required", "Changing the runtime is a runtime switch.", { details: { runtimeId: target.runtimeId } });
        await runtimes.assertSelectable(target, connection.role());
        ref = target;
      }
      const model = entry.models.find((candidate) => candidate.providerId === ref.providerId && candidate.modelId === ref.modelId);
      if (params.modeId !== undefined) {
        const mode = entry.modes.find((candidate) => candidate.id === params.modeId);
        // The unattended mode is granted by an admin through its own method, never selected here.
        if (mode?.isUnattended) throw new ProtocolError("SCOPE_DENIED", "Admin devices only", { details: { requiredScope: "jagentchill.config.write", method: "jagentchill.session.unattended.set" } });
        if (!mode?.supported) throw new ProtocolError("runtime/unsupported-capability", mode?.reason ?? "This runtime cannot run in that mode.", { details: { runtimeId: runtime.id, capability: `productModes.${params.modeId}` } });
        if (params.expected?.modeId !== undefined && params.expected.modeId !== session.modeId) throw new ProtocolError("CONFLICT", "The mode was changed on another device.", { details: { modeId: session.modeId } });
      }
      if (params.thinkingOptionId && !model?.thinkingOptions.some((option) => option.id === params.thinkingOptionId)) {
        throw new ProtocolError("runtime/unsupported-capability", "This model does not offer that thinking option.", { details: { runtimeId: runtime.id, capability: "thinking" } });
      }
      const featureValues = { ...session.featureValues };
      for (const [id, value] of Object.entries(params.features ?? {})) {
        // A product switch of the composer, not of the runtime: pictures of this session are made by the local image
        // model (Qwen-Image-2.1 on the host) instead of the Image role's provider.
        if (id === LOCAL_IMAGE_FEATURE) {
          if (typeof value !== "boolean") throw new ProtocolError("INVALID_PARAMS", "That value is not offered.", { details: { path: `features.${id}` } });
          featureValues[id] = value;
          continue;
        }
        const feature = entry.features.find((candidate) => candidate.id === id);
        const offered = feature && (id !== "fast_mode" || model?.supportsFastMode);
        if (!offered) throw new ProtocolError("runtime/unsupported-capability", `This runtime does not support ${feature?.label ?? id}`, { details: { runtimeId: runtime.id, capability: id } });
        if (feature.type === "select" && value !== null && !feature.options.some((option) => option.id === value)) throw new ProtocolError("INVALID_PARAMS", "That value is not offered.", { details: { path: `features.${id}` } });
        featureValues[id] = value;
      }
      if (ref !== session.ref) {
        // A feature the new model does not offer falls back to its default.
        if (featureValues.fast_mode && featureValues.fast_mode !== "off" && !model?.supportsFastMode) {
          featureValues.fast_mode = "off";
          resetFeatures.push("fast_mode");
        }
        if (running) notices.push({ code: "applies-next-turn", message: "Applies to the next message" });
      }
      let thinking = session.thinkingOptionId;
      if (params.thinkingOptionId !== undefined) thinking = params.thinkingOptionId;
      else if (ref !== session.ref && thinking && !model?.thinkingOptions.some((option) => option.id === thinking)) {
        thinking = null;
        notices.push({ code: "thinking-reset", message: "Thinking reset to the model default" });
      }
      let modeId = session.modeId;
      let pendingModeId: string | null = session.pendingModeId ?? null;
      if (params.modeId !== undefined && !session.unattended) {
        if (running && !runtime.capabilities.liveModeChange) {
          pendingModeId = params.modeId;
          notices.push({ code: "applies-after-turn", message: "Applies after this turn" });
        } else {
          modeId = params.modeId;
          pendingModeId = null;
        }
      }
      // The runtime session takes the new model, thinking and mode when it is opened for the next turn.
      const updated = setColumns(session.sessionKey, {
        runtime_id: ref.runtimeId, provider_id: ref.providerId, model_id: ref.modelId, mode_id: modeId, pending_mode_id: pendingModeId, thinking, features: JSON.stringify(featureValues),
      });
      if (ref !== session.ref) audit(db, deps.now(), `device:${connection.deviceId}`, "session.model.set", { sessionKey: session.sessionKey, ref });
      return { accepted: true, applied: selectionOf(updated), ...(pendingModeId ? { pending: { modeId: pendingModeId } } : {}), notices, resetFeatures };
    },
  });

  methods.set("jagentchill.session.queue.resolve", {
    scope: RUNTIME_METHOD_SCOPES["jagentchill.session.queue.resolve"],
    handle(raw, connection) {
      const params = parse(sessionQueueResolveParams, raw);
      const session = requireAct(params.sessionKey, connection);
      return { ...resolveQueue(session, params.requested, params.expectedRunId), activeRunId: activeRuns.get(session.sessionKey)?.runId ?? null };
    },
  });

  methods.set("jagentchill.session.unattended.set", {
    scope: RUNTIME_METHOD_SCOPES["jagentchill.session.unattended.set"],
    async handle(raw, connection) {
      const params = parse(sessionUnattendedSetParams, raw);
      const session = requireAct(params.sessionKey, connection);
      // Running without asking exists only for a runtime that decides by itself what it runs on the host.
      const runtime = runtimes.runtime(session.ref?.runtimeId ?? "");
      if (!runtime?.requiresFullAccess) throw new ProtocolError("runtime/unsupported-capability", "This runtime asks before it runs anything on the host, so there is nothing to allow.", { details: { runtimeId: runtime?.id ?? null, capability: "unattended" } });
      if (params.enabled && params.confirm !== true) throw new ProtocolError("INVALID_PARAMS", "Running without asking needs an explicit confirmation.", { details: { path: "confirm" } });
      audit(db, deps.now(), `device:${connection.deviceId}`, "session.unattended.set", { sessionKey: session.sessionKey, enabled: params.enabled, runtimeId: session.ref?.runtimeId ?? null });
      return { session: setColumns(session.sessionKey, { unattended: params.enabled ? 1 : 0 }) };
    },
  });

  methods.set("jagentchill.session.handover.get", {
    scope: RUNTIME_METHOD_SCOPES["jagentchill.session.handover.get"],
    handle(raw, connection) {
      const session = requireRead(parse(sessionKeyParams, raw).sessionKey, connection);
      const rows = db.prepare("SELECT * FROM runtime_handover WHERE session_key = ? ORDER BY id DESC LIMIT 20").all(session.sessionKey) as Array<Record<string, string | number | null>>;
      return {
        handovers: rows.map((row) => ({
          fromRef: JSON.parse(row.from_ref as string), toRef: JSON.parse(row.to_ref as string), text: row.text, itemCount: row.item_count, omittedCount: row.omitted_count,
          created_ms: row.created_ms, status: row.status, ...(row.delivered_ms ? { delivered_ms: row.delivered_ms } : {}),
        })),
      };
    },
  });

  methods.set("jagentchill.session.runtime.switch", {
    scope: RUNTIME_METHOD_SCOPES["jagentchill.session.runtime.switch"],
    async handle(raw, connection) {
      const params = parse(sessionRuntimeSwitchParams, raw);
      const session = requireAct(params.sessionKey, connection);
      // A repeated request with the same key answers what the first one did.
      const repeat = db.prepare("SELECT result FROM session_switches WHERE session_key = ? AND idempotency_key = ?").get(session.sessionKey, params.idempotencyKey) as { result: string } | undefined;
      if (repeat) return JSON.parse(repeat.result);
      // 1. Readiness, policy and capabilities of the target, before anything changes.
      const target = await runtimes.assertSelectable(params.ref, connection.role());
      const from = session.ref;
      const recent = db.prepare("SELECT ts_ms FROM session_switches WHERE session_key = ? AND ts_ms > ? ORDER BY ts_ms").all(session.sessionKey, deps.now() - 3_600_000) as Array<{ ts_ms: number }>;
      if (recent.length >= RUNTIME_LIMITS.switchesPerHour) throw new ProtocolError("RATE_LIMITED", "Too many runtime switches in the last hour.", { retryable: true, details: { retryAfter_ms: recent[0].ts_ms + 3_600_000 - deps.now() } });
      let unattended = false;
      if (target.runtime.requiresFullAccess) {
        if (connection.role() !== "admin" || !params.confirmFullAccess) {
          throw new ProtocolError(connection.role() === "admin" ? "runtime/unattended-not-granted" : "SCOPE_DENIED", `${target.runtime.label} runs commands and changes files on the host without asking. An admin device must confirm that.`, { details: { runtimeId: target.runtime.id, requires: "confirmFullAccess" } });
        }
        unattended = true;
      }
      // The product mode is kept when the target supports it; a switch never makes a session more permissive unasked.
      const notices: Notice[] = [];
      let modeId = session.modeId as ProductMode;
      if (!unattended && !target.entry.modes.find((mode) => mode.id === modeId)?.supported) {
        const order = PRODUCT_MODES as readonly string[];
        const lower = [...order].slice(0, order.indexOf(modeId)).reverse().find((id) => target.entry.modes.find((mode) => mode.id === id)?.supported);
        if (lower) modeId = lower as ProductMode;
        else if (params.acceptModeChange && target.entry.modes.find((mode) => mode.id === params.acceptModeChange && mode.supported && !mode.isUnattended)) modeId = params.acceptModeChange as ProductMode;
        else {
          const offer = target.entry.modes.find((mode) => mode.supported && !mode.isUnattended);
          throw new ProtocolError("runtime/unsupported-capability", `This runtime cannot run in ${modeId[0].toUpperCase()}${modeId.slice(1)} mode`, { details: { runtimeId: target.runtime.id, capability: `productModes.${modeId}`, ...(offer ? { acceptModeChange: offer.id } : {}) } });
        }
        notices.push({ code: "mode-reset", message: `Mode reset to ${modeId[0].toUpperCase()}${modeId.slice(1)}` });
      }
      const sameRuntime = from?.runtimeId === params.ref.runtimeId;
      const respond = (result: Record<string, unknown>) => {
        db.prepare("INSERT INTO session_switches (session_key, ts_ms, idempotency_key, result) VALUES (?, ?, ?, ?)").run(session.sessionKey, deps.now(), params.idempotencyKey, JSON.stringify(result));
        return result;
      };
      // 2. The same runtime: a plain model change that keeps the runtime's own conversation (it resumes on the new model).
      if (sameRuntime) {
        const kept = session.thinkingOptionId && target.model.thinkingOptions.some((option) => option.id === session.thinkingOptionId) ? session.thinkingOptionId : null;
        const updated = setColumns(session.sessionKey, { provider_id: params.ref.providerId, model_id: params.ref.modelId, thinking: kept });
        audit(db, deps.now(), `device:${connection.deviceId}`, "session.model.set", { sessionKey: session.sessionKey, ref: params.ref });
        return respond({ session: updated, applied: selectionOf(updated), switched: "model", notices });
      }
      // 3. A running turn is stopped first.
      if (activeRuns.has(session.sessionKey)) {
        await stopTurn(session);
        toSubscribers(session, "jagentchill.chat.notice", { sessionKey: session.sessionKey, code: "turn-stopped", message: "Turn stopped — runtime switched" });
      }
      // 4. The conversation so far, stored before anything changes: the new runtime starts from a summary of it.
      let handover: { itemCount: number; omittedCount: number } | undefined;
      db.prepare("UPDATE runtime_handover SET status = 'superseded' WHERE session_key = ? AND status = 'staged'").run(session.sessionKey);
      const built = buildHandover({ title: session.title ?? "Session", from: from ?? params.ref, created_ms: session.created_ms, messages: transcript.recent(session.sessionKey, 500) });
      if (built.itemCount) {
        db.prepare("INSERT INTO runtime_handover (session_key, from_ref, to_ref, text, item_count, omitted_count, created_ms, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'staged')")
          .run(session.sessionKey, JSON.stringify(from ?? params.ref), JSON.stringify(params.ref), built.text, built.itemCount, built.omittedCount, deps.now());
        handover = { itemCount: built.itemCount, omittedCount: built.omittedCount };
      }
      notices.push({ code: "summary-context", message: "The new runtime starts from a summary, not the full transcript" });
      // 5. The old runtime's session ends; the new runtime's starts with the next turn.
      await dropLive(session.sessionKey);
      saveHandle(session.sessionKey, undefined);
      // 6. Thinking, features and the unattended grant start from the target's defaults.
      if (session.thinkingOptionId) notices.push({ code: "thinking-reset", message: "Thinking reset to the model default" });
      if (Object.keys(session.featureValues).length) notices.push({ code: "features-reset", message: "Features reset" });
      if (session.unattended && !unattended) notices.push({ code: "unattended-off", message: "Unattended turned off" });
      notices.push({ code: "no-rewind", message: `Earlier turns cannot be rewound or re-run on ${target.runtime.label}` });
      const updated = setColumns(session.sessionKey, {
        runtime_id: params.ref.runtimeId, provider_id: params.ref.providerId, model_id: params.ref.modelId, mode_id: modeId, pending_mode_id: null, thinking: null, features: "{}",
        unattended: unattended ? 1 : 0,
      });
      audit(db, deps.now(), `device:${connection.deviceId}`, "session.runtime.switch", { sessionKey: session.sessionKey, from: from ?? null, to: params.ref, rehomed: false });
      if (unattended) audit(db, deps.now(), `device:${connection.deviceId}`, "session.unattended.set", { sessionKey: session.sessionKey, enabled: true, runtimeId: params.ref.runtimeId, reason: "runtime-requires-full-access" });
      const fromLabel = from ? `${runtimes.runtime(from.runtimeId)?.label ?? from.runtimeId} · ${from.modelId}` : "no model";
      toSubscribers(updated, "jagentchill.chat.notice", { sessionKey: session.sessionKey, code: "runtime-switched", message: `Switched from ${fromLabel} to ${target.runtime.label} · ${params.ref.modelId}`, ts_ms: deps.now() });
      return respond({ session: updated, applied: selectionOf(updated), switched: "runtime", rehomed: false, ...(handover ? { handover } : {}), notices });
    },
  });

  return {
    methods,
    /** The session's current selection for a caller that can read it. */
    selectionFor(key: string, connection: Connection): SessionSelection | undefined {
      const session = find(key);
      return session && canRead(session, connection.deviceId, connection.role()) ? selectionOf(session) : undefined;
    },
    canRead(key: string, connection: Connection): boolean {
      const session = find(key);
      return !!session && canRead(session, connection.deviceId, connection.role());
    },
    canAct(key: string, connection: Connection): boolean {
      try {
        requireAct(key, connection);
        return true;
      } catch {
        return false;
      }
    },
    /** The record of a session. */
    session(key: string): SessionRecord | undefined {
      return find(key);
    },
    /** Whether a turn of the session is running. */
    isRunning: (key: string): boolean => activeRuns.has(key),
    /** The newest messages of a session's transcript, oldest first. */
    history: (key: string, limit = 100): TranscriptMessage[] => transcript.recent(key, limit),
    /** The folder a session's agent works in (where it makes files the tools may import). */
    workdir(key: string): string | undefined { const session = find(key); return session && deps.workdir(session); },
    checkQuietTurns,
    /** Stops the relay's own timer and every runtime session: nothing of it runs after the server closed its store. */
    async close(): Promise<void> {
      clearInterval(quietTimer);
      await Promise.all([...live.keys()].map((key) => dropLive(key)));
    },
    /** The person's answer to a runtime's own question goes back to the runtime; `null` skips it and the runtime goes on. */
    async resolveRuntimeQuestion(questionId: string, answers: Record<string, string[]> | null): Promise<void> {
      const question = runtimeQuestions.get(questionId);
      runtimeQuestions.delete(questionId);
      if (!question) return;
      if (!answers) return answer(question.live, question.permissionId, false, { message: "The person skipped this question; go on without an answer." });
      if (question.codex) return answer(question.live, question.permissionId, true, { updatedInput: Object.fromEntries(Object.entries(answers).map(([id, values]) => [id, { answers: values }])) });
      // Claude Code's `AskUserQuestion` takes the answers beside its questions, by the text of each question.
      const byText = Object.fromEntries(question.questions.map((entry) => [entry.question, (answers[entry.questionId] ?? []).join(", ")]));
      return answer(question.live, question.permissionId, true, { updatedInput: { ...(question.input as object ?? {}), answers: byText } });
    },
    /** Binds a session to a project (an agent created one); the devices that follow the session learn it. */
    bindProject(key: string, projectId: string | null): SessionRecord {
      audit(db, deps.now(), "server", "session.project.set", { sessionKey: key, projectId });
      return setColumns(key, { project_id: projectId });
    },
    /** A data-only message of the server to a session's agent: it opens a turn, or waits for the running one to end. */
    async deliver(key: string, message: string, options: { /** The editor's own word to the agent (a decision, an outcome): devices show it as a status line, never as a person's message. */ hostNote?: boolean; /** What the turn is the consequence of, for the waiting line of the devices: the person's answer to a question, their decision on a card, or anything else of the host. */ reason?: "answer" | "decision" | "host" } = {}): Promise<boolean> {
      const session = find(key);
      if (!session?.ref) return false;
      const idempotencyKey = randomUUID();
      // The devices that follow the session are told at once that a turn is on its way: the runtime's first event of it
      // comes after it prepared the turn (a second or two), and until then the chat would show nothing.
      const starts = !activeRuns.has(key);
      if (starts) toSubscribers(session, "jagentchill.chat.turn.pending", { sessionKey: key, reason: options.reason ?? "host", ts_ms: deps.now() });
      // Recorded BEFORE it is sent: the message can be read back from the transcript the moment it is written.
      if (options.hostNote) db.prepare("INSERT INTO host_messages (idempotency_key, session_key, ts_ms) VALUES (?, ?, ?)").run(idempotencyKey, key, deps.now());
      // The conversation carried over a runtime switch leads the first message on the new runtime, whoever sends it.
      const handover = starts ? stagedHandover(key) : undefined;
      const item: Queued = { message: handover ? `${handover.text}\n\n${message}` : message, userText: message, deviceId: session.ownerDeviceId, idempotencyKey, ...(options.hostNote ? { hostNote: true } : {}), ...(handover ? { handoverId: handover.id } : {}) };
      if (!starts) { (queued.get(key) ?? queued.set(key, []).get(key)!).push(item); return true; }
      try {
        await startTurn(session, item);
        return true;
      } catch {
        // No turn comes after all: the waiting line goes.
        toSubscribers(session, "jagentchill.chat.turn.pending", { sessionKey: key, cancelled: true, ts_ms: deps.now() });
        return false;
      }
    },
    /**
     * A session another session's agent creates for a sub-agent: the parent's owner device, access and (unless named)
     * project; the model is the one named, else the first usable target of the ORC role, else the parent's own. It is
     * never more permissive than its parent: a runtime that needs full access is refused unless the parent has it.
     */
    async spawn(parentKey: string, input: { title: string; ref?: ModelRef; role?: string; modeId?: ProductMode; projectId?: string | null; /** The agent entry the session belongs to (a team's members have their own); the parent's otherwise. */ agentId?: string; /** false: the session is created for an agent that was not granted unattended use, whatever its parent has. */ unattendedCeiling?: boolean }): Promise<SessionRecord> {
      const parent = find(parentKey);
      if (!parent) throw new ProtocolError("NOT_FOUND", "No such session.");
      const role = deps.devices.get(parent.ownerDeviceId)?.role;
      let ref = input.ref, thinking: string | null = null;
      if (!ref && input.role) {
        for (const candidate of deps.orc.resolve(input.role, "default", { projectId: input.projectId ?? parent.projectId }).candidates) {
          try { await runtimes.assertSelectable(candidate.ref, role); ref = candidate.ref; thinking = candidate.thinking ?? null; break; } catch { /* the next target of the route */ }
        }
      }
      if (!ref) { ref = parent.ref; thinking = parent.thinkingOptionId; }
      if (!ref) throw new ProtocolError("NO_ROUTE", "Choose a model", { details: { reason: "no-model-chosen" } });
      const chosen = await runtimes.assertSelectable(ref, role);
      const modeId = input.modeId ?? (parent.modeId as ProductMode);
      const unattended = chosen.runtime.requiresFullAccess === true;
      if (unattended && (!parent.unattended || input.unattendedCeiling === false)) throw new ProtocolError("runtime/unattended-not-granted", `${chosen.runtime.label} runs commands on the host without asking; a sub-agent can use it only when its parent session was granted that.`, { details: { runtimeId: chosen.runtime.id } });
      if (!unattended && !chosen.entry.modes.find((mode) => mode.id === modeId)?.supported) throw new ProtocolError("runtime/unsupported-capability", `${chosen.runtime.label} cannot run in this mode.`, { details: { runtimeId: chosen.runtime.id, capability: `productModes.${modeId}` } });
      if (thinking && !chosen.model.thinkingOptions.some((option) => option.id === thinking)) thinking = null;
      const agentId = input.agentId ?? parent.agentId;
      const key = `agent:${agentId}:jc:${randomUUID()}`, projectId = input.projectId === undefined ? parent.projectId ?? null : input.projectId;
      db.prepare(
        `INSERT INTO agent_sessions (session_key, gateway_key, agent_id, owner_device_id, agent_class, access, project_id, origin, title, title_source, runtime_id, provider_id, model_id, mode_id, thinking, unattended, parent_session_key, created_ms)
         VALUES (?, ?, ?, ?, 'creative', ?, ?, 'agent', ?, 'user', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(key, key, agentId, parent.ownerDeviceId, parent.access, projectId, input.title, ref.runtimeId, ref.providerId, ref.modelId, modeId, thinking, unattended ? 1 : 0, parent.sessionKey, deps.now());
      return find(key)!;
    },
    /** The mode of a sub-agent's session, set by the agent that owns it: at once, or before its next turn while one runs on a runtime that cannot change live. */
    async setMode(key: string, modeId: ProductMode): Promise<"now" | "next_turn"> {
      const session = find(key);
      if (!session?.ref) throw new ProtocolError("NOT_FOUND", "No such session.");
      const entry = await runtimes.assertSelectable(session.ref, deps.devices.get(session.ownerDeviceId)?.role);
      if (!entry.entry.modes.find((mode) => mode.id === modeId)?.supported) throw new ProtocolError("runtime/unsupported-capability", `${entry.runtime.label} cannot run in this mode.`, { details: { runtimeId: entry.runtime.id, capability: `productModes.${modeId}` } });
      if (activeRuns.has(key) && !entry.runtime.capabilities.liveModeChange) { setColumns(key, { pending_mode_id: modeId }); return "next_turn"; }
      applyMode(session, modeId);
      return "now";
    },
    /** The profiles of an ORC role a session could run on right now, in the order of the role's route. */
    routeOf(key: string, role: string): { profileId: string; ref: ModelRef; thinking?: string }[] {
      const session = find(key);
      return deps.orc.resolve(role, "default", { projectId: session?.projectId ?? undefined }).candidates.map((candidate) => ({ profileId: candidate.profileId, ref: candidate.ref, ...(candidate.thinking ? { thinking: candidate.thinking } : {}) }));
    },
    /** Moves a sub-agent's session to another model of the same runtime (a profile of its ORC role). */
    async retarget(key: string, target: { ref: ModelRef; thinking?: string }): Promise<SessionRecord> {
      const session = find(key);
      if (!session?.ref) throw new ProtocolError("NOT_FOUND", "No such session.");
      const chosen = await runtimes.assertSelectable(target.ref, deps.devices.get(session.ownerDeviceId)?.role);
      const thinking = target.thinking && chosen.model.thinkingOptions.some((option) => option.id === target.thinking) ? target.thinking : null;
      if (session.ref.runtimeId !== target.ref.runtimeId) { await dropLive(key); saveHandle(key, undefined); }
      return setColumns(key, { runtime_id: target.ref.runtimeId, provider_id: target.ref.providerId, model_id: target.ref.modelId, thinking });
    },
    /** The name of a sub-agent's session follows the name its owner gives the agent. */
    retitle(key: string, title: string): SessionRecord {
      return setColumns(key, { title, title_source: "user" });
    },
    /** A sub-agent a person took out of its tree: a session of its own in that person's list from here on. */
    detachSession(key: string, deviceId: string): SessionRecord {
      audit(db, deps.now(), `device:${deviceId}`, "session.detach", { sessionKey: key });
      return setColumns(key, { origin: "device", parent_session_key: null, owner_device_id: deviceId });
    },
    /** Stops the running turn of a session (the agent tools reached a per-turn limit, or another agent stops it). */
    async abort(key: string): Promise<boolean> {
      const session = find(key);
      if (!session || !activeRuns.has(key)) return true;
      await stopTurn(session);
      return true;
    },
    /** Stops every running turn (the server is stopping), within a bound. */
    async stopAll(limit_ms = 2000): Promise<void> {
      const running = [...activeRuns.keys()].map((key) => find(key)).filter((session): session is SessionRecord => !!session);
      await Promise.race([Promise.all(running.map((session) => stopTurn(session).catch(() => undefined))), new Promise<void>((resolve) => setTimeout(resolve, limit_ms).unref())]);
    },
    /** Sends an event to the connections subscribed to a session's chat that may read it. */
    notify(key: string, event: string, payload: unknown): void {
      const session = find(key);
      if (session) toSubscribers(session, event, payload);
    },
    /** Removes a closed connection from every fan-out set. */
    dropConnection(connection: Connection): void {
      sessionWatchers.delete(connection);
      for (const listeners of subscribers.values()) listeners.delete(connection);
    },
    /** A revoked owner's sessions become orphaned; an admin can take them over. */
    orphanSessionsOf(deviceId: string): void {
      db.prepare("UPDATE agent_sessions SET owner_state = 'orphaned' WHERE owner_device_id = ?").run(deviceId);
    },
    /** Compacts a session's context on its runtime (`/compact`); resolves when that turn has ended. */
    async compact(key: string): Promise<{ compacted: boolean; reason?: string }> {
      const session = find(key);
      if (!session?.ref) return { compacted: false, reason: "no-session" };
      if (activeRuns.has(key)) return { compacted: false, reason: "running" };
      const runId = await startTurn(session, { message: "/compact", deviceId: session.ownerDeviceId, idempotencyKey: randomUUID(), command: true, hidden: true });
      const ended = activeRuns.get(key)?.runId === runId ? await new Promise<"final" | "error" | "aborted">((resolve) => turnWaiters.set(runId, resolve)) : "final";
      return { compacted: ended === "final" };
    },
    /** The run id the runtime gave the running turn. */
    runIdOf: (key: string): string | undefined => activeRuns.get(key)?.runId,
  };
}

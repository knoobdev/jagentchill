import { z } from "zod";
import { DocumentRejected, formatTimecode, timeline, type Commit, type CommitContext } from "@jagentchill/editor-core";
import { ELEMENT_SHAPES, fieldSchema, numberRange, RETRYABLE_TOOL_CODES, TOOL_ARRAY_MAX, TOOL_LIST_DEFAULT_LIMIT, TOOL_LIST_MAX_LIMIT, TOOL_RESULT_MAX_BYTES, type ErrorCode, type ProjectDocument, type ProposalChange, type Question, type Rational, type ToolEnvelope, type ToolError, type ToolFamily } from "@jagentchill/protocol";
import type { SessionRecord } from "../agents/sessions.ts";
import type { WorkflowDocuments } from "../workflows/documents.ts";

type Sc = timeline.Sc;
type Tr = timeline.Tr;
type El = timeline.El;

/** A tool failure in the error envelope of `agent-editing-tools.Error codes`. The message is written for the model. */
export class ToolFailure extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ToolFailure";
    this.code = code;
    this.details = details;
  }
  envelope(): ToolError { return { code: this.code, message: this.message, retryable: RETRYABLE_TOOL_CODES.includes(this.code), ...(this.details ? { details: this.details } : {}) }; }
}
export const fail = (code: ErrorCode, message: string, details?: Record<string, unknown>): never => { throw new ToolFailure(code, message, details); };
/** The one rule for a value outside its range: rejected with the range, never clamped. */
export const outOfRange = (field: string, min: number, max: number, value: unknown, note = ""): never =>
  fail("OUT_OF_RANGE", `${field} must be between ${min} and ${max}${note ? ` (${note})` : ""}; got ${typeof value === "number" ? value : JSON.stringify(value)}. Send a value inside the range.`, { field, min, max, value });
export function checkRange(field: string, value: number | undefined, min: number, max: number, note?: string): void {
  if (value !== undefined && (value < min || value > max)) outOfRange(field, min, max, value, note);
}

// — Parameter schemas —
const TICKS = new WeakSet<z.ZodTypeAny>();
/** A time or duration in ticks: a non-negative integer. A fractional or negative value is `INVALID_PARAMS`, not a range error. */
export const ticks = (): z.ZodNumber => { const schema = z.number().int().nonnegative(); TICKS.add(schema); return schema; };
/** A signed tick delta. */
export const tickDelta = (): z.ZodNumber => { const schema = z.number().int(); TICKS.add(schema); return schema; };
export const id = () => z.string().min(1).max(64);
export const ids = (max = TOOL_ARRAY_MAX) => z.array(id()).min(1).max(max);
export const color = () => z.string().regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "a colour is #RRGGBB or #RRGGBBAA");
export const range = () => z.object({ start: ticks(), end: ticks() }).strict();
export const editContext = () => z.object({ magnet: z.boolean().optional(), ripple: z.boolean().optional(), linkage: z.boolean().optional(), freeLayer: z.boolean().optional() }).strict();
/** The parameters every staged write accepts. */
export const WRITE = { idempotencyKey: z.string().min(16).max(64), dryRun: z.boolean().optional(), editContext: editContext().optional() };
export const PAGE = { limit: z.number().int().min(1).max(TOOL_LIST_MAX_LIMIT).optional(), cursor: z.string().max(64).optional() };
export const SCENE = { sceneId: id().optional() };
export const PROJECT = { projectId: id().optional() };

type Shape = z.ZodRawShape;
export type ToolArgs<S extends Shape> = z.infer<z.ZodObject<S, "strict">>;

/** The state a tool call works on. Write tools change `doc` only through `run` and `apply`, which use editor-core commands. */
export type ToolContext = {
  session: SessionRecord;
  now: number;
  projectId: string;
  /** The document the call sees: the host replica, with the session's open proposal applied for write tools. */
  doc: ProjectDocument;
  /** The latest synced revision of the host replica. */
  revision: number;
  committed: ProjectDocument;
  edit: timeline.EditContext;
  warnings: string[];
  dryRun: boolean;
  /** Availability known to the host; a missing host blob can still be device-local and playable. */
  mediaAvailability(assetId: string): "ready" | "device-local-or-unknown" | "unavailable";
  mediaDeviceIssues(assetId: string): { deviceId: string; deviceName: string; state: string; reason?: string }[];
  /** Executes one editor command on `doc` with the call's edit context and adopts the result. */
  run<I>(command: timeline.TimelineCommand<I>): I;
  /** Adopts the commit of an editor-core operation of another command family. */
  apply(change: (doc: ProjectDocument, ctx: CommitContext) => Commit): void;
  commitContext(): CommitContext;
  scene(sceneId?: string): Sc;
  /** The scene a session's tools default to. */
  activeSceneId(): string;
  /**
   * An effect that needs a person's permission: passes in Auto mode, after "Always allow for this session", or when this
   * very call was allowed; otherwise the person is asked and the call fails with `APPROVAL_PENDING` (`requests.ts permit`).
   */
  permit: ((ask: { toolLabel: string; detail: string; projectId?: string; /** A paid generation call: its facts, for a screen to word in its own language. */ money?: import("@jagentchill/protocol").PermissionMoney }) => void) & {
    /**
     * Set on a generation call of a tainted session whose prompt copies 200 or more characters of untrusted content in
     * a row: the person is shown the full prompt before any provider call, so the tool asks even when the amount alone
     * would not need a question (the card of the money question is that same card: the full prompt is put into it).
     */
    always?: boolean;
  };
  host: ToolHost;
};
/** What tools reach outside the document through. */
export type ToolHost = {
  listProjects(query: { search?: string; cursor?: number; limit: number }): { items: { id: string; name: string; duration: number; updated_ms: number; head: number }[]; nextCursor: number | null };
  projectDocument(projectId: string): { doc: ProjectDocument; revision: number } | undefined;
  mediaDeviceIssues(projectId: string, assetId: string): { deviceId: string; deviceName: string; state: string; reason?: string }[];
  leaseHolder(projectId: string): { kind: "device" | "host"; name: string; deviceId?: string } | null;
  createProject(session: SessionRecord, doc: ProjectDocument, bind: boolean): { projectId: string; revision: number };
  setActiveScene(session: SessionRecord, projectId: string, sceneId: string): boolean;
  editorContext(session: SessionRecord, projectId: string): Record<string, unknown> | undefined;
  focusEditor(session: SessionRecord, projectId: string, focus: Record<string, unknown>): boolean;
  renderFrames(session: SessionRecord, projectId: string, request: { sceneId: string; times: number[]; width: number; overlays: string[]; layout: string; patches?: unknown[]; baseRevision: number }): Promise<{ frames: { index: number; mime: string; dataBase64: string; width: number; height: number; time: number }[]; failed: number[]; renderer?: "client" | "host"; /** Assets drawn as a placeholder: not on the device. */ missingAssetIds?: string[]; /** Why failed frames were not drawn. */ reason?: string } | null>;
  proposalPatches(session: SessionRecord): { baseRevision: number; patches: unknown[] } | undefined;
  /** Counts rendered images against the session's 30 a minute and says what is left; throws `RATE_LIMITED` beyond (once: the refusal says when to come back). */
  frameBudget(session: SessionRecord, count: number): { limit: number; remaining: number; resetIn_ms: number };
  /** Frames a session already rendered, by what was asked: read with one argument, stored with two. */
  frameCache(session: SessionRecord, key: string, value?: { data: Record<string, unknown>; images: { mime: string; dataBase64: string }[] }): { data: Record<string, unknown>; images: { mime: string; dataBase64: string }[] } | undefined;
  proposals: ProposalTools;
  /** Puts questions to the person in the chat and holds the call for the answer. */
  ask(session: SessionRecord, questions: Question[]): Promise<{ data: Record<string, unknown>; warnings: string[] }>;
  /** Moves a synced project to the host trash; refused while a device is editing it. */
  trashProject(session: SessionRecord, projectId: string): void;
  /** A project of the host trash by id, when there is one. */
  trashedProject(projectId: string): { name: string } | undefined;
  restoreProject(session: SessionRecord, projectId: string): { revision: number };
  /** Brings a file into the project's library from a public https URL or from a blob a device uploaded to the host. */
  importMedia(session: SessionRecord, projectId: string, source: { kind: "url"; url: string } | { kind: "upload"; blobId: string } | { kind: "workspace"; path: string }, fields: { name?: string; folderId?: string; tags?: string[]; provenance?: Record<string, unknown> }, check: (url: URL) => void): Promise<Record<string, unknown>>;
  /** Motion scenes live in the calling session's work folder (`motion-scenes/<name>.html`), where its agent CLI works. */
  saveMotionScene(input: { session: SessionRecord; name: string; html: string; width: number; height: number; durationSeconds: number; fps: number }): { sourcePath: string; sha256: string };
  renderMotionScene(input: { session: SessionRecord; name: string; html?: string; width: number; height: number; durationSeconds: number; fps: number }): Promise<{ sourcePath: string; outputPath: string; frameCount: number; bytes: number; width: number; height: number; durationSeconds: number; fps: number }>;
  stageMotionClip(input: { session: SessionRecord; projectId: string; assetId: string; sceneId: string; start: number; trackId?: string }): Promise<{ proposalId?: string; changeIds?: string[]; elementIds?: string[] }>;
  /** Media generation, where the host has the service: whether a capability can run now, and one job from request to stored result (asks for approval through `permit` above the spending thresholds). */
  generation?: {
    available(capability: string): boolean;
    /** `background`: answers with the created job at once instead of its result (pictures made on the host take minutes). */
    run(session: SessionRecord, projectId: string, request: { capability: string; params: Record<string, unknown>; provider?: string; model?: string; reuse?: boolean; background?: boolean }, permit: ToolContext["permit"]): Promise<Record<string, unknown>>;
    /** The finished job (its results stored on the host). */
    settled?(jobId: string): Promise<Record<string, unknown>>;
    /** Tells a session something, as a status message of the editor (it opens the agent's next turn). */
    tell?(sessionKey: string, message: string): void;
    /** One job as it stands now (state, progress), or undefined when there is none. */
    job?(jobId: string): Record<string, unknown> | undefined;
    /** The jobs of a session that have not ended. */
    sessionJobs?(sessionKey: string): Record<string, unknown>[];
    /**
     * With the composer's "make pictures on this computer" switch on, the picture is made from the person's own words, not
     * from the agent's rewrite of them: their latest message, and for a change of a picture made before (same seed) the
     * words of that picture first.
     */
    userWords?(sessionKey: string, change: boolean): string | undefined;
    /** Stops a generation that has not ended. */
    cancel?(jobId: string): Record<string, unknown>;
  };
  /** The host's workflow documents, for the `jc_workflow_*` tools. */
  workflows?: WorkflowDocuments;
  /** Runs an agent starts from a template and follows (`jc_workflow_start`, `_status`, `_cancel`). */
  workflowRuns?: import("../workflows/agent-runs.ts").WorkflowRunPort;
  /** The host's film documents, for the `jc_film_*` tools. */
  films?: {
    read(filmId: string): import("@jagentchill/editor-core").film.Film;
    edit(filmId: string, ops: readonly import("@jagentchill/editor-core").film.FilmOp[]): import("@jagentchill/editor-core").film.Film;
    reorderClips(filmId: string, orderedIds: readonly string[]): import("@jagentchill/editor-core").film.Film;
  };
  /** Sub-agents and teams (`../agents/team/service.ts`), where the host runs them; without it the `jc_agent_*` tools are not served. */
  agents?: import("../agents/team/service.ts").AgentTools;
  /** Writes a text file into the managed workspace directory of a project and returns its reference. */
  writeProjectFile(projectId: string, folder: string, fileName: string, text: string): { path: string; name: string; bytes: number; sha256: string };
};
export type ProposalTools = {
  begin(session: SessionRecord, projectId: string, title?: string, summary?: string): Record<string, unknown>;
  submit(session: SessionRecord, title: string, summary: string): Promise<Record<string, unknown>>;
  status(session: SessionRecord): Record<string, unknown>;
  discard(session: SessionRecord): Record<string, unknown>;
  revert(session: SessionRecord, changeIds: string[] | undefined, proposalId: string | undefined, force: boolean): Promise<Record<string, unknown>>;
};

export type WriteOutcome = {
  data?: Record<string, unknown>;
  /** At most 200 characters, in plain language. */
  summary: string;
  change: Pick<ProposalChange, "kind" | "entity" | "entityId" | "label">;
};
export type ToolDefinition<S extends Shape = Shape> = {
  name: string;
  family: ToolFamily;
  description: string;
  shape: S;
  readOnly: boolean;
  needsProject: boolean;
  /** A read-only tool whose answer depends on state its arguments do not name. */
  readsAmbientState?: boolean;
  /** `staged`: a write recorded in the session's proposal. `direct`: a non-staged effect (a new project, the active scene, the proposal itself). */
  kind: "read" | "staged" | "direct";
  /** A staged tool's call that changes no project data (the active scene) runs as a non-staged effect. */
  unstaged?: (args: ToolArgs<S>) => boolean;
  /** A further check of the parsed arguments, before anything is looked up. */
  refine?: (args: ToolArgs<S>) => void;
  /** A tool that exists only while the host has what it needs (a connected generation provider): absent from the catalogue otherwise. */
  available?: (host: ToolHost) => boolean;
  handle(ctx: ToolContext, args: ToolArgs<S>): unknown | Promise<unknown>;
};
export const defineTool = <S extends Shape>(definition: ToolDefinition<S>): ToolDefinition => definition as unknown as ToolDefinition;
type Meta<S extends Shape> = { name: string; family: ToolFamily; description: string; shape: S; refine?: (args: ToolArgs<S>) => void };
/** A read-only tool of a project. */
export const readTool = <S extends Shape>(meta: Meta<S> & { needsProject?: boolean; handle: (ctx: ToolContext, args: ToolArgs<S>) => unknown | Promise<unknown> }): ToolDefinition =>
  defineTool({ ...meta, readOnly: true, needsProject: meta.needsProject ?? true, readsAmbientState: true, kind: "read" });
/** A staged write: the handler changes `ctx.doc` through editor commands and describes the change. */
export const writeTool = <S extends Shape>(meta: Meta<S> & { handle: (ctx: ToolContext, args: ToolArgs<S>) => WriteOutcome }): ToolDefinition =>
  defineTool({ ...meta, readOnly: false, needsProject: true, kind: "staged" });

// — Zod issues → the error envelope —
function schemaAt(schema: z.ZodTypeAny, path: (string | number)[]): z.ZodTypeAny | undefined {
  let current: z.ZodTypeAny | undefined = schema;
  for (const segment of path) {
    current = unwrapAll(current);
    if (!current) return undefined;
    const def = current._def as { typeName: string; type?: z.ZodTypeAny; shape?: () => Shape; options?: z.ZodTypeAny[]; valueType?: z.ZodTypeAny };
    if (def.typeName === "ZodObject") current = (current as z.ZodObject<Shape>).shape[String(segment)];
    else if (def.typeName === "ZodArray") current = def.type;
    else if (def.typeName === "ZodRecord") current = def.valueType;
    else if (def.typeName === "ZodUnion") current = (def.options ?? []).map((option) => schemaAt(option, [segment])).find((found) => found !== undefined);
    else return undefined;
  }
  return current ? unwrapAll(current) : undefined;
}
function unwrapAll(schema: z.ZodTypeAny | undefined): z.ZodTypeAny | undefined {
  let current = schema;
  for (;;) {
    const def = current?._def as { typeName?: string; innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny } | undefined;
    if (!current || !def) return current;
    if (def.typeName === "ZodOptional" || def.typeName === "ZodNullable" || def.typeName === "ZodDefault") current = def.innerType;
    else if (def.typeName === "ZodEffects") current = def.schema;
    else return current;
  }
}
const bounds = (schema: z.ZodTypeAny | undefined): { min?: number; max?: number } => {
  const def = schema?._def as { typeName?: string; checks?: { kind: string; value?: number }[]; minLength?: { value: number } | null; maxLength?: { value: number } | null } | undefined;
  if (def?.typeName === "ZodArray") return { min: def.minLength?.value ?? 0, max: def.maxLength?.value };
  const checks = def?.checks ?? [];
  return { min: checks.find((check) => check.kind === "min")?.value, max: checks.find((check) => check.kind === "max")?.value };
};
const valueAt = (value: unknown, path: (string | number)[]): unknown => path.reduce<unknown>((at, key) => (at as Record<string, unknown> | undefined)?.[key as string], value);

/** Turns the first schema finding into the failure the spec names for it. */
export function schemaFailure(schema: z.ZodTypeAny, raw: unknown, error: z.ZodError): ToolFailure {
  // A union reports its members' findings; the deepest one is the one the caller can act on.
  const flatten = (issues: z.ZodIssue[]): z.ZodIssue[] => issues.flatMap((issue) => (issue.code === "invalid_union" ? flatten(issue.unionErrors.flatMap((entry) => entry.issues)).sort((a, b) => b.path.length - a.path.length).slice(0, 1) : [issue]));
  const issue = flatten(error.issues)[0], field = issue.path.join(".");
  if (issue.code === "unrecognized_keys") {
    const name = [...issue.path, issue.keys[0]].join(".");
    const accepted = Object.keys(((unwrapAll(schemaAt(schema, issue.path)) as z.ZodObject<Shape> | undefined)?.shape ?? {}));
    return new ToolFailure("INVALID_PARAMS", `Unknown parameter "${name}". Remove it; the accepted parameters are: ${accepted.join(", ")}.`, { field: name, allowed: accepted });
  }
  if (field === "idempotencyKey") return new ToolFailure("INVALID_PARAMS", "idempotencyKey is required on every write and must be 16–64 characters. Send a fresh key of that length.", { field });
  const at = schemaAt(schema, issue.path), value = valueAt(raw, issue.path);
  if (issue.code === "invalid_enum_value") return new ToolFailure("INVALID_PARAMS", `${field} must be one of: ${issue.options.join(", ")}.`, { field, allowed: issue.options });
  if ((issue.code === "too_small" || issue.code === "too_big") && !(at && TICKS.has(at))) {
    const found = bounds(at), max = found.max, min = found.min ?? (issue.type === "string" || issue.type === "array" ? 0 : undefined);
    if (min !== undefined && max !== undefined) {
      const what = issue.type === "string" ? "characters" : issue.type === "array" ? "items" : "";
      return new ToolFailure("OUT_OF_RANGE", `${field} must be between ${min} and ${max}${what ? ` ${what}` : ""}. Send a value inside the range.`, { field, min, max, value: issue.type === "string" ? String(value).length : issue.type === "array" ? (value as unknown[]).length : value });
    }
  }
  if (at && TICKS.has(at)) return new ToolFailure("INVALID_PARAMS", `${field} must be a whole number of ticks (120 000 per second)${(at._def as { checks: { kind: string }[] }).checks.some((check) => check.kind === "min") ? ", zero or more" : ""}; got ${JSON.stringify(value)}.`, { field });
  return new ToolFailure("INVALID_PARAMS", `${field || "parameters"}: ${issue.message}.`, { field });
}

/** JSON Schema of a parameter shape, for MCP discovery and the catalogue. */
export function jsonSchemaOf(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = schema._def as Record<string, any>;
  const describe = (out: Record<string, unknown>) => (schema.description ? { ...out, description: schema.description } : out);
  switch (def.typeName as string) {
    case "ZodObject": {
      const shape = (schema as z.ZodObject<Shape>).shape, required = Object.keys(shape).filter((key) => !shape[key].isOptional());
      return describe({ type: "object", properties: Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, jsonSchemaOf(value)])), ...(required.length ? { required } : {}), additionalProperties: false });
    }
    case "ZodString": {
      const checks = def.checks as { kind: string; value?: number; regex?: RegExp }[];
      const min = checks.find((check) => check.kind === "min")?.value, max = checks.find((check) => check.kind === "max")?.value, pattern = checks.find((check) => check.kind === "regex")?.regex?.source;
      return describe({ type: "string", ...(min !== undefined ? { minLength: min } : {}), ...(max !== undefined ? { maxLength: max } : {}), ...(pattern ? { pattern } : {}) });
    }
    case "ZodNumber": {
      const checks = def.checks as { kind: string; value?: number }[];
      const min = checks.find((check) => check.kind === "min")?.value, max = checks.find((check) => check.kind === "max")?.value;
      return describe({ type: checks.some((check) => check.kind === "int") ? "integer" : "number", ...(min !== undefined ? { minimum: min } : {}), ...(max !== undefined ? { maximum: max } : {}) });
    }
    case "ZodBoolean": return describe({ type: "boolean" });
    case "ZodNull": return { type: "null" };
    case "ZodLiteral": return describe({ const: def.value });
    case "ZodEnum": return describe({ type: "string", enum: def.values });
    case "ZodArray": return describe({ type: "array", items: jsonSchemaOf(def.type), ...(def.minLength ? { minItems: def.minLength.value } : {}), ...(def.maxLength ? { maxItems: def.maxLength.value } : {}) });
    case "ZodTuple": return describe({ type: "array", prefixItems: (def.items as z.ZodTypeAny[]).map(jsonSchemaOf), minItems: def.items.length, maxItems: def.items.length });
    case "ZodRecord": return describe({ type: "object", additionalProperties: jsonSchemaOf(def.valueType) });
    case "ZodUnion": return describe({ anyOf: (def.options as z.ZodTypeAny[]).map(jsonSchemaOf) });
    case "ZodOptional": case "ZodDefault": return jsonSchemaOf(def.innerType);
    case "ZodNullable": return { anyOf: [jsonSchemaOf(def.innerType), { type: "null" }] };
    case "ZodEffects": return jsonSchemaOf(def.schema);
    default: return {};
  }
}

// — Results —
const TIME_KEYS = /^(?:time|start|end|startTime|duration|playhead|sourceIn|sourceOut|at|inPoint|outPoint|sceneDuration|proposedDuration|nearestFreeStart|maxTo|maxDuration|trimStart|trimEnd|sourceDuration|offset|sourceStart|sourceEnd|affectedDuration)$/;
/** Adds a `<key>Timecode` sibling to every time value of a result. */
export function withTimecodes<T>(value: T, fps: Rational): T {
  if (Array.isArray(value)) return value.map((entry) => withTimecodes(entry, fps)) as unknown as T;
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = withTimecodes(entry, fps);
    if (typeof entry === "number" && Number.isInteger(entry) && entry >= 0 && TIME_KEYS.test(key)) out[`${key}Timecode`] = formatTimecode(entry, "HH:MM:SS:FF", fps) ?? "";
  }
  return out as T;
}
export const timecode = (time: number, fps: Rational): string => formatTimecode(Math.max(0, time), "HH:MM:SS:FF", fps) ?? "";
export const seconds = (time: number): string => `${Math.round((time / 120_000) * 100) / 100} s`;
/** The size a value has in a result, with the timecode siblings the envelope adds (their length does not depend on the rate). */
const bytesOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(withTimecodes(value, { numerator: 30, denominator: 1 })), "utf8");

/**
 * One page of a list: `limit` items from the cursor, cut earlier at an item boundary when the whole result would pass
 * 32 KiB. A single item that cannot fit fails with `RESULT_TOO_LARGE`.
 */
export function page<T>(items: T[], args: { limit?: number; cursor?: string }, wrap: (items: T[]) => Record<string, unknown>, narrower = "summary"): Record<string, unknown> {
  const offset = args.cursor === undefined ? 0 : Number(args.cursor);
  if (!Number.isInteger(offset) || offset < 0 || offset > items.length) fail("INVALID_PARAMS", "cursor is not a cursor this tool returned. Call again without it to start from the first item.", { field: "cursor" });
  const limit = args.limit ?? TOOL_LIST_DEFAULT_LIMIT;
  let taken = items.slice(offset, offset + limit);
  const budget = TOOL_RESULT_MAX_BYTES - 1024;
  while (taken.length > 1 && bytesOf(wrap(taken)) > budget) {
    // Halved while far over, then one by one, so that a page is as full as it can be.
    const over = bytesOf(wrap(taken)) / budget;
    taken = taken.slice(0, over > 1.5 ? Math.max(1, Math.floor(taken.length / over)) : taken.length - 1);
  }
  if (taken.length === 1 && bytesOf(wrap(taken)) > budget) fail("RESULT_TOO_LARGE", `One item is larger than the 32 KiB result limit. Ask again with detail: "${narrower}".`, { detail: narrower });
  const next = offset + taken.length;
  return { ...wrap(taken), ...(next < items.length ? { nextCursor: String(next) } : {}) };
}
export const ok = (data: unknown, extra: Partial<ToolEnvelope> = {}): ToolEnvelope => ({ ok: true, data, warnings: [], ...extra });

// — Lookups that fail with the tool-domain codes —
export const tracksOf = (scene: Sc): Tr[] => timeline.tracksOfScene(scene);
export function elementIn(ctx: ToolContext, elementId: string): timeline.Located {
  return timeline.locate(ctx.doc, elementId) ?? fail("ELEMENT_NOT_FOUND", `No element has the id "${elementId}". Read the timeline with jc_timeline_snapshot and use an id from it.`, { elementId });
}
/** Every element of a list, all in one scene. */
export function elementsIn(ctx: ToolContext, elementIds: string[]): { scene: Sc; hits: timeline.Located[] } {
  const hits = elementIds.map((elementId) => elementIn(ctx, elementId));
  if (new Set(hits.map((hit) => hit.scene.id)).size > 1) fail("INVALID_PARAMS", "The elements belong to different scenes. Call the tool once per scene.", { field: "elementIds" });
  return { scene: hits[0].scene, hits };
}
export function trackIn(ctx: ToolContext, trackId: string): { scene: Sc; track: Tr; zone: "overlay" | "main" | "audio" } {
  for (const scene of ctx.doc.scenes as unknown as Sc[]) {
    const track = timeline.trackById(scene, trackId);
    if (track) return { scene, track, zone: timeline.zoneOfTrack(scene, track) };
  }
  return fail("TRACK_NOT_FOUND", `No track has the id "${trackId}". Read the tracks with jc_timeline_snapshot.`, { trackId });
}
export function assetIn(ctx: ToolContext, assetId: string) {
  return ctx.doc.media.assets.find((asset) => asset.id === assetId) ?? fail("ASSET_NOT_FOUND", `No media asset has the id "${assetId}". List the library with jc_media_list.`, { assetId });
}
export function unlocked(track: Tr): void {
  if (track.locked) fail("TRACK_LOCKED", `The track "${track.name}" (${track.id}) is locked. Unlock it with jc_track_edit {action: "unlock"} or choose another track.`, { trackId: track.id, trackName: track.name });
}
export const elementLabel = (element: { name?: string; type: string; id: string }): string => (element.name ? `${element.type} "${String(element.name).slice(0, 60)}"` : `${element.type} ${element.id}`);
export const clip = (text: string, max = 200): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
export type { El, Sc, Tr };

/**
 * Checks a value against the stored field it is written to: a field the element type does not carry is
 * `UNSUPPORTED_FOR_ELEMENT`, a number outside the field's range is `OUT_OF_RANGE` with that range, anything else the
 * field does not accept is `INVALID_PARAMS`. `param` is the name the caller used.
 */
export function checkField(element: { type: string; name?: string; id: string }, path: string, value: unknown, param = path, hint = ""): void {
  const shape = (ELEMENT_SHAPES as Record<string, z.ZodRawShape>)[element.type];
  const schema = shape && fieldSchema(shape, path.split("."));
  if (!schema) fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(element)} has no "${param}": ${element.type} elements do not carry that field.${hint ? ` ${hint}` : ""}`, { elementId: element.id, elementType: element.type, field: param });
  const parsed = schema!.safeParse(value);
  if (parsed.success) return;
  const limits = numberRange(schema);
  if (typeof value === "number" && limits) outOfRange(param, limits.min, limits.max, value);
  const issue = parsed.error.issues[0];
  if (issue.code === "invalid_enum_value") fail("INVALID_PARAMS", `${param} must be one of: ${issue.options.join(", ")}.`, { field: param, allowed: issue.options });
  if (issue.code === "too_big" && typeof issue.maximum === "number") outOfRange(param, 0, issue.maximum, typeof value === "string" ? value.length : value);
  fail("INVALID_PARAMS", `${param}: ${issue.message}.`, { field: param });
}
/** The range of a stored numeric field of an element type, when it has one. */
export function fieldRange(elementType: string, path: string): { min: number; max: number } | undefined {
  const shape = (ELEMENT_SHAPES as Record<string, z.ZodRawShape>)[elementType];
  return shape ? numberRange(fieldSchema(shape, path.split("."))) : undefined;
}

/** What an editor-core rejection means to a tool caller. */
export function failureOf(error: unknown): ToolFailure {
  if (error instanceof ToolFailure) return error;
  if (error instanceof timeline.CommandRefused) {
    if (error.reason === "track-locked" || error.reason === "main-locked") return new ToolFailure("TRACK_LOCKED", `${error.message}. Unlock the track with jc_track_edit {action: "unlock"} or choose another track.`, error.details);
    if ((error.reason === "out-of-range" || error.reason === "OUT_OF_RANGE") && error.details) return new ToolFailure("OUT_OF_RANGE", `${error.message}.`, error.details);
    if (error.message === timeline.TIMELINE_MESSAGES.compoundDepth) return new ToolFailure("OUT_OF_RANGE", "Compound clips can be nested up to 8 levels; this would be the ninth.", { field: "nestingDepth", min: 1, max: 8, value: 9 });
    if (error.reason === "INVALID_PARAMS") return new ToolFailure("INVALID_PARAMS", `${error.message}.`, error.details);
    return new ToolFailure("UNSUPPORTED_FOR_ELEMENT", `${error.message}.`, { reason: error.reason, ...error.details });
  }
  if (error instanceof timeline.ParamRejected) return new ToolFailure("INVALID_PARAMS", `${error.message}.`);
  if (error instanceof DocumentRejected) {
    const first = error.errors.find((entry) => entry.code === "document/template-locked") ?? error.errors[0], details = { documentCode: first.code, path: first.path, ...first.details };
    const map: Record<string, [ErrorCode, string]> = {
      "document/template-locked": ["CONFLICT", "This project is a locked template draft: its structure cannot change. Use jc_template_edit to fill slots, edit texts or unlock it."],
      "document/unknown-asset": ["ASSET_NOT_FOUND", `${first.message}. List the library with jc_media_list.`],
      "document/unknown-scene": ["SCENE_NOT_FOUND", `${first.message}. List the scenes with jc_scene_list.`],
      "document/elements-overlap": ["OVERLAP_NOT_ALLOWED", `${first.message}. Choose a free time or another track.`],
      "document/caption-overlap": ["OVERLAP_NOT_ALLOWED", `${first.message}. Captions of one track never overlap.`],
      "document/element-track-mismatch": ["TRACK_KIND_MISMATCH", `${first.message}.`],
      "document/track-zone-mismatch": ["TRACK_KIND_MISMATCH", `${first.message}.`],
      "document/compound-depth": ["OUT_OF_RANGE", "Compound clips can be nested up to 8 levels."],
      "document/effects-limit": ["OUT_OF_RANGE", "An element holds at most 16 effect entries, including at most 1 filter."],
      "document/masks-limit": ["OUT_OF_RANGE", "An element holds at most 8 masks."],
      "document/unknown-definition": ["LIBRARY_ITEM_NOT_FOUND", `${first.message}. Find ids with jc_library_search.`],
    };
    if (first.code === "document/out-of-range" || first.code === "document/limit-exceeded") {
      const leaf = first.path.split("/").filter((part) => part && !part.startsWith("@")).slice(-2).join(".");
      return new ToolFailure("OUT_OF_RANGE", `${leaf || "A value"} is outside its range: ${first.message}.`, { field: leaf, ...details });
    }
    const [code, message] = map[first.code] ?? ["CONFLICT", `The change was rejected by the document validator: ${first.message}.`];
    const range = first.code === "document/compound-depth" ? { field: "nestingDepth", min: 1, max: 8 } : first.code === "document/effects-limit" ? { field: "effects", min: 0, max: 16 } : first.code === "document/masks-limit" ? { field: "masks", min: 0, max: 8 } : {};
    return new ToolFailure(code, message, { ...details, ...range });
  }
  throw error;
}

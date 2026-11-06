import { createHash, randomUUID } from "node:crypto";
import { LOCAL_IMAGE_FEATURE } from "@jagentchill/protocol";
import type { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { gzipSync } from "node:zlib";
import { z } from "zod";
import {
  acceptPatch, addAsset, applyPatch, canonicalJson, correctSoundAsset, diffDocuments, timeline, validateProjectDocument, validatorEffectRegistry, validatorTransitionRegistry,
  type Commit, type CommitContext, type Registries, type StatePatch,
} from "@jagentchill/editor-core";
import {
  DEVICE_FLUSH_WAIT_MS, IDEMPOTENCY_RETENTION_MS, PROPOSAL_EXPIRY_MS, PROPOSAL_INVERSE_RETENTION_MS, PROPOSAL_MAX_CHANGES, RETRYABLE_TOOL_CODES, TOOL_DESCRIPTION_MAX, TOOL_METHODS,
  TOOL_NAME_MAX, TOOL_NAME_PATTERN, TOOL_PARAMS, TOOL_RATE_LIMITS, TOOL_RESULT_MAX_BYTES, WRITER_IDLE_MS, AGENT_WRITER_QUEUE_MAX,
  type DocRef, type ErrorCode, type ProjectDocument, type ProposalChange, type ProposalFrame, type ProposalState, type ProposalView, type Scope, type SyncPatchEntry, type ToolCatalogEntry,
  SYNC_METHODS, SYNC_PARAMS, type ToolEnvelope, type ToolError, type ToolMethod, type ToolNotice,
} from "@jagentchill/protocol";
import type { RuntimeQuestion, SessionRecord } from "../agents/sessions.ts";
import type { Connection, RpcMethod } from "../channel/ws-channel.ts";
import type { DeviceRegistry } from "../devices/registry.ts";
import { ProtocolError } from "../errors.ts";
import { audit } from "../store/database.ts";
import type { SyncService } from "../sync/service.ts";
import { copyWorkspaceFile, downloadToFile, importUrl, storeFile, systemNet, vetAddress, type ImportNet } from "./import.ts";
import { ALL_TOOLS } from "./index.ts";
import { surfaceForSession, toolNamesForSurface } from "./surfaces.ts";
import { AUTO_MODE_LINE, describeTurnContext } from "./context.ts";
import { createRequests, untrustedIn } from "./requests.ts";
import { ToolFailure, clip, fail, failureOf, jsonSchemaOf, schemaFailure, withTimecodes, type ProposalTools, type ToolContext, type ToolDefinition, type ToolHost, type WriteOutcome } from "./kit.ts";
import type { RenderHostManager } from "../render-host/manager.ts";
import { sceneHtmlForRender, validateMotionScene } from "../render-host/motion-scene.ts";

type Json = Record<string, unknown>;
type StoredCall = {
  changeId: string; tool: string; args: Json; seed: string; summary: string; change: WriteOutcome["change"]; patch: StatePatch;
  createdIds: string[]; touchedIds: string[]; dependsOn: string[]; at_ms: number; data?: Json;
};
type Inverse = { patches: StatePatch; touched: Record<string, string>; appliedRevision: number; applied_ms: number; label: string };
type StoredBody = {
  calls: StoredCall[]; agentId: string; agentTitle: string; acceptedChangeIds?: string[]; feedback?: string; error?: ToolError; inverse?: Inverse;
  reverted?: { at_ms: number; deviceId: string; deviceName: string }; frames?: { before: ProposalFrame; after: ProposalFrame }; sentToDeviceName?: string;
  /** The proposed patch and the element outline, kept from submit so that a resolved card still shows them. */
  frozen?: Pick<ProposalView, "elements" | "affectedDuration" | "durationBefore" | "proposedDuration" | "totals" | "fps">;
};
type ProposalRow = { proposal_id: string; session_key: string; project_id: string; state: ProposalState | "discarded"; base_revision: number; title: string; summary: string; created_ms: number; submitted_ms: number | null; resolved_ms: number | null; json: string };
type Proposal = Omit<ProposalRow, "json"> & { body: StoredBody };
type EditorReport = z.infer<(typeof TOOL_PARAMS)["jagentchill.editor.context.report"]> & { deviceId: string; connId: string; at_ms: number };

/** What the tools need from the session relay. */
export type ToolSessions = {
  session(key: string): SessionRecord | undefined;
  canRead(key: string, connection: Connection): boolean;
  canAct(key: string, connection: Connection): boolean;
  isRunning(key: string): boolean;
  abort(key: string): Promise<unknown>;
  bindProject(key: string, projectId: string | null): SessionRecord;
  deliver(key: string, message: string, options?: { hostNote?: boolean }): Promise<boolean>;
  notify(key: string, event: string, payload: unknown): void;
  resolveRuntimeQuestion(gatewayQuestionId: string, answers: Record<string, string[]> | null): Promise<void>;
  /** The folder a session's agent CLI works in (the project's workspace, else the session's own folder). */
  workdir(key: string): string | undefined;
};
export type ToolServiceDeps = {
  db: DatabaseSync; now: () => number; sync: SyncService; devices: DeviceRegistry; sessions: () => ToolSessions;
  renderHost?: RenderHostManager;
  broadcast: (scope: Scope, event: string, stream: string, payload: unknown, filter: (connection: Connection) => boolean) => void;
  /** The server's data directory: project workspaces and the downloads of an import live under it. */
  dataDir?: string;
  /** Sub-agents and teams: the `jc_agent_*` tools, and which agent of a tree may write to a project and how long it queues for the token. */
  agents?: () => { tools: NonNullable<ToolHost["agents"]>; writerGate(session: SessionRecord): void; writerWaitMs(session: SessionRecord): number; proposalApproval(session: SessionRecord): "human" | "auto" | undefined; asServer<T>(sessionKey: string, run: () => Promise<T>): Promise<T> } | undefined;
  /** Media generation for the `jc_generate_*` tools; without it they are not served. */
  generation?: () => ToolHost["generation"];
  /** The host's workflow documents for the `jc_workflow_*` tools. */
  workflows?: () => ToolHost["workflows"];
  workflowRuns?: () => ToolHost["workflowRuns"];
  /** The host's film documents for the `jc_film_*` tools. */
  films?: () => ToolHost["films"];
  /** Test only: how long a frame request waits for the device, a read for the editing device to flush, and the network of a URL import. */
  /** The host's runaway guard: tool calls one turn may make before it pauses. Never above the product limit. */
  callsPerTurn?: () => number;
  timings?: { frameMs?: number; /** The longest a jc_frame_render call may take, waiting included (under the runtime's 60 s tool timeout). */ frameCallMs?: number; flushMs?: number; writerIdleMs?: number; autoRetryMs?: number; net?: ImportNet };
};

/** `agent-editing-tools.Rate guard`: rendered images a session may ask for in a rolling minute. */
const FRAMES_PER_MINUTE = 30;
const REGISTRIES: Registries = { effects: validatorEffectRegistry() as Registries["effects"], transitions: validatorTransitionRegistry() };
const projectRef = (id: string): DocRef => ({ kind: "project", id });
const ID_SEGMENT = /@([^/]+)/g;
/** Ids drawn in order from a seed, so that a recorded tool call re-run on another base creates the same entities. */
function seededIds(seed: string): () => string {
  let counter = 0;
  return () => {
    const bytes = createHash("sha256").update(`${seed}:${counter++}`).digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}
/** Every entity id of a document that a proposal change can create, touch or remove, with the canonical text of its own fields. */
function entities(doc: ProjectDocument): Map<string, string> {
  const out = new Map<string, string>();
  for (const scene of doc.scenes as unknown as timeline.Sc[]) {
    const { tracks, markers, ...sceneFields } = scene;
    out.set(scene.id, canonicalJson({ ...sceneFields, order: (doc.scenes as { id: string }[]).findIndex((entry) => entry.id === scene.id) }));
    for (const marker of markers ?? []) out.set(String(marker.id), canonicalJson(marker));
    for (const track of timeline.tracksOfScene(scene)) {
      const { elements, ...trackFields } = track;
      out.set(track.id, canonicalJson({ ...trackFields, zoneIndex: [scene.tracks.overlay.indexOf(track), scene.tracks.audio.indexOf(track)] }));
      for (const element of elements) out.set(element.id, canonicalJson({ ...element, trackId: track.id }));
    }
  }
  const { scenes: _scenes, media: _media, metadata, ...project } = doc as unknown as Json & { metadata: Json };
  out.set("project", canonicalJson({ ...project, name: metadata.name }));
  for (const asset of doc.media.assets) out.set(asset.id, canonicalJson(asset));
  return out;
}
const elementIdsOf = (doc: ProjectDocument): Map<string, { text: string; start: number; end: number }> => {
  const out = new Map<string, { text: string; start: number; end: number }>();
  for (const scene of doc.scenes as unknown as timeline.Sc[]) for (const track of timeline.tracksOfScene(scene)) for (const element of track.elements) {
    out.set(element.id, { text: canonicalJson({ ...element, trackId: track.id }), start: element.startTime, end: element.startTime + element.duration });
  }
  return out;
};
const withoutStamp = (patch: StatePatch): StatePatch => patch.filter((entry) => entry.path !== "/metadata/updated_ms");

/**
 * The agent tools of the JAgentChill Server: the catalogue, the checks every call passes (schema, mode, project,
 * writer token, idempotency, rate), execution on the host replica with editor-core commands, and proposals — staging,
 * the decision of a person, applying through the edit lease, and revert from the stored inverse.
 */
/** The line a turn of a session that works without asking carries on top of its context block (the block may be absent). */
const PICTURES_LINE = "Pictures in this chat are made on this computer by the model the user chose, from the user's own words (the host uses them as the prompt). When the user asks for a picture or a change of one, call jc_generate_image — the content is between the user and their model.";
const withModeLine = (session: SessionRecord, context: string | undefined): string | undefined => {
  const lines = [context, session.modeId === "auto" || session.unattended ? AUTO_MODE_LINE : undefined, session.featureValues?.[LOCAL_IMAGE_FEATURE] === true ? PICTURES_LINE : undefined].filter(Boolean);
  return lines.length ? lines.join("\n") : undefined;
};


/** Fields whose too-large value is brought inside its range instead of refusing the call. */
const EASED_NUMBERS = /^(limit|maxItems|maxResults|max|count|pageSize|perPage|depth)$/;
const EASED_TEXTS = /^summary$/;
/**
 * One finding of a call's parameters that is safe to correct: a page size or similar count above its maximum (below
 * its minimum), or a short text field a little too long. Anything else stays a refusal.
 */
export function easedParams(raw: unknown, error: z.ZodError): { raw: Record<string, unknown>; note: string } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  for (const issue of error.issues) {
    if (issue.path.length !== 1 || (issue.code !== "too_big" && issue.code !== "too_small")) continue;
    const field = String(issue.path[0]), value = (raw as Record<string, unknown>)[field];
    const bound = Number((issue as { maximum?: unknown; minimum?: unknown }).maximum ?? (issue as { minimum?: unknown }).minimum);
    if (!Number.isFinite(bound)) continue;
    if (issue.type === "number" && EASED_NUMBERS.test(field) && typeof value === "number") {
      return { raw: { ...(raw as Record<string, unknown>), [field]: bound }, note: `ADJUSTED: ${field} ${value} is outside its range; ${bound} was used.` };
    }
    if (issue.type === "string" && issue.code === "too_big" && EASED_TEXTS.test(field) && typeof value === "string" && value.length <= bound * 2) {
      return { raw: { ...(raw as Record<string, unknown>), [field]: `${value.slice(0, bound - 1).trimEnd()}…` }, note: `ADJUSTED: ${field} was ${value.length} characters; it was shortened to ${bound}.` };
    }
  }
  return null;
}

export function createToolService(deps: ToolServiceDeps) {
  const { db, sync } = deps, now = deps.now;
  const tools = new Map<string, ToolDefinition>(ALL_TOOLS.map((tool) => [tool.name, tool]));
  const schemas = new Map<string, z.ZodTypeAny>(ALL_TOOLS.map((tool) => [tool.name, z.object(tool.shape).strict()]));
  for (const tool of ALL_TOOLS) {
    if (!TOOL_NAME_PATTERN.test(tool.name) || tool.name.length > TOOL_NAME_MAX) throw new Error(`tool name ${tool.name} breaks the naming rule`);
    if (tool.description.length > TOOL_DESCRIPTION_MAX) throw new Error(`the description of ${tool.name} is longer than ${TOOL_DESCRIPTION_MAX} characters`);
  }
  const methods = new Map<string, RpcMethod>();
  /** The proposed document of an open or pending proposal, on the revision it was computed for. */
  const working = new Map<string, { revision: number; doc: ProjectDocument }>();
  const writers = new Map<string, { sessionKey: string; acquired_ms: number; lastWrite_ms: number }>();
  const activeScenes = new Map<string, string>();
  const calls = new Map<string, number[]>(), turnCounts = new Map<string, { calls: number; staged: number }>();
  const reports = new Map<string, EditorReport>();
  /** One accepted proposal may be delivered more than once by separate editor surfaces. Join its one in-flight write. */
  const proposalResolutions = new Map<string, Promise<{ proposal: ProposalView; revision?: number; alreadyApplied?: boolean }>>();
  /** The frame request each device is busy with: the next one for that device is sent when it has been answered. */
  const frameQueues = new Map<string, Promise<void>>();
  const frameWaiters = new Map<string, (result: z.infer<(typeof TOOL_PARAMS)["jagentchill.editor.frame.result"]>) => void>();
  const frameCalls = new Map<string, number[]>();
  const frameCaches = new Map<string, Map<string, { data: Record<string, unknown>; images: { mime: string; dataBase64: string }[] }>>();
  /** Last successful read view per session and exact request; identical repeat reads need not copy it into history. */
  const readViews = new Map<string, { digest: string; envelope: ToolEnvelope; receipt: ToolEnvelope }>();
  const retries = new Set<ReturnType<typeof setTimeout>>();
  const sessions = () => deps.sessions();
  const requests = createRequests({ db, now, devices: deps.devices, sessions, broadcast: deps.broadcast, answerRuntimeQuestion: (id, answers) => void sessions().resolveRuntimeQuestion(id, answers) });
  const deviceName = (deviceId: string) => deps.devices.get(deviceId)?.name ?? "Unknown device";

  // — Storage —
  const read = (row: ProposalRow | undefined): Proposal | undefined => (row ? { ...row, body: JSON.parse(row.json) as StoredBody } : undefined);
  const proposalById = (proposalId: string) => read(db.prepare("SELECT * FROM tool_proposals WHERE proposal_id = ?").get(proposalId) as ProposalRow | undefined);
  const save = (proposal: Proposal): void => {
    db.prepare("INSERT INTO tool_proposals (proposal_id, session_key, project_id, state, base_revision, title, summary, created_ms, submitted_ms, resolved_ms, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (proposal_id) DO UPDATE SET state = excluded.state, base_revision = excluded.base_revision, title = excluded.title, summary = excluded.summary, submitted_ms = excluded.submitted_ms, resolved_ms = excluded.resolved_ms, json = excluded.json")
      .run(proposal.proposal_id, proposal.session_key, proposal.project_id, proposal.state, proposal.base_revision, proposal.title, proposal.summary, proposal.created_ms, proposal.submitted_ms, proposal.resolved_ms, JSON.stringify(proposal.body));
  };
  /** The session's proposal that is being staged or awaits a decision; a pending one past seven days expires here. */
  function current(sessionKey: string): Proposal | undefined {
    const found = read(db.prepare("SELECT * FROM tool_proposals WHERE session_key = ? AND state IN ('open', 'pending', 'applying') ORDER BY created_ms DESC LIMIT 1").get(sessionKey) as ProposalRow | undefined);
    if (found?.state === "pending" && found.submitted_ms !== null && now() - found.submitted_ms >= PROPOSAL_EXPIRY_MS) { close(found, "expired"); return undefined; }
    return found;
  }
  function expireOld(): void {
    for (const row of db.prepare("SELECT * FROM tool_proposals WHERE state = 'pending' AND submitted_ms <= ?").all(now() - PROPOSAL_EXPIRY_MS) as ProposalRow[]) close(read(row)!, "expired");
  }

  // — The host replica —
  function replica(projectId: string): { doc: ProjectDocument; revision: number } {
    const row = sync.documents.row(projectRef(projectId));
    if (!row || row.state === "purged") throw new ToolFailure("PROJECT_NOT_SYNCED", "This project has no copy on the host, so tools cannot read or change it. Ask the user to turn on sync for the project (the chat shows a \"Sync this project\" button), then call the tool again.", { projectId });
    if (row.state === "trash") throw new ToolFailure("PROJECT_NOT_FOUND", "This project is in the host trash. Ask the user to restore it.", { projectId });
    return { doc: sync.documents.head(row) as unknown as ProjectDocument, revision: row.head };
  }
  const commitContext = (seed: string): CommitContext => ({ now_ms: now(), newId: seededIds(seed), registries: REGISTRIES, writer: { id: "agent" } });

  function makeContext(session: SessionRecord, projectId: string, base: { doc: ProjectDocument; revision: number }, doc: ProjectDocument, seed: string, dryRun: boolean, edit: timeline.EditContext): ToolContext {
    const ids = commitContext(seed);
    const ctx: ToolContext = {
      session, now: now(), projectId, doc, revision: base.revision, committed: base.doc, edit, warnings: [], dryRun, host,
      mediaAvailability(assetId) {
        const asset = ctx.doc.media.assets.find((entry) => entry.id === assetId);
        if (!asset?.contentHash) return "device-local-or-unknown";
        return sync.blobs.status(asset.contentHash).state === "complete" ? "ready" : "device-local-or-unknown";
      },
      mediaDeviceIssues(assetId) { return sync.host.mediaDeviceIssues(projectId, assetId); },
      permit() { throw new ToolFailure("INTERNAL", "This tool cannot ask for a permission."); },
      commitContext: () => ({ ...ids, now_ms: now() }),
      run(command) { const executed = timeline.executeCommand(ctx.doc, ctx.commitContext(), ctx.edit, command); ctx.doc = executed.commit.document; return executed.info as never; },
      apply(change) { const commit: Commit = change(ctx.doc, ctx.commitContext()); ctx.doc = commit.document; },
      activeSceneId() {
        const chosen = activeScenes.get(`${session.sessionKey}|${projectId}`);
        return chosen && ctx.doc.scenes.some((scene) => scene.id === chosen) ? chosen : (ctx.doc.scenes.find((scene) => scene.isMain) ?? ctx.doc.scenes[0]).id;
      },
      scene(sceneId) {
        const wanted = sceneId ?? ctx.activeSceneId();
        return (ctx.doc.scenes.find((scene) => scene.id === wanted) as unknown as timeline.Sc | undefined) ?? fail("SCENE_NOT_FOUND", `No scene has the id "${wanted}". List the scenes with jc_scene_list.`, { sceneId: wanted });
      },
    };
    return ctx;
  }

  /** Runs one recorded or new staged call on a document and returns the document after it. */
  function execute(tool: ToolDefinition, session: SessionRecord, base: { doc: ProjectDocument; revision: number }, doc: ProjectDocument, args: Json, seed: string, dryRun: boolean): { doc: ProjectDocument; outcome: WriteOutcome; warnings: string[] } {
    const { idempotencyKey: _key, dryRun: _dry, editContext, ...rest } = args as Json & { editContext?: Partial<timeline.EditContext> };
    // A tool's own `ripple` parameter sets the ripple of that call.
    const edit = timeline.hostEditContext({ ...editContext, ...(typeof rest.ripple === "boolean" ? { ripple: rest.ripple } : {}) });
    const ctx = makeContext(session, doc.metadata.id, base, doc, seed, dryRun, edit);
    let outcome: WriteOutcome;
    try { outcome = tool.handle(ctx, { ...rest, ...(editContext ? { editContext } : {}) } as never) as WriteOutcome; } catch (error) { throw failureOf(error); }
    // The integrity check of the proposed state; a finding here is a fault of the tool, not of the caller.
    const check = validateProjectDocument(ctx.doc, { mode: "strict", registries: REGISTRIES });
    if (!check.ok) {
      const diagnosticId = randomUUID();
      console.error(`[agent-tools] integrity ${diagnosticId} after ${tool.name}: ${JSON.stringify(check.errors.slice(0, 3))}`);
      throw new ToolFailure("INTERNAL", `The change left the project in an invalid state and was rolled back (diagnostic ${diagnosticId}).`, { diagnosticId });
    }
    return { doc: ctx.doc, outcome, warnings: ctx.warnings };
  }

  /** Re-runs recorded calls, in order, on another state. Calls that no longer validate are returned in `failed`. */
  function replay(session: SessionRecord, base: { doc: ProjectDocument; revision: number }, recorded: StoredCall[]): { doc: ProjectDocument; calls: StoredCall[]; failed: { call: StoredCall; error: ToolFailure }[] } {
    let doc = base.doc;
    const kept: StoredCall[] = [], failed: { call: StoredCall; error: ToolFailure }[] = [];
    for (const call of recorded) {
      const tool = tools.get(call.tool);
      try {
        if (!tool) throw new ToolFailure("TOOL_NOT_AVAILABLE", `The tool ${call.tool} is no longer served.`);
        const done = execute(tool, session, base, doc, call.args, call.seed, false);
        kept.push({ ...call, patch: withoutStamp(diffDocuments(doc, done.doc)) });
        doc = done.doc;
      } catch (error) { failed.push({ call, error: failureOf(error) }); }
    }
    return { doc, calls: kept, failed };
  }
  /** The proposed document of a proposal on the current head; a proposal staged on an older revision is rebased by re-running its calls. */
  function proposed(proposal: Proposal, session: SessionRecord): { base: { doc: ProjectDocument; revision: number }; doc: ProjectDocument; failed: { call: StoredCall; error: ToolFailure }[] } {
    const base = replica(proposal.project_id), cached = working.get(proposal.proposal_id);
    if (cached?.revision === base.revision) return { base, doc: cached.doc, failed: [] };
    if (proposal.base_revision === base.revision) {
      let doc = base.doc;
      try { for (const call of proposal.body.calls) doc = applyPatch(doc, call.patch); working.set(proposal.proposal_id, { revision: base.revision, doc }); return { base, doc, failed: [] }; } catch { /* rebuilt by replay below */ }
    }
    const rebased = replay(session, base, proposal.body.calls);
    if (rebased.failed.length === 0) {
      proposal.body.calls = rebased.calls; proposal.base_revision = base.revision;
      save(proposal);
      working.set(proposal.proposal_id, { revision: base.revision, doc: rebased.doc });
    }
    return { base, doc: rebased.doc, failed: rebased.failed };
  }

  // — What a client is shown —
  function measure(before: ProjectDocument, after: ProjectDocument) {
    const was = elementIdsOf(before), is = elementIdsOf(after);
    const added = [...is.keys()].filter((elementId) => !was.has(elementId)), removed = [...was.keys()].filter((elementId) => !is.has(elementId));
    const modified = [...is.keys()].filter((elementId) => was.has(elementId) && was.get(elementId)!.text !== is.get(elementId)!.text);
    const spans = [...added.map((elementId) => is.get(elementId)!), ...removed.map((elementId) => was.get(elementId)!), ...modified.flatMap((elementId) => [was.get(elementId)!, is.get(elementId)!])].sort((a, b) => a.start - b.start);
    let affected = 0, reach = -1;
    for (const span of spans) { const from = Math.max(span.start, reach); if (span.end > from) affected += span.end - from; reach = Math.max(reach, span.end); }
    return { elements: { added, modified, removed }, affectedDuration: affected, durationBefore: before.metadata.duration, proposedDuration: after.metadata.duration, fps: after.settings.fps };
  }
  const totalsOf = (recorded: StoredCall[]) => {
    const totals = { add: 0, modify: 0, remove: 0, move: 0 };
    for (const call of recorded) totals[call.change.kind] += 1;
    return totals;
  };
  const changesOf = (recorded: StoredCall[]): ProposalChange[] => recorded.map((call) => ({ changeId: call.changeId, ...call.change, tool: call.tool, summary: call.summary, dependsOn: call.dependsOn }));
  function view(proposal: Proposal): ProposalView {
    const session = sessions().session(proposal.session_key), body = proposal.body;
    let preview: ProposalView["preview"] = { baseRevision: proposal.base_revision, patches: [] }, frozen = body.frozen;
    if ((proposal.state === "open" || proposal.state === "pending" || proposal.state === "applying") && session) {
      try {
        const at = proposed(proposal, session);
        if (at.failed.length === 0) { preview = { baseRevision: at.base.revision, patches: withoutStamp(diffDocuments(at.base.doc, at.doc)) as SyncPatchEntry[] }; frozen = { ...measure(at.base.doc, at.doc), totals: totalsOf(proposal.body.calls) }; }
      } catch { /* the project left the host; the stored figures stay */ }
    }
    const inverse = body.inverse;
    const revert: ProposalView["revert"] = body.reverted ? { state: "reverted", reverted_ms: body.reverted.at_ms, revertedByDeviceId: body.reverted.deviceId, revertedByName: body.reverted.deviceName }
      : inverse ? (now() - inverse.applied_ms > PROPOSAL_INVERSE_RETENTION_MS ? { state: "expired" } : { state: "available", until_ms: inverse.applied_ms + PROPOSAL_INVERSE_RETENTION_MS }) : undefined;
    return {
      proposalId: proposal.proposal_id, projectId: proposal.project_id, state: proposal.state as ProposalState, title: proposal.title, summary: proposal.summary,
      author: { sessionId: proposal.session_key, agentId: body.agentId, agentTitle: body.agentTitle }, baseRevision: proposal.base_revision, created_ms: proposal.created_ms,
      ...(proposal.submitted_ms !== null ? { submitted_ms: proposal.submitted_ms, expires_ms: proposal.submitted_ms + PROPOSAL_EXPIRY_MS } : {}), ...(proposal.resolved_ms !== null ? { resolved_ms: proposal.resolved_ms } : {}),
      changes: changesOf(body.calls), totals: frozen?.totals ?? totalsOf(body.calls), elements: frozen?.elements ?? { added: [], modified: [], removed: [] },
      affectedDuration: frozen?.affectedDuration ?? 0, durationBefore: frozen?.durationBefore ?? 0, proposedDuration: frozen?.proposedDuration ?? 0, ...(frozen?.fps ? { fps: frozen.fps } : {}),
      framesUnavailable: !body.frames, ...(body.frames ? { frames: body.frames } : {}), preview,
      ...(body.acceptedChangeIds ? { acceptedChangeIds: body.acceptedChangeIds } : {}), ...(body.feedback ? { feedback: body.feedback } : {}), ...(body.error ? { error: body.error } : {}),
      ...(inverse ? { appliedRevision: inverse.appliedRevision } : {}), ...(revert ? { revert } : {}), ...(body.sentToDeviceName ? { sentToDeviceName: body.sentToDeviceName } : {}),
    };
  }
  /** A proposal changed: every connection that may read its session learns it. An open proposal is nobody's business yet. */
  function announce(proposal: Proposal): void {
    if (proposal.state === "open" || proposal.state === "discarded") return;
    const payload = { proposal: view(proposal) };
    deps.broadcast("jagentchill.projects.read", "jagentchill.proposal.updated", `project:${proposal.project_id}`, payload, (connection) => sessions().canRead(proposal.session_key, connection));
  }
  function notice(session: SessionRecord, tool: string, failure: ToolFailure): void {
    const turnLimit = failure.code === "RATE_LIMITED" && failure.details?.reason === "per_turn_limit";
    if (failure.code !== "PROJECT_NOT_SYNCED" && failure.code !== "WRITER_HELD" && failure.code !== "RENDERER_UNAVAILABLE" && !turnLimit) return;
    if (turnLimit) {
      // The turn stops here: one status line with "Continue", and the run is aborted so that the agent does not go on without tools.
      if (existingNotices(session.sessionKey).some((entry) => entry.code === "TURN_LIMIT" && !entry.continued)) return;
      addNotice({ noticeId: randomUUID(), sessionKey: session.sessionKey, code: "TURN_LIMIT", tool, created_ms: now() });
      void sessions().abort(session.sessionKey);
      return;
    }
    // One card per session and cause: a tool retried against the same wall does not stack cards.
    const existing = existingNotices(session.sessionKey);
    if (existing.some((entry) => entry.code === failure.code && entry.projectId === session.projectId)) return;
    const entry: ToolNotice = {
      noticeId: randomUUID(), sessionKey: session.sessionKey, code: failure.code as "PROJECT_NOT_SYNCED" | "WRITER_HELD" | "RENDERER_UNAVAILABLE", tool, created_ms: now(), ...(session.projectId ? { projectId: session.projectId } : {}),
      ...(failure.code === "PROJECT_NOT_SYNCED" ? { deviceName: deviceName(session.ownerDeviceId) } : {}), ...(failure.code === "WRITER_HELD" ? { holderTitle: String(failure.details?.holderTitle ?? "") } : {}),
    };
    addNotice(entry);
  }
  const existingNotices = (sessionKey: string) => (db.prepare("SELECT json FROM tool_notices WHERE session_key = ? ORDER BY created_ms").all(sessionKey) as { json: string }[]).map((row) => JSON.parse(row.json) as ToolNotice);
  function addNotice(entry: ToolNotice): void {
    db.prepare("INSERT INTO tool_notices (notice_id, session_key, json, created_ms) VALUES (?, ?, ?, ?) ON CONFLICT (notice_id) DO UPDATE SET json = excluded.json").run(entry.noticeId, entry.sessionKey, JSON.stringify(entry), entry.created_ms);
    deps.broadcast("jagentchill.projects.read", "jagentchill.tool.notice", `session:${entry.sessionKey}`, { notice: entry }, (connection) => sessions().canRead(entry.sessionKey, connection));
  }

  // — Writer token —
  const agentTitle = (session: SessionRecord) => session.title ?? "Agent";
  function releaseWriter(projectId: string, sessionKey: string): void { if (writers.get(projectId)?.sessionKey === sessionKey) writers.delete(projectId); }
  function holdWriter(session: SessionRecord, projectId: string): void {
    const held = writers.get(projectId), idle = deps.timings?.writerIdleMs ?? WRITER_IDLE_MS;
    if (held && held.sessionKey !== session.sessionKey) {
      const holder = sessions().session(held.sessionKey), busy = holder && (current(held.sessionKey)?.state === "open" || now() - held.lastWrite_ms < idle);
      if (busy) throw new ToolFailure("WRITER_HELD", `This project is being edited by ${agentTitle(holder)} in another session. Wait for that agent to submit or discard its proposal, then call the tool again.`, { holderAgentId: holder.agentId, holderTitle: agentTitle(holder), holderSessionId: held.sessionKey, since_ms: held.acquired_ms });
    }
    if (held?.sessionKey === session.sessionKey) held.lastWrite_ms = now();
    else writers.set(projectId, { sessionKey: session.sessionKey, acquired_ms: now(), lastWrite_ms: now() });
  }

  /** Agents of one tree take turns: a sub-agent that finds the token held waits in the project's queue (first come, first served) instead of failing at once. */
  const writerQueue = new Map<string, object[]>();
  async function acquireWriter(session: SessionRecord, projectId: string): Promise<void> {
    const team = deps.agents?.();
    team?.writerGate(session);
    const wait = team?.writerWaitMs(session) ?? 0, queue = () => writerQueue.get(projectId) ?? [];
    const held = (error: unknown): error is ToolFailure => error instanceof ToolFailure && error.code === "WRITER_HELD";
    let last: ToolFailure | undefined;
    if (!(wait > 0 && queue().length)) {
      try { return holdWriter(session, projectId); } catch (error) { if (!held(error) || wait <= 0) throw error; last = error; }
    }
    if (queue().length >= AGENT_WRITER_QUEUE_MAX) throw last ?? new ToolFailure("WRITER_HELD", "Too many agents already wait to edit this project. Hand back a description of the change instead.", { reason: "queue_full" });
    const entry = {}, deadline = Date.now() + wait;
    writerQueue.set(projectId, [...queue(), entry]);
    try {
      for (;;) {
        if (queue()[0] === entry) { try { return holdWriter(session, projectId); } catch (error) { if (!held(error)) throw error; last = error; } }
        if (Date.now() >= deadline) throw new ToolFailure("WRITER_HELD", `${last?.message ?? "Another agent is ahead of you in the queue for this project."} You waited ${Math.round(wait / 1000)} s and the project is still being edited.`, { ...last?.details, reason: "wait_timeout", queuePosition: queue().indexOf(entry) + 1 });
        await new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.min(250, deadline - Date.now()))));
      }
    } finally { writerQueue.set(projectId, queue().filter((waiting) => waiting !== entry)); }
  }

  // — Proposals: staging —
  function open(session: SessionRecord, projectId: string, title = "", summary = ""): Proposal {
    const base = replica(projectId);
    const proposal: Proposal = { proposal_id: randomUUID(), session_key: session.sessionKey, project_id: projectId, state: "open", base_revision: base.revision, title, summary, created_ms: now(), submitted_ms: null, resolved_ms: null, body: { calls: [], agentId: session.agentId, agentTitle: agentTitle(session) } };
    save(proposal);
    return proposal;
  }
  function close(proposal: Proposal, state: ProposalState | "discarded", change: Partial<StoredBody> = {}): Proposal {
    proposal.state = state; proposal.resolved_ms = now(); Object.assign(proposal.body, change);
    save(proposal);
    working.delete(proposal.proposal_id);
    releaseWriter(proposal.project_id, proposal.session_key);
    announce(proposal);
    return proposal;
  }
  const pendingMessage = "A proposal is waiting for the user's decision. Nothing more can be staged until it is accepted or rejected; tell the user so and stop.";
  const generatedTitle = (proposal: Proposal) => clip(proposal.body.calls.length === 1 ? proposal.body.calls[0].summary : `${proposal.body.calls.length} changes: ${proposal.body.calls[0].summary}`, 80);

  async function submit(proposal: Proposal, session: SessionRecord, title: string, summary: string): Promise<Proposal> {
    const at = proposed(proposal, session);
    if (at.failed.length > 0) { close(proposal, "stale"); throw new ToolFailure("PROPOSAL_STALE", "The project changed and the staged changes no longer apply. Read the timeline again and rebuild the proposal.", { failed: at.failed.map((entry) => entry.call.changeId) }); }
    proposal.state = "pending"; proposal.title = title; proposal.summary = summary; proposal.submitted_ms = now();
    proposal.body.frozen = { ...measure(at.base.doc, at.doc), totals: totalsOf(proposal.body.calls) };
    save(proposal);
    // The token is free as soon as nothing is being staged any more.
    releaseWriter(proposal.project_id, proposal.session_key);
    audit(db, now(), `agent:${session.sessionKey}`, "proposal.submit", { category: "agent", proposalId: proposal.proposal_id, projectId: proposal.project_id, changeCount: proposal.body.calls.length });
    announce(proposal);
    // A member of a team follows its team's proposal policy when it has one; otherwise the session's mode decides.
    const policy = deps.agents?.()?.proposalApproval(session);
    if (policy ? policy === "auto" : session.modeId === "auto") void autoAccept(proposal.proposal_id, session, 0);
    return proposal;
  }
  /** `auto` mode: a valid proposal is accepted by the host; a busy lease holder is retried every 30 s for 10 minutes. */
  async function autoAccept(proposalId: string, session: SessionRecord, attempt: number): Promise<void> {
    try { await resolve(proposalId, "accept", { deviceId: session.ownerDeviceId, automatic: true }); } catch (error) {
      if (!(error instanceof ToolFailure) || error.code !== "LEASE_UNAVAILABLE" || attempt >= 20) return;
      const timer = setTimeout(() => { retries.delete(timer); void autoAccept(proposalId, session, attempt + 1); }, deps.timings?.autoRetryMs ?? 30_000);
      timer.unref(); retries.add(timer);
    }
  }

  // — Proposals: the decision —
  function dependencyClosure(recorded: StoredCall[], chosen: Set<string>): Set<string> {
    const all = new Set(chosen);
    for (let grew = true; grew;) { grew = false; for (const call of recorded) if (all.has(call.changeId)) for (const need of call.dependsOn) if (!all.has(need)) { all.add(need); grew = true; } }
    return all;
  }
  function outcomeMessage(proposal: Proposal): string {
    const body = proposal.body, head = `[JAgentChill] Proposal "${proposal.title}" (${proposal.proposal_id})`;
    const data = { proposalId: proposal.proposal_id, state: proposal.state, ...(body.acceptedChangeIds && proposal.state === "partially_accepted" ? { acceptedChangeIds: body.acceptedChangeIds } : {}), ...(body.feedback ? { feedback: body.feedback } : {}), ...(body.error ? { error: body.error, currentRevision: body.error.details?.currentRevision } : {}), ...(body.inverse ? { revision: body.inverse.appliedRevision, currentRevision: body.inverse.appliedRevision } : {}) };
    const text = proposal.state === "accepted" ? "was accepted and applied to the project." : proposal.state === "partially_accepted" ? "was partly accepted: only the listed changes were applied, the rest were discarded."
      : proposal.state === "rejected" ? `was rejected${body.feedback ? ` with this feedback: ${body.feedback}` : "."}` : proposal.state === "stale" ? `could not be applied because the timeline changed. Current revision: ${String(body.error?.details?.currentRevision ?? proposal.base_revision)}. Re-read the current timeline and propose the intended edit again.`
        : proposal.state === "expired" ? "expired without a decision." : body.error?.message ?? "could not be applied.";
    return `${head} ${text}\nThis is a status message of the editor, not a request of the user.\n${JSON.stringify(data)}`;
  }
  function resolve(proposalId: string, action: "accept" | "accept_partial" | "reject", by: { deviceId: string; automatic?: boolean }, options: { changeIds?: string[]; includeDependencies?: boolean; feedback?: string } = {}): Promise<{ proposal: ProposalView; revision?: number; alreadyApplied?: boolean }> {
    const active = proposalResolutions.get(proposalId);
    if (active) return active.then((result) => result.proposal.state === "accepted" || result.proposal.state === "partially_accepted" ? { ...result, alreadyApplied: true } : result);
    const proposal = proposalById(proposalId);
    if (action !== "reject" && proposal && (proposal.state === "accepted" || proposal.state === "partially_accepted")) {
      return Promise.resolve({ proposal: view(proposal), revision: proposal.body.inverse?.appliedRevision, alreadyApplied: true });
    }
    const work = resolveFresh(proposalId, action, by, options);
    proposalResolutions.set(proposalId, work);
    void work.then(() => proposalResolutions.delete(proposalId), () => proposalResolutions.delete(proposalId));
    return work;
  }
  async function resolveFresh(proposalId: string, action: "accept" | "accept_partial" | "reject", by: { deviceId: string; automatic?: boolean }, options: { changeIds?: string[]; includeDependencies?: boolean; feedback?: string } = {}): Promise<{ proposal: ProposalView; revision?: number; alreadyApplied?: boolean }> {
    expireOld();
    const proposal = proposalById(proposalId) ?? fail("PROPOSAL_NOT_FOUND", "No such proposal.", { proposalId });
    if (proposal.state !== "pending") throw new ToolFailure("PROPOSAL_CLOSED", proposal.state === "applying" ? "The proposal is being applied." : `The proposal was already resolved (${proposal.state}).`, { state: proposal.state });
    const session = sessions().session(proposal.session_key);
    const finish = (state: ProposalState, change: Partial<StoredBody> = {}) => {
      close(proposal, state, change);
      audit(db, now(), by.automatic ? "server" : `device:${by.deviceId}`, "proposal.resolve", { category: "agent", proposalId, action, state, deviceId: by.deviceId, changeCount: proposal.body.acceptedChangeIds?.length ?? proposal.body.calls.length, revisionAfter: proposal.body.inverse?.appliedRevision ?? null, timestamp_ms: now() });
      // The outcome reaches the agent as a data-only message: a new turn when the session is idle, a follow-up behind a running one.
      // It is a message of the server: in an agent tree the turn it starts is not a person's prompt.
      const tell = () => sessions().deliver(proposal.session_key, outcomeMessage(proposal), { hostNote: true });
      void (deps.agents?.()?.asServer(proposal.session_key, tell) ?? tell());
    };
    if (action === "reject") { finish("rejected", options.feedback ? { feedback: options.feedback } : {}); return { proposal: view(proposal) }; }
    if (!session) { finish("failed", { error: { code: "NOT_FOUND", message: "The session of this proposal no longer exists.", retryable: false } }); throw new ToolFailure("PROPOSAL_CLOSED", "The session of this proposal no longer exists."); }

    let chosen = proposal.body.calls;
    if (action === "accept_partial") {
      const wanted = new Set(options.changeIds ?? []), known = new Set(proposal.body.calls.map((call) => call.changeId));
      const unknown = [...wanted].filter((changeId) => !known.has(changeId));
      if (wanted.size === 0 || unknown.length > 0) throw new ToolFailure("INVALID_PARAMS", wanted.size === 0 ? "Choose at least one change." : "Some change ids are not part of this proposal.", { unknown });
      const closure = dependencyClosure(proposal.body.calls, wanted), missing = [...closure].filter((changeId) => !wanted.has(changeId));
      if (missing.length > 0 && !options.includeDependencies) throw new ToolFailure("INVALID_PARAMS", "The selection leaves out changes that the selected ones depend on.", { missing });
      chosen = proposal.body.calls.filter((call) => closure.has(call.changeId));
    }
    const partial = chosen.length < proposal.body.calls.length;
    proposal.state = "applying"; save(proposal); announce(proposal);
    const back = (error: ToolFailure): never => { proposal.state = "pending"; save(proposal); announce(proposal); throw error; };
    for (let attempt = 0; ; attempt++) {
      let base: { doc: ProjectDocument; revision: number };
      try { base = replica(proposal.project_id); } catch (error) { finish("failed", { error: failureOf(error).envelope() }); throw failureOf(error); }
      // A full accept on the revision the proposal was staged on applies the recorded patches; anything else is re-run and re-validated first.
      let target: ProjectDocument, applied = chosen;
      if (!partial && proposal.base_revision === base.revision) {
        try { target = proposal.body.calls.reduce((doc, call) => applyPatch(doc, call.patch), base.doc); } catch { target = base.doc; }
      } else target = base.doc;
      if (target === base.doc) {
        const rerun = replay(session, base, chosen);
        if (rerun.failed.length > 0) {
          if (partial) return back(new ToolFailure("INVALID_PARAMS", "The selected changes do not apply on their own. Accept them together with the changes they build on, or accept the whole proposal.", { failed: rerun.failed.map((entry) => entry.call.changeId) }));
          const changed = rerun.failed.map((entry) => ({ changeId: entry.call.changeId, operation: entry.call.summary, code: entry.error.code, reason: entry.error.message }));
          const currentRevision = base.revision;
          finish("stale", { error: { code: "PROPOSAL_STALE", message: `Could not apply because the timeline changed. Current revision is ${currentRevision}. Re-read the timeline and propose the intended change again.`, retryable: false, details: { baseRevision: proposal.base_revision, currentRevision, changed } } });
          return { proposal: view(proposal), revision: currentRevision };
        }
        target = rerun.doc; applied = rerun.calls;
      }
      const patches = withoutStamp(diffDocuments(base.doc, target));
      let result;
      try {
        result = await sync.host.applyBatch({ doc: projectRef(proposal.project_id), principal: `agent:${proposal.session_key}`, label: `Agent: ${proposal.title}`, patches: [...patches, { op: "replace", path: "/metadata/updated_ms", value: now() }] as SyncPatchEntry[], baseRevision: base.revision, originDeviceId: by.deviceId, commandType: "agent.proposal" });
      } catch (error) {
        if (error instanceof ProtocolError && error.code === "LEASE_HELD") return back(new ToolFailure("LEASE_UNAVAILABLE", "Another change is being applied to this project. Try again in a moment."));
        const failure = error instanceof ProtocolError ? new ToolFailure(error.code, error.message, error.details) : failureOf(error);
        finish("failed", { error: failure.envelope() });
        throw failure;
      }
      if (result.state === "waiting") return back(new ToolFailure("LEASE_UNAVAILABLE", `${result.deviceName} is editing this project and did not take the change in time. Try again, or ask to take over editing.`, { deviceName: result.deviceName }));
      if (result.state === "rejected") {
        // The head moved while the batch was on its way: once more on the new head.
        if (result.head !== base.revision && attempt < 2) continue;
        const current = replica(proposal.project_id);
        const changed = Object.keys(entities(base.doc)).filter((id) => entities(base.doc).get(id) !== entities(current.doc).get(id));
        finish("stale", { error: { code: "PROPOSAL_STALE", message: `Could not apply because the timeline changed. Current revision is ${current.revision}. Re-read the timeline and propose the intended change again.`, retryable: false, details: { baseRevision: base.revision, currentRevision: current.revision, changed } } });
        return { proposal: view(proposal), revision: current.revision };
      }
      const after = replica(proposal.project_id), holder = sync.leases.current(projectRef(proposal.project_id));
      const canonicalWithoutStamp = (doc: ProjectDocument) => canonicalJson({ ...doc, metadata: { ...doc.metadata, updated_ms: 0 } });
      if (after.revision <= base.revision || canonicalWithoutStamp(after.doc) !== canonicalWithoutStamp(target)) {
        const error: ToolError = { code: "CONFLICT", message: `Could not verify the timeline update at revision ${base.revision}; the host is still at revision ${after.revision}. The proposal was not marked applied. Retry to re-read the timeline.`, retryable: true, details: { baseRevision: base.revision, currentRevision: after.revision } };
        finish("failed", { error });
        return { proposal: view(proposal), revision: after.revision };
      }
      const touched = new Set(applied.flatMap((call) => [...call.touchedIds, ...call.createdIds]));
      for (const entry of patches) for (const match of entry.path.matchAll(ID_SEGMENT)) touched.add(match[1]);
      if (patches.some((entry) => !entry.path.startsWith("/scenes") && !entry.path.startsWith("/media"))) touched.add("project");
      const states = entities(after.doc);
      const inverse: Inverse = {
        patches: withoutStamp(diffDocuments(target, base.doc)), appliedRevision: result.revision, applied_ms: now(), label: `Revert Agent: ${proposal.title}`,
        touched: Object.fromEntries([...touched].filter((entityId) => states.has(entityId)).map((entityId) => [entityId, createHash("sha256").update(states.get(entityId)!).digest("hex")])),
      };
      const sentTo = holder?.holder.kind === "device" && holder.holder.deviceId !== by.deviceId ? holder.holderName : undefined;
      finish(partial ? "partially_accepted" : "accepted", { inverse, acceptedChangeIds: applied.map((call) => call.changeId), ...(sentTo ? { sentToDeviceName: sentTo } : {}) });
      return { proposal: view(proposal), revision: result.revision };
    }
  }

  /** "Revert this change": the stored inverse of an applied proposal, as a new change through the edit lease. */
  async function revertApplied(proposalId: string, by: { deviceId: string }, force: boolean): Promise<{ proposal: ProposalView; revision: number; skipped: { entityId: string }[] }> {
    const proposal = proposalById(proposalId) ?? fail("PROPOSAL_NOT_FOUND", "No such proposal.", { proposalId });
    const inverse = proposal.body.inverse;
    if (proposal.state !== "accepted" && proposal.state !== "partially_accepted") throw new ToolFailure("PROPOSAL_CLOSED", "Only an applied proposal can be reverted.", { state: proposal.state });
    if (proposal.body.reverted) throw new ToolFailure("PROPOSAL_CLOSED", "This proposal was already reverted.", { reverted_ms: proposal.body.reverted.at_ms });
    if (!inverse || now() - inverse.applied_ms > PROPOSAL_INVERSE_RETENTION_MS) {
      if (inverse) { delete proposal.body.inverse; save(proposal); announce(proposal); }
      throw new ToolFailure("NOT_FOUND", "Revert is no longer available for this change: its undo data is kept for 30 days.", { proposalId });
    }
    const base = replica(proposal.project_id), states = entities(base.doc), names = new Map<string, { kind: string; name: string }>();
    for (const scene of base.doc.scenes as unknown as timeline.Sc[]) {
      names.set(scene.id, { kind: "scene", name: scene.name });
      for (const track of timeline.tracksOfScene(scene)) { names.set(track.id, { kind: "track", name: track.name }); for (const element of track.elements) names.set(element.id, { kind: "element", name: element.name }); }
    }
    // An entity the proposal touched that a later change touched again: its current state is not the one the proposal left.
    const conflicts = Object.entries(inverse.touched).filter(([entityId, hash]) => !states.has(entityId) || createHash("sha256").update(states.get(entityId)!).digest("hex") !== hash)
      .map(([entityId]) => ({ entityId, kind: names.get(entityId)?.kind ?? (entityId === "project" ? "project" : "entity"), name: names.get(entityId)?.name ?? (entityId === "project" ? base.doc.metadata.name : "(deleted)") }));
    if (conflicts.length > 0 && !force) throw new ToolFailure("CONFLICT", "The project was changed again after this proposal was applied. Reverting would undo newer edits of the listed items.", { conflicts });
    const skip = new Set(conflicts.map((entry) => entry.entityId));
    // What holds a skipped entity stays too: a track the proposal created is not removed from under an element that was edited since.
    const holders = new Set<string>();
    for (const scene of base.doc.scenes as unknown as timeline.Sc[]) for (const track of timeline.tracksOfScene(scene)) {
      if (skip.has(track.id) || track.elements.some((element) => skip.has(element.id))) { holders.add(scene.id); if (track.elements.some((element) => skip.has(element.id))) holders.add(track.id); }
    }
    const patches = inverse.patches.filter((entry) => {
      const named = [...entry.path.matchAll(ID_SEGMENT)].map((match) => match[1]);
      if (entry.op === "remove" && named.length > 0 && entry.path.endsWith(`@${named[named.length - 1]}`) && holders.has(named[named.length - 1])) return false;
      return !named.some((entityId) => skip.has(entityId)) && !(skip.has("project") && !entry.path.startsWith("/scenes") && !entry.path.startsWith("/media"));
    });
    // Entries that no longer apply one by one (their parent went away) are left out rather than failing the whole revert.
    const usable: StatePatch = [];
    let target = base.doc;
    for (const entry of patches) { try { target = applyPatch(target, [entry]); usable.push(entry); } catch { /* skipped */ } }
    try { acceptPatch(base.doc, usable, { registries: REGISTRIES, writer: { id: "agent" } }); } catch (error) { throw new ToolFailure("CONFLICT", "The inverse of this proposal no longer produces a valid project.", { documentCode: failureOf(error).details?.documentCode, conflicts }); }
    if (usable.length === 0) throw new ToolFailure("CONFLICT", "Nothing of this proposal is left to revert.", { conflicts });
    const result = await sync.host.applyBatch({ doc: projectRef(proposal.project_id), principal: `agent:${proposal.session_key}`, label: inverse.label, patches: [...usable, { op: "replace", path: "/metadata/updated_ms", value: now() }] as SyncPatchEntry[], baseRevision: base.revision, originDeviceId: by.deviceId, commandType: "agent.proposal.revert" });
    if (result.state === "waiting") throw new ToolFailure("LEASE_UNAVAILABLE", `${result.deviceName} is editing this project and did not take the change in time. Try again.`, { deviceName: result.deviceName });
    if (result.state === "rejected") throw new ToolFailure("CONFLICT", "The project changed while the revert was on its way. Try again.");
    proposal.body.reverted = { at_ms: now(), deviceId: by.deviceId, deviceName: deviceName(by.deviceId) };
    save(proposal);
    audit(db, now(), `device:${by.deviceId}`, "proposal.revert", { category: "agent", proposalId, action: "revert", deviceId: by.deviceId, changeCount: usable.length, revisionAfter: result.revision, timestamp_ms: now() });
    announce(proposal);
    return { proposal: view(proposal), revision: result.revision, skipped: conflicts.map((entry) => ({ entityId: entry.entityId })) };
  }

  const proposals: ProposalTools = {
    begin(session, projectId, title, summary) {
      const existing = current(session.sessionKey);
      if (existing?.state === "pending" || existing?.state === "applying") throw new ToolFailure("PROPOSAL_CLOSED", pendingMessage, { proposalId: existing.proposal_id });
      if (existing) { if (title !== undefined) existing.title = title; if (summary !== undefined) existing.summary = summary; save(existing); return { proposalId: existing.proposal_id, state: "open", changeCount: existing.body.calls.length, baseRevision: existing.base_revision }; }
      holdWriter(session, projectId);
      const proposal = open(session, projectId, title, summary);
      return { proposalId: proposal.proposal_id, state: "open", changeCount: 0, baseRevision: proposal.base_revision };
    },
    async submit(session, title, summary) {
      const existing = current(session.sessionKey);
      if (!existing) throw new ToolFailure("PROPOSAL_NOT_FOUND", "There is no open proposal to submit. Stage a change first.");
      if (existing.state !== "open") throw new ToolFailure("PROPOSAL_CLOSED", pendingMessage, { proposalId: existing.proposal_id });
      if (existing.body.calls.length === 0) throw new ToolFailure("INVALID_PARAMS", "The proposal has no change. Stage at least one change, or discard it with jc_proposal_discard.");
      const submitted = await submit(existing, session, title, summary);
      return { proposalId: submitted.proposal_id, state: "pending", changeCount: submitted.body.calls.length, note: "The user was shown the proposal. Its outcome arrives as a message; do not wait for it." };
    },
    status(session) {
      const existing = current(session.sessionKey);
      if (!existing) return { state: "none", changes: [] };
      const at = proposed(existing, session);
      return {
        proposalId: existing.proposal_id, state: existing.state, title: existing.title, baseRevision: existing.base_revision, changeCount: existing.body.calls.length,
        changes: existing.body.calls.map((call) => ({ changeId: call.changeId, tool: call.tool, summary: call.summary, ...call.change, dependsOn: call.dependsOn })),
        validation: at.failed.length === 0 ? { ok: true } : { ok: false, failed: at.failed.map((entry) => ({ changeId: entry.call.changeId, code: entry.error.code, message: entry.error.message })) },
        proposedDuration: at.doc.metadata.duration,
      };
    },
    discard(session) {
      const existing = current(session.sessionKey);
      if (!existing) throw new ToolFailure("PROPOSAL_NOT_FOUND", "There is no open proposal.");
      if (existing.state !== "open") throw new ToolFailure("PROPOSAL_CLOSED", pendingMessage, { proposalId: existing.proposal_id });
      close(existing, "discarded");
      return { proposalId: existing.proposal_id, state: "discarded", discardedChanges: existing.body.calls.length };
    },
    async revert(session, changeIds, proposalId, force) {
      if (proposalId) { const done = await revertApplied(proposalId, { deviceId: session.ownerDeviceId }, force); return { proposalId, state: "reverted", revision: done.revision, skipped: done.skipped }; }
      const existing = current(session.sessionKey);
      if (!existing) throw new ToolFailure("PROPOSAL_NOT_FOUND", "There is no open proposal. To undo an applied proposal pass its proposalId.");
      if (existing.state !== "open") throw new ToolFailure("PROPOSAL_CLOSED", pendingMessage, { proposalId: existing.proposal_id });
      const wanted = new Set(changeIds ?? []), unknown = [...wanted].filter((changeId) => !existing.body.calls.some((call) => call.changeId === changeId));
      if (wanted.size === 0 || unknown.length > 0) throw new ToolFailure("INVALID_PARAMS", wanted.size === 0 ? "Name the staged changes to remove in changeIds." : "Some change ids are not part of the open proposal.", { unknown });
      // Dependants go with the changes they build on.
      const gone = new Set(wanted);
      for (let grew = true; grew;) { grew = false; for (const call of existing.body.calls) if (!gone.has(call.changeId) && call.dependsOn.some((need) => gone.has(need))) { gone.add(call.changeId); grew = true; } }
      const base = replica(existing.project_id), rerun = replay(session, base, existing.body.calls.filter((call) => !gone.has(call.changeId)));
      for (const entry of rerun.failed) gone.add(entry.call.changeId);
      existing.body.calls = rerun.calls; existing.base_revision = base.revision;
      save(existing);
      working.set(existing.proposal_id, { revision: base.revision, doc: rerun.doc });
      return { proposalId: existing.proposal_id, state: "open", removedChangeIds: [...gone], changeCount: existing.body.calls.length };
    },
  };

  // — The device that has the project open —
  const projectConnections = (projectId: string) => sync.presence().filter((entry) => entry.openDoc?.kind === "project" && entry.openDoc.id === projectId);
  /** The client that has this session focused and the project open; no other connected client is ever used. */
  function focusedClient(session: SessionRecord, projectId: string): { connId: string; deviceId: string } | undefined {
    const open = projectConnections(projectId);
    const focused = open.find((entry) => entry.focusedSessionId === session.sessionKey) ?? open.find((entry) => reports.get(entry.connId)?.focusedSessionKey === session.sessionKey && reports.get(entry.connId)?.projectId === projectId);
    return focused && { connId: focused.connId, deviceId: focused.deviceId };
  }
  /** Sends an event to one connection; false when it is gone. */
  const sendTo = (connId: string, event: string, stream: string, payload: unknown): boolean => {
    let sent = false;
    try { deps.broadcast("jagentchill.projects.read", event, stream, payload, (entry) => { if (entry.connId !== connId) return false; sent = true; return true; }); } catch { return false; }
    return sent;
  };
  const leaseHolder: ToolHost["leaseHolder"] = (projectId) => {
    const lease = sync.leases.current(projectRef(projectId));
    return lease ? { kind: lease.holder.kind, name: lease.holderName, ...(lease.holder.kind === "device" ? { deviceId: lease.holder.deviceId } : {}) } : null;
  };

  /** The folder the calling session's agent CLI works in: what it made there is the agent's own work. */
  const workFolder = (session: SessionRecord): string | undefined => (deps.dataDir ? sessions().workdir(session.sessionKey) : undefined);
  const host: ToolHost = {
    get generation() { return deps.generation?.(); },
    get agents() { return deps.agents?.()?.tools; },
    get workflows() { return deps.workflows?.(); },
    get workflowRuns() { return deps.workflowRuns?.(); },
    get films() { return deps.films?.(); },
    proposals, leaseHolder,
    saveMotionScene(input) {
      const folder = workFolder(input.session);
      if (!folder) throw new ToolFailure("UNSUPPORTED_FEATURE", "This host has no agent work folder for motion scenes.");
      const name = input.name.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) throw new ToolFailure("INVALID_PARAMS", "Scene name must start with a letter or number and contain only letters, numbers, underscores or hyphens.", { field: "name" });
      try { validateMotionScene({ html: input.html, width: input.width, height: input.height, durationSeconds: input.durationSeconds, fps: input.fps }); }
      catch (error) { throw new ToolFailure("OUT_OF_RANGE", error instanceof Error ? error.message : "Scene settings are outside the supported range."); }
      const directory = join(folder, "motion-scenes");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const sourcePath = `motion-scenes/${name}.html`;
      const html = input.html;
      writeFileSync(join(directory, `${name}.html`), html, { mode: 0o600 });
      return { sourcePath, sha256: createHash("sha256").update(html).digest("hex") };
    },
    async renderMotionScene(input) {
      const folder = workFolder(input.session);
      if (!folder) throw new ToolFailure("UNSUPPORTED_FEATURE", "This host has no agent work folder for motion scenes.");
      if (!deps.renderHost) throw new ToolFailure("UNSUPPORTED_FEATURE", "This host has no isolated HTML scene renderer.");
      const name = input.name.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) throw new ToolFailure("INVALID_PARAMS", "Scene name must start with a letter or number and contain only letters, numbers, underscores or hyphens.", { field: "name" });
      const directory = join(folder, "motion-scenes");
      const sourcePath = `motion-scenes/${name}.html`, sourceFile = join(directory, `${name}.html`);
      if (input.html !== undefined) {
        try { validateMotionScene({ html: input.html, width: input.width, height: input.height, durationSeconds: input.durationSeconds, fps: input.fps }); }
        catch (error) { throw new ToolFailure("OUT_OF_RANGE", error instanceof Error ? error.message : "Scene settings are outside the supported range."); }
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        writeFileSync(sourceFile, input.html, { mode: 0o600 });
      }
      let source: string;
      try { source = readFileSync(sourceFile, "utf8"); } catch { throw new ToolFailure("NOT_FOUND", `No saved motion scene named "${name}" exists. Create or update it with its HTML first.`, { field: "name" }); }
      try { validateMotionScene({ html: source, width: input.width, height: input.height, durationSeconds: input.durationSeconds, fps: input.fps }); }
      catch (error) { throw new ToolFailure("OUT_OF_RANGE", error instanceof Error ? error.message : "Scene settings are outside the supported range."); }
      const configuredFfmpeg = process.env.JAGENTCHILL_FFMPEG;
      const ffmpegPath = configuredFfmpeg && existsSync(configuredFfmpeg) ? configuredFfmpeg : (process.env.PATH ?? "").split(delimiter).map((path) => join(path, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")).find((path) => existsSync(path));
      if (!ffmpegPath) throw new ToolFailure("UNSUPPORTED_FEATURE", "This host has no FFmpeg encoder for transparent video.");
      const outputPath = `motion-scenes/${name}.webm`, outputFile = join(directory, `${name}.webm`);
      let rendered;
      try { rendered = await deps.renderHost.renderMotionScene({ html: sceneHtmlForRender(source), width: input.width, height: input.height, durationSeconds: input.durationSeconds, fps: input.fps, outputPath: outputFile, ffmpegPath }); }
      catch (error) {
        const code = (error as { code?: string })?.code;
        throw new ToolFailure(code === "CANCELLED" ? "CANCELLED" : "PROVIDER_ERROR", `The HTML motion scene could not be rendered: ${error instanceof Error ? error.message : String(error)}.`, { reason: code ?? "render_failed" });
      }
      return { sourcePath, outputPath, frameCount: rendered.frameCount, bytes: rendered.bytes, width: rendered.width, height: rendered.height, durationSeconds: rendered.durationSeconds, fps: rendered.fps };
    },
    async stageMotionClip(input) {
      const result = await call(input.session.sessionKey, "jc_clip_add", { assetId: input.assetId, sceneId: input.sceneId, start: input.start, ...(input.trackId ? { trackId: input.trackId } : { newTrack: { zone: "overlay", type: "video" } }), mode: "fail_on_overlap", idempotencyKey: randomUUID() });
      if (!result.envelope.ok) {
        const failure = result.envelope.error!;
        throw new ToolFailure(failure.code as ErrorCode, failure.message, failure.details);
      }
      const data = result.envelope.data as Record<string, unknown>;
      return { ...(result.envelope.proposalId ? { proposalId: result.envelope.proposalId } : {}), ...(result.envelope.changeIds ? { changeIds: result.envelope.changeIds } : {}), ...(Array.isArray(data.elementIds) ? { elementIds: data.elementIds as string[] } : {}) };
    },
    listProjects(query) {
      const listed = sync.documents.list("project", { search: query.search, cursor: query.cursor, limit: query.limit, sort: "date" });
      return { items: listed.rows.map((row) => ({ id: row.id, name: row.name, duration: row.duration, updated_ms: row.updated_ms, head: row.head })), nextCursor: listed.nextCursor };
    },
    projectDocument(projectId) { try { return replica(projectId); } catch { return undefined; } },
    mediaDeviceIssues(projectId, assetId) { return sync.host.mediaDeviceIssues(projectId, assetId); },
    createProject(session, doc, bind) {
      const stored = sync.blobs.put(gzipSync(Buffer.from(canonicalJson(doc), "utf8")), { mime: "application/gzip", name: `project-${doc.metadata.id}-r1.json.gz`, purpose: "snapshot" });
      sync.documents.enable(projectRef(doc.metadata.id), stored.sha256, doc.schemaVersion, { kind: "host", principal: `agent:${session.sessionKey}` });
      if (bind) sessions().bindProject(session.sessionKey, doc.metadata.id);
      return { projectId: doc.metadata.id, revision: 1 };
    },
    setActiveScene(session, projectId, sceneId) {
      activeScenes.set(`${session.sessionKey}|${projectId}`, sceneId);
      return host.focusEditor(session, projectId, { sceneId });
    },
    editorContext(session, projectId) {
      const client = focusedClient(session, projectId);
      if (!client) return undefined;
      const presence = projectConnections(projectId).find((entry) => entry.connId === client.connId)!, report = reports.get(client.connId);
      return {
        deviceName: deviceName(client.deviceId), mode: presence.mode ?? "viewing", sceneId: report?.sceneId ?? presence.sceneId ?? null, playhead: report?.playhead ?? presence.playhead_ticks ?? 0,
        selectedElementIds: report?.selectedElementIds ?? [], selectedRange: report?.selectedRange ?? null, inPoint: report?.inPoint ?? null, outPoint: report?.outPoint ?? null,
        panel: report?.panel ?? null, zoomWindow: report?.zoomWindow ?? (presence.visibleRange ? { start: Math.max(0, presence.visibleRange.start), end: Math.max(0, presence.visibleRange.end) } : null),
      };
    },
    focusEditor(session, projectId, focus) {
      const client = focusedClient(session, projectId);
      return !!client && sendTo(client.connId, "jagentchill.editor.focus", `project:${projectId}`, { projectId, sessionKey: session.sessionKey, ...focus });
    },
    async renderFrames(session, projectId, request) {
      const client = focusedClient(session, projectId);
      if (!client) {
        if (!deps.renderHost || request.layout !== "separate" || request.overlays.length > 0 || request.patches?.length) return null;
        const project = replica(projectId), document = project.doc;
        const mediaSources = document.media.assets.flatMap((asset) => {
          if (!asset.contentHash) return [];
          try {
            const located = sync.blobs.locate(asset.contentHash);
            const original = "jagentchill-media://blob/" + asset.id + "?path=" + encodeURIComponent(located.path) + "&mime=" + encodeURIComponent(located.mime);
            return [{ assetId: asset.id, original }];
          } catch { return []; }
        });
        const canvas = document.settings.canvasSize;
        const height = Math.max(1, Math.round(request.width * canvas.height / canvas.width));
        const frames = [];
        const failed: number[] = [];
        for (let index = 0; index < request.times.length; index++) {
          try {
            const bytes = await deps.renderHost.renderStill({ document: document as unknown as Record<string, any>, revision: request.baseRevision, sceneId: request.sceneId, time: request.times[index], width: request.width, height, mediaSources });
            frames.push({ index, mime: "image/jpeg", dataBase64: Buffer.from(bytes).toString("base64"), width: request.width, height, time: request.times[index] });
          } catch { failed.push(index); }
        }
        return { frames, failed, renderer: "host", ...(failed.length ? { reason: "render_host_failed" } : {}) };
      }
      // One request at a time per device: its preview engine draws one document at a time, and a runtime that asks for
      // several frame sets in one step (parallel tool calls) would otherwise have every later one time out while waiting.
      // The runtime gives a tool call 60 s (its MCP timeout) and then reports only "timed out", with nothing drawn. The
      // whole call — the wait for an earlier frame set included — ends well before that, with what the device did draw.
      const started = Date.now(), callBudget = deps.timings?.frameCallMs ?? 45_000;
      const before = frameQueues.get(client.connId) ?? Promise.resolve();
      let release = (): void => undefined;
      const turn = before.then(() => new Promise<void>((done) => { release = done; }));
      frameQueues.set(client.connId, turn);
      await before;
      try {
      // The device gives the first frame three allowances (a cold start) and never lets one slow frame cost the next its own.
      const requestId = randomUUID(), wait = Math.max(1000, Math.min((deps.timings?.frameMs ?? 5000) * (request.times.length * 2 + 2) + 500, callBudget - (Date.now() - started)));
      const answer = new Promise<z.infer<(typeof TOOL_PARAMS)["jagentchill.editor.frame.result"]> | null>((done) => {
        const timer = setTimeout(() => { frameWaiters.delete(requestId); done(null); }, wait);
        frameWaiters.set(requestId, (result) => { clearTimeout(timer); frameWaiters.delete(requestId); done(result); });
      });
      if (!sendTo(client.connId, "jagentchill.editor.frame.request", `project:${projectId}`, { requestId, projectId, ...request, frameTimeout_ms: deps.timings?.frameMs ?? 5000 })) { frameWaiters.get(requestId)?.({ requestId, frames: [], failed: [] }); return null; }
      const result = await answer;
      // A client that did not answer at all produced no frame: every one of them is reported as failed.
      return result ? { frames: result.frames, failed: result.failed, ...(result.missingAssetIds ? { missingAssetIds: result.missingAssetIds } : {}), ...(result.reason ? { reason: result.reason } : {}) } : { frames: [], failed: request.times.map((_time, index) => index), reason: "timeout" };
      } finally { release(); if (frameQueues.get(client.connId) === turn) frameQueues.delete(client.connId); }
    },
    frameBudget(session, count) {
      const limit = FRAMES_PER_MINUTE;
      const stamp = now(), recent = (frameCalls.get(session.sessionKey) ?? []).filter((at) => stamp - at < 60_000);
      const resetIn = () => (recent.length ? Math.max(1, 60_000 - (stamp - recent[0]!)) : 0);
      if (recent.length + count > limit) {
        throw new ToolFailure("RATE_LIMITED", `The frame budget of this minute is used up (${limit} images per minute; ${limit - recent.length} left, ${count} asked). Work with the frames you already have. More can be rendered in ${Math.ceil(resetIn() / 1000)} s — do not call again before that; a contact sheet (layout "contact_sheet", up to 12 times) costs one image.`, { retryAfter_ms: resetIn(), limit, remaining: Math.max(0, limit - recent.length), reason: "frame_budget" });
      }
      for (let index = 0; index < count; index++) recent.push(stamp);
      frameCalls.set(session.sessionKey, recent);
      return { limit, remaining: limit - recent.length, resetIn_ms: resetIn() };
    },
    frameCache(session, key, value) {
      const cache = frameCaches.get(session.sessionKey) ?? frameCaches.set(session.sessionKey, new Map()).get(session.sessionKey)!;
      if (!value) return cache.get(key);
      cache.set(key, value);
      // The newest 24 pictures of a session are kept.
      while (cache.size > 24) cache.delete(cache.keys().next().value!);
      return value;
    },
    ask: (session, questions) => requests.ask(session, questions),
    trashProject(session, projectId) {
      try { sync.host.trash(projectRef(projectId), session.ownerDeviceId); } catch (error) {
        if (error instanceof ProtocolError && error.code === "CONFLICT") throw new ToolFailure("LEASE_UNAVAILABLE", `${String(error.details?.holderName ?? "A device")} is editing this project, so it cannot be moved to the trash now. Ask the user to close it there first.`, error.details);
        throw error;
      }
      audit(db, now(), `agent:${session.sessionKey}`, "sync.doc.trash", { doc: projectRef(projectId), category: "agent" });
    },
    trashedProject(projectId) { const row = sync.documents.row(projectRef(projectId)); return row?.state === "trash" ? { name: row.name } : undefined; },
    restoreProject(session, projectId) {
      const revision = sync.host.restore(projectRef(projectId));
      audit(db, now(), `agent:${session.sessionKey}`, "sync.trash.restore", { kind: "project", id: projectId, category: "agent" });
      return { revision };
    },
    async importMedia(session, projectId, source, fields, check) {
      const blobs = sync.blobs;
      let sha256: string, fileName: string, provenance: Record<string, unknown>;
      if (source.kind === "url") {
        const net = deps.timings?.net ?? systemNet, url = importUrl(source.url), address = await vetAddress(net, url);
        // The person is asked only for an address that can be imported from at all.
        check(url);
        if (!deps.dataDir) throw new ToolFailure("UNSUPPORTED_FEATURE", "This host has no place to download to.");
        const downloaded = await downloadToFile(net, url, address, join(deps.dataDir, "tmp"));
        fileName = fields.name ?? (decodeURIComponent(downloaded.finalUrl.pathname.split("/").filter(Boolean).pop() ?? "") || "download");
        sha256 = downloaded.sha256;
        await storeFile(blobs, downloaded, fileName, session.ownerDeviceId);
        void sync.mediaJobs.originalArrived(sha256);
        provenance = { source: "url", url: `${url.origin}${url.pathname}`.slice(0, 2000), originalFileName: fileName.slice(0, 255) };
      } else if (source.kind === "workspace") {
        const folder = workFolder(session);
        if (!deps.dataDir || !folder) throw new ToolFailure("UNSUPPORTED_FEATURE", "This host has no agent work folder.");
        const copied = await copyWorkspaceFile(folder, source.path, join(deps.dataDir, "tmp"));
        fileName = fields.name ?? copied.name;
        sha256 = copied.sha256;
        await storeFile(blobs, copied, fileName, session.ownerDeviceId);
        void sync.mediaJobs.originalArrived(sha256);
        provenance = fields.provenance ?? { source: "imported", originalFileName: fileName.slice(0, 255), tool: "agent" };
      } else {
        const status = blobs.status(source.blobId), about = blobs.describe(source.blobId);
        if (status.state === "absent" || !about || about.purpose !== "media" || about.variantOf !== null) throw new ToolFailure("NOT_FOUND", "No uploaded file has this blobId. Use the id of a file the user attached.", { blobId: source.blobId });
        if (status.state !== "complete") throw new ToolFailure("ASSET_NOT_READY", "The upload of this file has not finished yet. Try again shortly.", { blobId: source.blobId });
        sha256 = source.blobId; fileName = fields.name ?? (blobs.get(sha256).name || "upload");
        provenance = fields.provenance ?? { source: "imported", originalFileName: fileName.slice(0, 255), deviceId: session.ownerDeviceId };
      }
      let facts;
      try { facts = await sync.mediaJobs.probe(blobs.locate(sha256).path); } catch (error) {
        if (error instanceof ProtocolError && error.code === "FFMPEG_UNAVAILABLE") throw new ToolFailure("UNSUPPORTED_FEATURE", "This host has no FFmpeg, so it cannot read what the file is. Ask the user to import the file on a device instead.");
        throw new ToolFailure("INVALID_PARAMS", "The file is not a video, an audio file or an image this editor can read.", { field: "source", reason: "not_media" });
      }
      if (!facts.video && !facts.audio && !facts.image) throw new ToolFailure("INVALID_PARAMS", "The file is not a video, an audio file or an image this editor can read.", { field: "source", reason: "not_media" });
      const type = facts.image ? "image" : facts.video ? "video" : "audio", size = blobs.locate(sha256).size;
      const record = {
        name: fileName.slice(0, 255), type, size, contentHash: sha256, ...(facts.width > 0 && type !== "audio" ? { width: facts.width, height: facts.height } : {}),
        ...(type !== "image" ? { duration: Math.max(1, Math.round(facts.duration_s * 120_000)), hasAudio: facts.audio } : {}), ...(type === "video" && facts.codec ? { videoCodec: facts.codec.slice(0, 40) } : {}),
        ...(fields.folderId ? { folderId: fields.folderId } : {}), ...(fields.tags ? { tags: fields.tags } : {}), provenance,
      } as const;
      for (let attempt = 0; ; attempt++) {
        const base = replica(projectId);
        if (fields.folderId && !base.doc.media.folders.some((folder) => folder.id === fields.folderId)) throw new ToolFailure("NOT_FOUND", `No folder of the library has the id "${fields.folderId}". List the folders with jc_media_list.`, { folderId: fields.folderId });
        // The same file imported again is the asset the library already has.
        const known = base.doc.media.assets.find((asset) => asset.contentHash === sha256);
        // … unless that record calls a sound a video (a song's cover art was once read as a video stream): no engine can
        // draw a frame of it, so the record and the clips that use it are corrected here, as one step of the project.
        if (known && known.type === "video" && type === "audio") {
          let fixed;
          try { fixed = correctSoundAsset(base.doc, commitContext(randomUUID()), known.id); } catch (error) { throw failureOf(error); }
          const patches = withoutStamp(diffDocuments(base.doc, fixed.document));
          const result = await sync.host.applyBatch({ doc: projectRef(projectId), principal: `agent:${session.sessionKey}`, label: `${known.name}: a sound, not a video`, patches: [...patches, { op: "replace", path: "/metadata/updated_ms", value: now() }] as SyncPatchEntry[], baseRevision: base.revision, originDeviceId: session.ownerDeviceId, commandType: "media.correct-kind" });
          if (result.state === "waiting") throw new ToolFailure("LEASE_UNAVAILABLE", `${result.deviceName} is editing this project and did not take the correction in time. Try again.`, { deviceName: result.deviceName });
          if (result.state === "rejected") { if (attempt < 2) continue; throw new ToolFailure("CONFLICT", "The project changed while the correction was on its way. Try again."); }
          return { assetId: known.id, name: known.name, kind: "audio", state: "ready", alreadyInLibrary: true, corrected: { from: "video", to: "audio", elementIds: fixed.elementIds, note: "The library had recorded this sound as a video. It is an audio asset now, and the clips that used it are audio clips on an audio track (same ids)." }, revision: result.revision };
        }
        if (known) return { assetId: known.id, name: known.name, kind: known.type, state: "ready", alreadyInLibrary: true, revision: base.revision };
        // Every imported asset is committed only while its exact host blob is still present. This is normally
        // guaranteed by the upload, URL-download and generation paths above; checking at the document boundary
        // prevents a failed/disappearing fetch from leaving another device with a hash it can never download.
        let stored: ReturnType<typeof blobs.status>, description: ReturnType<typeof blobs.describe>;
        // A blob that vanished entirely makes the store answer NOT_FOUND ("No such blob."): that is this same case.
        try { stored = blobs.status(sha256); description = blobs.describe(sha256); } catch {
          throw new ToolFailure("BLOB_UNAVAILABLE", `The media bytes for "${fileName}" are no longer on the host, so the asset was not added. Retry the import.`, { contentHash: sha256, expectedSize: size });
        }
        if (stored.state !== "complete" || stored.size !== size || !description || description.purpose !== "media" || description.variantOf !== null) {
          throw new ToolFailure("BLOB_UNAVAILABLE", `The media bytes for "${fileName}" are no longer complete on the host, so the asset was not added. Retry the import.`, { contentHash: sha256, expectedSize: size, actualSize: stored.size, state: stored.state });
        }
        try {
          const located = blobs.locate(sha256);
          if (located.sha256 !== sha256 || located.size !== size) throw new Error("blob address or size changed");
        } catch {
          throw new ToolFailure("BLOB_UNAVAILABLE", `The media bytes for "${fileName}" are no longer readable on the host, so the asset was not added. Retry the import.`, { contentHash: sha256, expectedSize: size });
        }
        let made;
        try { made = addAsset(base.doc, commitContext(randomUUID()), record); } catch (error) { throw failureOf(error); }
        const patches = withoutStamp(diffDocuments(base.doc, made.document));
        const result = await sync.host.applyBatch({ doc: projectRef(projectId), principal: `agent:${session.sessionKey}`, label: `Import ${record.name}`, patches: [...patches, { op: "replace", path: "/metadata/updated_ms", value: now() }] as SyncPatchEntry[], baseRevision: base.revision, originDeviceId: session.ownerDeviceId, commandType: "media.add" });
        if (result.state === "waiting") throw new ToolFailure("LEASE_UNAVAILABLE", `${result.deviceName} is editing this project and did not take the import in time. Try again.`, { deviceName: result.deviceName });
        if (result.state === "rejected") { if (attempt < 2) continue; throw new ToolFailure("CONFLICT", "The project changed while the import was on its way. Try again."); }
        return { assetId: made.assetId, name: record.name, kind: type, state: "ready", sizeBytes: size, ...(record.duration !== undefined ? { duration: record.duration } : {}), ...("width" in record ? { width: record.width, height: record.height } : {}), revision: result.revision };
      }
    },
    writeProjectFile(projectId, folder, fileName, text) {
      if (!deps.dataDir) throw new ToolFailure("UNSUPPORTED_FEATURE", "This host has no workspace directory to write files to.");
      const dir = join(deps.dataDir, "workspaces", projectId, folder), bytes = Buffer.from(text, "utf8");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(join(dir, fileName), bytes, { mode: 0o600 });
      return { path: `${folder}/${fileName}`, name: fileName, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    },
    proposalPatches(session) {
      const existing = current(session.sessionKey);
      if (!existing) return undefined;
      const at = proposed(existing, session);
      return { baseRevision: at.base.revision, patches: withoutStamp(diffDocuments(at.base.doc, at.doc)) };
    },
  };

  methods.set("jagentchill.media.probe", {
    scope: SYNC_METHODS["jagentchill.media.probe"],
    handle: async (raw) => {
      const parsed = SYNC_PARAMS["jagentchill.media.probe"].parse(raw ?? {});
      const status = sync.blobs.status(parsed.sha256);
      if (status.state !== "complete" || !sync.blobs.describe(parsed.sha256)) throw new ProtocolError("NOT_FOUND", "No complete uploaded media has this hash.", { httpStatus: 404 });
      return sync.mediaJobs.probe(sync.blobs.locate(parsed.sha256).path);
    },
  });
  methods.set("jagentchill.media.import", {
    scope: SYNC_METHODS["jagentchill.media.import"],
    handle: async (raw, connection) => {
      const parsed = SYNC_PARAMS["jagentchill.media.import"].parse(raw ?? {});
      if (!connection.scopes().includes("jagentchill.projects.write")) throw new ProtocolError("PERMISSION_DENIED", "Importing media into a project requires project write access.", { httpStatus: 403 });
      const session = { sessionKey: `device:${connection.deviceId}`, ownerDeviceId: connection.deviceId } as SessionRecord;
      try {
        return await host.importMedia(session, parsed.projectId, { kind: "upload", blobId: parsed.sha256 }, { ...(parsed.name ? { name: parsed.name } : {}) }, () => undefined);
      } catch (error) {
        if (error instanceof ToolFailure) throw new ProtocolError(error.code, error.message, { details: error.details, retryable: RETRYABLE_TOOL_CODES.includes(error.code), httpStatus: 409 });
        throw error;
      }
    },
  });

  // — One call —
  function rateGuard(session: SessionRecord): void {
    const stamp = now(), recent = (calls.get(session.sessionKey) ?? []).filter((at) => stamp - at < 60_000);
    if (recent.length >= TOOL_RATE_LIMITS.callsPerMinute) throw new ToolFailure("RATE_LIMITED", "Too many tool calls in the last minute. Wait and call again.", { retryAfter_ms: Math.max(1, 60_000 - (stamp - recent[0])), limit: TOOL_RATE_LIMITS.callsPerMinute });
    const turn = turnCounts.get(session.sessionKey) ?? { calls: 0, staged: 0 };
    const perTurn = Math.min(TOOL_RATE_LIMITS.callsPerTurn, deps.callsPerTurn?.() ?? TOOL_RATE_LIMITS.callsPerTurn);
    if (turn.calls >= perTurn) throw new ToolFailure("RATE_LIMITED", "The agent reached the per-turn limit of tool calls. End the turn; the user can ask to continue.", { retryAfter_ms: 1000, reason: "per_turn_limit", limit: perTurn });
    recent.push(stamp); calls.set(session.sessionKey, recent);
    turn.calls += 1; turnCounts.set(session.sessionKey, turn);
  }
  /** Reads see what the editing device has flushed: a device that reported unsynced changes is given two seconds. */
  async function settled(projectId: string, warnings: string[]): Promise<void> {
    const lease = sync.leases.current(projectRef(projectId));
    if (lease?.holder.kind !== "device") return;
    const connId = lease.holder.connId, ahead = () => { const report = reports.get(connId); return !!report && report.projectId === projectId && (report.pendingOps ?? 0) > 0 && now() - report.at_ms < 10_000; };
    if (!ahead()) return;
    const deadline = Date.now() + (deps.timings?.flushMs ?? DEVICE_FLUSH_WAIT_MS);
    while (ahead() && Date.now() < deadline) await new Promise((done) => setTimeout(done, 25));
    if (ahead()) warnings.push("device_ahead");
  }
  const redact = (value: unknown): unknown => {
    if (typeof value === "string") return value.replace(/([?&][^=&#\s]+)=([^&#\s]+)/g, "$1=[redacted]");
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redact(entry)]));
    return value;
  };
  const digest = (name: string, args: unknown) => createHash("sha256").update(`${name}\n${canonicalJson(args as object)}`).digest("hex");
  /**
   * Reads of the person's OWN project and library, and the person's own answer to a question: their results carry the
   * mark `untrusted: true` for the model (names and captions are data, never instructions), but they are not content
   * from outside the user and the system and do not taint the session (ruling of 2026-10-09).
   */
  const OWN_CONTENT = new Set(["jc_session_ask", "jc_timeline_snapshot", "jc_timeline_find", "jc_media_list", "jc_media_get"]);
  /** `agent-editing-tools.Untrusted content handling`: once content from OUTSIDE has been returned in a session it is tainted for the rest of its life. */
  function noteUntrusted(sessionKey: string, name: string, data: unknown): void {
    if (OWN_CONTENT.has(name)) return;
    const outside = untrustedIn(data);
    if (outside.found) requests.taint(sessionKey, `tool:${name}`, outside.texts);
  }
  function record(session: SessionRecord | undefined, sessionKey: string, tool: ToolDefinition | undefined, name: string, args: unknown, envelope: ToolEnvelope, started: number, extra: { outcome?: string; revisionBefore?: number } = {}): void {
    const params = JSON.stringify(redact(args ?? {}));
    audit(db, now(), `agent:${sessionKey}`, "tool.call", {
      category: "agent", actor: { kind: "agent", sessionId: sessionKey, agentId: session?.agentId ?? null, deviceId: session?.ownerDeviceId ?? null }, tool: name, family: tool?.family ?? null, owner: "agent-editing-tools",
      projectId: session?.projectId ?? null, paramsDigest: digest(name, args ?? {}), params: params.length > 16_384 ? `${params.slice(0, 16_384)}…` : JSON.parse(params), dryRun: (args as Json | undefined)?.dryRun === true,
      outcome: extra.outcome ?? (envelope.replayed ? "replayed" : envelope.ok ? "ok" : "error"), ...(envelope.error ? { errorCode: envelope.error.code } : {}), ...(envelope.proposalId ? { proposalId: envelope.proposalId } : {}),
      changeIds: envelope.changeIds ?? [], jobIds: [], untrustedSeen: requests.isTainted(sessionKey), duration_ms: now() - started, ...(extra.revisionBefore !== undefined ? { revisionBefore: extra.revisionBefore } : {}), ...(envelope.revision !== undefined ? { revisionAfter: envelope.revision } : {}),
    });
  }
  const fitted = (envelope: ToolEnvelope): ToolEnvelope => {
    if (Buffer.byteLength(JSON.stringify(envelope), "utf8") <= TOOL_RESULT_MAX_BYTES) return envelope;
    return { ok: false, warnings: [], error: { code: "RESULT_TOO_LARGE", message: "The result is larger than 32 KiB. Ask for less: a smaller limit, a range, or detail \"summary\" (or \"standard\").", retryable: false, details: { detail: "standard" } } };
  };

  function compactRepeatedRead(sessionKey: string, name: string, args: Json, envelope: ToolEnvelope): ToolEnvelope {
    if (!envelope.ok || !["jc_timeline_snapshot", "jc_timeline_find", "jc_media_list", "jc_project_list"].includes(name)) return envelope;
    const key = `${sessionKey}\n${name}\n${canonicalJson(args)}`;
    const fingerprint = createHash("sha256").update(canonicalJson(envelope)).digest("hex");
    const previous = readViews.get(key);
    const data = envelope.data && typeof envelope.data === "object" ? envelope.data as Record<string, unknown> : {};
    const rows = (source: Record<string, unknown>) => [
      ...(Array.isArray(source.elements) ? source.elements : []),
      ...(Array.isArray(source.assets) ? source.assets : []),
      ...(Array.isArray(source.projects) ? source.projects : []),
      ...(Array.isArray(source.tracks) ? source.tracks.flatMap((track) => track && typeof track === "object" && Array.isArray((track as Record<string, unknown>).elements) ? (track as Record<string, unknown>).elements as unknown[] : []) : []),
    ];
    const indexed = (source: Record<string, unknown>) => new Map(rows(source).flatMap((item) => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : undefined;
      return typeof row?.id === "string" ? [[row.id, canonicalJson(row)] as const] : [];
    }));
    const current = indexed(data), oldData = previous?.envelope.data && typeof previous.envelope.data === "object" ? previous.envelope.data as Record<string, unknown> : {};
    const old = indexed(oldData), ids = [...current.keys()];
    const addedIds = ids.filter((id) => !old.has(id)), removedIds = [...old.keys()].filter((id) => !current.has(id));
    const modifiedIds = ids.filter((id) => old.has(id) && old.get(id) !== current.get(id));
    const count = typeof data.elementCount === "number" ? data.elementCount
      : typeof data.total === "number" ? data.total
        : ids.length;
    const changed = previous !== undefined && (addedIds.length > 0 || removedIds.length > 0 || modifiedIds.length > 0 || (current.size === 0 && previous.digest !== fingerprint));
    const receipt: ToolEnvelope = {
      ok: true, warnings: envelope.warnings, ...(envelope.revision !== undefined ? { revision: envelope.revision } : {}),
      data: { unchanged: !changed, tool: name, count, ...(changed ? { addedIds, modifiedIds, removedIds } : { ids }), ...(typeof data.sceneId === "string" ? { sceneId: data.sceneId } : {}) },
      summary: changed
        ? `Compared with the previous ${name} result: ${addedIds.length} added, ${modifiedIds.length} changed and ${removedIds.length} removed of ${count} items. Read a narrower range, track or id for full detail.`
        : `Unchanged from the previous ${name} result (${count} item${count === 1 ? "" : "s"}). Reuse that result; ask for a range, ids, or detail for more.`,
    };
    if (previous?.digest === fingerprint) return previous.receipt;
    readViews.set(key, { digest: fingerprint, envelope, receipt });
    if (previous) return receipt;
    return envelope;
  }

  /**
   * Runs a tool for a session the caller has already identified (the MCP endpoint by its binding, a test directly).
   * Always answers with the result envelope; `images` follow the JSON block.
   */
  async function call(sessionKey: string, name: string, raw: unknown): Promise<{ envelope: ToolEnvelope; images: { mime: string; dataBase64: string }[] }> {
    const started = now(), images: { mime: string; dataBase64: string }[] = [], adjusted: string[] = [];
    const session = sessions().session(sessionKey), tool = tools.get(name);
    const failed = (failure: ToolFailure, outcome?: string): { envelope: ToolEnvelope; images: never[] } => {
      const envelope: ToolEnvelope = { ok: false, warnings: [], error: failure.envelope() };
      record(session, sessionKey, tool, name, raw, envelope, started, outcome ? { outcome } : {});
      if (session) notice(session, name, failure);
      return { envelope, images: [] };
    };
    if (!session) return failed(new ToolFailure("SESSION_UNBOUND", "The calling session is not known to the server. Call the tool again.", { reason: "no_session" }), "denied");
    if (!tool || !served(tool) || !toolNamesForSurface([name], surfaceForSession(session)).length) return failed(new ToolFailure("TOOL_NOT_AVAILABLE", `The tool ${name} is not in this session's catalogue.`, { tool: name }), "denied");
    try {
      rateGuard(session);
      const schema = schemas.get(name)!;
      // A page size above its maximum, or a summary a few characters too long, is not worth a refused call (the work log
      // showed each as a red failure): the value is brought inside its range and the agent is told.
      let parsed = schema.safeParse(raw ?? {});
      for (let pass = 0; !parsed.success && pass < 4; pass++) {
        const eased = easedParams(raw, parsed.error);
        if (!eased) break;
        raw = eased.raw; adjusted.push(eased.note);
        parsed = schema.safeParse(raw);
      }
      if (!parsed.success) throw schemaFailure(schema, raw, parsed.error);
      const args = parsed.data as Json;
      tool.refine?.(args as never);
      // Mode and plan gates come before anything is looked up.
      if (!tool.readOnly) {
        if (session.modeId === "ask") throw new ToolFailure("MODE_READ_ONLY", "This session is in Ask mode: nothing can be changed. Describe the change instead, or ask the user to switch to Edit mode.");
        if (session.modeId === "plan") throw new ToolFailure("PLAN_NOT_APPROVED", "This session is in Plan mode and no plan is approved. Present the plan; changes are staged after the user switches to Edit mode.");
      }
      const key = typeof args.idempotencyKey === "string" ? args.idempotencyKey : undefined, hash = digest(name, args);
      if (key) {
        const stored = db.prepare("SELECT hash, result, ts_ms FROM tool_idempotency WHERE session_key = ? AND key = ?").get(session.sessionKey, key) as { hash: string; result: string; ts_ms: number } | undefined;
        if (stored && now() - stored.ts_ms < IDEMPOTENCY_RETENTION_MS) {
          if (stored.hash !== hash) throw new ToolFailure("IDEMPOTENCY_CONFLICT", "This idempotencyKey was already used with other parameters. Use a new key for a different call.", { field: "idempotencyKey" });
          const envelope = { ...(JSON.parse(stored.result) as ToolEnvelope), replayed: true };
          // A result that is returned again is returned all the same: what it carries from outside taints the session.
          noteUntrusted(sessionKey, name, envelope.data);
          record(session, sessionKey, tool, name, raw, envelope, started);
          return { envelope, images };
        }
      }
      const remember = (envelope: ToolEnvelope) => { if (key && args.dryRun !== true) db.prepare("INSERT OR REPLACE INTO tool_idempotency (session_key, key, hash, result, ts_ms) VALUES (?, ?, ?, ?, ?)").run(session.sessionKey, key, hash, JSON.stringify(envelope), now()); };

      const projectId = (typeof args.projectId === "string" ? args.projectId : undefined) ?? session.projectId;
      if (tool.needsProject && !projectId) throw new ToolFailure("NO_PROJECT_BOUND", "This session is not working on a project. Ask the user to open a project, or create one with jc_project_create.");
      const attachMediaIssues = (doc: ProjectDocument, data: unknown, summary: string) => {
        const payload = data && typeof data === "object" ? data as Record<string, unknown> : {};
        const assetIds = new Set<string>();
        if (typeof payload.assetId === "string") assetIds.add(payload.assetId);
        if (Array.isArray(payload.assets)) for (const entry of payload.assets) if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).assetId === "string") assetIds.add((entry as Record<string, string>).assetId);
        if (name === "jc_clip_add" || name === "jc_clip_replace_media") {
          if (typeof (args as Record<string, unknown>).assetId === "string") assetIds.add((args as Record<string, string>).assetId);
          if (Array.isArray((args as Record<string, unknown>).items)) for (const entry of (args as Record<string, unknown>).items as Record<string, unknown>[]) if (typeof entry?.assetId === "string") assetIds.add(entry.assetId);
        }
        const issues = [...assetIds].flatMap((assetId) => {
          const asset = doc.media.assets.find((entry) => entry.id === assetId);
          return sync.host.mediaDeviceIssues(projectId!, assetId).map((issue) => ({ assetId, name: asset?.name ?? assetId, ...issue }));
        });
        return issues.length ? {
          data: { ...payload, deviceMediaIssues: issues },
          summary: `${summary} ${issues.map((issue) => `${issue.deviceName} could not get "${clip(issue.name, 60)}": ${issue.reason || issue.state}.`).join(" ")}`,
        } : { data, summary };
      };
      let envelope: ToolEnvelope;
      if (tool.kind === "staged" && !tool.unstaged?.(args as never)) {
        const dryRun = args.dryRun === true, existing = current(session.sessionKey);
        if (existing && existing.state !== "open") throw new ToolFailure("PROPOSAL_CLOSED", pendingMessage, { proposalId: existing.proposal_id });
        if (existing && existing.project_id !== projectId) throw new ToolFailure("PROPOSAL_CLOSED", "The open proposal belongs to another project. Submit or discard it first.", { proposalId: existing.proposal_id });
        const base = replica(projectId!);
        // A dry run needs neither the writer token nor a proposal.
        if (!dryRun) await acquireWriter(session, projectId!);
        const at = existing ? proposed(existing, session) : { base, doc: base.doc, failed: [] };
        if (at.failed.length > 0) { close(existing!, "stale"); throw new ToolFailure("PROPOSAL_STALE", "The project changed and the staged changes no longer apply. Read the timeline again and rebuild the proposal.", { failed: at.failed.map((entry) => entry.call.changeId) }); }
        if (!dryRun && (existing?.body.calls.length ?? 0) >= PROPOSAL_MAX_CHANGES) throw new ToolFailure("PROPOSAL_TOO_LARGE", `A proposal holds at most ${PROPOSAL_MAX_CHANGES} changes. Submit this one before staging more.`, { limit: PROPOSAL_MAX_CHANGES });
        const turn = turnCounts.get(session.sessionKey);
        if (!dryRun && turn && turn.staged >= TOOL_RATE_LIMITS.stagedChangesPerTurn) throw new ToolFailure("RATE_LIMITED", "The agent reached the per-turn limit of staged changes. End the turn; the user can ask to continue.", { retryAfter_ms: 1000, reason: "per_turn_limit", limit: TOOL_RATE_LIMITS.stagedChangesPerTurn });
        const changeId = randomUUID(), seed = `${changeId}`;
        const done = execute(tool, session, at.base, at.doc, args, seed, dryRun);
        const mediaResult = attachMediaIssues(done.doc, done.outcome.data, done.outcome.summary);
        done.outcome.data = mediaResult.data as Record<string, unknown>;
        done.outcome.summary = mediaResult.summary;
        const patch = withoutStamp(diffDocuments(at.doc, done.doc));
        const fps = done.doc.settings.fps, data = withTimecodes({ ...done.outcome.data, proposedDuration: done.doc.metadata.duration, ...(dryRun ? { provisional: true } : {}) }, fps);
        if (dryRun) envelope = { ok: true, data, warnings: done.warnings, revision: at.base.revision, changeIds: [], summary: clip(done.outcome.summary) };
        else if (patch.length === 0) {
          // Nothing changed: no change is recorded, and a proposal is not opened for it.
          envelope = { ok: true, data, warnings: [...new Set([...done.warnings, "no_change"])], revision: at.base.revision, ...(existing ? { proposalId: existing.proposal_id } : {}), changeIds: [], summary: clip(done.outcome.summary) };
          if (!existing) releaseWriter(projectId!, session.sessionKey);
        } else {
          const proposal = existing ?? open(session, projectId!);
          const before = entities(at.doc), after = entities(done.doc);
          const createdIds = [...after.keys()].filter((entityId) => !before.has(entityId));
          const touchedIds = [...new Set([...[...after.keys()].filter((entityId) => before.has(entityId) && before.get(entityId) !== after.get(entityId)), ...[...before.keys()].filter((entityId) => !after.has(entityId))])];
          // A change depends on the earlier changes that created what it touches.
          const named = new Set([...touchedIds, ...JSON.stringify(args).match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g) ?? []]);
          const dependsOn = proposal.body.calls.filter((earlier) => earlier.createdIds.some((entityId) => named.has(entityId))).map((earlier) => earlier.changeId);
          proposal.body.calls.push({ changeId, tool: name, args, seed, summary: clip(done.outcome.summary), change: done.outcome.change, patch, createdIds, touchedIds, dependsOn, at_ms: now(), ...(done.outcome.data ? { data: done.outcome.data } : {}) });
          save(proposal);
          working.set(proposal.proposal_id, { revision: at.base.revision, doc: done.doc });
          if (turn) turn.staged += 1;
          envelope = { ok: true, data, warnings: done.warnings, revision: at.base.revision, proposalId: proposal.proposal_id, changeIds: [changeId], summary: clip(done.outcome.summary) };
        }
        envelope = fitted(envelope);
        if (adjusted.length && envelope.ok) envelope = { ...envelope, warnings: [...adjusted, ...envelope.warnings] };
        if (envelope.ok) remember(envelope);
        record(session, sessionKey, tool, name, raw, envelope, started, { revisionBefore: at.base.revision });
        return { envelope, images };
      }

      // Reads and non-staged effects.
      const warnings: string[] = [];
      let ctx: ToolContext | undefined;
      if (tool.needsProject) {
        if (tool.readOnly) await settled(projectId!, warnings);
        const base = replica(projectId!);
        let doc = base.doc;
        const { idempotencyKey: _key, dryRun: _dry, ...rest } = args as Json;
        if (rest.includeProposed === true) {
          const existing = current(session.sessionKey);
          if (existing && existing.project_id === projectId) { const at = proposed(existing, session); if (at.failed.length === 0) doc = at.doc; }
        }
        ctx = makeContext(session, projectId!, base, doc, randomUUID(), args.dryRun === true, timeline.hostEditContext());
        ctx.warnings.push(...warnings);
      } else {
        const empty = { doc: undefined as unknown as ProjectDocument, revision: 0 };
        ctx = makeContext(session, "", empty, empty.doc, randomUUID(), args.dryRun === true, timeline.hostEditContext());
      }
      // A dry run has no effect to allow; otherwise an allow is spent by the call it was given for.
      // A generation prompt that copies 200 or more characters in a row of the untrusted content this session was given
      // is shown in full before any provider call — in the card of the call (the one that asks about its cost), never in a second one.
      const prompt = tool.family === "generate" ? String((args as { prompt?: unknown; text?: unknown }).prompt ?? (args as { text?: unknown }).text ?? "") : "";
      const copiedUrl = name === "jc_media_import" && (args as { source?: { kind?: unknown; url?: unknown } }).source?.kind === "url"
        ? String((args as { source: { url?: unknown } }).source.url ?? "") : "";
      const copiedText = prompt || copiedUrl;
      const copied = !!copiedText && requests.isTainted(sessionKey) && requests.copiesUntrusted(sessionKey, copiedText);
      ctx.permit = Object.assign((ask: Parameters<ToolContext["permit"]>[0]) => {
        if (args.dryRun !== true) requests.permit(session, name, args, copied ? { ...ask, copiedPrompt: copiedText } : ask);
      }, copied ? { always: true } : {});
      let result: unknown;
      try { result = await tool.handle(ctx, args as never); } catch (error) { throw failureOf(error); }
      const out = (result ?? {}) as { data?: unknown; images?: { mime: string; dataBase64: string }[]; proposalId?: string; changeIds?: string[]; summary?: string; revision?: number };
      const returnedData = out.data && typeof out.data === "object" ? out.data as Record<string, unknown> : {};
      const reportedAssetIds = new Set<string>();
      if (typeof returnedData.assetId === "string") reportedAssetIds.add(returnedData.assetId);
      if (Array.isArray(returnedData.assets)) for (const asset of returnedData.assets) if (asset && typeof asset === "object" && typeof (asset as Record<string, unknown>).assetId === "string") reportedAssetIds.add((asset as Record<string, string>).assetId);
      if (name === "jc_clip_add" || name === "jc_clip_replace_media") {
        if (typeof (args as Record<string, unknown>).assetId === "string") reportedAssetIds.add((args as Record<string, string>).assetId);
        if (Array.isArray((args as Record<string, unknown>).items)) for (const item of (args as Record<string, unknown>).items as Record<string, unknown>[]) if (typeof item?.assetId === "string") reportedAssetIds.add(item.assetId);
      }
      const deviceMediaIssues = [...reportedAssetIds].flatMap((assetId) => {
        const asset = ctx!.doc.media.assets.find((entry) => entry.id === assetId);
        return ctx!.mediaDeviceIssues(assetId).map((issue) => ({ assetId, name: asset?.name ?? assetId, ...issue }));
      });
      if (deviceMediaIssues.length) {
        const notices = deviceMediaIssues.map((issue) => `${issue.deviceName} could not get "${clip(issue.name, 60)}": ${issue.reason || issue.state}.`);
        out.summary = `${out.summary ?? "Media added."} ${notices.join(" ")}`;
        out.data = { ...returnedData, deviceMediaIssues };
      }
      if (out.images) images.push(...out.images);
      const fps = tool.needsProject ? ctx.doc.settings.fps : { numerator: 30, denominator: 1 };
      envelope = compactRepeatedRead(sessionKey, name, args, fitted({
        ok: true, data: withTimecodes("data" in out ? out.data : result, fps), warnings: ctx.warnings, ...(tool.needsProject ? { revision: out.revision ?? ctx.revision } : out.revision !== undefined ? { revision: out.revision } : {}),
        ...(out.proposalId ? { proposalId: out.proposalId } : {}), ...(out.changeIds ? { changeIds: out.changeIds } : {}), ...(out.summary ? { summary: out.summary } : {}),
      }));
      if (adjusted.length && envelope.ok) envelope = { ...envelope, warnings: [...adjusted, ...envelope.warnings] };
      if (envelope.ok && !tool.readOnly) remember(envelope);
      // Content from outside the user and the system was returned to the model: the session is tainted from here on.
      noteUntrusted(sessionKey, name, envelope.data);
      record(session, sessionKey, tool, name, raw, envelope, started, tool.needsProject ? { revisionBefore: ctx.revision } : {});
      return { envelope, images };
    } catch (error) {
      if (error instanceof ToolFailure) return failed(error);
      // The blob store's "No such blob." is media whose bytes left the host while the tool worked with them.
      if (error instanceof ProtocolError && error.code === "NOT_FOUND" && /no such blob/i.test(error.message)) return failed(new ToolFailure("BLOB_UNAVAILABLE", "The media file is no longer on the host, so nothing was changed. Import it again.", error.details));
      if (error instanceof ProtocolError) return failed(new ToolFailure(error.code, error.message, error.details));
      const diagnosticId = randomUUID();
      console.error(`[agent-tools] ${name} failed (${diagnosticId}): ${error instanceof Error ? error.stack : error}`);
      return failed(new ToolFailure("INTERNAL", `The tool failed unexpectedly (diagnostic ${diagnosticId}). Try a different approach or tell the user.`, { diagnosticId }));
    }
  }

  // — Channel methods —
  /** A conditional tool is part of the catalogue only while the host has what it needs. */
  const served = (tool: ToolDefinition) => !tool.available || tool.available(host);
  const catalog = (): ToolCatalogEntry[] => ALL_TOOLS.filter(served).map((tool) => ({
    name: tool.name, family: tool.family, owner: "agent-editing-tools", description: tool.description, parametersSchema: jsonSchemaOf(schemas.get(tool.name)!), readOnly: tool.readOnly,
    readsAmbientState: tool.readsAmbientState === true, needsProject: tool.needsProject, needsWriterToken: tool.kind === "staged", costed: false, approval: tool.readOnly ? "never" : "by-mode", agentClasses: ["creative", "workspace"],
  }));
  function define<M extends ToolMethod>(name: M, handle: (params: z.infer<(typeof TOOL_PARAMS)[M]>, connection: Connection) => unknown | Promise<unknown>): void {
    methods.set(name, {
      scope: TOOL_METHODS[name] as Scope,
      handle: async (raw, connection) => {
        const parsed = TOOL_PARAMS[name].safeParse(raw ?? {});
        if (!parsed.success) throw new ProtocolError("INVALID_PARAMS", "The parameters do not match the expected shape.", { details: { path: parsed.error.issues[0]?.path.join(".") ?? "" } });
        try { return await handle(parsed.data as never, connection); } catch (error) {
          if (error instanceof ToolFailure) throw new ProtocolError(error.code, error.message, { details: error.details, retryable: RETRYABLE_TOOL_CODES.includes(error.code), httpStatus: 409 });
          throw error;
        }
      },
    });
  }
  const readable = (proposal: Proposal | undefined, connection: Connection): Proposal => {
    if (!proposal || proposal.state === "discarded" || proposal.state === "open" || !sessions().canRead(proposal.session_key, connection)) throw new ProtocolError("PROPOSAL_NOT_FOUND" as ErrorCode, "No such proposal.", { httpStatus: 404 });
    return proposal;
  };
  define("jagentchill.tool.catalog", () => ({ tools: catalog() }));
  define("jagentchill.proposal.get", (p, connection) => { expireOld(); return { proposal: view(readable(proposalById(p.proposalId), connection)) }; });
  define("jagentchill.proposal.list", (p, connection) => {
    expireOld();
    const rows = (p.sessionKey ? db.prepare("SELECT * FROM tool_proposals WHERE session_key = ? AND state NOT IN ('open', 'discarded') ORDER BY created_ms").all(p.sessionKey)
      : p.projectId ? db.prepare("SELECT * FROM tool_proposals WHERE project_id = ? AND state NOT IN ('open', 'discarded') ORDER BY created_ms").all(p.projectId)
        : db.prepare("SELECT * FROM tool_proposals WHERE state = 'pending' ORDER BY created_ms").all()) as ProposalRow[];
    const visible = rows.map((row) => read(row)!).filter((proposal) => sessions().canRead(proposal.session_key, connection));
    const notices = p.sessionKey && sessions().canRead(p.sessionKey, connection) ? (db.prepare("SELECT json FROM tool_notices WHERE session_key = ? ORDER BY created_ms").all(p.sessionKey) as { json: string }[]).map((row) => JSON.parse(row.json) as ToolNotice) : [];
    // A project that was synced meanwhile no longer needs its card's button.
    return { proposals: visible.map(view), notices: notices.map((entry) => ({ ...entry, ...(entry.code === "PROJECT_NOT_SYNCED" && entry.projectId ? { synced: sync.documents.row(projectRef(entry.projectId))?.state === "active" } : {}) })) };
  });
  define("jagentchill.proposal.resolve", (p, connection) => { readable(proposalById(p.proposalId), connection); return resolve(p.proposalId, p.action, { deviceId: connection.deviceId }, p); });
  define("jagentchill.proposal.revert", (p, connection) => {
    const proposal = proposalById(p.proposalId);
    if (!proposal || !sessions().canRead(proposal.session_key, connection)) throw new ProtocolError("PROPOSAL_NOT_FOUND" as ErrorCode, "No such proposal.", { httpStatus: 404 });
    return revertApplied(p.proposalId, { deviceId: connection.deviceId }, p.force === true);
  });
  define("jagentchill.proposal.frames.put", (p, connection) => {
    const proposal = readable(proposalById(p.proposalId), connection);
    if (proposal.state !== "pending") return { stored: false };
    // The pair comes from a device that has the project open; the first one is kept.
    if (!projectConnections(proposal.project_id).some((entry) => entry.connId === connection.connId) || proposal.body.frames) return { stored: false };
    proposal.body.frames = { before: p.before, after: p.after };
    save(proposal); announce(proposal);
    return { stored: true };
  });
  define("jagentchill.chat.approval.list", (p, connection) => ({ requests: sessions().canRead(p.sessionKey, connection) ? requests.listPermissions(p.sessionKey) : [] }));
  define("jagentchill.chat.approval.resolve", (p, connection) => requests.resolvePermission(p.requestId, p.decision, p.reason, connection));
  define("jagentchill.chat.question.list", (p, connection) => ({ questions: sessions().canRead(p.sessionKey, connection) ? requests.listQuestions(p.sessionKey) : [] }));
  define("jagentchill.chat.question.answer", (p, connection) => requests.answerQuestion(p.questionId, p.answers, connection));
  define("jagentchill.editor.context.report", (p, connection) => { reports.set(connection.connId, { ...p, deviceId: connection.deviceId, connId: connection.connId, at_ms: now() }); });
  define("jagentchill.editor.frame.result", (p) => { frameWaiters.get(p.requestId)?.(p); });

  /** Per session: the latest project state and the revision of the last full context. Kept in memory. */
  const sentContext = new Map<string, { state: string; turns: number; projectId: string; runtimeId: string; fullRevision: number }>();
  let compactContext = true;
  return {
    methods, call, catalog, proposals, requests,
    answerPendingQuestion: (sessionKey: string, text: string) => requests.answerText(sessionKey, text),
    definitions: () => ALL_TOOLS.filter(served).map((tool) => ({ name: tool.name, description: tool.description, inputSchema: jsonSchemaOf(schemas.get(tool.name)!) })),
    has: (name: string) => { const tool = tools.get(name); return !!tool && served(tool); },
    /** For the checks of a test: the proposal a session is staging or waiting on. */
    currentProposal: (sessionKey: string) => { const found = current(sessionKey); return found && view(found); },
    proposal: (proposalId: string) => { const found = proposalById(proposalId); return found && view(found); },
    resolve, revert: revertApplied,
    writerOf: (projectId: string) => writers.get(projectId)?.sessionKey,
    /**
     * The context that leads a turn of this session: its project as the host holds it, with the session's open proposal
     * applied, and what the editor of the device that has the chat focused shows right now.
     */
    turnContext(session: SessionRecord): string | undefined {
      // Without a project there is nothing of the editor to describe; the MCP server's instructions say what the tools are for.
      if (!session.projectId) return withModeLine(session, undefined);
      let base: { doc: ProjectDocument; revision: number };
      // A project the host has no copy of yet: the tools say what to do about it when the agent calls one.
      try { base = replica(session.projectId); } catch { return withModeLine(session, `This chat is bound to the project with id ${session.projectId}, which is not synced to the host yet, so its content cannot be read here. Call jc_timeline_snapshot: its answer says what the user has to do.`); }
      const chosen = activeScenes.get(`${session.sessionKey}|${session.projectId}`), editor = host.editorContext(session, session.projectId);
      const sceneId = [editor?.sceneId, chosen].find((id) => typeof id === "string" && base.doc.scenes.some((scene) => scene.id === id)) as string | undefined;
      const activeSceneId = sceneId ?? (base.doc.scenes.find((scene) => scene.isMain) ?? base.doc.scenes[0]).id;
      const input = { projectId: session.projectId, doc: base.doc, revision: base.revision, activeSceneId, ...(editor ? { editor } : {}), leaseHolder: host.leaseHolder(session.projectId), toolCount: ALL_TOOLS.length };
      // The full block goes out at session start, after compaction/runtime/project changes, and every twentieth turn.
      // Between those points, state changes name the new revision and point back to the read tools instead of
      // repeating every track and element in the conversation history.
      const lease = input.leaseHolder, pending = current(session.sessionKey);
      const state = `${session.ref?.runtimeId ?? ""}/${session.ref?.modelId ?? ""}|${session.projectId}|${base.revision}|${activeSceneId}|${lease?.kind ?? ""}:${lease?.name ?? ""}|${pending?.proposal_id ?? ""}:${pending?.state ?? ""}:${pending ? JSON.stringify(pending.body).length : 0}`;
      const sent = sentContext.get(session.sessionKey);
      const runtimeId = session.ref?.runtimeId ?? "";
      if (compactContext && sent && sent.projectId === session.projectId && sent.runtimeId === runtimeId && sent.turns < 20) {
        sent.turns += 1;
        if (sent.state === state) return withModeLine(session, describeTurnContext({ ...input, unchangedSince: true }));
        const changedSinceRevision = sent.fullRevision;
        sent.state = state;
        return withModeLine(session, describeTurnContext({ ...input, changedSinceRevision }));
      }
      sentContext.set(session.sessionKey, { state, turns: 1, projectId: session.projectId, runtimeId, fullRevision: base.revision });
      return withModeLine(session, describeTurnContext(input));
    },
    /** The model no longer holds the context block (its conversation was compacted or moved to another runtime): the next turn carries it in full. */
    contextForgotten(sessionKey: string): void { sentContext.delete(sessionKey); },
    /** Token saving "short turn context": off sends the full block with every message. */
    setCompactContext(on: boolean): void { compactContext = on; },
    /** A question a runtime raised with its own "ask the user" tool becomes a question card of the chat. */
    runtimeQuestion(session: SessionRecord, question: RuntimeQuestion): boolean {
      if (session.origin === "automation" || session.origin === "workflow") return false;
      requests.askForRuntime(session, question.id, question.questions.slice(0, 4).map((entry) => {
        const options = (entry.options ?? []).slice(0, 6).map((option) => ({ label: option.label.slice(0, 60), ...(option.description ? { description: option.description.slice(0, 200) } : {}) }));
        return { id: entry.questionId, text: entry.question.slice(0, 500), ...(entry.header?.trim() ? { header: entry.header.trim().slice(0, 30) } : {}), kind: options.length >= 2 ? (entry.multiSelect ? "multi" as const : "single" as const) : "text" as const, ...(options.length >= 2 ? { options } : {}) };
      }), question.expiresAtMs ?? now() + 900_000);
      return true;
    },
    runtimeQuestionClosed: (gatewayQuestionId: string) => requests.runtimeQuestionClosed(gatewayQuestionId),
    /** A session may not move to another project while its proposal awaits a decision. */
    assertRebindable(sessionKey: string): void {
      const existing = current(sessionKey);
      if (existing?.state === "pending" || existing?.state === "applying") throw new ProtocolError("CONFLICT", "Accept or reject the pending proposal first", { httpStatus: 409, details: { proposalId: existing.proposal_id, reason: "pending_proposal" } });
      if (existing?.state === "open") close(existing, "discarded");
    },
    turnStarted(sessionKey: string): void {
      turnCounts.set(sessionKey, { calls: 0, staged: 0 });
      requests.turnStarted(sessionKey);
      // The person went on after a per-turn limit: its status line stays, its "Continue" does not.
      for (const entry of existingNotices(sessionKey)) if (entry.code === "TURN_LIMIT" && !entry.continued) addNotice({ ...entry, continued: true });
    },
    /** A turn ended with an open proposal: one with changes is submitted with a generated title, an empty one is dropped. */
    turnEnded(sessionKey: string): void {
      turnCounts.delete(sessionKey);
      const existing = current(sessionKey), session = sessions().session(sessionKey);
      if (!existing || existing.state !== "open") { const held = [...writers].find(([, entry]) => entry.sessionKey === sessionKey); if (held && !existing) held[1].lastWrite_ms = Math.min(held[1].lastWrite_ms, now()); return; }
      if (existing.body.calls.length === 0 || !session) { close(existing, "discarded"); return; }
      void submit(existing, session, existing.title || generatedTitle(existing), existing.summary || clip(existing.body.calls.map((entry) => entry.summary).join(" "), 500)).catch(() => undefined);
    },
    sessionDeleted(sessionKey: string): void {
      for (const row of db.prepare("SELECT * FROM tool_proposals WHERE session_key = ? AND state IN ('open', 'pending')").all(sessionKey) as ProposalRow[]) close(read(row)!, "discarded");
      db.prepare("DELETE FROM tool_notices WHERE session_key = ?").run(sessionKey);
      db.prepare("DELETE FROM tool_idempotency WHERE session_key = ?").run(sessionKey);
      requests.sessionDeleted(sessionKey);
    },
    dropConnection(connection: Connection): void { reports.delete(connection.connId); },
    sweep(): void { expireOld(); requests.sweep(); db.prepare("DELETE FROM tool_idempotency WHERE ts_ms < ?").run(now() - IDEMPOTENCY_RETENTION_MS); },
    close(): void { for (const timer of retries) clearTimeout(timer); retries.clear(); },
  };
}
export type ToolService = ReturnType<typeof createToolService>;

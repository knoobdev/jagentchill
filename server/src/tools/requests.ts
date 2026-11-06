import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "@jagentchill/editor-core";
import { APPROVAL_TIMEOUT_MS, TOOL_RATE_LIMITS, type PermissionDecision, type PermissionRequest, type Question, type QuestionAnswer, type QuestionRequest, type Scope } from "@jagentchill/protocol";
import type { SessionRecord } from "../agents/sessions.ts";
import type { Connection } from "../channel/ws-channel.ts";
import type { DeviceRegistry } from "../devices/registry.ts";
import { ProtocolError } from "../errors.ts";
import { audit } from "../store/database.ts";
import { ToolFailure } from "./kit.ts";

type Row = { request_id: string; session_key: string; kind: "permission" | "question"; state: string; hash: string; json: string; created_ms: number; expires_ms: number };
type Stored<T> = T & { /** The agent's call has taken the outcome: an allow passes exactly one call, an answer is returned once. */ consumed?: boolean };
type Sessions = {
  session(key: string): SessionRecord | undefined;
  canRead(key: string, connection: Connection): boolean;
  canAct(key: string, connection: Connection): boolean;
  deliver(key: string, message: string, options?: { hostNote?: boolean; reason?: "answer" | "decision" | "host" }): Promise<boolean>;
};
export type RequestDeps = {
  db: DatabaseSync; now: () => number; devices: DeviceRegistry; sessions: () => Sessions;
  broadcast: (scope: Scope, event: string, stream: string, payload: unknown, filter: (connection: Connection) => boolean) => void;
  /** Hands the answer to a question a runtime raised itself back to the runtime; `null` when the person skipped it. */
  answerRuntimeQuestion?: (gatewayQuestionId: string, answers: Record<string, string[]> | null) => void;
};
/** A question of the runtime's own "ask the user" tool, as stored: the runtime's id says where the answer goes. */
type RuntimeQuestion = Stored<QuestionRequest> & { runtimeQuestionId?: string };
export type PermissionAsk = { toolLabel: string; detail: string; projectId?: string; /** The whole prompt of a generation call that copies untrusted content (shown on the card). */ copiedPrompt?: string; /** A paid generation call: its facts, for a screen to word in its own language. */ money?: import("@jagentchill/protocol").PermissionMoney };

const WRITE: Scope = "jagentchill.projects.write", USE: Scope = "jagentchill.agent.use";
/** SQLite-safe sentinel for a question that stays open until a person answers or dismisses it. */
const QUESTION_NEVER_EXPIRES = Number.MAX_SAFE_INTEGER;
const note = (head: string, data: unknown) => `[JAgentChill] ${head}\nThis is a status message of the editor, not a request of the user.\n${JSON.stringify(data)}`;

/**
 * What a tool puts to a person and waits for, held and resolved by the server (`server-api.Approval and question
 * resolution`): a permission for an effect outside the session's project — the call is answered `APPROVAL_PENDING` before
 * any effect, and an allow lets the identical call pass exactly once —, and the questions of `jc_session_ask`.
 */
/** The length of a run of characters copied from untrusted content that makes a generation prompt one a person is shown in full. */
const COPIED_RUN = 200;
/** The length of the blocks of kept untrusted text that are indexed (half the run: every copied run holds one whole). */
const COPIED_BLOCK = COPIED_RUN / 2;
const blockHash = (block: string): string => createHash("sha1").update(block).digest("hex").slice(0, 16);
/**
 * The untrusted content in what a tool returned (`untrusted: true` on the containing object, as
 * `agent-editing-tools.Untrusted content handling` has tools mark it): whether there is any, and its text.
 */
export function untrustedIn(value: unknown): { found: boolean; texts: string[] } {
  const texts: string[] = [];
  let found = false, visited = 0;
  const walk = (node: unknown, inside: boolean, depth: number): void => {
    if (depth > 12 || visited++ > 20_000 || node === null || node === undefined) return;
    if (typeof node === "string") { if (inside) texts.push(node); return; }
    if (typeof node !== "object") return;
    if (Array.isArray(node)) { for (const entry of node) walk(entry, inside, depth + 1); return; }
    const marked = inside || (node as { untrusted?: unknown }).untrusted === true;
    if (marked) found = true;
    for (const entry of Object.values(node as Record<string, unknown>)) walk(entry, marked, depth + 1);
  };
  walk(value, false, 0);
  return { found, texts };
}
export function createRequests(deps: RequestDeps) {
  const { db, now } = deps;
  const sessions = () => deps.sessions();
  /**
   * "Always allow for this session": the person's one answer covers every later permission of the session, exactly as
   * Auto mode does (coordinator's ruling of 2026-10-09, brief w7-chat-2 part A). Stored, so it lasts as long as the
   * session does — a restart of the host must not make the agent ask again.
   */
  db.exec("CREATE TABLE IF NOT EXISTS tool_session_allow (session_key TEXT PRIMARY KEY, since_ms INTEGER NOT NULL) STRICT;");
  const allowedForSession = (sessionKey: string): boolean => !!db.prepare("SELECT 1 FROM tool_session_allow WHERE session_key = ?").get(sessionKey);
  /** Why this session works without asking, if it does: Auto mode, "Run without asking", or "Always allow for this session". */
  const worksUnasked = (session: SessionRecord): "auto_mode" | "unattended" | "session_allow" | undefined =>
    session.unattended === true ? "unattended" : session.modeId === "auto" ? "auto_mode" : allowedForSession(session.sessionKey) ? "session_allow" : undefined;
  /**
   * Tainted sessions (`agent-editing-tools.Untrusted content handling`): a session that was given content from outside
   * the user and the system — a web page, text fetched from a URL, a message of another agent or device, the data of
   * the event that started its run (`automations.Prompt-injection notice`) — is tainted for the rest of its life.
   * Taint decides ONE thing: the copied-prompt rule below. It gates no permission card (ruling of 2026-10-09). Stored,
   * so it outlives a restart of the host like the session does.
   */
  db.exec("CREATE TABLE IF NOT EXISTS tool_session_taint (session_key TEXT PRIMARY KEY, source TEXT NOT NULL, since_ms INTEGER NOT NULL) STRICT;");
  // Sessions marked before the ruling because they read their OWN project (its timeline, its library) or were answered
  // by their own user are not tainted: the mark and the text kept with it go. (The text of one session is kept without
  // its source, so a session first marked that way and LATER given outside content loses that text too.)
  {
    const own = "source IN ('tool:jc_timeline_snapshot', 'tool:jc_timeline_find', 'tool:jc_media_list', 'tool:jc_media_get', 'tool:jc_session_ask')";
    if (db.prepare(`SELECT 1 FROM tool_session_taint WHERE ${own} LIMIT 1`).get()) {
      for (const table of ["tool_session_untrusted", "tool_session_untrusted_block"]) if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) db.exec(`DELETE FROM ${table} WHERE session_key IN (SELECT session_key FROM tool_session_taint WHERE ${own})`);
      db.exec(`DELETE FROM tool_session_taint WHERE ${own}`);
    }
  }
  // The untrusted text a session was given, kept for one rule: a generation prompt that copies 200 or more characters
  // of it in a row is shown in full before any provider call. ALL of it is kept, for as long as the session exists —
  // text that was dropped would be text a prompt could copy unseen —, on disk and not in memory: each text once, and an
  // index of its blocks of 100 characters (those that start at a multiple of 100). A copied run of 200 characters
  // holds one such block whole, so a prompt is checked by looking its own 100-character windows up in that index and
  // reading only a text that has one; nothing is scanned and nothing is held between calls.
  db.exec("CREATE TABLE IF NOT EXISTS tool_session_untrusted (session_key TEXT NOT NULL, hash TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY (session_key, hash)) STRICT;");
  db.exec("CREATE TABLE IF NOT EXISTS tool_session_untrusted_block (session_key TEXT NOT NULL, block TEXT NOT NULL, hash TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (session_key, block, hash, at)) STRICT, WITHOUT ROWID;");
  const isTainted = (sessionKey: string): boolean => !!db.prepare("SELECT 1 FROM tool_session_taint WHERE session_key = ?").get(sessionKey);
  function indexBlocks(sessionKey: string, hash: string, text: string): void {
    const insert = db.prepare("INSERT OR IGNORE INTO tool_session_untrusted_block (session_key, block, hash, at) VALUES (?, ?, ?, ?)");
    for (let at = 0; at + COPIED_BLOCK <= text.length; at += COPIED_BLOCK) insert.run(sessionKey, blockHash(text.slice(at, at + COPIED_BLOCK)), hash, at);
  }
  // Text kept before the index existed is indexed once.
  for (const row of db.prepare("SELECT session_key, hash, text FROM tool_session_untrusted AS kept WHERE NOT EXISTS (SELECT 1 FROM tool_session_untrusted_block AS b WHERE b.session_key = kept.session_key AND b.hash = kept.hash)").iterate() as Iterable<{ session_key: string; hash: string; text: string }>) indexBlocks(row.session_key, row.hash, row.text);
  function keep(sessionKey: string, texts: readonly string[]): void {
    for (const text of texts) {
      // A text shorter than the run cannot be the source of one.
      if (text.length < COPIED_RUN) continue;
      const hash = createHash("sha256").update(text).digest("hex");
      const added = db.prepare("INSERT OR IGNORE INTO tool_session_untrusted (session_key, hash, text) VALUES (?, ?, ?)").run(sessionKey, hash, text);
      if (added.changes) indexBlocks(sessionKey, hash, text);
    }
  }
  /** Whether `prompt` carries a run of 200 or more characters copied verbatim from untrusted content returned in this session. */
  function copiesUntrusted(sessionKey: string, prompt: string): boolean {
    if (prompt.length < COPIED_RUN) return false;
    if (!db.prepare("SELECT 1 FROM tool_session_untrusted_block WHERE session_key = ? LIMIT 1").get(sessionKey)) return false;
    const lookup = db.prepare("SELECT hash, at FROM tool_session_untrusted_block WHERE session_key = ? AND block = ?");
    const read = db.prepare("SELECT text FROM tool_session_untrusted WHERE session_key = ? AND hash = ?");
    for (let at = 0; at + COPIED_BLOCK <= prompt.length; at += 1) {
      const hits = lookup.all(sessionKey, blockHash(prompt.slice(at, at + COPIED_BLOCK))) as Array<{ hash: string; at: number }>;
      for (const hit of hits) {
        const text = (read.get(sessionKey, hit.hash) as { text: string } | undefined)?.text;
        // The index names a block by a short hash: the characters themselves decide.
        if (!text || text.slice(hit.at, hit.at + COPIED_BLOCK) !== prompt.slice(at, at + COPIED_BLOCK)) continue;
        let before = 0, after = 0;
        while (before + COPIED_BLOCK < COPIED_RUN && at - before > 0 && hit.at - before > 0 && prompt[at - before - 1] === text[hit.at - before - 1]) before += 1;
        while (before + COPIED_BLOCK + after < COPIED_RUN && at + COPIED_BLOCK + after < prompt.length && hit.at + COPIED_BLOCK + after < text.length && prompt[at + COPIED_BLOCK + after] === text[hit.at + COPIED_BLOCK + after]) after += 1;
        if (before + COPIED_BLOCK + after >= COPIED_RUN) return true;
      }
    }
    return false;
  }
  /** The untrusted text this session was given (each text once), for code that hands a session's content to another session. */
  const untrustedOf = (sessionKey: string): string[] => (db.prepare("SELECT text FROM tool_session_untrusted WHERE session_key = ? ORDER BY rowid").all(sessionKey) as Array<{ text: string }>).map((row) => row.text);
  function taint(sessionKey: string, source: string, texts: readonly string[] = []): void {
    keep(sessionKey, texts);
    if (isTainted(sessionKey)) return;
    db.prepare("INSERT INTO tool_session_taint (session_key, source, since_ms) VALUES (?, ?, ?)").run(sessionKey, source.slice(0, 200), now());
    audit(db, now(), `agent:${sessionKey}`, "session.tainted", { category: "agent", source: source.slice(0, 200), untrustedSeen: true });
  }
  const waiters = new Map<string, Set<(request: QuestionRequest) => void>>();
  const asked = new Map<string, number>();
  const hashOf = (session: SessionRecord, name: string, args: unknown) => createHash("sha256").update(`${session.sessionKey}\n${name}\n${canonicalJson(args as object)}`).digest("hex");
  const rowOf = (requestId: string) => db.prepare("SELECT * FROM tool_requests WHERE request_id = ?").get(requestId) as Row | undefined;
  const latest = (sessionKey: string, kind: Row["kind"], hash: string) => db.prepare("SELECT * FROM tool_requests WHERE session_key = ? AND kind = ? AND hash = ? ORDER BY created_ms DESC, rowid DESC LIMIT 1").get(sessionKey, kind, hash) as Row | undefined;
  const put = (row: Pick<Row, "request_id" | "session_key" | "kind" | "hash" | "created_ms" | "expires_ms">, body: { state: string }) =>
    db.prepare("INSERT INTO tool_requests (request_id, session_key, kind, state, hash, json, created_ms, expires_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (request_id) DO UPDATE SET state = excluded.state, json = excluded.json")
      .run(row.request_id, row.session_key, row.kind, body.state, row.hash, JSON.stringify(body), row.created_ms, row.expires_ms);
  const announce = (sessionKey: string, event: string, payload: unknown) => deps.broadcast("jagentchill.projects.read", event, `session:${sessionKey}`, payload, (connection) => sessions().canRead(sessionKey, connection));
  const shown = <T extends object>(body: Stored<T>): T => { const { consumed: _consumed, ...rest } = body; return rest as T; };

  // — Permissions —
  function expirePermission(row: Row): Stored<PermissionRequest> {
    const body = JSON.parse(row.json) as Stored<PermissionRequest>;
    if (body.state !== "pending" || now() < row.expires_ms) return body;
    Object.assign(body, { state: "expired", decided_ms: now(), resolver: { kind: "system", reason: "timeout" } });
    put(row, body);
    announce(row.session_key, "jagentchill.chat.permission.resolved", { request: shown(body) });
    return body;
  }
  /**
   * The permission of an effect a tool is about to have (ruling of 2026-10-09). What decides:
   *  - money (`ask.money`) and a prompt the person must see in full (`ask.copiedPrompt`) are asked in EVERY mode, by
   *    the paid-call gate's own rule: nothing here lets them pass, and "for this session" is not offered on them;
   *  - everything else — a URL import (with a query or without), a delete in a film, a workflow created, changed or
   *    started, a project trashed or restored — is NOT asked in Auto mode, under "Run without asking", or once the
   *    person answered "Always allow for this session" on any card of the session. What the session has read
   *    (taint) changes nothing about it;
   *  - otherwise the request is stored and shown with "Always allow for this session", and the call fails with
   *    `APPROVAL_PENDING`; the agent calls again with the same parameters once it is told the decision, and an
   *    "allow once" passes exactly that call.
   */
  function permit(session: SessionRecord, tool: string, args: unknown, ask: PermissionAsk): { requestId?: string; resolverDeviceId?: string } {
    const tainted = isTainted(session.sessionKey);
    const everyMode = !!ask.money || !!ask.copiedPrompt;
    const unasked = everyMode ? undefined : worksUnasked(session);
    if (unasked) {
      audit(db, now(), `agent:${session.sessionKey}`, "permission.auto_allow", { category: "agent", tool, detail: ask.detail.slice(0, 2000), reason: unasked, ...(tainted ? { untrustedSeen: true } : {}) });
      return {};
    }
    const hash = hashOf(session, tool, args), found = latest(session.sessionKey, "permission", hash);
    const body = found && expirePermission(found);
    if (found && body && !body.consumed) {
      if (body.state === "pending") throw new ToolFailure("APPROVAL_PENDING", `APPROVAL_PENDING:${body.requestId} — the user was asked to allow this and has not answered yet. End your turn; when the decision arrives, call ${tool} again with exactly the same parameters.`, { requestId: body.requestId });
      body.consumed = true;
      put(found, body);
      if (body.state === "allowed") return { requestId: body.requestId, ...(body.resolver?.kind === "device" ? { resolverDeviceId: body.resolver.deviceId } : {}) };
      if (body.state === "expired") throw new ToolFailure("APPROVAL_TIMEOUT", "Nobody answered the permission request within 30 minutes, so it was denied. Ask the user before trying again.", { requestId: body.requestId });
      throw new ToolFailure("PERMISSION_DENIED", `The user did not allow this${body.reason ? `: ${body.reason}` : "."} Do not try it again unless the user asks.`, { requestId: body.requestId, ...(body.reason ? { reason: body.reason } : {}) });
    }
    const request: PermissionRequest = {
      requestId: randomUUID(), sessionKey: session.sessionKey, kind: "out-of-project", tool, toolLabel: ask.toolLabel, detail: ask.detail, ...(ask.projectId ? { projectId: ask.projectId } : {}),
      actions: everyMode ? ["allow-once", "deny"] : ["allow-once", "allow-session", "deny"], requiredScope: [USE, WRITE], adminOnly: false, state: "pending", created_ms: now(), expires_ms: now() + APPROVAL_TIMEOUT_MS,
      ...(ask.copiedPrompt ? { copiedPrompt: ask.copiedPrompt } : {}), ...(ask.money ? { money: ask.money } : {}),
    };
    put({ request_id: request.requestId, session_key: session.sessionKey, kind: "permission", hash, created_ms: request.created_ms, expires_ms: request.expires_ms }, request);
    audit(db, now(), `agent:${session.sessionKey}`, "permission.request", { category: "agent", requestId: request.requestId, tool, detail: ask.detail.slice(0, 2000), ...(tainted ? { untrustedSeen: true } : {}) });
    announce(session.sessionKey, "jagentchill.chat.permission.requested", { request });
    throw new ToolFailure("APPROVAL_PENDING", `APPROVAL_PENDING:${request.requestId} — this needs the user's permission, and they were asked. End your turn; when the decision arrives, call ${tool} again with exactly the same parameters.`, { requestId: request.requestId });
  }
  function resolvePermission(requestId: string, decision: PermissionDecision, reason: string | undefined, connection: Connection): { request: PermissionRequest } {
    const row = rowOf(requestId);
    if (!row || row.kind !== "permission" || !sessions().canRead(row.session_key, connection)) throw new ProtocolError("NOT_FOUND", "No such permission request.", { httpStatus: 404 });
    // The resolver rule: the device can act in the session and holds the scope of the request's kind.
    if (!sessions().canAct(row.session_key, connection) || !connection.scopes().includes(WRITE)) throw new ProtocolError("SCOPE_DENIED", "This device cannot approve.", { httpStatus: 403, details: { requiredScope: WRITE } });
    const body = expirePermission(row);
    if (body.state !== "pending") throw new ProtocolError("ALREADY_RESOLVED", "This request was already answered.", { httpStatus: 409, details: { state: body.state } });
    if (!body.actions.includes(decision)) throw new ProtocolError("INVALID_PARAMS", "This request cannot be allowed for the whole session.", { details: { allowed: body.actions } });
    const resolver = { kind: "device" as const, deviceId: connection.deviceId, deviceName: deps.devices.get(connection.deviceId)?.name ?? "Unknown device" };
    /** The other cards of the session that the same answer settles: one answer, no repeats. */
    const settled: string[] = [];
    if (decision === "allow-session") {
      db.prepare("INSERT OR IGNORE INTO tool_session_allow (session_key, since_ms) VALUES (?, ?)").run(row.session_key, now());
      for (const other of db.prepare("SELECT * FROM tool_requests WHERE session_key = ? AND kind = 'permission' AND state = 'pending' AND request_id <> ? ORDER BY created_ms, rowid").all(row.session_key, requestId) as Row[]) {
        const waiting = expirePermission(other);
        if (waiting.state !== "pending" || !waiting.actions.includes("allow-session")) continue;
        Object.assign(waiting, { state: "allowed", decision, decided_ms: now(), resolver });
        put(other, waiting);
        announce(row.session_key, "jagentchill.chat.permission.resolved", { request: shown(waiting) });
        settled.push(`${waiting.tool} (${waiting.requestId})`);
      }
    }
    Object.assign(body, { state: decision === "deny" ? "denied" : "allowed", decision, decided_ms: now(), resolver, ...(reason ? { reason } : {}) });
    put(row, body);
    audit(db, now(), `device:${connection.deviceId}`, "permission.resolve", { category: "agent", requestId, tool: body.tool, decision, resolverDeviceId: connection.deviceId, decided_ms: now(), ...(isTainted(row.session_key) ? { untrustedSeen: true } : {}) });
    announce(row.session_key, "jagentchill.chat.permission.resolved", { request: shown(body) });
    // The decision opens the agent's next turn; an allow tells it to make the same call again.
    void sessions().deliver(row.session_key, note(`Permission request for ${body.tool} (${requestId}) was ${decision === "deny" ? "denied" : "allowed"}${decision !== "deny" ? `. Call ${body.tool} again with exactly the same parameters to carry it out.${decision === "allow-session" ? ` The user allowed it for the whole session: nothing else of this kind will be asked in it.${settled.length ? ` That also allowed the other requests that were waiting — make those calls again too, each with exactly its own parameters: ${settled.join(", ")}.` : ""}` : ""}` : `${reason ? ` with this reason: ${reason}` : "."} Do not try it again unless the user asks.`}`, { requestId, state: decision === "deny" ? "denied" : "allowed", tool: body.tool, ...(reason ? { reason } : {}) }), { hostNote: true, reason: "decision" });
    return { request: shown(body) };
  }
  const listPermissions = (sessionKey: string): PermissionRequest[] =>
    (db.prepare("SELECT * FROM tool_requests WHERE session_key = ? AND kind = 'permission' ORDER BY created_ms, rowid").all(sessionKey) as Row[]).map((row) => { const { rule: _rule, inProject: _inProject, ...rest } = shown(expirePermission(row)) as PermissionRequest & { rule?: string; inProject?: boolean }; return rest; }); // (`rule` / `inProject`: fields of requests stored before 2026-10-09)

  // — Questions —
  function settle(row: Row, body: RuntimeQuestion, closedByRuntime = false): void {
    put(row, body);
    announce(row.session_key, "jagentchill.chat.question.resolved", { question: shown(body) });
    if (body.runtimeQuestionId) {
      // The runtime's tool call is holding on the runtime: the answer goes there and the same turn continues.
      body.consumed = true; put(row, body);
      if (closedByRuntime) return;
      const answers = Object.fromEntries((body.answers ?? []).filter((answer) => !answer.skipped).map((answer) => [answer.id, answer.values ?? [answer.value ?? answer.text ?? ""]]));
      deps.answerRuntimeQuestion?.(body.runtimeQuestionId, Object.keys(answers).length ? answers : null);
      return;
    }
    const waiting = waiters.get(row.request_id);
    waiters.delete(row.request_id);
    if (waiting?.size) { body.consumed = true; put(row, body); for (const wake of waiting) wake(shown(body)); return; }
    // No call is holding for it any more: the answer is the user's next message and opens a turn.
    body.consumed = true; put(row, body);
    const declined = body.state === "skipped" || (body.answers ?? []).every((answer) => answer.skipped);
    const reply = declined
      ? `I declined to answer your question: “${body.questions.map((question) => question.text).join("; ") }”. Please continue with a reasonable assumption.`
      : body.questions.map((question) => {
        const answer = body.answers?.find((entry) => entry.id === question.id);
        const value = answer?.values?.join(", ") ?? answer?.value ?? answer?.text;
        return `“${question.text}” — ${answer?.skipped || !value ? "declined" : `I chose: ${value}`}`;
      }).join("\n");
    void sessions().deliver(row.session_key, reply, { reason: "answer" });
  }
  function expireQuestion(row: Row): RuntimeQuestion {
    const body = JSON.parse(row.json) as RuntimeQuestion;
    if (body.state !== "pending" || row.expires_ms === QUESTION_NEVER_EXPIRES || now() < row.expires_ms) return body;
    Object.assign(body, { state: "expired", resolved_ms: now(), answers: body.questions.map((question) => ({ id: question.id, skipped: true })) });
    settle(row, body);
    return body;
  }
  /** Puts a question to the person. The model turn ends; the answer starts a later turn. */
  async function ask(session: SessionRecord, questions: Question[]): Promise<{ data: Record<string, unknown>; warnings: string[] }> {
    const skipped = questions.map((question): QuestionAnswer => ({ id: question.id, skipped: true }));
    // Nobody is there to answer an unattended run: it goes on with its own assumptions.
    if (session.origin === "automation" || session.origin === "workflow") return { data: { status: "skipped", answers: skipped }, warnings: ["unattended"] };
    const hash = hashOf(session, "jc_session_ask", questions), found = latest(session.sessionKey, "question", hash);
    let body = found && expireQuestion(found), row = found;
    if (!row || !body || body.consumed) {
      const count = (asked.get(session.sessionKey) ?? 0) + 1;
      if (count > TOOL_RATE_LIMITS.questionsPerTurn) throw new ToolFailure("RATE_LIMITED", "jc_session_ask can be called at most 10 times in one turn. Go on with what you know, or end the turn.", { retryAfter_ms: 1000, reason: "questions_per_turn", limit: TOOL_RATE_LIMITS.questionsPerTurn });
      asked.set(session.sessionKey, count);
      const request: QuestionRequest = { questionId: randomUUID(), sessionKey: session.sessionKey, questions, state: "pending", created_ms: now(), expires_ms: QUESTION_NEVER_EXPIRES };
      row = { request_id: request.questionId, session_key: session.sessionKey, kind: "question", state: "pending", hash, json: "", created_ms: request.created_ms, expires_ms: request.expires_ms };
      body = request;
      put(row, body);
      announce(session.sessionKey, "jagentchill.chat.question.requested", { question: request });
    }
    const done = (request: QuestionRequest) => ({ data: { status: request.state === "answered" ? "answered" : "skipped", questionId: request.questionId, answers: request.answers ?? skipped, untrusted: true }, warnings: [] });
    if (body.state !== "pending") { body.consumed = true; put(row, body); return done(shown(body)); }
    return { data: { status: "pending", questionId: row.request_id, message: "The question is now shown to the user. End your turn and wait. The user's answer will arrive as their next message." }, warnings: [] };
  }
  function answerText(sessionKey: string, text: string): boolean {
    const row = db.prepare("SELECT * FROM tool_requests WHERE session_key = ? AND kind = 'question' AND state = 'pending' ORDER BY created_ms, rowid LIMIT 1").get(sessionKey) as Row | undefined;
    if (!row) return false;
    const body = JSON.parse(row.json) as RuntimeQuestion;
    const first = body.questions[0];
    if (!first) return false;
    const full = body.questions.map((question): QuestionAnswer => {
      if (question.id !== first.id) return { id: question.id, skipped: true };
      if (!text.trim()) return { id: question.id, skipped: true };
      if (question.kind === "text") return { id: question.id, text: text.trim(), skipped: false };
      if (question.kind === "multi") return { id: question.id, values: [text.trim()], skipped: false };
      return { id: question.id, value: text.trim(), skipped: false };
    });
    Object.assign(body, { state: "answered", answers: full, resolved_ms: now() });
    audit(db, now(), "server", "question.answer", { category: "agent", questionId: row.request_id, sessionKey, state: body.state, source: "chat" });
    settle(row, body);
    return true;
  }
  function answerQuestion(questionId: string, answers: { id: string; value?: string; values?: string[]; text?: string; skipped?: boolean }[], connection: Connection): { question: QuestionRequest } {
    const row = rowOf(questionId);
    if (!row || row.kind !== "question" || !sessions().canRead(row.session_key, connection)) throw new ProtocolError("NOT_FOUND", "No such question.", { httpStatus: 404 });
    if (!sessions().canAct(row.session_key, connection)) throw new ProtocolError("SCOPE_DENIED", "This device cannot answer in this session.", { httpStatus: 403, details: { requiredScope: USE } });
    const body = expireQuestion(row);
    if (body.state !== "pending") throw new ProtocolError("ALREADY_RESOLVED", "This question was already answered.", { httpStatus: 409, details: { state: body.state } });
    const given = new Map(answers.map((answer) => [answer.id, answer]));
    const unknown = answers.filter((answer) => !body.questions.some((question) => question.id === answer.id)).map((answer) => answer.id);
    if (unknown.length) throw new ProtocolError("INVALID_PARAMS", "Some answers name a question this card does not hold.", { details: { unknown } });
    const full = body.questions.map((question): QuestionAnswer => {
      const answer = given.get(question.id);
      if (!answer || answer.skipped) return { id: question.id, skipped: true };
      // A choice answer is one of the options or the free text of "Other…".
      if (question.kind === "text") return answer.text?.trim() ? { id: question.id, text: answer.text.trim(), skipped: false } : { id: question.id, skipped: true };
      if (question.kind === "multi") { const values = [...(answer.values ?? []), ...(answer.text?.trim() ? [answer.text.trim()] : [])]; return values.length ? { id: question.id, values, skipped: false } : { id: question.id, skipped: true }; }
      const value = answer.value ?? answer.text?.trim();
      return value ? { id: question.id, value, skipped: false } : { id: question.id, skipped: true };
    });
    Object.assign(body, { state: full.every((answer) => answer.skipped) ? "skipped" : "answered", answers: full, answeredByDeviceId: connection.deviceId, resolved_ms: now() });
    audit(db, now(), `device:${connection.deviceId}`, "question.answer", { category: "agent", questionId, sessionKey: row.session_key, state: body.state });
    settle(row, body);
    return { question: shown(body) };
  }
  /**
   * A question a runtime raised with its own tool. It becomes the same card as a `jc_session_ask` question; the answer
   * is returned to the runtime's waiting call through the session service instead of to a tool call of the server.
   */
  function askForRuntime(session: SessionRecord, gatewayQuestionId: string, questions: Question[], expires_ms: number): QuestionRequest {
    const request: QuestionRequest = { questionId: randomUUID(), sessionKey: session.sessionKey, questions, state: "pending", created_ms: now(), expires_ms };
    put({ request_id: request.questionId, session_key: session.sessionKey, kind: "question", hash: `runtime:${gatewayQuestionId}`, created_ms: request.created_ms, expires_ms }, { ...request, runtimeQuestionId: gatewayQuestionId } as RuntimeQuestion);
    audit(db, now(), `agent:${session.sessionKey}`, "question.request", { category: "agent", questionId: request.questionId, source: "runtime" });
    announce(session.sessionKey, "jagentchill.chat.question.requested", { question: request });
    return request;
  }
  /** The runtime closed a question by itself (it expired there, or the turn ended): the card closes as skipped. */
  function runtimeQuestionClosed(gatewayQuestionId: string): void {
    const row = db.prepare("SELECT * FROM tool_requests WHERE kind = 'question' AND hash = ? AND state = 'pending'").get(`runtime:${gatewayQuestionId}`) as Row | undefined;
    if (!row) return;
    const body = JSON.parse(row.json) as RuntimeQuestion;
    Object.assign(body, { state: "expired", resolved_ms: now(), answers: body.questions.map((question) => ({ id: question.id, skipped: true })) });
    settle(row, body, true);
  }
  const listQuestions = (sessionKey: string): QuestionRequest[] =>
    (db.prepare("SELECT * FROM tool_requests WHERE session_key = ? AND kind = 'question' ORDER BY created_ms, rowid").all(sessionKey) as Row[]).map((row) => shown(expireQuestion(row)));

  /** A workflow run ended: close every unanswered question in the sessions owned by its steps. */
  function closePendingQuestions(sessionKey: string): void {
    for (const row of db.prepare("SELECT * FROM tool_requests WHERE session_key = ? AND kind = 'question' AND state = 'pending'").all(sessionKey) as Row[]) {
      const body = JSON.parse(row.json) as RuntimeQuestion;
      Object.assign(body, { state: "expired", resolved_ms: now(), answers: body.questions.map((question) => ({ id: question.id, skipped: true })) });
      settle(row, body);
    }
  }

  return {
    permit, resolvePermission, listPermissions, taint, isTainted, copiesUntrusted, untrustedOf,
    /** The sessions that hold a permission request nobody answered yet. */
    pendingPermissionSessions(): Set<string> {
      return new Set((db.prepare("SELECT DISTINCT session_key FROM tool_requests WHERE kind = 'permission' AND state = 'pending' AND expires_ms > ?").all(now()) as Array<{ session_key: string }>).map((row) => row.session_key));
    },
    ask, answerQuestion, answerText, listQuestions, askForRuntime, runtimeQuestionClosed, closePendingQuestions,
    turnStarted(sessionKey: string): void { asked.delete(sessionKey); },
    sessionDeleted(sessionKey: string): void { asked.delete(sessionKey); db.prepare("DELETE FROM tool_session_allow WHERE session_key = ?").run(sessionKey); db.prepare("DELETE FROM tool_requests WHERE session_key = ?").run(sessionKey); db.prepare("DELETE FROM tool_session_taint WHERE session_key = ?").run(sessionKey); db.prepare("DELETE FROM tool_session_untrusted WHERE session_key = ?").run(sessionKey); db.prepare("DELETE FROM tool_session_untrusted_block WHERE session_key = ?").run(sessionKey); },
    /** Requests nobody answered in time: a permission is denied, a question is skipped. */
    sweep(): void {
      for (const row of db.prepare("SELECT * FROM tool_requests WHERE state = 'pending' AND expires_ms <= ?").all(now()) as Row[]) { if (row.kind === "permission") expirePermission(row); else expireQuestion(row); }
    },
  };
}
export type Requests = ReturnType<typeof createRequests>;

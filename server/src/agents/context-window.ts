// The context window of a session: how full it is (what the composer's meter shows), compaction at a share of the
// window chosen per host and per session, compaction on request, and the record of every compaction of a session
// (the transcript's "Conversation compacted" divider). Compaction itself is the runtime's own `/compact`, run by the host; a runtime
// that compacts by itself is not driven from here — its own compaction events are recorded and shown.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { ModelRef } from "@jagentchill/protocol";
import type { Connection, RpcMethod } from "../channel/ws-channel.ts";
import { ProtocolError } from "../errors.ts";
import type { ServerConfigFile } from "../store/server-config.ts";
import type { SessionRecord } from "./sessions.ts";
import type { RuntimeEvent } from "./runtime/types.ts";

/** The shares of the context window at which a session may compact by itself; 0 is "off". */
export const AUTO_COMPACT_STEPS = [0, 60, 70, 80, 90] as const;
export const AUTO_COMPACT_DEFAULT = 80;
type AutoPct = (typeof AUTO_COMPACT_STEPS)[number];
const isStep = (value: unknown): value is AutoPct => (AUTO_COMPACT_STEPS as readonly unknown[]).includes(value);
const pctParam = z.union([z.literal(0), z.literal(60), z.literal(70), z.literal(80), z.literal(90)]);
/** Tool calls one turn may make before it pauses for the person ("Continue"). */
export const TURN_TOOL_CALL_STEPS = [25, 50, 100, 200] as const;
const tokenLimit = z.number().int().min(0).max(2_000_000_000);
/** The token-saving settings of a host. A limit of 0 is "no limit". */
export type ContextSettings = { autoCompactPct: AutoPct; tokenLimits: { perSession: number; perDay: number }; turnToolCalls: number; shortTurnContext: boolean; /** The agent CLIs started for sessions load the person's own MCP servers. */ loadPersonalMcp: boolean };
export type TokenLimitState = { usedTokens: number; limitTokens: number; pct: number; warning: boolean; exhausted: boolean };
const DAY_MS = 86_400_000;

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw new ProtocolError("INVALID_PARAMS", "The parameters do not match the expected shape.", { details: { path: parsed.error.issues[0]?.path.join(".") ?? "" } });
  return parsed.data;
}

export type Compaction = { id: number; ts_ms: number; reason: "auto" | "manual" | "runtime"; tokensBefore: number | null; tokensAfter: number | null; summary?: string };
export type ContextState = {
  sessionKey: string;
  /** The model window is optional: runtimes can report request context without exposing a maximum. */
  context?: { usedTokens: number; maxTokens?: number; pct?: number; updated_ms: number };
  autoCompact: { hostPct: AutoPct; sessionPct: AutoPct | null; effectivePct: AutoPct };
  /** `host`: the server compacts (at the threshold and on request). `runtime`: the runtime compacts by itself. `none`: never. */
  compaction: "host" | "runtime" | "none";
  compactions: Compaction[];
  /** A compaction is running now: since when, and who started it (`runtime`: the runtime by itself inside a turn). */
  compacting?: { since_ms: number; reason: Compaction["reason"] };
  /** The token limits that apply to the session; a scope without a limit is absent. `sessionOwn` is this session's raised limit. */
  limits: { session?: TokenLimitState; day?: TokenLimitState; sessionOwn: number | null };
};

export type ContextWindowDeps = {
  db: DatabaseSync; config: ServerConfigFile; now: () => number;
  /** Runs the runtime's own compaction of a session between turns (`/compact`). */
  compact: (key: string) => Promise<{ compacted: boolean; reason?: string; summary?: string }>;
  session: (key: string) => SessionRecord | undefined; canRead: (key: string, connection: Connection) => boolean; canAct: (key: string, connection: Connection) => boolean;
  isRunning: (key: string) => boolean; notify: (key: string, event: string, payload: unknown) => void;
  compactionOf: (runtimeId: string) => "host" | "runtime" | "none"; contextWindowOf: (ref: ModelRef) => number | undefined;
  /** The model's conversation was summarised: what it was told earlier in full has to be said again. */
  onCompacted?: (key: string) => void;
  /** The host's settings changed (and once at start). */
  onSettings?: (settings: ContextSettings) => void;
  /** How long the end of a turn waits for its usage record before it is measured. */
  settle_ms?: number;
};

export function createContextWindowService(deps: ContextWindowDeps) {
  const { db } = deps;
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_context (session_key TEXT PRIMARY KEY, auto_pct INTEGER, token_limit INTEGER);
    CREATE TABLE IF NOT EXISTS session_compactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_key TEXT NOT NULL, ts_ms INTEGER NOT NULL, reason TEXT NOT NULL, tokens_before INTEGER, tokens_after INTEGER, summary TEXT
    );
    CREATE INDEX IF NOT EXISTS session_compactions_session ON session_compactions (session_key, id);
  `);
  const inFlight = new Set<string>();
  /** The compactions that are running, by session: the host's own (it starts them) and a runtime's (the runtime says when one starts). */
  const running = new Map<string, { since_ms: number; reason: Compaction["reason"] }>();
  const hostPct = (): AutoPct => { const stored = deps.config.get<{ autoCompactPct?: unknown }>("context")?.autoCompactPct; return isStep(stored) ? stored : AUTO_COMPACT_DEFAULT; };
  function settings(): ContextSettings {
    const stored = deps.config.get<Record<string, unknown>>("context") ?? {};
    const limits = (stored.tokenLimits ?? {}) as { perSession?: unknown; perDay?: unknown };
    const count = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0);
    return {
      autoCompactPct: hostPct(), tokenLimits: { perSession: count(limits.perSession), perDay: count(limits.perDay) },
      turnToolCalls: (TURN_TOOL_CALL_STEPS as readonly unknown[]).includes(stored.turnToolCalls) ? stored.turnToolCalls as number : 200, shortTurnContext: stored.shortTurnContext !== false, loadPersonalMcp: stored.loadPersonalMcp === true,
    };
  }
  const ownLimit = (key: string): number | null => { const row = db.prepare("SELECT token_limit FROM session_context WHERE session_key = ?").get(key) as { token_limit: number | null } | undefined; return typeof row?.token_limit === "number" ? row.token_limit : null; };
  const limitState = (usedTokens: number, limitTokens: number): TokenLimitState => ({ usedTokens, limitTokens, pct: Math.min(999, Math.round((usedTokens / limitTokens) * 100)), warning: usedTokens >= limitTokens * 0.8, exhausted: usedTokens >= limitTokens });
  /** Tokens are the totals the runtimes reported: a turn of a runtime that reports nothing counts as nothing. */
  function limitsOf(key: string): ContextState["limits"] {
    const host = settings().tokenLimits, own = ownLimit(key), perSession = own ?? host.perSession;
    const sum = (where: string, ...args: Array<string | number>) => (db.prepare(`SELECT COALESCE(SUM(total_tokens), 0) AS used FROM usage_records WHERE ${where}`).get(...args) as { used: number }).used;
    const now = new Date(deps.now()), dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return {
      ...(perSession > 0 ? { session: limitState(sum("session_key = ?", key), perSession) } : {}),
      ...(host.perDay > 0 ? { day: limitState(sum("started_ms >= ? AND started_ms < ?", dayStart, dayStart + DAY_MS), host.perDay) } : {}), sessionOwn: own,
    };
  }
  /** Refuses a turn or a tool call of a session whose token limit is used up. The person raises the limit to go on. */
  function assertTokens(key: string): void {
    const limits = limitsOf(key);
    const spent = limits.session?.exhausted ? { scope: "session" as const, ...limits.session } : limits.day?.exhausted ? { scope: "day" as const, ...limits.day } : undefined;
    if (spent) throw new ProtocolError("BUDGET_EXCEEDED", spent.scope === "session" ? "This session reached its token limit. Raise the limit to continue." : "The host reached its token limit for today.", { httpStatus: 402, details: { reason: "token_limit", scope: spent.scope, limitTokens: spent.limitTokens, usedTokens: spent.usedTokens } });
  }
  const sessionPct = (key: string): AutoPct | null => { const row = db.prepare("SELECT auto_pct FROM session_context WHERE session_key = ?").get(key) as { auto_pct: number | null } | undefined; return isStep(row?.auto_pct) ? row!.auto_pct as AutoPct : null; };
  const compactions = (key: string): Compaction[] => (db.prepare("SELECT * FROM session_compactions WHERE session_key = ? ORDER BY id").all(key) as Array<Record<string, number | string | null>>).map((row) => ({
    id: row.id as number, ts_ms: row.ts_ms as number, reason: row.reason as Compaction["reason"], tokensBefore: row.tokens_before as number | null, tokensAfter: row.tokens_after as number | null,
    ...(row.summary ? { summary: row.summary as string } : {}),
  }));

  /** What the last turn's request held, against the model's window; after a compaction, what the next turn measured. */
  function measure(session: SessionRecord): ContextState["context"] {
    if (!session.ref) return undefined;
    // A runtime may report the model's actual context window only once. Keep using that
    // host-recorded value across sessions and restarts; the catalogue is the fallback.
    // Legacy command turns can have a fake usage_records context value; a paired all-zero session_usage row marks them as non-model turns.
    const remembered = db.prepare(`SELECT context_max FROM usage_records
      WHERE runtime_id = ? AND provider_id = ? AND model_id = ? AND context_max IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM session_usage su WHERE su.session_key = usage_records.session_key AND su.run_id = usage_records.run_id AND su.reported = 1
          AND COALESCE(su.input_tokens, 0) + COALESCE(su.cache_read_tokens, 0) + COALESCE(su.cache_write_tokens, 0) + COALESCE(su.output_tokens, 0) + COALESCE(su.total_tokens, 0) = 0)
      ORDER BY started_ms DESC, id DESC LIMIT 1`)
      .get(session.ref.runtimeId, session.ref.providerId, session.ref.modelId) as { context_max: number } | undefined;
    const modelWindow = remembered?.context_max ?? deps.contextWindowOf(session.ref);
    const last = db.prepare(`SELECT context_used, context_max, started_ms, duration_ms, runtime_id, model_id, token_source FROM usage_records
      WHERE session_key = ? AND NOT EXISTS (SELECT 1 FROM session_usage su WHERE su.session_key = usage_records.session_key AND su.run_id = usage_records.run_id AND su.reported = 1
        AND COALESCE(su.input_tokens, 0) + COALESCE(su.cache_read_tokens, 0) + COALESCE(su.cache_write_tokens, 0) + COALESCE(su.output_tokens, 0) + COALESCE(su.total_tokens, 0) = 0)
      ORDER BY id DESC LIMIT 1`).get(session.sessionKey) as
      { context_used: number | null; context_max: number | null; started_ms: number; duration_ms: number; runtime_id: string | null; model_id: string | null; token_source: string } | undefined;
    // CLI turns are also recorded by the sessions service in session_usage. Some existing hosts have those rows
    // without a corresponding usage_records.context_used value, so derive the last prompt size from that one turn.
    const cli = db.prepare("SELECT input_tokens, cache_read_tokens, cache_write_tokens, ts_ms FROM session_usage WHERE session_key = ? AND runtime_id = ? AND model_id = ? AND reported = 1 AND (COALESCE(input_tokens, 0) + COALESCE(cache_read_tokens, 0) + COALESCE(cache_write_tokens, 0)) > 0 ORDER BY id DESC LIMIT 1").get(session.sessionKey, session.ref.runtimeId, session.ref.modelId) as
      { input_tokens: number | null; cache_read_tokens: number | null; cache_write_tokens: number | null; ts_ms: number } | undefined;
    const lastAt = last ? last.started_ms + last.duration_ms : 0;
    if (cli && (!last || last.context_used === null || last.token_source === "none" || last.runtime_id !== session.ref.runtimeId || last.model_id !== session.ref.modelId || cli.ts_ms > lastAt)) {
      const usedTokens = (cli.input_tokens ?? 0) + (cli.cache_read_tokens ?? 0) + (cli.cache_write_tokens ?? 0);
      const maxTokens = modelWindow;
      return { usedTokens, ...(maxTokens ? { maxTokens, pct: Math.min(100, Math.round((usedTokens / maxTokens) * 100)) } : {}), updated_ms: cli.ts_ms };
    }
    // After the session moved to another model the figure of the old one says nothing.
    if (!last) {
      return { usedTokens: 0, ...(modelWindow ? { maxTokens: modelWindow, pct: 0 } : {}), updated_ms: deps.now() };
    }
    if (last.context_used === null || last.runtime_id !== session.ref.runtimeId || last.model_id !== session.ref.modelId) {
      return { usedTokens: 0, ...(modelWindow ? { maxTokens: modelWindow, pct: 0 } : {}), updated_ms: deps.now() };
    }
    const maxTokens = modelWindow ?? last.context_max ?? undefined;
    const measured_ms = last.started_ms + last.duration_ms;
    const since = compactions(session.sessionKey).findLast((entry) => entry.ts_ms >= measured_ms && entry.tokensAfter !== null);
    const usedTokens = since ? since.tokensAfter! : last.context_used;
    return { usedTokens, ...(maxTokens ? { maxTokens, pct: Math.min(100, Math.round((usedTokens / maxTokens) * 100)) } : {}), updated_ms: since ? since.ts_ms : measured_ms };
  }
  function stateOf(session: SessionRecord): ContextState {
    const context = measure(session), host = hostPct(), own = sessionPct(session.sessionKey);
    return {
      sessionKey: session.sessionKey, ...(context ? { context } : {}), autoCompact: { hostPct: host, sessionPct: own, effectivePct: own ?? host },
      compaction: session.ref ? deps.compactionOf(session.ref.runtimeId) : "none", compactions: compactions(session.sessionKey), limits: limitsOf(session.sessionKey),
      ...(running.has(session.sessionKey) ? { compacting: running.get(session.sessionKey)! } : {}),
    };
  }
  const announce = (session: SessionRecord) => deps.notify(session.sessionKey, "jagentchill.session.context", stateOf(session));
  function record(session: SessionRecord, reason: Compaction["reason"], tokensBefore: number | null, tokensAfter: number | null, summary?: string): Compaction {
    const ts_ms = deps.now();
    const { lastInsertRowid } = db.prepare("INSERT INTO session_compactions (session_key, ts_ms, reason, tokens_before, tokens_after, summary) VALUES (?, ?, ?, ?, ?, ?)").run(session.sessionKey, ts_ms, reason, tokensBefore, tokensAfter, summary?.slice(0, 20_000) ?? null);
    const compaction: Compaction = { id: Number(lastInsertRowid), ts_ms, reason, tokensBefore, tokensAfter, ...(summary ? { summary: summary.slice(0, 20_000) } : {}) };
    deps.onCompacted?.(session.sessionKey);
    deps.notify(session.sessionKey, "jagentchill.chat.compacted", { sessionKey: session.sessionKey, compaction });
    announce(session);
    return compaction;
  }

  /** Compacts a session between turns: the runtime summarises its own context (`/compact`). */
  async function compact(session: SessionRecord, reason: "auto" | "manual"): Promise<{ compacted: boolean; reason?: string; compaction?: Compaction }> {
    const key = session.sessionKey;
    if (!session.ref || deps.compactionOf(session.ref.runtimeId) !== "host") throw new ProtocolError("runtime/unsupported-capability", "This runtime compacts its context by itself.", { details: { capability: "compaction" } });
    if (deps.isRunning(key) || inFlight.has(key)) throw new ProtocolError("CONFLICT", "The session is working. Compact it when the turn has ended.");
    inFlight.add(key);
    // Said the moment it starts: the summary takes the model seconds, and the chat shows it for that long.
    running.set(key, { since_ms: deps.now(), reason });
    announce(session);
    try {
      const before = measure(session)?.usedTokens ?? null;
      const result = await deps.compact(key);
      running.delete(key);
      if (!result.compacted) { announce(session); return { compacted: false, ...(result.reason ? { reason: result.reason } : {}) }; }
      // "Before" is what the model's provider counted for the last request; what is left is measured by the next turn.
      return { compacted: true, compaction: record(session, reason, before, null, result.summary) };
    } finally { inFlight.delete(key); if (running.delete(key)) announce(session); }
  }

  /** The end of a turn: the meter moves, and a session past its threshold compacts once. */
  async function turnEnded(sessionKey: string): Promise<void> {
    // A host that shut down in the meantime has nothing left to measure.
    try { await measureTurn(sessionKey); } catch (err) { if (!/not open/i.test(String(err))) console.warn(`[context] ${sessionKey}: ${err instanceof Error ? err.message : String(err)}`); }
  }
  async function measureTurn(sessionKey: string): Promise<void> {
    // The usage record of the turn is closed a moment after the turn's last event.
    const settle = deps.settle_ms ?? 400;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, settle));
      const open = db.prepare("SELECT open FROM usage_records WHERE session_key = ? ORDER BY id DESC LIMIT 1").get(sessionKey) as { open: number } | undefined;
      if (!open || open.open === 0) break;
    }
    const session = deps.session(sessionKey);
    if (!session) return;
    // What a compaction left is known for certain when the next turn reports its request.
    const measured = measure(session), pending = compactions(sessionKey).at(-1);
    if (measured && pending && pending.tokensAfter === null && pending.ts_ms < measured.updated_ms) {
      db.prepare("UPDATE session_compactions SET tokens_after = ? WHERE id = ?").run(measured.usedTokens, pending.id);
      deps.notify(sessionKey, "jagentchill.chat.compacted", { sessionKey, compaction: { ...pending, tokensAfter: measured.usedTokens } });
    }
    announce(session);
    const state = stateOf(session);
    if (state.compaction !== "host" || !state.context || state.context.pct === undefined || state.autoCompact.effectivePct === 0 || state.context.pct < state.autoCompact.effectivePct) return;
    // What a compaction left is not compacted again before a turn measured the context anew.
    if (state.compactions.some((entry) => entry.ts_ms >= state.context!.updated_ms)) return;
    if (deps.isRunning(sessionKey) || inFlight.has(sessionKey)) return;
    await compact(session, "auto").catch((err) => console.warn(`[context] automatic compaction of ${sessionKey} failed: ${err instanceof Error ? err.message : String(err)}`));
  }

  /** A runtime compacted by itself inside a turn: the transcript shows it. */
  function runtimeEvent(key: string, event: RuntimeEvent): void {
    if (event.type !== "compaction") return;
    const session = deps.session(key);
    if (!session || inFlight.has(session.sessionKey)) return;
    // The start is the signal the chat shows "Compacting…" from.
    if (event.phase === "start") { if (!running.has(session.sessionKey)) { running.set(session.sessionKey, { since_ms: deps.now(), reason: "runtime" }); announce(session); } return; }
    running.delete(session.sessionKey);
    record(session, "runtime", measure(session)?.usedTokens ?? null, null);
  }

  const methods = new Map<string, RpcMethod>();
  const keyParams = z.object({ sessionKey: z.string().min(1).max(200) }).strict();
  const readable = (key: string, connection: Connection): SessionRecord => {
    const session = deps.session(key);
    if (!session || !deps.canRead(key, connection)) throw new ProtocolError("NOT_FOUND", "No such session.");
    return session;
  };
  const actable = (key: string, connection: Connection): SessionRecord => {
    const session = readable(key, connection);
    if (!deps.canAct(key, connection)) throw new ProtocolError("SCOPE_DENIED", "This device cannot change this session.");
    return session;
  };
  methods.set("jagentchill.session.context.get", { scope: "jagentchill.projects.read", handle: (raw, connection) => stateOf(readable(parse(keyParams, raw).sessionKey, connection)) });
  methods.set("jagentchill.session.context.set", {
    scope: "jagentchill.agent.use",
    handle(raw, connection) {
      const params = parse(z.object({ sessionKey: z.string().min(1).max(200), /** `null` follows the host's default again. */ autoCompactPct: pctParam.nullable().optional(), /** This session's own token limit (0: none); `null` follows the host's again. */ tokenLimit: tokenLimit.nullable().optional() }).strict(), raw);
      const session = actable(params.sessionKey, connection);
      db.prepare("INSERT INTO session_context (session_key) VALUES (?) ON CONFLICT (session_key) DO NOTHING").run(session.sessionKey);
      if (params.autoCompactPct !== undefined) db.prepare("UPDATE session_context SET auto_pct = ? WHERE session_key = ?").run(params.autoCompactPct, session.sessionKey);
      if (params.tokenLimit !== undefined) db.prepare("UPDATE session_context SET token_limit = ? WHERE session_key = ?").run(params.tokenLimit, session.sessionKey);
      announce(session);
      return stateOf(session);
    },
  });
  methods.set("jagentchill.session.compact", {
    scope: "jagentchill.agent.use",
    async handle(raw, connection) { return compact(actable(parse(keyParams, raw).sessionKey, connection), "manual"); },
  });
  const described = () => ({ ...settings(), steps: AUTO_COMPACT_STEPS, turnToolCallSteps: TURN_TOOL_CALL_STEPS });
  methods.set("jagentchill.context.settings.get", { scope: "jagentchill.projects.read", handle: described });
  methods.set("jagentchill.context.settings.set", {
    scope: "jagentchill.config.write",
    handle(raw) {
      const params = parse(z.object({
        autoCompactPct: pctParam.optional(), tokenLimits: z.object({ perSession: tokenLimit.optional(), perDay: tokenLimit.optional() }).strict().optional(),
        turnToolCalls: z.union([z.literal(25), z.literal(50), z.literal(100), z.literal(200)]).optional(), shortTurnContext: z.boolean().optional(), loadPersonalMcp: z.boolean().optional(),
      }).strict(), raw);
      const current = settings();
      deps.config.set("context", { ...(deps.config.get<Record<string, unknown>>("context") ?? {}), ...current, ...params, tokenLimits: { ...current.tokenLimits, ...params.tokenLimits } });
      deps.onSettings?.(settings());
      return described();
    },
  });

  return {
    methods, turnEnded, assertTokens, settings, runtimeEvent, stateOf: (key: string) => { const session = deps.session(key); return session && stateOf(session); },
    /** A turn ended: a compaction of a runtime that never reported its end is over with it. */
    turnOver(key: string): void { const entry = running.get(key); if (entry?.reason === "runtime" && !inFlight.has(key)) { running.delete(key); const session = deps.session(key); if (session) announce(session); } },
    sessionDeleted(key: string): void { running.delete(key); db.prepare("DELETE FROM session_context WHERE session_key = ?").run(key); db.prepare("DELETE FROM session_compactions WHERE session_key = ?").run(key); },
  };
}

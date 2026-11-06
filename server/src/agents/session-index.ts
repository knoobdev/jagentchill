/**
 * The WHOLE transcript of a session, read once from the server's transcript and kept for what a device cannot work out from the
 * page of messages it has loaded (a chat pane loads the newest 60 and pages back as the person scrolls):
 *  - the session's steps — every tool call with its result — for the Worklog, with their true total;
 *  - find-in-conversation over every message, with where each match stands so the pane can load up to it.
 * Read through the same `chat.history` the pane uses, page by page (`offset`), oldest page last. A transcript the engine
 * does not page (a CLI runtime's own session) gives what one read of 500 gives. Kept in memory for a few sessions and
 * brought up to date when the transcript has grown; nothing is stored.
 */
export type HistoryPage = { messages?: unknown[]; nextOffset?: number; hasMore?: boolean; totalMessages?: number };
export type IndexedStep = { kind: "tool"; id: string; messageId: string; newer: number; name: string; status: "completed" | "failed"; input?: string; output?: string; ts_ms?: number };
export type IndexedMessage = { id: string; role: "user" | "assistant"; text: string; ts_ms?: number; /** How many messages of the transcript are newer than this one: the `offset` of a page that ends with it. */ newer: number };
export type SessionIndex = { /** Messages in the transcript as the engine counts them; undefined when it does not say. */ total?: number; paged: boolean; messages: IndexedMessage[]; steps: IndexedStep[]; pages: number; read_ms: number; at_ms: number; lastId?: string; raw: number };

type Raw = { role?: string; content?: unknown; timestamp?: number; toolCallId?: string; isError?: boolean; id?: string; jagentchill?: { author?: unknown } | null };
type Part = { type?: string; text?: string; name?: string; id?: string; arguments?: unknown; input?: unknown; args?: unknown };
const partsOf = (content: unknown): Part[] => (typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? (content as Part[]) : []);
const textOf = (content: unknown): string => partsOf(content).filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text as string).join("");
/** As the pane's own `brief` (packages/app-core/src/agents/timeline.ts): what a step shows of its input and its result. */
const brief = (value: unknown, limit = 4000): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};
const idOf = (message: Raw): string | undefined => message.id;

/** Steps and searchable messages of raw transcript messages (oldest first), as the pane's `itemsFromHistory` reads them. */
export function indexMessages(raw: unknown[]): { messages: IndexedMessage[]; steps: IndexedStep[] } {
  const messages: IndexedMessage[] = [], steps: IndexedStep[] = [], calls = new Map<string, IndexedStep>();
  raw.forEach((entry, index) => {
    const message = entry as Raw, role = message.role ?? "", id = idOf(message) ?? `h${index}`;
    if (/tool/i.test(role)) {
      const call = calls.get(String(message.toolCallId ?? ""));
      if (call) { call.status = message.isError ? "failed" : "completed"; call.output = brief(textOf(message.content)); }
      return;
    }
    if (role !== "user" && role !== "assistant") return;
    let text = "";
    partsOf(message.content).forEach((part, at) => {
      const type = String(part.type ?? "");
      if (type === "text" && typeof part.text === "string") text += part.text;
      else if (/tool.?(call|use)/i.test(type) && typeof part.name === "string") {
        const step: IndexedStep = { kind: "tool", id: String(part.id ?? `${id}-c${at}`), messageId: id, newer: raw.length - 1 - index, name: part.name, status: "completed", input: brief(part.arguments ?? part.input ?? part.args), ...(typeof message.timestamp === "number" ? { ts_ms: message.timestamp } : {}) };
        calls.set(step.id, step);
        steps.push(step);
      }
    });
    // What the host wrote to the agent is not a message of the conversation a person reads.
    if (role === "user" && typeof message.jagentchill === "object" && message.jagentchill?.author === "host") return;
    const shown = role === "user" ? stripInjectedUserText(text) : text;
    if (shown.trim()) messages.push({ id, role, text: shown, ...(typeof message.timestamp === "number" ? { ts_ms: message.timestamp } : {}), newer: raw.length - 1 - index });
  });
  return { messages, steps };
}

/** Where `query` stands in the session's messages, newest first: a line of text around each match. */
export function searchIndex(index: SessionIndex, query: string, limit: number): { total: number; matches: Array<{ messageId: string; itemId?: string; kind: "message" | "step"; role: "user" | "assistant"; ts_ms?: number; snippet: string; at: number; newer: number }> } {
  const needle = query.trim().toLocaleLowerCase();
  const matches: ReturnType<typeof searchIndex>["matches"] = [];
  let total = 0;
  if (!needle) return { total, matches };
  const ranked: ReturnType<typeof searchIndex>["matches"] = [];
  for (let at = index.messages.length - 1; at >= 0; at--) {
    const message = index.messages[at]!, position = message.text.toLocaleLowerCase().indexOf(needle);
    if (position < 0) continue;
    total += 1;
    const from = Math.max(0, position - 60), to = Math.min(message.text.length, position + needle.length + 90);
    ranked.push({ messageId: message.id, kind: "message", role: message.role, ...(message.ts_ms !== undefined ? { ts_ms: message.ts_ms } : {}), snippet: `${from > 0 ? "…" : ""}${message.text.slice(from, to).replace(/\s+/g, " ")}${to < message.text.length ? "…" : ""}`, at: position - from + (from > 0 ? 1 : 0), newer: message.newer });
  }
  for (const step of index.steps) {
    const text = `${step.name} ${step.input ?? ""} ${step.output ?? ""}`, at = text.toLocaleLowerCase().indexOf(needle);
    if (at < 0) continue;
    total += 1;
    const from = Math.max(0, at - 60), to = Math.min(text.length, at + needle.length + 90);
    ranked.push({ messageId: step.messageId, itemId: step.id, kind: "step", role: "assistant", ...(step.ts_ms !== undefined ? { ts_ms: step.ts_ms } : {}), snippet: `${from > 0 ? "…" : ""}${text.slice(from, to).replace(/\s+/g, " ")}${to < text.length ? "…" : ""}`, at: at - from + (from > 0 ? 1 : 0), newer: step.newer });
  }
  ranked.sort((a, b) => a.newer - b.newer || (a.kind === "step" ? -1 : 1));
  matches.push(...ranked.slice(0, limit));
  return { total, matches };
}

const PAGE = 500, MAX_PAGES = 80, KEPT = 6, FRESH_MS = 1500;
export function createSessionIndex(deps: { read(sessionKey: string, params: { limit: number; offset?: number; maxChars: number }): Promise<HistoryPage>; now?: () => number }) {
  const now = deps.now ?? (() => Date.now());
  const kept = new Map<string, { index: SessionIndex; raw: unknown[] }>();
  const running = new Map<string, Promise<SessionIndex>>();
  const build = (raw: unknown[], facts: { total?: number; paged: boolean; pages: number; started: number }): SessionIndex => {
    const { messages, steps } = indexMessages(raw);
    const last = raw.at(-1) as Raw | undefined;
    return { ...(facts.total !== undefined ? { total: facts.total } : {}), paged: facts.paged, messages, steps, pages: facts.pages, read_ms: now() - facts.started, at_ms: now(), raw: raw.length, ...(last && idOf(last) ? { lastId: idOf(last)! } : {}) };
  };
  async function walk(sessionKey: string): Promise<SessionIndex> {
    const started = now(), had = kept.get(sessionKey);
    const newest = await deps.read(sessionKey, { limit: PAGE, maxChars: 500_000 });
    const paged = typeof newest.hasMore === "boolean", page = newest.messages ?? [];
    // The transcript only grew since it was read: the messages after the last known one are put at its end.
    if (had && paged && had.index.paged && had.index.lastId && typeof newest.totalMessages === "number" && newest.totalMessages >= (had.index.total ?? Infinity)) {
      const at = page.findLastIndex((message) => idOf(message as Raw) === had.index.lastId);
      if (at >= 0) {
        const raw = at === page.length - 1 ? had.raw : [...had.raw, ...page.slice(at + 1)];
        const index = build(raw, { total: newest.totalMessages, paged, pages: 1, started });
        kept.delete(sessionKey); kept.set(sessionKey, { index, raw });
        return index;
      }
    }
    let raw = page, pages = 1, offset = newest.nextOffset, more = newest.hasMore === true;
    while (more && typeof offset === "number" && pages < MAX_PAGES) {
      const older = await deps.read(sessionKey, { limit: PAGE, offset, maxChars: 500_000 });
      const list = older.messages ?? [];
      if (!list.length) break;
      raw = [...list, ...raw]; pages += 1;
      more = older.hasMore === true && typeof older.nextOffset === "number" && older.nextOffset > offset;
      offset = older.nextOffset;
    }
    const index = build(raw, { ...(typeof newest.totalMessages === "number" ? { total: newest.totalMessages } : {}), paged, pages, started });
    kept.delete(sessionKey); kept.set(sessionKey, { index, raw });
    while (kept.size > KEPT) kept.delete(kept.keys().next().value!);
    return index;
  }
  return {
    /** The session's index, read now unless it was read a moment ago. */
    async of(sessionKey: string): Promise<SessionIndex> {
      const had = kept.get(sessionKey);
      if (had && now() - had.index.at_ms < FRESH_MS) return had.index;
      const busy = running.get(sessionKey);
      if (busy) return busy;
      const next = walk(sessionKey).finally(() => running.delete(sessionKey));
      running.set(sessionKey, next);
      return next;
    },
    drop(sessionKey: string): void { kept.delete(sessionKey); },
  };
}
import { stripInjectedUserText } from "@jagentchill/protocol";

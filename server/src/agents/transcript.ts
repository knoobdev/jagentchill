import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/**
 * The server's own transcript of each agent session: what the person (or the host) sent, what the agent answered, the
 * tool calls it made and what they returned, written as the runtime streams them. The runtimes keep a transcript of
 * their own (which `resume` continues from); this one is what devices page through, what a hand-over or a fork carries,
 * and what usage and search read — the same for every runtime.
 *
 * A message has the shape devices already read (`role`, `content` parts, `timestamp`, `id`): `user` and `assistant`
 * messages with `text`, `thinking` and `toolCall` parts, and one `toolResult` message per finished call.
 */
export type TranscriptPart =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; id: string; name: string; arguments: unknown }
  | { type: "image"; mimeType: string; data: string; name?: string };
export type TranscriptUsage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number; cost?: { total?: number }; contextWindow?: number };
export type TranscriptMessage = {
  id: string; role: "user" | "assistant" | "toolResult"; content: TranscriptPart[]; timestamp: number;
  runId?: string; idempotencyKey?: string; toolCallId?: string; toolName?: string; isError?: boolean; usage?: TranscriptUsage; model?: string;
};
export type TranscriptPage = { messages: TranscriptMessage[]; nextOffset?: number; hasMore: boolean; totalMessages: number };

const clip = (message: TranscriptMessage, maxChars: number): TranscriptMessage => ({
  ...message,
  content: message.content.map((part) => (part.type === "text" && part.text.length > maxChars ? { ...part, text: `${part.text.slice(0, maxChars)}…` } : part.type === "thinking" && part.thinking.length > maxChars ? { ...part, thinking: `${part.thinking.slice(0, maxChars)}…` } : part)),
});

export function createTranscriptStore(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS session_messages (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, session_key TEXT NOT NULL, message_id TEXT NOT NULL, run_id TEXT, json TEXT NOT NULL, ts_ms INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS session_messages_session ON session_messages (session_key, seq);`);
  const insert = db.prepare("INSERT INTO session_messages (session_key, message_id, run_id, json, ts_ms) VALUES (?, ?, ?, ?, ?)");
  const count = db.prepare("SELECT COUNT(*) AS n FROM session_messages WHERE session_key = ?");
  const decode = (row: { json: string }) => JSON.parse(row.json) as TranscriptMessage;

  return {
    /** Appends one message; an id is given when it has none. */
    append(sessionKey: string, message: Omit<TranscriptMessage, "id"> & { id?: string }): TranscriptMessage {
      const stored: TranscriptMessage = { ...message, id: message.id ?? randomUUID() } as TranscriptMessage;
      insert.run(sessionKey, stored.id, stored.runId ?? null, JSON.stringify(stored), stored.timestamp);
      return stored;
    },
    /** Replaces a stored message (an assistant message whose usage arrived after it was written). */
    update(sessionKey: string, message: TranscriptMessage): void {
      db.prepare("UPDATE session_messages SET json = ? WHERE session_key = ? AND message_id = ?").run(JSON.stringify(message), sessionKey, message.id);
    },
    /** A page of the transcript, oldest first: `offset` newest messages are skipped, then `limit` older ones are returned. */
    page(sessionKey: string, opts: { limit: number; offset?: number; maxChars?: number }): TranscriptPage {
      const total = (count.get(sessionKey) as { n: number }).n;
      const offset = opts.offset ?? 0;
      const rows = db.prepare("SELECT json FROM session_messages WHERE session_key = ? ORDER BY seq DESC LIMIT ? OFFSET ?").all(sessionKey, opts.limit, offset) as Array<{ json: string }>;
      const messages = rows.reverse().map(decode).map((message) => clip(message, opts.maxChars ?? 8000));
      const hasMore = offset + rows.length < total;
      return { messages, hasMore, totalMessages: total, ...(hasMore ? { nextOffset: offset + rows.length } : {}) };
    },
    /** The newest `limit` messages, whole, oldest first. */
    recent(sessionKey: string, limit = 500): TranscriptMessage[] {
      return (db.prepare("SELECT json FROM session_messages WHERE session_key = ? ORDER BY seq DESC LIMIT ?").all(sessionKey, limit) as Array<{ json: string }>).reverse().map(decode);
    },
    /** The messages up to and including `messageId`, oldest first; undefined when no such message is stored. */
    upTo(sessionKey: string, messageId: string, limit = 500): TranscriptMessage[] | undefined {
      const anchor = db.prepare("SELECT seq FROM session_messages WHERE session_key = ? AND message_id = ?").get(sessionKey, messageId) as { seq: number } | undefined;
      if (!anchor) return undefined;
      return (db.prepare("SELECT json FROM session_messages WHERE session_key = ? AND seq <= ? ORDER BY seq DESC LIMIT ?").all(sessionKey, anchor.seq, limit) as Array<{ json: string }>).reverse().map(decode);
    },
    /** Takes one message out again (a turn the runtime refused to start). */
    drop(sessionKey: string, messageId: string): void { db.prepare("DELETE FROM session_messages WHERE session_key = ? AND message_id = ?").run(sessionKey, messageId); },
    total: (sessionKey: string): number => (count.get(sessionKey) as { n: number }).n,
    remove(sessionKey: string): void { db.prepare("DELETE FROM session_messages WHERE session_key = ?").run(sessionKey); },
  };
}
export type TranscriptStore = ReturnType<typeof createTranscriptStore>;

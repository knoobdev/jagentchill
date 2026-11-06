/**
 * What a tool call of the work log says: which tool was called, its arguments, and its outcome read from the host's
 * result envelope. Pure: the screen words and draws it.
 */
import { TICKS_PER_SECOND } from "../export/settings.ts";

type Bag = Record<string, unknown>;
const isBag = (value: unknown): value is Bag => typeof value === "object" && value !== null && !Array.isArray(value);
const parsed = (text: string | undefined): unknown => { if (!text) return undefined; try { return JSON.parse(text); } catch { return undefined; } };

/** `mcp__jagentchill__jc_text_add`, `jagentchill__jc_text_add` and `jagentchill:jc_text_add` are all `jc_text_add`. */
export function plainToolName(name: string): string {
  const own = /(jc_[a-z0-9_]+)$/.exec(name);
  return own ? own[1]! : name.replace(/^mcp__/, "");
}

export type ToolCallView = { tool: string; args: Bag | null };
/** The call as the reader should see it: the tool's plain name and its arguments. */
export function toolCallOf(item: { name: string; input?: string }): ToolCallView {
  const input = parsed(item.input);
  return { tool: plainToolName(item.name), args: isBag(input) ? input : null };
}

export type ToolOutcome = {
  /** null when the result says neither. */
  ok: boolean | null;
  /** The host's own sentence about what the call did. */
  summary?: string;
  error?: { code?: string; message: string };
  data?: unknown;
  /** The result as text, when it is not an envelope. */
  text?: string;
};
function envelopeIn(value: unknown, depth = 0): Bag | null {
  if (depth > 5 || value === null || value === undefined) return null;
  if (typeof value === "string") { const plain = value.trim(); return plain.length > 1 && (plain[0] === "{" || plain[0] === "[") ? envelopeIn(parsed(plain), depth + 1) : null; }
  if (Array.isArray(value)) { for (const entry of value) { const hit = envelopeIn(entry, depth + 1); if (hit) return hit; } return null; }
  if (!isBag(value)) return null;
  if (typeof value.ok === "boolean" && ("data" in value || "error" in value)) return value;
  for (const key of ["content", "text", "result", "details", "output"]) { const hit = envelopeIn(value[key], depth + 1); if (hit) return hit; }
  return null;
}
function textIn(value: unknown, depth = 0): string {
  if (depth > 5 || value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((entry) => textIn(entry, depth + 1)).filter(Boolean).join("\n");
  if (!isBag(value)) return String(value);
  if (value.type === "image") return "";
  for (const key of ["text", "content", "result", "output", "message"]) { const text = textIn(value[key], depth + 1); if (text) return text; }
  return "";
}
/**
 * A recording that was cut short is not JSON any more, but the envelope's own words are still in it: whether the call
 * went through, the code, and the sentence that says why. Without this a refused call would show the "{" its
 * recording starts with.
 */
function salvagedEnvelope(text: string): Pick<ToolOutcome, "summary" | "error"> & { ok?: boolean } | null {
  if (!/^\s*[{\[]/.test(text)) return null;
  // An envelope inside a string of the recording is escaped once more.
  const flat = /\\"(ok|error|code|message)\\"/.test(text) ? text.replace(/\\\\/g, "\u0000").replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\u0000/g, "\\") : text;
  const quoted = (key: string): string | undefined => {
    const hit = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(flat)?.[1];
    if (hit === undefined) return undefined;
    try { return JSON.parse(`"${hit}"`) as string; } catch { return hit.replace(/\\"/g, '"').replace(/\\n/g, "\n"); }
  };
  const ok = /"ok"\s*:\s*(true|false)/.exec(flat)?.[1], code = /"code"\s*:\s*"([A-Z][A-Z0-9_]*)"/.exec(flat)?.[1], message = quoted("why") ?? quoted("message"), summary = quoted("summary");
  if (ok === undefined && !code && !message) return null;
  return { ...(ok ? { ok: ok === "true" } : {}), ...(summary ? { summary } : {}), ...(code || message ? { error: { ...(code ? { code } : {}), message: message ?? "" } } : {}) };
}
/** The outcome of a call from its recorded result: the host's envelope when there is one, else the text. */
export function toolOutcomeOf(output: string | undefined, failed = false): ToolOutcome {
  if (!output) return { ok: failed ? false : null };
  // A recording that is JSON is read as JSON; anything else is its text.
  const value = parsed(output) ?? output;
  const envelope = envelopeIn(value);
  if (envelope) {
    // A refusal may carry, beside the sentence written for the agent (which names tools), the rule in words for a person (`details.why`): that is what the work log shows.
    const why = isBag(envelope.error) && isBag(envelope.error.details) && typeof envelope.error.details.why === "string" ? envelope.error.details.why : undefined;
    const error = isBag(envelope.error) ? { code: typeof envelope.error.code === "string" ? envelope.error.code : undefined, message: productWording(why ?? String(envelope.error.message ?? envelope.error.code ?? "")) } : undefined;
    return { ok: envelope.ok === true && !failed, ...(typeof envelope.summary === "string" && envelope.summary ? { summary: envelope.summary } : {}), ...(error ? { error } : {}), ...(envelope.data !== undefined ? { data: envelope.data } : {}) };
  }
  const plain = textIn(value).trim(), salvaged = salvagedEnvelope(plain);
  if (salvaged) return { ok: salvaged.ok === undefined ? (failed ? false : null) : salvaged.ok && !failed, ...(salvaged.summary ? { summary: salvaged.summary } : {}), ...(salvaged.error ? { error: salvaged.error } : {}) };
  // Data that is neither an envelope nor words (the start of a structure) is raw data: it is under "Show raw data", never the summary of a step.
  // The wording of failures is for failures: a successful result that merely contains "exit", "timeout" or "too large"
  // keeps its own words (it said "The agent is starting up" for a command check that worked). Diagnostics still never show.
  const text = /^\s*[{\[]/.test(plain) ? "" : failed ? productWording(plain) : ENGINE_TEXT.test(plain) ? "" : plain;
  return { ok: failed ? false : null, ...(text ? { text } : {}), ...(failed && text ? { error: { message: text.split("\n")[0]!.slice(0, 300) } } : {}) };
}

/**
 * A call the host holds until a person allows it (`APPROVAL_PENDING`): the runtime records it as an error of the tool,
 * but nothing went wrong — the person was asked, and the card under it carries the answer. It is not a failed step.
 */
export function toolAwaitsApproval(step: { status: string; output?: string }): boolean {
  if (step.status !== "failed" || !step.output || !step.output.includes("APPROVAL_PENDING")) return false;
  const error = toolOutcomeOf(step.output, true).error;
  return error?.code === "APPROVAL_PENDING" || /^\s*APPROVAL_PENDING\b/.test(error?.message ?? "");
}

/** Text that is diagnostics (a socket error, a stack frame, an exception), never a summary a person reads. */
const ENGINE_TEXT = /\beconn\w*\b|\bat\s+\S+\s*\(|\bexception\b|\binternal error\b/i;
/** "3244000 ticks" → "27.03 s": the editor's time unit is not a person's. */
const inSeconds = (text: string) => text.replace(/\b(\d{4,})\s*ticks\b/g, (_, ticks: string) => `${+(Number(ticks) / TICKS_PER_SECOND).toFixed(2)} s`);
/**
 * What an agent CLI said about a refused or failed tool, in the product's words: the person reads what went wrong, not
 * protocol codes or stack traces; the raw text stays under "Show raw data".
 */
export function productWording(raw: string): string {
  return inSeconds(wordingOf(raw));
}
function wordingOf(raw: string): string {
  // A runtime's tool result is often JSON (`{"status":"error","tool":"read","error":"…"}`): its message is what failed.
  const inner = messageOfJson(raw);
  if (inner !== undefined && inner !== raw) return wordingOf(inner);
  // A refusal of the product's own tools starts with its code ("PROJECT_NOT_SYNCED — …"): the sentence is for people, the code is raw data.
  const text = raw.replace(/^\s*[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+ — /, "");
  // A permission a person declined: the host answers the runtime "Denied by user"; a CLI words its own refusals alike.
  if (/(?:denied|rejected|declined) by (?:the )?user|user (?:denied|rejected|declined)/i.test(text)) return "You declined this.";
  if (/MCP error -32001/i.test(text)) return "The editor tool took too long to answer. Try again.";
  // File tools of a runtime reach only the agent's own work folder; a file it wrote under /tmp with a command is outside it.
  if (/outside (?:the )?workspace|outside the sandbox|outside (?:the )?allowed working director/i.test(text)) return "That file is outside the agent's work folder, so its file tools cannot open it.";
  if (/\bENOENT\b|no such file or directory/i.test(text)) return "That file or folder does not exist.";
  if (/\bEACCES\b|\bEPERM\b|permission denied|operation not permitted/i.test(text)) return "The system did not allow access to that file.";
  if (/\bEISDIR\b|is a directory/i.test(text)) return "That is a folder, not a file.";
  if (/quota.{0,30}(exceed|limit)|(?:exceed|limit).{0,30}quota|insufficient_quota|billing hard limit/i.test(text)) return "The provider account has reached its usage limit. Check its plan or usage, then try again.";
  if (/rate.?limit|too many requests|\b429\b/i.test(text)) return "The provider is limiting requests. Try again shortly.";
  if (/overload|temporarily unavailable|\b5\d\d\b|server error/i.test(text)) return "The provider is busy right now. Try again shortly.";
  if (/invalid model|unknown model|model id.{0,20}(invalid|unknown|not found)|model.{0,20}does not exist/i.test(text)) return "That model is no longer available. Choose another model in Model routing.";
  if (/context.{0,20}(too long|length|window|overflow|too large)|maximum context|prompt is too long|too many tokens/i.test(text)) return "The conversation is too long for this model. Compact it or start a new session.";
  if (/attachment|payload.{0,20}(too large|limit|exceed)|request body.{0,20}(large|limit)|too large/i.test(text)) return "This attachment is too large to send.";
  if (/session.{0,20}(not found|no longer exists)|unknown session/i.test(text)) return "This session is no longer available. Return to the session list and open it again.";
  if (/config.{0,20}(invalid|reject)|configuration.{0,20}(invalid|reject)/i.test(text)) return "The agent settings could not be applied. Review the settings and try again.";
  if (/abort|cancelled by (?:the )?user|stopped by (?:the )?user/i.test(text)) return "The turn was stopped.";
  if (/timed? ?out|timeout|etimedout|deadline exceeded/i.test(text)) return "The request took too long to finish. Try again.";
  if (/network|econn|ehostunreach|enetunreach|connection refused|connection closed/i.test(text)) return "The host could not reach the provider. Check the connection and try again.";
  if (/(?:agent|runtime|engine)\b.{0,40}\b(?:not running|not ready|restarting|starting)|child process of the (?:agent|runtime).*(?:exit|killed)/i.test(text)) return "The agent is starting up. Try again in a moment.";
  // Diagnostics are never useful as a tool result in the transcript.
  if (/\beconn\w*\b|\betimedout\b|stack|\bat\s+\S+\s*\(|^\s*[{[]|\bexception\b|\binternal error\b/i.test(text)) return "The action could not be completed. Try a different action.";
  if (/^\s*(?:\w+:\w+\s+)?hook error:/i.test(text)) return "The action could not be completed.";
  return text;
}

/** The message inside a JSON error result, if the text is one. */
function messageOfJson(raw: string): string | undefined {
  if (!/^\s*\{/.test(raw)) return undefined;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const nested = value.error && typeof value.error === "object" ? (value.error as Record<string, unknown>).message : undefined;
    const human = (entry: unknown) => typeof entry === "string" && entry.trim() && !/^[a-z0-9_.-]+$/i.test(entry.trim());
    const message = [value.error, nested, value.message, value.reason, value.stderr].find(human) ?? [value.error, nested, value.message].find((entry) => typeof entry === "string" && entry.trim());
    return typeof message === "string" ? message.trim() : undefined;
  } catch { return undefined; }
}

/** A time of the timeline as the editor writes it: 00:03, 01:12.5. */
export function clockOf(ticks: unknown): string | null {
  if (typeof ticks !== "number" || !Number.isFinite(ticks) || ticks < 0) return null;
  const tenths = Math.round((ticks / TICKS_PER_SECOND) * 10), seconds = Math.floor(tenths / 10), rest = tenths % 10;
  const pad = (value: number) => String(value).padStart(2, "0");
  const hours = Math.floor(seconds / 3600), head = hours ? `${hours}:${pad(Math.floor((seconds % 3600) / 60))}` : pad(Math.floor(seconds / 60));
  return `${head}:${pad(seconds % 60)}${rest ? `.${rest}` : ""}`;
}

const TIME_KEYS = /^(start|end|time|duration|to|at|from|sourceIn|sourceOut|offset|in|out)$/;
const short = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);
function valueText(key: string, value: unknown, limit: number, plain = false): string {
  if (typeof value === "number") return TIME_KEYS.test(key) && Number.isInteger(value) && value >= 0 ? clockOf(value) ?? String(value) : String(Math.round(value * 1000) / 1000);
  if (typeof value === "string") return short(value, limit);
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === "string" || typeof entry === "number")) return short(value.map((entry) => valueText(key.replace(/s$/, ""), entry, 40)).join(", "), limit);
    return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  }
  return short(Object.entries(value as Bag).filter(([name]) => !plain || !isTechnicalField(name)).map(([name, inner]) => `${name}: ${valueText(name, inner, 40, plain)}`).join(", "), limit);
}
/** `elementIds` → "Element ids": the name of a field as a label. */
export const fieldLabel = (key: string): string => { const words = key.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase(); return words.charAt(0).toUpperCase() + words.slice(1); };
/** Fields that name how the host keeps things (ids, keys, revisions), not what the person asked for or what changed. */
export const isTechnicalField = (key: string): boolean =>
  /^(id|uuid|etag|hash|sha256|checksum|nonce|token|revision|rev|version|seq|cursor|parentToolCallId|toolCallId|runId|sessionKey|sessionId|requestId|traceId|callId|clientId)$/i.test(key)
  || /(^|[_.-])(ids?|key|uuid|revision)$/i.test(key) || /[a-z0-9](Ids?|Key|Uuid|Revision|Hash)$/.test(key);
export type DetailRow = { key: string; label: string; value: string };
/** The fields of arguments or of a result as label / value lines, times as clock times; `more` counts what was left out. */
export function detailRows(value: unknown, options: { rows?: number; width?: number; /** Leave out the host's technical fields (ids, keys, revisions). */ plain?: boolean } = {}): { rows: DetailRow[]; more: number } {
  const limit = options.rows ?? 10, width = options.width ?? 160;
  if (!isBag(value)) return value === undefined || value === null || value === "" ? { rows: [], more: 0 } : { rows: [{ key: "", label: "", value: valueText("", value, width * 3) }], more: 0 };
  const entries = Object.entries(value).filter(([key, inner]) => inner !== undefined && inner !== null && inner !== "" && (!options.plain || !isTechnicalField(key)));
  return { rows: entries.slice(0, limit).map(([key, inner]) => ({ key, label: fieldLabel(key), value: valueText(key, inner, width, options.plain) })), more: Math.max(0, entries.length - limit) };
}

/** What a title may name, taken from the arguments under the names the editor tools use. */
export function titleParts(args: Bag | null): { text?: string; time?: string; count?: number; action?: string } {
  if (!args) return {};
  const word = [args.content, args.text, args.title, args.name, args.query, args.note].find((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
  const times = Array.isArray(args.times) ? args.times[0] : undefined;
  const time = clockOf(args.time ?? times ?? args.start ?? args.to ?? args.at);
  const many = [args.elementIds, args.items, args.times, args.assetIds, args.questions, args.agentIds].find(Array.isArray) as unknown[] | undefined;
  return { ...(word ? { text: short(word.replace(/\s+/g, " ").trim(), 48) } : {}), ...(time ? { time } : {}), ...(many ? { count: many.length } : {}), ...(typeof args.action === "string" ? { action: args.action } : {}) };
}

/** Pictures a tool returned (rendered frames), as data URIs; at most four are kept. */
export function imagesIn(value: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > 5 || out.length >= 4 || value === null || typeof value !== "object") return out;
  if (Array.isArray(value)) { for (const entry of value) imagesIn(entry, depth + 1, out); return out; }
  const bag = value as Bag;
  if (bag.type === "image" && typeof bag.data === "string" && out.length < 4) out.push(`data:${String(bag.mimeType ?? bag.mediaType ?? "image/png")};base64,${bag.data}`);
  else for (const key of ["content", "result", "details"]) imagesIn(bag[key], depth + 1, out);
  return out;
}

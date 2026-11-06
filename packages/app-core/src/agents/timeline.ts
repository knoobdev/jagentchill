import { imagesIn, toolAwaitsApproval } from "./worklog.ts";
import { stripInjectedUserText } from "@jagentchill/protocol";

/** The chat timeline of a session, built from the host's history and its live events. Pure: the screen only draws it. */
export type ToolStatus = "running" | "completed" | "failed" | "cancelled";
export type ChatAttachmentView = { attachmentId: string; blobId: string; name: string; mime: string; size: number };
export type ChatItem =
  | { kind: "user"; id: string; text: string; ts_ms?: number; handoverItems?: number; note?: string; pending?: boolean; attachments?: ChatAttachmentView[]; slashCommand?: { invocation: string; expansion: string }; /** The HOST wrote it (the editor's word to the agent), by the server's mark on the history message — never by its text. */ host?: boolean }
  | { kind: "assistant"; id: string; text: string; streaming?: boolean; ts_ms?: number; runId?: string; stopped?: boolean; /** When its first text arrived. */ started_ms?: number; /** Arrived while this screen was open: its text is revealed, not dropped in. */ fresh?: boolean; /** A tool call closed it (not the end of the turn): a late increment of the same text still belongs here. */ cut?: boolean }
  | { kind: "reasoning"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; title?: string; status: ToolStatus; started_ms?: number; ended_ms?: number; input?: string; output?: string; /** Pictures the tool returned (rendered frames). */ images?: string[]; /** This row stands for that many further calls of the same tool refused for the same limit. */ repeats?: number }
  | { kind: "media"; id: string; mediaType: "image" | "audio" | "video"; uri: string; name?: string }
  | { kind: "status"; id: string; text: string; ts_ms?: number }
  | { kind: "host-card"; id: string; title: string; rows: Array<{ label: string; value: string }>; ts_ms?: number; /** `/image`: the picture being made, shown as its progress. */ jobId?: string }
  | { kind: "error"; id: string; code: string; message: string; messageKey?: string; action?: string; retryable?: boolean; raw?: string }
  /** A card the pane draws at this place of the conversation: a question, a proposal, a notice, an approval. */
  | { kind: "card"; id: string; ts_ms: number };

export type ChatState = {
  items: ChatItem[];
  /** The id of the turn that is running, when one is. */
  runId: string | null;
  running: boolean;
  /** Messages accepted as follow-ups of the running turn, shown above the input until the turn ends. */
  queued: Array<{ id: string; text: string }>;
  /** The whole assistant text of the running turn so far; the stream adds increments to it. */
  live?: { runId: string | null; text: string };
  /** An increment of the stream was missed: the caller reads the text so far from the host and feeds it back in. */
  gap?: boolean;
  /** The running turn: when it began on this device's clock, and — while the model thinks before it writes or acts — since when, how many tokens so far and what it thought, as far as the runtime reports them. */
  turn?: { started_ms: number; thinking?: { since_ms: number; tokens?: number; text?: string }; /** What the turn is waiting for right now, and since when; absent while the model thinks or writes. */ wait?: TurnWait; wait_since_ms?: number; /** The id of the tool call that runs, when `wait` is `tool`. */ tool?: string };
};
/**
 * What a live turn waits for — every state the wire can leave it in between two things drawn, so that the status line
 * always says one of them:
 *  `starting` the message was sent and the host has not reported the turn yet · `host` the host itself starts a turn (its
 *  word to the agent) · `preparing` the runtime started the turn and has reported nothing of it yet · `model` the model was
 *  called and has written nothing yet, at the start or after a tool's result · `tool` a tool runs · `your-answer` the
 *  agent's question waits for the person · `answer-sent` / `decision-sent` the person answered a question / decided a
 *  card and the agent has not gone on yet · `compacting` the runtime compacts the conversation inside the turn.
 */
export type TurnWait = "starting" | "host" | "preparing" | "model" | "tool" | "your-answer" | "answer-sent" | "decision-sent" | "compacting";
export const emptyChat = (): ChatState => ({ items: [], runId: null, running: false, queued: [] });

type Part = Record<string, unknown>;
const partsOf = (content: unknown): Part[] => (typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? (content as Part[]) : []);
export const textOf = (content: unknown): string => partsOf(content).filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text as string).join("");

/** `mcp__jagentchill__jc_echo` and `jagentchill__jc_echo` are both shown as `jc_echo`. */
export const toolLabel = (name: string): string => name.replace(/^(mcp__)?jagentchill__/, "");
/** A result without the pictures in it: they are kept beside the text, not inside it. */
const withoutImages = (value: unknown, depth = 0): unknown => {
  if (depth > 5 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.filter((entry) => !(entry && typeof entry === "object" && (entry as Part).type === "image")).map((entry) => withoutImages(entry, depth + 1));
  return Object.fromEntries(Object.entries(value as Part).map(([key, inner]) => [key, withoutImages(inner, depth + 1)]));
};
const brief = (value: unknown, limit = 4000): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

const HANDOVER = /^<chat-history-summary>\n([\s\S]*?)\n<\/chat-history-summary>\s*/;
/** The conversation carried over a runtime switch leads the first message on the new runtime; the row shows it as a chip. */
export function splitHandover(text: string): { text: string; handoverItems?: number } {
  const match = HANDOVER.exec(text);
  if (!match) return { text };
  const items = /^Items: (\d+)$/m.exec(match[1]);
  return { text: text.slice(match[0].length), handoverItems: items ? Number(items[1]) : 0 };
}

function mediaOf(part: Part, id: string): ChatItem | null {
  const type = String(part.type ?? "");
  const kind = /image/.test(type) ? "image" : /audio/.test(type) ? "audio" : /video/.test(type) ? "video" : null;
  if (!kind) return null;
  const source = (part.source ?? part) as Part;
  const data = typeof source.data === "string" ? source.data : typeof part.data === "string" ? part.data : null;
  const mime = String(source.mediaType ?? source.media_type ?? part.mimeType ?? `${kind}/*`);
  const uri = typeof part.url === "string" ? part.url : typeof source.url === "string" ? source.url : data ? `data:${mime};base64,${data}` : null;
  return uri ? { kind: "media", id, mediaType: kind, uri, ...(typeof part.name === "string" ? { name: part.name } : {}) } : null;
}

/** The transcript as timeline items: text, reasoning, tool calls with their results, and media parts, in order. */
export function itemsFromHistory(messages: unknown[], /** Names this page among the pages of one transcript: a message without an id of its own gets a key no other page uses. */ page = ""): ChatItem[] {
  const items: ChatItem[] = [];
  const tools = new Map<string, Extract<ChatItem, { kind: "tool" }>>();
  messages.forEach((raw, index) => {
    const message = raw as { role?: string; content?: unknown; timestamp?: number; toolCallId?: string; isError?: boolean; id?: string; jagentchill?: { author?: unknown; attachments?: ChatAttachmentView[]; command?: { invocation?: unknown; expansion?: unknown }; picture?: { jobId?: unknown }; error?: { code?: unknown; message?: unknown; messageKey?: unknown; action?: unknown; retryable?: unknown; raw?: unknown } } | null };
    const role = message.role ?? "";
    const id = message.id ?? `h${page}${index}`;
    if (role === "error" && message.jagentchill?.error) {
      const error = message.jagentchill.error;
      items.push({ kind: "error", id, code: String(error.code ?? "UNAVAILABLE"), message: String(error.message ?? "The request could not be completed."), ...(typeof error.messageKey === "string" ? { messageKey: error.messageKey } : {}), ...(typeof error.action === "string" ? { action: error.action } : {}), ...(typeof error.retryable === "boolean" ? { retryable: error.retryable } : {}), ...(typeof error.raw === "string" ? { raw: error.raw } : {}) });
      return;
    }
    if (/tool/i.test(role)) {
      // A tool result closes the call it answers.
      const call = tools.get(String(message.toolCallId ?? ""));
      if (call) { call.status = message.isError ? "failed" : "completed"; call.output = brief(textOf(message.content)); const images = imagesIn(message.content); if (images.length) call.images = images; }
      return;
    }
    if (role !== "user" && role !== "assistant") return;
    let text = "";
    partsOf(message.content).forEach((part, at) => {
      const type = String(part.type ?? "");
      if (type === "text" && typeof part.text === "string") text += part.text;
      else if (/thinking|reasoning/i.test(type)) { const thought = String(part.thinking ?? part.text ?? "").trim(); if (thought) items.push({ kind: "reasoning", id: `${id}-r${at}`, text: thought }); }
      else if (/tool.?(call|use)/i.test(type) && typeof part.name === "string") {
        // Text written before a tool call stays above it.
        if (text.trim()) { items.push({ kind: "assistant", id: `${id}-t${at}`, text, ts_ms: message.timestamp }); text = ""; }
        const tool: Extract<ChatItem, { kind: "tool" }> = { kind: "tool", id: String(part.id ?? `${id}-c${at}`), name: part.name, status: "completed", input: brief(part.arguments ?? part.input ?? part.args) };
        tools.set(tool.id, tool);
        items.push(tool);
      } else {
        const media = mediaOf(part, `${id}-m${at}`);
        if (media) items.push(media);
      }
    });
    const historyHandoverItems = role === "user" ? splitHandover(text).handoverItems : undefined;
    if (role === "user") text = stripInjectedUserText(text);
    if (!text.trim()) return;
    if (role === "user") {
      const invocation = message.jagentchill?.command?.invocation, expansion = message.jagentchill?.command?.expansion;
      const slashCommand = typeof invocation === "string" && typeof expansion === "string" ? { invocation, expansion } : undefined;
      items.push({ kind: "user", id, ts_ms: message.timestamp, ...splitHandover(slashCommand?.invocation ?? text), ...(historyHandoverItems === undefined ? {} : { handoverItems: historyHandoverItems }), ...(slashCommand ? { slashCommand } : {}), ...(message.jagentchill?.attachments?.length ? { attachments: message.jagentchill.attachments } : {}), ...(typeof message.jagentchill === "object" && message.jagentchill?.author === "host" ? { host: true } : {}) });
      // `/image`: the picture the words started, shown under them as its progress.
      const pictureJob = message.jagentchill?.picture?.jobId;
      if (typeof pictureJob === "string") items.push({ kind: "host-card", id: `${id}-picture`, title: "", rows: [], ts_ms: message.timestamp, jobId: pictureJob });
    }
    else items.push({ kind: "assistant", id, text, ts_ms: message.timestamp });
  });
  return items;
}

export type ChatEvent = { event: string; payload: any; ts_ms?: number };
const ended = (state: string) => state === "final" || state === "error" || state === "aborted";

/** Reconcile a pane with the host's authoritative list of running turns (`activeRunIds` of the history answer). Undefined
 * means the host did not say, so callers keep the event-driven state. */
export function reconcileChatRun(chat: ChatState, activeRunIds: string[] | undefined, at = Date.now()): ChatState {
  if (!activeRunIds) return chat;
  const activeRunId = activeRunIds[0];
  if (!activeRunId) {
    if (!chat.running) return chat;
    return {
      ...chat, running: false, runId: null, live: undefined, gap: false, turn: undefined,
      items: chat.items.map((item) => item.kind === "assistant" && item.streaming ? { ...item, streaming: false, stopped: true } : item),
    };
  }
  if (chat.running && chat.runId === activeRunId) return chat;
  return { ...chat, running: true, runId: activeRunId, turn: { started_ms: at, wait: "starting", wait_since_ms: at } };
}

/** Folds one event of the session's stream into the timeline. Events of other sessions are the caller's to drop. */
export function applyChatEvent(chat: ChatState, event: ChatEvent): ChatState {
  const payload = event.payload ?? {}, name = event.event.replace(/^jagentchill\./, ""), at = event.ts_ms ?? Date.now();
  // The relay broadcasts this after the runtime's terminal event so every device can close the same run, including
  // when its stream event was lost. Ignore an end for an older run after a follow-up has already started.
  if (name === "chat.turn.ended") {
    if (typeof payload.runId === "string" && chat.runId && payload.runId !== chat.runId) return chat;
    return reconcileChatRun(chat, [], at);
  }
  // The host starts a turn itself (the person answered a question whose call no longer holds, decided a card…): the
  // turn is alive from this moment, before the runtime reports anything of it.
  if (name === "chat.turn.pending") {
    if (payload.cancelled) return chat.running && !chat.runId && chat.turn?.wait && PENDING_WAITS.includes(chat.turn.wait) ? { ...chat, running: false, turn: undefined } : chat;
    if (chat.running) return chat;
    const wait: TurnWait = payload.reason === "answer" ? "answer-sent" : payload.reason === "decision" ? "decision-sent" : "host";
    return { ...chat, running: true, turn: { started_ms: at, wait, wait_since_ms: at } };
  }
  // A question of the agent and its answer are not events of the turn's stream, but they are what a turn waits for.
  if (name === "chat.question.requested" || name === "chat.question.resolved" || name === "chat.permission.resolved") {
    if (!chat.running || !chat.turn) return chat;
    const state = name === "chat.permission.resolved" ? "decided" : String(payload.question?.state ?? "");
    const wait: TurnWait | undefined = state === "pending" ? "your-answer" : state === "answered" || state === "skipped" ? "answer-sent" : state === "decided" ? "decision-sent" : undefined;
    return wait ? { ...chat, turn: { started_ms: chat.turn.started_ms, wait, wait_since_ms: at } } : chat;
  }
  const next = foldChatEvent(chat, event);
  if (!next.running) return next.turn ? { ...next, turn: undefined } : next;
  const started_ms = next.turn?.started_ms ?? at, before = next.turn?.thinking;
  // The model thinks: a runtime reports the thought itself (`text`, `delta`) or only how far it is (`progressTokens`).
  if (name === "chat.activity" && payload.stream === "thinking") {
    const data = payload.data ?? {};
    const text: string | undefined = typeof data.text === "string" ? data.text : typeof data.delta === "string" ? (before?.text ?? "") + data.delta : before?.text;
    const tokens: number | undefined = typeof data.progressTokens === "number" ? data.progressTokens : before?.tokens;
    return { ...next, turn: { started_ms, thinking: { since_ms: before?.since_ms ?? at, ...(tokens !== undefined ? { tokens } : {}), ...(text ? { text } : {}) } } };
  }
  const waiting = (wait: TurnWait | undefined, tool?: string): ChatState => {
    const held = next.turn;
    if (held && !held.thinking && held.wait === wait && held.tool === tool) return next;
    return { ...next, turn: { started_ms, ...(wait ? { wait, wait_since_ms: at } : {}), ...(tool ? { tool } : {}) } };
  };
  const data = payload.data ?? {};
  // Text ends every wait: the answer is being written.
  if (name === "chat.stream" && payload.state === "delta" && typeof payload.deltaText === "string" && payload.deltaText.length > 0) return waiting(undefined);
  // A tool runs; when it is over and no other one runs, the model is asked again.
  const isTool = name === "chat.activity" && payload.stream === "tool" && typeof data.toolCallId === "string";
  if (isTool) {
    const over = data.phase === "result";
    if (!over) return next.turn?.wait === "your-answer" ? next : waiting("tool", data.toolCallId);
    // The result of the question's own call follows the answer at once: the answer stays "sent" until the agent goes on.
    if (next.turn?.wait === "answer-sent" || next.turn?.wait === "decision-sent") return next;
    const still = next.items.findLast((item) => item.kind === "tool" && item.status === "running");
    return still ? waiting("tool", still.id) : waiting("model");
  }
  if (name === "chat.activity" && payload.stream === "compaction") return waiting(data.phase === "start" ? "compacting" : "model");
  // The runtime took the turn: the model is being asked. The person's answer or decision stays "sent", and a question,
  // a tool or a compaction in progress keeps its words, until the agent writes or acts again.
  const sticky = next.turn?.wait === "answer-sent" || next.turn?.wait === "decision-sent" || next.turn?.wait === "your-answer" || next.turn?.wait === "compacting" || next.turn?.wait === "tool";
  if (name === "chat.activity" && payload.stream === "lifecycle" && data.phase === "start") return sticky ? next : waiting("model");
  if (!next.turn) return { ...next, turn: { started_ms, wait: "preparing", wait_since_ms: at } };
  if (before) return { ...next, turn: { started_ms, ...(next.turn.wait ? { wait: next.turn.wait, wait_since_ms: next.turn.wait_since_ms } : {}) } };
  return next;
}
/** The waits of a turn the host announced and the runtime has not reported yet. */
const PENDING_WAITS: readonly TurnWait[] = ["host", "answer-sent", "decision-sent"];
/** The text of a row as it is compared with another report of the same text. */
const trimmed = (text: string) => text.trim();
function foldChatEvent(chat: ChatState, event: ChatEvent): ChatState {
  const payload = event.payload ?? {};
  const name = event.event.replace(/^jagentchill\./, "");
  if (name === "chat.activity" && payload.stream === "tool" && typeof payload.data?.toolCallId === "string") {
    // The runtime's own account of a call: what it was asked (at the start) and what came back (at the end).
    const { toolCallId, name: tool, phase, args, result, isError } = payload.data;
    const existing = chat.items.find((item) => item.kind === "tool" && item.id === toolCallId) as Extract<ChatItem, { kind: "tool" }> | undefined;
    const over = phase === "result";
    const next: Extract<ChatItem, { kind: "tool" }> = {
      ...(existing ?? { kind: "tool", id: toolCallId, name: tool ?? "tool", status: "running", started_ms: event.ts_ms }),
      ...(brief(args) ? { input: brief(args) } : {}),
      ...(over ? { status: isError ? "failed" : existing?.status === "failed" ? "failed" : "completed", ended_ms: existing?.ended_ms ?? event.ts_ms } : {}),
      ...(over && brief(withoutImages(result)) ? { output: brief(withoutImages(result)) } : {}),
    };
    const images = over && result ? imagesIn(result) : [];
    if (images.length) next.images = images;
    const items = existing ? chat.items.map((item) => (item === existing ? next : item)) : [...chat.items.map((item) => (item.kind === "assistant" && item.streaming ? { ...item, streaming: false, cut: true } : item)), next];
    // The report of a call's end may arrive after the turn was stopped: it does not make the turn run again.
    return over ? { ...chat, items } : { ...chat, items, running: true, runId: chat.runId ?? payload.runId ?? null };
  }
  if (name === "chat.stream") {
    const runId: string | null = typeof payload.runId === "string" ? payload.runId : chat.runId;
    const open = chat.items.findLast((item) => item.kind === "assistant" && item.streaming) as Extract<ChatItem, { kind: "assistant" }> | undefined;
    // The stream carries the whole text of the turn so far. What was written before a tool call already stands above
    // that call, so only what follows it goes below.
    // A status event in the middle of a turn carries no text and changes none.
    if (payload.state !== "delta" && !ended(payload.state)) return { ...chat, running: true, runId };
    let text: string;
    let live = chat.live;
    if (!ended(payload.state) && typeof payload.deltaText === "string") {
      const before = live && live.runId === runId ? live.text : "";
      text = payload.replace ? payload.deltaText : before + payload.deltaText;
      // The host says how long the text is after this increment; another length means one was missed.
      if (typeof payload.length === "number" && text.length !== payload.length) return { ...chat, running: true, runId, gap: true };
      live = { runId, text };
    } else {
      text = textOf(payload.message?.content);
      if (!ended(payload.state)) live = { runId, text };
    }
    // What stands above already — text closed by a tool call — is not written again.
    let cut: Extract<ChatItem, { kind: "assistant" }> | undefined, tail = "";
    for (const item of chat.items) {
      if (item === open || item.kind !== "assistant" || !item.runId || item.runId !== runId || !trimmed(item.text)) continue;
      const lead = text.replace(/^\s+/, ""), drawn = trimmed(item.text);
      if (lead.startsWith(drawn)) {
        tail = lead.slice(drawn.length);
        // An increment that arrived after the tool call which closed its row: it continues that row (the runtime starts a
        // new message on a new line), it is not a new one below the tool.
        cut = item.cut && tail.length > 0 && !/^\s*\n/.test(tail) ? item : undefined;
        text = tail.replace(/^\s+/, "");
      } else if (drawn.startsWith(trimmed(lead))) { text = ""; cut = undefined; }
      else cut = undefined;
    }
    if (cut && !ended(payload.state) && !open) {
      const whole = `${cut.text}${tail}`, target = cut;
      return { ...chat, items: chat.items.map((item) => (item === target ? { ...target, text: whole } : item)), running: true, runId, live, gap: false };
    }
    if (!ended(payload.state)) {
      if (!text) return { ...chat, running: true, runId, live, gap: false };
      if (open && open.text === text) return { ...chat, running: true, runId, live, gap: false };
      const items = open ? chat.items.map((item) => (item === open ? { ...open, text } : item)) : [...chat.items, { kind: "assistant" as const, id: `${runId ?? "run"}-s${chat.items.length}`, text, streaming: true, fresh: true, started_ms: event.ts_ms, runId: runId ?? undefined }];
      return { ...chat, items, running: true, runId, live, gap: false };
    }
    let items = chat.items.map((item): ChatItem => {
      if (item === open) return { ...open, text: text || open.text, streaming: false, ts_ms: event.ts_ms, stopped: payload.state === "aborted" };
      // A stopped turn keeps its partial output and marks running tool calls as cancelled.
      if (item.kind === "tool" && item.status === "running") return { ...item, status: payload.state === "final" ? "completed" : "cancelled", ended_ms: event.ts_ms };
      return item;
    });
    if (!open && text) items = [...items, { kind: "assistant", id: `${runId ?? "run"}-final${items.length}`, text, ts_ms: event.ts_ms, fresh: true, runId: runId ?? undefined }];
    if (payload.state === "aborted") items = [...items, { kind: "status", id: `stopped-${runId ?? items.length}`, text: "Stopped", ts_ms: event.ts_ms }];
    // The follow-ups held for this turn start their own turns now; the first of them is already running.
    const [next, ...rest] = chat.queued;
    if (next) items = [...items, { kind: "user", id: next.id, text: next.text, ts_ms: event.ts_ms }];
    return { items, running: !!next, runId: null, queued: rest };
  }
  if (name === "chat.error") {
    const error = payload.error ?? {};
    const id = typeof payload.id === "string" ? payload.id : `e-${payload.runId ?? chat.items.length}`;
    if (chat.items.some((item) => item.id === id)) return chat;
    return { ...chat, items: [...chat.items, { kind: "error", id, code: String(error.code ?? "UNAVAILABLE"), message: String(error.message ?? "The turn failed."), ...(typeof error.details?.userMessageKey === "string" ? { messageKey: error.details.userMessageKey } : {}), ...(typeof error.details?.action === "string" ? { action: error.details.action } : {}), ...(typeof error.retryable === "boolean" ? { retryable: error.retryable } : {}), raw: error.details?.raw }] };
  }
  if (name === "chat.notice") return { ...chat, items: [...chat.items, { kind: "status", id: `n-${payload.code}-${chat.items.length}`, text: String(payload.message ?? ""), ts_ms: payload.ts_ms ?? event.ts_ms }] };
  return chat;
}

/** The user's own message, shown at once; `queued` when it waits for the running turn to end. */
export function withUserMessage(chat: ChatState, id: string, text: string, options: { queued?: boolean; handoverItems?: number; ts_ms?: number } = {}): ChatState {
  if (options.queued) return { ...chat, queued: [...chat.queued, { id, text }] };
  return { ...chat, items: [...chat.items, { kind: "user", id, text, ts_ms: options.ts_ms, ...(options.handoverItems ? { handoverItems: options.handoverItems } : {}) }], running: true, turn: chat.running && chat.turn ? chat.turn : { started_ms: options.ts_ms ?? Date.now(), wait: "starting", wait_since_ms: options.ts_ms ?? Date.now() } };
}
/**
 * The transcript read from the host joined with what the pane already shows. A message sent straight away (the first
 * message of a new session) is shown at once and is, by the time the transcript arrives, usually in it too: the copy
 * the pane made itself is dropped, so the person's message is one bubble. Other rows added meanwhile stay after it.
 */
export function mergeHistory(history: ChatItem[], shown: ChatItem[]): ChatItem[] {
  // Only the transcript's last turn can hold a message this pane has just sent.
  let from = history.length;
  while (from > 0 && history[from - 1]!.kind !== "assistant") from -= 1;
  // Only a PERSON's message of the transcript can be the copy of a row this pane made: a message the host wrote (its
  // mark, never its text) is nobody's send, even when a person sent the same words.
  const sent = history.slice(from).filter((item) => item.kind === "user" && !item.host).map((item) => (item as Extract<ChatItem, { kind: "user" }>).text.trim());
  const last = [...history].reverse().find((item) => item.kind === "user" && !item.host) as Extract<ChatItem, { kind: "user" }> | undefined;
  if (last && !sent.includes(last.text.trim())) sent.push(last.text.trim());
  const knownIds = new Set(history.map((item) => item.id));
  // The agent's words streamed into the pane carry the stream's ids, the transcript's copy of them another id: the same
  // words already in the transcript are that copy (seen after Stop, when the pane reads the transcript again).
  const said = new Set(history.flatMap((item) => (item.kind === "assistant" ? [item.text.trim()] : [])));
  const pictures = new Set(history.flatMap((item) => (item.kind === "host-card" && item.jobId ? [item.jobId] : [])));
  const keptIds = new Set<string>();
  const kept = shown.filter((item) => {
    // A live row can also arrive in chat.history before the final stream event is folded in. Keep its host id once.
    if (knownIds.has(item.id) || keptIds.has(item.id)) return false;
    if (item.kind === "assistant" && said.has(item.text.trim())) return false;
    // A picture's progress shown at once under the person's message: the transcript's copy of it replaces it.
    if (item.kind === "host-card" && item.jobId && pictures.has(item.jobId)) return false;
    keptIds.add(item.id);
    if (item.kind !== "user" || !/^u\d+$/.test(item.id)) return true;
    const at = sent.indexOf(item.text.trim());
    if (at === -1) return true;
    sent.splice(at, 1);
    return false;
  });
  return [...history, ...kept];
}
/**
 * A turn another place started reaches a pane as its events only — the editor's "new session" composer sends the first
 * message itself, another device sends into an open session — so the person's message is missing from the rows. When
 * the turn has ended the transcript holds it: it is put where the turn starts. A pane that shows no message of a person
 * at all gets it first; otherwise the rows are taken from the transcript, unless the pane holds rows the transcript
 * does not have (a status line, an error), which are never dropped for this.
 */
export function withTranscriptUser(history: ChatItem[], shown: ChatItem[]): ChatItem[] {
  const last = history.findLast((item) => item.kind === "user") as Extract<ChatItem, { kind: "user" }> | undefined;
  if (!last) return shown;
  const users = shown.filter((item) => item.kind === "user") as Extract<ChatItem, { kind: "user" }>[];
  // The host's own message is the one the pane shows only when the pane has THAT message (its id, with the server's
  // mark): a person's row with the same words is not it. A person's message is known by its words, as the pane's own
  // row of it has another id.
  const isLast = (item: Extract<ChatItem, { kind: "user" }>) => (last.host ? item.host === true && item.id === last.id : !item.host && item.text.trim() === last.text.trim());
  if (users.some(isLast) && users.length >= history.filter((item) => item.kind === "user").length) return shown;
  // The person's messages, each with the picture it started (shown under it).
  const pictureOf = new Set<ChatItem>(history.flatMap((item, at): ChatItem[] => (item.kind === "host-card" && item.jobId && history[at - 1]?.kind === "user" ? [item] : [])));
  if (users.length === 0) return [...history.slice(0, history.indexOf(last) + 2).filter((item) => item.kind === "user" || pictureOf.has(item)), ...shown];
  if (users.some(isLast)) return shown;
  return shown.some((item) => item.kind === "status" || item.kind === "error" || (item.kind === "assistant" && item.streaming)) ? shown : history;
}
export const withStatus = (chat: ChatState, text: string, ts_ms?: number): ChatState => ({ ...chat, items: [...chat.items, { kind: "status", id: `s-${chat.items.length}-${ts_ms ?? 0}`, text, ts_ms }] });

export type ToolItem = Extract<ChatItem, { kind: "tool" }>;
export type ReasoningItem = Extract<ChatItem, { kind: "reasoning" }>;
export type ChatBlock =
  | { kind: "item"; item: Exclude<ChatItem, { kind: "tool" | "reasoning" }> }
  | { kind: "reasoning"; id: string; item: ReasoningItem }
  | { kind: "activity"; id: string; steps: ToolItem[] };
/** Consecutive tool calls form one collapsible activity group; what the model thought is a block of its own. */
const limitRefusal = (item: ToolItem): boolean => item.status === "failed" && /RATE_LIMITED/.test(item.output ?? "");
export function blocksOf(all: ChatItem[]): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  for (const item of all) {
    const last = blocks[blocks.length - 1];
    if (item.kind === "reasoning") blocks.push({ kind: "reasoning", id: `r-${item.id}`, item });
    else if (item.kind !== "tool") blocks.push({ kind: "item", item });
    else if (last?.kind === "activity") {
      // A tool refused for a limit and called again and again is one refusal and one line that counts the rest.
      const before = last.steps[last.steps.length - 1]!, first = before.repeats ? last.steps[last.steps.length - 2] : before;
      if (first && limitRefusal(item) && limitRefusal(first) && item.name === first.name) {
        if (before.repeats) last.steps[last.steps.length - 1] = { ...before, repeats: before.repeats + 1, ended_ms: item.ended_ms };
        else last.steps.push({ ...item, id: `${item.id}-more`, repeats: 1, images: undefined });
      } else last.steps.push(item);
    } else blocks.push({ kind: "activity", id: `g-${item.id}`, steps: [item] });
  }
  return blocks;
}

/** When a row of the timeline began, as far as it is known. */
const beganAt = (item: ChatItem): number | undefined =>
  item.kind === "tool" ? item.started_ms : item.kind === "assistant" ? item.started_ms ?? item.ts_ms : "ts_ms" in item ? item.ts_ms : undefined;
/**
 * The timeline with its cards where they happened: a card stands before the first row that began after it, so what the
 * agent writes after a question or a proposal appears below that card, never above it. A row without a time belongs to
 * the moment of the row before it.
 */
export function withCards(items: ChatItem[], cards: ReadonlyArray<{ id: string; ts_ms: number }>): ChatItem[] {
  if (!cards.length) return items;
  const sorted = [...cards].sort((a, b) => a.ts_ms - b.ts_ms);
  const out: ChatItem[] = [];
  let next = 0;
  for (const item of items) {
    const at = beganAt(item);
    while (next < sorted.length && at !== undefined && at > sorted[next]!.ts_ms) out.push({ kind: "card", ...sorted[next++]! });
    out.push(item);
  }
  while (next < sorted.length) out.push({ kind: "card", ...sorted[next++]! });
  return out;
}

export const durationLabel = (ms: number): string => {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
};
/** "Worked for 1m 12s · 4 steps", or "Working · 2 steps" while the group's last step runs. */
export function activitySummary(steps: ToolItem[], live: boolean): { text: string; failed: number } {
  const tools = steps;
  const running = live && tools.some((tool) => tool.status === "running");
  const starts = tools.map((tool) => tool.started_ms).filter((value): value is number => typeof value === "number");
  const ends = tools.map((tool) => tool.ended_ms).filter((value): value is number => typeof value === "number");
  const span = starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : null;
  const count = `${tools.length || steps.length} ${(tools.length || steps.length) === 1 ? "step" : "steps"}`;
  return { text: running ? `Working · ${count}` : span !== null && span > 0 ? `Worked for ${durationLabel(span)} · ${count}` : `Worked · ${count}`, failed: tools.filter((tool) => tool.status === "failed" && !toolAwaitsApproval(tool)).length };
}
export const toolDuration = (tool: ToolItem): string | null => (typeof tool.started_ms === "number" && typeof tool.ended_ms === "number" ? durationLabel(tool.ended_ms - tool.started_ms) : null);

/** The state shown under a session in the sidebar and in the top bar. */
export function sessionState(input: { approvals: number; running: boolean; failed: boolean }): { label: string; tone: "warning" | "info" | "danger" } | null {
  if (input.approvals > 0) return { label: "Needs approval", tone: "warning" };
  if (input.running) return { label: "Working", tone: "info" };
  if (input.failed) return { label: "Failed", tone: "danger" };
  return null;
}

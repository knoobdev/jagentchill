import type { ModelRef } from "@jagentchill/protocol";

const MAX_CHARACTERS = 200_000;
const MAX_RESULT_CHARACTERS = 2000;

export type HistoryMessage = { role?: string; content?: unknown; toolName?: string; name?: string; timestamp?: number };
export type Handover = { text: string; itemCount: number; omittedCount: number };

const oneLine = (value: unknown, limit: number): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.replace(/\s+/g, " ").trim().slice(0, limit);
};

/** One timeline item as text. Reasoning and binary content are left out; an attachment is listed by name and kind. */
function render(message: HistoryMessage): string | undefined {
  const role = message.role ?? "";
  if (role === "system") return undefined;
  const parts = typeof message.content === "string" ? [{ type: "text", text: message.content }] : Array.isArray(message.content) ? (message.content as Array<Record<string, unknown>>) : [];
  const lines: string[] = [];
  for (const part of parts) {
    const type = String(part?.type ?? "");
    if (type === "text" && typeof part.text === "string" && part.text.trim()) lines.push(part.text.trim());
    else if (/thinking|reasoning/i.test(type)) continue;
    else if (/tool.?(call|use)/i.test(type)) lines.push(`[tool ${String(part.name ?? part.toolName ?? "call")}] ${oneLine(part.arguments ?? part.input ?? part.args ?? "", 200)}`);
    else if (/tool.?result/i.test(type)) lines.push(`[result] ${oneLine(part.content ?? part.text ?? part.output ?? "", MAX_RESULT_CHARACTERS)}`);
    else if (/image|file|audio|video|document/i.test(type)) lines.push(`[attachment: ${String(part.name ?? part.fileName ?? "unnamed")} (${type})]`);
  }
  if (!lines.length) return undefined;
  if (/tool/i.test(role)) return `Tool result${message.toolName ?? message.name ? ` (${message.toolName ?? message.name})` : ""}: ${oneLine(lines.join(" "), MAX_RESULT_CHARACTERS)}`;
  return `${role === "user" ? "User" : "Assistant"}: ${lines.join("\n")}`;
}

/**
 * The earlier conversation as text for a runtime that keeps its own context. Capped at 200 000 characters: the oldest
 * items are dropped whole and their number is stated after the header, so the most recent items stay intact.
 */
export function buildHandover(input: { title: string; from: ModelRef; created_ms: number; workspace?: string; project?: string; messages: HistoryMessage[] }): Handover {
  const items = input.messages.map(render).filter((item): item is string => !!item);
  const header = (omitted: number) => [
    `Session: ${input.title}`,
    `Earlier runtime and model: ${input.from.runtimeId} · ${input.from.providerId}/${input.from.modelId}`,
    ...(input.workspace ? [`Workspace: ${input.workspace}`] : []),
    ...(input.project ? [`Project: ${input.project}`] : []),
    `Started: ${new Date(input.created_ms).toISOString()}`,
    `Items: ${items.length}`,
    ...(omitted ? [`[${omitted} earlier items omitted]`] : []),
  ].join("\n");
  const wrap = (kept: string[], omitted: number) => `<chat-history-summary>\n${header(omitted)}\n\n${kept.join("\n\n")}\n</chat-history-summary>`;
  let start = 0;
  let size = items.reduce((sum, item) => sum + item.length + 2, 0);
  // Room for the header, the wrapper and the omission marker.
  const budget = MAX_CHARACTERS - header(items.length).length - 64;
  while (start < items.length && size > budget) size -= items[start++].length + 2;
  return { text: wrap(items.slice(start), start), itemCount: items.length, omittedCount: start };
}

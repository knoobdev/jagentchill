/**
 * What `jc_agent_activity` tells one agent about another (`Tools jc_agent_status and jc_agent_activity`): the recent
 * entries of its conversation as plain text — what it was asked, what it answered, which tools it called and how they
 * ended. Never reasoning, never the input of a tool outside the `jc_*` families, never a file's content.
 */
type Part = { type?: unknown; text?: unknown; name?: unknown; arguments?: unknown; input?: unknown; args?: unknown; id?: unknown };
type Message = { role?: string; content?: unknown; toolCallId?: string; isError?: boolean };

const CONTENT_MAX = 12_000;
const oneLine = (text: string, max: number) => { const flat = text.replace(/\s+/g, " ").trim(); return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat; };
const partsOf = (content: unknown): Part[] => (typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? (content as Part[]).filter((part) => part && typeof part === "object") : []);
const textOf = (content: unknown) => partsOf(content).filter((part) => part.type === "text" && typeof part.text === "string").map((part) => String(part.text)).join("\n");

/** The entries of a transcript, one line each, in order. */
export function activityEntries(messages: unknown[]): string[] {
  const entries: string[] = [], calls = new Map<string, number>();
  for (const raw of messages) {
    const message = raw as Message, role = message.role ?? "";
    if (/tool/i.test(role)) {
      // A result closes the line of the call it answers: only whether it worked and its first words.
      const at = calls.get(String(message.toolCallId ?? ""));
      if (at !== undefined) entries[at] += message.isError ? ` — failed: ${oneLine(textOf(message.content), 160)}` : " — ok";
      continue;
    }
    if (role !== "user" && role !== "assistant") continue;
    let text = "";
    const flush = () => { if (text.trim()) entries.push(`${role === "user" ? "Asked" : "Agent"}: ${oneLine(text, 600)}`); text = ""; };
    for (const part of partsOf(message.content)) {
      const type = String(part.type ?? "");
      if (type === "text" && typeof part.text === "string") text += part.text;
      else if (/tool.?(call|use)/i.test(type) && typeof part.name === "string") {
        flush();
        const name = part.name.replace(/^.*__/, ""), input = part.arguments ?? part.input ?? part.args;
        // The input of the product's own tools says what was done to the project; any other tool's input may hold a path, a command or a secret.
        const shown = /^jc_/.test(name) && input && typeof input === "object" ? ` ${oneLine(JSON.stringify(input), 200)}` : "";
        calls.set(String(part.id ?? ""), entries.length);
        entries.push(`Tool ${name}${shown}`);
      }
      // Reasoning parts and media are left out.
    }
    flush();
  }
  return entries;
}

/** The entries after `sinceCursor`, the newest `maxItems` of them, as text of at most 12,000 characters. */
export function activityOf(messages: unknown[], sinceCursor: string | undefined, maxItems: number, currentMode: string): { updateCount: number; cursor: string; currentMode: string; content: string } {
  const entries = activityEntries(messages), from = Math.min(entries.length, Math.max(0, Number.parseInt(sinceCursor ?? "0", 10) || 0));
  const fresh = entries.slice(from), shown = fresh.slice(-maxItems);
  let content = shown.join("\n");
  if (content.length > CONTENT_MAX) content = `…${content.slice(content.length - CONTENT_MAX + 1)}`;
  return { updateCount: fresh.length, cursor: String(entries.length), currentMode, content };
}

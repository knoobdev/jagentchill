/** Timeline rows shown in a chat, normalised from the host's history and live events. */
export type Row =
  | { kind: "user" | "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; status: "running" | "completed" | "failed"; title?: string };

type Part = { type?: string; text?: string; name?: string; id?: string };

export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Part[]).filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("");
}

/** `mcp__jagentchill__jc_echo` and `jagentchill__jc_echo` are both shown as `jc_echo`. */
export function toolLabel(name: string): string {
  return name.replace(/^(mcp__)?jagentchill__/, "");
}

export function rowsFromHistory(messages: unknown[]): Row[] {
  const rows: Row[] = [];
  messages.forEach((raw, index) => {
    const message = raw as { role?: string; content?: unknown };
    if (message.role !== "user" && message.role !== "assistant") return;
    if (Array.isArray(message.content)) {
      for (const part of message.content as Part[]) {
        if (part.type === "toolcall" && part.name) rows.push({ kind: "tool", id: part.id ?? `h${index}-${rows.length}`, name: part.name, status: "completed" });
      }
    }
    const text = textOf(message.content);
    if (text) rows.push({ kind: message.role, id: `h${index}`, text });
  });
  return rows;
}

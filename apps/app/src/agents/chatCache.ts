import type { ChatItem } from "@jagentchill/app-core";
import { preferenceStore } from "../platform/store";

/**
 * What this device keeps of the sessions it has shown: the newest rows of each, so that a session opened again is on
 * screen at once and is then brought up to date from the host. Kept in the device's preference store (on the web the
 * origin's localStorage), bounded: the newest rows of a session up to a size, the last few sessions only. Pictures
 * carried inside a message are not kept (they come back with the transcript); nothing here is sent anywhere.
 */
const PREFIX = "jagentchill.chat-cache.v1.", INDEX = `${PREFIX}index`;
const MAX_ROWS = 40, MAX_CHARS = 120_000, MAX_SESSIONS = 12;
const memory = new Map<string, ChatItem[]>();

const keep = (item: ChatItem): ChatItem | null => {
  // A row that is still being written, a card (the pane places those itself) and an inline picture are not kept.
  if (item.kind === "card" || (item.kind === "media" && item.uri.startsWith("data:"))) return null;
  if (item.kind === "assistant") { const { streaming: _streaming, fresh: _fresh, cut: _cut, ...rest } = item; return rest; }
  if (item.kind === "tool") { const { images: _images, ...rest } = item; return { ...rest, status: rest.status === "running" ? "cancelled" : rest.status, input: rest.input?.slice(0, 2000), output: rest.output?.slice(0, 2000) }; }
  return item;
};
const index = (): string[] => { try { const list = JSON.parse(preferenceStore.get(INDEX) ?? "[]") as unknown; return Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === "string") : []; } catch { return []; } };

export function readChatCache(key: string): ChatItem[] | null {
  const held = memory.get(key);
  if (held) return held;
  try {
    const stored = JSON.parse(preferenceStore.get(PREFIX + key) ?? "null") as { items?: unknown } | null;
    if (!stored || !Array.isArray(stored.items) || !stored.items.length) return null;
    const items = stored.items as ChatItem[];
    memory.set(key, items);
    return items;
  } catch { return null; }
}

export function writeChatCache(key: string, all: readonly ChatItem[]): void {
  const rows: ChatItem[] = [];
  let chars = 0;
  for (let at = all.length - 1; at >= 0 && rows.length < MAX_ROWS; at--) {
    const row = keep(all[at]!);
    if (!row) continue;
    const size = JSON.stringify(row).length;
    if (chars + size > MAX_CHARS) break;
    chars += size; rows.unshift(row);
  }
  if (!rows.length) return;
  memory.set(key, rows);
  try {
    preferenceStore.set(PREFIX + key, JSON.stringify({ saved_ms: Date.now(), items: rows }));
    const order = [key, ...index().filter((entry) => entry !== key)];
    for (const dropped of order.slice(MAX_SESSIONS)) { preferenceStore.remove?.(PREFIX + dropped); memory.delete(dropped); }
    preferenceStore.set(INDEX, JSON.stringify(order.slice(0, MAX_SESSIONS)));
  } catch { /* a full store keeps what it had; the session is read from the host as before */ }
}

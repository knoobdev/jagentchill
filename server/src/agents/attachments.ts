import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { BlobStore } from "../sync/blobs.ts";
import type { Connection, RpcMethod } from "../channel/ws-channel.ts";
import { ProtocolError } from "../errors.ts";
import { smallJpeg } from "../generation/picture.ts";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_SESSION_BYTES = 100 * 1024 * 1024;
const allowed = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/webm", "video/quicktime",
  "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/aac",
  "application/pdf", "text/plain", "text/markdown", "text/csv", "application/json",
]);
const sessionKey = z.string().min(1).max(200);
const createParams = z.object({ sessionKey, blobId: z.string().regex(/^[0-9a-f]{64}$/), name: z.string().min(1).max(240), mime: z.string().min(1).max(120), size: z.number().int().min(0).max(64 * 1024 * 1024 * 1024) }).strict();
const listParams = z.object({ sessionKey }).strict();
const sendParams = z.object({ sessionKey, message: z.string(), attachmentIds: z.array(z.string().uuid()).max(10).optional() }).passthrough();
const cleanName = (name: string) => name.replace(/[\\/\0-\x1f\x7f]/g, "_").replace(/^\.+/, "_").slice(0, 240) || "attachment";

type SessionAccess = { canRead(sessionKey: string, connection: Connection): boolean; canAct(sessionKey: string, connection: Connection): boolean };
export function createSessionAttachments(deps: { db: DatabaseSync; blobs: BlobStore; dataDir: string; now(): number; access: SessionAccess; projectMedia(sessionKey: string): Array<{ blobId: string; name: string; mime: string; size: number }>; supportsImage(sessionKey: string): boolean }) {
  const { db, blobs } = deps;
  const methods = new Map<string, RpcMethod>();
  methods.set("jagentchill.chat.attachment.create", { scope: "jagentchill.agent.use", handle(raw, connection) {
    const params = createParams.parse(raw ?? {});
    if (!deps.access.canAct(params.sessionKey, connection)) throw new ProtocolError("NOT_FOUND", "No such session.");
    if (!allowed.has(params.mime)) throw new ProtocolError("INVALID_PARAMS", "This file type is not accepted. Attach an image, video, audio file, PDF or text file.");
    if (params.size > MAX_FILE_BYTES) throw new ProtocolError("BLOB_TOO_LARGE", `This file is too large (limit ${MAX_FILE_BYTES / 1024 / 1024} MB).`);
    const info = blobs.get(params.blobId), blob = db.prepare("SELECT state, purpose, mime, size FROM blobs WHERE sha256 = ?").get(params.blobId) as { state: string; purpose: string; mime: string; size: number } | undefined;
    if (!blob || blob.state !== "complete" || blob.purpose !== "media") throw new ProtocolError("NOT_FOUND", "The uploaded file is not available.");
    // SHA-256 identifies the exact bytes. A picker can hand us the same complete blob under a different accepted MIME
    // label (for example after image conversion); the host's verified blob record is authoritative for its facts.
    if (info.size !== blob.size || !allowed.has(blob.mime)) throw new ProtocolError("INVALID_PARAMS", "The uploaded file details do not match the host's blob record.");
    if (blob.size > MAX_FILE_BYTES) throw new ProtocolError("BLOB_TOO_LARGE", `This file is too large (limit ${MAX_FILE_BYTES / 1024 / 1024} MB).`);
    const current = db.prepare("SELECT COALESCE(SUM(size),0) AS total FROM session_attachments WHERE session_key = ?").get(params.sessionKey) as { total: number };
    if (current.total + blob.size > MAX_SESSION_BYTES) throw new ProtocolError("BLOB_TOO_LARGE", `Attachments in this session exceed the ${MAX_SESSION_BYTES / 1024 / 1024} MB limit.`);
    const attachmentId = randomUUID(), name = cleanName(params.name), created_ms = deps.now();
    db.prepare("INSERT INTO session_attachments (attachment_id, session_key, blob_id, name, mime, size, who, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(attachmentId, params.sessionKey, params.blobId, name, blob.mime, blob.size, connection.deviceId, created_ms);
    return { attachment: { attachmentId, blobId: params.blobId, name, mime: blob.mime, size: blob.size, who: connection.deviceId, created_ms } };
  } });
  methods.set("jagentchill.chat.attachment.list", { scope: "jagentchill.projects.read", handle(raw, connection) {
    const params = listParams.parse(raw ?? {});
    if (!deps.access.canRead(params.sessionKey, connection)) throw new ProtocolError("NOT_FOUND", "No such session.");
    const attachments = db.prepare("SELECT attachment_id AS attachmentId, blob_id AS blobId, name, mime, size, who, created_ms FROM session_attachments WHERE session_key = ? ORDER BY created_ms").all(params.sessionKey);
    return { attachments };
  } });
  methods.set("jagentchill.chat.attachment.media", { scope: "jagentchill.projects.read", handle(raw, connection) {
    const params = listParams.parse(raw ?? {});
    if (!deps.access.canRead(params.sessionKey, connection)) throw new ProtocolError("NOT_FOUND", "No such session.");
    return { media: deps.projectMedia(params.sessionKey) };
  } });

  function install(target: Map<string, RpcMethod>): void {
    for (const [name, method] of methods) target.set(name, method);
    const send = target.get("jagentchill.chat.send");
    if (send) target.set("jagentchill.chat.send", { ...send, async handle(raw, connection) {
      const parsed = sendParams.parse(raw ?? {}), ids = parsed.attachmentIds ?? [];
      if (!ids.length) return send.handle(raw, connection);
      if (!deps.access.canAct(parsed.sessionKey, connection)) throw new ProtocolError("NOT_FOUND", "No such session.");
      const requested = ids.map((id) => db.prepare("SELECT attachment_id, blob_id, name, mime, size FROM session_attachments WHERE attachment_id = ? AND session_key = ?").get(id, parsed.sessionKey) as { attachment_id: string; blob_id: string; name: string; mime: string; size: number } | undefined);
      if (requested.some((entry) => !entry)) throw new ProtocolError("NOT_FOUND", "One or more attached files are no longer available.");
      const attachments = requested as NonNullable<(typeof requested)[number]>[];
      const total = attachments.reduce((sum, entry) => sum + entry.size, 0);
      if (total > MAX_SESSION_BYTES) throw new ProtocolError("BLOB_TOO_LARGE", "Attachments in this message exceed the session attachment limit.");
      const marker = randomUUID(), sessionDir = join(deps.dataDir, "session-attachments", Buffer.from(parsed.sessionKey).toString("hex"));
      await mkdir(sessionDir, { recursive: true, mode: 0o700 });
      const inline: Array<{ type: "image"; mimeType: "image/jpeg" | "image/png" | "image/webp"; fileName: string; content: string }> = [];
      const refs: Array<{ attachmentId: string; blobId: string; name: string; mime: string; size: number; path: string }> = [];
      for (const entry of attachments) {
        const bytes = blobs.read(entry.blob_id), path = join(sessionDir, `${entry.attachment_id}-${cleanName(entry.name)}`);
        await writeFile(path, bytes, { mode: 0o600 });
        refs.push({ attachmentId: entry.attachment_id, blobId: entry.blob_id, name: entry.name, mime: entry.mime, size: entry.size, path });
        if (deps.supportsImage(parsed.sessionKey) && inline.length < 4 && ["image/jpeg", "image/png", "image/webp"].includes(entry.mime)) {
          const picture = entry.size > 1_500_000 ? await smallJpeg(bytes) : bytes;
          if (picture && picture.length <= 1_500_000) inline.push({ type: "image", mimeType: picture === bytes ? entry.mime as "image/jpeg" | "image/png" | "image/webp" : "image/jpeg", fileName: entry.name, content: picture.toString("base64") });
        }
      }
      const lines = refs.map((entry) => `[Attached file: ${entry.name} | ${entry.mime} | blob:${entry.blobId}]\n[Runtime file: ${entry.path}]`).join("\n");
      const message = `${parsed.message}${parsed.message ? "\n\n" : ""}${lines}\n[[jc-attachments:${marker}]]`;
      const forwarded: Record<string, unknown> = { ...(raw as Record<string, unknown>), message, titleText: parsed.message, ...(inline.length ? { attachments: inline } : {}) };
      delete forwarded.attachmentIds;
      const answer = await send.handle(forwarded, connection);
      if ((answer as { delivered?: boolean })?.delivered !== false) db.prepare("INSERT INTO session_attachment_messages (marker, session_key, attachment_ids, created_ms) VALUES (?, ?, ?, ?)").run(marker, parsed.sessionKey, JSON.stringify(ids), deps.now());
      return answer;
    } });
    const history = target.get("jagentchill.chat.history");
    if (history) target.set("jagentchill.chat.history", { ...history, async handle(raw, connection) {
      const result = await history.handle(raw, connection) as { messages?: Array<Record<string, unknown>>; [key: string]: unknown };
      if (!result.messages?.length) return result;
      return { ...result, messages: result.messages.map((message) => {
        if (message.role !== "user") return message;
        const content = typeof message.content === "string" ? message.content : Array.isArray(message.content) ? (message.content as Array<{ text?: string }>).map((part) => part.text ?? "").join("") : "";
        const marker = /\[\[jc-attachments:([0-9a-f-]{36})\]\]/.exec(content)?.[1];
        if (!marker) return message;
        const found = db.prepare("SELECT attachment_ids FROM session_attachment_messages WHERE marker = ? AND session_key = ?").get(marker, (raw as { sessionKey: string }).sessionKey) as { attachment_ids: string } | undefined;
        if (!found) return message;
        const attachments = (JSON.parse(found.attachment_ids) as string[]).map((id) => db.prepare("SELECT attachment_id AS attachmentId, blob_id AS blobId, name, mime, size, who, created_ms FROM session_attachments WHERE attachment_id = ?").get(id)).filter(Boolean);
        const cleanText = (text: string) => text.replace(/\n?\[\[jc-attachments:[0-9a-f-]{36}\]\]/, "").replace(/\n\[Runtime file: [^\]]+\]/g, "").replace(/\n\[Attached file: [^\]]+\]/g, "").trimEnd();
        const cleanedContent = typeof message.content === "string" ? cleanText(message.content) : Array.isArray(message.content) ? (message.content as Array<Record<string, unknown>>).map((part) => part.type === "text" && typeof part.text === "string" ? { ...part, text: cleanText(part.text) } : part) : message.content;
        return { ...message, content: cleanedContent, jagentchill: { ...((message.jagentchill as object | undefined) ?? {}), attachments } };
      }) };
    } });
  }
  return { methods, install };
}

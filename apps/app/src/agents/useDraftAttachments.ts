import { useState } from "react";
import { uploadBlob, sha256Hex } from "@jagentchill/client";
import type { Attachment } from "@jagentchill/ui";
import { useHost } from "../host";
import { loadSigner } from "../identity";
import { useT } from "../locale";
import { reasonOf } from "./errors";

const MAX_BYTES = 50 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime", "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/aac", "application/pdf", "text/plain", "text/markdown", "text/csv", "application/json"]);
type Pending = { key: string; file: File; status: Attachment["status"]; progress: number; error?: string; thumbnail?: string };

/** File draft for a new agent session. Files use the same signed blob and session registration path as ChatPane. */
export function useDraftAttachments() {
  const t = useT();
  const { host, connection } = useHost();
  const [files, setFiles] = useState<Pending[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  function addFiles(incoming: FileList | File[]) {
    const next: Pending[] = [];
    for (const file of Array.from(incoming)) {
      if (!TYPES.has(file.type)) { setNotice(t("{name} has a file type this chat does not accept. Accepted: images, video, audio, PDF and text files.", { name: file.name })); continue; }
      if (file.size > MAX_BYTES) { setNotice(t("{name} is too large. Attachments must be 50 MB or smaller.", { name: file.name })); continue; }
      if (files.length + next.length >= 10) { setNotice(t("This chat accepts up to 10 files per message.")); break; }
      next.push({ key: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, file, status: "ready", progress: 1, ...(file.type.startsWith("image/") ? { thumbnail: URL.createObjectURL(file) } : {}) });
    }
    if (next.length) setFiles((current) => [...current, ...next].slice(0, 10));
  }
  function pickFiles() {
    if (typeof document === "undefined") return;
    const picker = document.createElement("input"); picker.type = "file"; picker.accept = [...TYPES].join(","); picker.multiple = true;
    picker.setAttribute("data-testid", "chat-attachment-picker"); picker.onchange = () => { if (picker.files) addFiles(picker.files); picker.remove(); }; picker.click();
  }
  async function register(sessionKey: string): Promise<string[]> {
    if (files.length && (!host || !connection)) throw new Error(t("Connect to a host before attaching files."));
    const ids: string[] = [];
    for (const entry of files) {
      const file = entry.file, bytes = new Uint8Array(await file.arrayBuffer()), blobId = await sha256Hex(bytes);
      setFiles((current) => current.map((item) => item.key === entry.key ? { ...item, status: "uploading", progress: 0 } : item));
      try {
        await uploadBlob({ host: host!, signer: await loadSigner() }, { sha256: blobId, size: bytes.length, mime: file.type, name: file.name || t("Attachment"), purpose: "media", read: async (start, end) => bytes.subarray(start, end) }, {
          onProgress: ({ bytes: sent, total }) => setFiles((current) => current.map((item) => item.key === entry.key ? { ...item, progress: total ? Math.min(95, Math.round(sent / total * 95)) : 95 } : item)),
        });
        const result = await connection!.call<{ attachment: { attachmentId: string } }>("jagentchill.chat.attachment.create", { sessionKey, blobId, name: file.name || t("Attachment"), mime: file.type, size: file.size });
        ids.push(result.attachment.attachmentId);
        setFiles((current) => current.map((item) => item.key === entry.key ? { ...item, status: "ready", progress: 100 } : item));
      } catch (error) {
        setFiles((current) => current.map((item) => item.key === entry.key ? { ...item, status: "failed", error: reasonOf(error) } : item));
        throw error;
      }
    }
    return ids;
  }
  const attachments: Attachment[] = files.map((entry) => ({ name: entry.file.name || t("Attachment"), size: `${Math.ceil(entry.file.size / 1024)} KB`, status: entry.status, progress: entry.progress / 100, ...(entry.thumbnail ? { thumbnail: entry.thumbnail } : {}), ...(entry.error ? { error: entry.error } : {}) }));
  return { attachments, count: files.length, notice, dismissNotice: () => setNotice(null), addFiles, pickFiles, register,
    remove(index: number) { setFiles((current) => current.filter((_, at) => at !== index)); }, clear() { setFiles([]); setNotice(null); },
  };
}

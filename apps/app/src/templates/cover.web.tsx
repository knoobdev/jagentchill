import { createElement, useEffect, useState } from "react";
import { keptBytes } from "./kept";

type CoverProps = { id: string; cover: string; preview: string | null; width: number; height: number; radius: number; border: string; autoPlay?: boolean; onError(): void };

const stored = new Map<string, Promise<string | null>>();
/**
 * A static file of the app as an object URL out of Cache Storage (`keptBytes`), cache first: the first time it is fetched and kept;
 * from then on it is read from the cache and no request is made for it, so the gallery shows its covers and plays its
 * previews with the network off. The cache is named by the hash of the shipped files (`covers.gen.ts`), so a new
 * version of the app fetches its own. `null` when the browser has no Cache Storage or the file cannot be had.
 */
function storedUrl(path: string): Promise<string | null> {
  let pending = stored.get(path);
  if (pending) return pending;
  const type = path.endsWith(".mp4") ? "video/mp4" : "image/jpeg";
  pending = (async () => {
    const bytes = await keptBytes(path);
    return bytes ? URL.createObjectURL(new Blob([bytes], { type })) : null;
  })().catch(() => null);
  stored.set(path, pending);
  void pending.then((url) => { if (url === null) stored.delete(path); });
  return pending;
}
/** `undefined` while the kept copy is being read, then its URL or `null`. */
function useStored(path: string | null): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(path === null ? null : undefined);
  useEffect(() => {
    if (path === null) { setUrl(null); return; }
    let current = true;
    void storedUrl(path).then((value) => { if (current) setUrl(value); });
    return () => { current = false; };
  }, [path]);
  return url;
}

/**
 * The cover of a starter template: the frame rendered from the template filled with its demo media, a static file of
 * the app kept in Cache Storage and shown from there. While the pointer is over it (or always, in the preview dialog) its preview video
 * plays over the cover, muted and looping.
 */
export function BundledCover(props: CoverProps) {
  const [hover, setHover] = useState(false);
  const cover = useStored(props.cover), preview = useStored(props.preview);
  const fill = { width: "100%", height: "100%", objectFit: "cover", display: "block" } as const;
  // The kept copy is the only source while it can be had: the file's own address is asked for only when the browser
  // keeps nothing (no Cache Storage), and never while the copy is still being read.
  const coverSource = cover === undefined ? undefined : cover ?? props.cover, previewSource = preview === undefined ? undefined : preview ?? props.preview ?? undefined;
  return createElement("div", {
    "data-testid": "template-cover", "data-stored": String(typeof cover === "string" && (props.preview === null || typeof preview === "string")), onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
    style: { position: "relative", width: props.width, height: props.height, borderRadius: props.radius, overflow: "hidden", border: `1px solid ${props.border}`, boxSizing: "border-box" },
  },
    coverSource ? createElement("img", { src: coverSource, alt: "", draggable: false, onError: props.onError, style: fill }) : null,
    previewSource && (props.autoPlay || hover) ? createElement("video", { src: previewSource, muted: true, loop: true, autoPlay: true, playsInline: true, "data-testid": "template-preview-video", "data-file": props.preview, style: { ...fill, position: "absolute", top: 0, left: 0 } }) : null);
}

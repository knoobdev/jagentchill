import { useEffect } from "react";
import { parseStickerId, timeline } from "@jagentchill/editor-core";
import { useEditor, useEditorVersion } from "../context";

// The sticker files the engine was told about last, by runtime: the list is sent again only when it changes.
const sent = new WeakMap<object, string>();
/**
 * Tells the engine where the files of the project's imported stickers are: every `user:<sha256>` sticker of the
 * document whose file is a media asset of the project. Emoji are drawn from the bundled colour font and need none.
 */
export function useStickerSources(): void {
  const runtime = useEditor(), version = useEditorVersion();
  useEffect(() => {
    const document = runtime.controller.document, wanted = new Map<string, string>();
    for (const scene of document.scenes) for (const element of timeline.elementsOfScene(scene as never)) {
      const parsed = element.type === "sticker" && typeof element.stickerId === "string" ? parseStickerId(element.stickerId) : null;
      if (parsed?.provider !== "user") continue;
      const asset = document.media.assets.find((entry) => (entry as { contentHash?: string | null }).contentHash === parsed.value);
      if (asset) wanted.set(String(element.stickerId), asset.id);
    }
    const key = [...wanted].map(([id, assetId]) => `${id}=${assetId}`).join("|");
    if (sent.get(runtime) === key || (key === "" && !sent.has(runtime))) return;
    sent.set(runtime, key);
    void Promise.all([...wanted].map(async ([stickerId, assetId]) => { const url = await runtime.media.mediaUrl(assetId).catch(() => null); return url ? [{ key: stickerId, kind: "sticker", url, sha256: parseStickerId(stickerId)!.value }] : []; }))
      // A newer list may have been asked for meanwhile: only the latest one is handed over.
      .then((entries) => { if (sent.get(runtime) === key) runtime.setDerivedSources("stickers", entries.flat()); });
  }, [runtime, version]);
}

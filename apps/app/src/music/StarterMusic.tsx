import { useEffect, useRef } from "react";
import { template } from "@jagentchill/editor-core";
import { useToast } from "@jagentchill/ui";
import { useEditor } from "../editor/context";
import { useHost } from "../host";
import { useT } from "../locale";
import type { MediaSession } from "../media/session";
import { expectedStarterMusic, settleStarterMusic } from "./notes";
import { fetchMusic, trackProvenance } from "./remote";

/**
 * The music of a project made from a starter. The starter names a track of the remote catalogue; on a connected
 * device that ONE track is fetched (through the host), becomes a sound of the project and is put on the starter's
 * Music track. Without a connection the project keeps its empty Music track and says so once — and the track is
 * fetched the next time the project is open on a connected device. Draws nothing.
 */
export function StarterMusic(props: { projectId: string; media: MediaSession | null; readOnly: boolean }) {
  const t = useT(), toast = useToast(), runtime = useEditor(), { connection, host, status } = useHost();
  const told = useRef(false), busy = useRef(false);
  useEffect(() => {
    const templateId = expectedStarterMusic(props.projectId), media = props.media;
    if (!templateId || props.readOnly || !media || busy.current) return;
    const named = template.starterMusic(templateId);
    if (!named) { settleStarterMusic(props.projectId); return; }
    const empty = () => { if (!told.current) { told.current = true; toast.show({ kind: "info", message: t("This template's music comes from the online catalogue. It will be added when this device is connected; the Music track is empty for now.") }); } };
    if (status === "connecting") return;
    if (status !== "connected" || !connection || !host) { empty(); return; }
    busy.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const got = await fetchMusic({ connection, host }, named.id, named.query);
        if (cancelled) return;
        if (!got.ok) { empty(); return; }
        const result = await media.importFiles([{ file: got.file }], { provenance: trackProvenance(got.track) as never });
        const assetId = [...result.imported, ...result.reused][0]?.assetId, sceneId = runtime.controller.session.sceneId;
        if (!assetId) { empty(); return; }
        const input = { sceneId, assetId, title: got.track.title, trackId: template.STARTER_MUSIC_TRACK, elementId: template.STARTER_MUSIC_ELEMENT };
        // Placed only on a Music track that is still empty: a person who already put a sound there keeps it.
        const free = runtime.controller.stored.scenes.find((scene) => scene.id === sceneId)?.tracks.audio.find((track) => track.id === input.trackId)?.elements.length === 0;
        if (free) runtime.controller.external((doc, ctx) => { const commit = template.placeStarterMusic(doc, ctx, input); if (!commit) throw new Error("The Music track is taken."); return commit; });
        settleStarterMusic(props.projectId);
      } catch { empty(); } finally { busy.current = false; }
    })();
    return () => { cancelled = true; };
  }, [props.projectId, props.media, props.readOnly, status, connection, host]);
  return null;
}

import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import { tracksOf } from "@jagentchill/protocol";
import type { StoragePort } from "@jagentchill/storage";
import { Text, radius, useTheme } from "@jagentchill/ui";
import { objectUrl, releaseUrl } from "../editor/dom";
import { BundledCover } from "./cover";
import { thumbnailBytes, type TemplateEntry } from "./store";

type Json = Record<string, any>;
const SECOND = 120_000;
/** The moment a miniature shows: one second in, or the start of the first text when nothing is on screen then. */
function shownTime(entry: TemplateEntry): number {
  const elements = tracksOf(entry.snapshot.scenes[0]).flatMap((track) => track.elements as Json[]).filter((element) => element.type === "text" || element.type === "graphic");
  const at = Math.min(SECOND, Math.max(0, entry.manifest.duration - 1));
  if (elements.some((element) => element.startTime <= at && at < element.startTime + element.duration)) return at;
  return elements.length ? Math.min(...elements.map((element) => element.startTime)) : 0;
}

/**
 * What a template card shows. A personal template shows the frame saved with it; a starter shows its cover — the
 * render of the starter filled with its demo media — and plays its preview under the pointer (`play`: always). A
 * template without a stored picture is drawn from its own content: the canvas in its ratio and background with the
 * shapes and the texts that are on screen, in their colours and places.
 */
export function TemplateThumb(props: { entry: TemplateEntry; storage: StoragePort | null; width: number; maxHeight?: number; play?: boolean }) {
  const theme = useTheme();
  const { entry } = props, { canvas } = entry.manifest;
  const [url, setUrl] = useState<string | null>(null);
  const [coverFailed, setCoverFailed] = useState(false);
  const stored = !entry.bundled && entry.manifest.thumbnail !== null;
  useEffect(() => {
    if (!stored || !props.storage) return;
    let made: string | null = null, cancelled = false;
    void thumbnailBytes(props.storage, entry).then((bytes) => { if (cancelled || !bytes) return; made = objectUrl(bytes, "image/jpeg"); setUrl(made); }).catch(() => undefined);
    return () => { cancelled = true; if (made) releaseUrl(made); setUrl(null); };
  }, [props.storage, stored, entry.manifest.id, entry.manifest.created_ms]); // eslint-disable-line react-hooks/exhaustive-deps
  const scale = Math.min(props.width / canvas.width, (props.maxHeight ?? Infinity) / canvas.height), width = canvas.width * scale, height = canvas.height * scale;
  const frame = { width, height, borderRadius: radius.md, overflow: "hidden" as const, borderWidth: 1, borderColor: theme.color("border/hairline") };
  if (url) return <Image source={{ uri: url }} accessibilityLabel="" resizeMode="cover" style={frame} />;
  if (entry.bundled && entry.manifest.thumbnail && !coverFailed) {
    const at = `/templates/${entry.manifest.id}`;
    return <BundledCover id={entry.manifest.id} cover={`${at}/${entry.manifest.thumbnail}`} preview={entry.manifest.preview ? `${at}/${entry.manifest.preview}` : null} width={width} height={height} radius={radius.md} border={theme.color("border/hairline")} autoPlay={props.play} onError={() => setCoverFailed(true)} />;
  }
  const background = entry.snapshot.settings.background as Json, time = shownTime(entry);
  // Overlay tracks are listed top first: the lowest is drawn first.
  const shown = [...entry.snapshot.scenes[0].tracks.overlay].reverse().flatMap((track) => track.elements as Json[]).filter((element) => (element.type === "text" || element.type === "graphic") && element.startTime <= time && time < element.startTime + element.duration);
  return (
    <View testID="template-thumb" style={[frame, { backgroundColor: background?.kind === "color" ? background.color : theme.color("bg/subtle") }]}>
      {shown.map((element) => {
        const x = (0.5 + (element.transform?.position?.x ?? 0) / canvas.width) * width, y = (0.5 + (element.transform?.position?.y ?? 0) / canvas.height) * height;
        if (element.type === "graphic") {
          const w = 200 * (element.transform?.scale?.x ?? 1) * scale, h = 200 * (element.transform?.scale?.y ?? 1) * scale;
          return <View key={element.id} style={{ position: "absolute", left: x - w / 2, top: y - h / 2, width: w, height: h, backgroundColor: element.params?.fill, borderRadius: element.definitionId === "ellipse" ? Math.max(w, h) : 0 }} />;
        }
        const size = Math.max(4, ((element.fontSize ?? 15) / 100) * Math.min(canvas.width, canvas.height) * scale);
        return (
          <View key={element.id} style={{ position: "absolute", left: 0, width, top: y - size * 0.7, alignItems: "center" }}>
            <Text numberOfLines={2} style={[{ fontSize: size, lineHeight: size * 1.25, color: element.color, textAlign: "center", maxWidth: width * 0.9, fontWeight: (element.fontWeight ?? 400) >= 600 ? "700" : "400" }, { fontFamily: `"JC ${element.fontFamily}", system-ui` } as object]}>{String(element.content ?? "")}</Text>
          </View>
        );
      })}
    </View>
  );
}

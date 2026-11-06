import { View } from "react-native";
import { parseStickerId, STICKER_PROVIDERS, timeline } from "@jagentchill/editor-core";
import { Button, NumberField, Slider, Switch } from "@jagentchill/ui";
import { useT } from "../../locale";
import { EMOJI } from "../assets/emoji.gen";
import { useEditor } from "../context";
import { Note, Row, Section, writeFields } from "./parts";

type El = timeline.El;
/**
 * The Sticker section of a sticker element: Loop and Speed of an animated one, and — when its file or provider is not
 * on this device — the missing state with Remove. The stored id is kept as it is.
 */
export function StickerInspector(props: { element: El }) {
  const t = useT();
  const runtime = useEditor();
  const { element } = props, id = String(element.stickerId ?? ""), parsed = parseStickerId(id);
  const assets = runtime.controller.stored.media.assets as unknown as { name: string; type: string; contentHash?: string | null }[];
  const asset = parsed?.provider === "user" ? assets.find((entry) => entry.contentHash === parsed.value) : undefined;
  const known = parsed !== null && (STICKER_PROVIDERS as readonly string[]).includes(parsed.provider);
  const missing = !known || (parsed.provider === "emoji" ? !EMOJI.some((row) => row[0] === parsed.value) : parsed.provider === "user" ? !asset : parsed.provider !== "shapes");
  const animated = asset !== undefined && (/\.(gif|apng|webp)$/i.test(asset.name) || asset.type === "video");
  const speed = Number(element.playbackSpeed ?? 1);
  if (!missing && !animated) return null;
  return (
    <Section id="sticker" title={t("Sticker")} testID="sticker-inspector">
      {missing ? (
        <>
          <Note tone="warning" testID="sticker-missing">{t("Sticker not available on this device")}</Note>
          <View style={{ flexDirection: "row" }}><Button size="sm" kind="outline" tone="danger" label={t("Remove")} testID="sticker-remove" onPress={() => { runtime.act("timeline.delete"); }} /></View>
        </>
      ) : (
        <>
          <Row label={t("Loop")}><View testID="sticker-loop"><Switch accessibilityLabel={t("Loop")} value={element.loop !== false} onChange={(on) => { writeFields(runtime, [element.id], { loop: on }, "Sticker loop"); }} /></View></Row>
          <Row label={t("Speed")} testID="sticker-speed">
            <View style={{ flex: 1 }}><Slider label={t("Playback speed")} min={0.1} max={4} step={0.1} value={speed} defaultValue={1} onChange={(next) => writeFields(runtime, [element.id], { playbackSpeed: Math.round((next as number) * 10) / 10 }, "Sticker speed", true)} onCommit={(next) => { writeFields(runtime, [element.id], { playbackSpeed: Math.round((next as number) * 10) / 10 }, "Sticker speed"); }} /></View>
            <NumberField label={t("Playback speed")} hideLabel size="sm" width={64} unit="×" min={0.1} max={4} step={0.1} value={speed} onCommit={(next) => { writeFields(runtime, [element.id], { playbackSpeed: Math.round(next * 10) / 10 }, "Sticker speed"); }} />
          </Row>
        </>
      )}
    </Section>
  );
}

import { useEffect, useRef, useState } from "react";
import { Image, View } from "react-native";
import { timecode } from "@jagentchill/app-core";
import { setCover, sha256, snapToFrame, timeline, toHex } from "@jagentchill/editor-core";
import type { Rational } from "@jagentchill/protocol";
import { Button, Modal, Slider, Tabs, Text, radius, space, useTheme, useToast } from "@jagentchill/ui";
import { useT } from "../locale";
import { pickFiles } from "../platform/store";
import { useProjectActions } from "../projects/actions";
import { useDevice } from "../state";
import { useEditor } from "./context";
import { cropImage, objectUrl, releaseUrl, type CoverCrop, type EncodedImage } from "./dom";

const COVER_MAX_SIDE = 1920, PREVIEW_SIDE = 640;
/**
 * The project cover: a frame of the main scene picked by scrubbing, or a picture cropped to the canvas ratio. Saving
 * renders it at canvas resolution (long side at most 1920 px) into the cover store and records the change as one
 * undo step; Reset removes the cover so the automatic thumbnail is used again.
 */
export function CoverEditor(props: { onClose(): void }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const runtime = useEditor();
  const { storage } = useDevice();
  const actions = useProjectActions();
  const { controller } = runtime, doc = controller.stored, canvas = doc.settings.canvasSize, fps = doc.settings.fps as Rational, ratio = canvas.width / canvas.height;
  const main = (doc.scenes.find((scene) => scene.isMain) ?? doc.scenes[0]).id, duration = timeline.sceneDurationOf(timeline.sceneById(doc, main));
  const stored = doc.cover as { source?: "frame" | "image"; sceneId?: string; time?: number; crop?: Partial<CoverCrop> } | null;
  // A cover whose scene is gone opens on frame 0 of the main scene.
  const startTime = stored?.source === "frame" && stored.sceneId === main && typeof stored.time === "number" ? Math.min(stored.time, duration) : 0;
  const [source, setSource] = useState<"frame" | "image">(stored?.source === "image" ? "image" : "frame");
  const [time, setTime] = useState(startTime);
  const [picture, setPicture] = useState<Blob | null>(null);
  const [crop, setCrop] = useState<CoverCrop>({ x: stored?.crop?.x ?? 0.5, y: stored?.crop?.y ?? 0.5, zoom: stored?.crop?.zoom ?? 1 });
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const transparent = (doc.settings.background as { kind?: string }).kind === "transparent";
  const run = useRef(0);

  /** The cover as it would be saved, at a given long side. */
  const render = async (maxSide: number): Promise<EncodedImage | null> => {
    if (source === "image") return picture ? cropImage(picture, ratio, crop, maxSide, transparent) : null;
    const bytes = await runtime.engine?.still(time, transparent ? "png" : "jpeg", main);
    return bytes ? cropImage(new Blob([bytes as unknown as BlobPart]), ratio, { x: 0.5, y: 0.5, zoom: 1 }, maxSide, transparent) : null;
  };
  useEffect(() => {
    const mine = ++run.current;
    // A scrub asks for many frames: only the last one asked for is shown.
    const timer = setTimeout(() => void render(PREVIEW_SIDE).then((image) => { if (mine !== run.current) return; setPreview((before) => { if (before) releaseUrl(before); return image ? objectUrl(image.bytes, image.mime) : null; }); }), 60);
    return () => clearTimeout(timer);
  }, [source, time, picture, crop.x, crop.y, crop.zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { run.current++; setPreview((before) => { if (before) releaseUrl(before); return null; }); }, []);

  const pick = async () => { const [file] = await pickFiles("image/png,image/jpeg,image/webp", false); if (file) { setPicture(file); setCrop({ x: 0.5, y: 0.5, zoom: 1 }); } };
  const save = async () => {
    if (!storage) return;
    setBusy(true);
    try {
      const image = await render(COVER_MAX_SIDE);
      if (!image) { toast.show({ kind: "error", message: t("The cover could not be rendered") }); return; }
      const name = image.mime === "image/png" ? "cover.png" : "cover.jpg";
      await storage.putBlob("cover", doc.metadata.id, name, image.bytes);
      await storage.deleteBlob("cover", doc.metadata.id, image.mime === "image/png" ? "cover.jpg" : "cover.png").catch(() => undefined);
      const record = { sha256: toHex(sha256(image.bytes)), mime: image.mime, width: image.width, height: image.height };
      const saved = controller.external((before, ctx) => setCover(before, ctx, source === "frame" ? { source: "frame", sceneId: main, time, texts: [], image: record } : { source: "image", crop, texts: [], image: record }));
      if (saved) { actions.touchImages(); toast.show({ kind: "success", message: t("Cover updated") }); props.onClose(); }
    } finally { setBusy(false); }
  };
  const reset = async () => {
    if (!storage) return;
    controller.external((before, ctx) => setCover(before, ctx, null));
    for (const name of ["cover.jpg", "cover.png"]) await storage.deleteBlob("cover", doc.metadata.id, name).catch(() => undefined);
    actions.touchImages();
    props.onClose();
  };
  const frameStep = snapToFrame(1, fps) || 4000;
  return (
    <Modal title={t("Cover")} width={640} onClose={props.onClose}
      footer={<><Button size="sm" kind="ghost" label={t("Reset")} disabled={doc.cover === null || busy} testID="cover-reset" onPress={() => void reset()} /><View style={{ flex: 1 }} /><Button size="sm" label={t("Cancel")} onPress={props.onClose} /><Button size="sm" kind="primary" label={t("Save")} loading={busy} disabled={busy || (source === "image" && !picture) || (source === "frame" && duration <= 0)} testID="cover-save" onPress={() => void save()} /></>}>
      <View testID="cover-editor" style={{ gap: space[3] }}>
        <Tabs id="cover-source" label={t("Cover")} variant="pill" size="xs" items={[{ id: "frame", label: t("Frame") }, { id: "image", label: t("Image") }]} value={source} onChange={(id) => setSource(id as "frame" | "image")} />
        <View style={{ width: "100%", aspectRatio: ratio, maxHeight: 320, alignSelf: "center", borderRadius: radius.sm, overflow: "hidden", backgroundColor: theme.color("bg/canvas"), alignItems: "center", justifyContent: "center" }}>
          {preview ? <Image testID="cover-preview" source={{ uri: preview }} resizeMode="contain" style={{ width: "100%", height: "100%" }} accessibilityLabel={t("Cover preview")} /> : <Text variant="meta" color="text/secondary">{source === "image" ? t("Choose a picture for the cover") : duration <= 0 ? t("Add a clip to pick a frame") : t("Rendering…")}</Text>}
        </View>
        {source === "frame" ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <View style={{ flex: 1 }}><Slider label={t("Cover frame")} min={0} max={Math.max(frameStep, duration)} step={frameStep} value={time} disabled={duration <= 0} onChange={(value) => setTime(snapToFrame(value as number, fps))} onCommit={(value) => setTime(snapToFrame(value as number, fps))} /></View>
            <Text variant="mono" testID="cover-time">{timecode(time, fps)}</Text>
          </View>
        ) : (
          <View style={{ gap: space[2] }}>
            <View style={{ flexDirection: "row" }}><Button size="sm" kind="outline" icon="image" label={t(picture ? "Choose another picture…" : "Choose picture…")} testID="cover-pick" onPress={() => void pick()} /></View>
            {picture ? (["zoom", "x", "y"] as const).map((key) => (
              <View key={key} style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
                <Text variant="meta" color="text/secondary" style={{ width: 72 }}>{t(key === "zoom" ? "Zoom" : key === "x" ? "Horizontal" : "Vertical")}</Text>
                <View style={{ flex: 1 }}><Slider label={t(key === "zoom" ? "Zoom" : key === "x" ? "Horizontal" : "Vertical")} min={key === "zoom" ? 1 : 0} max={key === "zoom" ? 8 : 1} step={0.01} value={crop[key]} defaultValue={key === "zoom" ? 1 : 0.5} onChange={(value) => setCrop({ ...crop, [key]: value as number })} onCommit={(value) => setCrop({ ...crop, [key]: value as number })} /></View>
              </View>
            )) : null}
          </View>
        )}
      </View>
    </Modal>
  );
}

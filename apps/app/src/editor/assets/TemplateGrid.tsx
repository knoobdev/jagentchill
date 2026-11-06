import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { searchTextTemplates, TEXT_TEMPLATE_CATEGORIES, TEXT_TEMPLATES, timeline, type TextTemplate } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { Tap, Text, radius, space, useTheme } from "@jagentchill/ui";
import { useT } from "../../locale";
import { useEditor } from "../context";
import { coverPreview, nextPaint, previewSize, whenVisible } from "../fx/dom";
import { objectUrl, releaseUrl } from "../dom";
import type { EditorRuntime } from "../runtime";

const SECOND = 120_000, FRAMES = 8, FRAME_MS = 160, SLOT = 20 * SECOND, BATCH = 10;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// The frames of the template tiles, rendered by the engine from the templates themselves and kept for the session (per canvas shape).
const stills = new Map<string, string>();
type Job = { key: string; index: number; fraction: number; done: ((url: string | null) => void)[] };
const jobs: Job[] = [];
let running = false;

/** A scene of this project's shape that holds every template, each in a time slot of its own, in catalogue order. */
function catalogueDocument(runtime: EditorRuntime): { document: ProjectDocument; sceneId: string } {
  const { controller } = runtime, stored = controller.stored, sceneId = controller.session.sceneId;
  let document = { ...stored, scenes: stored.scenes.map((scene) => (scene.id === sceneId ? { ...scene, tracks: { overlay: [], main: { ...scene.tracks.main, elements: [], transitions: [] }, audio: [] } } : scene)) } as ProjectDocument;
  TEXT_TEMPLATES.forEach((template, index) => { document = timeline.executeCommand(document, controller.context(), controller.edit(), timeline.addTextTemplate({ sceneId, templateId: template.id, time: index * SLOT })).commit.document; });
  return { document, sceneId };
}
async function pump(runtime: EditorRuntime): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (jobs.length > 0) {
      const state = runtime.transport.engine, engine = runtime.engine;
      if (state === "no-gpu" || state === "unsupported" || state === "stopped") { for (const job of jobs.splice(0)) for (const done of job.done) done(null); return; }
      // Tiles wait for a running engine and never take frames from a playback.
      if (!engine || state !== "ready" || runtime.transport.playing) { await wait(250); continue; }
      const { controller } = runtime, edits = controller.version, canvas = controller.stored.settings.canvasSize;
      const width = 240, height = Math.max(2, Math.round((width * canvas.height) / canvas.width / 2) * 2), shown = previewSize();
      // The engine has one canvas: a picture of the frame it shows stays over the preview while the tiles are rendered into it.
      const frame = shown ? await engine.still(controller.session.playhead, "jpeg", controller.session.sceneId, shown).catch(() => null) : null;
      const cover = frame ? objectUrl(frame, "image/jpeg") : null, uncover = cover ? coverPreview(cover) : () => {};
      try {
        const built = catalogueDocument(runtime);
        await engine.withDocument(built.document, built.sceneId, async () => {
          for (const job of jobs.splice(0, BATCH)) {
            const template = TEXT_TEMPLATES[job.index], time = job.index * SLOT + Math.round(template.duration * SECOND * job.fraction);
            // The first frame of a text may be rendered before its glyphs are rastered at this size: the frame is asked for again once they are.
            await engine.still(time, "jpeg", built.sceneId, { width, height }).catch(() => null);
            const bytes = await engine.still(time, "jpeg", built.sceneId, { width, height }).catch(() => null);
            const url = bytes ? objectUrl(bytes, "image/jpeg") : null;
            if (url) stills.set(job.key, url);
            for (const done of job.done) done(url);
            // An edit or a playback made meanwhile is shown before more tiles are rendered.
            if (controller.version !== edits || runtime.transport.playing) break;
          }
        });
      } catch { for (const job of jobs.splice(0)) for (const done of job.done) done(null); }
      finally {
        await runtime.engine?.seek(controller.session.playhead, "exact").catch(() => undefined);
        await nextPaint();
        uncover();
        if (cover) releaseUrl(cover);
      }
      if (controller.version !== edits) await wait(400);
    }
  } finally { running = false; }
}
/** The frame of a template at a fraction of its length, as the engine draws the template on an empty scene of this project. */
function templateStill(runtime: EditorRuntime, template: TextTemplate, fraction: number): Promise<string | null> {
  const canvas = runtime.controller.stored.settings.canvasSize, key = `${template.id}:${canvas.width}x${canvas.height}:${fraction}`;
  const known = stills.get(key);
  if (known) return Promise.resolve(known);
  return new Promise((resolve) => {
    const queued = jobs.find((job) => job.key === key);
    if (queued) queued.done.push(resolve); else jobs.push({ key, index: TEXT_TEMPLATES.indexOf(template), fraction, done: [resolve] });
    void pump(runtime);
  });
}

function TemplateTile(props: { template: TextTemplate; disabled: boolean; onPress(): void }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const { template } = props;
  const [image, setImage] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const [visible, setVisible] = useState(false);
  const alive = useRef(true), node = useRef<View>(null);
  useEffect(() => { alive.current = true; const stop = whenVisible(node.current, () => setVisible(true)); return () => { alive.current = false; stop(); }; }, []);
  // At rest the tile shows the template in full, half-way through it; it asks for that picture when it comes into view.
  useEffect(() => { if (visible && !hovered) void templateStill(runtime, template, 0.5).then((url) => { if (alive.current && url) setImage(url); }); }, [runtime, template, visible, hovered]);
  // Under the pointer it plays: the frames of the template in order, again and again.
  useEffect(() => {
    if (!hovered) return;
    let frame = 0, stopped = false;
    const next = async () => {
      if (stopped) return;
      const url = await templateStill(runtime, template, (frame % FRAMES) / FRAMES);
      if (stopped || !alive.current) return;
      if (url) setImage(url);
      frame++;
      timer = setTimeout(() => void next(), FRAME_MS);
    };
    let timer = setTimeout(() => void next(), 0);
    return () => { stopped = true; clearTimeout(timer); };
  }, [hovered, runtime, template]);
  const canvas = runtime.controller.stored.settings.canvasSize;
  return (
    <Tap role="button" label={t(template.name)} disabled={props.disabled} testID={`text-template-${template.id}`} tooltip={{ label: t(template.name) }} onPress={props.onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={{ width: "31%", gap: space[1] }}>
      {(state) => (
        <>
          <View ref={node} style={[{ aspectRatio: Math.min(2, Math.max(0.75, canvas.width / canvas.height)), borderRadius: radius.sm, overflow: "hidden", backgroundColor: theme.color("qr/tile"), borderWidth: 1, borderColor: theme.color(state.hovered ? "border/strong" : "border/hairline") }, image ? ({ backgroundImage: `url("${image}")`, backgroundSize: "cover", backgroundPosition: "center" } as object) : null]} testID={image ? "text-template-image" : undefined} />
          <Text variant="meta" numberOfLines={1}>{t(template.name)}</Text>
        </>
      )}
    </Tap>
  );
}

/** The 30 bundled text templates under their categories; a tile is the engine's own picture of the template and plays under the pointer. */
export function TemplateGrid(props: { query: string; disabled: boolean; onPick(templateId: string): void }) {
  const t = useT();
  const found = searchTextTemplates(props.query);
  const groups = TEXT_TEMPLATE_CATEGORIES.map((category) => ({ category, templates: found.filter((template) => template.category === category) })).filter((entry) => entry.templates.length > 0);
  if (groups.length === 0) return null;
  return (
    <View testID="text-templates" style={{ gap: space[2] }}>
      <Text variant="meta" color="text/secondary">{t("Text templates")}</Text>
      {groups.map((entry) => (
        <View key={entry.category} style={{ gap: space[1] }}>
          <Text variant="caption" color="text/secondary">{t(entry.category)}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: "3.5%", rowGap: space[2] }}>
            {entry.templates.map((template) => <TemplateTile key={template.id} template={template} disabled={props.disabled} onPress={() => props.onPick(template.id)} />)}
          </View>
        </View>
      ))}
    </View>
  );
}

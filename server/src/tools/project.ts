import { randomUUID } from "node:crypto";
import { z } from "zod";
import { renameProject, setCanvasSize, setFrameRate, setProjectBackground, setPublishCaption, timeline } from "@jagentchill/editor-core";
import { CANVAS_PRESETS, createProjectDocument, MAX_TICKS, TOOL_LIST_DEFAULT_LIMIT, type ProjectDocument } from "@jagentchill/protocol";
import { PAGE, PROJECT, SCENE, WRITE, checkRange, clip, color, defineTool, fail, id, outOfRange, readTool, ticks, writeTool, type Sc, type ToolContext } from "./kit.ts";

const FPS = [[24000, 1001], [24, 1], [25, 1], [30000, 1001], [30, 1], [50, 1], [60000, 1001], [60, 1]] as const;
const fps = () => z.object({ numerator: z.number().int().min(1).max(240_000), denominator: z.number().int().min(1).max(1001) }).strict();
const canvas = () => z.object({ width: z.number().int(), height: z.number().int() }).strict();
/** The canvas background union of the project document: here the project default, on a clip its own background. */
export const background = () => z.union([
  z.object({ kind: z.literal("color"), color: color() }).strict(),
  z.object({ kind: z.literal("gradient"), css: z.string().min(1).max(4000) }).strict(),
  z.object({ kind: z.literal("blur"), blurIntensity: z.number().int() }).strict(),
  z.object({ kind: z.literal("image"), mediaId: id(), fit: z.enum(["cover", "contain", "stretch"]).optional() }).strict(),
  z.object({ kind: z.literal("transparent") }).strict(),
]);
export function checkBackground(ctx: ToolContext, value: { kind: string; blurIntensity?: number; mediaId?: string }, field = "background"): void {
  if (value.kind === "blur") checkRange(`${field}.blurIntensity`, value.blurIntensity, 0, 1000);
  if (value.kind === "image" && !ctx.doc.media.assets.some((asset) => asset.id === value.mediaId && asset.type === "image")) fail("ASSET_NOT_FOUND", `${field}.mediaId must name an image asset of this project. List the library with jc_media_list {kind: "image"}.`, { assetId: value.mediaId });
}
function checkCanvas(size: { width: number; height: number }): void {
  for (const side of ["width", "height"] as const) {
    if (size[side] < 16 || size[side] > 7680) outOfRange(`canvas.${side}`, 16, 7680, size[side]);
    if (size[side] % 2 !== 0) fail("INVALID_PARAMS", `canvas.${side} must be an even number of pixels; got ${size[side]}.`, { field: `canvas.${side}` });
  }
  if (size.width * size.height > 33_177_600) outOfRange("canvas", 256, 33_177_600, size.width * size.height, "width × height in pixels");
}
function checkFps(value: { numerator: number; denominator: number }): void {
  if (!FPS.some(([numerator, denominator]) => numerator === value.numerator && denominator === value.denominator)) {
    fail("INVALID_PARAMS", "fps must be one of 23.976, 24, 25, 29.97, 30, 50, 59.94 or 60, written as numerator/denominator (29.97 is 30000/1001).", { field: "fps", allowed: FPS.map(([numerator, denominator]) => ({ numerator, denominator })) });
  }
}
const sceneRow = (ctx: ToolContext, scene: Sc) => ({
  id: scene.id, name: scene.name, kind: scene.kind ?? "timeline", isMain: scene.isMain, duration: timeline.sceneDurationOf(scene), elementCount: timeline.elementsOfScene(scene).length,
  isActive: scene.id === ctx.activeSceneId(), ...(scene.inPoint !== undefined ? { inPoint: scene.inPoint } : {}), ...(scene.outPoint !== undefined ? { outPoint: scene.outPoint } : {}),
  ...(scene.kind === "multicam" && scene.multicam ? { angles: (scene.multicam.angles as { id: string; name: string }[]).map((angle) => ({ id: angle.id, name: angle.name })) } : {}),
});
const summaryOf = (doc: ProjectDocument) => ({
  id: doc.metadata.id, name: doc.metadata.name, duration: doc.metadata.duration, canvas: doc.settings.canvasSize, fps: doc.settings.fps,
  thumbnailAssetId: doc.cover?.mediaId ?? null, templateLocked: doc.template?.locked === true,
});

export const PROJECT_TOOLS = [
  defineTool({
    name: "jc_project_list", family: "project", readOnly: true, needsProject: false, readsAmbientState: true, kind: "read",
    description: "List the video projects that are synced to this host, newest first, with id, name, duration, canvas and frame rate. Projects that exist only on a device are not listed.",
    shape: { query: z.string().max(200).optional(), ...PAGE },
    handle(ctx, args) {
      const offset = args.cursor === undefined ? 0 : Number(args.cursor);
      if (!Number.isInteger(offset) || offset < 0) fail("INVALID_PARAMS", "cursor is not a cursor this tool returned.", { field: "cursor" });
      const listed = ctx.host.listProjects({ search: args.query, cursor: offset, limit: args.limit ?? TOOL_LIST_DEFAULT_LIMIT });
      return {
        data: {
          projects: listed.items.map((item) => { const found = ctx.host.projectDocument(item.id); return { ...(found ? summaryOf(found.doc) : { id: item.id, name: item.name, duration: item.duration }), updated_ms: item.updated_ms, revision: item.head, bound: item.id === ctx.session.projectId }; }),
          ...(listed.nextCursor !== null ? { nextCursor: String(listed.nextCursor) } : {}),
        },
      };
    },
  }),
  readTool({
    name: "jc_project_get", family: "project",
    description: "Read a project's settings: name, canvas, frame rate, background, scenes with their track and element counts, media count, the synced revision and who holds the edit lease. Defaults to the session's project.",
    shape: { ...PROJECT },
    handle(ctx) {
      const doc = ctx.doc;
      return {
        ...summaryOf(doc), background: doc.settings.background, useProxies: doc.settings.useProxies, publish: (doc as { publish?: unknown }).publish ?? null,
        scenes: (doc.scenes as unknown as Sc[]).map((scene) => ({ ...sceneRow(ctx, scene), tracks: { overlay: scene.tracks.overlay.length, main: 1, audio: scene.tracks.audio.length } })),
        mediaCount: doc.media.assets.filter((asset) => asset.kind !== "derived" && !asset.ephemeral).length, leaseHolder: ctx.host.leaseHolder(ctx.projectId),
        ...(doc.template ? { template: { locked: doc.template.locked, slots: doc.template.slots.length, editableTexts: doc.template.editableTexts.length } } : {}),
      };
    },
  }),
  defineTool({
    name: "jc_project_create", family: "project", readOnly: false, needsProject: false, kind: "direct",
    description: "Create a new, empty video project on this host and (by default) make it the session's project. Give the canvas as width and height or as an aspect preset such as \"9:16\". Created at once, not through a proposal.",
    shape: {
      name: z.string().trim().min(1).max(120), canvas: canvas().optional(), aspectPreset: z.enum(CANVAS_PRESETS.map((preset) => preset.ratio) as [string, ...string[]]).optional(),
      fps: fps(), background: background().optional(), bindToSession: z.boolean().optional(), idempotencyKey: WRITE.idempotencyKey, dryRun: WRITE.dryRun,
    },
    refine(args) {
      if ((args.canvas === undefined) === (args.aspectPreset === undefined)) fail("INVALID_PARAMS", "Give either canvas {width, height} or aspectPreset, not both and not neither.", { field: "canvas" });
      if (args.canvas) checkCanvas(args.canvas);
      checkFps(args.fps);
      if (args.background?.kind === "blur") checkRange("background.blurIntensity", args.background.blurIntensity, 0, 1000);
      if (args.background?.kind === "image") fail("INVALID_PARAMS", "A new project has no media yet, so its background cannot be an image. Create the project, import the image, then set the background with jc_project_update.", { field: "background" });
    },
    handle(ctx, args) {
      const preset = CANVAS_PRESETS.find((entry) => entry.ratio === args.aspectPreset), size = args.canvas ?? { width: preset!.width, height: preset!.height };
      const doc = createProjectDocument({ id: randomUUID(), mainSceneId: randomUUID(), mainTrackId: randomUUID(), now_ms: ctx.now, name: args.name, canvasSize: size, fps: args.fps, ...(args.background ? { background: args.background as never } : {}) });
      const bind = args.bindToSession !== false;
      if (args.dryRun) return { data: { projectId: doc.metadata.id, provisional: true, name: args.name, canvas: size, fps: args.fps, boundToSession: bind } };
      const created = ctx.host.createProject(ctx.session, doc, bind);
      return { data: { projectId: created.projectId, name: args.name, canvas: size, fps: args.fps, boundToSession: bind }, revision: created.revision, summary: `Created the project "${clip(args.name, 80)}" (${size.width} × ${size.height}).` };
    },
  }),
  defineTool({
    name: "jc_project_duplicate", family: "project", readOnly: false, needsProject: true, kind: "direct",
    description: "Copy the session's project, as it is synced now, into a new project on this host and return the new project id. The session stays on the original project.",
    shape: { name: z.string().trim().min(1).max(120).optional(), idempotencyKey: WRITE.idempotencyKey, dryRun: WRITE.dryRun },
    handle(ctx, args) {
      const name = args.name ?? `${ctx.doc.metadata.name} copy`.slice(0, 120), projectId = randomUUID();
      const { local: _local, ...canonical } = ctx.committed as ProjectDocument & { local?: unknown };
      const copy = { ...structuredClone(canonical), metadata: { ...canonical.metadata, id: projectId, name, created_ms: ctx.now, updated_ms: ctx.now } } as ProjectDocument;
      if (args.dryRun) return { data: { projectId, provisional: true, name } };
      const created = ctx.host.createProject(ctx.session, copy, false);
      return { data: { projectId: created.projectId, name, sourceProjectId: ctx.projectId }, summary: `Copied the project to "${clip(name, 80)}".` };
    },
  }),
  writeTool({
    name: "jc_project_update", family: "project",
    description: "Change project settings: name, canvas size, frame rate, the project default background, proxy use and the publish caption. Staged in the session's proposal. A clip's own background is set with jc_clip_transform.",
    shape: {
      name: z.string().trim().min(1).max(120).optional(), canvas: canvas().optional(), fps: fps().optional(), background: background().optional(), useProxies: z.boolean().optional(),
      publish: z.object({ title: z.string().max(200).optional(), description: z.string().max(5000).optional() }).strict().optional(), ...WRITE,
    },
    refine(args) {
      if (args.canvas) checkCanvas(args.canvas);
      if (args.fps) checkFps(args.fps);
      if (Object.keys(args).every((key) => ["idempotencyKey", "dryRun", "editContext"].includes(key))) fail("INVALID_PARAMS", "Name at least one setting to change.");
    },
    handle(ctx, args) {
      const changed: string[] = [];
      if (args.name !== undefined) { ctx.apply((doc, c) => renameProject(doc, c, args.name!)); changed.push("name"); }
      if (args.canvas) { const preset = CANVAS_PRESETS.some((entry) => entry.width === args.canvas!.width && entry.height === args.canvas!.height); ctx.apply((doc, c) => setCanvasSize(doc, c, args.canvas!, preset ? "preset" : "custom")); changed.push("canvas"); }
      if (args.fps) { ctx.apply((doc, c) => setFrameRate(doc, c, args.fps!)); changed.push("frame rate"); }
      if (args.background) { checkBackground(ctx, args.background); const value = args.background.kind === "image" ? { fit: "cover", ...args.background } : args.background; ctx.apply((doc, c) => setProjectBackground(doc, c, value as never)); changed.push("background"); }
      if (args.useProxies !== undefined) { ctx.run(timeline.setUseProxies({ value: args.useProxies })); changed.push("proxies"); }
      if (args.publish) { const now = ((ctx.doc as { publish?: { title?: string; description?: string } }).publish ?? {}); ctx.apply((doc, c) => setPublishCaption(doc, c, { title: args.publish!.title ?? now.title ?? "", description: args.publish!.description ?? now.description ?? "" })); changed.push("publish caption"); }
      return { data: { changed, settings: { name: ctx.doc.metadata.name, canvas: ctx.doc.settings.canvasSize, fps: ctx.doc.settings.fps, background: ctx.doc.settings.background, useProxies: ctx.doc.settings.useProxies } }, summary: `Changed the project's ${changed.join(", ")}.`, change: { kind: "modify", entity: "project", entityId: ctx.projectId, label: ctx.doc.metadata.name } };
    },
  }),

  readTool({
    name: "jc_scene_list", family: "scene",
    description: "List the scenes of the project: id, name, kind (timeline, compound or multicam), duration, element count, which one this session's tools default to, and the in and out points when set.",
    shape: {},
    handle: (ctx) => ({ scenes: (ctx.doc.scenes as unknown as Sc[]).map((scene) => sceneRow(ctx, scene)) }),
  }),
  defineTool({
    name: "jc_scene_edit", family: "scene", readOnly: false, needsProject: true, kind: "staged", unstaged: (args) => args.action === "set_active",
    description: "Create, rename, duplicate, delete or reorder a scene, set or clear its in and out points (set_range; null clears), set a compound scene's background, or choose the scene this session's tools default to (set_active, which is not staged). The main scene cannot be deleted.",
    shape: {
      action: z.enum(["create", "rename", "duplicate", "delete", "reorder", "set_active", "set_range", "set_compound_background"]), ...SCENE, name: z.string().trim().min(1).max(80).optional(), index: z.number().int().min(0).max(199).optional(),
      inPoint: ticks().nullable().optional(), outPoint: ticks().nullable().optional(), compoundBackground: z.enum(["none", "own"]).optional(), ...WRITE,
    },
    refine(args) {
      const need = (field: "sceneId" | "name" | "index" | "compoundBackground") => { if (args[field] === undefined) fail("INVALID_PARAMS", `action "${args.action}" needs ${field}.`, { field }); };
      if (["rename", "duplicate", "delete", "reorder", "set_active"].includes(args.action)) need("sceneId");
      if (args.action === "rename") need("name");
      if (args.action === "reorder") need("index");
      if (args.action === "set_compound_background") need("compoundBackground");
      if (args.action === "set_range" && args.inPoint === undefined && args.outPoint === undefined) fail("INVALID_PARAMS", "set_range needs inPoint, outPoint or both; null clears a point.", { field: "inPoint" });
    },
    handle(ctx, args) {
      const scene = args.action === "create" ? undefined : ctx.scene(args.sceneId), label = scene?.name ?? args.name ?? "Scene";
      if (args.action === "set_active") {
        // The active scene is device-local state, not a document field: nothing is staged.
        const shown = ctx.host.setActiveScene(ctx.session, ctx.projectId, scene!.id);
        if (!shown) ctx.warnings.push("no_client");
        return { data: { sceneId: scene!.id, isActive: true, shownOnClient: shown } } as never;
      }
      const done = (kind: "add" | "modify" | "remove" | "move", sceneId: string, summary: string, data: Record<string, unknown> = {}) => ({ data: { sceneId, ...data }, summary, change: { kind, entity: "scene" as const, entityId: sceneId, label } });
      switch (args.action) {
        case "create": { const made = ctx.run(timeline.createScene({ name: args.name })); return done("add", made.sceneId, `Added the scene "${clip(args.name ?? "Scene", 80)}".`); }
        case "rename": ctx.run(timeline.renameScene({ sceneId: scene!.id, name: args.name! })); return done("modify", scene!.id, `Renamed the scene to "${clip(args.name!, 80)}".`);
        case "duplicate": { const made = ctx.run(timeline.duplicateScene({ sceneId: scene!.id })); return done("add", made.sceneId, `Duplicated the scene "${clip(scene!.name, 80)}".`, { sourceSceneId: scene!.id }); }
        case "reorder": ctx.run(timeline.reorderScene({ sceneId: scene!.id, toIndex: args.index! })); return done("move", scene!.id, `Moved the scene "${clip(scene!.name, 80)}" to position ${args.index! + 1}.`);
        case "delete": {
          if (scene!.isMain || ctx.doc.scenes.length <= 1) fail("INVALID_PARAMS", scene!.isMain ? "The main scene cannot be deleted." : "The last remaining scene cannot be deleted.", { field: "sceneId" });
          const referencedBy = (ctx.doc.scenes as unknown as Sc[]).flatMap((other) => timeline.elementsOfScene(other)).filter((element) => element.type === "compound" && element.sceneId === scene!.id).map((element) => element.id);
          if (referencedBy.length > 0) fail("UNSUPPORTED_FOR_ELEMENT", `The scene "${scene!.name}" is used by ${referencedBy.length} compound clip(s). Dissolve or delete those clips first (jc_clip_compound {action: "dissolve"} or jc_clip_delete).`, { referencedBy });
          ctx.run(timeline.deleteScenes({ sceneIds: [scene!.id] }));
          return done("remove", scene!.id, `Deleted the scene "${clip(scene!.name, 80)}".`);
        }
        case "set_range": {
          const inPoint = args.inPoint === undefined ? scene!.inPoint ?? null : args.inPoint, outPoint = args.outPoint === undefined ? scene!.outPoint ?? null : args.outPoint;
          if (inPoint !== null && outPoint !== null && outPoint <= inPoint) outOfRange("outPoint", inPoint + 1, MAX_TICKS, outPoint, "outPoint must be later than inPoint");
          ctx.run(timeline.setSceneRange({ sceneId: scene!.id, inPoint, outPoint }));
          const after = ctx.scene(scene!.id);
          return done("modify", scene!.id, `Set the in and out points of "${clip(scene!.name, 60)}".`, { inPoint: after.inPoint ?? null, outPoint: after.outPoint ?? null });
        }
        case "set_compound_background": ctx.run(timeline.setCompoundBackground({ sceneId: scene!.id, value: args.compoundBackground! })); return done("modify", scene!.id, `Set the compound background of "${clip(scene!.name, 60)}" to ${args.compoundBackground}.`);
        default: return fail("INVALID_PARAMS", `Unknown action "${args.action}".`);
      }
    },
  }),
  defineTool({
    name: "jc_project_trash", family: "project", readOnly: false, needsProject: true, kind: "direct",
    description: "Move the session's project to the host trash. The user is asked to allow it first: the first call answers APPROVAL_PENDING, and after the user allows it the same call (same parameters and idempotencyKey) carries it out. The project can be restored from the trash for 30 days with jc_project_restore.",
    shape: { ...PROJECT, idempotencyKey: WRITE.idempotencyKey, dryRun: WRITE.dryRun },
    handle(ctx) {
      const name = ctx.doc.metadata.name;
      ctx.permit({ toolLabel: "Move project to trash", detail: `Project "${name}" is moved to the host trash. It can be restored from there for 30 days.`, projectId: ctx.projectId });
      if (!ctx.dryRun) ctx.host.trashProject(ctx.session, ctx.projectId);
      return { data: { projectId: ctx.projectId, name, state: "trash", ...(ctx.dryRun ? { provisional: true } : {}) }, summary: `Moved the project "${clip(name, 80)}" to the trash.` };
    },
  }),
  defineTool({
    name: "jc_project_restore", family: "project", readOnly: false, needsProject: false, kind: "direct",
    description: "Restore a project from the host trash by its projectId. The user is asked to allow it first: the first call answers APPROVAL_PENDING, and after the user allows it the same call (same parameters and idempotencyKey) carries it out.",
    shape: { projectId: id(), idempotencyKey: WRITE.idempotencyKey, dryRun: WRITE.dryRun },
    handle(ctx, args) {
      const found = ctx.host.trashedProject(args.projectId) ?? fail("PROJECT_NOT_FOUND", `No project with the id "${args.projectId}" is in the host trash.`, { projectId: args.projectId });
      ctx.permit({ toolLabel: "Restore project from trash", detail: `Project "${found.name}" is restored from the host trash.`, projectId: args.projectId });
      const restored = ctx.dryRun ? undefined : ctx.host.restoreProject(ctx.session, args.projectId);
      return { data: { projectId: args.projectId, name: found.name, state: "active", ...(ctx.dryRun ? { provisional: true } : {}) }, ...(restored ? { revision: restored.revision } : {}), summary: `Restored the project "${clip(found.name, 80)}" from the trash.` };
    },
  }),
];

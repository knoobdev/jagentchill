import { z } from "zod";
import { defineTool, ToolFailure, type ToolContext } from "./kit.ts";

const nameSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

export const MOTION_SCENE_TOOLS = [defineTool({
  name: "jc_motion_scene", family: "media", readOnly: false, needsProject: true, kind: "direct",
  description: "Create or update a deterministic HTML/CSS/JS motion scene in the agent work folder, or render it to a transparent VP9 WebM and import it into this project's media library. Supply inline html when creating/updating; render can use the saved scene by name. Scene time is driven through window.__jcSeek(seconds); no network access is available. Uses the project canvas and frame rate, durationSeconds, up to 30 s and 1200 frames. Set placement to stage it at startSeconds and optional trackId.",
  shape: {
    action: z.enum(["create", "update", "render"]), name: nameSchema,
    html: z.string().min(1).max(256 * 1024).optional(), durationSeconds: z.number().finite().positive().max(30),
    placement: z.object({ startSeconds: z.number().finite().min(0).max(86_400), trackId: z.string().uuid().optional() }).strict().optional(),
    projectId: z.string().uuid().optional(), idempotencyKey: z.string().min(16).max(64).optional(), dryRun: z.boolean().optional(),
  },
  refine(args) {
    if (args.action !== "render" && args.html === undefined) throw new ToolFailure("INVALID_PARAMS", `action "${args.action}" needs html.`, { field: "html" });
  },
  async handle(ctx: ToolContext, args: { action: "create" | "update" | "render"; name: string; html?: string; durationSeconds: number; placement?: { startSeconds: number; trackId?: string } }) {
    const canvas = ctx.doc.settings.canvasSize;
    const fpsRate = ctx.doc.settings.fps as { numerator?: number; denominator?: number } | number;
    const fps = typeof fpsRate === "number" ? fpsRate : Number(fpsRate.numerator ?? 30) / Number(fpsRate.denominator ?? 1);
    if (ctx.dryRun) return { data: { action: args.action, name: args.name, provisional: true }, summary: `Would ${args.action === "render" ? "render" : `${args.action} `}the HTML motion scene "${args.name}".` };
    if (args.action !== "render") {
      const saved = await ctx.host.saveMotionScene({ session: ctx.session, name: args.name, html: args.html!, width: canvas.width, height: canvas.height, durationSeconds: args.durationSeconds, fps });
      return { data: { action: args.action, name: args.name, sourcePath: saved.sourcePath, sha256: saved.sha256 }, summary: `${args.action === "create" ? "Created" : "Updated"} motion scene "${args.name}" in the agent work folder.` };
    }
    const rendered = await ctx.host.renderMotionScene({ session: ctx.session, name: args.name, ...(args.html !== undefined ? { html: args.html } : {}), width: canvas.width, height: canvas.height, durationSeconds: args.durationSeconds, fps });
    const imported = await ctx.host.importMedia(ctx.session, ctx.projectId, { kind: "workspace", path: rendered.outputPath }, {
      name: `${args.name}.webm`, tags: ["motion-scene"], provenance: { source: "derived", scenePath: rendered.sourcePath, tool: "jc_motion_scene", frameCount: rendered.frameCount, fps: rendered.fps },
    }, () => undefined);
    const placed = args.placement ? await ctx.host.stageMotionClip({ session: ctx.session, projectId: ctx.projectId, assetId: String(imported.assetId), sceneId: ctx.activeSceneId(), start: Math.round(args.placement.startSeconds * 120_000), ...(args.placement.trackId ? { trackId: args.placement.trackId } : {}) }) : undefined;
    return {
      data: { action: "render", name: args.name, sourcePath: rendered.sourcePath, assetId: imported.assetId, kind: "video", width: rendered.width, height: rendered.height, durationSeconds: rendered.durationSeconds, fps: rendered.fps, frameCount: rendered.frameCount, bytes: rendered.bytes, revision: imported.revision, ...(placed ? { placement: { ...placed, startSeconds: args.placement!.startSeconds } } : {}) },
      revision: Number(imported.revision), ...(placed?.proposalId ? { proposalId: placed.proposalId } : {}), ...(placed?.changeIds ? { changeIds: placed.changeIds } : {}), summary: `Rendered "${args.name}" as a transparent ${rendered.frameCount}-frame WebM and imported it as ${String(imported.assetId)}${placed ? `; staged it at ${args.placement!.startSeconds} seconds` : ""}.`,
    };
  },
})];

// Test support for the agent tools. The agent runtimes are the FAKES of `harness.ts` and devices are simulated (a key and the
// wire protocol); the server app, its database, the sync service, the proposals and every tool are the real ones, and
// the project is a real document built with editor-core commands.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { addAsset, applyPatch, createIdSource, timeline, type CommitContext, type StatePatch } from "@jagentchill/editor-core";
import { createProjectDocument, type DocRef, type ProjectDocument, type ToolEnvelope } from "@jagentchill/protocol";
import { createHarness, type Harness } from "../harness.ts";
import { support, type Paired } from "./sync.ts";

export const S = 120_000;
/** The model the tool tests' sessions run on (the name is historical: it was the Built-in runtime's test provider). */
export const ACME = { runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" };
export const key = () => randomUUID();
type Sc = timeline.Sc;

/** A project with four assets and, unless `empty`, two clips on the main track (0–10 s and 10–30 s) and music under them. */
export function buildProject(options: { empty?: boolean; slides?: number; name?: string; canvas?: { width: number; height: number }; template?: boolean } = {}) {
  const ctx: CommitContext = { now_ms: 1_800_000_000_000, newId: createIdSource() };
  let doc: ProjectDocument = createProjectDocument({ id: randomUUID(), mainSceneId: randomUUID(), mainTrackId: randomUUID(), now_ms: ctx.now_ms, name: options.name ?? "Da Lat in 48 hours", canvasSize: options.canvas ?? { width: 1920, height: 1080 }, fps: { numerator: 30, denominator: 1 } });
  const asset = (fields: Record<string, unknown> & { name: string; type: "image" | "video" | "audio"; size: number }) => { const made = addAsset(doc, ctx, fields); doc = made.document; return made.assetId; };
  const assets = {
    drone: asset({ name: "drone_dalat_01.mp4", type: "video", size: 9_000_000, width: 1920, height: 1080, duration: 10 * S, fps: { numerator: 30, denominator: 1 }, hasAudio: true, videoCodec: "h264", tags: ["broll"] }),
    interview: asset({ name: "mai_interview.mp4", type: "video", size: 22_000_000, width: 1920, height: 1080, duration: 20 * S, fps: { numerator: 30, denominator: 1 }, hasAudio: true, videoCodec: "h264" }),
    silent: asset({ name: "timelapse.mp4", type: "video", size: 4_000_000, width: 1280, height: 720, duration: 6 * S, hasAudio: false }),
    photo: asset({ name: "pine_forest.jpg", type: "image", size: 800_000, width: 4000, height: 3000 }),
    music: asset({ name: "morning_theme.mp3", type: "audio", size: 3_000_000, duration: 60 * S, audioCodec: "mp3" }),
  };
  const sceneId = doc.scenes[0].id;
  const run = <I,>(command: timeline.TimelineCommand<I>): I => { const done = timeline.executeCommand(doc, ctx, timeline.HOST_EDIT_CONTEXT, command); doc = done.commit.document; return done.info as I; };
  const ids = { clipA: "", clipB: "", music: "", musicTrack: "" };
  // A long slideshow: `slides` one-second photos on the main track, added as one command.
  if (options.slides) run(timeline.addClips({ sceneId, clips: Array.from({ length: options.slides }, () => ({ assetId: assets.photo, duration: S, name: "Photo of the pine forest above the lake at dawn" })), time: 0, request: { strategy: "mainInsert" } }));
  if (!options.empty) {
    [ids.clipA, ids.clipB] = run(timeline.addClips({ sceneId, clips: [{ assetId: assets.drone }, { assetId: assets.interview }], time: 0, request: { strategy: "mainInsert" } })).elementIds;
    const music = run(timeline.addClips({ sceneId, clips: [{ assetId: assets.music, sourceOut: 30 * S }], time: 0, request: { strategy: "alwaysNew" } }));
    ids.music = music.elementIds[0]; ids.musicTrack = music.trackId;
  }
  if (options.template) doc.template = {
    templateId: "w22b-template", locked: true, sceneId,
    slots: [], editableTexts: [], audioSlots: [], themeColors: [], colorBindings: [],
    variables: [{ id: "clip-name", label: "Clip name", type: "text", defaultValue: "drone_dalat_01.mp4", value: "drone_dalat_01.mp4", bindings: [{ elementId: ids.clipA, field: "name" }] }],
  };
  return { doc, assets, sceneId, mainTrackId: doc.scenes[0].tracks.main.id, ...ids };
}

export type ToolWorld = Awaited<ReturnType<typeof toolWorld>>;
/** A server with a synced project and one agent session bound to it. */
export async function toolWorld(options: { empty?: boolean; slides?: number; mode?: "ask" | "plan" | "edit" | "auto"; toolSurface?: "editor" | "team" | "film" | "workflow" | "general"; harness?: Parameters<typeof createHarness>[0]; canvas?: { width: number; height: number }; template?: boolean } = {}) {
  const h = await createHarness(options.harness), s = support(h);
  const admin = await h.pair("Studio Mac", "admin");
  const project = buildProject(options);
  const doc = await s.enable(admin, project.doc);
  /** A creative session every device of the host may read and act in, as the editor's agent panel shares it. */
  const session = async (paired: Paired = admin, projectId: string | null = project.doc.metadata.id, mode = options.mode): Promise<string> => {
    const created = (await paired.call("jagentchill.session.create", { ref: ACME, ...(projectId ? { projectId } : {}), ...(mode ? { modeId: mode } : {}), ...(options.toolSurface ? { toolSurface: options.toolSurface } : {}) })).session.sessionKey as string;
    await paired.call("jagentchill.session.access.set", { sessionKey: created, access: "host" });
    return created;
  };
  const sessionKey = await session();
  const call = async (name: string, args: Record<string, unknown> = {}, as = sessionKey): Promise<ToolEnvelope> => (await h.app.tools.call(as, name, args)).envelope;
  /** A call that must succeed; its envelope. */
  const ok = async (name: string, args: Record<string, unknown> = {}, as = sessionKey): Promise<ToolEnvelope & { data: any }> => {
    const envelope = await call(name, args, as);
    assert.equal(envelope.ok, true, `${name} failed: ${JSON.stringify(envelope.error)}`);
    return envelope as ToolEnvelope & { data: any };
  };
  /** A staged write with a fresh idempotency key. */
  const write = (name: string, args: Record<string, unknown> = {}, as = sessionKey) => ok(name, { idempotencyKey: key(), ...args }, as);
  /** The error of a call that must fail. */
  const fails = async (name: string, args: Record<string, unknown> = {}, as = sessionKey) => {
    const envelope = await call(name, args, as);
    assert.equal(envelope.ok, false, `${name} was expected to fail but returned ${JSON.stringify(envelope.data ?? null).slice(0, 300)}`);
    return envelope.error! as ToolEnvelope["error"] & { code: string; message: string; retryable: boolean; details?: any };
  };
  const writeFails = (name: string, args: Record<string, unknown> = {}, as = sessionKey) => fails(name, { idempotencyKey: key(), ...args }, as);
  const head = () => s.headDocument(doc) as ProjectDocument;
  const revision = () => s.head(doc);
  /** The proposed state of the session's proposal: what the tools see next. */
  const proposed = async (as = sessionKey): Promise<ProjectDocument> => {
    const view = h.app.tools.currentProposal(as);
    return view ? applyPatch(head(), view.preview.patches as StatePatch) : head();
  };
  const scene = (document: ProjectDocument, sceneId = project.sceneId) => document.scenes.find((entry) => entry.id === sceneId) as unknown as Sc;
  const element = async (elementId: string, as = sessionKey) => timeline.located(await proposed(as), elementId).element;
  const main = async (as = sessionKey) => scene(await proposed(as)).tracks.main.elements;
  /** Submits the session's proposal as the agent does. */
  const submit = async (title = "Tighter intro", as = sessionKey) => (await ok("jc_proposal_submit", { title, summary: "Changes staged by the test." }, as)).proposalId!;
  const accept = (proposalId: string, paired: Paired = admin) => paired.call("jagentchill.proposal.resolve", { proposalId, action: "accept" });
  return { h, s, admin, project, doc, sessionKey, session, call, ok, write, fails, writeFails, head, revision, proposed, scene, element, main, submit, accept, close: () => h.close() };
}

/** A second device that follows a document through the sync protocol and keeps its own copy. */
export async function follower(h: Harness, name: string, doc: DocRef, start: ProjectDocument, fromRevision: number) {
  const paired = await h.pair(name, "editor");
  await paired.call("jagentchill.sync.subscribe", { doc });
  let copy = start, revision = fromRevision;
  /** Applies every operation the host has after this device's revision; returns the labels it saw. */
  const pull = async (): Promise<string[]> => {
    const labels: string[] = [];
    for (;;) {
      const page = await paired.call("jagentchill.sync.ops.pull", { doc, afterRevision: revision });
      if (page.ops.length === 0) return labels;
      for (const op of page.ops) { copy = applyPatch(copy, op.patches as StatePatch); revision = op.revision; labels.push(op.label); }
    }
  };
  return { paired, pull, get document() { return copy; }, get revision() { return revision; }, opsEvents: () => paired.events.filter((event) => event.event === "jagentchill.sync.ops") };
}

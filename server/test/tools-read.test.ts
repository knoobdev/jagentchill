// The Gateway in these tests is the FAKE of `harness.ts`; devices are simulated. The server, sync and the tools are real.
import assert from "node:assert/strict";
import { test } from "node:test";
import { timeline } from "@jagentchill/editor-core";
import { tick } from "./harness.ts";
import { S, key, toolWorld } from "./support/tools.ts";

test("Create and bind; Invalid canvas; Project default background; project list, get, update and duplicate", async () => {
  const w = await toolWorld();
  const unbound = await w.session(w.admin, null);
  await w.admin.call("jagentchill.session.subscribe", {});
  const created = await w.write("jc_project_create", { name: "Teaser", aspectPreset: "9:16", fps: { numerator: 30, denominator: 1 } }, unbound);
  const made = w.h.app.sync.documents.head(w.h.app.sync.documents.row({ kind: "project", id: created.data.projectId })! as never) as any;
  assert.deepEqual([made.settings.canvasSize, made.settings.fps, made.metadata.name], [{ width: 1080, height: 1920 }, { numerator: 30, denominator: 1 }, "Teaser"]);
  assert.equal((await w.admin.call("jagentchill.session.get", { sessionKey: unbound })).session.projectId, created.data.projectId, "the session is bound to the new project");
  assert.equal((await w.ok("jc_project_get", {}, unbound)).data.canvas.height, 1920);
  // A device finds the new project in the host space like any other synced project.
  assert.ok((await w.admin.call("jagentchill.sync.project.list", {})).items.some((item: any) => item.doc.id === created.data.projectId));
  assert.equal((await w.writeFails("jc_project_create", { name: "X", canvas: { width: 1920, height: 1080 }, aspectPreset: "16:9", fps: { numerator: 30, denominator: 1 } })).code, "INVALID_PARAMS");
  assert.equal((await w.writeFails("jc_project_create", { name: "X", aspectPreset: "16:9", fps: { numerator: 31, denominator: 1 } })).code, "INVALID_PARAMS");
  const dry = await w.write("jc_project_create", { name: "Dry", aspectPreset: "1:1", fps: { numerator: 25, denominator: 1 }, dryRun: true });
  assert.equal(dry.data.provisional, true);
  assert.equal(w.h.app.sync.documents.row({ kind: "project", id: dry.data.projectId }), undefined);

  const listed = await w.ok("jc_project_list", {});
  assert.deepEqual(new Set(listed.data.projects.map((project: any) => project.name)), new Set(["Teaser", "Da Lat in 48 hours"]));
  assert.equal(listed.data.projects.find((project: any) => project.id === w.doc.id).bound, true);
  assert.equal((await w.ok("jc_project_list", { limit: 1 })).data.nextCursor, "1");
  assert.equal((await w.ok("jc_project_list", { query: "teas" })).data.projects.length, 1);
  const got = await w.ok("jc_project_get");
  assert.deepEqual([got.data.name, got.data.mediaCount, got.data.scenes[0].elementCount, got.data.scenes[0].tracks.audio, got.data.leaseHolder, got.revision], ["Da Lat in 48 hours", 5, 3, 1, null, 1]);
  assert.equal(got.data.durationTimecode, "00:00:30:00");

  const wide = await w.writeFails("jc_project_update", { canvas: { width: 9000, height: 1080 } });
  assert.deepEqual([wide.code, wide.details], ["OUT_OF_RANGE", { field: "canvas.width", min: 16, max: 7680, value: 9000 }]);
  assert.equal((await w.writeFails("jc_project_update", { canvas: { width: 1921, height: 1080 } })).code, "INVALID_PARAMS");
  assert.equal((await w.writeFails("jc_project_update", {})).code, "INVALID_PARAMS");
  await w.write("jc_clip_transform", { elementIds: [w.project.clipA], background: { kind: "color", color: "#112233" } });
  const updated = await w.write("jc_project_update", { name: "Da Lat cut 2", background: { kind: "blur", blurIntensity: 300 }, fps: { numerator: 60, denominator: 1 }, canvas: { width: 1080, height: 1920 }, useProxies: false, publish: { title: "48 hours" } });
  assert.deepEqual(updated.data.changed, ["name", "canvas", "frame rate", "background", "proxies", "publish caption"]);
  const proposed = await w.proposed();
  assert.deepEqual(proposed.settings.background, { kind: "blur", blurIntensity: 300 });
  assert.deepEqual((await w.element(w.project.clipA)).background, { kind: "color", color: "#112233" }, "no clip's own background changed");
  assert.deepEqual([proposed.metadata.name, proposed.settings.canvasSize.height, proposed.settings.useProxies, (proposed as any).publish.title], ["Da Lat cut 2", 1920, false, "48 hours"]);
  assert.equal((await w.writeFails("jc_project_update", { background: { kind: "blur", blurIntensity: 5000 } })).code, "OUT_OF_RANGE");
  // A frame rate the existing clips do not sit on is refused by the document validator, with its code.
  const grid = await w.writeFails("jc_project_update", { fps: { numerator: 30000, denominator: 1001 } });
  assert.deepEqual([grid.code, grid.details?.documentCode], ["CONFLICT", "document/not-frame-aligned"]);
  assert.equal((await w.writeFails("jc_project_update", { background: { kind: "image", mediaId: w.project.assets.music } })).code, "ASSET_NOT_FOUND");
  // A copy of the synced state, as a new project; the session stays where it is.
  const copy = await w.write("jc_project_duplicate", { name: "Da Lat copy" });
  const copied = w.h.app.sync.documents.head(w.h.app.sync.documents.row({ kind: "project", id: copy.data.projectId })! as never) as any;
  assert.deepEqual([copied.metadata.name, copied.scenes[0].tracks.main.elements.length, copied.metadata.id !== w.doc.id], ["Da Lat copy", 2, true]);
  assert.equal((await w.admin.call("jagentchill.session.get", { sessionKey: w.sessionKey })).session.projectId, w.doc.id);
  w.close();
});

test("A changed project turn gets a revision receipt, then the agent reads the current timeline on demand", async () => {
  const w = await toolWorld();
  const session = (await w.admin.call("jagentchill.session.get", { sessionKey: w.sessionKey })).session;
  const first = w.h.app.tools.turnContext(session);
  assert.ok(first);
  assert.match(first, /Tracks, top to bottom:/, "the first turn carries the full project context");

  await w.write("jc_text_add", { content: "Diff check", start: 0, duration: S, style: { fontSize: 12, fontWeight: 400 } });
  const changed = w.h.app.tools.turnContext(session);
  assert.ok(changed);
  assert.match(changed, /changed since its full context at revision 1/);
  assert.match(changed, /Read the current timeline with jc_timeline_snapshot/);
  assert.doesNotMatch(changed, /Tracks, top to bottom:|^- track /m, "a changed turn does not repeat the full track listing");

  const current = await w.ok("jc_timeline_snapshot", { detail: "standard", includeProposed: true });
  assert.ok(current.data.tracks.some((track: any) => track.elements.some((element: any) => element.text === "Diff check")), "the read tool supplies the changed detail");
  const unchanged = w.h.app.tools.turnContext(session);
  assert.ok(unchanged);
  assert.match(unchanged, /is unchanged since the context block earlier in this chat/);
  w.close();
});

test("Create a scene; Delete the last scene; Delete a referenced scene; In and out points; scene list, rename, reorder, duplicate, set_active", async () => {
  const w = await toolWorld();
  assert.equal((await w.writeFails("jc_scene_edit", { action: "delete", sceneId: w.project.sceneId })).code, "INVALID_PARAMS", "the main (and last) scene cannot be deleted");
  const created = await w.write("jc_scene_edit", { action: "create", name: "B-roll" });
  const sceneId = created.data.sceneId;
  assert.equal((await w.proposed()).scenes.find((scene) => scene.id === sceneId)!.name, "B-roll");
  let list = (await w.ok("jc_scene_list")).data.scenes;
  assert.equal(list.length, 1, "the staged scene is not in the committed project yet");
  // A range, frame-aligned; the out point never lies before the in point.
  const range = await w.write("jc_scene_edit", { action: "set_range", inPoint: 2 * S, outPoint: 10 * S });
  assert.deepEqual([range.data.inPoint, range.data.outPoint, range.data.inPointTimecode], [2 * S, 10 * S, "00:00:02:00"]);
  const backwards = await w.writeFails("jc_scene_edit", { action: "set_range", inPoint: 12 * S, outPoint: 3 * S });
  assert.equal(backwards.code, "OUT_OF_RANGE");
  await w.write("jc_scene_edit", { action: "set_range", inPoint: null });
  assert.deepEqual([w.scene(await w.proposed()).inPoint, w.scene(await w.proposed()).outPoint], [undefined, 10 * S]);
  await w.write("jc_scene_edit", { action: "rename", sceneId, name: "Cutaways" });
  await w.write("jc_scene_edit", { action: "reorder", sceneId, index: 0 });
  const duplicate = await w.write("jc_scene_edit", { action: "duplicate", sceneId: w.project.sceneId });
  assert.deepEqual((await w.proposed()).scenes.map((scene) => scene.name), ["Cutaways", "Main scene", "Main scene (copy)"]);
  // A scene used by a compound clip cannot be deleted; the elements that use it are listed.
  const compound = await w.write("jc_clip_compound", { action: "create", elementIds: [w.project.clipA, w.project.clipB], name: "Act one" });
  const referenced = await w.writeFails("jc_scene_edit", { action: "delete", sceneId: compound.data.sceneId });
  assert.deepEqual([referenced.code, referenced.details?.referencedBy], ["UNSUPPORTED_FOR_ELEMENT", [compound.data.elementId]]);
  await w.write("jc_scene_edit", { action: "delete", sceneId: duplicate.data.sceneId });
  assert.equal((await w.writeFails("jc_scene_edit", { action: "delete", sceneId: "nope" })).code, "SCENE_NOT_FOUND");
  assert.equal((await w.writeFails("jc_scene_edit", { action: "rename", sceneId, name: "x".repeat(81) })).code, "OUT_OF_RANGE");
  await w.accept(await w.submit("Scenes"));
  // The active scene is session state, not a document field: nothing is staged, and without a client there is a warning.
  const active = await w.write("jc_scene_edit", { action: "set_active", sceneId });
  assert.deepEqual([active.data.isActive, active.warnings, active.proposalId], [true, ["no_client"], undefined]);
  assert.equal(w.h.app.tools.currentProposal(w.sessionKey), undefined);
  list = (await w.ok("jc_scene_list")).data.scenes;
  assert.deepEqual(list.map((scene: any) => [scene.name, scene.kind, scene.isActive]), [["Cutaways", "timeline", true], ["Main scene", "timeline", false], ["Act one", "compound", false]]);
  assert.equal((await w.ok("jc_timeline_snapshot")).data.sceneId, sceneId, "tools default to the active scene");
  w.close();
});

test("Empty library; Tag assets; Delete an asset in use; media list, get and organise; Find a transition", async () => {
  const empty = await toolWorld({ empty: true });
  const none = await empty.ok("jc_media_list", { kind: "other" });
  assert.deepEqual([none.ok, none.data.assets, none.data.total], [true, [], 0]);
  empty.close();
  const w = await toolWorld();
  const all = await w.ok("jc_media_list", { sort: "name" });
  assert.deepEqual(all.data.assets.map((asset: any) => asset.name), ["drone_dalat_01.mp4", "mai_interview.mp4", "morning_theme.mp3", "pine_forest.jpg", "timelapse.mp4"]);
  assert.deepEqual([all.data.assets[0].usageCount, all.data.assets[0].analysis.probe, all.data.assets[0].durationTimecode, all.data.assets[0].untrusted], [1, "ready", "00:00:10:00", true]);
  assert.deepEqual((await w.ok("jc_media_list", { query: "BROLL" })).data.assets.map((asset: any) => [asset.name, asset.matchedIn]), [["drone_dalat_01.mp4", ["tags"]]]);
  assert.equal((await w.ok("jc_media_list", { kind: "video", usedInProject: false })).data.assets[0].name, "timelapse.mp4");
  assert.equal((await w.ok("jc_media_list", { limit: 2 })).data.nextCursor, "2");
  // A page size above the maximum is not a refused call (the owner's work log showed "limit must be between 1 and 200" in red): the maximum is used and the agent is told.
  const eased = await w.ok("jc_media_list", { limit: 500 });
  assert.equal(eased.data.assets.length, 5);
  assert.ok(eased.warnings.some((entry: string) => /^ADJUSTED: limit 500 is outside its range; \d+ was used\.$/.test(entry)), JSON.stringify(eased.warnings));
  const one = await w.ok("jc_media_get", { assetId: w.project.assets.interview });
  assert.deepEqual([one.data.asset.width, one.data.asset.hasAudio, one.data.asset.usedBy], [1920, true, [w.project.clipB]]);
  assert.equal((await w.fails("jc_media_get", { assetId: "nope" })).code, "ASSET_NOT_FOUND");

  await w.write("jc_media_organize", { action: "tag", assetIds: [w.project.assets.photo, w.project.assets.silent], tags: ["broll"] });
  const folder = await w.write("jc_media_organize", { action: "create_folder", name: "Cutaways" });
  await w.write("jc_media_organize", { action: "move", assetIds: [w.project.assets.photo], folderId: folder.data.folderId });
  await w.write("jc_media_organize", { action: "rename", assetIds: [w.project.assets.photo], name: "Pine forest.jpg" });
  await w.write("jc_media_organize", { action: "untag", assetIds: [w.project.assets.drone], tags: ["broll"] });
  const used = await w.writeFails("jc_media_organize", { action: "delete", assetIds: [w.project.assets.drone] });
  assert.deepEqual([used.code, used.details?.usedBy], ["UNSUPPORTED_FOR_ELEMENT", [w.project.clipA]]);
  await w.write("jc_media_organize", { action: "delete", assetIds: [w.project.assets.silent] });
  assert.equal((await w.writeFails("jc_media_organize", { action: "rename", assetIds: [w.project.assets.photo] })).code, "INVALID_PARAMS");
  assert.equal((await w.writeFails("jc_media_organize", { action: "move", assetIds: [w.project.assets.photo], folderId: "nope" })).code, "NOT_FOUND");
  await w.accept(await w.submit("Tidy the library"));
  const tagged = await w.ok("jc_media_list", { tag: "broll" });
  assert.deepEqual(tagged.data.assets.map((asset: any) => [asset.name, asset.folderId]), [["Pine forest.jpg", folder.data.folderId]]);
  assert.equal(tagged.data.folders[0].name, "Cutaways");
  assert.equal((await w.ok("jc_media_list")).data.total, 4);

  // The bundled libraries.
  const dissolve = await w.ok("jc_library_search", { kind: "transition", query: "dissolve" });
  assert.ok(dissolve.data.items.length >= 1);
  const cross = dissolve.data.items.find((item: any) => item.id === "cross-dissolve");
  assert.deepEqual([cross.name, cross.defaultDuration, Array.isArray(cross.params)], ["Cross Dissolve", 60_000, true]);
  const blur = (await w.ok("jc_library_search", { kind: "effect", query: "blur" })).data.items.find((item: any) => item.id === "blur");
  assert.ok(blur.params.some((param: any) => param.type === "number" && typeof param.min === "number" && typeof param.max === "number"));
  for (const kind of ["filter", "text_template", "text_effect_preset", "text_animation", "text_bubble", "shape", "clip_animation", "caption_style"]) assert.ok((await w.ok("jc_library_search", { kind, limit: 5 })).data.items.length > 0, kind);
  assert.equal((await w.fails("jc_library_search", { kind: "typeface" })).code, "INVALID_PARAMS");
  assert.equal((await w.fails("jc_library_search", { kind: "effect", query: "x".repeat(900) })).code, "OUT_OF_RANGE", "a search query is at most 500 characters");
  w.close();
});

test("Standard snapshot; Range filter; Proposed state; Large timeline; Single item too large; Elements under a time; Text search; Nothing matches", async () => {
  const w = await toolWorld();
  const standard = await w.ok("jc_timeline_snapshot", { detail: "standard" });
  assert.deepEqual(standard.data.tracks.map((track: any) => [track.zone, track.type, track.elements.length]), [["main", "video", 2], ["audio", "audio", 1]]);
  assert.deepEqual(standard.data.tracks[0].elements.map((element: any) => [element.id, element.start, element.duration, element.assetId, element.sourceOut]), [[w.project.clipA, 0, 10 * S, w.project.assets.drone, 10 * S], [w.project.clipB, 10 * S, 20 * S, w.project.assets.interview, 20 * S]]);
  assert.deepEqual([standard.revision, standard.data.sceneDuration, standard.data.fps, standard.data.canvas, standard.data.gaps], [1, 30 * S, { numerator: 30, denominator: 1 }, { width: 1920, height: 1080 }, []]);
  assert.equal(standard.data.tracks[0].elements[0].startTimecode, "00:00:00:00");
  const summary = await w.ok("jc_timeline_snapshot", { detail: "summary" });
  // Token saving: a snapshot asked for without a detail level is the summary.
  assert.deepEqual((await w.ok("jc_timeline_snapshot")).data.tracks[0].elements[0], summary.data.tracks[0].elements[0]);
  assert.deepEqual(Object.keys(summary.data.tracks[0].elements[0]).filter((name) => !name.endsWith("Timecode")).sort(), ["availability", "duration", "id", "name", "start", "trackId", "type"]);
  const full = await w.ok("jc_timeline_snapshot", { detail: "full", trackIds: [w.project.musicTrack] });
  assert.equal(full.data.tracks.length, 1);
  assert.equal(typeof full.data.tracks[0].elements[0].fields.fadeIn, "object");
  // Only what intersects the range.
  const ranged = await w.ok("jc_timeline_snapshot", { range: { start: 12 * S, end: 20 * S } });
  assert.deepEqual(ranged.data.tracks.flatMap((track: any) => track.elements.map((element: any) => element.id)), [w.project.clipB, w.project.music]);
  assert.equal((await w.fails("jc_timeline_snapshot", { range: { start: 5 * S, end: 5 * S } })).code, "INVALID_PARAMS");
  assert.equal((await w.fails("jc_timeline_snapshot", { trackIds: ["nope"] })).code, "TRACK_NOT_FOUND");
  // The open proposal: what it adds, changes and removes.
  await w.write("jc_clip_delete", { elementIds: [w.project.clipA], editContext: { magnet: false } });
  await w.write("jc_text_add", { content: "Subscribe for more", start: 0, duration: 3 * S });
  await w.write("jc_audio_edit", { elementIds: [w.project.music], volume: -6 });
  const proposed = await w.ok("jc_timeline_snapshot", { includeProposed: true });
  const marks = Object.fromEntries(proposed.data.tracks.flatMap((track: any) => track.elements.map((element: any) => [element.name, element.proposed])));
  assert.deepEqual(marks, { "Subscribe for more": "added", "drone_dalat_01.mp4": "removed", "mai_interview.mp4": undefined, "morning_theme.mp3": "modified" });
  assert.deepEqual(proposed.data.gaps, [{ start: 0, duration: 10 * S, startTimecode: "00:00:00:00", durationTimecode: "00:00:10:00" }]);
  const committedReceipt = await w.ok("jc_timeline_snapshot");
  assert.equal(committedReceipt.data.unchanged, true, "the second identical committed read is a receipt");
  assert.equal(committedReceipt.data.count, 3, "without the flag the committed state is read");
  await w.accept(await w.submit("Titles"));

  // Queries.
  const at = await w.ok("jc_timeline_find", { at: 1 * S });
  assert.deepEqual(at.data.elements.map((element: any) => [element.type, element.zone]), [["text", "overlay"], ["audio", "audio"]], "top-most track first");
  assert.equal((await w.ok("jc_timeline_find", { text: "SUBSCRIBE" })).data.elements[0].text, "Subscribe for more");
  assert.deepEqual((await w.ok("jc_timeline_find", { type: "video", assetId: w.project.assets.interview })).data.elements.map((element: any) => element.id), [w.project.clipB]);
  assert.deepEqual((await w.ok("jc_timeline_find", { zone: "audio", range: { start: 0, end: S } })).data.elements.map((element: any) => element.id), [w.project.music]);
  const nothing = await w.ok("jc_timeline_find", { text: "no such words", hasKeyframes: true });
  assert.deepEqual([nothing.ok, nothing.data.elements], [true, []]);
  w.close();

  // 1,200 elements: the first page holds what fits in 32 KiB and names the next.
  const big = await toolWorld({ empty: true, slides: 1200 });
  const defaultPage = await big.ok("jc_timeline_snapshot");
  assert.equal(defaultPage.data.tracks[0].elements.length, 10, "a default read returns a short page with the full count and a cursor");
  assert.equal(defaultPage.data.elementCount, 1200);
  assert.equal(defaultPage.data.nextCursor, "10");
  const first = await big.ok("jc_timeline_snapshot", { limit: 200 });
  const count = first.data.tracks[0].elements.length;
  assert.equal(first.data.elementCount, 1200);
  assert.ok(count > 20 && count < 200, `the page was cut at an item boundary (${count})`);
  assert.equal(first.data.nextCursor, String(count));
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 32 * 1024);
  const next = await big.ok("jc_timeline_snapshot", { limit: 200, cursor: first.data.nextCursor });
  assert.equal(next.data.tracks[0].elements[0].start, count * S);
  assert.equal((await big.fails("jc_timeline_snapshot", { cursor: "banana" })).code, "INVALID_PARAMS");
  // One element whose full detail cannot fit.
  const shape = await big.write("jc_shape_add", { shape: "drawing", start: 0, duration: S, strokes: Array.from({ length: 40 }, (_, row) => ({ points: Array.from({ length: 400 }, (_, index) => [index * 3.137 + row, Math.sin(index + row) * 211.73 + row * 7] as [number, number]), width: 6, color: "#ffffff", brush: "pen" })) });
  await big.accept(await big.submit("A heavy drawing"));
  const tooLarge = await big.fails("jc_timeline_snapshot", { detail: "full", trackIds: [timeline.located(big.head(), shape.data.elementId).track.id] });
  assert.equal(tooLarge.code, "RESULT_TOO_LARGE");
  assert.match(tooLarge.message, /standard/);
  big.close();
});

test("Identical read results are replaced by an id and count receipt; detail reads remain available", async () => {
  const w = await toolWorld();
  const first = await w.ok("jc_timeline_snapshot", { detail: "summary" });
  const repeated = await w.ok("jc_timeline_snapshot", { detail: "summary" });
  assert.equal(repeated.data.unchanged, true);
  assert.equal(repeated.data.count, first.data.elementCount);
  assert.ok(repeated.data.ids.includes(w.project.clipA));
  assert.ok(Buffer.byteLength(JSON.stringify(repeated)) < Buffer.byteLength(JSON.stringify(first)) / 2);
  const added = await w.write("jc_text_add", { content: "After receipt", start: 0, duration: S });
  await w.accept(await w.submit("Add a title"));
  const changed = await w.ok("jc_timeline_snapshot", { detail: "summary" });
  assert.equal(changed.data.unchanged, false);
  assert.deepEqual(changed.data.addedIds, [added.data.elementId]);
  assert.equal(changed.data.count, first.data.elementCount + 1);
  const found = await w.ok("jc_timeline_find", { text: "After receipt" });
  const detail = await w.ok("jc_timeline_snapshot", { detail: "standard", trackIds: [found.data.elements[0].trackId] });
  assert.ok(detail.data.tracks[0].elements.some((element: any) => element.text === "After receipt"));
  w.close();
});

test("Read the selection; Focus without a client; No renderer; Image limits; Render two frames; Proposed frame differs; One slow frame", async () => {
  const w = await toolWorld({ harness: { extra: { toolTimings: { frameMs: 120 } } as never } });
  // Nobody has the project open.
  const closed = await w.ok("jc_editor_context");
  assert.deepEqual([closed.data.clientOpen, closed.data.playhead, closed.data.leaseHolder], [false, 0, null]);
  const unfocused = await w.ok("jc_editor_focus", { time: 4 * S });
  assert.deepEqual([unfocused.ok, unfocused.warnings, unfocused.data.focused], [true, ["no_client"], false]);
  assert.equal((await w.fails("jc_editor_focus", {})).code, "INVALID_PARAMS");
  const none = await w.fails("jc_frame_render", { times: [2 * S] });
  assert.deepEqual([none.code, none.retryable], ["RENDERER_UNAVAILABLE", true]);
  assert.equal(none.message, "No renderer is available. Ask the user to open the project on a device, or continue without looking at frames.");
  assert.equal((await w.fails("jc_frame_render", { times: [0, S, 2 * S, 3 * S, 4 * S, 5 * S] })).code, "OUT_OF_RANGE", "at most 4 frames per call");
  assert.equal((await w.fails("jc_frame_render", { times: [0], width: 1920 })).code, "OUT_OF_RANGE", "at most 1280 px");

  // A device that only has the project open is not asked: it must also have this session focused.
  const other = await w.h.pair("Tablet", "editor");
  const presence = (paired: typeof other, focusedSessionId?: string) => paired.call("jagentchill.presence.heartbeat", { deviceType: "desktop", appVisible: true, openDoc: w.doc, mode: "viewing", sceneId: w.project.sceneId, playhead_ticks: 2 * S, supportedSchemaVersion: { project: 32, script: 1, workflow: 1 }, lastActivity_ms: Date.now(), ...(focusedSessionId ? { focusedSessionId } : {}) });
  await presence(other);
  assert.equal((await w.fails("jc_frame_render", { times: [2 * S] })).code, "RENDERER_UNAVAILABLE");
  assert.equal(other.events.filter((event) => event.event === "jagentchill.editor.frame.request").length, 0, "no other connected device is asked to render");
  // The user's desktop has the session focused: selection, playhead and panel come from it.
  const desktop = await w.h.pair("Desktop", "editor");
  await presence(desktop, w.sessionKey);
  await desktop.call("jagentchill.editor.context.report", { projectId: w.doc.id, sceneId: w.project.sceneId, playhead: 4 * S, selectedElementIds: [w.project.clipA, w.project.clipB], selectedRange: { start: S, end: 2 * S }, inPoint: null, outPoint: null, panel: "inspector", zoomWindow: { start: 0, end: 30 * S }, focusedSessionKey: w.sessionKey });
  const context = await w.ok("jc_editor_context");
  assert.deepEqual([context.data.clientOpen, context.data.selectedElementIds, context.data.playhead, context.data.panel, context.data.deviceName, context.data.selectedRange.start], [true, [w.project.clipA, w.project.clipB], 4 * S, "inspector", "Desktop", S]);
  assert.equal((await w.ok("jc_timeline_snapshot")).data.playhead, 4 * S);
  const focused = await w.ok("jc_editor_focus", { time: 6 * S, elementIds: [w.project.clipB], panel: "effects" });
  assert.deepEqual([focused.data.focused, focused.warnings], [true, []]);
  await tick(20);
  const focus = desktop.events.find((event) => event.event === "jagentchill.editor.focus")!.payload;
  assert.deepEqual([focus.time, focus.elementIds, focus.panel, focus.projectId], [6 * S, [w.project.clipB], "effects", w.doc.id]);
  assert.equal(w.revision(), 1, "focusing changes nothing in the project");

  // The focused client renders: the simulated device answers each request with frames of its own.
  const pixel = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
  let slow: number[] = [];
  let inFlight = 0, most = 0, answerAfter = 0;
  desktop.ws.on("message", (data: { toString(): string }) => {
    const frame = JSON.parse(data.toString());
    if (frame.t !== "evt" || frame.event !== "jagentchill.editor.frame.request") return;
    const request = frame.payload;
    const frames = request.times.map((time: number, index: number) => ({ index, mime: "image/jpeg", dataBase64: pixel, time, width: request.width, height: Math.round((request.width * 9) / 16) })).filter((entry: any) => !slow.includes(entry.index));
    // Like the app, the device tiles the frames of a contact sheet into one image.
    inFlight += 1; most = Math.max(most, inFlight);
    setTimeout(() => { inFlight -= 1; void desktop.call("jagentchill.editor.frame.result", { requestId: request.requestId, frames: request.layout === "contact_sheet" ? frames.slice(0, 1) : frames, failed: slow }); }, answerAfter);
  });
  const two = await w.h.app.tools.call(w.sessionKey, "jc_frame_render", { times: [2 * S, 8 * S] });
  assert.equal(two.envelope.ok, true, JSON.stringify(two.envelope.error));
  assert.deepEqual((two.envelope.data as any).frames.map((frame: any) => [frame.time, frame.width, frame.renderer, frame.timeTimecode]), [[2 * S, 768, "client", "00:00:02:00"], [8 * S, 768, "client", "00:00:08:00"]]);
  assert.deepEqual(two.images.map((image) => image.mime), ["image/jpeg", "image/jpeg"]);
  // With the flag, the client is handed the proposal's patches to render the proposed state; without it, none.
  await w.write("jc_text_add", { content: "Title", start: 2 * S, duration: 2 * S });
  await w.ok("jc_frame_render", { times: [2 * S], includeProposed: true, width: 512, overlays: ["safe_areas"] });
  await w.ok("jc_frame_render", { times: [2 * S] });
  const requests = desktop.events.filter((event) => event.event === "jagentchill.editor.frame.request").map((event) => event.payload);
  assert.equal(requests.at(-2).patches.some((entry: any) => entry.op === "add" && JSON.stringify(entry.value).includes("Title")), true);
  assert.deepEqual([requests.at(-2).width, requests.at(-2).overlays, requests.at(-1).patches], [512, ["safe_areas"], undefined]);
  // One of three frames is not produced in time: two images and a warning.
  slow = [1];
  const partial = await w.h.app.tools.call(w.sessionKey, "jc_frame_render", { times: [S, 2 * S, 3 * S] });
  assert.equal(partial.images.length, 2);
  assert.equal(partial.envelope.warnings.length, 1);
  assert.match(partial.envelope.warnings[0], /^RENDERER_UNAVAILABLE: frame 1/);
  // 30 frames a minute for a session.
  slow = [];
  let limited;
  // "Frame budget": every result says what is left; the same picture again is returned without counting or rendering;
  // a contact sheet of many timestamps counts as one image.
  const asked = () => desktop.events.filter((event) => event.event === "jagentchill.editor.frame.request").length;
  const first = await w.ok("jc_frame_render", { times: [20 * S] });
  const left = first.data.budget.remaining;
  assert.deepEqual([first.data.budget.limit, left < 30, first.data.budget.resetIn_ms > 0], [30, true, true]);
  const renders = asked();
  const again = await w.ok("jc_frame_render", { times: [20 * S] });
  assert.deepEqual([again.data.cached, again.data.budget.remaining, asked()], [true, left, renders]);
  const sheet = await w.h.app.tools.call(w.sessionKey, "jc_frame_render", { times: [0, 2 * S, 4 * S, 6 * S, 8 * S, 10 * S, 12 * S, 14 * S], layout: "contact_sheet" });
  assert.deepEqual([sheet.envelope.ok, (sheet.envelope.data as any).budget.remaining], [true, left - 1]);
  // A runtime that asks for several frame sets in one step: the device is given one request at a time, and all are answered.
  answerAfter = 40; most = 0;
  const together = await Promise.all([40, 41, 42].map((at) => w.h.app.tools.call(w.sessionKey, "jc_frame_render", { times: [at * S] })));
  assert.deepEqual([together.map((result) => result.envelope.ok), most], [[true, true, true], 1]);
  answerAfter = 0;
  assert.equal((await w.fails("jc_frame_render", { times: [S], layout: "contact_sheet" })).code, "INVALID_PARAMS");
  assert.match((await w.fails("jc_frame_render", { times: [0, S, 2 * S, 3 * S, 4 * S] })).message, /contact_sheet/);
  // 30 images a minute for a session: the refusal says how many are left, when more can be rendered, and not to call again.
  for (let call = 0; call < 14 && !limited; call++) { const result = (await w.h.app.tools.call(w.sessionKey, "jc_frame_render", { times: [30 * S + call, 31 * S + call, 32 * S + call] })).envelope; if (!result.ok) limited = result.error; }
  assert.equal(limited?.code, "RATE_LIMITED");
  assert.ok(Number(limited?.details?.retryAfter_ms) > 0);
  assert.deepEqual([limited?.details?.reason, limited?.details?.limit], ["frame_budget", 30]);
  assert.match(String(limited?.message), /do not call again before that/);
  // A frame seen before the limit is still returned from the session's cache.
  assert.equal((await w.ok("jc_frame_render", { times: [20 * S] })).data.cached, true);
  void key;
  w.close();
});

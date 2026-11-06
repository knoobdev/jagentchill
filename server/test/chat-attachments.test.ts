import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { buildProject, toolWorld, type ToolWorld } from "./support/tools.ts";

let world: ToolWorld;
after(() => world?.close());

test("chat attachments register blobs, relay them to the runtime, retain session history and enforce session permissions and limits", async () => {
  world = await toolWorld({ empty: true, ...(process.env.W7_TEST_DATA_DIR ? { harness: { dataDir: process.env.W7_TEST_DATA_DIR, listenPort: Number(process.env.JAGENTCHILL_PORT) } } : {}) });
  const { h, admin, sessionKey } = world;
  const files = [
    { name: "reference.png", mime: "image/png", bytes: Buffer.from("fixture-png") },
    { name: "brief.pdf", mime: "application/pdf", bytes: Buffer.from("%PDF fixture") },
    { name: "voice.wav", mime: "audio/wav", bytes: Buffer.from("RIFF fixture") },
  ];
  const refs = files.map((file) => {
    const blob = h.app.sync.blobs.put(file.bytes, { mime: file.mime, name: file.name, purpose: "media" });
    return { file, blob };
  });
  const registered = [];
  for (const { file, blob } of refs) {
    const made = await admin.call("jagentchill.chat.attachment.create", { sessionKey, blobId: blob.sha256, name: file.name, mime: file.mime, size: file.bytes.length });
    registered.push(made.attachment);
  }
  const metadataSession = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" } })).session.sessionKey;
  const sameBytesDifferentPickerMime = await admin.raw("jagentchill.chat.attachment.create", { sessionKey: metadataSession, blobId: refs[0]!.blob.sha256, name: "reference-converted.jpg", mime: "image/jpeg", size: refs[0]!.file.bytes.length });
  assert.equal(sameBytesDifferentPickerMime.ok, true, `intact uploaded bytes rejected due to client metadata: ${JSON.stringify(sameBytesDifferentPickerMime.error)}`);
  assert.deepEqual([sameBytesDifferentPickerMime.result.attachment.mime, sameBytesDifferentPickerMime.result.attachment.size], ["image/png", refs[0]!.file.bytes.length]);
  assert.deepEqual(registered.map((entry) => entry.name), ["reference.png", "brief.pdf", "voice.wav"]);

  const mediaBytes = Buffer.from("project-media-fixture");
  const mediaBlob = h.app.sync.blobs.put(mediaBytes, { mime: "audio/wav", name: "project-track.wav", purpose: "media" });
  const project = buildProject({ empty: true });
  const asset = project.doc.media.assets[0]!;
  asset.name = "project-track.wav";
  asset.contentHash = mediaBlob.sha256;
  asset.size = mediaBytes.length;
  const projectRef = await world.s.enable(admin, project.doc);
  const mediaSession = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" }, projectId: projectRef.id })).session.sessionKey;
  await admin.call("jagentchill.session.access.set", { sessionKey: mediaSession, access: "host" });
  const projectMedia = await admin.call("jagentchill.chat.attachment.media", { sessionKey: mediaSession });
  assert.deepEqual(projectMedia.media, [{ blobId: mediaBlob.sha256, name: "project-track.wav", mime: "audio/wav", size: mediaBytes.length }], "From project media lists complete synced assets for the session project");
  const picked = await admin.call("jagentchill.chat.attachment.create", { sessionKey: mediaSession, blobId: mediaBlob.sha256, name: "project-track.wav", mime: "audio/wav", size: mediaBytes.length });
  assert.equal(picked.attachment.blobId, mediaBlob.sha256, "a selected project asset is registered through the same attachment path");

  const sent = await admin.call("jagentchill.chat.send", { sessionKey, message: "Review these files", attachmentIds: registered.map((entry) => entry.attachmentId) });
  assert.equal(sent.delivered, true);
  assert.equal((await admin.call("jagentchill.session.get", { sessionKey })).session.title, "Review these files", "automatic title uses the person's typed text, not the attachment relay note");
  const gateway = h.fake.callsOf("startTurn").at(-1)! as { sessionKey: string; message: string; attachments?: Array<{ name: string; mimeType: string; data?: string }> };
  assert.match(gateway.message, /Review these files/);
  assert.match(gateway.message, /brief\.pdf/);
  assert.match(gateway.message, /audio\/wav/);
  const runtimePaths = [...gateway.message.matchAll(/\[Runtime file: ([^\]]+)\]/g)].map((match) => match[1]!);
  assert.equal(runtimePaths.length, 3);
  assert.deepEqual(runtimePaths.map((path) => existsSync(path)), [true, true, true]);
  assert.equal(readFileSync(runtimePaths[1]!).toString(), "%PDF fixture");
  assert.deepEqual(gateway.attachments?.map((entry) => [entry.name, entry.mimeType, typeof entry.data]), [["reference.png", "image/png", "string"]], "a small supported picture reaches the runtime inline");
  h.fake.reply(sessionKey, "Reviewed.");

  // The server's own transcript keeps the message as the person sent it, with its attachments.
  const history = await admin.call("jagentchill.chat.history", { sessionKey });
  assert.deepEqual(history.messages[0].jagentchill.attachments.map((entry: { name: string }) => entry.name), ["reference.png", "brief.pdf", "voice.wav"]);
  assert.doesNotMatch(JSON.stringify(history.messages[0].content), /Runtime file|jc-attachments/);
  const reopened = await admin.call("jagentchill.chat.attachment.list", { sessionKey });
  assert.deepEqual(reopened.attachments.map((entry: { name: string }) => entry.name), ["reference.png", "brief.pdf", "voice.wav"]);

  const available = await admin.call("jagentchill.chat.commands", { sessionKey });
  assert.deepEqual(available.commands, [
    { name: "status", description: "Show this session's status.", source: "builtin", acceptsArgs: false },
    { name: "help", description: "List available commands.", source: "builtin", acceptsArgs: false },
    { name: "compact", description: "Summarize this conversation to free context.", source: "builtin", acceptsArgs: false },
  ], "with no command file of the runtime on the host, only JAgentChill's commands are offered, last");
  const draftAvailable = await admin.call("jagentchill.chat.commands", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" } });
  assert.deepEqual(draftAvailable.commands.map((entry: { name: string }) => entry.name), available.commands.map((entry: { name: string }) => entry.name), "a Home draft gets the same command inventory before a session exists");
  assert.equal(draftAvailable.model, "opus");
  const sendCountBeforeStatus = h.fake.callsOf("startTurn").length;
  const status = await admin.call("jagentchill.chat.send", { sessionKey, message: "/status" });
  assert.equal(status.hostReply.title, "Session status", "status is answered by the host as a normal timeline card");
  assert.equal(status.hostReply.rows.some((row: { value: string }) => /gateway|agent:main:|jagentchill-unset|oauth/i.test(row.value)), false, "host status contains no engine details");
  assert.equal(h.fake.callsOf("startTurn").length, sendCountBeforeStatus, "host status never reaches the engine");
  await admin.call("jagentchill.chat.send", { sessionKey, message: "/not-in-inventory keep this as text" });
  assert.equal((h.fake.callsOf("startTurn").at(-1) as { message: string }).message, "/not-in-inventory keep this as text", "unknown slash text follows the normal message path");
  h.fake.endTurn(sessionKey);

  h.results.set("fake-cli commands --json", h.ok(JSON.stringify({ commands: [
    { name: "review", description: "Review the current change.", acceptsArgs: true, argsHint: "[path]" },
    ...["test", "explain", "fix", "refactor", "document", "commit", "diff", "search", "summarize", "plan", "audit"].map((name) => ({ name, description: `Fake CLI ${name} command.` })),
  ] })));
  writeFileSync(`${h.binDir}/fake-cli`, "#!/bin/sh\nexit 0\n"); chmodSync(`${h.binDir}/fake-cli`, 0o755);
  await admin.call("jagentchill.runtime.config.update", { expectedRevision: 0, patch: { entries: { "test-fake-cli": { extends: "acp", label: "Fake CLI", command: ["fake-cli"] } } } });
  h.app.db.prepare("UPDATE agent_sessions SET runtime_id = ?, provider_id = ?, model_id = ? WHERE session_key = ?").run("test-fake-cli", "fake-cli", "fixture", sessionKey);
  const fakeCliCommands = await admin.call("jagentchill.chat.commands", { sessionKey });
  assert(fakeCliCommands.commands.some((entry: { name: string; argsHint?: string; source?: string }) => entry.name === "review" && entry.argsHint === "[path]" && entry.source === "test-fake-cli"), `an isolated fake CLI JSON inventory is offered with its source: ${JSON.stringify({ commands: fakeCliCommands.commands, executions: h.commands, runtime: h.app.runtimes.runtime("test-fake-cli"), command: h.app.runtimes.cliCommand("test-fake-cli"), session: (await admin.call("jagentchill.session.get", { sessionKey })).session.ref })}`);
  assert(fakeCliCommands.commands.length >= 12 && fakeCliCommands.commands.every((entry: { source: string }) => entry.source !== "gateway") && fakeCliCommands.commands.some((entry: { source: string }) => entry.source === "test-fake-cli"), "the session inventory unions runtime commands without exposing the engine source");
  assert(h.commands.some((entry) => entry.file.endsWith("fake-cli") && entry.args.join(" ") === "commands --json"), "the host asks the fake CLI for its own command list, without starting a turn");
  h.app.db.prepare("UPDATE agent_sessions SET runtime_id = ?, provider_id = ?, model_id = ? WHERE session_key = ?").run("codex", "openai", "gpt-x", sessionKey);
  await admin.call("jagentchill.chat.send", { sessionKey, message: "/review" });
  assert.equal((h.fake.callsOf("startTurn").at(-1) as { message: string; runtimeId: string }).message, "/review", "a Codex app-server slash prompt is sent unchanged without host context injection");
  assert.equal((h.fake.callsOf("startTurn").at(-1) as { runtimeId: string }).runtimeId, "codex");
  h.fake.endTurn(sessionKey);
  h.app.db.prepare("UPDATE agent_sessions SET runtime_id = ?, provider_id = ?, model_id = ? WHERE session_key = ?").run("claude-code", "anthropic", "sonnet", sessionKey);
  await admin.call("jagentchill.chat.send", { sessionKey, message: "/review this change" });
  assert.equal((h.fake.callsOf("startTurn").at(-1) as { message: string }).message, "/review this change", "a Claude Code slash prompt is sent unchanged without host context injection");
  h.fake.endTurn(sessionKey);

  h.app.db.prepare("UPDATE agent_sessions SET title = ? WHERE session_key = ?").run("Review [Attached file: old.png | image/png | blob:deadbeef]", sessionKey);
  assert.equal((await admin.call("jagentchill.session.get", { sessionKey })).session.title, "Review", "existing auto titles are cleaned when shown");

  assert.equal((await admin.fail("jagentchill.chat.attachment.create", { sessionKey, blobId: "a".repeat(64), name: "x.exe", mime: "application/x-msdownload", size: 1 })).code, "INVALID_PARAMS");
  assert.equal((await admin.fail("jagentchill.chat.attachment.create", { sessionKey, blobId: "a".repeat(64), name: "large.pdf", mime: "application/pdf", size: 50 * 1024 * 1024 + 1 })).code, "BLOB_TOO_LARGE");

  await admin.call("jagentchill.session.access.set", { sessionKey, access: "private" });
  const other = await h.pair("Other editor", "editor");
  assert.equal((await other.fail("jagentchill.chat.attachment.list", { sessionKey })).code, "NOT_FOUND");
  const viewer = await h.pair("Viewer", "viewer");
  await admin.call("jagentchill.session.access.set", { sessionKey, access: "host" });
  assert.equal((await viewer.call("jagentchill.chat.attachment.list", { sessionKey })).attachments.length, 3, "a session reader can view its attachment list");
  assert.equal((await viewer.fail("jagentchill.chat.attachment.create", { sessionKey, blobId: refs[0]!.blob.sha256, name: "copy.png", mime: "image/png", size: files[0]!.bytes.length })).code, "SCOPE_DENIED");
  assert.equal((await viewer.fail("jagentchill.chat.send", { sessionKey, message: "no", attachmentIds: [registered[0]!.attachmentId] })).code, "SCOPE_DENIED");
});

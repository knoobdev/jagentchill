// Test support: a real JAgentChill Server app in this process (no Gateway child — sync never needs it) and simulated
// DEVICES built from the real parts: the client SDK's pairing, connection and sync engine, the real storage port on
// fake-indexeddb + an in-memory OPFS (web) or on temporary directories (desktop, mobile), and the editor's real commit
// pipeline and save manager. Only the UI is absent: `Editor` below stands where the editor screen does.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const RESERVED_TEST_PORTS = [18935, 18937];
const activeTestPorts = new Set<number>();
import { acceptPatch, commitChange, createHistory, uuidV4, type Commit, type CommitContext, type StatePatch } from "@jagentchill/editor-core";
import { PROJECT_SCHEMA_VERSION, createProjectDocument, decodeOffer, encodeOfferUrl, type ProjectDocument } from "@jagentchill/protocol";
import { createServerApp, type ServerApp } from "@jagentchill/server/src/app.ts";
import { createProjectAutosave, loadProject, saveProject, serializeProjectRecord, type StoragePort } from "@jagentchill/storage";
import { platforms } from "../../../storage/test/support/platforms.ts";
import { beginEnrolment, connectHost, createSyncEngine, createWebCryptoSigner, generateDeviceKey, originOfAddress, type DeviceSigner, type HostConnection, type HostRecord, type SessionHooks, type SyncEngine } from "../../src/index.ts";

export const until = async (check: () => boolean | Promise<boolean>, message: string, timeout = 25000): Promise<void> => {
  const started = Date.now();
  while (!(await check())) { if (Date.now() - started > timeout) assert.fail(`timed out waiting for: ${message}`); await new Promise((resolve) => setTimeout(resolve, 15)); }
};
export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type Host = Awaited<ReturnType<typeof startHost>>;
export async function startHost(options: Parameters<typeof createServerApp>[0]["sync"] = {}) {
  const port = RESERVED_TEST_PORTS.find((candidate) => !activeTestPorts.has(candidate));
  if (port === undefined) throw new Error("No free w20b test port is available.");
  activeTestPorts.add(port);
  const dataRoot = process.env.W20B_TEST_DATA_ROOT;
  const dataDir = mkdtempSync(join(dataRoot ? join(process.cwd(), dataRoot) : tmpdir(), "client-host-"));
  process.env.JAGENTCHILL_PORT = String(port);
  process.env.JAGENTCHILL_GATEWAY_PORT = String(port + 1);
  const app: ServerApp = createServerApp({ dataDir, sync: options });
  await new Promise<void>((resolve, reject) => { app.http.once("error", reject); app.http.listen(port, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${port}`;
  const devices: Device[] = [];
  return {
    app, dataDir, origin,
    /** Pairs a new device through the real enrolment (offer, handshake, six-digit code) and connects it. */
    async device(name: string, role: "admin" | "editor" | "viewer", platform: "web" | "desktop" | "mobile" = "web"): Promise<Device> {
      const decoded = decodeOffer(encodeOfferUrl(app.pairing.createOffer([{ kind: "loopback", url: `ws://127.0.0.1:${port}/jagentchill/v1/ws` }], { rolePreset: role })));
      assert.ok(decoded.ok);
      const signer = await createWebCryptoSigner(await generateDeviceKey());
      const enrolment = await beginEnrolment(decoded.offer, originOfAddress(decoded.offer.addresses[0].url), signer, { deviceName: name, platform: platform === "web" ? "web" : platform === "desktop" ? "macos" : "ios", appVersion: "0.0.0", keyProtection: "webcrypto" });
      const host = await enrolment.submitCode(app.pairing.pending().find((request) => request.requestId === enrolment.requestId)!.code);
      const all = platforms(), opened = all[platform === "web" ? 0 : platform === "desktop" ? 1 : 2];
      const device = new Device(name, signer, host, await opened.open(), platform, opened.open);
      devices.push(device);
      await device.connect();
      return device;
    },
    async close(): Promise<void> {
      for (const device of devices) await device.shutdown();
      // Every channel socket is closed from the host side too, so that none outlives the test process.
      for (const record of app.devices.list()) app.channel.closeDevice(record.deviceId, 1001, "shutdown");
      await until(() => app.channel.connectionCount() === 0, "the channel sockets to close", 5000).catch(() => undefined);
      app.close();
      rmSync(dataDir, { recursive: true, force: true });
      activeTestPorts.delete(port);
    },
  };
}

/** What happened on a device's signed HTTP requests: every URL, and a switch that cuts the connection. */
export class Network {
  readonly requests: { method: string; url: string }[] = [];
  readonly sleeps: number[] = [];
  /** Requests whose URL matches fail as a lost connection while this returns true. */
  cut: ((method: string, url: string) => boolean) | null = null;
  /** A slow link: milliseconds a matching request waits before it is sent. */
  delay: ((method: string, url: string) => number) | null = null;
  /** Changes the bytes of a response before the device sees them. */
  tamper: ((url: string, bytes: Uint8Array) => Uint8Array) | null = null;
  readonly fetch: typeof fetch = async (input, init) => {
    const url = String(input), method = init?.method ?? "GET";
    this.requests.push({ method, url });
    if (this.cut?.(method, url)) throw new TypeError("fetch failed: connection lost");
    const wait = this.delay?.(method, url) ?? 0;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const response = await fetch(input, init);
    if (!this.tamper || !response.ok || method !== "GET") return response;
    const bytes = this.tamper(url, new Uint8Array(await response.arrayBuffer()));
    return new Response(bytes as never, { status: response.status, headers: response.headers });
  };
  /** Retry delays are recorded and skipped. */
  readonly sleep = async (ms: number): Promise<void> => { this.sleeps.push(ms); };
  count(method: string, pattern: RegExp): number { return this.requests.filter((request) => request.method === method && pattern.test(request.url)).length; }
}

export class Device {
  connection: HostConnection | undefined;
  readonly network = new Network();
  readonly sockets: string[] = [];
  readonly conflicts: string[] = [];
  engine: SyncEngine;
  storage: StoragePort;
  private editors = new Set<Editor>();
  private readonly instance = uuidV4();
  syncNewProjects = true;
  metered = false;
  private readonly reopen: () => Promise<StoragePort>;
  readonly name: string; readonly signer: DeviceSigner; readonly host: HostRecord; readonly platform: "web" | "desktop" | "mobile";

  constructor(name: string, signer: DeviceSigner, host: HostRecord, storage: StoragePort, platform: "web" | "desktop" | "mobile", reopen: () => Promise<StoragePort>) {
    this.name = name; this.signer = signer; this.host = host; this.platform = platform;
    this.storage = storage;
    this.reopen = reopen;
    this.engine = this.makeEngine();
  }
  private makeEngine(): SyncEngine {
    const engine = createSyncEngine({
      storage: this.storage, connection: () => this.connection, host: () => this.host, signer: async () => this.signer, deviceName: () => this.name, platform: this.platform,
      supportedSchemaVersion: { project: PROJECT_SCHEMA_VERSION, script: 1, workflow: 1 }, serialize: (document) => serializeProjectRecord(document as ProjectDocument), newId: () => uuidV4(),
      blob: { fetch: this.network.fetch, sleep: this.network.sleep }, prefs: { metered: () => this.metered },
    });
    engine.onConflict((projectId) => this.conflicts.push(projectId));
    return engine;
  }
  async connect(): Promise<void> {
    const url = `${this.host.origin.replace(/^http/, "ws")}/jagentchill/v1/ws`;
    this.sockets.push(url);
    // A close that arrives late must not take a newer connection for the one that closed.
    let live: HostConnection | undefined;
    live = await connectHost({ host: this.host, signer: this.signer, clientInstanceId: this.instance, onTokenRotated: () => undefined, onClose: () => { if (this.connection === live) { this.connection = undefined; this.engine.connectionChanged(); } } });
    this.connection = live;
    this.engine.connectionChanged();
  }
  /** The network goes away: the socket closes and HTTP requests fail. */
  async disconnect(): Promise<void> {
    const live = this.connection;
    this.network.cut = () => true;
    if (!live) return;
    live.close();
    this.connection = undefined;
    this.engine.connectionChanged();
  }
  async reconnect(): Promise<void> { this.network.cut = null; await this.connect(); }
  /** The app is terminated and started again: nothing in memory survives; the store and the pairing do. */
  async restart(options: { online?: boolean } = {}): Promise<void> {
    for (const editor of this.editors) editor.kill();
    this.editors.clear();
    this.engine.dispose();
    this.connection?.close();
    this.connection = undefined;
    this.storage = await this.reopen();
    this.engine = this.makeEngine();
    if (options.online !== false) await this.reconnect();
  }
  async shutdown(): Promise<void> { for (const editor of [...this.editors]) editor.kill(); this.engine.dispose(); this.connection?.close(); }

  context = (): CommitContext => ({ now_ms: Date.now(), newId: () => uuidV4() });
  /** "New project", saved to this device's store. */
  async createProject(name: string): Promise<string> {
    const ctx = this.context(), document = createProjectDocument({ id: ctx.newId(), mainSceneId: ctx.newId(), mainTrackId: ctx.newId(), now_ms: ctx.now_ms, name });
    await saveProject(this.storage, document);
    return document.metadata.id;
  }
  /** Opens a project the way the editor screen does: load, save manager, sync session. */
  async edit(projectId: string): Promise<Editor> {
    const loaded = await loadProject(this.storage, projectId), start = await this.engine.startRevision(projectId);
    const editor = new Editor(this, projectId, loaded.document, start.revision);
    this.editors.add(editor);
    await editor.session.resume();
    return editor;
  }
  forget(editor: Editor): void { this.editors.delete(editor); }
  stored = async (projectId: string): Promise<ProjectDocument> => (await loadProject(this.storage, projectId)).document;
}

/** The editing session of one project on one device: the commit pipeline, the undo history, the save manager and the sync session. */
export class Editor {
  document: ProjectDocument;
  readOnly: string | null = null;
  gesture = false;
  replaced: { label: string; revision: number }[] = [];
  followed: unknown[] = [];
  readonly autosave: ReturnType<typeof createProjectAutosave>;
  readonly session: ReturnType<SyncEngine["open"]>;
  readonly history = createHistory();
  private dead = false;
  readonly device: Device; readonly projectId: string;

  constructor(device: Device, projectId: string, document: ProjectDocument, revision: number) {
    this.device = device; this.projectId = projectId;
    this.document = document;
    this.autosave = createProjectAutosave({ port: device.storage, document, synced: () => device.engine.isSynced(projectId), revision });
    const hooks: SessionHooks = {
      flush: () => this.autosave.flush(),
      document: () => this.document,
      replace: (next, info) => { this.document = { ...(next as ProjectDocument), ...((this.document as { local?: unknown }).local !== undefined ? { local: (this.document as { local?: unknown }).local } : {}) } as ProjectDocument; this.autosave.replace(this.document); this.history.clear(); this.replaced.push(info); },
      rebase: (next) => this.autosave.rebase(next),
      setReadOnly: (reason) => { this.readOnly = reason; },
      busy: () => this.gesture,
      applyStep: (patches, label) => { try { this.record({ document: acceptPatch(this.document, patches as StatePatch), patch: patches as StatePatch, commandType: "sync.applyRemote", label, history: true, nearSizeLimit: false }); return true; } catch { return false; } },
      follow: (position) => { this.followed.push(position); },
    };
    this.session = device.engine.open(projectId, hooks);
  }
  private record(commit: Commit): void {
    const before = this.document, result = this.autosave.commit(commit);
    this.history.record(before, { ...commit, document: result.document, patch: result.patch });
    this.document = result.document;
    if (result.patch.length > 0) this.session.noteCommit();
  }
  /** One committed command. A view-only editor changes nothing. */
  commit(make: (document: ProjectDocument, context: CommitContext) => Commit): boolean {
    if (this.readOnly !== null) return false;
    this.record(make(this.document, this.device.context()));
    return true;
  }
  /** A direct change through the commit pipeline, for edits no named command exists for in these tests. */
  change(label: string, mutate: (draft: any) => void): boolean { return this.commit((document, context) => commitChange(document, context, { commandType: "test.change", label }, mutate)); }
  undo(): boolean {
    const move = this.history.undo(this.document, (document, patch) => acceptPatch(document, patch));
    if (!move) return false;
    const result = this.autosave.commit({ document: move.document, patch: move.patch, commandType: "history.undo", label: `Undo ${move.label}` });
    this.document = result.document;
    this.session.noteCommit();
    return true;
  }
  get status() { return this.session.state.status; }
  /** Exit project: flush, release the lease. */
  async close(): Promise<void> { if (this.dead) return; this.dead = true; await this.autosave.flush().catch(() => undefined); await this.session.close(); this.autosave.stop(); this.device.forget(this); }
  /** The process dies: nothing is flushed, nothing is released. */
  kill(): void { this.dead = true; this.autosave.stop(); this.session.abandon(); this.device.forget(this); }
}

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { LocalInstall, LocalModelQuant, LocalModelVariant } from "@jagentchill/protocol";
import type { LocalFile } from "./manifest.ts";
import { unzip } from "./unzip.ts";

/** What is kept across restarts: each variant's install, and which files were verified whole. */
export type DownloadState = {
  installs: Partial<Record<LocalModelVariant, { quant: LocalModelQuant; modelId: string; state: LocalInstall["state"]; files: string[]; started_ms: number; updated_ms: number; installed_ms?: number; verified_ms?: number; error?: LocalInstall["error"]; /** The quant this download replaces: its picture model is removed once this one is installed. */ replacing?: LocalModelQuant }>>;
  verified: Record<string, { verified_ms: number }>;
};
export type DownloadDeps = {
  folder: string; now: () => number;
  /** The engine program the app ships; used when no engine file was downloaded. */
  bundledEngine?: string;
  fetch?: typeof fetch;
  load(): DownloadState | undefined; save(state: DownloadState): void;
  /** Something changed that a screen shows (the caller throttles what it sends). */
  changed(): void;
  /** Every file the manifest knows, by id. */
  file(id: string): LocalFile | undefined;
  /** The id of the picture model of a variant at a quant. */
  diffusionId(variant: LocalModelVariant, quant: LocalModelQuant): string;
  /** Test only: the waits between attempts, and how long a download may receive nothing before it is tried again. */
  timings?: { retryDelaysMs?: number[]; stallMs?: number };
};

class Failure extends Error {
  readonly code: NonNullable<LocalInstall["error"]>["code"]; readonly retry: boolean;
  constructor(code: NonNullable<LocalInstall["error"]>["code"], message: string, retry = false) { super(message); this.code = code; this.retry = retry; }
}
const MESSAGES = {
  network: "The download was interrupted and could not be resumed. Check the connection, then press Resume.",
  hash_mismatch: "A downloaded file is damaged (its checksum does not match). It was removed. Press Resume to download it again.",
  disk_full: "The disk is full. Free some space, then press Resume.",
  extract: "The engine archive could not be unpacked.",
} as const;

/**
 * The downloads of the local models: one file at a time over HTTP, resumed with a `Range` request from what is already
 * on disk (`<file>.part`) after a pause, a restart of the host or a broken connection (retried with growing waits, a
 * connection that delivers nothing for a minute counts as broken), then verified against its SHA-256 before it takes
 * its name. A file two variants need (the text encoder, the decoder, the engine) is downloaded once and kept while
 * either uses it. Pause keeps the partial file; Cancel and Remove delete what no other install uses.
 */
export function createDownloads(deps: DownloadDeps) {
  const http = deps.fetch ?? fetch, delays = deps.timings?.retryDelaysMs ?? [1000, 3000, 10_000, 30_000, 60_000, 60_000, 60_000], stallMs = deps.timings?.stallMs ?? 60_000;
  let state: DownloadState = { installs: {}, verified: {}, ...deps.load() };
  const pathOf = (file: LocalFile) => join(deps.folder, file.path);
  /** Bytes of the file being downloaded right now, and the samples the rate is taken from. */
  const live = new Map<string, number>(), samples = new Map<LocalModelVariant, { at: number; bytes: number }[]>();
  let active: { variant: LocalModelVariant; abort: AbortController } | undefined, working = false, closed = false;
  const save = () => deps.save(state);
  const record = (variant: LocalModelVariant) => state.installs[variant];
  const touch = (variant: LocalModelVariant, patch: Partial<NonNullable<DownloadState["installs"][LocalModelVariant]>>) => {
    const current = record(variant);
    if (!current) return;
    state = { ...state, installs: { ...state.installs, [variant]: { ...current, ...patch, updated_ms: deps.now() } } };
    save(); deps.changed();
  };
  // A host that stopped in the middle of a download finds it paused, its partial file kept; an install whose files went missing says so.
  for (const [variant, install] of Object.entries(state.installs) as [LocalModelVariant, NonNullable<DownloadState["installs"][LocalModelVariant]>][]) {
    if (install.state === "downloading" || install.state === "verifying") state.installs[variant] = { ...install, state: "paused" };
    if (install.state === "installed" && install.files.some((id) => { const file = deps.file(id); return !file || !existsSync(pathOf(file)); })) state.installs[variant] = { ...install, state: "failed", error: { code: "network", message: "Files of this model are missing from the models folder. Press Resume to download them again." } };
  }
  save();

  const onDisk = (id: string): boolean => { const file = deps.file(id); return !!file && !!state.verified[id] && existsSync(pathOf(file)) && statSync(pathOf(file)).size === file.bytes; };
  const partBytes = (file: LocalFile): number => { try { return statSync(`${pathOf(file)}.part`).size; } catch { return 0; } };
  /** Files a variant other than `except` still needs (installed, or on its way). */
  const usedElsewhere = (id: string, except: LocalModelVariant) => Object.entries(state.installs).some(([variant, install]) => variant !== except && install?.files.includes(id));

  async function hashOf(path: string): Promise<string> {
    const hash = createHash("sha256");
    await pipeline(createReadStream(path), hash);
    return hash.digest("hex");
  }
  /** One attempt at the rest of a file: from the end of its partial file when the server can send a range. */
  async function receive(file: LocalFile, variant: LocalModelVariant, signal: AbortSignal): Promise<void> {
    const part = `${pathOf(file)}.part`;
    mkdirSync(dirname(part), { recursive: true });
    let have = partBytes(file);
    if (have > file.bytes) { rmSync(part, { force: true }); have = 0; }
    if (have === file.bytes) return;
    const stall = new AbortController(), both = AbortSignal.any([signal, stall.signal]);
    let timer = setTimeout(() => stall.abort("stalled"), stallMs);
    const fresh = () => { clearTimeout(timer); timer = setTimeout(() => stall.abort("stalled"), stallMs); };
    try {
      const response = await http(file.url, { headers: have ? { range: `bytes=${have}-` } : {}, signal: both, redirect: "follow" });
      if (response.status === 416) { rmSync(part, { force: true }); throw new Failure("network", MESSAGES.network, true); }
      if (response.status === 429 || response.status >= 500) throw new Failure("network", MESSAGES.network, true);
      if (response.status !== 200 && response.status !== 206) throw new Failure("http", `The download server answered ${response.status}.`);
      // A server that ignores the range sends the whole file again: it is written from the start.
      const resumed = response.status === 206 && new RegExp(`^bytes ${have}-`).test(response.headers.get("content-range") ?? "");
      if (!resumed) have = 0;
      if (!response.body) throw new Failure("network", MESSAGES.network, true);
      let received = have;
      live.set(file.id, received);
      const counted = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
      counted.on("data", (chunk: Buffer) => {
        fresh(); received += chunk.length; live.set(file.id, received);
        const list = samples.get(variant) ?? []; list.push({ at: deps.now(), bytes: chunk.length }); while (list.length && list[0]!.at < deps.now() - 4000) list.shift(); samples.set(variant, list);
        deps.changed();
      });
      await pipeline(counted, createWriteStream(part, { flags: resumed ? "a" : "w" }), { signal: both });
      if (received !== file.bytes) throw new Failure("network", MESSAGES.network, true);
    } catch (error) {
      if (error instanceof Failure) throw error;
      if ((error as NodeJS.ErrnoException)?.code === "ENOSPC") throw new Failure("disk_full", MESSAGES.disk_full);
      if (signal.aborted) throw error;
      throw new Failure("network", MESSAGES.network, true);
    } finally { clearTimeout(timer); live.delete(file.id); }
  }
  /** A file to its verified place: downloaded (with retries), its hash checked, an archive unpacked. */
  async function fetchFile(file: LocalFile, variant: LocalModelVariant, signal: AbortSignal): Promise<void> {
    if (onDisk(file.id)) return;
    let damaged = 0;
    for (let attempt = 0; ; attempt++) {
      try {
        await receive(file, variant, signal);
        touch(variant, { state: "verifying" });
        const part = `${pathOf(file)}.part`, digest = await hashOf(part);
        if (signal.aborted) throw signal.reason;
        if (digest !== file.sha256) {
          rmSync(part, { force: true });
          // Downloaded twice and damaged twice: it is said, not tried forever.
          if (++damaged > 1) throw new Failure("hash_mismatch", MESSAGES.hash_mismatch);
          if (record(variant)?.state === "verifying") touch(variant, { state: "downloading" });
          continue;
        }
        renameSync(part, pathOf(file));
        if (file.unpackTo) {
          const into = join(deps.folder, file.unpackTo);
          try { await unzip(pathOf(file), into); } catch (error) { throw new Failure("extract", `${MESSAGES.extract} ${error instanceof Error ? error.message : ""}`.trim()); }
        }
        state = { ...state, verified: { ...state.verified, [file.id]: { verified_ms: deps.now() } } };
        save();
        if (record(variant)?.state === "verifying") touch(variant, { state: "downloading" });
        return;
      } catch (error) {
        if (signal.aborted) throw error;
        if (!(error instanceof Failure) || !error.retry || attempt >= delays.length) throw error instanceof Failure ? error : new Failure("network", MESSAGES.network);
        await new Promise<void>((resolve) => { const wait = setTimeout(resolve, delays[attempt]); signal.addEventListener("abort", () => { clearTimeout(wait); resolve(); }, { once: true }); });
        if (signal.aborted) throw signal.reason;
      }
    }
  }
  /** The one worker: the installs that are downloading, one file at a time, in the order they were started. */
  async function work(): Promise<void> {
    if (working || closed) return;
    working = true;
    try {
      for (;;) {
        const next = (Object.entries(state.installs) as [LocalModelVariant, NonNullable<DownloadState["installs"][LocalModelVariant]>][]).filter(([, install]) => install.state === "downloading").sort((a, b) => a[1].started_ms - b[1].started_ms)[0];
        if (!next || closed) return;
        const [variant, install] = next, abort = new AbortController();
        active = { variant, abort };
        try {
          for (const id of install.files) { const file = deps.file(id); if (!file) throw new Failure("http", `Unknown file ${id}.`); await fetchFile(file, variant, abort.signal); }
          const replaced = record(variant)!.replacing;
          touch(variant, { state: "installed", installed_ms: deps.now(), verified_ms: deps.now(), error: undefined, replacing: undefined });
          // The quant this one replaces: its picture model goes, unless another install uses it.
          if (replaced) { const id = deps.diffusionId(variant, replaced); if (!usedElsewhere(id, variant)) deleteFile(id); }
        } catch (error) {
          if (abort.signal.aborted) { if (record(variant)?.state === "downloading") touch(variant, {}); continue; }
          const failure = error instanceof Failure ? error : new Failure("network", MESSAGES.network);
          touch(variant, { state: "failed", error: { code: failure.code, message: failure.message } });
        } finally { active = undefined; samples.delete(variant); }
      }
    } finally { working = false; }
  }
  function deleteFile(id: string): void {
    const file = deps.file(id);
    if (!file) return;
    rmSync(pathOf(file), { force: true }); rmSync(`${pathOf(file)}.part`, { force: true });
    if (file.unpackTo) rmSync(join(deps.folder, file.unpackTo), { recursive: true, force: true });
    // Folders left empty go too, up to the models folder.
    for (const start of [dirname(pathOf(file)), ...(file.unpackTo ? [dirname(join(deps.folder, file.unpackTo))] : [])]) {
      for (let dir = start; dir.startsWith(deps.folder) && dir !== deps.folder; dir = dirname(dir)) { try { if (readdirSync(dir).length) break; rmdirSync(dir); } catch { break; } }
    }
    const { [id]: _gone, ...rest } = state.verified;
    state = { ...state, verified: rest };
    save();
  }
  /** Removes an install and every file of it no other install uses (`keep`: files that stay whatever happens). */
  function drop(variant: LocalModelVariant, keep: readonly string[] = []): void {
    const install = record(variant);
    if (!install) return;
    if (active?.variant === variant) active.abort.abort("cancelled");
    const { [variant]: _dropped, ...rest } = state.installs;
    state = { ...state, installs: rest };
    const ids = [...install.files, ...(install.replacing ? [deps.diffusionId(variant, install.replacing)] : [])];
    for (const id of ids) if (!keep.includes(id) && !usedElsewhere(id, variant)) deleteFile(id);
    save(); deps.changed();
  }
  /**
   * Stops a download and deletes what it brought. A download that was replacing an installed quant goes back to that
   * quant (it is still on disk, with everything it needs); otherwise the install is gone.
   */
  function cancel(variant: LocalModelVariant): void {
    const install = record(variant);
    if (!install || install.state === "installed") return;
    const back = install.replacing;
    if (!back) return drop(variant);
    const keepIds = install.files.filter((id) => deps.file(id)?.role !== "diffusion").concat(deps.diffusionId(variant, back));
    drop(variant, keepIds);
    state = { ...state, installs: { ...state.installs, [variant]: { ...install, quant: back, state: "installed", files: install.files.map((id) => (deps.file(id)?.role === "diffusion" ? deps.diffusionId(variant, back) : id)), updated_ms: deps.now(), error: undefined, replacing: undefined } } };
    save(); deps.changed();
  }

  return {
    onDisk,
    /** Starts (or switches to) a download of this variant at this quant; a quant already installed stays until the new one is ready. */
    start(variant: LocalModelVariant, quant: LocalModelQuant, modelId: string, files: LocalFile[]): void {
      const current = record(variant);
      if (current?.quant === quant) {
        if (current.state === "paused" || current.state === "failed") { touch(variant, { state: "downloading", error: undefined }); void work(); }
        return;
      }
      // Another quant: an installed one keeps serving until this one is ready; one that was on its way is abandoned (what it brought is deleted).
      let replacing = current?.state === "installed" ? current.quant : current?.replacing;
      if (current && current.state !== "installed") {
        if (active?.variant === variant) active.abort.abort("switched");
        const abandoned = deps.diffusionId(variant, current.quant);
        if (abandoned !== (replacing && deps.diffusionId(variant, replacing)) && !usedElsewhere(abandoned, variant)) deleteFile(abandoned);
      }
      if (replacing === quant) {
        // Back to the quant that is installed: nothing to download.
        state = { ...state, installs: { ...state.installs, [variant]: { ...current!, quant, state: "installed", files: files.map((file) => file.id), updated_ms: deps.now(), error: undefined, replacing: undefined } } };
        save(); deps.changed();
        return;
      }
      if (replacing && !onDisk(deps.diffusionId(variant, replacing))) replacing = undefined;
      state = { ...state, installs: { ...state.installs, [variant]: { quant, modelId, state: "downloading", files: files.map((file) => file.id), started_ms: deps.now(), updated_ms: deps.now(), ...(replacing ? { replacing } : {}) } } };
      save(); deps.changed();
      void work();
    },
    pause(variant: LocalModelVariant): void {
      const install = record(variant);
      if (!install || (install.state !== "downloading" && install.state !== "verifying")) return;
      touch(variant, { state: "paused" });
      if (active?.variant === variant) active.abort.abort("paused");
    },
    resume(variant: LocalModelVariant): void {
      const install = record(variant);
      if (!install || (install.state !== "paused" && install.state !== "failed")) return;
      touch(variant, { state: "downloading", error: undefined });
      void work();
    },
    cancel, remove: (variant: LocalModelVariant): void => drop(variant),
    /** Every file of an installed variant hashed again; a file that does not match is removed and the install says so. */
    async verify(variant: LocalModelVariant): Promise<{ ok: boolean; damaged: string[] }> {
      const install = record(variant);
      if (!install || install.state !== "installed") return { ok: false, damaged: [] };
      touch(variant, { state: "verifying" });
      const damaged: string[] = [];
      for (const id of install.files) {
        const file = deps.file(id);
        if (!file) continue;
        const ok = existsSync(pathOf(file)) && (await hashOf(pathOf(file))) === file.sha256;
        if (!ok) { damaged.push(file.label); deleteFile(id); }
      }
      if (damaged.length) touch(variant, { state: "failed", error: { code: "hash_mismatch", message: MESSAGES.hash_mismatch } });
      else touch(variant, { state: "installed", verified_ms: deps.now() });
      return { ok: !damaged.length, damaged };
    },
    /** The installs as a screen shows them. */
    view(): LocalInstall[] {
      return (Object.entries(state.installs) as [LocalModelVariant, NonNullable<DownloadState["installs"][LocalModelVariant]>][]).map(([variant, install]) => {
        const files = install.files.flatMap((id) => { const file = deps.file(id); return file ? [file] : []; }).map((file) => {
          const done = onDisk(file.id), now = live.get(file.id);
          const doneBytes = done ? file.bytes : now ?? partBytes(file);
          return { id: file.id, label: file.label, bytes: file.bytes, doneBytes, state: done ? "done" as const : now !== undefined ? "downloading" as const : install.state === "failed" && install.error?.code === "hash_mismatch" ? "failed" as const : install.state === "verifying" && active?.variant === variant ? "verifying" as const : "waiting" as const };
        });
        const rate = (samples.get(variant) ?? []).reduce((sum, sample) => sum + sample.bytes, 0) / 4;
        return {
          variant, quant: install.quant, modelId: install.modelId, state: install.state, bytesDone: files.reduce((sum, file) => sum + file.doneBytes, 0), bytesTotal: files.reduce((sum, file) => sum + file.bytes, 0),
          ...(install.state === "downloading" && rate > 0 ? { rateBps: Math.round(rate) } : {}), files, ...(install.error ? { error: install.error } : {}),
          started_ms: install.started_ms, updated_ms: install.updated_ms, ...(install.installed_ms ? { installed_ms: install.installed_ms } : {}), ...(install.verified_ms ? { verified_ms: install.verified_ms } : {}),
        };
      });
    },
    /** The files of an installed variant, by role, and the engine's program; undefined while it is not installed. */
    installed(variant: LocalModelVariant): { quant: LocalModelQuant; modelId: string; diffusion: string; llm: string; vae: string; engine: string | undefined } | undefined {
      const install = record(variant);
      // While another quant downloads, the installed one keeps serving.
      const quant = install?.state === "installed" ? install.quant : install?.replacing;
      if (!install || !quant) return undefined;
      const files = install.files.map((id) => deps.file(id)).filter((file): file is LocalFile => !!file);
      const diffusionId = deps.diffusionId(variant, quant), diffusion = deps.file(diffusionId);
      const by = (role: LocalFile["role"]) => files.find((file) => file.role === role);
      if (!diffusion || !onDisk(diffusionId)) return undefined;
      const engineFile = by("engine"), llm = by("llm"), vae = by("vae");
      if (!llm || !vae || !onDisk(llm.id) || !onDisk(vae.id)) return undefined;
      return { quant, modelId: install.modelId, diffusion: pathOf(diffusion), llm: pathOf(llm), vae: pathOf(vae), engine: engineFile?.unpackTo ? findProgram(join(deps.folder, engineFile.unpackTo)) : deps.bundledEngine };
    },
    state: () => state,
    close(): void { closed = true; active?.abort.abort("closed"); },
  };
}

/** The engine's command-line program in an unpacked build (`sd-cli`, called `sd` by older releases). */
export function findProgram(folder: string): string | undefined {
  const names = process.platform === "win32" ? ["sd-cli.exe", "sd.exe"] : ["sd-cli", "sd"];
  const walk = (dir: string, depth: number): string | undefined => {
    let entries: import("node:fs").Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return undefined; }
    for (const name of names) if (entries.some((entry) => entry.isFile() && entry.name === name)) return join(dir, name);
    if (depth > 2) return undefined;
    for (const entry of entries) if (entry.isDirectory()) { const found = walk(join(dir, entry.name), depth + 1); if (found) return found; }
    return undefined;
  };
  return walk(folder, 0);
}

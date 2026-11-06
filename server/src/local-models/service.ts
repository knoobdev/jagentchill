import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import type { z } from "zod";
import {
  LOCAL_MODEL_IDS, LOCAL_MODEL_QUANTS, LOCAL_MODEL_VARIANTS, LOCAL_MODELS_CHANGED, LOCAL_MODELS_METHOD_SCOPES, localModelsRpcParams,
  type LocalHardware, type LocalModelQuant, type LocalModelVariant, type LocalModelsView, type Scope,
} from "@jagentchill/protocol";
import type { DatabaseSync } from "node:sqlite";
import type { Connection, RpcMethod } from "../channel/ws-channel.ts";
import { ProtocolError } from "../errors.ts";
import type { JcProviderAdapter } from "../generation/adapter.ts";
import { audit } from "../store/database.ts";
import type { ServerConfigFile } from "../store/server-config.ts";
import { createLocalImageAdapter } from "./adapter.ts";
import { createDownloads, type DownloadState } from "./downloads.ts";
import { readHardware, systemProbe, verdictFor, verdictsOf, type HardwareProbe } from "./hardware.ts";
import { QUANT_LABEL, QWEN_IMAGE_MANIFEST, engineKey, filesOf, type LocalFile, type LocalManifest } from "./manifest.ts";

export type LocalModelsDeps = {
  db: DatabaseSync; config: ServerConfigFile; dataDir: string; now: () => number;
  broadcast: (scope: Scope, event: string, stream: string, payload: unknown, filter?: (connection: Connection) => boolean) => void;
  /** Where the models are kept; `<dataDir>/models` by default. */
  folder?: string;
  /** Test only: another manifest (files of a local test server), another reading of the hardware, another network. */
  manifest?: LocalManifest; probe?: HardwareProbe; fetch?: typeof fetch; timings?: { retryDelaysMs?: number[]; stallMs?: number; changedMs?: number };
  /**
   * The engine program the app ships (`JAGENTCHILL_SD_ENGINE`): the macOS desktop app carries its own build of
   * stable-diffusion.cpp for macOS 14 and later — the published macOS build needs macOS 26. With it nothing of the
   * engine is downloaded; only the model files are.
   */
  bundledEngine?: string;
};
type Stored = { downloads?: DownloadState; hardware?: LocalHardware; settings?: Partial<LocalModelsView["settings"]> };
const DEFAULT_SETTINGS: LocalModelsView["settings"] = { maxSide: 1024, timeLimitMinutes: 30 };

/**
 * The models that run on the host (Settings ▸ Providers ▸ Generation ▸ Local models): the hardware check, the
 * downloads of Qwen-Image-2.1 and its engine, and the generation provider that uses them. Nothing is downloaded until
 * a person asks; what was downloaded, and how far, survives a restart of the host.
 */
export function createLocalModels(deps: LocalModelsDeps) {
  const manifest = deps.manifest ?? QWEN_IMAGE_MANIFEST, probe = deps.probe ?? systemProbe, folder = deps.folder ?? join(deps.dataDir, "models");
  const stored = (): Stored => deps.config.get<Stored>("localModels") ?? {};
  const save = (patch: Partial<Stored>) => deps.config.set("localModels", { ...stored(), ...patch });
  // Measured on an Apple M1 Pro (2026-10-19): 512 px at 12 steps takes about 4.5 min, 1024 px more than 25 min. On
  // Apple graphics the default picture is therefore the small one; a person can still choose a larger size.
  const settings = (): LocalModelsView["settings"] => ({ ...DEFAULT_SETTINGS, ...(stored().hardware?.gpu.kind === "apple" ? { maxSide: 512 } : {}), ...stored().settings });
  const byId = new Map<string, LocalFile>([...Object.values(manifest.engine.builds).flatMap((build) => build.files), ...Object.values(manifest.variants).flatMap((variant) => Object.values(variant.quants)), ...manifest.shared].map((file) => [file.id, file]));
  let generating = false, installedBefore = "", pending: ReturnType<typeof setTimeout> | undefined, onInstalled: (() => void) | undefined;
  const changedMs = deps.timings?.changedMs ?? 300;
  /** The screens are told at most every few hundred ms; the generation catalogue when what is installed changed. */
  function changed(): void {
    const now = installedKey();
    if (now !== installedBefore) { installedBefore = now; onInstalled?.(); ensureAddOns(); }
    if (pending) return;
    pending = setTimeout(() => { pending = undefined; deps.broadcast("jagentchill.config.read", LOCAL_MODELS_CHANGED, "localModels", { view: view() }); }, changedMs);
    pending.unref?.();
  }
  const envEngine = process.env.JAGENTCHILL_SD_ENGINE;
  const bundledEngine = deps.bundledEngine ?? (envEngine && existsSync(envEngine) ? envEngine : undefined);
  const downloads = createDownloads({
    folder, now: deps.now, ...(bundledEngine ? { bundledEngine } : {}), ...(deps.fetch ? { fetch: deps.fetch } : {}), ...(deps.timings ? { timings: deps.timings } : {}),
    load: () => stored().downloads, save: (state) => save({ downloads: state }), changed, file: (id) => byId.get(id),
    diffusionId: (variant, quant) => manifest.variants[variant].quants[quant].id,
  });
  const installedKey = () => LOCAL_MODEL_VARIANTS.map((variant) => (downloads.installed(variant)?.engine ? `${variant}:${downloads.installed(variant)!.quant}` : "")).join(",");
  installedBefore = installedKey();
  const buildOf = (hardware: LocalHardware | undefined) => engineKey(hardware?.platform ?? probe.platform, hardware?.arch ?? probe.arch, hardware?.gpu.kind === "nvidia");
  /** The engine build to download: none when the app ships its own engine. */
  const downloadBuildOf = (hardware: LocalHardware | undefined) => (bundledEngine ? undefined : buildOf(hardware));
  async function check(): Promise<LocalHardware> {
    const hardware = await readHardware(folder, probe, deps.now());
    save({ hardware });
    changed();
    return hardware;
  }
  function view(): LocalModelsView {
    const hardware = stored().hardware ?? null, build = downloadBuildOf(hardware ?? undefined), engineFiles = build ? manifest.engine.builds[build]?.files ?? [] : [];
    return {
      folder, license: manifest.license,
      engine: { name: manifest.engine.name, version: manifest.engine.version, sourceUrl: manifest.engine.sourceUrl, build: bundledEngine ? { label: "Included with the app", bytes: 0 } : build && engineFiles.length ? { label: manifest.engine.builds[build]!.label, bytes: engineFiles.reduce((sum, file) => sum + file.bytes, 0) } : null },
      variants: LOCAL_MODEL_VARIANTS.map((variant) => ({
        id: variant, label: manifest.variants[variant].label, description: manifest.variants[variant].description, modelId: LOCAL_MODEL_IDS[variant],
        quants: LOCAL_MODEL_QUANTS.map((quant) => ({ id: quant, label: `${QUANT_LABEL[quant]} · ${manifest.variants[variant].quants[quant].label.replace(/^.*\((.*)\)$/, "$1")}`, downloadBytes: filesOf(manifest, variant, quant, build).reduce((sum, file) => sum + file.bytes, 0) })),
      })),
      installs: downloads.view(), hardware, verdicts: hardware ? verdictsOf(hardware, manifest, downloads.onDisk) : [], settings: settings(), generating,
      addOns: addOnsView(),
    };
  }

  /**
   * The files an installed variant fetches by itself (the uncensored build's text encoder, 5 GB, and its LoRA, 33 MB):
   * one at a time, resumed with a Range request after a broken connection or a restart, kept only when the SHA-256
   * matches. Until a file is ready the picture is made without it (the shared text encoder, no LoRA).
   */
  type AddOn = { key: string; variant: LocalModelVariant; label: string; url: string; bytes: number; sha256: string; path: string };
  const addOnsOf = (variant: LocalModelVariant): AddOn[] => {
    const entry = manifest.variants[variant];
    return [
      ...(entry.encoder ? [{ key: `${variant}:encoder`, variant, label: entry.encoder.label, url: entry.encoder.url, bytes: entry.encoder.bytes, sha256: entry.encoder.sha256, path: join(folder, entry.encoder.path) }] : []),
      ...(entry.lora ? [{ key: `${variant}:lora`, variant, label: "Uncensored LoRA", url: entry.lora.url, bytes: entry.lora.bytes, sha256: entry.lora.sha256, path: join(folder, dirname(entry.lora.path), `${entry.lora.name}.safetensors`) }] : []),
    ];
  };
  const addOnState = new Map<string, { state: "downloading" | "ready" | "failed"; bytesDone: number; error?: string }>();
  let addOnQueue: Promise<void> = Promise.resolve();
  const addOnQueued = new Set<string>();
  async function fetchAddOn(addOn: AddOn): Promise<void> {
    const part = `${addOn.path}.part`;
    mkdirSync(dirname(addOn.path), { recursive: true });
    for (let attempt = 0; attempt < 5; attempt++) {
      let have = existsSync(part) ? statSync(part).size : 0;
      if (have > addOn.bytes) { rmSync(part, { force: true }); have = 0; }
      addOnState.set(addOn.key, { state: "downloading", bytesDone: have });
      changed();
      try {
        if (have < addOn.bytes) {
          const response = await (deps.fetch ?? fetch)(addOn.url, { redirect: "follow", headers: have ? { range: `bytes=${have}-` } : {} });
          if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
          if (have && response.status !== 206) { rmSync(part, { force: true }); have = 0; }
          const out = createWriteStream(part, { flags: have ? "a" : "w" });
          let done = have, told = 0;
          for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
            if (!out.write(chunk)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
            done += chunk.length;
            if (done - told > 16 * 1024 * 1024) { told = done; addOnState.set(addOn.key, { state: "downloading", bytesDone: done }); changed(); }
          }
          await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
        }
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(part)) hash.update(chunk as Buffer);
        if (statSync(part).size !== addOn.bytes || hash.digest("hex") !== addOn.sha256) { rmSync(part, { force: true }); throw new Error("The file did not match its checksum."); }
        renameSync(part, addOn.path);
        addOnState.set(addOn.key, { state: "ready", bytesDone: addOn.bytes });
        changed();
        return;
      } catch (error) {
        addOnState.set(addOn.key, { state: "failed", bytesDone: existsSync(part) ? statSync(part).size : 0, error: error instanceof Error ? error.message : String(error) });
        changed();
        await new Promise((resolve) => setTimeout(resolve, 5_000 * (attempt + 1)));
      }
    }
  }
  /** Starts what an installed variant still needs (smallest first); a no-op for what is ready or on its way. */
  function ensureAddOns(): void {
    for (const variant of LOCAL_MODEL_VARIANTS) {
      if (!downloads.installed(variant)) continue;
      for (const addOn of addOnsOf(variant).sort((a, b) => a.bytes - b.bytes)) {
        if (existsSync(addOn.path)) { addOnState.set(addOn.key, { state: "ready", bytesDone: addOn.bytes }); continue; }
        if (addOnQueued.has(addOn.key)) continue;
        addOnQueued.add(addOn.key);
        addOnQueue = addOnQueue.then(() => fetchAddOn(addOn)).catch(() => undefined).finally(() => addOnQueued.delete(addOn.key));
      }
    }
  }
  const readyAddOn = (variant: LocalModelVariant, kind: "encoder" | "lora") => addOnsOf(variant).find((addOn) => addOn.key === `${variant}:${kind}` && existsSync(addOn.path));
  function addOnsView(): NonNullable<LocalModelsView["addOns"]> {
    return LOCAL_MODEL_VARIANTS.flatMap((variant) => (downloads.installed(variant) ? addOnsOf(variant) : []).map((addOn) => {
      const now = existsSync(addOn.path) ? { state: "ready" as const, bytesDone: addOn.bytes } : addOnState.get(addOn.key) ?? { state: "downloading" as const, bytesDone: 0 };
      return { variant, label: addOn.label, state: now.state, bytesDone: now.bytesDone, bytesTotal: addOn.bytes, ...("error" in now && now.error ? { error: now.error } : {}) };
    }));
  }
  async function loraOf(variant: LocalModelVariant): Promise<{ dir: string; name: string; weight: number } | undefined> {
    const lora = manifest.variants[variant].lora;
    ensureAddOns();
    return lora && readyAddOn(variant, "lora") ? { dir: join(folder, dirname(lora.path)), name: lora.name, weight: lora.weight } : undefined;
  }
  // What an installed variant still needs is fetched once the host is up.
  setTimeout(() => ensureAddOns(), 3_000).unref?.();
  const adapter: JcProviderAdapter = createLocalImageAdapter({
    installed: (variant) => downloads.installed(variant),
    settings,
    offload: (variant) => {
      const hardware = stored().hardware, install = downloads.installed(variant);
      if (!hardware || !install) return true;
      // On Apple Silicon a model that fits with room to spare stays where it is; an NVIDIA card keeps only what it runs now (the text encoder leaves it).
      return !(hardware.gpu.kind === "apple" && verdictFor(verdictsOf(hardware, manifest, downloads.onDisk), variant, install.quant as LocalModelQuant)?.verdict === "well");
    },
    workDir: join(deps.dataDir, "tmp"),
    lora: (variant) => loraOf(variant),
    encoder: (variant) => readyAddOn(variant, "encoder")?.path,
    busy: (on) => { generating = on; changed(); },
  });

  const methods = new Map<string, RpcMethod>();
  type Name = keyof typeof localModelsRpcParams;
  function method<N extends Name>(name: N, handle: (params: z.infer<(typeof localModelsRpcParams)[N]>, connection: Connection) => unknown) {
    methods.set(name, { scope: LOCAL_MODELS_METHOD_SCOPES[name], handle: (raw, connection) => {
      const parsed = localModelsRpcParams[name].safeParse(raw ?? {});
      if (!parsed.success) throw new ProtocolError("INVALID_PARAMS", "The parameters do not match the expected shape.", { details: { path: parsed.error.issues[0]?.path.join(".") ?? "" } });
      return handle(parsed.data as z.infer<(typeof localModelsRpcParams)[N]>, connection);
    } });
  }
  const done = (connection: Connection, action: string, detail: Record<string, unknown>) => { audit(deps.db, deps.now(), `device:${connection.deviceId}`, `localModels.${action}`, detail); return { view: view() }; };
  method("jagentchill.localModels.get", () => ({ view: view() }));
  method("jagentchill.localModels.check", async () => { await check(); return { view: view() }; });
  method("jagentchill.localModels.download", async (p, connection) => {
    // The check comes first: its verdict is shown before anything is downloaded, and a download it says cannot work is refused.
    const hardware = await check(), build = buildOf(hardware);
    const verdict = verdictFor(verdictsOf(hardware, manifest, downloads.onDisk), p.variant, p.quant);
    if ((!build && !bundledEngine) || verdict?.verdict === "unsupported") throw new ProtocolError("UNAVAILABLE", "The engine has no build for this computer.", { details: { reason: "unsupported", platform: hardware.platform, arch: hardware.arch } });
    if (verdict?.verdict === "disk") throw new ProtocolError("UNAVAILABLE", "There is not enough free disk space for this download.", { details: { reason: "disk", needBytes: verdict.needs.diskBytes, freeBytes: hardware.disk.freeBytes } });
    if (verdict?.verdict === "memory") throw new ProtocolError("UNAVAILABLE", "This computer does not have enough memory for this quant. Choose a smaller one.", { details: { reason: "memory", needBytes: verdict.needs.memoryBytes, haveBytes: hardware.memory.totalBytes } });
    downloads.start(p.variant, p.quant, LOCAL_MODEL_IDS[p.variant], filesOf(manifest, p.variant, p.quant, downloadBuildOf(hardware)));
    return done(connection, "download", { variant: p.variant, quant: p.quant });
  });
  method("jagentchill.localModels.pause", (p, connection) => { downloads.pause(p.variant); return done(connection, "pause", { variant: p.variant }); });
  method("jagentchill.localModels.resume", (p, connection) => { downloads.resume(p.variant); return done(connection, "resume", { variant: p.variant }); });
  method("jagentchill.localModels.cancel", (p, connection) => { downloads.cancel(p.variant); changed(); return done(connection, "cancel", { variant: p.variant }); });
  method("jagentchill.localModels.remove", (p, connection) => {
    if (generating) throw new ProtocolError("CONFLICT", "A picture is being made with a local model. Remove it when the picture is done.");
    downloads.remove(p.variant); changed();
    return done(connection, "remove", { variant: p.variant });
  });
  method("jagentchill.localModels.verify", async (p, connection) => { const outcome = await downloads.verify(p.variant); changed(); return { ...done(connection, "verify", { variant: p.variant, ok: outcome.ok }), ok: outcome.ok, damaged: outcome.damaged }; });
  method("jagentchill.localModels.settings.set", (p, connection) => { save({ settings: { ...settings(), ...p } }); changed(); return done(connection, "settings", p); });

  // The hardware is read once when the host starts (fast: memory, `nvidia-smi`, the disk), so the card has numbers to show.
  if (!stored().hardware) void check().catch(() => undefined);

  return {
    methods, adapter, view, check,
    /**
     * The text model and engine that read a chat message (`intent.ts`): the Qwen3-VL text model an installed picture
     * model brought, run by llama.cpp shipped next to the picture engine (or `JAGENTCHILL_LLM_ENGINE`).
     */
    textModel(): { program: string; model: string } | undefined {
      const install = LOCAL_MODEL_VARIANTS.map((variant) => downloads.installed(variant)).find(Boolean);
      const sibling = bundledEngine ? join(dirname(bundledEngine), "llama-completion") : undefined;
      const program = [process.env.JAGENTCHILL_LLM_ENGINE, sibling].find((path) => !!path && existsSync(path));
      return install && program ? { program, model: install.llm } : undefined;
    },
    /** Tells the generation catalogue that what is installed changed. */
    bindGeneration(notify: () => void): void { onInstalled = notify; },
    close(): void { downloads.close(); if (pending) clearTimeout(pending); },
  };
}
export type LocalModels = ReturnType<typeof createLocalModels>;

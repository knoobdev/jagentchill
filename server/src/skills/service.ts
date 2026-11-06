import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { z } from "zod";
import {
  SKILL_LIMITS, SKILL_METHOD_SCOPES, SKILL_NAME_PATTERN, sessionSkillsGetParams, sessionSkillsSetParams, skillAuthorParams, skillCatalogueGetParams, skillCatalogueListParams,
  skillEnabledParams, skillForkParams, skillIdParams, skillInstallParams, skillInvocationParams, skillLearnParams, skillLessonUpdateParams, skillListParams, skillPinParams,
  skillRemoveParams, skillRenameParams, skillRestoreParams, skillSourceIdParams, skillSourceUpsertParams, skillTrustParams, skillUpdateApplyParams, skillUpdateCheckParams,
  type Scope, type SkillCard, type SkillCatalogueItem, type SkillRecord, type SkillSource,
} from "@jagentchill/protocol";
import type { Connection, RpcMethod } from "../channel/ws-channel.ts";
import { ProtocolError } from "../errors.ts";
import type { ResolvedRuntime } from "../runtimes/registry.ts";
import { audit } from "../store/database.ts";
import type { ServerConfigFile } from "../store/server-config.ts";
import {
  EXPORT_EXCLUDED, MARKER, buildSkillMd, cardOf, copySkill, isInside, parseSkillMd, readLessons, readSkillFolder, renameSkillMd, swapInto, writeJsonAtomic, writeLessons, zipFolder,
  type SkillFolder,
} from "./folder.ts";
import { DEFAULT_SOURCES, createSourceReader, fetchFailed, isOfferedSource, runGit, type GitRunner, type Listing, type SourceItem, type StoredSource } from "./sources.ts";

const LISTING_TTL_MS = 600_000;
const BACKUP_MS = SKILL_LIMITS.backupDays * 86_400_000;
const EXPORT_MS = 86_400_000;

type LockRecord = {
  skillId: string; name: string; scope: "global"; realPath: string; paths: string[];
  source: { kind: SkillRecord["source"]["kind"]; sourceId?: string; ref: string; resolvedRevision?: string; integrity: string; item?: SourceItem };
  version?: string; pinned: boolean; pinnedRevision?: string; trustSource: boolean; installed_ms: number; installedByDeviceId: string; updated_ms?: number;
  previous?: { revision?: string; backupPath: string; saved_ms: number };
};
type LockFile = { version: 1; skills: LockRecord[] };
type RemovedEntry = { backupId: string; name: string; originalPath: string; removed_ms: number; expires_ms: number };

export type SkillServiceDeps = {
  dataDir: string; db: DatabaseSync; config: ServerConfigFile; now: () => number;
  broadcast: (scope: Scope, event: string, stream: string, payload: unknown, filter?: (connection: Connection) => boolean) => void;
  runtimes: () => ResolvedRuntime[];
  /** The runtime a session runs on, for a caller that may act in it; undefined otherwise. */
  sessionRuntime: (sessionKey: string, connection: Connection) => string | undefined;
  deviceName: (deviceId: string) => string | undefined;
  /** The folder of the `jagentchill-*` skills this product ships. */
  bundledDir: string;
  git?: GitRunner;
  /** Which repository addresses a git source may name; https only unless a test says otherwise. */
  gitUrlAllowed?: (url: string) => boolean;
};

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw new ProtocolError("INVALID_PARAMS", "The parameters do not match the expected shape.", { details: { path: parsed.error.issues[0]?.path.join(".") ?? "" } });
  return parsed.data;
}
const notFound = () => new ProtocolError("skill/not-found", "There is no such skill.");

/**
 * The line that names the attached skills for one runtime. The skills' own text is never part of it: the relay hands the
 * runtime the paths of their `SKILL.md` files (`skillFiles`). Only a runtime whose capabilities say it understands
 * `$name` tokens gets them; every runtime the server drives today declares the sentence form.
 */
export function invocationLine(runtime: { id: string; extends?: string; skills: "token" | "native-dir" | "sentence" } | undefined, names: string[]): string {
  if (!names.length) return "";
  if (runtime?.skills === "token") return names.map((name) => `$${name}`).join(" ");
  return `Before you answer, load these skills: ${names.join(", ")}`;
}

/**
 * Skills of the host. The server owns the skill folders: the managed root (`<dataDir>/skills/managed`) it installs into
 * and the folder of the skills this product ships. It keeps what is installed and from where (the lock file), which
 * skills are turned off (`skills.disabled` in the server configuration), installing, updating, pinning and removing,
 * and which skills a session has attached. A skill's text is never put into a prompt here.
 */
export function createSkillService(deps: SkillServiceDeps) {
  const { db } = deps;
  const root = join(deps.dataDir, "skills");
  const lockFile = join(root, "lock.json"), stagingDir = join(root, "staging"), backupsDir = join(root, "backups"), exportsDir = join(root, "exports");
  const managedDir = join(root, "managed");
  const reader = createSourceReader({ cacheDir: join(root, "cache"), git: deps.git ?? runGit, now: deps.now });
  const subscribers = new Set<Connection>();
  const listings = new Map<string, { listing?: Listing; error?: ProtocolError; at_ms: number }>();
  const updates = new Map<string, { revision: string; version?: string }>();
  const idempotent = new Map<string, Promise<unknown>>();
  /** What the screen is told once: what happened to the records while the server was not looking. */
  const notices: string[] = [];
  let running = 0;
  const waiting: Array<() => void> = [];

  db.exec("CREATE TABLE IF NOT EXISTS session_skills (session_key TEXT PRIMARY KEY, skill_ids TEXT NOT NULL, updated_ms INTEGER NOT NULL) STRICT");

  // ---- lock file ----

  /** An interrupted install leaves nothing behind: whatever is still staged at start is removed. */
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(managedDir, { recursive: true });
  let lock: LockFile = loadLock();
  function loadLock(): LockFile {
    if (!existsSync(lockFile)) return { version: 1, skills: [] };
    try {
      const parsed = JSON.parse(readFileSync(lockFile, "utf8")) as LockFile;
      if (!Array.isArray(parsed.skills)) throw new Error("no skills");
      return parsed;
    } catch {
      renameSync(lockFile, `${lockFile}.corrupt-${deps.now()}`);
      notices.push("Skill records were rebuilt");
      return { version: 1, skills: [] };
    }
  }
  const saveLock = () => writeJsonAtomic(lockFile, lock);
  const lockOf = (name: string) => lock.skills.find((record) => record.name === name);

  /** Brings the records in line with the disk: a folder that is gone loses its record; a half-replaced one is put back. */
  function reconcile(managed: string): void {
    let changed = false;
    if (notices.includes("Skill records were rebuilt") && !lock.skills.length && existsSync(managed)) {
      for (const name of readdirSync(managed)) {
        const marker = join(managed, name, MARKER);
        if (!existsSync(marker)) continue;
        try {
          const stored = JSON.parse(readFileSync(marker, "utf8")) as { source: LockRecord["source"]; installed_ms: number };
          lock.skills.push({ skillId: `global:managed:${name}`, name, scope: "global", realPath: join(managed, name), paths: [join(managed, name)], source: stored.source, pinned: false, trustSource: false, installed_ms: stored.installed_ms, installedByDeviceId: "" });
          changed = true;
        } catch { /* a marker that cannot be read names no record */ }
      }
    }
    const gone = lock.skills.filter((record) => !existsSync(record.realPath));
    for (const record of gone) {
      // An update that stopped between moving the old folder away and putting the new one in place.
      if (record.previous && existsSync(record.previous.backupPath)) { renameSync(record.previous.backupPath, record.realPath); record.previous = undefined; changed = true; continue; }
      lock.skills = lock.skills.filter((entry) => entry !== record);
      changed = true;
    }
    const removed = gone.filter((record) => !lock.skills.includes(record)).length;
    if (removed) notices.push(removed === 1 ? "1 skill was removed outside JAgentChill" : `${removed} skills were removed outside JAgentChill`);
    if (changed) saveLock();
  }

  reconcile(managedDir);

  const announce = (skillIds: string[]) => deps.broadcast("jagentchill.projects.read", "jagentchill.skill.changed", "skill", { skillIds }, (connection) => subscribers.has(connection));

  // ---- turned off ----

  /** The ids of the skills that are turned off. Every valid skill is on unless it is named here. */
  const disabledIds = (): string[] => {
    const stored = deps.config.get<unknown>("skills.disabled");
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [];
  };
  function setDisabled(change: (ids: string[]) => string[]): void {
    const before = disabledIds();
    const after = [...new Set(change(before))];
    if (after.length === before.length && after.every((id) => before.includes(id))) return;
    try {
      deps.config.set("skills.disabled", after);
    } catch {
      throw new ProtocolError("INTERNAL", "The skill could not be changed.", { httpStatus: 500, retryable: true });
    }
  }

  // ---- records ----

  /** Every runtime that is turned on can be told to read a skill's file. */
  const skillRuntimes = () => deps.runtimes().filter((runtime) => runtime.enabled).map((runtime) => runtime.id);
  function recordOf(folder: SkillFolder, placement: { scope: SkillRecord["scope"]; root: SkillRecord["root"] }, disabled: ReadonlySet<string>, admin: boolean): SkillRecord {
    const bundled = placement.scope === "bundled";
    const record = bundled ? undefined : lockOf(folder.folderName);
    const owned = !!record && resolve(record.realPath) === resolve(folder.dir);
    const skillId = `${placement.scope}:${placement.root}:${folder.folderName}`;
    const enabled = folder.status === "ok" && !disabled.has(skillId);
    const source = owned ? record.source : undefined;
    const sourceStillThere = !source?.sourceId || sources().some((entrySource) => entrySource.id === source.sourceId);
    const lessons = readLessons(parseSkillMd(folder.markdown)?.body ?? "").length;
    const update = updates.get(skillId);
    return {
      skillId, name: folder.name, description: folder.description, ...(folder.version ?? record?.version ? { version: folder.version ?? record?.version } : {}),
      scope: placement.scope, root: placement.root, realPath: admin ? folder.dir : null, links: [],
      visibleTo: enabled ? skillRuntimes() : [],
      owned, bundled, enabled, pinned: owned && record.pinned, ...(owned && record.pinnedRevision ? { pinnedRevision: record.pinnedRevision } : {}),
      status: folder.status, ...(folder.invalidReason ? { invalidReason: folder.invalidReason } : {}),
      source: bundled ? { kind: "bundled" } : source ? { kind: source.kind, ...(source.sourceId ? { sourceId: source.sourceId } : {}), ref: source.ref, ...(source.resolvedRevision ? { revision: source.resolvedRevision } : {}), ...(sourceStillThere ? {} : { removed: true }) } : { kind: "host" },
      hasScripts: folder.hasScripts, fileCount: folder.fileCount, sizeBytes: folder.sizeBytes, contentHash: folder.contentHash, familyId: folder.name,
      modifiedLocally: owned && folder.contentHash !== record.source.integrity,
      ...(update && owned && update.revision !== record.source.resolvedRevision ? { updateAvailable: update } : {}),
      canRollBack: owned && !!record.previous && existsSync(record.previous.backupPath), trustSource: owned && record.trustSource,
      ...(lessons ? { training: { status: "training" as const, lessons, uses: 0, consecutiveCleanUses: 0 } } : {}),
      ...(owned ? { installed_ms: record.installed_ms, ...(record.updated_ms ? { updated_ms: record.updated_ms } : {}), installedByDeviceId: record.installedByDeviceId } : {}),
    };
  }

  type Located = { record: SkillRecord; folder: SkillFolder };
  /** Every folder of the managed root and of the product's own skills, read from disk; a folder that is not a valid skill is listed as invalid. */
  function locate(admin: boolean): Located[] {
    const disabled = new Set(disabledIds());
    const out: Located[] = [];
    // The managed root comes first: a bare name is the skill of the first root that holds it.
    for (const [dir, placement] of [[managedDir, { scope: "global" as const, root: "managed" as const }], [deps.bundledDir, { scope: "bundled" as const, root: "bundled" as const }]] as const) {
      if (!dir || !existsSync(dir)) continue;
      for (const name of readdirSync(dir).sort()) {
        const path = join(dir, name);
        if (name.startsWith(".")) continue;
        try { if (!statSync(path).isDirectory()) continue; } catch { continue; }
        let folder: SkillFolder;
        try { folder = readSkillFolder(path); } catch (err) { folder = { dir: path, folderName: name, name, description: "", markdown: "", files: [], fileCount: 0, sizeBytes: 0, hasScripts: false, contentHash: "", status: "invalid", invalidReason: err instanceof Error ? err.message : "This folder cannot be read" }; }
        out.push({ record: recordOf(folder, placement, disabled, admin), folder });
      }
    }
    // A stable sort: two skills of one name keep the order of their roots.
    return out.sort((a, b) => a.record.name.localeCompare(b.record.name));
  }
  function find(skillId: string, admin = true): Located {
    const all = locate(admin);
    // A bare name is the skill a session loads: the first root that holds it.
    const found = all.find((entry) => entry.record.skillId === skillId) ?? all.find((entry) => entry.record.name === skillId && entry.record.status === "ok");
    if (!found) throw notFound();
    return found;
  }
  const isAdmin = (connection: Connection) => connection.role() === "admin";
  const actor = (connection: Connection) => `device:${connection.deviceId}`;

  // ---- sources and catalogue ----

  /** The sources of this host; a stored source of a kind the server no longer reads is dropped. */
  const sources = (): StoredSource[] => (deps.config.get<StoredSource[]>("skills.sources") ?? DEFAULT_SOURCES).filter(isOfferedSource);
  const sourceOf = (id: string) => {
    const source = sources().find((entry) => entry.id === id);
    if (!source) throw new ProtocolError("skill/source-not-found", "There is no such source.", { details: { sourceId: id } });
    return source;
  };
  function sourceView(source: StoredSource): SkillSource {
    const cached = listings.get(source.id);
    return {
      ...(source as SkillSource), state: !source.enabled ? "disabled" : cached?.error ? "error" : "ready",
      ...(cached?.listing ? { itemCount: cached.listing.items.length } : {}), ...(cached?.error ? { error: String(cached.error.details?.cause ?? cached.error.message) } : {}),
    };
  }
  function assertSource(source: StoredSource): void {
    if (source.kind === "git") {
      const allowed = deps.gitUrlAllowed ?? ((url: string) => /^https:\/\/[^\s@]+$/.test(url));
      if (!source.url || !allowed(source.url)) throw new ProtocolError("INVALID_PARAMS", "Use an https URL", { details: { path: "source.url" } });
    }
    if (source.kind === "local") {
      const path = resolve(source.path ?? "");
      // The server's own data is never a place to install from.
      if (!source.path?.startsWith(sep) || isInside(path, deps.dataDir)) throw new ProtocolError("skill/path-not-allowed", "Skills cannot be installed from this folder.", { details: { path: source.path } });
    }
  }
  async function listingOf(source: StoredSource, refresh = false): Promise<Listing> {
    const cached = listings.get(source.id);
    // A source is listed whole and filtered here.
    if (!refresh && cached?.listing && deps.now() - cached.at_ms < LISTING_TTL_MS) return cached.listing;
    try {
      const listing = await reader.list(source);
      listings.set(source.id, { listing, at_ms: deps.now() });
      return listing;
    } catch (err) {
      const error = err instanceof ProtocolError ? err : fetchFailed(source.id, err instanceof Error ? err.message : String(err));
      listings.set(source.id, { ...(cached?.listing ? { listing: cached.listing } : {}), error, at_ms: deps.now() });
      throw error;
    }
  }
  const itemIdOf = (sourceId: string, item: SourceItem) => `${sourceId}:${item.path ? `${item.name}@${item.path}` : item.name}`;
  async function resolveItem(itemId: string): Promise<{ source: StoredSource; item: SourceItem }> {
    const separator = itemId.indexOf(":");
    const source = sources().find((entry) => entry.id === itemId.slice(0, separator));
    const missing = () => new ProtocolError("skill/catalogue-item-not-found", "This skill is no longer offered by its source.");
    if (!source || separator < 0) throw missing();
    const listing = listings.get(source.id)?.listing ?? await listingOf(source);
    const item = listing.items.find((entry) => itemIdOf(source.id, entry) === itemId) ?? (await listingOf(source, true)).items.find((entry) => itemIdOf(source.id, entry) === itemId);
    if (!item) throw missing();
    return { source, item };
  }
  /** Fetches one skill into a staging folder named after it and reads it; the caller removes the staging folder. */
  async function stage(source: StoredSource, item: SourceItem, revision?: string): Promise<{ dir: string; base: string; folder: SkillFolder; revision?: string }> {
    const base = join(stagingDir, randomUUID());
    const dir = join(base, item.name);
    try {
      mkdirSync(base, { recursive: true });
      const fetched = await reader.fetch(source, item, dir, revision);
      return { dir, base, folder: readSkillFolder(dir), ...(fetched.revision ? { revision: fetched.revision } : {}) };
    } catch (err) {
      rmSync(base, { recursive: true, force: true });
      throw err;
    }
  }

  /** At most three installs or updates run at once; the others wait in order. */
  async function serialised<T>(run: () => Promise<T>): Promise<T> {
    if (running >= SKILL_LIMITS.concurrentInstalls) await new Promise<void>((next) => waiting.push(next));
    running += 1;
    try { return await run(); } finally { running -= 1; waiting.shift()?.(); }
  }
  function once<T>(key: string, run: () => Promise<T>): Promise<T> {
    const known = idempotent.get(key);
    if (known) return known as Promise<T>;
    const result = run();
    idempotent.set(key, result);
    result.catch(() => idempotent.delete(key));
    return result;
  }
  const managed = (): string => managedDir;
  function assertValid(folder: SkillFolder): void {
    if (folder.status !== "ok") throw new ProtocolError("skill/invalid", folder.invalidReason ?? "This is not a valid skill.", { details: { reason: folder.invalidReason } });
  }
  function freeName(name: string): string {
    for (let n = 2; n < 100; n++) if (!existsSync(join(managed(), `${name}-${n}`))) return `${name}-${n}`;
    return `${name}-${randomUUID().slice(0, 6)}`;
  }
  /** Places a staged, valid folder in the managed root as an owned skill and records it. */
  function adopt(staged: string, name: string, source: LockRecord["source"], connection: Connection, extra: Partial<LockRecord> = {}): LockRecord {
    const target = join(managed(), name);
    if (existsSync(target)) throw new ProtocolError("skill/name-conflict", "A skill of that name already exists.", { details: { suggestedName: freeName(name) } });
    if (lock.skills.length >= SKILL_LIMITS.installed) throw new ProtocolError("QUOTA_EXCEEDED", "This host holds as many installed skills as it allows (200).", { details: { limit: "200 installed skills" } });
    const installed_ms = deps.now();
    writeFileSync(join(staged, MARKER), JSON.stringify({ name, source, resolvedRevision: source.resolvedRevision ?? null, installed_ms }, null, 2));
    swapInto(staged, target);
    const record: LockRecord = { skillId: `global:managed:${name}`, name, scope: "global", realPath: target, paths: [target], source, pinned: false, trustSource: false, installed_ms, installedByDeviceId: connection.deviceId, ...extra };
    lock.skills = [...lock.skills.filter((entry) => entry.name !== name), record];
    saveLock();
    return record;
  }
  /** The record of a skill of the managed root, as the caller may see it. */
  function settled(name: string, connection: Connection): SkillRecord {
    const found = locate(isAdmin(connection)).find((entry) => entry.record.skillId === `global:managed:${name}`);
    if (!found) throw notFound();
    return found.record;
  }
  function requireOwned(located: Located): LockRecord {
    const record = located.record.owned ? lockOf(located.folder.folderName) : undefined;
    if (!record) throw new ProtocolError("skill/not-owned", located.record.bundled ? "Built-in skills cannot be changed." : "JAgentChill did not install this skill.");
    return record;
  }

  // ---- invocation ----

  /** Turns ids and bare names into the skills a session of that runtime may attach; refuses, never drops. */
  async function resolveAttached(ids: string[], runtimeId: string | undefined): Promise<SkillRecord[]> {
    const unique = [...new Set(ids)];
    if (unique.length > SKILL_LIMITS.perTurn) throw new ProtocolError("skill/too-many", "You can attach up to 8 skills per message");
    const all = locate(false);
    return unique.map((id) => {
      const found = all.find((entry) => entry.record.skillId === id) ?? all.find((entry) => entry.record.name === id && entry.record.status === "ok");
      if (!found) throw new ProtocolError("skill/not-available", `${id} is not installed.`, { details: { skillId: id, reason: "disabled" } });
      if (!found.record.enabled) throw new ProtocolError("skill/not-available", `${found.record.name} is turned off.`, { details: { skillId: found.record.skillId, reason: "disabled" } });
      if (runtimeId && !found.record.visibleTo.includes(runtimeId)) throw new ProtocolError("skill/not-available", `${found.record.name} is not available on this runtime.`, { details: { skillId: found.record.skillId, reason: "runtime" } });
      return found.record;
    });
  }
  function sessionOf(sessionKey: string, connection: Connection): string {
    const runtimeId = deps.sessionRuntime(sessionKey, connection);
    if (!runtimeId) throw new ProtocolError("NOT_FOUND", "No such session.");
    return runtimeId;
  }

  // ---- methods ----

  const methods = new Map<string, RpcMethod>();
  const method = (name: keyof typeof SKILL_METHOD_SCOPES, handle: RpcMethod["handle"]) => methods.set(name, { scope: SKILL_METHOD_SCOPES[name], handle });
  /** A change of what is installed: written to the audit log and announced to the open Skills screens. */
  const changed = (connection: Connection, action: string, skillId: string, details: Record<string, unknown> = {}) => {
    audit(db, deps.now(), actor(connection), action, { skillId, ...details });
    announce([skillId]);
  };

  method("jagentchill.skill.list", async (raw, connection) => {
    parse(skillListParams, raw);
    const pending = notices.splice(0);
    return { skills: locate(isAdmin(connection)).map((entry) => entry.record), stale: false, notices: pending };
  });

  method("jagentchill.skill.subscribe", (_raw, connection) => { subscribers.add(connection); return { stream: "skill" }; });
  method("jagentchill.skill.unsubscribe", (_raw, connection) => void subscribers.delete(connection));

  method("jagentchill.skill.source.list", () => ({ sources: sources().map(sourceView) }));
  method("jagentchill.skill.source.upsert", (raw, connection) => {
    const { source: input } = parse(skillSourceUpsertParams, raw);
    if (!isOfferedSource(input)) throw new ProtocolError("INVALID_PARAMS", "Skills can be added from a git repository or a folder on this host.", { details: { path: "source.kind" } });
    const current = sources();
    const id = input.id ?? `${input.kind}-${randomUUID().slice(0, 8)}`;
    const existing = current.find((entry) => entry.id === id);
    if (existing && existing.kind !== input.kind) throw new ProtocolError("INVALID_PARAMS", "The kind of a source cannot change.", { details: { path: "source.kind" } });
    if (!existing && current.length >= SKILL_LIMITS.sources) throw new ProtocolError("QUOTA_EXCEEDED", "A host has at most 20 skill sources.", { details: { limit: "20 sources" } });
    const stored: StoredSource = { ...input, id };
    assertSource(stored);
    deps.config.set("skills.sources", existing ? current.map((entry) => (entry.id === id ? stored : entry)) : [...current, stored]);
    listings.delete(id);
    audit(db, deps.now(), actor(connection), "skill.source.change", { sourceId: id, kind: stored.kind, change: existing ? "update" : "add", ref: stored.url ?? stored.path ?? null });
    announce([]);
    return { source: sourceView(stored) };
  });
  method("jagentchill.skill.source.remove", (raw, connection) => {
    const source = sourceOf(parse(skillSourceIdParams, raw).id);
    // Skills installed from it stay installed; they only lose their update source.
    deps.config.set("skills.sources", sources().filter((entry) => entry.id !== source.id));
    listings.delete(source.id);
    audit(db, deps.now(), actor(connection), "skill.source.change", { sourceId: source.id, kind: source.kind, change: "remove" });
    announce([]);
    return { id: source.id };
  });
  method("jagentchill.skill.source.refresh", async (raw) => {
    const source = sourceOf(parse(skillSourceIdParams, raw).id);
    const listing = await listingOf(source, true);
    return { state: "ready", itemCount: listing.items.length };
  });

  method("jagentchill.skill.catalogue.list", async (raw) => {
    const params = parse(skillCatalogueListParams, raw);
    const query = params.query?.trim().toLowerCase() ?? "";
    const wanted = sources().filter((source) => source.enabled && (!params.sourceIds || params.sourceIds.includes(source.id)));
    const failedSourceIds: string[] = [];
    const items: SkillCatalogueItem[] = [];
    await Promise.all(wanted.map(async (source) => {
      try {
        for (const item of (await listingOf(source)).items) {
          const text = `${item.name}\n${item.description}`.toLowerCase();
          if (query && !text.includes(query)) continue;
          const installed = lock.skills.find((record) => record.source.sourceId === source.id && record.source.item?.name === item.name);
          items.push({
            itemId: itemIdOf(source.id, item), sourceId: source.id, sourceLabel: source.label, sourceKind: source.kind, name: item.name, description: item.description,
            ...(item.version ? { version: item.version } : {}), ...(item.revision ? { revision: item.revision } : {}), ...(item.author ? { author: item.author } : {}),
            ...(installed ? { installed: { skillId: installed.skillId, ...(installed.version ? { version: installed.version } : {}) } } : {}),
            updateAvailable: !!installed && !!item.revision && !!installed.source.resolvedRevision && item.revision !== installed.source.resolvedRevision, reference: item.reference,
          });
        }
      } catch { failedSourceIds.push(source.id); }
    }));
    const rank = (item: SkillCatalogueItem) => (!query ? 0 : item.name.toLowerCase().startsWith(query) ? 0 : item.name.toLowerCase().includes(query) ? 1 : 2);
    items.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    const start = Number(params.cursor ?? 0) || 0;
    return { items: items.slice(start, start + params.limit), ...(start + params.limit < items.length ? { nextCursor: String(start + params.limit) } : {}), total: items.length, failedSourceIds, enabledSources: wanted.length };
  });

  /** The card the trust prompt and the detail view show. `installed:<skillId>` names an installed skill. */
  method("jagentchill.skill.catalogue.get", async (raw, connection): Promise<{ card: SkillCard; source?: { kind: string; label: string; reference: string; revision?: string }; skill?: SkillRecord; installedBy?: string }> => {
    const { itemId } = parse(skillCatalogueGetParams, raw);
    if (itemId.startsWith("installed:")) {
      const located = find(itemId.slice("installed:".length), isAdmin(connection));
      const card = located.folder.status === "ok" || located.folder.markdown ? cardOf(located.folder) : { name: located.folder.name, description: "", markdown: "", files: [], hasScripts: false, fileCount: 0, sizeBytes: 0, contentHash: "", lessons: [] };
      const by = located.record.installedByDeviceId ? deps.deviceName(located.record.installedByDeviceId) : undefined;
      return { card, skill: located.record, ...(by ? { installedBy: by } : {}) };
    }
    const { source, item } = await resolveItem(itemId);
    const sourceInfo = { kind: source.kind, label: source.label, reference: item.reference, ...(item.revision ? { revision: item.revision } : {}) };
    const staged = await stage(source, item);
    try {
      return { source: { ...sourceInfo, ...(staged.revision ? { revision: staged.revision } : {}) }, card: cardOf(staged.folder) };
    } finally { rmSync(staged.base, { recursive: true, force: true }); }
  });

  method("jagentchill.skill.install", (raw, connection) => {
    const params = parse(skillInstallParams, raw);
    return once(`install:${connection.deviceId}:${params.idempotencyKey}`, () => serialised(async () => {
      const { source, item } = await resolveItem(params.itemId);
      const name = params.rename ?? item.name;
      const staged = await stage(source, item);
      try {
        assertValid(staged.folder);
        if (staged.folder.contentHash !== params.confirmedContentHash) throw new ProtocolError("skill/content-changed", "The skill changed at its source since it was reviewed.", { details: { contentHash: staged.folder.contentHash, ...(staged.revision ? { revision: staged.revision } : {}) } });
        let integrity = staged.folder.contentHash;
        let dir = staged.dir;
        if (name !== item.name) {
          // Installing under another name renames the folder and the name in its front matter together.
          writeFileSync(join(staged.dir, "SKILL.md"), renameSkillMd(staged.folder.markdown, name));
          dir = join(staged.base, name);
          renameSync(staged.dir, dir);
          integrity = readSkillFolder(dir).contentHash;
        }
        const record = adopt(dir, name, { kind: source.kind, sourceId: source.id, ref: item.reference, ...(staged.revision ? { resolvedRevision: staged.revision } : {}), integrity, item }, connection, {
          ...(staged.folder.version ? { version: staged.folder.version } : {}), trustSource: params.trustSource === true && !staged.folder.hasScripts,
        });
        changed(connection, "skill.install", record.skillId, { source: item.reference, revision: staged.revision ?? null, sourceKind: source.kind });
        return { skill: settled(name, connection) };
      } finally { rmSync(staged.base, { recursive: true, force: true }); }
    }));
  });

  method("jagentchill.skill.update.check", async (raw, connection) => {
    const { skillIds } = parse(skillUpdateCheckParams, raw);
    const results: Array<{ skillId: string; updateAvailable: boolean; revision?: string; itemId?: string; error?: string }> = [];
    for (const record of lock.skills) {
      if (skillIds && !skillIds.includes(record.skillId)) continue;
      const source = sources().find((entry) => entry.id === record.source.sourceId);
      if (!source || !record.source.item) { results.push({ skillId: record.skillId, updateAvailable: false, error: source ? "No update source" : "Source removed — updates unavailable" }); continue; }
      try {
        const listing = await listingOf(source, true);
        const item = listing.items.find((entry) => entry.name === record.source.item!.name);
        if (!item) { results.push({ skillId: record.skillId, updateAvailable: false, error: "This skill is no longer offered by its source" }); continue; }
        let revision = item.revision;
        // A folder on the host has no revision of its own: its content hash stands in for one.
        if (source.kind === "local") revision = readSkillFolder(item.path).contentHash;
        const current = source.kind === "local" ? record.source.integrity : record.source.resolvedRevision;
        const available = !!revision && revision !== current;
        if (available) updates.set(record.skillId, { revision: revision!, ...(item.version ? { version: item.version } : {}) }); else updates.delete(record.skillId);
        results.push({ skillId: record.skillId, updateAvailable: available, ...(revision ? { revision } : {}), itemId: itemIdOf(source.id, item) });
      } catch (err) {
        results.push({ skillId: record.skillId, updateAvailable: false, error: "Unable to check for updates" });
        if (!(err instanceof ProtocolError)) throw err;
      }
    }
    if (results.some((result) => result.updateAvailable)) announce(results.map((result) => result.skillId));
    void connection;
    return { results };
  });

  method("jagentchill.skill.update.apply", (raw, connection) => {
    const params = parse(skillUpdateApplyParams, raw);
    return serialised(async () => {
      const located = find(params.skillId);
      const record = requireOwned(located);
      const source = sources().find((entry) => entry.id === record.source.sourceId);
      if (!source || !record.source.item) throw new ProtocolError("UNSUPPORTED_FEATURE", "This skill has no update source.");
      const item = (await listingOf(source, true)).items.find((entry) => entry.name === record.source.item!.name) ?? record.source.item;
      const staged = await stage(source, item, params.revision);
      try {
        assertValid(staged.folder);
        if (staged.folder.contentHash !== params.confirmedContentHash) throw new ProtocolError("skill/content-changed", "The skill changed at its source since it was reviewed.", { details: { contentHash: staged.folder.contentHash } });
        let forkName: string | undefined;
        if (located.record.modifiedLocally) {
          // Local edits are never lost silently: the caller chooses to keep them as a fork or to overwrite them.
          if (!params.onModified) throw new ProtocolError("CONFLICT", "This skill was changed on the host.", { details: { reason: "modified_locally" } });
          if (params.onModified === "fork") {
            forkName = existsSync(join(managed(), `${record.name}-custom`)) ? freeName(`${record.name}-custom`) : `${record.name}-custom`;
            const copy = join(stagingDir, randomUUID(), forkName);
            copySkill(record.realPath, copy);
            writeFileSync(join(copy, "SKILL.md"), renameSkillMd(readFileSync(join(copy, "SKILL.md"), "utf8"), forkName));
            adopt(copy, forkName, { kind: "fork", ref: record.skillId, integrity: readSkillFolder(copy).contentHash }, connection);
          }
        }
        const backupPath = join(backupsDir, `previous-${record.name}`);
        writeFileSync(join(staged.dir, MARKER), JSON.stringify({ name: record.name, source: record.source, resolvedRevision: staged.revision ?? null, installed_ms: record.installed_ms }, null, 2));
        // The record names the backup before the folders move, so a stop in between is undone at the next start.
        record.previous = { ...(record.source.resolvedRevision ? { revision: record.source.resolvedRevision } : {}), backupPath, saved_ms: deps.now() };
        saveLock();
        swapInto(staged.dir, record.realPath, backupPath);
        record.source = { ...record.source, ...(staged.revision ? { resolvedRevision: staged.revision } : {}), integrity: staged.folder.contentHash, item };
        record.updated_ms = deps.now();
        if (staged.folder.version) record.version = staged.folder.version;
        if (params.revision) { record.pinned = true; record.pinnedRevision = params.revision; }
        saveLock();
        updates.delete(record.skillId);
        changed(connection, "skill.update", record.skillId, { source: item.reference, revision: staged.revision ?? staged.folder.contentHash.slice(0, 12) });
        return { skill: settled(record.name, connection), ...(forkName ? { fork: `global:managed:${forkName}` } : {}) };
      } finally { rmSync(staged.base, { recursive: true, force: true }); }
    });
  });

  method("jagentchill.skill.rollback", async (raw, connection) => {
    const located = find(parse(skillIdParams, raw).skillId);
    const record = requireOwned(located);
    if (!record.previous || !existsSync(record.previous.backupPath)) throw notFound();
    const restoring = join(stagingDir, randomUUID(), record.name);
    mkdirSync(join(restoring, ".."), { recursive: true });
    renameSync(record.previous.backupPath, restoring);
    const replaced = record.source.resolvedRevision;
    swapInto(restoring, record.realPath, record.previous.backupPath);
    const restored = readSkillFolder(record.realPath);
    record.source = { ...record.source, ...(record.previous.revision ? { resolvedRevision: record.previous.revision } : {}), integrity: restored.contentHash };
    record.previous = { ...(replaced ? { revision: replaced } : {}), backupPath: record.previous.backupPath, saved_ms: deps.now() };
    record.updated_ms = deps.now();
    saveLock();
    changed(connection, "skill.rollback", record.skillId, { revision: record.source.resolvedRevision ?? null });
    return { skill: settled(record.name, connection) };
  });

  method("jagentchill.skill.trust.set", async (raw, connection) => {
    const params = parse(skillTrustParams, raw);
    const located = find(params.skillId);
    const record = requireOwned(located);
    if (params.trustSource && located.record.hasScripts) throw new ProtocolError("INVALID_PARAMS", "A skill with scripts is confirmed at every update.", { details: { path: "trustSource" } });
    record.trustSource = params.trustSource;
    saveLock();
    changed(connection, "skill.trust", record.skillId, { trustSource: params.trustSource });
    return { skill: find(params.skillId, isAdmin(connection)).record };
  });

  method("jagentchill.skill.pin.set", async (raw, connection) => {
    const params = parse(skillPinParams, raw);
    const located = find(params.skillId);
    const record = requireOwned(located);
    const installed = record.source.resolvedRevision ?? record.source.integrity;
    if (params.pinned && params.revision && params.revision !== installed) {
      const source = sources().find((entry) => entry.id === record.source.sourceId);
      if (!source || source.kind !== "git" || !record.source.item) throw new ProtocolError("UNSUPPORTED_FEATURE", "Only skills from a git source can be installed at another version.");
      // The version is validated at the source; the pin is recorded when the install of that version is confirmed.
      const staged = await stage(source, record.source.item, params.revision).catch((err) => {
        if (err instanceof ProtocolError && err.code === "skill/source-fetch-failed") throw new ProtocolError("skill/not-found", `Version not found at ${source.label}`, { details: { revision: params.revision } });
        throw err;
      });
      rmSync(staged.base, { recursive: true, force: true });
      return { needsInstall: true, contentHash: staged.folder.contentHash, revision: params.revision };
    }
    record.pinned = params.pinned;
    record.pinnedRevision = params.pinned ? installed : undefined;
    saveLock();
    changed(connection, "skill.pin", record.skillId, { pinned: params.pinned, revision: record.pinnedRevision ?? null });
    return { skill: find(params.skillId, isAdmin(connection)).record };
  });

  const removedList = (): RemovedEntry[] => (deps.config.get<RemovedEntry[]>("skills.removed") ?? []).filter((entry) => entry.expires_ms > deps.now() && existsSync(join(backupsDir, entry.backupId)));
  method("jagentchill.skill.remove", async (raw, connection) => {
    const params = parse(skillRemoveParams, raw);
    const located = find(params.skillId);
    if (located.record.bundled) throw new ProtocolError("skill/not-owned", "Built-in skills cannot be removed, only turned off.");
    const record = located.record.owned ? lockOf(located.folder.folderName) : undefined;
    if (record) {
      // Exactly the paths the server created, and nothing beside them.
      for (const path of record.paths) rmSync(path, { recursive: true, force: true });
      if (record.previous) rmSync(record.previous.backupPath, { recursive: true, force: true });
      lock.skills = lock.skills.filter((entry) => entry !== record);
      saveLock();
    } else {
      if (!params.confirm) throw new ProtocolError("skill/confirmation-required", "JAgentChill did not install this skill; removing it needs a second confirmation.", { details: { path: located.folder.dir } });
      // A folder the server did not write is copied away before it is deleted, and can be put back for 30 days.
      const backupId = `${located.folder.folderName}-${deps.now()}`;
      copySkill(located.folder.dir, join(backupsDir, backupId));
      rmSync(located.folder.dir, { recursive: true, force: true });
      deps.config.set("skills.removed", [...removedList(), { backupId, name: located.folder.folderName, originalPath: located.folder.dir, removed_ms: deps.now(), expires_ms: deps.now() + BACKUP_MS }]);
    }
    db.prepare("SELECT session_key, skill_ids FROM session_skills").all().forEach((row) => {
      const ids = (JSON.parse((row as { skill_ids: string }).skill_ids) as string[]).filter((id) => id !== located.record.skillId);
      db.prepare("UPDATE session_skills SET skill_ids = ? WHERE session_key = ?").run(JSON.stringify(ids), (row as { session_key: string }).session_key);
    });
    // A skill that is installed again under the same name starts switched on.
    setDisabled((ids) => ids.filter((id) => id !== located.record.skillId));
    changed(connection, "skill.remove", located.record.skillId, { owned: !!record, path: located.folder.dir });
    return { skillId: located.record.skillId };
  });
  method("jagentchill.skill.removed.list", () => ({ items: removedList() }));
  method("jagentchill.skill.restore", (raw, connection) => {
    const { backupId } = parse(skillRestoreParams, raw);
    const entry = removedList().find((candidate) => candidate.backupId === backupId);
    if (!entry) throw notFound();
    if (existsSync(entry.originalPath)) throw new ProtocolError("skill/name-conflict", "A folder of that name is at the original place again.", { details: { path: entry.originalPath } });
    copySkill(join(backupsDir, backupId), entry.originalPath);
    rmSync(join(backupsDir, backupId), { recursive: true, force: true });
    deps.config.set("skills.removed", removedList().filter((candidate) => candidate.backupId !== backupId));
    changed(connection, "skill.restore", entry.name, { path: entry.originalPath });
    return { name: entry.name };
  });

  method("jagentchill.skill.setEnabled", async (raw, connection) => {
    const params = parse(skillEnabledParams, raw);
    const located = find(params.skillId);
    if (located.record.status !== "ok") throw new ProtocolError("skill/invalid", located.record.invalidReason ?? "This skill is not valid.", { details: { reason: located.record.invalidReason ?? "invalid" } });
    const skillId = located.record.skillId;
    setDisabled((ids) => (params.enabled ? ids.filter((id) => id !== skillId) : [...ids, skillId]));
    changed(connection, "skill.enable", located.record.skillId, { enabled: params.enabled });
    return { skill: find(params.skillId, isAdmin(connection)).record };
  });

  method("jagentchill.skill.invocation.build", async (raw, connection) => {
    const params = parse(skillInvocationParams, raw);
    const runtimeId = sessionOf(params.sessionKey, connection);
    const attached = await resolveAttached(params.skillIds, runtimeId);
    const runtime = deps.runtimes().find((candidate) => candidate.id === runtimeId);
    return { line: invocationLine(runtime && { id: runtime.id, ...(runtime.entry?.extends ? { extends: runtime.entry.extends } : {}), skills: runtime.capabilities.skills }, attached.map((skill) => skill.name)), skillIds: attached.map((skill) => skill.skillId), warnings: [] };
  });
  method("jagentchill.session.skills.get", async (raw, connection) => {
    const { sessionKey } = parse(sessionSkillsGetParams, raw);
    sessionOf(sessionKey, connection);
    const row = db.prepare("SELECT skill_ids FROM session_skills WHERE session_key = ?").get(sessionKey) as { skill_ids: string } | undefined;
    return { sessionKey, skillIds: row ? (JSON.parse(row.skill_ids) as string[]) : [] };
  });
  method("jagentchill.session.skills.set", async (raw, connection) => {
    const params = parse(sessionSkillsSetParams, raw);
    const attached = await resolveAttached(params.skillIds, sessionOf(params.sessionKey, connection));
    const skillIds = attached.map((skill) => skill.skillId);
    db.prepare("INSERT INTO session_skills (session_key, skill_ids, updated_ms) VALUES (?, ?, ?) ON CONFLICT (session_key) DO UPDATE SET skill_ids = excluded.skill_ids, updated_ms = excluded.updated_ms").run(params.sessionKey, JSON.stringify(skillIds), deps.now());
    return { sessionKey: params.sessionKey, skillIds };
  });

  method("jagentchill.skill.author", async (raw, connection) => {
    const params = parse(skillAuthorParams, raw);
    const text = buildSkillMd({ name: params.name, description: params.description, body: params.body });
    if (params.skillId) {
      const located = find(params.skillId);
      const record = requireOwned(located);
      if (located.record.name !== params.name) throw new ProtocolError("INVALID_PARAMS", "Renaming a skill has its own action.", { details: { path: "name" } });
      // Two devices editing the same skill: the second save sees another hash and is refused.
      if (params.expectedContentHash && params.expectedContentHash !== located.folder.contentHash) throw new ProtocolError("CONFLICT", "This skill changed on another device.", { details: { contentHash: located.folder.contentHash } });
      // The lessons a skill has learnt stay with it through an edit of its instructions.
      const lessons = readLessons(parseSkillMd(located.folder.markdown)?.body ?? "");
      writeFileSync(join(record.realPath, "SKILL.md"), writeLessons(text, lessons));
      record.updated_ms = deps.now();
      if (record.source.kind === "authored" || record.source.kind === "fork") record.source.integrity = readSkillFolder(record.realPath).contentHash;
      saveLock();
      changed(connection, "skill.author", record.skillId, { change: "edit" });
      return { skill: find(record.skillId, isAdmin(connection)).record };
    }
    const dir = join(stagingDir, randomUUID(), params.name);
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(join(dir, "SKILL.md"), text);
      const record = adopt(dir, params.name, { kind: "authored", ref: `device:${connection.deviceId}`, integrity: readSkillFolder(dir).contentHash }, connection);
      changed(connection, "skill.author", record.skillId, { change: "create" });
      return { skill: settled(params.name, connection) };
    } finally { rmSync(join(dir, ".."), { recursive: true, force: true }); }
  });

  /** A copy the server owns of any skill, independent of the original from then on. */
  function fork(located: Located, name: string | undefined, connection: Connection): LockRecord {
    const target = name ?? (existsSync(join(managed(), `${located.record.name}-custom`)) ? freeName(`${located.record.name}-custom`) : `${located.record.name}-custom`);
    if (!SKILL_NAME_PATTERN.test(target) || target.length > SKILL_LIMITS.name) throw new ProtocolError("skill/invalid", "That is not a valid skill name.", { details: { reason: "bad name" } });
    const dir = join(stagingDir, randomUUID(), target);
    try {
      copySkill(located.folder.dir, dir);
      writeFileSync(join(dir, "SKILL.md"), renameSkillMd(located.folder.markdown, target));
      const record = adopt(dir, target, { kind: "fork", ref: located.record.skillId, integrity: readSkillFolder(dir).contentHash }, connection);
      changed(connection, "skill.author", record.skillId, { change: "fork", origin: located.record.skillId });
      return record;
    } finally { rmSync(join(dir, ".."), { recursive: true, force: true }); }
  }
  method("jagentchill.skill.fork", async (raw, connection) => {
    const params = parse(skillForkParams, raw);
    const located = find(params.skillId);
    if (located.record.status !== "ok") throw new ProtocolError("skill/invalid", located.record.invalidReason ?? "This skill is not valid.", { details: { reason: located.record.invalidReason } });
    const record = fork(located, params.name, connection);
    return { skill: settled(record.name, connection) };
  });

  method("jagentchill.skill.rename", async (raw, connection) => {
    const params = parse(skillRenameParams, raw);
    const located = find(params.skillId);
    const record = requireOwned(located);
    const inUse = (db.prepare("SELECT session_key, skill_ids FROM session_skills").all() as Array<{ session_key: string; skill_ids: string }>).filter((row) => (JSON.parse(row.skill_ids) as string[]).includes(record.skillId)).map((row) => row.session_key);
    if (inUse.length) throw new ProtocolError("skill/in-use", "A session has this skill attached.", { details: { sessionIds: inUse } });
    const target = join(managed(), params.name);
    if (existsSync(target)) throw new ProtocolError("skill/name-conflict", "A skill of that name already exists.", { details: { suggestedName: freeName(params.name) } });
    // The folder, the name in the front matter and the recorded paths change together.
    writeFileSync(join(record.realPath, "SKILL.md"), renameSkillMd(located.folder.markdown, params.name));
    renameSync(record.realPath, target);
    const previous = record.skillId;
    Object.assign(record, { skillId: `global:managed:${params.name}`, name: params.name, realPath: target, paths: [target] });
    record.source.integrity = record.source.kind === "authored" || record.source.kind === "fork" ? readSkillFolder(target).contentHash : record.source.integrity;
    saveLock();
    // A skill that was turned off stays off under its new name.
    setDisabled((ids) => ids.map((id) => (id === previous ? record.skillId : id)));
    audit(db, deps.now(), actor(connection), "skill.rename", { skillId: previous, name: params.name });
    announce([previous, record.skillId]);
    return { skill: settled(params.name, connection) };
  });

  /** Lessons are written into the `## Lessons` section of an owned skill; a skill the server does not own is forked first. */
  function teachable(skillId: string, connection: Connection): { record: LockRecord; forked: boolean } {
    const located = find(skillId);
    if (located.record.owned) return { record: requireOwned(located), forked: false };
    return { record: fork(located, undefined, connection), forked: true };
  }
  function rewriteLessons(record: LockRecord, change: (lessons: Array<{ lessonId?: string; text: string; date: string }>) => Array<{ text: string; date: string }>): void {
    const file = join(record.realPath, "SKILL.md");
    const text = readFileSync(file, "utf8");
    writeFileSync(file, writeLessons(text, change(readLessons(parseSkillMd(text)?.body ?? ""))));
    record.updated_ms = deps.now();
    if (record.source.kind === "authored" || record.source.kind === "fork") record.source.integrity = readSkillFolder(record.realPath).contentHash;
    saveLock();
  }
  method("jagentchill.skill.learn", async (raw, connection) => {
    const params = parse(skillLearnParams, raw);
    // A lesson that was not approved is discarded.
    if (!params.approved) return { applied: false };
    const { record, forked } = teachable(params.skillId, connection);
    const count = readLessons(parseSkillMd(readFileSync(join(record.realPath, "SKILL.md"), "utf8"))?.body ?? "").length;
    if (count >= SKILL_LIMITS.lessons) throw new ProtocolError("QUOTA_EXCEEDED", "This skill holds as many lessons as it can (50). Merge or delete some first.", { details: { limit: "50 lessons" } });
    rewriteLessons(record, (lessons) => [...lessons, { text: params.lesson, date: new Date(deps.now()).toISOString().slice(0, 10) }]);
    changed(connection, "skill.lesson", record.skillId, { change: "add", ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}) });
    return { applied: true, forked, skill: settled(record.name, connection) };
  });
  method("jagentchill.skill.lesson.update", async (raw, connection) => {
    const params = parse(skillLessonUpdateParams, raw);
    const record = requireOwned(find(params.skillId));
    const current = readLessons(parseSkillMd(readFileSync(join(record.realPath, "SKILL.md"), "utf8"))?.body ?? "");
    if (!current.some((lesson) => lesson.lessonId === params.lessonId)) throw notFound();
    rewriteLessons(record, (lessons) => ("delete" in params ? lessons.filter((lesson) => lesson.lessonId !== params.lessonId) : lessons.map((lesson) => (lesson.lessonId === params.lessonId ? { ...lesson, text: params.text } : lesson))));
    changed(connection, "skill.lesson", record.skillId, { change: "delete" in params ? "delete" : "edit" });
    return { skill: find(record.skillId, isAdmin(connection)).record };
  });

  method("jagentchill.skill.export", async (raw) => {
    const located = find(parse(skillIdParams, raw).skillId, false);
    const name = located.folder.folderName;
    const { bytes, excluded } = zipFolder(located.folder.dir, name, (path) => EXPORT_EXCLUDED.some((pattern) => pattern.test(path.split("/").pop() ?? "")));
    const blobSha256 = createHash("sha256").update(bytes).digest("hex");
    mkdirSync(exportsDir, { recursive: true });
    // Archives older than a day are removed whenever a new one is made.
    for (const file of readdirSync(exportsDir)) if (deps.now() - statSync(join(exportsDir, file)).mtimeMs > EXPORT_MS) rmSync(join(exportsDir, file), { force: true });
    writeFileSync(join(exportsDir, `${blobSha256}.zip`), bytes, { mode: 0o600 });
    return { blobSha256, fileName: `${name}.skill.zip`, sizeBytes: bytes.length, excluded };
  });

  function attachedTo(sessionKey: string): string[] {
    const row = db.prepare("SELECT skill_ids FROM session_skills WHERE session_key = ?").get(sessionKey) as { skill_ids: string } | undefined;
    return row ? (JSON.parse(row.skill_ids) as string[]) : [];
  }

  return {
    methods,
    /** The archive of an export, for the signed download route; undefined when there is none of that hash. */
    exportBlob(sha256: string): Buffer | undefined {
      const file = join(exportsDir, `${sha256}.zip`);
      return /^[0-9a-f]{64}$/.test(sha256) && existsSync(file) ? readFileSync(file) : undefined;
    },
    dropConnection: (connection: Connection) => void subscribers.delete(connection),
    /** The names of the skills a session has attached; what the relay and the usage records may want to know. */
    attachedTo,
    /**
     * The `SKILL.md` files of the skills a session has attached, as absolute paths: the relay tells the runtime to read
     * them. A skill that is gone, turned off or no longer valid is left out.
     */
    skillFiles(sessionKey: string): Array<{ name: string; file: string }> {
      const ids = attachedTo(sessionKey);
      if (!ids.length) return [];
      const all = locate(false);
      const out: Array<{ name: string; file: string }> = [];
      for (const id of ids) {
        const found = all.find((entry) => entry.record.skillId === id) ?? all.find((entry) => entry.record.name === id && entry.record.status === "ok");
        if (!found || found.record.status !== "ok" || !found.record.enabled) continue;
        out.push({ name: found.record.name, file: resolve(found.folder.dir, "SKILL.md") });
      }
      return out;
    },
  };
}

export type SkillService = ReturnType<typeof createSkillService>;

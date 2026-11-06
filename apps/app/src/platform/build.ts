import manifest from "../../../desktop/package.json" with { type: "json" };
import { readRecord } from "./buildRecord.ts";

/** The product's version. `apps/desktop/package.json` is the one place it is written; every platform shows this value. */
export const APP_VERSION: string = manifest.version;
/** What a web or desktop build knows about itself, written beside it by `scripts/finish-web-export.mjs`. */
export type BuildInfo = { version: string; buildId: string; builtAt_ms: number; /** `false`: this build is not kept for offline use (made with `--no-worker`) and registers no service worker. */ offline?: boolean };

let pending: Promise<BuildInfo | null> | null = null;
/** The record of the running build; `null` in development and on the mobile apps, which have no such file. */
export function buildInfo(): Promise<BuildInfo | null> {
  pending ??= (async () => {
    if (typeof document === "undefined") return null;
    const value = ((await readRecord("/build.json")) ?? {}) as Partial<BuildInfo>;
    return typeof value.version === "string" && typeof value.buildId === "string" && typeof value.builtAt_ms === "number" ? { version: value.version, buildId: value.buildId, builtAt_ms: value.builtAt_ms, ...(value.offline === false ? { offline: false } : {}) } : null;
  })().catch(() => null);
  return pending;
}

export type LicenceEntry = { name: string; version: string; licence: string; homepage?: string; author?: string };
/** The third-party packages of the running build, from the list written with it; `null` where the build has none. */
export async function licenceList(): Promise<LicenceEntry[] | null> {
  if (typeof document === "undefined") return null;
  const value = ((await readRecord("/licences.json")) ?? {}) as { packages?: LicenceEntry[] };
  return Array.isArray(value.packages) ? value.packages : null;
}

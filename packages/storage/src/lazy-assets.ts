import { setLocal, updateAsset, type Commit, type CommitContext } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { createSha256, type HasherFactory } from "./hash.ts";
import type { StoragePort } from "./port.ts";

/** What `media-library.Media probing` reads from a file; the storage package only persists it. */
export type ProbeResult = { canDecode: boolean | null; fields: Record<string, unknown> };
export type LazyAssetOptions = {
  port: StoragePort;
  /** Probes one asset of the project (the media library's prober). */
  probe: (assetId: string) => Promise<ProbeResult>;
  context: () => CommitContext;
  hasher?: HasherFactory;
};

/**
 * Completes the assets that came from OpenCut classic. `contentHash` and the device-local `canDecode` and
 * `needsProbe` are filled lazily: on the first load one background job per asset computes the SHA-256, probes the
 * file and persists the result by non-history updates, clearing `needsProbe` — so a second load does not probe again.
 * Returns the document after the updates and the commits (their patches go to the save manager).
 */
export async function completeMigratedAssets(document: ProjectDocument, options: LazyAssetOptions): Promise<{ document: ProjectDocument; commits: Commit[]; probed: string[] }> {
  const projectId = document.metadata.id, commits: Commit[] = [], probed: string[] = [];
  let current = document;
  const pending = Object.entries(((document as { local?: { media?: Record<string, { needsProbe?: boolean }> } }).local?.media) ?? {}).filter(([, entry]) => entry?.needsProbe === true).map(([assetId]) => assetId);
  for (const assetId of pending) {
    const asset = current.media.assets.find((entry) => entry.id === assetId);
    // An asset whose bytes are not on this device stays marked: it is probed when the file arrives.
    if (!asset || !(await options.port.hasMedia(projectId, assetId))) continue;
    let contentHash = (await options.port.mediaInfo(projectId, assetId))?.contentHash;
    if (!contentHash) {
      const hasher = (options.hasher ?? createSha256)();
      for await (const chunk of options.port.readMediaStream(projectId, assetId)) hasher.update(chunk);
      contentHash = hasher.digestHex();
    }
    const result = await options.probe(assetId);
    const commit = updateAsset(current, options.context(), assetId, { ...result.fields, contentHash }, false);
    current = setLocal(commit.document, (local) => {
      const media = (local.media ?? {}) as Record<string, Record<string, unknown>>;
      media[assetId] = { ...media[assetId], needsProbe: false, canDecode: result.canDecode };
      local.media = media;
    });
    commits.push({ ...commit, document: current });
    probed.push(assetId);
  }
  return { document: current, commits, probed };
}

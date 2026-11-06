/** Wait for the host's canonical asset patch to reach the local project before making a timeline command. */
export function createNativeImportPlacement(add: (assetIds: string[], overlay: boolean) => void) {
  const pending: { assetIds: string[]; overlay: boolean }[] = [];
  const ready = (assetIds: string[], hasAsset: (assetId: string) => boolean) => assetIds.every(hasAsset);
  const flush = (hasAsset: (assetId: string) => boolean) => {
    for (let index = 0; index < pending.length;) {
      const entry = pending[index]!;
      if (!ready(entry.assetIds, hasAsset)) { index++; continue; }
      pending.splice(index, 1);
      add(entry.assetIds, entry.overlay);
    }
  };
  return {
    request(assetIds: string[], overlay: boolean, hasAsset: (assetId: string) => boolean): void {
      if (assetIds.length === 0) return;
      if (ready(assetIds, hasAsset)) add(assetIds, overlay);
      else pending.push({ assetIds: [...assetIds], overlay });
    },
    flush,
    get pendingCount() { return pending.length; },
  };
}


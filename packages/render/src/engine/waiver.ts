/**
 * "Export anyway" leaves media out of a film — but only the media a person was SHOWN BY NAME and waived (the pre-flight's
 * items), never whatever else turns out to be missing or undecodable while the film is written: that still fails the
 * export by the clip's name. `waivedAssetIds` are those named assets. A request that allows missing media and names
 * none (a caller that has no pre-flight: a draft render) leaves out whatever is missing, as before.
 */
export type MediaWaiver = { allowMissingMedia?: boolean; waivedAssetIds?: readonly string[] };

/** Whether this asset may be left out of the render the request asks for. */
export function mediaWaived(request: MediaWaiver, assetId: string | undefined): boolean {
  if (request.allowMissingMedia !== true) return false;
  if (request.waivedAssetIds === undefined) return true;
  return assetId !== undefined && request.waivedAssetIds.includes(assetId);
}

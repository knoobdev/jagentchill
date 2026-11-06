/** A React Native Image can read a data URI; the native Blob URL implementation cannot wrap typed arrays. */
export function nativeImageUrl(bytes: Uint8Array, mime: string, encode: (bytes: Uint8Array) => string): string {
  return `data:${mime};base64,${encode(bytes)}`;
}

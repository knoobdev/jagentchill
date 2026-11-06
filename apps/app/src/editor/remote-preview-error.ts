/** Connection failures mean the host is unreachable; a host renderer failure must retain its own server message. */
export function remotePreviewError(message: string): string {
  return /network|timeout|connection|econn|gateway_unreachable|connection_closed/i.test(message) ? "Host unreachable" : message;
}


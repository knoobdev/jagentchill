const EDGE_LENGTH = 11;

/** Keep short links intact; show long offers in full while editing and middle-elide them when idle. */
export function pairingLinkDisplay(value: string, focused: boolean): string {
  if (focused || value.length <= EDGE_LENGTH * 2 + 1) return value;
  return `${value.slice(0, EDGE_LENGTH)}…${value.slice(-EDGE_LENGTH)}`;
}

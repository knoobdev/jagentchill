export const DEFAULT_SERVER_PORT = 18910;
/** The configured port and the twenty after it. */
export const PORT_RANGE = 20;

export type PortChoice = { ok: true; serverPort: number; gatewayPort: number } | { ok: false; message: string; from: number; to: number };

/**
 * Picks the two loopback ports of the built-in host: the server's port — the ports of the last run first, then the
 * configured one, then the next free one in ascending order — and the Gateway's, the next free port after it. A port
 * in use is skipped whatever answers on it: the supervisor never attaches to a process it did not start.
 */
export async function choosePorts(input: { configured?: number; remembered?: { serverPort: number; gatewayPort: number }; isFree(port: number): Promise<boolean> }): Promise<PortChoice> {
  const from = input.configured ?? DEFAULT_SERVER_PORT, to = from + PORT_RANGE;
  const inRange = (port: number) => Number.isInteger(port) && port >= from && port <= to;
  const cache = new Map<number, Promise<boolean>>();
  const free = (port: number) => {
    if (!cache.has(port)) cache.set(port, input.isFree(port));
    return cache.get(port)!;
  };
  const remembered = input.remembered;
  const validRemembered = remembered && inRange(remembered.serverPort) && inRange(remembered.gatewayPort) && remembered.gatewayPort > remembered.serverPort;
  if (validRemembered
    && (await free(remembered.serverPort)) && (await free(remembered.gatewayPort))) {
    return { ok: true, serverPort: remembered.serverPort, gatewayPort: remembered.gatewayPort };
  }
  // A persisted desktop pair is user-visible to paired devices. If a foreign process has taken one
  // of its ports, move forward from that pair; never silently fall back to the standalone default.
  const searchFrom = validRemembered ? remembered.serverPort + 1 : from;
  for (let serverPort = searchFrom; serverPort < to; serverPort++) {
    if (!(await free(serverPort))) continue;
    for (let gatewayPort = serverPort + 1; gatewayPort <= to; gatewayPort++) {
      if (await free(gatewayPort)) return { ok: true, serverPort, gatewayPort };
    }
    break;
  }
  return { ok: false, message: `No free port between ${searchFrom} and ${to}`, from: searchFrom, to };
}

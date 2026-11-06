/** How long a file the build wrote about itself may take to arrive before the app goes on without it. */
export const RECORD_TIMEOUT_MS = 8000;

/**
 * Reads a JSON file written beside the build (`build.json`, `licences.json`). A build without it (a plain export, a
 * server that answers 404 or with its page, a request that never ends) is "no record", at once and for good: the answer
 * is always read to its end — a body left unread keeps the request open, and a page with an open request never becomes
 * idle — and a request that does not answer is given up after `timeout_ms`.
 */
export async function readRecord(path: string, options: { fetch?: typeof fetch; timeout_ms?: number } = {}): Promise<unknown | null> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), options.timeout_ms ?? RECORD_TIMEOUT_MS);
  try {
    const response = await (options.fetch ?? fetch)(path, { signal: stop.signal });
    const text = await response.text();
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("json")) return null;
    return JSON.parse(text) as unknown;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

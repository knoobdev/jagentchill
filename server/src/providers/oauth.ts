import { createHash, randomBytes } from "node:crypto";
import type { HttpFetch } from "./http.ts";

/**
 * Sign-in with OpenRouter under this product's own identity (https://openrouter.ai/docs/use-cases/oauth-pkce): the
 * person authorises at `https://openrouter.ai/auth` with a `callback_url` (a localhost address on any port is accepted),
 * an S256 `code_challenge` and a `state` that comes back unchanged; the code is exchanged at `/api/v1/auth/keys` for an
 * API key the person controls. Without a `callback_url` the page shows the code instead of redirecting, for hosts whose
 * loopback address the browser cannot reach. The key is then stored like a typed one and handed to the CLIs that can
 * use it (OpenCode, Codex).
 */
const TIMEOUT_MS = 20_000;
const b64url = (bytes: Buffer) => bytes.toString("base64url");

export function createPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()), state: b64url(randomBytes(24)) };
}

/** A failure of a provider's sign-in service, with the HTTP status and a text that holds no credential. */
export class OAuthError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson(response: { status: number; json(): Promise<unknown> }): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}
const describe = (body: Record<string, unknown>): string => {
  const error = body.error;
  const text = typeof error === "string" ? error : error && typeof error === "object" ? String((error as { message?: unknown }).message ?? "") : "";
  return [text, typeof body.error_description === "string" ? body.error_description : ""].filter(Boolean).join(": ").slice(0, 200);
};

export const OPENROUTER_ORIGIN = "https://openrouter.ai";
export const OPENROUTER_CALLBACK_PATH = "/jagentchill/v1/oauth/openrouter/callback";

export function openRouterAuthorizeUrl(opts: { callbackUrl?: string; challenge: string; state: string; keyLabel: string }): string {
  const url = new URL(`${OPENROUTER_ORIGIN}/auth`);
  if (opts.callbackUrl) url.searchParams.set("callback_url", opts.callbackUrl);
  url.searchParams.set("code_challenge", opts.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("key_label", opts.keyLabel);
  if (opts.callbackUrl) url.searchParams.set("state", opts.state);
  return url.toString();
}

/** Exchanges the authorisation code for the person's API key. The key is returned to the caller only; it is never logged. */
export async function openRouterExchange(http: HttpFetch, opts: { code: string; verifier: string }): Promise<string> {
  const response = await http(`${OPENROUTER_ORIGIN}/api/v1/auth/keys`, {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({ code: opts.code, code_verifier: opts.verifier, code_challenge_method: "S256" }),
  });
  const body = await readJson(response);
  if (!response.ok || typeof body.key !== "string" || body.key.length < 8) throw new OAuthError(response.status, describe(body) || `OpenRouter answered HTTP ${response.status}`);
  return body.key;
}

/** `?code=…&state=…` of a pasted callback address, or the bare code. */
export function readPastedCode(text: string): { code: string; state?: string } {
  const trimmed = text.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const code = url.searchParams.get("code");
      if (code) return { code, ...(url.searchParams.get("state") ? { state: url.searchParams.get("state")! } : {}) };
    } catch {
      // Not an address after all: taken as the code itself.
    }
  }
  return { code: trimmed };
}

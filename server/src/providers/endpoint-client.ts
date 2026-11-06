import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { TLSSocket } from "node:tls";
import type { EndpointDraft } from "@jagentchill/protocol";
import { ProtocolError } from "../errors.ts";
import type { SecretStore } from "../secrets/store.ts";

const MAX_BODY_BYTES = 8 * 1024 * 1024;

export type AddressClass = "loopback" | "private" | "tailnet" | "public";

export function classifyAddress(address: string): AddressClass {
  if (address === "::1" || address.startsWith("127.")) return "loopback";
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(address.replace(/^::ffff:/, ""));
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127) return "loopback";
    if (a === 100 && b >= 64 && b <= 127) return "tailnet";
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return "private";
    return "public";
  }
  const lower = address.toLowerCase();
  if (lower.startsWith("fd7a:115c:a1e0")) return "tailnet";
  if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80")) return "private";
  return "public";
}

export type EndpointResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  /** Milliseconds until the first body byte, and how many separate chunks arrived. */
  firstByte_ms: number;
  total_ms: number;
  chunks: number;
  tls?: { subject: string; issuer: string; authorized: boolean; selfSigned: boolean };
};

export type ResolvedAddress = { address: string; addressClass: AddressClass };

/**
 * The server's own client for an endpoint record: discovery, the connection test and capabilities the server calls
 * itself. Secrets are read on the host at request time; neither a header value nor a query value is ever logged.
 */
export class EndpointClient {
  private readonly secrets: SecretStore;

  constructor(secrets: SecretStore) {
    this.secrets = secrets;
  }

  private secretValue(name: string): string {
    const value = this.secrets.read(name);
    if (value === undefined) throw new ProtocolError("INVALID_PARAMS", `The secret ${name} does not exist on this host.`, { details: { secretName: name } });
    return value;
  }

  private value(entry: string | { secret: string }): string {
    return typeof entry === "string" ? entry : this.secretValue(entry.secret);
  }

  headersOf(endpoint: EndpointDraft): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [name, entry] of Object.entries(endpoint.headers ?? {})) headers[name] = this.value(entry);
    if (endpoint.auth.mode !== "none" && endpoint.auth.secretName) {
      const secret = this.secretValue(endpoint.auth.secretName);
      if (endpoint.auth.mode === "bearer") headers.authorization = `Bearer ${secret}`;
      else headers[endpoint.auth.headerName ?? "x-api-key"] = `${endpoint.auth.prefix ?? ""}${secret}`;
    }
    if (endpoint.dialect === "anthropic-messages" && !headers["anthropic-version"]) headers["anthropic-version"] = "2023-06-01";
    return headers;
  }

  urlOf(endpoint: EndpointDraft, path: string): URL {
    const url = new URL(endpoint.baseUrl.replace(/\/+$/, "") + path);
    for (const [name, entry] of Object.entries(endpoint.query ?? {})) url.searchParams.set(name, this.value(entry));
    return url;
  }

  /** DNS and address class. A private or unencrypted target is reached only when the record allows it. */
  async resolve(endpoint: EndpointDraft): Promise<ResolvedAddress> {
    const url = new URL(endpoint.baseUrl);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    let address: string;
    try {
      address = isIP(hostname) ? hostname : (await lookup(hostname)).address;
    } catch {
      throw new ProtocolError("runtime/endpoint-unreachable", `The host name ${hostname} could not be resolved.`, { retryable: true });
    }
    const addressClass = classifyAddress(address);
    if (addressClass !== "public" && !endpoint.allowPrivateNetwork) {
      throw new ProtocolError("EGRESS_BLOCKED", "This address is on a private network. Turn on “Allow unencrypted connection on a private network” to use it.", { details: { addressClass } });
    }
    if (url.protocol === "http:" && addressClass === "public") {
      throw new ProtocolError("EGRESS_BLOCKED", "An unencrypted connection is allowed on a private network only.", { details: { addressClass } });
    }
    return { address, addressClass };
  }

  async send(endpoint: EndpointDraft, path: string, init: { method: "GET" | "POST"; body?: unknown; timeoutMs?: number } = { method: "GET" }): Promise<EndpointResponse> {
    await this.resolve(endpoint);
    const url = this.urlOf(endpoint, path);
    const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
    const headers = { accept: "application/json, text/event-stream", ...this.headersOf(endpoint), ...(payload ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) } : {}) };
    const tls = endpoint.tls;
    const started = performance.now();
    return await new Promise<EndpointResponse>((resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
        method: init.method, headers, timeout: init.timeoutMs ?? endpoint.timeoutSeconds * 1000,
        ...(url.protocol === "https:" ? {
          ...(tls?.caSecretName ? { ca: this.secretValue(tls.caSecretName) } : {}),
          ...(tls?.clientCertSecretName ? { cert: this.secretValue(tls.clientCertSecretName) } : {}),
          ...(tls?.clientKeySecretName ? { key: this.secretValue(tls.clientKeySecretName) } : {}),
          ...(tls?.serverName ? { servername: tls.serverName } : {}),
          rejectUnauthorized: !tls?.allowSelfSigned,
        } : {}),
      }, (response) => {
        const parts: Buffer[] = [];
        let size = 0;
        let firstByte = 0;
        let chunks = 0;
        // Read now: by the time the body has ended the response may have let go of its socket (keep-alive), and it is null.
        const socket = response.socket as TLSSocket | null;
        const certificate = url.protocol === "https:" ? socket?.getPeerCertificate?.() : undefined;
        const authorized = socket?.authorized ?? false;
        response.on("data", (chunk: Buffer) => {
          if (!firstByte) firstByte = performance.now() - started;
          chunks += 1;
          size += chunk.length;
          if (size > MAX_BODY_BYTES) return void request.destroy(new ProtocolError("PAYLOAD_TOO_LARGE", "The endpoint answered with more than 8 MiB."));
          parts.push(chunk);
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(parts).toString("utf8"), firstByte_ms: Math.round(firstByte),
            total_ms: Math.round(performance.now() - started), chunks,
            ...(certificate?.subject ? { tls: { subject: String(certificate.subject.CN ?? ""), issuer: String(certificate.issuer?.CN ?? ""), authorized, selfSigned: !authorized && !!tls?.allowSelfSigned } } : {}),
          });
        });
        response.on("error", reject);
      });
      request.on("timeout", () => request.destroy(new ProtocolError("TIMEOUT", "The endpoint did not answer in time.", { retryable: true })));
      // The cause is reported by class only: an error text can repeat the address with its query values.
      request.on("error", (err) => reject(err instanceof ProtocolError ? err : new ProtocolError("runtime/endpoint-unreachable", `Unable to reach the endpoint (${(err as NodeJS.ErrnoException).code ?? "connection failed"}).`, { retryable: true })));
      request.end(payload);
    });
  }
}

/** The model-list route of each dialect. */
export function modelListPath(endpoint: EndpointDraft, override?: string): string {
  if (override) return override;
  if (endpoint.dialect === "anthropic-messages") return /\/v1\/?$/.test(endpoint.baseUrl) ? "/models" : "/v1/models";
  if (endpoint.dialect === "google-generative-ai") return "/v1beta/models";
  if (endpoint.dialect === "ollama") return "/api/tags";
  return "/models";
}

export type DiscoveredModel = { id: string; label: string; contextWindow?: number; input?: ("text" | "image" | "audio" | "video")[]; supportsTools?: boolean };

/** Reads a model list leniently: a `data[]` or `models[]` array of objects with `id` or `name`. */
export function parseModelList(body: string): DiscoveredModel[] | undefined {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return undefined;
  }
  const root = json as { data?: unknown; models?: unknown };
  const list = Array.isArray(root?.data) ? root.data : Array.isArray(root?.models) ? root.models : Array.isArray(json) ? json : undefined;
  if (!list) return undefined;
  const out: DiscoveredModel[] = [];
  for (const item of list.slice(0, 5000) as Array<Record<string, unknown>>) {
    const raw = typeof item?.id === "string" ? item.id : typeof item?.name === "string" ? item.name : undefined;
    if (!raw) continue;
    const id = raw.replace(/^models\//, "");
    const context = [item.context_length, item.context_window, item.contextWindow, item.inputTokenLimit].find((value) => typeof value === "number" && value >= 1024) as number | undefined;
    const modalities = (item.architecture as { input_modalities?: unknown } | undefined)?.input_modalities;
    const input = Array.isArray(modalities) ? modalities.filter((kind): kind is "text" | "image" | "audio" | "video" => ["text", "image", "audio", "video"].includes(kind as string)) : undefined;
    const parameters = item.supported_parameters;
    out.push({
      id, label: typeof item.display_name === "string" ? item.display_name : typeof item.displayName === "string" ? item.displayName : id,
      ...(context ? { contextWindow: context } : {}), ...(input?.length ? { input } : {}),
      ...(Array.isArray(parameters) ? { supportsTools: parameters.includes("tools") } : {}),
    });
  }
  return out;
}

import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const REQUEST_TIMEOUT_MS = 15_000;
const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";

const ClaudeCredentialsSchema = z.object({
  claudeAiOauth: z.object({
    accessToken: z.string().min(1),
    subscriptionType: z.string().optional(),
    rateLimitTier: z.string().optional(),
  }).optional(),
});
const CodexCredentialsSchema = z.object({
  tokens: z.object({ access_token: z.string().min(1), account_id: z.string().optional() }).optional(),
});

export type CliAccountWindow = { id: string; label: string; usedPct?: number; resetsAt_ms?: number };
export type CliAccountBalance = { id: string; label: string; remaining: number; unit: "usd" };
export type CliAccountReport =
  | { state: "absent" }
  | { state: "sign-in-again" }
  | { state: "available"; providerId: "anthropic" | "openai"; displayName: string; planLabel?: string; windows: CliAccountWindow[]; balances?: CliAccountBalance[]; extraUsageEnabled?: boolean };

export type CliAccountReportOptions = {
  /** Tests inject these so no real credential store or CLI account is read. */
  readClaudeCredentials?: () => Promise<unknown | null>;
  readCodexCredentials?: () => Promise<unknown | null>;
  fetch?: typeof fetch;
  platform?: NodeJS.Platform;
  home?: string;
  claudeHome?: string;
  codexHome?: string;
};

const finiteNumber = (value: unknown): number | undefined => {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
};
const resetDate = (value: unknown): number | undefined => {
  if (typeof value === "string") { const ms = Date.parse(value); return Number.isFinite(ms) ? ms : undefined; }
  const seconds = finiteNumber(value);
  return seconds === undefined ? undefined : seconds * 1000;
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};

function reportWindow(id: string, label: string, used: unknown, reset: unknown): CliAccountWindow {
  const usedPct = finiteNumber(used), resetsAt_ms = resetDate(reset);
  return { id, label, ...(usedPct === undefined ? {} : { usedPct }), ...(resetsAt_ms === undefined ? {} : { resetsAt_ms }) };
}

function mapClaudeReport(value: unknown, subscriptionType?: string, rateLimitTier?: string): Omit<Extract<CliAccountReport, { state: "available" }>, "state" | "providerId" | "displayName"> {
  const report = record(value), windows: CliAccountWindow[] = [];
  const add = (key: string, label: string) => {
    if (report[key] == null) return;
    const row = record(report[key]);
    windows.push(reportWindow(key, label, row.utilization, row.resets_at));
  };
  add("five_hour", "Session");
  add("seven_day", "Weekly");
  add("seven_day_opus", "Weekly · Opus");
  add("seven_day_omelette", "Weekly · Omelette");
  if (Array.isArray(report.limits)) {
    for (const [index, raw] of report.limits.entries()) {
      const limit = record(raw), scope = record(limit.scope), model = record(scope.model), surface = record(scope.surface);
      if (limit.kind !== "weekly_scoped") continue;
      const name = typeof model.display_name === "string" ? model.display_name : typeof surface.display_name === "string" ? surface.display_name : undefined;
      if (name) windows.push(reportWindow(`weekly_scoped_${index}`, `Weekly · ${name}`, limit.percent, limit.resets_at));
    }
  }
  const subscription = subscriptionType ? `${subscriptionType[0]!.toUpperCase()}${subscriptionType.slice(1)}` : undefined;
  const tier = rateLimitTier?.split("_").at(-1);
  const extraUsage = record(report.extra_usage);
  return {
    ...(subscription ? { planLabel: tier ? `${subscription} ${tier}` : subscription } : {}),
    windows,
    ...(typeof extraUsage.is_enabled === "boolean" ? { extraUsageEnabled: extraUsage.is_enabled } : {}),
  };
}

function mapCodexReport(value: unknown): Omit<Extract<CliAccountReport, { state: "available" }>, "state" | "providerId" | "displayName"> {
  const report = record(value), rate = record(report.rate_limit), review = record(report.code_review_rate_limit), windows: CliAccountWindow[] = [];
  const windowLabel = (row: Record<string, unknown>, fallback: string): string => {
    const minutes = finiteNumber(row.window_minutes);
    const seconds = finiteNumber(row.limit_window_seconds ?? row.window_seconds) ?? (minutes === undefined ? undefined : minutes * 60);
    if (seconds === undefined || seconds <= 0) return fallback;
    if (seconds >= 2 * 60 * 60 && seconds <= 12 * 60 * 60) return "Session";
    if (seconds >= 3 * 86_400 && seconds <= 14 * 86_400) return "Weekly";
    return "Usage";
  };
  const add = (id: string, value: unknown, fallback = "Usage") => {
    if (value == null) return;
    const row = record(value);
    windows.push(reportWindow(id, windowLabel(row, fallback), row.used_percent, row.reset_at));
  };
  add("session", rate.primary_window);
  add("weekly", rate.secondary_window);
  add("code_review", review.primary_window, "Code review");
  const plan = typeof report.plan_type === "string" ? report.plan_type : undefined;
  const credits = record(report.credits), balance = finiteNumber(credits.balance);
  return { ...(plan ? { planLabel: `${plan[0]!.toUpperCase()}${plan.slice(1)}` } : {}), windows, ...(balance === undefined ? {} : { balances: [{ id: "credits", label: "Credits", remaining: balance, unit: "usd" as const }] }) };
}

async function readClaudeKeychain(): Promise<unknown | null> {
  if (process.platform !== "darwin") return null;
  const user = process.env.USER || userInfo().username;
  const account = /^[a-zA-Z0-9._-]+$/.test(user) ? user : "claude-code-user";
  for (const args of [
    ["find-generic-password", "-a", account, "-w", "-s", CLAUDE_KEYCHAIN_SERVICE],
    ["find-generic-password", "-w", "-s", CLAUDE_KEYCHAIN_SERVICE],
  ]) {
    try {
      const { stdout } = await execFileAsync("security", args, { timeout: 2_000 });
      const parsed = JSON.parse(stdout.trim());
      if (ClaudeCredentialsSchema.safeParse(parsed).success) return parsed;
    } catch { /* try the legacy Keychain lookup without an account */ }
  }
  return null;
}

async function readClaudeFile(claudeHome: string): Promise<unknown | null> {
  const path = join(claudeHome, ".credentials.json");
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(await fs.readFile(path, "utf8"));
    return ClaudeCredentialsSchema.safeParse(parsed).success ? parsed : null;
  } catch { return null; }
}

async function readCodexFile(home: string, codexHome: string): Promise<unknown | null> {
  const candidates = [
    ...(process.env.CODEX_HOME ? [join(process.env.CODEX_HOME, "auth.json")] : []),
    join(home, ".config", "codex", "auth.json"),
    join(codexHome, "auth.json"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(await fs.readFile(path, "utf8"));
      if (CodexCredentialsSchema.safeParse(parsed).success) return parsed;
    } catch { /* try the next CLI-owned auth location */ }
  }
  return null;
}

/** Read-only Claude Code/Codex account usage. Credentials never leave this request's memory. */
export function createCliAccountReportFetcher(options: CliAccountReportOptions = {}) {
  const home = options.home ?? homedir();
  const claudeHome = options.claudeHome ?? process.env.CLAUDE_HOME ?? join(home, ".claude");
  const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? join(home, ".codex");
  const readClaude = options.readClaudeCredentials ?? (async () => (await readClaudeFile(claudeHome)) ?? await readClaudeKeychain());
  const readCodex = options.readCodexCredentials ?? (() => readCodexFile(home, codexHome));
  const fetchApi = options.fetch ?? fetch;

  const request = (url: string, init: RequestInit) => fetchApi(url, { ...init, signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

  return async function fetchCliAccountReport(runtimeId: string): Promise<CliAccountReport> {
    if (runtimeId === "claude-code") {
      let rawCredentials: unknown | null;
      try { rawCredentials = await readClaude(); } catch { return { state: "absent" }; }
      const parsed = ClaudeCredentialsSchema.safeParse(rawCredentials);
      const oauth = parsed.success ? parsed.data.claudeAiOauth : undefined;
      if (!oauth?.accessToken) return { state: "absent" };
      let response: Response;
      try {
        response = await request("https://api.anthropic.com/api/oauth/usage", { headers: {
          Authorization: `Bearer ${oauth.accessToken}`, Accept: "application/json", "anthropic-beta": "oauth-2025-04-20",
        } });
      } catch { return { state: "sign-in-again" }; }
      if (response.status === 401 || response.status === 403) return { state: "sign-in-again" };
      if (!response.ok) return { state: "sign-in-again" };
      try {
        const mapped = mapClaudeReport(await response.json(), oauth.subscriptionType, oauth.rateLimitTier);
        return { state: "available", providerId: "anthropic", displayName: "Claude Code", ...mapped };
      } catch { return { state: "sign-in-again" }; }
    }

    if (runtimeId === "codex") {
      let rawCredentials: unknown | null;
      try { rawCredentials = await readCodex(); } catch { return { state: "absent" }; }
      const parsed = CodexCredentialsSchema.safeParse(rawCredentials);
      const auth = parsed.success ? parsed.data : undefined, token = auth?.tokens?.access_token;
      if (!token) return { state: "absent" };
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      };
      if (auth.tokens?.account_id) headers["ChatGPT-Account-Id"] = auth.tokens.account_id;
      let response: Response;
      try { response = await request("https://chatgpt.com/backend-api/wham/usage", { headers }); }
      catch { return { state: "sign-in-again" }; }
      if (response.status === 401 || response.status === 403) return { state: "sign-in-again" };
      if (!response.ok) return { state: "sign-in-again" };
      try {
        const body = await response.text();
        if (body.trim().startsWith("<")) return { state: "sign-in-again" };
        return { state: "available", providerId: "openai", displayName: "Codex", ...mapCodexReport(JSON.parse(body)) };
      } catch { return { state: "sign-in-again" }; }
    }
    return { state: "absent" };
  };
}

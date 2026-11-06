/** The provider rows JAgentDesk derives from an already-fetched account report. */
export type MappedAccountWindow = { id: string; label: string; usedPct?: number; resetsAt_ms?: number };
export type MappedAccountUsage = { planLabel?: string; windows: MappedAccountWindow[]; extraUsageEnabled?: boolean };
export type MeterLocale = "en" | "vi" | "ja";

/** Convert a reported key balance into the same used-percent scale as provider quota windows. */
export function accountBalanceUsedPct(balance: { used?: number; remaining?: number; limit?: number }): number | undefined {
  if (typeof balance.limit !== "number" || balance.limit <= 0) return undefined;
  if (typeof balance.used === "number") return Math.max(0, Math.min(100, balance.used / balance.limit * 100));
  if (typeof balance.remaining === "number") return Math.max(0, Math.min(100, 100 - balance.remaining / balance.limit * 100));
  return undefined;
}

const limitLabels: Record<MeterLocale, { session: string; weekly: string; weeklyModel: string }> = {
  en: { session: "Session", weekly: "Weekly", weeklyModel: "Weekly · {model}" },
  vi: { session: "Phiên", weekly: "Hàng tuần", weeklyModel: "Hàng tuần · {model}" },
  ja: { session: "セッション", weekly: "週間", weeklyModel: "週間 · {model}" },
};

/** Normalize host and vendor window names into the same localized labels. Pure formatting; no account access. */
export function contextLimitLabel(sourceLabel: string, locale: MeterLocale = "en"): string {
  const labels = limitLabels[locale];
  const label = sourceLabel.trim();
  if (["5h", "five_hour", "Session", "session"].includes(label)) return labels.session;
  if (["Week", "week", "weekly", "seven_day", "Weekly"].includes(label)) return labels.weekly;
  const model = /^(?:Weekly|weekly|Week|week)\s*·\s*(.+)$/.exec(label)?.[1];
  if (model) return labels.weeklyModel.replace("{model}", model);
  return label;
}

/** Display a vendor's plan spelling with its conventional capitalization (for example, `plus` → `Plus`). */
export function accountPlanLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value[0]!.toLocaleUpperCase("en-US") + value.slice(1);
}

type UnknownRecord = Record<string, unknown>;
const record = (value: unknown): UnknownRecord => value && typeof value === "object" ? value as UnknownRecord : {};
const numeric = (value: unknown): number | undefined => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};
const resetMs = (value: unknown): number | undefined => {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  const parsed = numeric(value);
  return parsed === undefined ? undefined : parsed * 1000;
};
const planLabel = (subscriptionType: unknown, rateLimitTier: unknown): string | undefined => {
  if (typeof subscriptionType !== "string" || !subscriptionType) return undefined;
  const plan = subscriptionType[0]!.toUpperCase() + subscriptionType.slice(1);
  const tier = typeof rateLimitTier === "string" ? rateLimitTier.split("_").at(-1) : undefined;
  return tier ? `${plan} ${tier}` : plan;
};

/** Maps Claude's fetched quota report and its already-known subscription metadata; this does no IO. */
export function mapClaudeAccountUsage(input: {
  report: unknown;
  subscriptionType?: string;
  rateLimitTier?: string;
  locale?: MeterLocale;
}): MappedAccountUsage {
  const report = record(input.report), windows: MappedAccountWindow[] = [], locale = input.locale ?? "en";
  const add = (id: string, label: string, value: unknown) => {
    if (value == null) return;
    const row = record(value), usedPct = numeric(row.utilization);
    const resetsAt_ms = resetMs(row.resets_at);
    windows.push({ id, label: contextLimitLabel(label, locale), ...(usedPct === undefined ? {} : { usedPct }), ...(resetsAt_ms === undefined ? {} : { resetsAt_ms }) });
  };
  add("five_hour", "Session", report.five_hour);
  add("weekly", "Weekly", report.seven_day);
  add("weekly_model_opus", "Weekly · Opus", report.seven_day_opus);
  add("weekly_model_omelette", "Weekly · Omelette", report.seven_day_omelette);
  if (Array.isArray(report.limits)) {
    for (const [index, raw] of report.limits.entries()) {
      const limit = record(raw);
      if (limit.kind !== "weekly_scoped") continue;
      const scope = record(limit.scope), model = record(scope.model), surface = record(scope.surface);
      const name = typeof model.display_name === "string" ? model.display_name : typeof surface.display_name === "string" ? surface.display_name : undefined;
      if (!name) continue;
      const usedPct = numeric(limit.percent), resetsAt_ms = resetMs(limit.resets_at);
      windows.push({ id: `weekly_scoped_${index}`, label: contextLimitLabel(`Weekly · ${name}`, locale), ...(usedPct === undefined ? {} : { usedPct }), ...(resetsAt_ms === undefined ? {} : { resetsAt_ms }) });
    }
  }
  const extraUsage = record(report.extra_usage);
  return {
    ...(planLabel(input.subscriptionType, input.rateLimitTier) ? { planLabel: planLabel(input.subscriptionType, input.rateLimitTier) } : {}),
    windows,
    ...(typeof extraUsage.is_enabled === "boolean" ? { extraUsageEnabled: extraUsage.is_enabled } : {}),
  };
}

/** Maps a Codex account/rate-limit report after it has been fetched elsewhere; this does no IO. */
export function mapCodexAccountUsage(reportValue: unknown, locale: MeterLocale = "en"): MappedAccountUsage {
  const report = record(reportValue), windows: MappedAccountWindow[] = [];
  const add = (id: string, label: string, value: unknown) => {
    if (value == null) return;
    const row = record(value), usedPct = numeric(row.used_percent), resetsAt_ms = resetMs(row.reset_at);
    windows.push({ id, label: contextLimitLabel(label, locale), ...(usedPct === undefined ? {} : { usedPct }), ...(resetsAt_ms === undefined ? {} : { resetsAt_ms }) });
  };
  const rateLimit = record(report.rate_limit), review = record(report.code_review_rate_limit);
  add("session", "Session", rateLimit.primary_window);
  add("weekly", "Weekly", rateLimit.secondary_window);
  add("code_review", "Code review", review.primary_window);
  return { ...(typeof report.plan_type === "string" ? { planLabel: accountPlanLabel(report.plan_type) } : {}), windows };
}

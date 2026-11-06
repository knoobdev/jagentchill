import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import { meterTone, tokensShort, withCompactions, type ChatItem, type Compaction, type SessionContext } from "@jagentchill/app-core";
import { Icon, Popover, Tap, Text, control, radius, space, useTheme, useToast, type ColorToken } from "@jagentchill/ui";
import type { PlanUsage } from "@jagentchill/protocol";
import { useHost } from "../host";
import { useT } from "../locale";
import { reasonOf } from "./errors";
import { accountBalanceUsedPct, accountPlanLabel, contextLimitLabel, type MeterLocale } from "./contextUsageMapping";

export type SessionContextApi = {
  state: SessionContext | null; busy: boolean;
  /** Compacts the session now; resolves `false` when nothing was compacted. */
  compact(): Promise<boolean>;
  /** The share of the window this session compacts at; `null` follows the host's default again. */
  setAuto(pct: number | null): Promise<void>;
  /** Doubles this session's token limit, so that a session stopped at its limit can go on. */
  raiseLimit(): Promise<void>;
  /** The timeline with a "Conversation compacted" divider at every compaction. */
  marked(items: ChatItem[]): ChatItem[];
};

/** The context window of one session as the host reports it: the meter's numbers, the compaction setting, the compactions. */
export function useSessionContext(sessionKey: string | undefined): SessionContextApi {
  const t = useT();
  const toast = useToast();
  const { connection, onEvent } = useHost();
  const [state, setState] = useState<SessionContext | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setState(null);
    if (!connection || !sessionKey) return;
    let cancelled = false;
    void connection.call<SessionContext>("jagentchill.session.context.get", { sessionKey }).then((next) => { if (!cancelled) setState(next); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [connection, sessionKey]);
  useEffect(() => onEvent((event) => {
    if (event.event === "jagentchill.session.context" && event.payload?.sessionKey === sessionKey) setState(event.payload as SessionContext);
  }), [onEvent, sessionKey]);
  const label = useCallback((entry: Compaction) => {
    const title = entry.reason === "auto" ? t("Conversation compacted automatically") : t("Conversation compacted");
    if (entry.tokensBefore === null) return title;
    return entry.tokensAfter === null ? `${title} · ${t("{before} tokens before", { before: tokensShort(entry.tokensBefore) })}` : `${title} · ${t("{before} → {after} tokens", { before: tokensShort(entry.tokensBefore), after: tokensShort(entry.tokensAfter) })}`;
  }, [t]);
  return {
    state, busy,
    async compact() {
      if (!connection || !sessionKey || busy) return false;
      setBusy(true);
      try {
        const result = await connection.call<{ compacted: boolean; reason?: string }>("jagentchill.session.compact", { sessionKey });
        if (!result.compacted) toast.show({ kind: "info", message: t("There is nothing to compact yet") });
        return result.compacted;
      } catch (error) { toast.show({ kind: "error", message: reasonOf(error) }); return false; }
      finally { setBusy(false); }
    },
    async setAuto(pct) {
      if (!connection || !sessionKey) return;
      try { setState(await connection.call<SessionContext>("jagentchill.session.context.set", { sessionKey, autoCompactPct: pct })); }
      catch (error) { toast.show({ kind: "error", message: reasonOf(error) }); }
    },
    async raiseLimit() {
      const limit = state?.limits?.session;
      if (!connection || !sessionKey || !limit) return;
      try { setState(await connection.call<SessionContext>("jagentchill.session.context.set", { sessionKey, tokenLimit: limit.limitTokens * 2 })); }
      catch (error) { toast.show({ kind: "error", message: reasonOf(error) }); }
    },
    marked: (items) => withCompactions(items, state?.compactions ?? [], label),
  };
}

const RING = 16, STROKE = 2.5;
/** The ring of the meter: a track and an arc of the used share, starting at twelve o'clock. */
function Ring(props: { pct: number; color: string; track: string }) {
  const r = (RING - STROKE) / 2, around = 2 * Math.PI * r, used = (Math.max(0, Math.min(100, props.pct)) / 100) * around;
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" width="${RING}" height="${RING}" viewBox="0 0 ${RING} ${RING}"><circle cx="${RING / 2}" cy="${RING / 2}" r="${r}" fill="none" stroke="${props.track}" stroke-width="${STROKE}"/>`
    + `<circle cx="${RING / 2}" cy="${RING / 2}" r="${r}" fill="none" stroke="${props.color}" stroke-width="${STROKE}" stroke-linecap="round" stroke-dasharray="${used} ${around}" transform="rotate(-90 ${RING / 2} ${RING / 2})"/></svg>`;
  return <SvgXml xml={xml} width={RING} height={RING} aria-hidden />;
}

const TONE: Record<ReturnType<typeof meterTone>, { ring: ColorToken }> = {
  normal: { ring: "text/secondary" }, warning: { ring: "warning" }, danger: { ring: "danger" },
};

/**
 * The context window meter of the composer: a ring and the percentage of the model's window the last request filled,
 * calm below 70 %, a warning from 70 %, danger from 90 %. It opens the numbers, the session's automatic compaction and
 * "Compact now". Nothing is drawn while the runtime has reported no token counts.
 */
export function ContextMeter(props: { api?: SessionContextApi; running?: boolean; mayAct?: boolean; runtimeLabel: string; sessionKey?: string; runtimeId?: string; providerId?: string; modelId?: string; contextWindow?: number; reports?: "tokens-and-cost" | "tokens" | "none" }) {
  const t = useT();
  const theme = useTheme();
  const { connection } = useHost();
  const anchor = useRef<View>(null);
  const [popoverAnchor, setPopoverAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const openRef = useRef(false);
  const [openCycle, setOpenCycle] = useState(0);
  const pinnedRef = useRef(false);
  const [account, setAccount] = useState<PlanUsage | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [costUnavailableReason, setCostUnavailableReason] = useState<"no-list-price" | null>(null);
  const [costUnavailableModels, setCostUnavailableModels] = useState<string[]>([]);
  const [costHelp, setCostHelp] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const context = props.api?.state?.context;
  const usedTokens = context?.usedTokens ?? 0;
  const maxTokens = context?.maxTokens ?? props.contextWindow;
  const pct = maxTokens ? Math.min(100, Math.round((usedTokens / maxTokens) * 100)) : undefined;
  const tone = pct === undefined ? "normal" : meterTone(pct), colors = TONE[tone];
  const sentence = maxTokens
    ? `${tokensShort(usedTokens)} / ${tokensShort(maxTokens)} ${t("tokens")}`
    : `${usedTokens.toLocaleString(theme.locale)} / — ${t("tokens")}`;
  const updatePopoverAnchor = () => {
    const node = typeof document === "undefined" ? null : [...document.querySelectorAll<HTMLElement>('[data-testid="context-meter"]')]
      .find((candidate) => candidate.getClientRects().length > 0 && candidate.getBoundingClientRect().width > 0);
    const rect = node?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) setPopoverAnchor({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
  };
  const openPopover = () => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = null; updatePopoverAnchor(); if (!openRef.current) setOpenCycle((cycle) => cycle + 1); openRef.current = true; setOpen(true); };
  const closePopover = () => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => { closeTimer.current = null; if (!pinnedRef.current) { openRef.current = false; setOpen(false); } }, 180); };
  const pinPopover = () => { pinnedRef.current = true; setPinned(true); };
  const unpinPopover = () => { pinnedRef.current = false; setPinned(false); };
  const closePinnedPopover = () => { unpinPopover(); openRef.current = false; setOpen(false); };
  const pointerInMeterRegion = (event: PointerEvent | MouseEvent) => {
    const x = event.clientX, y = event.clientY;
    const contains = (rect: DOMRect | undefined) => Boolean(rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
    const visibleRects = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)]
      .map((node) => node.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0);
    const rings = visibleRects('[data-testid="context-meter"]');
    if (rings.some(contains)) return true;
    const bridges = visibleRects('[data-testid="context-meter-hover-bridge"]');
    for (const content of document.querySelectorAll<HTMLElement>('[data-testid="context-popover"]')) {
      const panelRect = content.closest<HTMLElement>('[data-testid="popover"]')?.getBoundingClientRect();
      if (!panelRect || panelRect.width === 0 || panelRect.height === 0) continue;
      for (const ringRect of rings) {
        const horizontalOverlap = panelRect.right > ringRect.left && panelRect.left < ringRect.right;
        const verticalGap = Math.max(0, ringRect.top - panelRect.bottom, panelRect.top - ringRect.bottom);
        if (horizontalOverlap && verticalGap <= 16 && (contains(panelRect) || bridges.some(contains))) return true;
      }
    }
    return false;
  };
  useEffect(() => { if (pinned) { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = null; } }, [pinned]);
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    window.addEventListener("resize", updatePopoverAnchor);
    return () => window.removeEventListener("resize", updatePopoverAnchor);
  }, [open]);
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const onPointerMove = (event: PointerEvent) => {
      if (pointerInMeterRegion(event)) { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = null; }
      else closePopover();
    };
    document.addEventListener("pointermove", onPointerMove, true);
    return () => document.removeEventListener("pointermove", onPointerMove, true);
  }, [open, pinned]);
  useEffect(() => {
    if (!open || !pinned || typeof document === "undefined") return;
    const onPressOutside = (event: Event) => {
      if (pointerInMeterRegion(event as PointerEvent)) return;
      window.setTimeout(closePinnedPopover, 0);
    };
    document.addEventListener("pointerdown", onPressOutside, true);
    document.addEventListener("click", onPressOutside, true);
    return () => { document.removeEventListener("pointerdown", onPressOutside, true); document.removeEventListener("click", onPressOutside, true); };
  }, [open, pinned]);
  useEffect(() => {
    if (!open || !connection) return;
    let live = true;
    setCost(null);
    setCostUnavailableReason(null);
    setAccount(null);
    if (props.providerId) void connection.call<{ providers?: PlanUsage[] }>("jagentchill.usage.plan.list", { providerIds: [props.providerId], ...(props.runtimeId ? { runtimeId: props.runtimeId } : {}) }).then((result) => {
      if (live) setAccount(result.providers?.find((entry) => entry.providerId === props.providerId && (entry.status === "available" || entry.status === "sign-in-required")) ?? null);
    }).catch(() => { if (live) setAccount(null); });
    else setAccount(null);
    if (props.sessionKey) {
      void connection.call<{ session: { sessionCostUsd?: number | null; costUnavailableReason?: "no-list-price"; costUnavailableModels?: string[]; totalCostUsd?: number; totalTokens?: number } }>("jagentchill.usage.session.get", { sessionId: props.sessionKey }).then((result) => {
        if (!live) return;
        const session = result.session;
        const value = session.sessionCostUsd === null ? undefined
          : typeof session.sessionCostUsd === "number" ? session.sessionCostUsd
            : session.totalTokens === 0 ? 0
              : props.reports === "tokens-and-cost" ? session.totalCostUsd : undefined;
        setCost(typeof value === "number" && Number.isFinite(value) ? value : null);
        setCostUnavailableReason(session.costUnavailableReason ?? null);
        setCostUnavailableModels(session.costUnavailableModels ?? []);
      }).catch(() => { if (live) setCost(null); });
    } else setCost(null);
    return () => { live = false; };
  }, [connection, open, props.modelId, props.providerId, props.reports, props.runtimeId, props.sessionKey]);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  const formatReset = (at?: number) => {
    if (!at) return null;
    const minutes = Math.max(0, Math.ceil((at - Date.now()) / 60_000));
    return minutes >= 24 * 60 ? `${Math.ceil(minutes / (24 * 60))}d` : minutes >= 60 ? `${Math.ceil(minutes / 60)}h` : `${minutes}m`;
  };
  const accountRows = account?.windows ?? [];
  const balanceRows = account?.balances ?? [];
  const ageMinutes = account?.fetched_ms ? Math.max(0, Math.floor((Date.now() - account.fetched_ms) / 60_000)) : 0;
  const accountAge = ageMinutes > 10 ? new Intl.RelativeTimeFormat(theme.locale, { numeric: "auto" }).format(-ageMinutes, "minute") : null;
  const accountName = props.runtimeId === "claude-code" || props.runtimeId === "claude" ? t("Claude Code")
    : props.runtimeId === "codex" || account?.providerId === "openai" || account?.providerId === "codex" ? t("Codex")
      : account?.providerId === "anthropic" || account?.providerId === "claude" ? t("Claude Code") : account?.displayName || props.runtimeLabel;
  const signInCli = props.runtimeId === "claude-code" ? t("Claude Code") : t("Codex");
  const reportedExtraUsage = account?.details.find((detail) => detail.label.toLowerCase() === "extra usage");
  const extraUsageText = reportedExtraUsage?.value ?? (account?.extraUsage ? [t("Enabled"), ...(account.extraUsage.used !== undefined && account.extraUsage.limit !== undefined ? [account.extraUsage.unit === "usd" ? `${new Intl.NumberFormat(theme.locale, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(account.extraUsage.used)} / ${new Intl.NumberFormat(theme.locale, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(account.extraUsage.limit)}` : `${account.extraUsage.used.toLocaleString(theme.locale)} / ${account.extraUsage.limit.toLocaleString(theme.locale)} ${account.extraUsage.unit}`] : [])].join(" · ") : null);
  return (
    <>
      <Tap ref={anchor} role="button" label={pct === undefined ? t("Context window") : `${t("Context window")}: ${pct}%`} expanded={open} testID="context-meter" aria={{ dataSet: { tone, pct: pct === undefined ? "unknown" : String(pct), pinned: String(pinned) } }} onPress={() => { if (pinnedRef.current) { unpinPopover(); openPopover(); } else { pinPopover(); openPopover(); } }} onFocus={openPopover} onBlur={closePopover} onHoverIn={openPopover} onHoverOut={closePopover}
        style={(interaction) => ({ height: control.sm, paddingHorizontal: space[1.5], borderRadius: radius.full, flexDirection: "row", alignItems: "center", gap: space[1], backgroundColor: interaction.hovered || interaction.pressed ? theme.color("bg/hover") : "transparent" })}>
        <Ring pct={pct ?? 0} color={theme.color(pct === undefined ? "border/strong" : colors.ring)} track={theme.color("border/strong")} />
      </Tap>
      <Popover key={openCycle} open={open} onClose={closePinnedPopover} anchor={popoverAnchor ?? anchor} side="top" align="center" width={280} hoverBridge scrim="none" label={t("Context window")} title={t("Context window")}>
        <View testID="context-popover" {...({ onHoverIn: () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, onHoverOut: closePopover, onPointerEnter: () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, onPointerLeave: closePopover } as object)} style={{ width: theme.compact ? undefined : 280 }}>
          <View style={{ gap: space[1.5], padding: space[2] }}>
            <Text testID="context-block-title" variant="body" style={{ fontSize: 16, lineHeight: 22, fontWeight: "400" }}>{t("Context window")}</Text>
            <Text testID="context-block-percent" variant="body" tabular style={{ fontSize: 16, lineHeight: 22, fontWeight: "400" }}>{pct === undefined ? t("{used}% used", { used: "—" }) : t("{used}% used", { used: pct })}</Text>
            <Text testID="context-block-tokens" variant="body" tabular color="text/secondary">{sentence}</Text>
            {cost !== null ? (() => {
                const label = t("Session cost {cost}", { cost: new Intl.NumberFormat(theme.locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(cost) });
                const detail = t("The displayed amount is the list price of priced tokens, not what your subscription charged.");
                return <Tap role="button" label={label} onPress={() => setCostHelp((visible) => !visible)} onLongPress={() => setCostHelp(true)} onHoverIn={() => setCostHelp(true)} onHoverOut={() => setCostHelp(false)} onFocus={() => setCostHelp(true)} onBlur={() => setCostHelp(false)} style={{ position: "relative", alignSelf: "flex-start", minHeight: 0, padding: 0 }}>
                  <Text testID="context-block-cost" variant="body" color="text/secondary">{label}</Text>
                  {costHelp ? <View role="tooltip" testID="session-cost-tooltip" style={{ position: "absolute", left: 0, bottom: "100%", zIndex: 20, maxWidth: 280, padding: space[2], borderRadius: radius.sm, backgroundColor: theme.color("strong"), ...theme.elevation(2) }}><Text variant="meta" color="text/on-strong">{detail}{costUnavailableModels.length ? ` ${t("Models not included: {models}", { models: costUnavailableModels.join(", ") })}` : ""}</Text></View> : null}
                </Tap>;
              })() : costUnavailableReason === "no-list-price" ? <Tap role="button" label={t("Session cost {cost}", { cost: "—" })} onPress={() => setCostHelp((visible) => !visible)} onLongPress={() => setCostHelp(true)} onHoverIn={() => setCostHelp(true)} onHoverOut={() => setCostHelp(false)} onFocus={() => setCostHelp(true)} onBlur={() => setCostHelp(false)} style={{ position: "relative", alignSelf: "flex-start", minHeight: 0, padding: 0 }}>
                <Text testID="context-block-cost" variant="body" color="text/secondary">{t("Session cost {cost}", { cost: "—" })}</Text>
                {costHelp ? <View role="tooltip" testID="session-cost-tooltip" style={{ position: "absolute", left: 0, top: "100%", zIndex: 20, maxWidth: 280, padding: space[2], borderRadius: radius.sm, backgroundColor: theme.color("strong"), ...theme.elevation(2) }}><Text variant="meta" color="text/on-strong">{t("The vendor publishes no price for this model")}</Text></View> : null}
              </Tap> : <Text testID="context-block-cost" variant="body" color="text/secondary">{t("Session cost {cost}", { cost: "—" })}</Text>}
          </View>
          {account ? <>
            <View testID="context-account-divider" style={{ height: 1, backgroundColor: theme.color("border/hairline") }} />
            <View style={{ padding: space[2], gap: space[2] }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], marginBottom: space[1] }}>
                <Icon name="sparkles" size={16} color="text/secondary" />
                <Text variant="body-medium">{accountName}</Text>
                {account.planLabel ? <Text variant="meta" color="text/secondary" style={{ borderRadius: radius.full, backgroundColor: theme.color("bg/subtle"), paddingHorizontal: space[2], paddingVertical: space[0.5] }}>{accountPlanLabel(account.planLabel)}</Text> : null}
                {accountAge ? <Text variant="meta" color="text/secondary">{t("Updated {time}", { time: accountAge })}</Text> : null}
              </View>
              {account.status === "sign-in-required" ? <Text variant="body" color="text/secondary" testID="context-sign-in-required">{t("Sign in again in {cli}", { cli: signInCli })}</Text> : null}
              {accountRows.map((row) => {
                const reset = formatReset(row.resetsAt_ms);
                const rowTone = row.usedPct !== undefined && row.usedPct >= 90 ? "danger" : row.usedPct !== undefined && row.usedPct >= 70 ? "warning" : "success";
                return <View key={row.id} testID={`context-limit-${row.id}`} style={{ gap: space[1], paddingVertical: space[0.5] }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[2] }}>
                    <Text variant="body" color="text/secondary">{contextLimitLabel(row.label, (theme.locale.startsWith("vi") ? "vi" : theme.locale.startsWith("ja") ? "ja" : "en") as MeterLocale)}</Text>
                    <Text variant="body" tabular>{row.usedPct === undefined ? "" : <Text style={{ fontWeight: "500" }}>{`${Math.round(row.usedPct)}%`}</Text>}{reset ? <Text color="text/secondary">{` · ${t("resets {time}", { time: reset })}`}</Text> : null}</Text>
                  </View>
                  {row.usedPct !== undefined ? <View accessibilityRole="progressbar" accessibilityLabel={row.label} accessibilityValue={{ min: 0, max: 100, now: row.usedPct }} style={{ height: 4, borderRadius: radius.full, overflow: "hidden", backgroundColor: theme.color("bg/subtle") }}><View style={{ width: `${Math.max(0, Math.min(100, row.usedPct))}%`, height: 4, borderRadius: radius.full, backgroundColor: theme.color(rowTone) }} /></View> : null}
                </View>;
              })}
              {balanceRows.map((row) => {
                const pct = accountBalanceUsedPct(row);
                const rowTone = pct !== undefined && pct >= 90 ? "danger" : pct !== undefined && pct >= 70 ? "warning" : "success";
                const amount = row.used !== undefined && row.limit !== undefined ? `${row.used.toLocaleString(theme.locale)} / ${row.limit.toLocaleString(theme.locale)} ${row.unit}`
                  : row.remaining !== undefined ? `${row.remaining.toLocaleString(theme.locale)} ${row.unit}` : null;
                return <View key={row.id} testID={`context-balance-${row.id}`} style={{ gap: space[1], paddingVertical: space[0.5] }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[2] }}>
                    <Text variant="body" color="text/secondary">{row.label}</Text>
                    <Text variant="body" tabular>{pct === undefined ? "" : <Text style={{ fontWeight: "500" }}>{`${Math.round(pct)}%`}</Text>}{amount ? <Text color="text/secondary">{` · ${amount}`}</Text> : null}</Text>
                  </View>
                  {pct !== undefined ? <View accessibilityRole="progressbar" accessibilityLabel={row.label} accessibilityValue={{ min: 0, max: 100, now: pct }} style={{ height: 4, borderRadius: radius.full, overflow: "hidden", backgroundColor: theme.color("bg/subtle") }}><View style={{ width: `${pct}%`, height: 4, borderRadius: radius.full, backgroundColor: theme.color(rowTone) }} /></View> : null}
                </View>;
              })}
              {extraUsageText ? <View testID="context-extra-usage" style={{ flexDirection: "row", justifyContent: "space-between", gap: space[2], paddingTop: space[1] }}><Text variant="body" color="text/secondary">{reportedExtraUsage?.label ?? t("Extra usage")}</Text><Text variant="body" tabular>{extraUsageText}</Text></View> : null}
            </View>
          </> : null}
        </View>
      </Popover>
    </>
  );
}

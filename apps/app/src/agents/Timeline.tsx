import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "expo-router";
import { Image, View } from "react-native";
import { activitySummary, assignmentOf, hostAssignment, blocksOf, COMPACTION_ROW, detailRows, listWindow, listWindowPrependShift, rowTop, toolAwaitsApproval, toolCallOf, toolDuration, toolLabel, toolOutcomeOf, type ChatAttachmentView, type ChatBlock, type ChatItem, type ChatState, type ReasoningItem, type ToolItem, type ToolOutcome, type TurnWait, formatTimeOfDay } from "@jagentchill/app-core";
import { fetchVerified } from "@jagentchill/client";
import { Avatar, Button, Callout, Card, Chip, Disclosure, Icon, IconButton, MarkdownView, Menu, Modal, Spinner, StatusPill, Tap, Text, compactCardTextLayout, compactScale, radius, space, typography, useTheme, useToast, type IconName, type MenuItem } from "@jagentchill/ui";
import { useHost, type Approval } from "../host";
import { hostSettingsRoute } from "./ModelBrowser";
import { JobProgress } from "./JobProgress";
import { loadSigner } from "../identity";
import { useT } from "../locale";
import { blobUrl, copyText, MediaPreview, releaseUrl, saveBlob } from "../platform/media";
import { openExternal } from "../platform/store";
import { hostNotes } from "./proposals/data";
import { splitInvocation } from "../skills/data";
import { useRevealedText } from "./reveal";
import { splitStreamingMarkdown } from "./streamMarkdown";
import { toolIcon, toolTitle } from "./toolTitles";

export { toolIcon } from "./toolTitles";

const timeOf = (ts_ms: number | undefined, locale: string) => (ts_ms ? formatTimeOfDay(ts_ms) : "");
const ENGINE_ERROR_COPY = [
  "That action is not available in this session.", "Choose a model in Settings › Model routing before starting this turn.", "Sign in to the selected provider, then try again.", "The provider is limiting requests. Try again shortly.",
  "The conversation is too long for this model. Compact it or start a new session.", "This action is not allowed in the current session.", "This session is no longer available. Return to the session list and open it again.", "This attachment is too large to send.",
  "The agent settings could not be applied. Review the settings and try again.", "The turn was stopped.", "The host is temporarily unavailable. Try again shortly.", "The action could not be completed.", "The request could not be completed.",
  "Continue without that action", "Open Model routing", "Open provider sign-in", "Try again shortly", "Compact the conversation or start a new session", "Try again",
  "Choose an available action", "Open the session list", "Choose a smaller attachment", "Review settings", "Start another turn when ready", "Try again", "Try a different action",
];
/** What a call came to, in one line: the host's sentence, the error, or the first line of what came back. */
function outcomeLine(t: ReturnType<typeof useT>, outcome: ToolOutcome): string | null {
  if (outcome.error) return t(outcome.error.message || "The action could not be completed.");
  if (outcome.summary) return outcome.summary;
  if (outcome.text) return outcome.text.split("\n").find((line) => line.trim())?.trim().slice(0, 160) ?? null;
  const data = outcome.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const list = Object.entries(data as Record<string, unknown>).find(([, value]) => Array.isArray(value));
    if (list) return t("{n} results", { n: (list[1] as unknown[]).length });
  }
  return null;
}

/** Label / value lines of the arguments or the result of a call. */
function Fields(props: { title: string; value: unknown }) {
  const t = useT();
  const { rows, more } = detailRows(props.value, { plain: true });
  if (!rows.length) return null;
  return (
    <View style={{ gap: 2 }}>
      <Text variant="meta" color="text/tertiary">{props.title}</Text>
      {rows.map((row) => (
        <View key={row.key} style={{ flexDirection: "row", gap: space[2] }}>
          {row.label ? <Text variant="meta" color="text/secondary" style={{ width: 112 }} numberOfLines={1}>{row.label}</Text> : null}
          <Text variant="meta" selectable style={{ flex: 1 }}>{row.value}</Text>
        </View>
      ))}
      {more ? <Text variant="meta" color="text/tertiary">{t("{n} more", { n: more })}</Text> : null}
    </View>
  );
}

/** One call of the work log: what was done, how it went and how long it took; opened, what was asked and what came back. */
function ToolRow(props: { step: ToolItem; onOpenStep?(id: string): void; onRetryImport?(): void; searchHit?: { id: string; term: string } | null }) {
  const t = useT();
  const theme = useTheme();
  const { step } = props;
  // A call the host holds until the person allows it is recorded as an error of the tool; it waits for them, it did not fail.
  const asked = toolAwaitsApproval(step);
  const failed = step.status === "failed" && !asked;
  // A call that failed shows why without being asked.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [raw, setRaw] = useState(false);
  const open = chosen ?? failed;
  const call = toolCallOf(step);
  const outcome = toolOutcomeOf(step.output, failed);
  const title = toolTitle(t, step);
  const line = step.status === "running" ? null : asked ? t("Asked for your approval") : outcomeLine(t, outcome);
  const state = step.status === "running" ? t("Running") : asked ? t("Asked for your approval") : failed ? t("Failed") : step.status === "cancelled" ? t("Cancelled") : t("Done");
  return (
    <View testID={`tool-${call.tool}`} {...({ dataSet: { status: asked ? "asked" : step.status, toolId: step.id, ...(props.searchHit?.id === step.id ? { searchId: step.id } : {}) } } as object)} style={props.searchHit?.id === step.id ? { backgroundColor: theme.color("warning/subtle"), borderRadius: radius.sm } : undefined}>
      <Tap role="button" label={`${title} — ${state}`} expanded={open} onPress={() => setChosen(!open)}
        style={(pressed) => ({ flexDirection: "row", flexWrap: theme.compact ? "wrap" : "nowrap", alignItems: "center", gap: space[1.5], minHeight: theme.compact ? 44 : theme.touch ? 32 : 24, paddingHorizontal: space[1], borderRadius: radius.sm, backgroundColor: pressed.hovered || open ? theme.color("bg/hover") : "transparent" })}>
        {step.status === "running" ? <Spinner size={14} label={state} /> : <Icon name={failed ? "warn" : asked ? "hand" : toolIcon(step.name)} size={14} color={failed ? "danger" : asked ? "warning/text" : step.status === "cancelled" ? "text/tertiary" : "text/secondary"} />}
        <Text variant="meta" testID="tool-title" color={failed ? "danger/text" : "text/primary"} numberOfLines={theme.compact ? 3 : 1} style={{ ...compactCardTextLayout(theme.compact), fontWeight: "500", flexShrink: theme.compact ? 1 : 0, maxWidth: theme.compact ? "100%" : "70%" }}>{title}</Text>
        <Text variant="meta" testID="tool-summary" color="text/secondary" numberOfLines={theme.compact ? 3 : 1} style={{ ...compactCardTextLayout(theme.compact), flex: 1 }}>{line ?? ""}</Text>
        {toolDuration(step) ? <Text variant="meta" color="text/tertiary" tabular>{toolDuration(step)}</Text> : null}
        {step.status === "completed" ? <Icon name="check" size={12} color="success" label={state} /> : step.status === "cancelled" ? <Icon name="minus" size={12} color="text/tertiary" label={state} /> : null}
        <Icon name={open ? "chev-d" : "chev-r"} size={12} color="text/tertiary" />
      </Tap>
      {open ? (
        <View testID="tool-detail" style={{ marginStart: space[4], marginTop: 2, marginBottom: space[1], padding: space[2], gap: space[2], borderRadius: radius.sm, borderWidth: 1, borderColor: theme.color(failed ? "danger" : "border/hairline"), backgroundColor: theme.color("bg/inset") }}>
          {outcome.error ? <Text variant="meta" color={asked ? "text/secondary" : "danger/text"} selectable>{asked ? t("The agent asks to do this. It waits for your answer.") : t(outcome.error.message || "The action could not be completed.")}</Text> : null}
          {step.images?.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
              {step.images.map((uri, index) => <Image key={index} source={{ uri }} accessibilityLabel={t("Rendered frame {n}", { n: index + 1 })} resizeMode="contain" style={{ width: 144, height: 81, borderRadius: radius.xs, backgroundColor: theme.color("bg/app") }} />)}
            </View>
          ) : null}
          {raw ? (
            <>
              {step.input ? <Text variant="mono" selectable>{step.input}</Text> : null}
              {step.output ? <Text variant="mono" selectable>{step.output}</Text> : null}
            </>
          ) : (
            <>
              <Fields title={t("Asked for")} value={call.args} />
              {outcome.summary && !outcome.error ? <Text variant="meta" selectable>{outcome.summary}</Text> : null}
              {outcome.data !== undefined ? <Fields title={t("Came back")} value={outcome.data} /> : outcome.text && !outcome.error ? <View style={{ gap: 2 }}><Text variant="meta" color="text/tertiary">{t("Came back")}</Text><Text variant="meta" selectable numberOfLines={12}>{outcome.text}</Text></View> : null}
            </>
          )}
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Text variant="meta" color="text/tertiary" numberOfLines={1} style={{ flex: 1 }}>{raw ? call.tool : ""}</Text>
            {failed && call.tool === "jc_media_import" && props.onRetryImport ? <Button kind="ghost" size="xs" icon="refresh" label={t("Retry")} testID="tool-import-retry" onPress={props.onRetryImport} /> : null}
            {step.input || step.output ? <Button kind="ghost" size="xs" label={raw ? t("Show summary") : t("Show raw data")} testID="tool-raw" onPress={() => setRaw(!raw)} /> : null}
            {props.onOpenStep ? <Button kind="ghost" size="xs" icon="panel-r" label={t("Open in work log")} onPress={() => props.onOpenStep!(step.id)} /> : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** Consecutive calls of a turn under one header: how many and how long. Open while they run, folded once the turn has ended. */
function Activity(props: { block: Extract<ChatBlock, { kind: "activity" }>; live: boolean; onOpenStep?(id: string): void; onRetryImport?(): void; searchHit?: { id: string; term: string } | null }) {
  const t = useT();
  const theme = useTheme();
  // A step the agent got wrong and went on from (a program that is not installed, a file outside its folder, a value
  // out of range) is the agent's own business: the chat does not show it — the work log keeps every step. Shown are
  // only the failures the person can act on: an approval and an import with its Retry.
  const steps = props.block.steps.filter((step) => step.status !== "failed" || toolAwaitsApproval(step) || (step.name.endsWith("jc_media_import") && !!props.onRetryImport));
  const summary = activitySummary(steps, props.live);
  // Folded once the work is over; the reader's own choice wins from then on.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? (props.live || steps.some((step) => step.id === props.searchHit?.id));
  const titles = open ? "" : steps.slice(0, 3).map((step) => toolTitle(t, step)).join(" · ");
  // A generation the agent did not wait for (a picture made on this computer): its live progress, shown even folded.
  const following = steps.flatMap((step) => {
    if (step.status === "failed" || !/jc_generate_/.test(step.name)) return [];
    const data = toolOutcomeOf(step.output, false).data as { jobId?: unknown; state?: unknown } | undefined;
    return data && typeof data.jobId === "string" && data.state === "making" ? [data.jobId] : [];
  });
  if (steps.length === 0) return null;
  return (
    <View testID="activity-group" {...({ dataSet: { open: String(open) } } as object)}>
      <Tap role="button" label={summary.text} expanded={open} onPress={() => setChosen(!open)} style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], minHeight: theme.compact ? 44 : theme.touch ? 32 : 24 }}>
        <Icon name={open ? "chev-d" : "chev-r"} size={14} color="text/secondary" />
        {props.live && props.block.steps.some((step) => step.status === "running") ? <Spinner size={12} label={t("Running")} /> : null}
        <Text variant="meta" color="text/secondary" style={{ fontWeight: "500", flexShrink: 0 }}>{summary.text}</Text>
        {titles ? <Text variant="meta" color="text/tertiary" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>{titles}{steps.length > 3 ? " …" : ""}</Text> : null}
      </Tap>
      {open ? (
        <View style={{ borderStartWidth: 1, borderStartColor: theme.color("border/hairline"), marginStart: 7, paddingStart: space[2], gap: 1 }}>
          {steps.map((step) => <ToolRow key={step.id} step={step} onOpenStep={props.onOpenStep} onRetryImport={props.onRetryImport} searchHit={props.searchHit} />)}
        </View>
      ) : null}
      {following.map((jobId) => <JobProgress key={jobId} jobId={jobId} />)}
    </View>
  );
}

/**
 * What a running turn is doing: incoming text is its own live sign, while a quiet stream gets a status line after 600 ms.
 */
function TurnStatus(props: { turn: ChatState["turn"]; writing?: boolean; textRevision?: string; /** The tool call that runs, when the turn waits for one. */ tool?: ToolItem }) {
  const t = useT();
  const theme = useTheme();
  const [now, setNow] = useState(() => Date.now());
  const latestText = useRef({ revision: props.textRevision, at: Date.now() });
  if (latestText.current.revision !== props.textRevision) latestText.current = { revision: props.textRevision, at: Date.now() };
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), 1000);
    }, Math.max(0, latestText.current.at + 600 - Date.now()));
    return () => { clearTimeout(timeout); if (timer) clearInterval(timer); };
  }, [props.textRevision]);
  const thinking = props.turn?.thinking, seconds = props.turn ? Math.max(0, Math.floor((now - props.turn.started_ms) / 1000)) : 0;
  const textIsFresh = !!props.writing && now - latestText.current.at < 600;
  const label = thinking ? t("Thinking…") : textIsFresh ? t("Writing…") : t("Working…"), thought = thinking?.text?.trim();
  // What the turn waits for, in words: no state of a live turn is left without them (`TurnWait` lists the states).
  const wait = thinking || textIsFresh ? undefined : props.turn?.wait ?? (props.writing ? "model" : undefined);
  const waitingFor = !wait ? null
    : wait === "tool" ? (props.tool ? t("Running: {tool}", { tool: toolTitle(t, props.tool) }) : null)
    : t(WAIT_WORDS[wait]);
  const waitSince = props.writing && wait === "model" && !props.turn?.wait_since_ms ? latestText.current.at + 600 : props.turn?.wait_since_ms;
  const waited = wait && waitSince ? Math.max(0, Math.floor((now - waitSince) / 1000)) : 0;
  if (textIsFresh && !thought) return null;
  return (
    <View testID="status-line" {...({ dataSet: { phase: thinking ? "thinking" : textIsFresh ? "writing" : "working", seconds: String(seconds), idleMs: String(Math.max(0, now - latestText.current.at)), ...(wait ? { wait } : {}) } } as object)} style={{ gap: space[1], width: "100%", minWidth: 0 }}>
      <View style={{ height: typography.meta[theme.density].lineHeight, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[1.5], flexWrap: "nowrap", minWidth: 0, overflow: "hidden" }}>
        <Spinner size={12} label={label} />
        <Text variant="meta" color="text/secondary" numberOfLines={1} tabular style={{ flexShrink: 1, minWidth: 0 }}>{seconds >= 1 ? `${label} ${seconds} s` : label}</Text>
        {waitingFor ? <Text variant="meta" color="text/secondary" testID="status-wait" numberOfLines={1} tabular style={{ ...compactCardTextLayout(theme.compact), flexShrink: 1, minWidth: 0 }}>{`· ${waitingFor}${waited >= 3 && waited !== seconds ? ` ${waited} s` : ""}`}</Text> : null}
        {thinking?.tokens ? <Text variant="meta" color="text/tertiary" numberOfLines={1} tabular style={{ flexShrink: 1, minWidth: 0 }}>{t("{n} tokens", { n: thinking.tokens })}</Text> : null}
      </View>
      {thought ? <Text testID="thinking-live" variant="meta" color="text/tertiary" numberOfLines={3}>{thought.length > 400 ? `…${thought.slice(-400)}` : thought}</Text> : null}
    </View>
  );
}
/** The words for what a live turn waits for (a running tool is named by its own title). */
const WAIT_WORDS: Record<Exclude<TurnWait, "tool">, string> = {
  starting: "Starting the agent…", host: "Waiting for the host…", preparing: "Preparing the conversation…", model: "Waiting for the model…",
  "your-answer": "Waiting for your answer", "answer-sent": "Sent your answer — waiting for the agent…", "decision-sent": "Sent your decision — waiting for the agent…",
  compacting: "Compacting the conversation…",
};

/** A compaction that is running: said from the moment it starts, with the time it has taken; when it is over the compaction's divider stands at its place. */
function CompactingLine(props: { since_ms: number }) {
  const t = useT();
  const theme = useTheme();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.floor((now - props.since_ms) / 1000));
  const rule = { flex: 1, height: 1, backgroundColor: theme.color("border/hairline") };
  return (
    <View testID="compacting-line" role="status" {...({ dataSet: { seconds: String(seconds) } } as object)} style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
      <View style={rule} />
      <Spinner size={12} label={t("Compacting the conversation…")} />
      <Text variant="meta" color="text/secondary" align="center" tabular>{seconds >= 1 ? `${t("Compacting the conversation…")} ${seconds} s` : t("Compacting the conversation…")}</Text>
      <View style={rule} />
    </View>
  );
}

/** What the model thought before it answered or acted, when the runtime reports it: one line, opened to read it all. */
function Reasoning(props: { item: ReasoningItem }) {
  const t = useT();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View testID="reasoning-block">
      <Tap role="button" label={t("Thinking")} expanded={open} onPress={() => setOpen(!open)} style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], minHeight: theme.compact ? 44 : theme.touch ? 32 : 24 }}>
        <Icon name={open ? "chev-d" : "chev-r"} size={14} color="text/secondary" />
        <Icon name="spark" size={12} color="text/tertiary" />
        <Text variant="meta" color="text/secondary" style={{ fontWeight: "500", flexShrink: 0 }}>{t("Thinking")}</Text>
        {open ? null : <Text variant="meta" color="text/tertiary" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>{props.item.text.replace(/\s+/g, " ")}</Text>}
      </Tap>
      {open ? <View style={{ borderStartWidth: 1, borderStartColor: theme.color("border/hairline"), marginStart: 7, paddingStart: space[3] }}><Text variant="meta" color="text/secondary" selectable>{props.item.text}</Text></View> : null}
    </View>
  );
}

/** An answer of the agent. While it arrives its text grows at an even pace, whatever the size of the pieces it comes in. */
function SearchHighlightedText(props: { text: string; term: string }) {
  const theme = useTheme();
  const at = props.text.toLocaleLowerCase().indexOf(props.term.toLocaleLowerCase());
  if (at < 0 || !props.term) return <Text selectable>{props.text}</Text>;
  return (
    <Text selectable>
      {props.text.slice(0, at)}
      <Text testID="chat-search-highlight" style={{ backgroundColor: theme.color("warning/subtle"), fontWeight: "700" }}>{props.text.slice(at, at + props.term.length)}</Text>
      {props.text.slice(at + props.term.length)}
    </Text>
  );
}

const StreamMarkdownBlock = memo(function StreamMarkdownBlock(props: { source: string; openFence?: boolean }) {
  return <MarkdownView source={props.source} streaming={props.openFence} onLink={(href) => openExternal(href)} />;
});

function StreamingMarkdown(props: { source: string }) {
  const parts = splitStreamingMarkdown(props.source);
  return (
    <View style={{ gap: space[2] }}>
      {parts.complete.map((source) => <StreamMarkdownBlock key={source} source={source} />)}
      {parts.pendingFence ? <StreamMarkdownBlock key={`open:${parts.pending}`} source={parts.pending} openFence /> : parts.pending ? <Text key="open-text" selectable>{parts.pending}</Text> : null}
    </View>
  );
}

function AssistantRow(props: { item: Extract<ChatItem, { kind: "assistant" }>; last: boolean; searchTerm?: string }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const { item } = props;
  const shown = useRevealedText(item.id, item.text, { fresh: item.fresh === true, streaming: item.streaming === true });
  const writing = item.streaming === true || shown.revealing;
  return (
    <View testID="assistant-message" {...({ dataSet: { writing: String(writing) } } as object)} style={{ gap: space[1] }}>
      {props.searchTerm && shown.text.toLocaleLowerCase().includes(props.searchTerm.toLocaleLowerCase())
        ? <SearchHighlightedText text={shown.text} term={props.searchTerm} />
        : writing
          ? <StreamingMarkdown source={shown.text} />
          : <MarkdownView source={shown.text} onLink={(href) => openExternal(href)} />}
      {(props.last || item.ts_ms) ? (
        <View pointerEvents={writing ? "none" : "auto"} accessibilityElementsHidden={writing} importantForAccessibility={writing ? "no-hide-descendants" : "auto"} style={{ flexDirection: "row", alignItems: "center", gap: space[1], opacity: writing ? 0 : 1 }}>
          <IconButton icon="copy" size="xs" label={t("Copy message")} onPress={() => void copyText(item.text).then((ok) => ok && toast.show({ kind: "success", message: t("Copied") }))} />
          <Text variant="meta" color="text/secondary" tabular>{timeOf(item.ts_ms, theme.locale)}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** The command of a request whose detail is the tool's input as JSON; any other detail is shown as it is. */
function commandOf(detail: string): string {
  try { const input = JSON.parse(detail) as { command?: unknown }; return typeof input.command === "string" ? input.command : detail; } catch { /* plain text, or tool input the runtime cut short */ }
  // Tool input that no longer parses still shows its command, not its JSON.
  const cut = /^\s*\{\s*"command"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(detail);
  if (cut) { try { return JSON.parse(`"${cut[1].replace(/\\$/, "")}"`) as string; } catch { /* shown as it is */ } }
  return detail;
}

/** What a runtime's own tool would do on the host, as the card asks it; raw tool names never head the card. */
const APPROVAL_TITLES = { shell: "Run a command on the host?", write: "Change a file on the host?", read: "Read files on the host?", network: "Use the network from the host?", other: "Use a tool of the runtime on the host?" };
function approvalKind(toolName: string | undefined): keyof typeof APPROVAL_TITLES {
  const name = (toolName ?? "").toLowerCase();
  if (!name || /bash|shell|exec|command|terminal/.test(name)) return "shell";
  if (/write|edit|patch|notebook/.test(name)) return "write";
  if (/read|glob|grep|ls|list/.test(name)) return "read";
  if (/web|fetch|http|search/.test(name)) return "network";
  return "other";
}
type ApprovalDecision = "allow-once" | "allow-session" | "deny";

/**
 * A runtime asks to use one of its own tools on the host (a shell command, a file outside the project, the network):
 * what would run, where, and the person's three answers. The turn waits for the answer. Answered from any device that
 * holds the approval scope and can read the session.
 */
export function ApprovalCard(props: { approval: Approval; onAnswer(decision: ApprovalDecision): Promise<void> | void }) {
  const t = useT();
  const theme = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const answer = (decision: ApprovalDecision) => { setBusy(decision); void Promise.resolve(props.onAnswer(decision)).finally(() => setBusy(null)); };
  const kind = approvalKind(props.approval.toolName);
  const grant = props.approval.grant;
  return (
    <Card padding={space[3]}>
      <View testID="approval-card" {...({ dataSet: { kind, tool: props.approval.toolName ?? "" } } as object)} style={{ gap: space[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Icon name="shield" size={16} color="accent" />
          <Text variant="title-sm" style={{ flex: 1 }}>{t(APPROVAL_TITLES[kind])}</Text>
          <StatusPill label={t("Waiting for your approval")} tone="warning" />
        </View>
        <Text color="text/secondary">{t("The agent wants to do this with its runtime's own tool, outside the project. It waits for your answer.")}</Text>
        <View style={{ backgroundColor: theme.color("bg/inset"), borderRadius: radius.sm, borderWidth: 1, borderColor: theme.color("border/hairline"), padding: space[2], gap: space[1] }}>
          <Text variant="mono" selectable testID="approval-command">{commandOf(props.approval.detail)}</Text>
          {props.approval.cwd ? <Text variant="meta" color="text/secondary" selectable testID="approval-cwd">{t("In {folder}", { folder: props.approval.cwd })}</Text> : null}
        </View>
        <View style={{ flexDirection: theme.compact ? "column" : "row", alignItems: theme.compact ? "stretch" : "center", gap: space[2], flexWrap: "wrap" }}>
          <Button kind="primary" size="sm" block={theme.compact} label={t("Allow once")} testID="approval-allow-once" loading={busy === "allow-once"} disabled={busy !== null} onPress={() => answer("allow-once")} />
          {grant ? <Button size="sm" block={theme.compact} label={t("Always allow in this session")} testID="approval-allow-session" loading={busy === "allow-session"} disabled={busy !== null} onPress={() => answer("allow-session")} /> : null}
          <Button kind="ghost" size="sm" block={theme.compact} label={t("Deny")} testID="approval-deny" loading={busy === "deny"} disabled={busy !== null} onPress={() => answer("deny")} />
          <View style={{ flex: 1 }} />
          {props.approval.toolName ? <Text variant="meta" color="text/secondary" numberOfLines={1}>{toolLabel(props.approval.toolName)}</Text> : null}
        </View>
        {grant ? (
          <Text variant="meta" color="text/secondary" testID="approval-grant-scope">
            {grant.scope === "program" ? t("“Always allow” covers every {program} command in this folder until this session ends.", { program: grant.subject })
              : grant.scope === "command" ? t("“Always allow” covers exactly this command in this folder until this session ends.")
                : t("“Always allow” covers this tool until this session ends.")}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

function UserRow(props: { item: Extract<ChatItem, { kind: "user" }>; menu: MenuItem[]; searchTerm?: string }) {
  const t = useT();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const more = useRef<View>(null);
  // The line that names the attached skills is shown as chips, not as text. A sub-agent's first message is the server's
  // standing instructions followed by its task: wherever its conversation is opened, the bubble shows the task.
  const sent = splitInvocation(assignmentOf(props.item.text));
  // What an agent was given by another agent, or told by the host, is not something the person wrote: it is drawn as
  // what it is — a labelled card at the start of the line — never as their own bubble.
  const given = hostAssignment(props.item.text);
  if (given) {
    return (
      <View testID="assignment-card" {...({ dataSet: { from: given.from ?? "host" } } as object)} style={{ alignSelf: "stretch", gap: space[1], borderRadius: radius.lg, borderWidth: 1, borderColor: theme.color("border/hairline"), paddingVertical: space[2], paddingHorizontal: space[3] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
          <Icon name="flag" size={12} color="text/secondary" />
          <Text variant="meta" color="text/secondary" testID="assignment-card-label">{given.from ? t("Assignment from {agent} — not written by you", { agent: given.from }) : t("Message from the host — not written by you")}</Text>
        </View>
        <Text selectable>{given.text}</Text>
      </View>
    );
  }
  return (
    <View {...({ onPointerEnter: () => setHovered(true), onPointerLeave: () => setHovered(false) } as object)} style={{ alignItems: "flex-end", gap: space[1] }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "flex-end", gap: space[2], maxWidth: "100%" }}>
        <View style={{ opacity: hovered || open || theme.touch ? 1 : 0 }}><IconButton ref={more} icon="more" size="xs" label={t("Message actions")} expanded={open} onPress={() => setOpen(true)} /></View>
        <View style={{ backgroundColor: theme.color("bg/subtle"), borderRadius: radius.lg, paddingVertical: space[2], paddingHorizontal: space[3], flexShrink: 1 }}>
          {props.searchTerm ? <SearchHighlightedText text={sent.text} term={props.searchTerm} /> : <Text selectable>{sent.text}</Text>}
        </View>
        <Avatar name={t("You")} size={24} />
      </View>
      {props.item.slashCommand ? <View testID="slash-command-expansion" style={{ width: "100%", maxWidth: 720, alignSelf: "flex-end", marginEnd: space[5] }}>
        <Disclosure title={t("View expanded prompt")} open={promptOpen} onToggle={setPromptOpen}>
          <View style={{ padding: space[2], borderRadius: radius.sm, backgroundColor: theme.color("bg/inset") }}>
            <Text variant="mono" selectable>{props.item.slashCommand.expansion}</Text>
          </View>
        </Disclosure>
      </View> : null}
      {props.item.attachments?.length ? <View testID="sent-attachments" style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space[1], marginEnd: theme.compact ? 0 : 32 }}>{props.item.attachments.map((entry) => <SentAttachment key={entry.attachmentId} attachment={entry} />)}</View> : null}
      {sent.skills.length ? <View testID="message-skills" style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space[1], marginEnd: theme.compact ? 0 : 32 }}>{sent.skills.map((name) => <Chip key={name} icon="spark" label={name} />)}</View> : null}
      {props.item.handoverItems ? <View style={{ marginEnd: theme.compact ? 0 : 32 }}><Chip icon="chat" label={t("Chat history ({n} items)", { n: props.item.handoverItems })} /></View> : null}
      <Menu open={open} anchor={more} items={props.menu} label={t("Message actions")} align="end" onClose={() => setOpen(false)} />
    </View>
  );
}

function SentAttachment(props: { attachment: ChatAttachmentView }) {
  const { host } = useHost();
  const t = useT(), theme = useTheme(), toast = useToast();
  const [media, setMedia] = useState<{ url: string; blob: Blob } | null>(null);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const pending = useRef<Promise<{ url: string; blob: Blob } | null> | null>(null);
  const kind = props.attachment.mime.startsWith("image/") ? "image" : props.attachment.mime.startsWith("video/") ? "video" : props.attachment.mime.startsWith("audio/") ? "audio" : null;
  useEffect(() => () => { if (media?.url) releaseUrl(media.url); }, [media?.url]);
  const load = async () => {
    if (media) return media;
    if (pending.current) return pending.current;
    if (!host) return null;
    setBusy(true);
    const request = (async () => {
      try {
        const bytes = await fetchVerified({ host, signer: await loadSigner() }, props.attachment.blobId);
        const copy = new Uint8Array(bytes.length); copy.set(bytes);
        const blob = new Blob([copy.buffer], { type: props.attachment.mime }), value = { blob, url: blobUrl(blob) };
        setMedia(value); return value;
      } catch (error) {
        toast.show({ kind: "error", message: error instanceof Error ? error.message : t("Could not open attachment") });
        return null;
      } finally { pending.current = null; setBusy(false); }
    })();
    pending.current = request;
    return request;
  };
  useEffect(() => { if (kind === "image") void load(); }, [kind, props.attachment.blobId]);
  const icon: IconName = kind === "image" ? "image" : kind === "video" ? "film" : kind === "audio" ? "music" : "doc";
  return (
    <>
      <Tap role="button" label={props.attachment.name} testID={`sent-attachment-${props.attachment.attachmentId}`} onPress={() => void (async () => {
        const value = await load(); if (!value) return;
        if (kind) setOpen(true); else saveBlob(props.attachment.name, value.blob);
      })()} style={(state) => ({ minHeight: theme.compact ? compactScale.control.height : 32, maxWidth: theme.compact ? "100%" : 240, flexDirection: "row", alignItems: "center", gap: space[1], padding: space[1], borderWidth: 1, borderColor: theme.color(state.hovered ? "border/control" : "border/hairline"), borderRadius: radius.sm, backgroundColor: theme.color(state.hovered ? "bg/hover" : "bg/app"), opacity: busy ? 0.65 : 1 })}>
        {kind === "image" && media ? <Image source={{ uri: media.url }} accessibilityLabel={props.attachment.name} testID="sent-attachment-thumbnail" style={{ width: 32, height: 24, borderRadius: radius.xs, backgroundColor: theme.color("bg/subtle") }} /> : <Icon name={icon} size={14} color="text/secondary" />}
        <Text variant="meta" numberOfLines={1} style={{ ...compactCardTextLayout(theme.compact), flexShrink: 1 }}>{props.attachment.name}</Text>
      </Tap>
      {kind ? <Modal open={open} title={props.attachment.name} width={640} onClose={() => setOpen(false)}>
        {media ? <View testID="sent-attachment-preview" style={{ width: "100%", minWidth: 0 }}><MediaPreview type={kind} url={media.url} label={props.attachment.name} height={kind === "audio" ? 48 : 360} /></View> : null}
      </Modal> : null}
    </>
  );
}

/** The chat timeline: user rows, activity groups, assistant text as Markdown, media, status lines, errors and approval cards. */
export function Timeline(props: {
  items: ChatItem[]; running: boolean; approvals: Approval[]; turn?: ChatState["turn"];
  searchHit?: { id: string; term: string } | null;
  userMenu(item: Extract<ChatItem, { kind: "user" }>, index: number): MenuItem[]; onOpenStep?(id: string): void; onRetryImport?(): void; stopping?: boolean;
  /** Draws the card that stands at a place of the conversation (a question, a proposal, a notice, an approval). */
  renderCard?(id: string): ReactNode;
  /** A compaction of the conversation is running since then. */
  compacting?: { since_ms: number };
  /**
   * The list is long: only the rows around the viewport are mounted, the others are two spacers (`listWindow`).
   * `top: null` is "the reader is at the end". `measure` is told the height of every mounted row.
   */
  windowed?: { heights: ReadonlyMap<string, number>; top: number | null; hasOlder: boolean; viewport: number; measure(key: string, height: number): void; /** A row the person jumped to: keep the mounted window around it until scroll position catches up. */ focus?: string | null; /** The row the reader's place is held by: the window is worked out around IT, so rows put in above (an older page) never push it out of the mounted part. */ anchor?: { key: string; offset: number } | null; /** Told when rows were put in above the first row of the render before: the height they take (estimated — they are not mounted). */ prepended?(height: number): void };
}) {
  const t = useT();
  const theme = useTheme();
  const blocks = blocksOf(props.items);
  let userIndex = -1;
  const lastAssistant = props.items.findLast((item) => item.kind === "assistant");
  // Which of the messages the host wrote to the agent: the ones the server marked, never decided by the words.
  const notes = hostNotes(props.items.filter((item) => item.kind === "user") as Extract<ChatItem, { kind: "user" }>[]);
  // Which blocks are mounted. The count of the person's messages before each block is known without mounting it.
  const keys = blocks.map((block) => (block.kind === "item" ? block.item.id : block.id));
  const searchActivity = props.searchHit ? blocks.find((block): block is Extract<ChatBlock, { kind: "activity" }> => block.kind === "activity" && block.steps.some((step) => step.id === props.searchHit?.id)) : undefined;
  const focusKey = searchActivity?.id ?? props.windowed?.focus;
  const GAP = space[3], ESTIMATE = 96, OVERSCAN = 1000;
  /** What the mounted part was placed by: the end of the list, the row the reader's place is held by, the scroll offset, or the offset moved by what was put in above. */
  let placedBy: "all" | "end" | "row" | "offset" | "shift" = "all";
  // Rows put in above the row that was first: everything below them is that much further down. The mounted part moves
  // with it in this very render, and the pane scrolls the list by the same amount before the paint.
  const firstKey = useRef<string | null>(null);
  const prependedShift = props.windowed && props.windowed.top !== null && firstKey.current && keys.length > 0 && keys[0] !== firstKey.current ? Math.max(0, rowTop(keys, props.windowed.heights, ESTIMATE, firstKey.current, GAP) ?? 0) : 0;
  const shift = props.windowed ? listWindowPrependShift(props.windowed.top, props.windowed.hasOlder, prependedShift) : 0;
  useLayoutEffect(() => { if (shift > 0) props.windowed?.prepended?.(shift); firstKey.current = keys[0] ?? null; });
  const part = props.windowed && blocks.length > 30
    ? (() => {
        const input = { keys, heights: props.windowed.heights, estimate: ESTIMATE, gap: GAP, viewport: props.windowed.viewport, overscan: OVERSCAN };
        const total = listWindow({ ...input, scrollTop: 0 }).total;
        const held = props.windowed.top !== null && props.windowed.anchor ? rowTop(keys, props.windowed.heights, ESTIMATE, props.windowed.anchor.key, GAP) : null;
        placedBy = props.windowed.top === null ? "end" : shift > 0 ? "shift" : held !== null ? "row" : "offset";
        const focused = focusKey ? rowTop(keys, props.windowed.heights, ESTIMATE, focusKey, GAP) : null;
        return listWindow({ ...input, keep: focusKey ? new Set([focusKey]) : undefined, scrollTop: focused !== null ? Math.max(0, focused - 100) : props.windowed.top === null ? Math.max(0, total - props.windowed.viewport) : shift > 0 ? props.windowed.top + shift : held !== null ? Math.max(0, held - props.windowed.anchor!.offset) : props.windowed.top });
      })()
    : null;
  const first = part?.first ?? 0, end = part?.end ?? blocks.length;
  for (let index = 0; index < first; index++) { const block = blocks[index]!; if (block.kind === "item" && block.item.kind === "user") userIndex += 1; }
  const measured = (key: string, node: ReactNode) => (props.windowed || props.searchHit?.id === key
    ? <View key={key} {...({ dataSet: { ...(props.windowed ? { wkey: key } : {}), ...(props.searchHit?.id === key ? { searchId: key } : {}) } } as object)} onLayout={props.windowed ? (event) => props.windowed!.measure(key, event.nativeEvent.layout.height) : undefined} style={[{ width: "100%", minWidth: 0 }, props.searchHit?.id === key ? { backgroundColor: theme.color("warning/subtle"), borderRadius: radius.sm } : undefined]}>{node}</View>
    : node);
  return (
    <>
      {props.windowed ? <View testID="chat-window" {...({ dataSet: { placed: placedBy, first: String(first), end: String(end), rows: String(blocks.length) } } as object)} style={{ height: 0, marginBottom: -GAP }} /> : null}
      {part && part.before > GAP ? <View testID="chat-spacer-above" style={{ height: part.before - GAP }} /> : null}
      {blocks.slice(first, end).map((block, offset) => measured(keys[first + offset]!, (() => {
        const index = first + offset;
        if (block.kind === "activity") return <Activity key={block.id} block={block} live={props.running && !blocks.slice(index + 1).some((later) => later.kind === "item" && (later.item.kind === "user" || later.item.kind === "assistant"))} onOpenStep={props.onOpenStep} onRetryImport={props.onRetryImport} searchHit={props.searchHit} />;
        if (block.kind === "reasoning") return <Reasoning key={block.id} item={block.item} />;
        const item = block.item;
        // The host's word to the agent about a decided proposal is a status line; the proposal card carries the rest.
        if (item.kind === "user" && notes.has(item.id)) { userIndex += 1; return <View key={item.id} testID="proposal-outcome-note" style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}><Icon name="layers" size={12} color="text/tertiary" /><Text variant="meta" color="text/secondary">{t(notes.get(item.id)!)}</Text></View>; }
        if (item.kind === "user") { userIndex += 1; return <UserRow key={item.id} item={item} menu={props.userMenu(item, userIndex)} searchTerm={props.searchHit?.id === item.id ? props.searchHit.term : undefined} />; }
        if (item.kind === "card") return <View key={item.id}>{props.renderCard?.(item.id)}</View>;
        if (item.kind === "host-card" && item.jobId) return <View key={item.id} testID="direct-image" style={{ width: "100%", maxWidth: 520, alignSelf: "flex-start" }}><JobProgress jobId={item.jobId} /></View>;
        if (item.kind === "host-card") return (
          <View key={item.id} testID="host-status-card" style={{ width: "100%", maxWidth: 420, alignSelf: "flex-start" }}>
            <Card padding={space[3]}>
            <View style={{ gap: space[2] }}>
              <Text variant="body-medium">{item.title}</Text>
              <View style={{ gap: space[1.5] }}>
                {item.rows.map((row, rowIndex) => <View key={`${row.label}-${rowIndex}`} style={{ flexDirection: "row", justifyContent: "space-between", gap: space[3] }}>
                  <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{row.label}</Text>
                  <Text variant="meta" color="text/primary" selectable style={{ flex: 1, textAlign: "right" }}>{row.value}</Text>
                </View>)}
              </View>
            </View>
            </Card>
          </View>
        );
        if (item.kind === "assistant") return <AssistantRow key={item.id} item={item} last={item === lastAssistant} searchTerm={props.searchHit?.id === item.id ? props.searchHit.term : undefined} />;
        if (item.kind === "media") {
          return (
            <Card key={item.id} padding={space[2]}>
              {item.mediaType === "image" ? <Image source={{ uri: item.uri }} accessibilityLabel={item.name ?? t("Generated image")} resizeMode="contain" style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: radius.sm, backgroundColor: theme.color("bg/inset") }} />
                : <MediaPreview type={item.mediaType} url={item.uri} label={item.name ?? t("Generated media")} height={item.mediaType === "audio" ? 48 : 200} />}
              {item.name ? <Text variant="meta" color="text/secondary" numberOfLines={1} style={{ marginTop: space[1] }}>{item.name}</Text> : null}
            </Card>
          );
        }
        if (item.kind === "status" && item.id.startsWith(COMPACTION_ROW)) {
          // A compaction of the context: a divider across the timeline; what was said before it stays above.
          const rule = { flex: 1, height: 1, backgroundColor: theme.color("border/hairline") };
          return (
            <View key={item.id} testID="compaction-divider" role="separator" aria-label={item.text} style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
              <View style={rule} />
              <Icon name="layers" size={12} color="text/tertiary" />
              <Text variant="meta" color="text/secondary" align="center">{item.text}</Text>
              <View style={rule} />
            </View>
          );
        }
        if (item.kind === "status") {
          return (
            <View key={item.id} testID="status-line" style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[1.5] }}>
              <Icon name={item.text === "Stopped" ? "stop" : "info"} size={12} color="text/tertiary" />
              <Text variant="meta" color="text/secondary" align="center">{t(item.text)}</Text>
            </View>
          );
        }
        return <ErrorItem key={item.id} item={item} />;
      })()))}
      {part && part.after > GAP ? <View testID="chat-spacer-below" style={{ height: part.after - GAP }} /> : null}
      {props.approvals.length ? (
        <View testID="status-line" style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[1.5] }}>
          <Icon name="hand" size={14} color="text/secondary" /><Text variant="meta" color="text/secondary">{t("Waiting for your approval")}</Text>
        </View>
      ) : props.stopping ? (
        <View testID="status-line" style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[1.5] }}><Spinner size={12} label={t("Stopping…")} /><Text variant="meta" color="text/secondary">{t("Stopping…")}</Text></View>
      ) : props.running ? (() => {
        const answer = props.items.findLast((item) => item.kind === "assistant" && item.streaming);
        return <TurnStatus turn={props.turn} writing={!props.turn?.thinking && !!answer} textRevision={answer?.kind === "assistant" ? `${answer.id}:${answer.text.length}` : undefined} tool={props.turn?.wait === "tool" ? (props.items.find((item) => item.kind === "tool" && item.id === props.turn?.tool) as ToolItem | undefined) ?? (props.items.findLast((item) => item.kind === "tool" && item.status === "running") as ToolItem | undefined) : undefined} />;
      })() : null}
      {props.compacting ? <CompactingLine since_ms={props.compacting.since_ms} /> : null}
    </>
  );
}

function ErrorItem(props: { item: Extract<ChatItem, { kind: "error" }> }) {
  const t = useT();
  const router = useRouter();
  const { host } = useHost();
  const [open, setOpen] = useState(false);
  const expired = ["runtime/signed-out", "runtime/auth-failed", "runtime/login-expired"].includes(props.item.code);
  return (
    <Callout tone="danger" title={expired ? t("This sign-in expired. Sign in again to continue.") : t(props.item.messageKey ?? props.item.message)}>
      {/* One column: beside the code, the details were squeezed into a strip one word wide. */}
      <View style={{ alignSelf: "stretch", flexBasis: "100%", minWidth: 0, gap: space[1] }}>
        {expired && host ? <Button size="xs" label={t("Sign in again")} testID="turn-sign-in-again" onPress={() => router.push(hostSettingsRoute(host.gatewayId, "runtimes", "keys") as never)} /> : null}
        {props.item.action ? <Text variant="meta" color="text/secondary">{t(props.item.action)}</Text> : null}
        <Disclosure title={t("Details")} open={open} onToggle={setOpen}>
          <Text variant="meta" color="text/secondary">{props.item.code}</Text>
          {props.item.raw ? <Text variant="mono" selectable style={{ alignSelf: "stretch" }}>{props.item.raw}</Text> : null}
        </Disclosure>
      </View>
    </Callout>
  );
}

/** One step of the worklog in full: what was asked of the tool and what came back. */
export function StepDetail(props: { step: ToolItem; index: number; total: number }) {
  const t = useT();
  const theme = useTheme();
  const { step } = props;
  const state = step.status === "running" ? t("Running") : step.status === "failed" ? t("Failed") : step.status === "cancelled" ? t("Cancelled") : t("Completed");
  const box = { backgroundColor: theme.color("bg/inset"), borderRadius: radius.sm, borderWidth: 1, borderColor: theme.color("border/hairline"), padding: space[2] } as const;
  return (
    <View style={{ gap: space[3] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <View style={{ width: 28, height: 28, borderRadius: radius.sm, backgroundColor: theme.color("bg/subtle"), alignItems: "center", justifyContent: "center" }}><Icon name={toolIcon(step.name)} size={16} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="body-medium" numberOfLines={1}>{toolTitle(t, step)}</Text>
          <Text variant="meta" color="text/secondary" numberOfLines={1}>{[t("Step {n} of {m}", { n: props.index + 1, m: props.total }), timeOf(step.started_ms, theme.locale), toolDuration(step), toolLabel(step.name)].filter(Boolean).join(" · ")}</Text>
        </View>
      </View>
      {step.input ? <View style={box}><Text variant="mono" selectable>{step.input}</Text></View> : null}
      {step.output ? <View style={box}><Text variant="mono" selectable>{step.output}</Text></View> : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}>
        {step.status === "running" ? <Spinner size={14} label={state} /> : <Icon name={step.status === "completed" ? "check-c" : step.status === "failed" ? "x-c" : "minus"} size={14} color={step.status === "completed" ? "success" : step.status === "failed" ? "danger" : "text/tertiary"} />}
        <Text variant="meta" color={step.status === "completed" ? "success/text" : step.status === "failed" ? "danger/text" : "text/secondary"}>{state}</Text>
      </View>
    </View>
  );
}

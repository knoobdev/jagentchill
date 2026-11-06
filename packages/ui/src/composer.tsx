import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "./Icon.tsx";
import { IconButton } from "./button.tsx";
import { AttachmentChip, type Attachment } from "./chips.tsx";
import { COMPOSER, fitPills, sendKeyAction, sendState, textareaHeight } from "./logic/content.ts";
import { Menu, type MenuItem } from "./menu.tsx";
import { BottomSheet } from "./overlay.tsx";
import { hasDom } from "./platform/dom";
import { Tap, keyOf, type KeyEvent } from "./tap.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { borderWidth, control, radius, size, space } from "./tokens.ts";

export type ComposerPill = {
  id: string; label: string; icon?: IconName;
  /** An unattended mode: the pill shows a `warning/icon` marker next to the word of the mode. */
  unattended?: boolean; onPress?(): void; menu?: MenuItem[]; requiresHost?: boolean;
};

/** A pill of the control row: 28 px, radius full, hairline border, icon, label and chevron. */
export function ComposerPillButton(props: { pill: ComposerPill; onMeasure?(width: number): void }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<View>(null);
  const { pill } = props;
  return (
    <View onLayout={(event) => props.onMeasure?.(event.nativeEvent.layout.width)}>
      <Tap ref={ref} role="button" label={pill.label} testID={`composer-pill-${pill.id}`} expanded={pill.menu ? open : undefined} requiresHost={pill.requiresHost} target onPress={() => (pill.menu ? setOpen(true) : pill.onPress?.())}
        style={(state) => ({ height: control.sm, paddingHorizontal: space[2] + space[0.5], borderRadius: radius.full, borderWidth: borderWidth.hairline, borderColor: theme.color("border/hairline"), flexDirection: "row", alignItems: "center", gap: space[1.5],
          backgroundColor: state.hovered || state.pressed ? theme.color("bg/hover") : "transparent" })}>
        {pill.unattended ? <Icon name="warn" size={14} color="warning/icon" /> : pill.icon ? <Icon name={pill.icon} size={14} /> : null}
        <Text variant="body-medium" numberOfLines={1}>{pill.label}</Text>
        {pill.menu ? <Icon name="chev-d" size={12} color="text/secondary" /> : null}
      </Tap>
      {pill.menu ? <Menu open={open} anchor={ref} items={pill.menu} label={pill.label} side="top" onClose={() => setOpen(false)} /> : null}
    </View>
  );
}

export type ComposerProps = {
  value: string; onChangeText(value: string): void; placeholder: string;
  /** Accessible name of the text field. */
  label?: string;
  onSend(): void; onStop?(): void;
  /** A run is active in the session: while the composer is empty the send button is a stop button. */
  running?: boolean;
  /** Slot at the top inside the card, e.g. the no-host banner. */
  banner?: ReactNode;
  attachments?: Attachment[]; onRemoveAttachment?(index: number): void; onRetryAttachment?(index: number): void;
  target?: ComposerPill; mode?: ComposerPill; pills?: ComposerPill[]; onAttach?(): void; attachOptions?: MenuItem[]; onDictate?(): void; sendOptions?: MenuItem[];
  /** Slot at the end of the control row, before dictation and send: the context window meter of a session. */
  trailing?: ReactNode;
  /** The "Run options" button after the control pills: a menu of the options of the next run. */
  runOptions?: MenuItem[]; dictating?: boolean;
  /** Full pane width when docked; otherwise 320–460 px in centred layouts. */
  docked?: boolean; maxLines?: number; style?: StyleProp<ViewStyle>; forceFocus?: boolean; disabled?: boolean;
  /** `false` keeps the text editable and the draft, and disables only sending (no host connected). */
  canSend?: boolean; inputRef?: { current: TextInput | null };
  /** Session-scoped commands offered by the host while the draft starts with a slash. */
  commands?: Array<{ name: string; description: string; argsHint?: string; acceptsArgs?: boolean; source?: string; template?: string }>;
  commandListLoaded?: boolean;
  commandModelLabel?: string;
};

/**
 * The composer card: radius 12, hairline border, `elevation/1`. A banner slot, a textarea that grows from 2 to 10 lines, an
 * attachment row, and a control row whose pills collapse into a settings-sliders overflow button when they do not fit.
 * Focus draws a 2 px `border/control` border, not the accent ring.
 */
export function Composer(props: ComposerProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [lines, setLines] = useState<number>(COMPOSER.minLines);
  const [rowWidth, setRowWidth] = useState(0);
  const [fixed, setFixed] = useState(0);
  const [end, setEnd] = useState(0);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const [dismissedCommandQuery, setDismissedCommandQuery] = useState<string | null>(null);
  const [pendingCommandRun, setPendingCommandRun] = useState<string | null>(null);
  const sendRef = useRef(props.onSend);
  sendRef.current = props.onSend;
  const commandScope = useId();
  const runRef = useRef<View>(null);
  const attachRef = useRef<View>(null);
  const overflowRef = useRef<View>(null);
  const sendOptionsRef = useRef<View>(null);
  const input = useRef<TextInput>(null);
  const attachments = props.attachments ?? [];
  const state = sendState({ text: props.value, attachments, running: Boolean(props.running) });
  const send = { ...state, enabled: state.enabled && (state.mode === "stop" || props.canSend !== false) };
  const pills = props.pills ?? [];
  const measured = pills.every((pill) => widths[pill.id] !== undefined);
  const fit = measured && rowWidth > 0 ? fitPills(rowWidth - end - space[2], fixed, pills.map((pill) => widths[pill.id]!), space[1], control.sm) : { shown: pills.length, overflow: 0 };
  const type = theme.type("body", props.value);
  const maxLines = Math.max(COMPOSER.minLines, Math.min(COMPOSER.maxLines, props.maxLines ?? COMPOSER.maxLines));
  const grown = textareaHeight(Math.max(lines, props.value.split("\n").length), type.lineHeight, 0, COMPOSER.minLines, maxLines);
  const edge = focused || props.forceFocus ? borderWidth.focus : borderWidth.hairline;
  const submit = () => { if (send.mode === "stop") props.onStop?.(); else if (send.enabled) sendNow(); };
  // The send key: a typed message is sent also while a turn runs (the caller steers or queues it); the button is Stop then.
  const keyAction = sendKeyAction({ text: props.value, attachments, running: Boolean(props.running), canSend: props.canSend });
  // Vietnamese (and other) input methods: Enter while a word is still being composed sends the message, then the input
  // method writes that last word again into the emptied field — and the next Enter sends it a second time. The word
  // is committed first (Enter waits for the end of the composition), and a tail of the sent text that arrives right
  // after sending is dropped.
  const lastSent = useRef<{ text: string; at: number } | null>(null);
  const waitingComposition = useRef(false);
  const sendNow = () => { lastSent.current = { text: props.value, at: Date.now() }; props.onSend(); };
  const sendKey = () => { if (keyAction === "send") sendNow(); else if (keyAction === "stop") props.onStop?.(); };
  const latestSendKey = useRef(sendKey);
  latestSendKey.current = sendKey;
  const echoOfSent = (value: string) => {
    const sent = lastSent.current;
    if (!sent || Date.now() - sent.at > 600 || !value.trim()) return false;
    return sent.text.trimEnd().endsWith(value.trim()) && value.trim().length < sent.text.trim().length;
  };
  const handleCommandKey = (event: KeyEvent): boolean => {
    const key = keyOf(event);
    if (!commandOpen) return false;
    if (key.key === "Escape" || key.key === "Esc") { key.preventDefault(); setDismissedCommandQuery(commandQuery); return true; }
    if (!suggestions.length) return false;
    if (key.key === "ArrowDown" || key.key === "ArrowUp") { key.preventDefault(); setCommandIndex((index) => (index + (key.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length); return true; }
    if ((key.key === "Enter" && !key.shift && !theme.touch) || key.key === "Tab") { key.preventDefault(); chooseCommand(suggestions[commandIndex] ?? suggestions[0]!); return true; }
    return false;
  };
  const commandMatch = /^\s*\/([^\s/]*)$/.exec(props.value);
  const commandQuery = commandMatch?.[1] ?? "";
  const commandOpen = !!commandMatch && dismissedCommandQuery !== commandQuery;
  const suggestions = commandOpen
    ? (props.commands ?? []).filter((entry) => entry.name.toLowerCase().startsWith(commandQuery.toLowerCase()))
    : [];
  useEffect(() => {
    if (pendingCommandRun === null || props.value !== pendingCommandRun) return;
    setPendingCommandRun(null);
    if (props.canSend !== false) sendRef.current();
  }, [pendingCommandRun, props.value, props.canSend]);
  useEffect(() => {
    if (!commandOpen || !hasDom) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      const composer = target instanceof Element ? target.closest("[data-slash-composer]") : null;
      if (target instanceof Element) {
        const row = target.closest<HTMLElement>("[id^='slash-command-']");
        const prefix = `slash-command-${commandScope}-`;
        if (row?.id.startsWith(prefix)) {
        const name = row.id.slice(prefix.length);
        const entry = (props.commands ?? []).find((command) => command.name === name);
        if (entry) { event.preventDefault(); chooseCommand(entry); return; }
        }
      }
      if (composer?.getAttribute("data-slash-composer") !== commandScope) setDismissedCommandQuery(commandQuery);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setDismissedCommandQuery(commandQuery); }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => { document.removeEventListener("pointerdown", onPointerDown, true); document.removeEventListener("keydown", onKeyDown, true); };
  }, [commandOpen, commandQuery, commandScope, props.commands]);
  const sourceGroup = (source?: string) => source === "builtin" ? "builtin" : source === "skill" ? "skill" : source?.startsWith("claude") ? "claude-code" : source?.startsWith("codex") ? "codex" : source ?? "runtime";
  const commandSources: Record<string, string> = { builtin: theme.t("commandSourceJAgentChill"), skill: theme.t("commandSourceSkills"), "claude-code": theme.t("commandSourceClaude"), codex: theme.t("commandSourceCodex"), runtime: theme.t("commandSourceRuntime") };
  const paletteEntries = suggestions.slice(0, 8);
  const groupOrder = ["codex", "claude-code", "runtime", "skill", "builtin"];
  const commandGroups = groupOrder.flatMap((source) => {
    const entries = paletteEntries.filter((entry) => sourceGroup(entry.source) === source);
    return entries.length ? [{ source, entries }] : [];
  });
  const chooseCommand = (entry: NonNullable<ComposerProps["commands"]>[number]) => {
    const takesArguments = Boolean(entry.acceptsArgs || entry.argsHint);
    const completed = `/${entry.name}${takesArguments ? " " : ""}`;
    setPendingCommandRun(takesArguments ? null : completed);
    props.onChangeText(completed);
    setDismissedCommandQuery(null);
    setCommandIndex(0);
    if (hasDom) requestAnimationFrame(() => {
      const field = input.current as unknown as HTMLTextAreaElement | null;
      field?.focus();
      field?.setSelectionRange(completed.length, completed.length);
    });
  };
  const overflowItems: MenuItem[] = pills.slice(fit.shown).map((pill) => ({ id: pill.id, label: pill.label, icon: pill.unattended ? "warn" : pill.icon, onSelect: pill.onPress, submenu: pill.menu, requiresHost: pill.requiresHost }));
  const commandPalette = <View testID="slash-command-menu" accessibilityRole="list" style={{ width: "100%", minWidth: 0, borderBottomWidth: borderWidth.hairline, borderBottomColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/app") }}>
    {!suggestions.length ? <View testID="slash-command-empty" style={{ paddingHorizontal: space[3], paddingVertical: space[3] }}><Text variant="meta" color="text/secondary">{props.commandListLoaded === false ? theme.t("Loading commands for {model}", { model: props.commandModelLabel ?? "model" }) : theme.t("No commands for {model}", { model: props.commandModelLabel ?? "model" })}</Text></View> : null}
    <View style={{ maxHeight: theme.compact ? 280 : theme.touch ? 320 : 436, overflow: "auto" } as never}>
      {commandGroups.map((group) => <View key={group.source}>
        <Text variant="meta" color="text/secondary" style={{ paddingHorizontal: space[3], paddingTop: space[2] }}>{commandSources[group.source] ?? group.source}</Text>
        {group.entries.map((entry) => {
          const index = suggestions.indexOf(entry);
          return <Tap key={`${entry.source ?? "runtime"}:${entry.name}`} role="button" label={`/${entry.name}`} nativeID={`slash-command-${commandScope}-${entry.name}`} onPress={() => chooseCommand(entry)} target testID={`slash-command-${entry.name}`}
            style={(state) => ({ width: "100%", alignSelf: "stretch", minHeight: 48, paddingHorizontal: space[3], paddingVertical: space[1.5], borderRadius: radius.sm, flexDirection: "row", alignItems: "center", gap: space[2], backgroundColor: index === commandIndex || state.hovered ? theme.color("bg/hover") : "transparent" })}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: space[2] }}><Text variant="body-medium">/{entry.name}</Text>{entry.argsHint ? <Text variant="meta" color="text/secondary">{entry.argsHint}</Text> : null}</View>
              {entry.description ? <Text variant="meta" color="text/secondary" numberOfLines={1}>{entry.description}</Text> : null}
            </View>
          </Tap>;
        })}
      </View>)}
    </View>
    <Text variant="meta" color="text/secondary" style={{ paddingHorizontal: space[3], paddingVertical: space[2], borderTopWidth: borderWidth.hairline, borderTopColor: theme.color("border/hairline") }}>{theme.t("commandKeys")}</Text>
  </View>;
  return (
    <View testID="composer" {...(hasDom ? { "data-slash-composer": commandScope, onKeyDown: (event: KeyEvent) => { if (event.nativeEvent.key === "Escape" && commandOpen) { event.preventDefault(); setDismissedCommandQuery(commandQuery); } } } : {})} style={[{ borderRadius: radius.lg, borderWidth: edge, borderColor: theme.color(focused || props.forceFocus ? "border/control" : "border/hairline"), backgroundColor: theme.color("bg/app"), overflow: "hidden",
      minWidth: props.docked ? undefined : size.composerMin, maxWidth: props.docked ? undefined : size.composerMax, width: "100%", alignSelf: props.docked ? "stretch" : "center" }, theme.elevation(1),
      { borderWidth: edge, borderColor: theme.color(focused || props.forceFocus ? "border/control" : "border/hairline") }, props.style]}>
      {props.banner ? <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2], paddingVertical: space[2], paddingHorizontal: space[3], backgroundColor: theme.color("bg/inset"), borderBottomWidth: borderWidth.hairline, borderBottomColor: theme.color("border/hairline") }}>{props.banner}</View> : null}
      {commandOpen && theme.compact ? <BottomSheet open title={theme.t("commandsTitle")} onClose={() => setDismissedCommandQuery(commandQuery)} scrollable={false}>{commandPalette}</BottomSheet> : null}
      {commandOpen && !theme.compact ? <View style={{ maxHeight: theme.touch ? 360 : 480, alignSelf: "stretch", overflow: "hidden" }}>{commandPalette}</View> : null}
      <TextInput ref={(node) => { input.current = node; if (props.inputRef) props.inputRef.current = node; }} multiline testID="composer-input" accessibilityLabel={props.label ?? theme.t("message")} aria-label={props.label ?? theme.t("message")} placeholder={props.placeholder} placeholderTextColor={theme.color("text/placeholder")}
        value={props.value} onChangeText={(value) => { if (echoOfSent(value)) { props.onChangeText(""); return; } if (value !== props.value) setDismissedCommandQuery(null); props.onChangeText(value); }} editable={!props.disabled} scrollEnabled={grown.scrolls}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        // The reported height includes the field's own vertical padding on web; counting it as text would grow the field on every report.
        onContentSizeChange={(event) => setLines(props.value.length === 0 ? COMPOSER.minLines : Math.max(1, Math.round((event.nativeEvent.contentSize.height - (hasDom ? space[3] + space[1] : 0)) / type.lineHeight)))}
        {...({
          onKeyPress: (event: KeyEvent) => {
            const key = keyOf(event); if (handleCommandKey(event)) return;
            if (key.key === "Enter" && !key.shift && !theme.touch) {
              key.preventDefault();
              const native = event.nativeEvent as { isComposing?: boolean; keyCode?: number };
              if (native.isComposing || native.keyCode === 229) { waitingComposition.current = true; return; }
              sendKey();
            }
          },
          ...(hasDom ? {
            onKeyDown: (event: KeyEvent) => { if (handleCommandKey(event)) event.stopPropagation(); },
            onCompositionEnd: () => { if (!waitingComposition.current) return; waitingComposition.current = false; setTimeout(() => latestSendKey.current(), 30); },
          } : {}),
        } as object)}
        style={[type, { height: grown.height + space[3] + space[1], paddingTop: space[3], paddingHorizontal: space[3], paddingBottom: space[1], color: theme.color("text/primary"), outlineWidth: 0, textAlignVertical: "top" }]} />
      {attachments.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1.5], paddingHorizontal: space[3], paddingBottom: space[1] }}>
          {attachments.map((file, index) => <AttachmentChip key={`${file.name}-${index}`} file={file} onRemove={() => props.onRemoveAttachment?.(index)} onRetry={props.onRetryAttachment ? () => props.onRetryAttachment!(index) : undefined} />)}
        </View>
      ) : null}
      <View onLayout={(event) => setRowWidth(event.nativeEvent.layout.width - 2 * space[2])} style={{ flexDirection: "row", alignItems: "center", gap: space[1], padding: space[2] }}>
        <View onLayout={(event) => setFixed(event.nativeEvent.layout.width)} style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
          {props.onAttach ? <IconButton ref={attachRef} icon="plus" compactVisual label={theme.t("attach")} testID="composer-attach" expanded={props.attachOptions ? attachOpen : undefined} onPress={() => props.attachOptions ? setAttachOpen(true) : props.onAttach?.()} /> : null}
          {props.mode ? <ComposerPillButton pill={props.mode} /> : null}
        </View>
        {/* Pills are measured once in place; those that do not fit move to the overflow button. */}
        {pills.map((pill, index) => (
          <View key={pill.id} style={measured && index >= fit.shown ? { position: "absolute", opacity: 0 } : null} pointerEvents={measured && index >= fit.shown ? "none" : "auto"} aria-hidden={measured && index >= fit.shown}>
            <ComposerPillButton pill={pill} onMeasure={(width) => setWidths((all) => (all[pill.id] === width ? all : { ...all, [pill.id]: width }))} />
          </View>
        ))}
        {props.target ? <ComposerPillButton pill={props.target} /> : null}
        {props.runOptions ? <IconButton ref={runRef} icon="sliders" compactVisual label={theme.t("runOptions")} testID="composer-run-options" expanded={runOpen} onPress={() => setRunOpen(true)} /> : null}
        {fit.overflow > 0 ? <IconButton ref={overflowRef} icon="sliders" compactVisual label={theme.t("moreSettings")} testID="composer-overflow" expanded={overflowOpen} onPress={() => setOverflowOpen(true)} /> : null}
        <View style={{ flex: 1 }} />
        <View onLayout={(event) => setEnd(event.nativeEvent.layout.width)} style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
          {props.trailing}
          {props.onDictate ? <IconButton icon="mic" compactVisual label={theme.t("dictate")} testID="composer-dictate" on={props.dictating} tone={props.dictating ? "accent" : undefined} onPress={props.onDictate} /> : null}
          {/* With a message typed the round button sends it; the turn that runs is still stopped from here. */}
          {props.running && props.onStop && send.mode === "send" ? <IconButton icon="stop" compactVisual label={theme.t("stop")} onPress={props.onStop} testID="composer-stop" /> : null}
          <Tap role="button" label={theme.t(send.mode === "stop" ? "stop" : "send")} disabled={!send.enabled} onPress={submit} target testID="composer-send"
            style={{ width: size.send, height: size.send, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: theme.color(send.enabled ? "strong" : "bg/subtle"), opacity: 1 }}>
            <Icon name={send.mode === "stop" ? "stop" : "arrow-up"} size={14} color={send.enabled ? "text/on-strong" : "text/tertiary"} />
          </Tap>
          {props.sendOptions && (send.mode === "send" || keyAction === "send") ? <IconButton ref={sendOptionsRef} icon="chev-d" size="xs" compactVisual label={theme.t("sendOptions")} expanded={optionsOpen} disabled={keyAction !== "send"} onPress={() => setOptionsOpen(true)} testID="composer-send-options" /> : null}
        </View>
      </View>
      {props.runOptions ? <Menu open={runOpen} anchor={runRef} items={props.runOptions} label={theme.t("runOptions")} side="top" onClose={() => setRunOpen(false)} /> : null}
      {props.attachOptions ? <Menu open={attachOpen} anchor={attachRef} items={props.attachOptions} label={theme.t("attach")} side="top" onClose={() => setAttachOpen(false)} /> : null}
      <Menu open={overflowOpen} anchor={overflowRef} items={overflowItems} label={theme.t("moreSettings")} side="top" onClose={() => setOverflowOpen(false)} />
      {props.sendOptions ? <Menu open={optionsOpen} anchor={sendOptionsRef} items={props.sendOptions} label={theme.t("sendOptions")} side="top" align="end" onClose={() => setOptionsOpen(false)} /> : null}
    </View>
  );
}

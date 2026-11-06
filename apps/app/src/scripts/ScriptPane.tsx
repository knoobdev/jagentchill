import { memo, useEffect, useRef, useState, type RefObject } from "react";
import { ScrollView, Text as RNText, TextInput, View, type NativeSyntheticEvent, type TextInputKeyPressEventData, type TextStyle } from "react-native";
import { SCRIPT_LINE_TEXT_MAX, type ScriptBeat, type ScriptLine, type ScriptLineKind, type ScriptScene } from "@jagentchill/protocol";
import { script as s } from "@jagentchill/editor-core";
import { Button, Chip, EmptyState, Icon, IconButton, Menu, Select, Tap, Text, fontFamily, radius, space, useTheme, type IconName, type MenuItem } from "@jagentchill/ui";
import { useT } from "../locale";
import { useScriptEditor, type FocusTarget } from "./context";
import { LABELS, optionsOf } from "./strings";

/** The text column of a script is at most 720 px wide. */
export const SCRIPT_COLUMN = 720;
const fields = new Map<string, TextInput>();
const fieldKey = (id: string, field: string): string => `${id}:${field}`;
type KeyEvent = NativeSyntheticEvent<TextInputKeyPressEventData> & { preventDefault(): void };
/** An input-method composition (Telex, VNI, Japanese and Chinese IME) is never interrupted by a typing rule. */
const composing = (event: KeyEvent): boolean => { const native = event.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number }; return native.isComposing === true || native.keyCode === 229; };

type FieldProps = {
  id: string; field: string; value: string; label: string; placeholder?: string; multiline?: boolean; maxLength?: number; variant?: "body" | "meta" | "body-medium" | "mono"; color?: "text/primary" | "text/secondary";
  style?: TextStyle; readOnly?: boolean; testID?: string; onChangeText(text: string): void; onBlur?(): void; onFocus?(): void; onKey?(event: KeyEvent, caret: number): void;
};
/** A field of the script edited in place: no box, the document's own type, and a quiet fill while it has the focus. */
function Field(props: FieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const caret = useRef(0);
  const type = theme.type(props.variant ?? "body", props.value);
  const box: TextStyle = { paddingVertical: space[0.5], paddingHorizontal: space[1], minWidth: 0, minHeight: (type.lineHeight as number) + space[1] };
  const input = (
    <TextInput ref={(node) => { if (node) fields.set(fieldKey(props.id, props.field), node); else fields.delete(fieldKey(props.id, props.field)); }}
      value={props.value} onChangeText={props.onChangeText} placeholder={props.placeholder} placeholderTextColor={theme.color("text/placeholder")} multiline={props.multiline} maxLength={props.maxLength}
      editable={!props.readOnly} readOnly={props.readOnly} aria-label={props.label} testID={props.testID} spellCheck={false}
      onSelectionChange={(event) => { caret.current = event.nativeEvent.selection.start; }}
      onFocus={() => { setFocused(true); props.onFocus?.(); }} onBlur={() => { setFocused(false); props.onBlur?.(); }}
      {...({ onKeyPress: props.onKey ? (event: KeyEvent) => props.onKey!(event, caret.current) : undefined } as object)}
      style={[type, box, { color: theme.color(props.color ?? "text/primary"), borderRadius: radius.xs, outlineWidth: 0, backgroundColor: focused && !props.readOnly ? theme.color("bg/subtle") : "transparent" }, props.variant === "mono" ? { fontFamily: fontFamily.mono } : null,
        props.multiline ? { position: "absolute", top: 0, bottom: 0, start: 0, end: 0, textAlignVertical: "top", ...({ resize: "none", overflow: "hidden" } as object) } : null, props.style]} />
  );
  if (!props.multiline) return input;
  // A block of text is as tall as its text: an invisible copy in the same type gives the field its height.
  return (
    <View>
      <RNText aria-hidden style={[type, box, props.variant === "mono" ? { fontFamily: fontFamily.mono } : null, props.style, { opacity: 0 }]}>{`${props.value || props.placeholder || " "}\u200b`}</RNText>
      {input}
    </View>
  );
}
/** Puts the caret where a typing rule or a navigation asked for it. */
function applyFocus(target: FocusTarget): boolean {
  const node = fields.get(fieldKey(target.field === "location" ? target.sceneId ?? "" : target.lineId ?? "", target.field));
  if (!node) return false;
  node.focus();
  const element = node as unknown as { setSelectionRange?(start: number, end: number): void; value?: string };
  if (target.caret !== undefined && element.setSelectionRange) { const at = Math.min(target.caret, element.value?.length ?? target.caret); element.setSelectionRange(at, at); }
  return true;
}

const hasFocus = (target: FocusTarget): boolean => {
  const node = fields.get(fieldKey(target.field === "location" ? target.sceneId ?? "" : target.lineId ?? "", target.field)) as unknown as { isFocused?(): boolean } | undefined;
  return !!node?.isFocused?.();
};
const KIND_ICON: Partial<Record<ScriptLineKind, IconName>> = { visual_note: "eye", sound_note: "vol" };
const LineRow = memo(function LineRow(props: { line: ScriptLine; beat: ScriptBeat; scene: ScriptScene; ticks: number; selected: boolean; found: boolean; comments: number; index: number }) {
  const t = useT(), theme = useTheme(), editor = useScriptEditor(), { line, beat, scene } = props;
  const [menu, setMenu] = useState(false);
  const [slash, setSlash] = useState(false);
  const [cue, setCue] = useState<string | null>(null);
  const [parenthetical, setParenthetical] = useState(false);
  const more = useRef<View>(null), row = useRef<View>(null);
  const spoken = line.kind === "dialogue" || line.kind === "narration", ticked = props.selected && !editor.selection.fromCaret;
  const speaker = s.speakerOf(editor.document, line);
  const run = editor.run;
  const act = (outcome: s.TypingOutcome | null, event?: KeyEvent): boolean => {
    if (!outcome) return false;
    event?.preventDefault();
    let info: { lineId?: string; sceneId?: string } | undefined;
    // A refused command leaves the document as it was: the caret stays where it is.
    for (const command of outcome.commands) { const before = editor.session.document, result = run(command) as typeof info; if (editor.session.document === before) return true; info = { ...info, ...result }; }
    if (outcome.focus.field === "parenthetical") setParenthetical(true);
    editor.setFocus({ lineId: outcome.focus.created ? info?.lineId : outcome.focus.lineId, sceneId: info?.sceneId, field: outcome.focus.field, caret: outcome.focus.caret });
    return true;
  };
  const onKey = (field: s.TypingField) => (event: KeyEvent, caret: number) => {
    const key = event.nativeEvent.key, shift = (event.nativeEvent as unknown as { shiftKey?: boolean }).shiftKey === true;
    const mapped: s.TypingKey | null = key === "Enter" && !shift ? "Enter" : key === "Tab" ? (shift ? "ShiftTab" : "Tab") : key === "Backspace" ? "Backspace" : null;
    if (!mapped || editor.readOnly) return;
    if (field === "cue" && mapped === "Enter") commitCue();
    act(s.typingRule(editor.document, { key: mapped, lineId: line.id, field, caret, composing: composing(event) }), event);
  };
  const commitCue = () => { if (cue !== null && cue.trim().toLowerCase() !== speaker.toLowerCase()) run(s.setSpeaker(line.id, cue)); setCue(null); };
  const change = (text: string) => {
    if (line.text === "" && text === "/") { setSlash(true); return; }
    if (act(s.textRule(editor.document, line.id, text))) return;
    run(s.updateLine(line.id, { text }));
  };
  const kinds: MenuItem[] = (Object.keys(LABELS.kind) as ScriptLineKind[]).map((kind) => ({ id: `kind-${kind}`, label: t(LABELS.kind[kind]), checked: line.kind === kind, onSelect: () => { run(s.setLineKind([line.id], kind)); editor.setFocus({ lineId: line.id, field: kind === "dialogue" ? "cue" : "text" }); } }));
  const items: MenuItem[] = [
    { id: "kind", label: t("Change kind"), icon: "type", submenu: kinds },
    { id: "up", label: t("Move up"), icon: "arrow-up", onSelect: () => run(s.moveLineBy(line.id, -1)) }, { id: "down", label: t("Move down"), icon: "arrow-d", onSelect: () => run(s.moveLineBy(line.id, 1)) },
    { id: "duplicate", label: t("Duplicate"), icon: "copy", onSelect: () => run(s.duplicateLine(line.id)) },
    { type: "separator" },
    { id: "split-scene", label: t("Split scene here"), icon: "split", onSelect: () => run(s.splitScene(line.id)) }, { id: "split-beat", label: t("Split beat here"), icon: "split", onSelect: () => run(s.splitBeat(line.id)) },
    { id: "shot", label: t("Create shot"), icon: "camera", onSelect: () => { const made = run(s.shotFromSelection(props.selected && editor.selection.lineIds.length ? editor.selection.lineIds : [line.id])); if (made) editor.select({ shotIds: [made.shotId] }); } },
    { id: "comment", label: t("Comment"), icon: "chat", onSelect: () => { editor.select({ sceneId: scene.id, lineIds: [line.id] }); editor.openInspector("comments"); } },
    { type: "separator" },
    { id: "delete", label: t("Delete"), icon: "trash", danger: true, onSelect: () => run(s.deleteLines([line.id])) },
  ];
  const slashItems: MenuItem[] = [
    ...kinds.map((item) => ("id" in item ? { ...item, id: `slash-${item.id}`, checked: undefined } : item)),
    { type: "separator" },
    { id: "slash-scene", label: t("New scene"), onSelect: () => { const made = run(s.addScene({ afterSceneId: scene.id })); if (made) editor.setFocus({ lineId: made.lineId, field: "text" }); } },
    { id: "slash-beat", label: t("New beat"), onSelect: () => { const made = run(s.addBeat(scene.id, beat.id)); if (made) editor.setFocus({ lineId: made.lineId, field: "text" }); } },
    { id: "slash-shot", label: t("New shot"), onSelect: () => { const made = run(s.addShot(scene.id, { fields: { lineIds: [line.id], beatId: beat.id } })); if (made) editor.select({ shotIds: [made.shotId] }); } },
  ];
  const text = (style?: TextStyle, color?: "text/secondary") => (
    <Field id={line.id} field="text" value={line.text} multiline label={t(LABELS.kind[line.kind])} placeholder={t(LABELS.kind[line.kind])} maxLength={SCRIPT_LINE_TEXT_MAX[line.kind]} readOnly={editor.readOnly} color={color} style={style}
      testID={`line-text-${props.index}`} onChangeText={change} onKey={onKey("text")} onFocus={() => editor.select({ sceneId: scene.id, ...(props.selected ? {} : { lineIds: [line.id], fromCaret: true }) })} onBlur={() => editor.session.seal()} />
  );
  const suggestions = cue !== null ? s.completeCue(editor.document, cue).filter((entity) => entity.name.toLowerCase() !== cue.trim().toLowerCase()).slice(0, 5) : [];
  const body = spoken ? (
    <View style={{ alignSelf: "center", width: "100%", maxWidth: 440 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[1] }}>
        <Field id={line.id} field="cue" value={cue ?? speaker} label={t("Speaker")} placeholder={line.kind === "narration" ? t("NARRATOR") : t("SPEAKER")} maxLength={60} variant="body-medium" readOnly={editor.readOnly} testID={`line-cue-${props.index}`}
          style={{ textAlign: "center", textTransform: "uppercase", flex: 1 }} onChangeText={setCue} onFocus={() => { setCue(speaker); editor.select({ sceneId: scene.id, ...(props.selected ? {} : { lineIds: [line.id], fromCaret: true }) }); }} onBlur={commitCue} onKey={onKey("cue")} />
        {line.kind === "narration" ? <Chip label={t("V.O.")} size="sm" /> : null}
      </View>
      {suggestions.length ? <View style={{ flexDirection: "row", justifyContent: "center", gap: space[1], flexWrap: "wrap" }}>{suggestions.map((entity) => <Chip key={entity.id} size="sm" label={entity.name} onPress={() => { run(s.setSpeaker(line.id, entity.name)); setCue(null); editor.setFocus({ lineId: line.id, field: "text" }); }} />)}</View> : null}
      {line.kind === "dialogue" && !speaker && cue === null ? <Text variant="meta" color="warning/text" align="center" testID="line-needs-speaker">{t("Add a speaker")}</Text> : null}
      {line.parenthetical !== undefined || parenthetical ? (
        <Field id={line.id} field="parenthetical" value={line.parenthetical ?? ""} label={t("Parenthetical")} placeholder={t("(parenthetical)")} maxLength={120} color="text/secondary" readOnly={editor.readOnly} testID={`line-parenthetical-${props.index}`}
          style={{ textAlign: "center", fontStyle: "italic" }} onChangeText={(value) => run(s.updateLine(line.id, { parenthetical: value }))} onBlur={() => { if (!line.parenthetical) setParenthetical(false); }} onKey={onKey("parenthetical")} />
      ) : null}
      {text(line.kind === "narration" ? { fontStyle: "italic" } : undefined)}
    </View>
  ) : line.kind === "on_screen_text" ? (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[1], borderWidth: 1, borderColor: theme.color("border/hairline"), borderRadius: radius.sm, paddingHorizontal: space[1], paddingVertical: space[0.5], alignSelf: "flex-start", maxWidth: "100%", minWidth: 200 }}>
      <View style={{ paddingTop: space[1] }}><Chip label={t("TEXT")} size="sm" /></View>
      <View style={{ flex: 1, minWidth: 0 }}>{text()}</View>
    </View>
  ) : line.kind === "visual_note" || line.kind === "sound_note" ? (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[1] }}>
      <View style={{ paddingTop: space[1] }}><Icon name={KIND_ICON[line.kind]!} size={14} color="text/secondary" label={t(LABELS.kind[line.kind])} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>{text(undefined, "text/secondary")}</View>
    </View>
  ) : line.kind === "transition" ? text({ textAlign: "right", textTransform: "uppercase" }) : text();
  return (
    <View ref={row} testID={`line-${props.index}`} {...({ dataSet: { kind: line.kind, line: line.id, selected: props.selected ? "true" : "false" } } as object)}
      style={{ flexDirection: "row", alignItems: "flex-start", gap: space[1], borderRadius: radius.sm, backgroundColor: props.found ? theme.color("warning/subtle") : props.selected && editor.selection.lineIds.length > 1 ? theme.color("accent/subtle") : "transparent" }}>
      <Tap role="checkbox" label={t("Select line")} checked={ticked} testID={`line-select-${props.index}`} disabled={editor.readOnly}
        onPress={() => {
          // Shift-click extends the selection to this line; a plain click toggles it.
          const all = editor.document.scenes.flatMap((entry) => s.sceneLines(entry).map((item) => item.id)), current = editor.selection.fromCaret ? [] : editor.selection.lineIds;
          const anchor = current[current.length - 1], shift = heldShift();
          if (shift && anchor && anchor !== line.id) { const [from, to] = [all.indexOf(anchor), all.indexOf(line.id)].sort((a, b) => a - b); editor.select({ sceneId: scene.id, lineIds: all.slice(from, to + 1) }); }
          else editor.select({ sceneId: scene.id, lineIds: current.includes(line.id) ? current.filter((id) => id !== line.id) : [...current, line.id] });
        }}
        style={() => ({ width: 20, height: 24, alignItems: "center", justifyContent: "center" })}>
        <View style={{ width: 12, height: 12, borderRadius: radius.xs, borderWidth: 1, borderColor: theme.color(ticked ? "accent" : "border/strong"), backgroundColor: ticked ? theme.color("accent") : "transparent" }} />
      </Tap>
      <View style={{ flex: 1, minWidth: 0 }}>{body}</View>
      <View style={{ width: 44, alignItems: "flex-end", paddingTop: space[1] }}>
        {props.ticks > 0 ? <Text variant="meta" color="text/secondary" tabular testID={`line-estimate-${props.index}`}>{s.formatSeconds(props.ticks)}</Text> : null}
        {line.needsCheck ? <Icon name="warn" size={12} color="warning/text" label={t("Check this fact")} /> : null}
        {props.comments ? <Icon name="chat" size={12} color="text/secondary" label={t("Has comments")} /> : null}
      </View>
      {editor.readOnly ? <View style={{ width: 24 }} /> : <IconButton ref={more} icon="more" size="xs" label={t("Line actions")} testID={`line-menu-${props.index}`} expanded={menu} onPress={() => setMenu(true)} />}
      <Menu open={menu} anchor={more} items={items} label={t("Line actions")} align="end" onClose={() => setMenu(false)} />
      <Menu open={slash} anchor={row as RefObject<View | null>} items={slashItems} label={t("Insert")} onClose={() => setSlash(false)} />
    </View>
  );
});
let shiftHeld = false;
const heldShift = (): boolean => shiftHeld;
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("keydown", (event) => { if (event.key === "Shift") shiftHeld = true; });
  window.addEventListener("keyup", (event) => { if (event.key === "Shift") shiftHeld = false; });
  window.addEventListener("blur", () => { shiftHeld = false; });
}

function BeatGroup(props: { beat: ScriptBeat; scene: ScriptScene; first: number; ticks: Map<string, number> }) {
  const t = useT(), theme = useTheme(), editor = useScriptEditor(), { beat, scene } = props;
  const [menu, setMenu] = useState(false);
  const more = useRef<View>(null);
  const run = editor.run;
  const comments = (lineId: string) => editor.session.history.comments.filter((comment) => !comment.resolved && comment.anchor.id === lineId).length;
  const items: MenuItem[] = [
    { id: "new", label: t("New beat"), icon: "plus", onSelect: () => { const made = run(s.addBeat(scene.id, beat.id)); if (made) editor.setFocus({ lineId: made.lineId, field: "text" }); } },
    { id: "duplicate", label: t("Duplicate"), icon: "copy", onSelect: () => run(s.duplicateBeat(beat.id)) },
    { id: "up", label: t("Move up"), icon: "arrow-up", onSelect: () => run(s.moveBeat(beat.id, -1)) }, { id: "down", label: t("Move down"), icon: "arrow-d", onSelect: () => run(s.moveBeat(beat.id, 1)) },
    { id: "merge", label: t("Merge with previous beat"), icon: "layers", disabled: scene.beats[0].id === beat.id, onSelect: () => run(s.mergeBeatWithPrevious(beat.id)) },
    { type: "separator" }, { id: "delete", label: t("Delete beat"), icon: "trash", danger: true, onSelect: () => run(s.deleteBeat(beat.id)) },
  ];
  return (
    <View testID="beat" style={{ gap: space[0.5], borderStartWidth: 2, borderStartColor: theme.color("border/hairline"), paddingStart: space[2] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
        <Field id={beat.id} field="label" value={beat.label} label={t("Beat label")} placeholder={t("Beat")} maxLength={60} variant="body-medium" color="text/secondary" readOnly={editor.readOnly} testID="beat-label" style={{ width: 150 }} onChangeText={(label) => run(s.updateBeat(beat.id, { label }))} />
        <View style={{ flex: 1, minWidth: 0 }}><Field id={beat.id} field="intent" value={beat.intent} label={t("Beat intent")} placeholder={t("What this beat is for")} maxLength={300} variant="meta" color="text/secondary" readOnly={editor.readOnly} testID="beat-intent" onChangeText={(intent) => run(s.updateBeat(beat.id, { intent }))} /></View>
        {editor.readOnly ? null : <IconButton ref={more} icon="more" size="xs" label={t("Beat actions")} testID="beat-menu" expanded={menu} onPress={() => setMenu(true)} />}
        <Menu open={menu} anchor={more} items={items} label={t("Beat actions")} align="end" onClose={() => setMenu(false)} />
      </View>
      {beat.lines.map((line, index) => <LineRow key={line.id} line={line} beat={beat} scene={scene} index={props.first + index} ticks={props.ticks.get(line.id) ?? 0} selected={editor.selection.lineIds.includes(line.id)} found={editor.found.has(line.id)} comments={comments(line.id)} />)}
      {editor.readOnly ? null : <View style={{ alignItems: "flex-start" }}><Button kind="ghost" size="sm" icon="plus" label={t("Add line")} testID="add-line" onPress={() => { const made = run(s.addLine({ beatId: beat.id })); if (made) editor.setFocus({ lineId: made.lineId, field: "text" }); }} /></View>}
    </View>
  );
}

function SceneCard(props: { scene: ScriptScene; index: number; first: number; onLayout(y: number): void }) {
  const t = useT(), theme = useTheme(), editor = useScriptEditor(), { scene } = props;
  const [collapsed, setCollapsed] = useState(false);
  const ticks = s.sceneLineTicks(editor.document, scene), run = editor.run;
  const location = s.entityName(editor.document, "locations", scene.heading.locationId);
  const active = editor.selection.sceneId === scene.id;
  // On a phone the heading takes two rows: number, setting and duration, then location and time of day.
  const duration = <Text variant="meta" color="text/secondary" tabular testID={`scene-duration-${props.index + 1}`}>{s.formatClock(s.sceneTicks(editor.document, scene))}</Text>;
  let first = props.first;
  return (
    <View testID={`scene-${props.index + 1}`} {...({ dataSet: { scene: scene.id, omitted: scene.omitted ? "true" : "false" } } as object)} onLayout={(event) => props.onLayout(event.nativeEvent.layout.y)}
      style={{ borderWidth: 1, borderColor: theme.color(active ? "border/strong" : "border/hairline"), borderRadius: radius.md, padding: space[3], gap: space[2], backgroundColor: theme.color("bg/app"), opacity: scene.omitted ? 0.6 : 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[1], flexWrap: theme.compact ? "wrap" : "nowrap" }}>
        <IconButton icon={collapsed ? "chev-r" : "chev-d"} size="xs" label={collapsed ? t("Expand scene") : t("Collapse scene")} testID={`scene-collapse-${props.index + 1}`} expanded={!collapsed} onPress={() => setCollapsed(!collapsed)} />
        <Text variant="title-sm" tabular style={scene.omitted ? { textDecorationLine: "line-through" } : undefined}>{props.index + 1}</Text>
        <Select label={t("Setting")} size="sm" width={110} disabled={editor.readOnly} value={scene.heading.setting} onChange={(setting) => run(s.updateScenes([scene.id], { heading: { setting } }))} options={optionsOf(t, LABELS.setting)} />
        {theme.compact ? <View style={{ flex: 1 }} /> : null}
        {theme.compact ? duration : null}
        <View style={theme.compact ? { flexBasis: "60%", flexGrow: 1, minWidth: 120 } : { flex: 1, minWidth: 60 }}>
          <Field id={scene.id} field="location" value={location ?? scene.heading.locationText} label={t("Location")} placeholder={t("LOCATION")} maxLength={120} variant="body-medium" readOnly={editor.readOnly || !!location} testID={`scene-location-${props.index + 1}`} style={{ textTransform: "uppercase" }}
            onFocus={() => editor.select({ sceneId: scene.id })} onChangeText={(locationText) => run(s.updateScenes([scene.id], { heading: { locationText } }))} />
        </View>
        <Field id={scene.id} field="time" value={scene.heading.timeOfDay} label={t("Time of day")} placeholder={t("TIME")} maxLength={40} variant="body-medium" readOnly={editor.readOnly} testID={`scene-time-${props.index + 1}`} style={{ width: 96, textTransform: "uppercase" }} onChangeText={(timeOfDay) => run(s.updateScenes([scene.id], { heading: { timeOfDay } }))} />
        {theme.compact ? null : duration}
      </View>
      {collapsed ? null : (
        <>
          <Field id={scene.id} field="summary" value={scene.summary} label={t("Scene summary")} placeholder={t("Summary")} maxLength={500} multiline color="text/secondary" readOnly={editor.readOnly} testID={`scene-summary-${props.index + 1}`} onChangeText={(summary) => run(s.updateScenes([scene.id], { summary }))} />
          {scene.beats.map((beat) => { const start = first; first += beat.lines.length; return <BeatGroup key={beat.id} beat={beat} scene={scene} first={start} ticks={ticks} />; })}
        </>
      )}
    </View>
  );
}

/** The structured editor: an outline of scene cards with their beats as labelled groups and their lines as typed blocks. */
export function StructuredPane(props: { scroll: RefObject<ScrollView | null>; offsets: RefObject<Map<string, number>>; onImport(): void }) {
  const t = useT(), editor = useScriptEditor(), { document } = editor;
  useEffect(() => {
    if (!editor.focus) return;
    // The field of a line that was just created exists after the next paint.
    const target = editor.focus;
    // A menu that closes hands the focus back to its button a moment later: the caret is put back until it stays.
    let tries = 0, held = 0, timer = setTimeout(function attempt() {
      if (hasFocus(target)) held++; else { held = 0; applyFocus(target); }
      if (held >= 4 || ++tries >= 30) editor.setFocus(null); else timer = setTimeout(attempt, 30);
    }, 30);
    return () => clearTimeout(timer);
  }, [editor.focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const empty = document.scenes.every((scene) => s.sceneLines(scene).length === 0) && document.scenes.length <= 1 && document.scenes.every((scene) => scene.beats.length <= 1 && !scene.beats[0]?.label);
  const write = () => { const made = editor.run(s.addLine({ beatId: document.scenes[0].beats[0].id })); if (made) editor.setFocus({ lineId: made.lineId, field: "text" }); };
  let first = 0;
  return (
    <ScrollView ref={props.scroll} testID="script-pane" contentContainerStyle={{ flexGrow: 1, padding: space[3], alignItems: "center" }} keyboardShouldPersistTaps="handled">
      <View style={{ width: "100%", maxWidth: SCRIPT_COLUMN + 120, gap: space[3] }}>
        {empty && !editor.readOnly ? <EmptyState icon="doc" title={t("Start writing or import a script")} actions={[{ label: t("Write"), kind: "strong", onPress: write }, { label: t("Import"), onPress: props.onImport }]} /> : null}
        {empty ? null : document.scenes.map((scene, index) => { const start = first; first += s.sceneLines(scene).length; return <SceneCard key={scene.id} scene={scene} index={index} first={start} onLayout={(y) => props.offsets.current?.set(scene.id, y)} />; })}
        {editor.readOnly || empty ? null : <View style={{ flexDirection: "row", gap: space[2] }}><Button kind="outline" size="sm" icon="plus" label={t("New scene")} testID="add-scene" onPress={() => { const made = editor.run(s.addScene()); if (made) { editor.select({ sceneId: made.sceneId, lineIds: [] }); editor.setFocus({ lineId: made.lineId, field: "text" }); } }} /></View>}
      </View>
    </ScrollView>
  );
}

/** Plain-text mode: the whole script as one Fountain document in the monospaced typeface. Leaving the field applies the text. */
export function TextPane() {
  const t = useT(), theme = useTheme(), editor = useScriptEditor();
  const source = s.serializeFountain(editor.document, { titlePage: true });
  const [text, setText] = useState(source);
  const applied = useRef(source);
  // The document changed elsewhere (undo, an import): the text follows it.
  useEffect(() => { if (source !== applied.current) { applied.current = source; setText(source); } }, [source]);
  const apply = (value: string) => {
    if (value === applied.current || editor.readOnly) return;
    try {
      const { warnings: _warnings, ...content } = s.parseFountain(value, { ids: () => s.scriptId(), previous: editor.session.document, language: editor.document.meta.language });
      editor.run(s.replaceContent({ ...content, constraints: editor.session.document.constraints }, "Edit text", "script.text.edit"));
      applied.current = s.serializeFountain(editor.session.document, { titlePage: true });
    } catch { /* a refusal was shown by run */ }
  };
  useEffect(() => { const timer = setTimeout(() => apply(text), 700); return () => clearTimeout(timer); }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  const type = theme.type("mono");
  return (
    <ScrollView testID="text-pane" contentContainerStyle={{ flexGrow: 1, padding: space[3], alignItems: "center" }}>
      <ScrollView horizontal style={{ width: "100%", maxWidth: SCRIPT_COLUMN }} contentContainerStyle={{ flexGrow: 1 }}>
        <TextInput testID="text-mode-input" aria-label={t("Script text")} multiline value={text} onChangeText={setText} onBlur={() => apply(text)} editable={!editor.readOnly} spellCheck={false} scrollEnabled={false}
          style={[type, { fontFamily: fontFamily.mono, fontSize: Math.max(14, type.fontSize as number), lineHeight: 22, color: theme.color("text/primary"), outlineWidth: 0, flex: 1, minWidth: 520, minHeight: Math.max(400, (text.split("\n").length + 2) * 22), padding: space[2], borderWidth: 1, borderColor: theme.color("border/hairline"), borderRadius: radius.md, backgroundColor: theme.color("bg/app") }]} />
      </ScrollView>
    </ScrollView>
  );
}

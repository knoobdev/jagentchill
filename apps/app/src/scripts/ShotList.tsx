import { useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import type { ScriptScene, ScriptShot } from "@jagentchill/protocol";
import { listTransitions, script as s } from "@jagentchill/editor-core";
import { Button, Checkbox, EmptyState, IconButton, Input, Menu, Select, Text, radius, space, useTheme, useToast, type MenuItem } from "@jagentchill/ui";
import { useT, type T } from "../locale";
import { useScriptEditor } from "./context";
import { saveFile } from "./platform";
import { exportName, LABELS, messageOf, optionsOf } from "./strings";

/** "cut", or one of the basic transitions of the catalogue: the values a shot's transition can take here. */
const transitionOptions = (t: T) => [{ value: "cut", label: t("Cut") }, ...listTransitions({ category: "Basic" }).slice(0, 6).map((definition) => ({ value: definition.type, label: definition.name }))];
const WIDTHS = { number: 44, description: 240, size: 150, angle: 150, movement: 130, duration: 90, lines: 70, text: 160, source: 160, transition: 150, notes: 180 } as const;

function ShotRow(props: { scene: ScriptScene; shot: ScriptShot; number: string; index: number; checked: boolean; onCheck(checked: boolean): void }) {
  const t = useT(), theme = useTheme(), editor = useScriptEditor(), toast = useToast(), { shot, scene } = props;
  const [menu, setMenu] = useState(false);
  const [duration, setDuration] = useState<string | null>(null);
  const [durationError, setDurationError] = useState<string | undefined>(undefined);
  const more = useRef<View>(null);
  const run = editor.run, ro = editor.readOnly, ticks = s.shotTicks(editor.document, scene, shot);
  const set = (patch: s.ShotPatch) => run(s.updateShots([shot.id], patch));
  const commitDuration = () => {
    if (duration === null) return;
    const text = duration.trim();
    setDuration(null);
    if (text === "") { set({ durationOverride_ticks: undefined }); setDurationError(undefined); return; }
    const parsed = s.parseDuration(text);
    // Out of range or unreadable: the message is shown and the previous value is kept.
    if (parsed === null || parsed < 60_000 || parsed > 14_400_000) { setDurationError(t("Shot duration must be between 0.5 and 120 seconds")); return; }
    setDurationError(undefined);
    set({ durationOverride_ticks: parsed });
  };
  const items: MenuItem[] = [
    { id: "duplicate", label: t("Duplicate"), icon: "copy", onSelect: () => run(s.duplicateShot(shot.id)) },
    { id: "up", label: t("Move up"), icon: "arrow-up", onSelect: () => run(s.moveShot(shot.id, -1)) }, { id: "down", label: t("Move down"), icon: "arrow-d", onSelect: () => run(s.moveShot(shot.id, 1)) },
    { id: "lines", label: t("Cover the selected lines"), icon: "link", disabled: editor.selection.lineIds.length === 0, onSelect: () => { const ids = s.sceneLines(scene).filter((line) => editor.selection.lineIds.includes(line.id)).map((line) => line.id); if (ids.length) set({ lineIds: ids.slice(0, 40) }); else toast.show({ kind: "info", message: t("Select lines of this scene first") }); } },
    { type: "separator" }, { id: "delete", label: t("Delete shot"), icon: "trash", danger: true, onSelect: () => run(s.deleteShots([shot.id])) },
  ];
  const cell = (width: number, child: React.ReactNode) => <View style={{ width, paddingHorizontal: space[1] }}>{child}</View>;
  const selected = editor.selection.shotIds.includes(shot.id);
  return (
    <View testID={`shot-row-${props.index}`} {...({ dataSet: { shot: shot.id, number: props.number } } as object)} style={{ flexDirection: "row", alignItems: "flex-start", paddingVertical: space[1], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline"), backgroundColor: selected ? theme.color("accent/subtle") : "transparent" }}>
      <View style={{ width: 32, alignItems: "center", paddingTop: space[1] }}><Checkbox accessibilityLabel={t("Select shot {n}", { n: props.number })} checked={props.checked} disabled={ro} onChange={props.onCheck} /></View>
      {cell(WIDTHS.number, <Text variant="body-medium" tabular style={{ paddingTop: space[1] }}>{props.number}</Text>)}
      {cell(WIDTHS.description, <Input size="sm" value={shot.description} placeholder={t("Description")} maxLength={800} readOnly={ro} aria={{ "aria-label": t("Description") }} testID={`shot-description-${props.index}`} onFocus={() => editor.select({ shotIds: [shot.id], sceneId: scene.id })} onChangeText={(description) => set({ description })} />)}
      {cell(WIDTHS.size, <Select label={t("Size")} size="sm" disabled={ro} value={shot.size} onChange={(size) => set({ size })} options={optionsOf(t, LABELS.size)} />)}
      {cell(WIDTHS.angle, <Select label={t("Angle")} size="sm" disabled={ro} value={shot.angle} onChange={(angle) => set({ angle })} options={optionsOf(t, LABELS.angle)} />)}
      {cell(WIDTHS.movement, <Select label={t("Movement")} size="sm" disabled={ro} value={shot.movement} onChange={(movement) => set({ movement })} options={optionsOf(t, LABELS.movement)} />)}
      {cell(WIDTHS.duration, <Input size="sm" value={duration ?? (ticks / s.TICKS_PER_SECOND).toFixed(1)} readOnly={ro} error={durationError} aria={{ "aria-label": t("Duration in seconds") }} testID={`shot-duration-${props.index}`}
        style={shot.durationOverride_ticks !== undefined ? { borderRadius: radius.sm } : undefined} suffix={shot.durationOverride_ticks !== undefined ? "●" : undefined} onChangeText={setDuration} onBlur={commitDuration} onSubmitEditing={commitDuration} />)}
      {cell(WIDTHS.lines, <Text tabular color="text/secondary" style={{ paddingTop: space[1] }} testID={`shot-lines-${props.index}`}>{String(shot.lineIds.length)}</Text>)}
      {cell(WIDTHS.text, <Input size="sm" value={shot.onScreenText} placeholder={t("On-screen text")} maxLength={120} readOnly={ro} aria={{ "aria-label": t("On-screen text") }} testID={`shot-text-${props.index}`} onChangeText={(onScreenText) => set({ onScreenText })} />)}
      {cell(WIDTHS.source, <Select label={t("Source")} size="sm" disabled={ro} value={shot.source} onChange={(source) => set({ source })} options={optionsOf(t, LABELS.source)} />)}
      {cell(WIDTHS.transition, <Select label={t("Transition")} size="sm" disabled={ro} value={shot.transitionOut} onChange={(transitionOut) => set({ transitionOut })} options={transitionOptions(t)} />)}
      {cell(WIDTHS.notes, <Input size="sm" value={shot.notes} placeholder={t("Notes")} maxLength={600} readOnly={ro} aria={{ "aria-label": t("Notes") }} testID={`shot-notes-${props.index}`} onChangeText={(notes) => set({ notes })} />)}
      {ro ? null : <IconButton ref={more} icon="more" size="sm" label={t("Shot actions")} testID={`shot-menu-${props.index}`} expanded={menu} onPress={() => setMenu(true)} />}
      <Menu open={menu} anchor={more} items={items} label={t("Shot actions")} align="end" onClose={() => setMenu(false)} />
    </View>
  );
}

/** The shot list: every shot as a row grouped by scene, each cell edited in place, with bulk edits of several rows. */
export function ShotListPane() {
  const t = useT(), theme = useTheme(), editor = useScriptEditor(), toast = useToast(), { document } = editor;
  const [checked, setChecked] = useState<string[]>([]);
  const total = useMemo(() => document.scenes.reduce((sum, scene) => sum + scene.shots.reduce((inner, shot) => inner + s.shotTicks(document, scene, shot), 0), 0), [document]);
  const count = document.scenes.reduce((sum, scene) => sum + scene.shots.length, 0);
  const live = checked.filter((id) => s.findShot(document, id));
  const bulk = (patch: s.ShotPatch) => { editor.run(s.updateShots(live, patch)); };
  const auto = () => { const made = editor.run(s.autoShots()); if (made) toast.show({ kind: "success", message: made.created === 1 ? t("1 shot created") : t("{n} shots created", { n: made.created }) }); };
  const exportCsv = () => { try { saveFile(exportName(document.title, null, "csv"), s.exportShotCsv(document), "text/csv;charset=utf-8"); } catch (error) { toast.show({ kind: "error", message: messageOf(t, error) }); } };
  const header = (width: number, label: string) => <View key={label} style={{ width, paddingHorizontal: space[1] }}><Text variant="caption" color="text/secondary">{label}</Text></View>;
  let index = 0;
  return (
    <View testID="shot-list" style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], padding: space[2], flexWrap: "wrap", borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
        <Text variant="body-medium" testID="shot-totals">{`${count === 1 ? t("1 shot") : t("{n} shots", { n: count })} · ${s.formatClock(total)}`}</Text>
        <View style={{ flex: 1 }} />
        {live.length > 0 ? (
          <View testID="shot-bulk" style={{ flexDirection: "row", alignItems: "center", gap: space[1], flexWrap: "wrap", maxWidth: "100%" }}>
            <Text variant="meta" color="text/secondary">{t("{n} selected", { n: live.length })}</Text>
            <Select label={t("Size of the selected shots")} placeholder={t("Size")} size="sm" width={140} value={null} onChange={(size) => bulk({ size })} options={optionsOf(t, LABELS.size)} />
            <Select label={t("Angle of the selected shots")} placeholder={t("Angle")} size="sm" width={140} value={null} onChange={(angle) => bulk({ angle })} options={optionsOf(t, LABELS.angle)} />
            <Select label={t("Movement of the selected shots")} placeholder={t("Movement")} size="sm" width={140} value={null} onChange={(movement) => bulk({ movement })} options={optionsOf(t, LABELS.movement)} />
            <Select label={t("Source of the selected shots")} placeholder={t("Source")} size="sm" width={140} value={null} onChange={(source) => bulk({ source })} options={optionsOf(t, LABELS.source)} />
            <Select label={t("Transition of the selected shots")} placeholder={t("Transition")} size="sm" width={140} value={null} onChange={(transitionOut) => bulk({ transitionOut })} options={transitionOptions(t)} />
            <Button kind="ghost" size="sm" tone="danger" icon="trash" label={t("Delete")} testID="shot-bulk-delete" onPress={() => { editor.run(s.deleteShots(live)); setChecked([]); }} />
          </View>
        ) : null}
        {editor.readOnly ? null : <Button kind="outline" size="sm" icon="wand" label={t("Auto shots")} testID="auto-shots" onPress={auto} />}
        <Button kind="outline" size="sm" icon="export" label={t("Export CSV")} testID="export-csv" disabled={count === 0} onPress={exportCsv} />
      </View>
      {count === 0 ? <EmptyState icon="camera" title={t("No shots yet")} description={t("Auto shots makes one shot per beat for every scene without shots.")} actions={editor.readOnly ? [] : [{ label: t("Auto shots"), kind: "strong", onPress: auto }, { label: t("Add shot"), onPress: () => editor.run(s.addShot(document.scenes[0].id)) }]} /> : (
        <ScrollView style={{ flex: 1 }}>
          <ScrollView horizontal contentContainerStyle={{ flexDirection: "column", padding: space[2] }}>
            <View style={{ flexDirection: "row", paddingBottom: space[1], paddingStart: 32 }}>
              {[header(WIDTHS.number, t("No.")), header(WIDTHS.description, t("Description")), header(WIDTHS.size, t("Size")), header(WIDTHS.angle, t("Angle")), header(WIDTHS.movement, t("Movement")), header(WIDTHS.duration, t("Seconds")), header(WIDTHS.lines, t("Lines")), header(WIDTHS.text, t("On-screen text")), header(WIDTHS.source, t("Source")), header(WIDTHS.transition, t("Transition")), header(WIDTHS.notes, t("Notes"))]}
            </View>
            {document.scenes.map((scene, sceneIndex) => {
              const uncovered = scene.shots.length ? s.uncoveredLines(scene) : [], sceneTotal = scene.shots.reduce((sum, shot) => sum + s.shotTicks(document, scene, shot), 0);
              return (
                <View key={scene.id} testID={`shot-scene-${sceneIndex + 1}`}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingVertical: space[1], backgroundColor: theme.color("bg/sidebar"), paddingHorizontal: space[2], borderRadius: radius.sm }}>
                    <Text variant="body-medium">{`${t("Scene {n}", { n: sceneIndex + 1 })}${s.headingText(document, scene) ? ` — ${s.headingText(document, scene)}` : ""}`}</Text>
                    <Text variant="meta" color="text/secondary" tabular>{`${scene.shots.length === 1 ? t("1 shot") : t("{n} shots", { n: scene.shots.length })} · ${s.formatClock(sceneTotal)}`}</Text>
                    {uncovered.length ? <><Text variant="meta" color="warning/text" testID={`shot-uncovered-${sceneIndex + 1}`}>{uncovered.length === 1 ? t("1 line not covered") : t("{n} lines not covered", { n: uncovered.length })}</Text><Button kind="link" size="sm" label={t("Show")} testID={`shot-uncovered-show-${sceneIndex + 1}`} onPress={() => editor.select({ sceneId: scene.id, lineIds: uncovered.map((line) => line.id) })} /></> : null}
                    {editor.readOnly ? null : <Button kind="ghost" size="sm" icon="plus" label={t("Add shot")} testID={`add-shot-${sceneIndex + 1}`} onPress={() => { const made = editor.run(s.addShot(scene.id)); if (made) editor.select({ shotIds: [made.shotId], sceneId: scene.id }); }} />}
                  </View>
                  {scene.shots.map((shot, shotIndex) => { const row = index++; return <ShotRow key={shot.id} scene={scene} shot={shot} index={row} number={`${sceneIndex + 1}.${shotIndex + 1}`} checked={live.includes(shot.id)} onCheck={(on) => setChecked(on ? [...live, shot.id] : live.filter((id) => id !== shot.id))} />; })}
                </View>
              );
            })}
          </ScrollView>
        </ScrollView>
      )}
    </View>
  );
}

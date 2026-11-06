import { useMemo, useRef, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import type { ScriptAct, ScriptScene } from "@jagentchill/protocol";
import { script as s } from "@jagentchill/editor-core";
import { Button, Icon, IconButton, Menu, SearchField, Tap, Text, Tooltip, space, useTheme, type MenuItem } from "@jagentchill/ui";
import { useT } from "../locale";
import { useScriptEditor } from "./context";

/** The eight scene colours, as the clip colours of the design system. */
export const SCENE_COLORS = ["video", "image", "audio", "text", "sticker", "effect", "filter", "caption"] as const;
const COLOR_NAMES = ["Blue", "Purple", "Green", "Orange", "Pink", "Magenta", "Teal", "Amber"];

function SceneRow(props: { scene: ScriptScene; index: number }) {
  const t = useT(), theme = useTheme(), editor = useScriptEditor(), { scene } = props, { document } = editor;
  const [menu, setMenu] = useState(false);
  const more = useRef<View>(null);
  const run = editor.run, active = editor.selection.sceneId === scene.id;
  const heading = s.headingText(document, scene), first = s.sceneLines(scene)[0]?.text.slice(0, 60) ?? "";
  const comments = editor.session.history.comments.filter((comment) => !comment.resolved && (comment.anchor.id === scene.id || s.sceneLines(scene).some((line) => line.id === comment.anchor.id))).length;
  const uncovered = scene.shots.length > 0 ? s.uncoveredLines(scene).length : 0;
  const items: MenuItem[] = [
    { id: "up", label: t("Move up"), icon: "arrow-up", disabled: props.index === 0, onSelect: () => run(s.moveScene(scene.id, props.index - 1)) },
    { id: "down", label: t("Move down"), icon: "arrow-d", disabled: props.index === document.scenes.length - 1, onSelect: () => run(s.moveScene(scene.id, props.index + 1)) },
    { id: "duplicate", label: t("Duplicate"), icon: "copy", onSelect: () => run(s.duplicateScenes([scene.id])) },
    { id: "merge", label: t("Merge with previous scene"), icon: "layers", disabled: props.index === 0, onSelect: () => run(s.mergeSceneWithPrevious(scene.id)) },
    { id: "omit", label: scene.omitted ? t("Restore scene") : t("Omit scene"), icon: scene.omitted ? "eye" : "eye-off", onSelect: () => run(s.updateScenes([scene.id], { omitted: !scene.omitted }, scene.omitted ? "Restore scene" : "Omit scene")) },
    { id: "colour", label: t("Colour"), icon: "palette", submenu: [{ id: "colour-0", label: t("No colour"), checked: !scene.colorIndex, onSelect: () => run(s.updateScenes([scene.id], { colorIndex: undefined })) }, ...COLOR_NAMES.map((name, index): MenuItem => ({ id: `colour-${index + 1}`, label: t(name), checked: scene.colorIndex === index + 1, onSelect: () => run(s.updateScenes([scene.id], { colorIndex: index + 1 })) }))] },
    ...(document.acts.length ? [{ id: "act", label: t("Move to act"), icon: "folder" as const, submenu: [{ id: "act-none", label: t("No act"), checked: !scene.actId, onSelect: () => run(s.updateScenes([scene.id], { actId: undefined })) }, ...document.acts.map((act, index): MenuItem => ({ id: `act-${index}`, label: act.title || t("Act {n}", { n: index + 1 }), checked: scene.actId === act.id, onSelect: () => run(s.updateScenes([scene.id], { actId: act.id })) }))] }] : []),
    { type: "separator" }, { id: "delete", label: t("Delete scene"), icon: "trash", danger: true, onSelect: () => run(s.deleteScenes([scene.id])) },
  ];
  return (
    <View testID={`nav-scene-${props.index + 1}`} {...({ dataSet: { active: active ? "true" : "false", omitted: scene.omitted ? "true" : "false" } } as object)} style={{ flexDirection: "row", alignItems: "stretch", backgroundColor: active ? theme.color("accent/subtle") : "transparent" }}>
      <View style={{ width: 3, backgroundColor: scene.colorIndex ? theme.color(`clip/${SCENE_COLORS[scene.colorIndex - 1]}`) : "transparent" }} />
      <Tap role="button" label={t("Scene {n}: {heading}", { n: props.index + 1, heading: heading || scene.title || first })} onPress={() => editor.goToScene(scene.id)}
        style={(state) => ({ flex: 1, minWidth: 0, flexDirection: "row", gap: space[2], paddingVertical: space[1], paddingStart: space[2], backgroundColor: state.hovered && !active ? theme.color("bg/hover") : "transparent" })}>
        <Text variant="body-medium" tabular color="text/secondary" style={scene.omitted ? { textDecorationLine: "line-through" } : undefined}>{props.index + 1}</Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="body-medium" numberOfLines={1} style={scene.omitted ? { textDecorationLine: "line-through" } : undefined}>{heading || scene.title || t("Scene")}</Text>
          <Text variant="meta" color="text/secondary" numberOfLines={1}>{heading && scene.title ? scene.title : first}</Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: space[0.5] }}>
          <Text variant="meta" color="text/secondary" tabular>{s.formatClock(s.sceneTicks(document, scene))}</Text>
          <View style={{ flexDirection: "row", gap: space[1] }}>
            {comments ? <Icon name="chat" size={12} color="text/secondary" label={comments === 1 ? t("1 open comment") : t("{n} open comments", { n: comments })} /> : null}
            {uncovered ? <Icon name="camera" size={12} color="warning/text" label={uncovered === 1 ? t("1 line not covered") : t("{n} lines not covered", { n: uncovered })} /> : null}
          </View>
        </View>
      </Tap>
      {editor.readOnly ? null : <View style={{ justifyContent: "center" }}><IconButton ref={more} icon="more" size="xs" label={t("Scene actions")} testID={`nav-scene-menu-${props.index + 1}`} expanded={menu} onPress={() => setMenu(true)} /></View>}
      <Menu open={menu} anchor={more} items={items} label={t("Scene actions")} align="end" onClose={() => setMenu(false)} />
    </View>
  );
}

function ActRow(props: { act: ScriptAct; index: number; collapsed: boolean; onToggle(): void }) {
  const t = useT(), theme = useTheme(), editor = useScriptEditor(), { act } = props;
  const [menu, setMenu] = useState(false);
  const more = useRef<View>(null);
  const items: MenuItem[] = [
    { id: "up", label: t("Move up"), icon: "arrow-up", disabled: props.index === 0, onSelect: () => editor.run(s.moveAct(act.id, -1)) },
    { id: "down", label: t("Move down"), icon: "arrow-d", disabled: props.index === editor.document.acts.length - 1, onSelect: () => editor.run(s.moveAct(act.id, 1)) },
    { id: "scene", label: t("New scene"), icon: "plus", onSelect: () => { const last = [...editor.document.scenes].reverse().find((scene) => scene.actId === act.id); editor.run(s.addScene({ afterSceneId: last?.id, actId: act.id })); } },
    { type: "separator" }, { id: "delete", label: t("Delete act"), icon: "trash", danger: true, onSelect: () => editor.run(s.deleteAct(act.id)) },
  ];
  return (
    <View testID={`nav-act-${props.index + 1}`} style={{ flexDirection: "row", alignItems: "center", gap: space[1], paddingStart: space[1], backgroundColor: theme.color("bg/sidebar") }}>
      <IconButton icon={props.collapsed ? "chev-r" : "chev-d"} size="xs" label={props.collapsed ? t("Expand act") : t("Collapse act")} expanded={!props.collapsed} testID={`nav-act-toggle-${props.index + 1}`} onPress={props.onToggle} />
      <View style={{ flex: 1, minWidth: 0 }}><ActTitle act={act} index={props.index} /></View>
      {editor.readOnly ? null : <IconButton ref={more} icon="more" size="xs" label={t("Act actions")} testID={`nav-act-menu-${props.index + 1}`} expanded={menu} onPress={() => setMenu(true)} />}
      <Menu open={menu} anchor={more} items={items} label={t("Act actions")} align="end" onClose={() => setMenu(false)} />
    </View>
  );
}
function ActTitle(props: { act: ScriptAct; index: number }) {
  const t = useT(), editor = useScriptEditor();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { if (draft !== null && draft !== props.act.title) editor.run(s.updateAct(props.act.id, { title: draft.slice(0, 80) })); setDraft(null); };
  return <SearchlessInput testID={`nav-act-title-${props.index + 1}`} label={t("Act title")} placeholder={t("Act {n}", { n: props.index + 1 })} value={draft ?? props.act.title} readOnly={editor.readOnly} onChangeText={setDraft} onBlur={commit} />;
}
/** A one-line field of a navigator row, renamed inline. */
function SearchlessInput(props: { value: string; label: string; placeholder: string; readOnly: boolean; testID: string; onChangeText(text: string): void; onBlur(): void }) {
  const theme = useTheme();
  return <TextInput value={props.value} aria-label={props.label} placeholder={props.placeholder} placeholderTextColor={theme.color("text/placeholder")} editable={!props.readOnly} testID={props.testID} maxLength={80} onChangeText={props.onChangeText} onBlur={props.onBlur}
    onSubmitEditing={props.onBlur} style={[theme.type("body-medium", props.value), { color: theme.color("text/primary"), outlineWidth: 0, paddingVertical: space[1], minWidth: 0 }]} />;
}

/** The left pane: acts and scenes in order, a filter, and the totals against the target. */
export function Navigator(props: { width: number }) {
  const t = useT(), theme = useTheme(), editor = useScriptEditor(), { document } = editor;
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return new Set(document.scenes.map((scene) => scene.id));
    const comments = new Set(editor.session.history.comments.filter((comment) => !comment.resolved).map((comment) => comment.anchor.id));
    return new Set(document.scenes.filter((scene) => {
      const lines = s.sceneLines(scene);
      if (needle === t("has comments").toLowerCase() || needle === "has comments") return comments.has(scene.id) || lines.some((line) => comments.has(line.id));
      // Text, a character who speaks or appears in a shot, or the location.
      const speakers = [...lines.map((line) => s.speakerOf(document, line)), ...scene.shots.flatMap((shot) => shot.characterIds.map((id) => s.entityName(document, "characters", id) ?? ""))];
      return [s.headingText(document, scene), scene.title, scene.summary, ...lines.map((line) => line.text), ...speakers].join("\n").toLowerCase().includes(needle);
    }).map((scene) => scene.id));
  }, [filter, document, editor.session.history.comments, t]);
  const target = s.targetState(document), stats = s.estimateStats(document);
  const groups: { act: ScriptAct | null; index: number; scenes: { scene: ScriptScene; index: number }[] }[] = [];
  document.scenes.forEach((scene, index) => {
    const act = document.acts.find((entry) => entry.id === scene.actId) ?? null, last = groups[groups.length - 1];
    if (last && (last.act?.id ?? null) === (act?.id ?? null)) last.scenes.push({ scene, index }); else groups.push({ act, index: act ? document.acts.indexOf(act) : -1, scenes: [{ scene, index }] });
  });
  for (const [index, act] of document.acts.entries()) if (!groups.some((group) => group.act?.id === act.id)) groups.push({ act, index, scenes: [] });
  return (
    <View testID="script-navigator" role="navigation" aria-label={t("Scenes")} style={{ width: props.width, borderEndWidth: 1, borderEndColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/sidebar"), minHeight: 0, flex: 1 }}>
      <View style={{ padding: space[2] }}><SearchField label={t("Filter scenes")} placeholder={t("Filter scenes")} size="sm" value={filter} onChangeText={setFilter} /></View>
      <ScrollView style={{ flex: 1 }}>
        {groups.map((group, position) => (
          <View key={group.act?.id ?? `loose-${position}`}>
            {group.act ? <ActRow act={group.act} index={group.index} collapsed={collapsed.includes(group.act.id)} onToggle={() => setCollapsed(collapsed.includes(group.act!.id) ? collapsed.filter((id) => id !== group.act!.id) : [...collapsed, group.act!.id])} /> : null}
            {group.act && collapsed.includes(group.act.id) ? null : group.scenes.filter((entry) => shown.has(entry.scene.id)).map((entry) => <SceneRow key={entry.scene.id} scene={entry.scene} index={entry.index} />)}
          </View>
        ))}
        {shown.size === 0 ? <View style={{ padding: space[3] }}><Text color="text/secondary" align="center">{t("No scenes match")}</Text></View> : null}
      </ScrollView>
      {editor.readOnly ? null : (
        <View style={{ flexDirection: "row", gap: space[1], padding: space[2] }}>
          <Button kind="ghost" size="sm" icon="plus" label={t("Scene")} testID="nav-add-scene" onPress={() => { const made = editor.run(s.addScene()); if (made) { editor.goToScene(made.sceneId); editor.setFocus({ lineId: made.lineId, field: "text" }); } }} />
          <Button kind="ghost" size="sm" icon="plus" label={t("Act")} testID="nav-add-act" onPress={() => editor.run(s.addAct())} />
        </View>
      )}
      <View testID="nav-footer" style={{ padding: space[2], borderTopWidth: 1, borderTopColor: theme.color("border/hairline"), gap: space[0.5] }}>
        <Text variant="meta" color="text/secondary" testID="nav-totals">{[stats.scenes === 1 ? t("1 scene") : t("{n} scenes", { n: stats.scenes }), stats.shots === 1 ? t("1 shot") : t("{n} shots", { n: stats.shots }), stats.words === 1 ? t("1 word") : t("{n} words", { n: stats.words })].join(" · ")}</Text>
        <Tooltip label={target.target_s === null ? t("No target duration") : target.onTarget ? t("On target") : target.tooltip.includes("over") ? t("{n} % over target", { n: target.percent }) : t("{n} % under target", { n: target.percent })}>
          <Text variant="body-medium" tabular testID="nav-duration" color={target.onTarget ? "text/primary" : "warning/text"}>{target.target_s === null ? s.formatClock(target.estimate_ticks) : t("{estimate} of {target} target", { estimate: s.formatClock(target.estimate_ticks), target: s.formatClock(target.target_s * s.TICKS_PER_SECOND) })}</Text>
        </Tooltip>
      </View>
    </View>
  );
}

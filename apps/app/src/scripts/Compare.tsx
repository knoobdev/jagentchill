import { useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { script as s } from "@jagentchill/editor-core";
import { Button, IconButton, Segmented, Tabs, Text, radius, space, useTheme } from "@jagentchill/ui";
import { useT, type T } from "../locale";
import { useScriptEditor } from "./context";

type Group = "all" | ReturnType<typeof s.changeGroup>;
const TARGET_LABELS = { meta: "Details", act: "Act", scene: "Scene", beat: "Beat", line: "Line", shot: "Shot", entity: "Cast and places" };
const KIND_LABELS = { added: "Added", removed: "Removed", moved: "Moved", modified: "Changed" };
const MARK = { added: "+", removed: "−", moved: "→", modified: "±" };
/** What a changed thing reads as: its text, description, title or name. */
function textOf(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!value || typeof value !== "object") return "";
  const item = value as Record<string, unknown>, heading = item.heading as Record<string, unknown> | undefined;
  for (const key of ["text", "description", "title", "label", "name"]) if (typeof item[key] === "string" && item[key]) return item[key] as string;
  if (heading && typeof heading.locationText === "string") return [heading.locationText, heading.timeOfDay].filter(Boolean).join(" – ");
  return Array.isArray(value) ? value.join(", ") : "";
}
const sceneLabel = (t: T, document: Parameters<typeof s.sceneNumber>[0], change: s.ScriptChange): string => { const number = change.sceneId ? s.sceneNumber(document, change.sceneId) : 0; return number ? t("Scene {n}", { n: number }) : ""; };

/** The text of one side of a change: removed words struck through on the removed token, added words on the added token, each with its marker. */
function Segments(props: { segments: s.TextSegment[]; side: "inline" | "before" | "after" }) {
  const theme = useTheme();
  return (
    <Text>
      {props.segments.filter((segment) => props.side === "inline" || segment.op === "equal" || (props.side === "before" ? segment.op === "delete" : segment.op === "insert")).map((segment, index) => segment.op === "equal" ? segment.text : (
        <Text key={index} style={{ backgroundColor: theme.color(segment.op === "insert" ? "diff/added" : "diff/removed"), textDecorationLine: segment.op === "delete" ? "line-through" : "none" }}>{`${segment.op === "insert" ? "+" : "−"}${segment.text}`}</Text>
      ))}
    </Text>
  );
}

/** Compare a version with the current script: a change list in document order, inline or side by side. */
export function ComparePane(props: { versionId: string; onClose(): void }) {
  const t = useT(), theme = useTheme(), editor = useScriptEditor(), { session } = editor;
  const [group, setGroup] = useState<Group>("all");
  const [layout, setLayout] = useState<"inline" | "side">("inline");
  const [at, setAt] = useState(0);
  const scroll = useRef<ScrollView>(null), offsets = useRef(new Map<string, number>());
  const version = session.history.versions.find((entry) => entry.versionId === props.versionId);
  const diff = useMemo(() => { try { return s.diffScripts(s.versionContent(session.history, props.versionId), s.contentOf(session.document)); } catch { return null; } }, [session.history, session.document, props.versionId]);
  const wide = theme.formFactor === "wide", side = wide && layout === "side";
  if (!diff || !version) return <View testID="compare-pane" style={{ flex: 1, padding: space[4], gap: space[2], alignItems: "flex-start" }}><Text>{t("This version cannot be read")}</Text><Button kind="outline" size="sm" label={t("Close")} onPress={props.onClose} /></View>;
  const counts = { text: 0, structure: 0, shots: 0, details: 0 };
  for (const change of diff.changes) counts[s.changeGroup(change)]++;
  const shown = diff.changes.filter((change) => group === "all" || s.changeGroup(change) === group), index = Math.min(at, Math.max(0, shown.length - 1));
  const go = (next: number) => { if (!shown.length) return; const to = (next + shown.length) % shown.length; setAt(to); scroll.current?.scrollTo({ y: Math.max(0, (offsets.current.get(shown[to].changeId) ?? 0) - space[2]), animated: false }); };
  const body = (change: s.ScriptChange, which: "inline" | "before" | "after") => {
    if (change.textDiff) return <Segments segments={change.textDiff} side={which} />;
    const before = textOf(change.before), after = textOf(change.after);
    if (which === "before") return before ? <Text style={change.kind === "removed" ? { backgroundColor: theme.color("diff/removed"), textDecorationLine: "line-through" } : undefined}>{before}</Text> : null;
    if (which === "after") return after ? <Text style={change.kind === "added" ? { backgroundColor: theme.color("diff/added") } : undefined}>{after}</Text> : null;
    return (
      <View style={{ gap: space[0.5] }}>
        {before && change.kind !== "added" && change.kind !== "moved" ? <Text style={{ backgroundColor: theme.color("diff/removed"), textDecorationLine: "line-through" }}>{`− ${before}`}</Text> : null}
        {after && change.kind !== "removed" ? <Text style={change.kind === "moved" ? undefined : { backgroundColor: theme.color("diff/added") }}>{change.kind === "moved" ? after : `+ ${after}`}</Text> : null}
        {change.kind === "moved" && !after && before ? <Text>{before}</Text> : null}
      </View>
    );
  };
  return (
    <View testID="compare-pane" style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], padding: space[2], flexWrap: "wrap", borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
        <Text variant="body-medium" testID="compare-title">{t("Version {n} compared with the current script", { n: version.number })}</Text>
        <Text variant="meta" color="text/secondary" tabular testID="compare-count">{diff.changes.length === 1 ? t("1 change") : t("{n} changes", { n: diff.changes.length })}</Text>
        <View style={{ flex: 1 }} />
        {wide ? <Segmented size="sm" label={t("Presentation")} value={layout} onChange={(value) => setLayout(value as "inline" | "side")} options={[{ value: "inline", label: t("Inline") }, { value: "side", label: t("Side by side") }]} /> : null}
        <IconButton icon="chev-u" size="sm" label={t("Previous change")} testID="compare-previous" disabled={!shown.length} onPress={() => go(index - 1)} />
        <IconButton icon="chev-d" size="sm" label={t("Next change")} testID="compare-next" disabled={!shown.length} onPress={() => go(index + 1)} />
        <Button kind="outline" size="sm" label={t("Close")} testID="compare-close" onPress={props.onClose} />
      </View>
      <View style={{ paddingHorizontal: space[2], paddingTop: space[1] }}>
        <Tabs id="compare-filter" variant="pill" size="xs" label={t("Kind of change")} value={group} onChange={(id) => { setGroup(id as Group); setAt(0); }}
          items={[{ id: "all", label: t("All"), count: diff.changes.length }, { id: "text", label: t("Text"), count: counts.text }, { id: "structure", label: t("Structure"), count: counts.structure }, { id: "shots", label: t("Shots"), count: counts.shots }, { id: "details", label: t("Details"), count: counts.details }]} />
      </View>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ padding: space[3], gap: space[2], alignItems: "center" }}>
        <View style={{ width: "100%", maxWidth: side ? 1100 : 760, gap: space[2] }}>
          {shown.length === 0 ? <Text color="text/secondary" testID="compare-empty">{diff.changes.length === 0 ? t("No differences") : t("No changes of this kind")}</Text> : null}
          {shown.map((change, position) => (
            <View key={change.changeId} testID="compare-change" {...({ dataSet: { kind: change.kind, target: change.target, current: position === index ? "true" : "false" } } as object)} onLayout={(event) => offsets.current.set(change.changeId, event.nativeEvent.layout.y)}
              style={{ borderWidth: 1, borderColor: theme.color(position === index ? "border/strong" : "border/hairline"), borderRadius: radius.sm, padding: space[2], gap: space[1] }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[1], flexWrap: "wrap" }}>
                <Text variant="body-medium" tabular>{MARK[change.kind]}</Text>
                <Text variant="body-medium">{`${t(KIND_LABELS[change.kind])} · ${t(TARGET_LABELS[change.target])}${change.path ? ` · ${change.path}` : ""}`}</Text>
                <Text variant="meta" color="text/secondary">{sceneLabel(t, session.document, change)}</Text>
                <View style={{ flex: 1 }} />
                {change.sceneId && s.findScene(session.document, change.sceneId) ? <Button kind="link" size="sm" label={t("Go to")} testID="compare-goto" onPress={() => { props.onClose(); editor.goToScene(change.sceneId!); }} /> : null}
              </View>
              {side ? <View style={{ flexDirection: "row", gap: space[3] }}><View style={{ flex: 1, minWidth: 0 }}>{body(change, "before")}</View><View style={{ flex: 1, minWidth: 0 }}>{body(change, "after")}</View></View> : body(change, "inline")}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

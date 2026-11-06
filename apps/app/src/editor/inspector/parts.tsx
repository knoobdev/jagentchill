import type { ReactNode } from "react";
import { View } from "react-native";
import { chainCommits, EDITOR_PREFS } from "@jagentchill/app-core";
import { keysOfPath, setElementFields, timeline, upsertKeyframe, type Commit, type CommitContext } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { Icon, IconButton, Switch, Tap, Text, space, useTheme } from "@jagentchill/ui";
import { useT } from "../../locale";
import { usePref } from "../../state";
import type { EditorRuntime } from "../runtime";

/** The building blocks the content inspectors (text, audio, sticker, caption) share: sections, rows and field writes. */

export type Fields = Record<string, unknown>;
type Obj = Record<string, unknown>;
export const objectOf = (value: unknown): Obj => (value !== null && typeof value === "object" ? (value as Obj) : {});

/**
 * A collapsible inspector section. `enabled` puts the feature's switch in the header, `onReset` a reset button; the
 * body is drawn while the section is open (and, with a switch, while the feature is on).
 */
export function Section(props: { id: string; title: string; enabled?: boolean; onToggle?(on: boolean): void; onReset?(): void; trailing?: ReactNode; testID?: string; children?: ReactNode }) {
  const t = useT();
  const theme = useTheme();
  const [collapsed, setCollapsed] = usePref(EDITOR_PREFS.inspectorCollapsed);
  const open = collapsed[props.id] !== true, body = open && props.enabled !== false && props.children;
  return (
    <View testID={props.testID}>
      <View style={{ height: 32, flexDirection: "row", alignItems: "center", gap: space[1.5], paddingHorizontal: space[3], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
        <Tap role="button" label={props.title} expanded={open} onPress={() => setCollapsed({ ...collapsed, [props.id]: open })} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space[1.5], height: 28 }}>
          <Icon name={open ? "chev-d" : "chev-r"} size={14} color="text/secondary" /><Text variant="body-medium">{props.title}</Text>
        </Tap>
        {props.trailing}
        {props.onReset ? <IconButton icon="rotate" size="xs" label={t("Reset {name}", { name: props.title })} onPress={props.onReset} /> : null}
        {props.onToggle ? <Switch accessibilityLabel={props.title} value={props.enabled === true} onChange={(on) => props.onToggle!(on)} /> : null}
      </View>
      {body ? <View style={{ paddingHorizontal: space[3], paddingTop: space[1], paddingBottom: space[3], gap: space[1.5] }}>{props.children}</View> : null}
    </View>
  );
}
export function Row(props: { label: string; children: ReactNode; testID?: string }) {
  return <View testID={props.testID} style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 28 }}><Text variant="meta" color="text/secondary" numberOfLines={1} style={{ width: 64 }}>{props.label}</Text>{props.children}</View>;
}
export function Note(props: { children: string; tone?: "warning"; testID?: string }) {
  return <View testID={props.testID} style={{ flexDirection: "row", gap: space[1.5], alignItems: "flex-start" }}>{props.tone ? <Icon name="warn" size={14} color="warning/icon" /> : null}<Text variant="meta" color={props.tone ? "warning/text" : "text/secondary"} style={{ flex: 1 }}>{props.children}</Text></View>;
}

/**
 * Writes typed fields to every given element as one step; `live` draws without recording (a drag), and the call
 * without it records the step from the stored document. A function builds the fields from each element's stored ones.
 */
export function writeFields(runtime: EditorRuntime, elementIds: string[], fields: Fields | ((element: Obj) => Fields), label: string, live = false): boolean {
  return runtime.controller.external((doc, ctx) => chainCommits(doc, ctx, label, "element.update", elementIds.map((id) => (before: ProjectDocument, context: CommitContext): Commit | null => {
    const stored = objectOf(elementOf(before, id));
    return setElementFields(before, context, id, typeof fields === "function" ? fields(stored) : fields, { commandType: "element.update", label });
  })), live);
}
export function elementOf(document: ProjectDocument, id: string): Obj | undefined {
  for (const scene of document.scenes) for (const track of [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio]) {
    const found = (track.elements as unknown as Obj[]).find((element) => element.id === id);
    if (found) return found;
  }
  return undefined;
}
/** The value several elements share, or `null` when they differ ("Mixed"). */
export function shared<T>(values: T[]): T | null {
  return values.every((value) => JSON.stringify(value) === JSON.stringify(values[0])) ? values[0] ?? null : null;
}

/** The value a property shows: the animated value at the playhead when the path has keyframes, the stored one otherwise. */
export function shownAt<T extends number | string>(element: timeline.El, path: string, stored: T, playhead: number): T {
  const keys = keysOfPath(element, path);
  if (keys.length === 0) return stored;
  const value = timeline.valueAt(keys as never, Math.min(element.duration, Math.max(0, playhead - element.startTime)));
  return (typeof value === typeof stored ? value : stored) as T;
}
/**
 * Writes one property of one element by its path (`fontSize`, `stroke.width`): a keyframed property takes the value as
 * the key under the playhead, a plain one as its stored value (a nested member is written with its whole object).
 */
export function writePath(runtime: EditorRuntime, element: timeline.El, path: string, value: number | string, label: string, live = false): boolean {
  if (keysOfPath(element, path).length > 0) {
    const time = Math.round(Math.min(element.duration, Math.max(0, runtime.transport.time - element.startTime)));
    return runtime.controller.external((doc, ctx) => upsertKeyframe(doc, ctx, element.id, path, { time, value }), live);
  }
  const [head, member] = path.split(".");
  return writeFields(runtime, [element.id], member === undefined ? { [head]: value } : (current) => ({ [head]: { ...objectOf(current[head]), [member]: value } }), label, live);
}

import { View } from "react-native";
import { chainCommits } from "@jagentchill/app-core";
import { keysOfPath, neighbourKeyTime, toggleKeyframe, toggleState, timeline, type Commit, type CommitContext } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { IconButton, Tap, useTheme } from "@jagentchill/ui";
import { useT } from "../../locale";
import { useEditor } from "../context";

type El = timeline.El;
/** The diamond of a keyframe toggle: hollow with no keys, half-filled with keys elsewhere, filled with a key at the playhead. */
export function Diamond(props: { state: "hollow" | "half" | "filled"; size?: number; disabled?: boolean }) {
  const theme = useTheme();
  const size = props.size ?? 9, colour = theme.color(props.state === "hollow" ? "text/tertiary" : "keyframe/fill");
  return (
    <View testID={`diamond-${props.state}`} style={{ width: size, height: size, transform: [{ rotate: "45deg" }], borderWidth: 1.5, borderColor: colour, backgroundColor: props.state === "filled" ? colour : "transparent", overflow: "hidden", opacity: props.disabled ? 0.4 : 1 }}>
      {props.state === "half" ? <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "50%", backgroundColor: colour }} /> : null}
    </View>
  );
}

/**
 * The keyframe toggle of one property of one element, with the buttons that step to its neighbouring keys. Pressing
 * the diamond adds a key holding the value the property shows now, or removes the key under the playhead. `also` names
 * the other stored channels of the same property (the Y of a position): they are keyed and unkeyed with it, as one step.
 */
export function KeyToggle(props: { element: El; path: string; value: number | string | boolean; label: string; playhead: number; nav?: boolean; testID?: string; also?: { path: string; value: number | string | boolean }[] }) {
  const t = useT();
  const runtime = useEditor();
  const { element, path } = props, local = props.playhead - element.startTime;
  const inside = local >= 0 && local <= element.duration, time = Math.round(Math.min(element.duration, Math.max(0, local)));
  const state = toggleState(element, path, time), keyed = keysOfPath(element, path).length > 0;
  const previous = keyed ? neighbourKeyTime(element, time, "previous", path) : null, next = keyed ? neighbourKeyTime(element, time, "next", path) : null;
  const toggle = () => runtime.controller.external((doc, ctx) => {
    // A channel that is already in the state the press leads to is left as it is.
    const others = (props.also ?? []).filter((entry) => (toggleState(element, entry.path, time) === "filled") === (state === "filled"));
    if (others.length === 0) return toggleKeyframe(doc, ctx, element.id, path, time, props.value);
    return chainCommits(doc, ctx, state === "filled" ? "Remove keyframe" : "Add keyframe", "keyframe.toggle", [{ path, value: props.value }, ...others].map((entry) => (before: ProjectDocument, context: CommitContext): Commit | null => toggleKeyframe(before, context, element.id, entry.path, time, entry.value)));
  });
  const tooltip = !inside ? t("Move the playhead onto the clip to add a keyframe") : t(state === "filled" ? "Remove keyframe" : "Add keyframe");
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {props.nav && keyed ? <IconButton icon="chev-l" size="xs" label={t("Previous keyframe")} disabled={previous === null} testID={`${props.testID ?? `kf-${path}`}-previous`} onPress={() => runtime.seek(element.startTime + previous!)} /> : null}
      <Tap role="button" label={t(state === "filled" ? "Remove keyframe: {name}" : "Add keyframe: {name}", { name: props.label })} pressedState={state === "filled"} disabled={!inside} tooltip={{ label: tooltip }} testID={props.testID ?? `kf-${path}`} onPress={toggle}
        style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
        <Diamond state={state} disabled={!inside} />
      </Tap>
      {props.nav && keyed ? <IconButton icon="chev-r" size="xs" label={t("Next keyframe")} disabled={next === null} testID={`${props.testID ?? `kf-${path}`}-next`} onPress={() => runtime.seek(element.startTime + next!)} /> : null}
    </View>
  );
}

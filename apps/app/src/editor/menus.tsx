import { useCallback } from "react";
import { bindingKeys } from "@jagentchill/app-core";
import { timeline } from "@jagentchill/editor-core";
import type { MenuItem } from "@jagentchill/ui";
import { useT } from "../locale";
import { useEditor } from "./context";
import { isMac } from "./dom";
import { hasCopiedEffects } from "./fx/clipboard";

/** Actions of the engine's menu that open surfaces of capabilities not in this build: the multi-camera viewer and the provenance sources. */
const UNBUILT = new Set(["timeline.multicam.create", "timeline.multicam.switch-angle", "timeline.multicam.flatten", "timeline.open-source"]);
/** The element context menu of the current selection, as the engine lists it; the timeline and the preview open the same one. */
export function useElementMenu(): () => MenuItem[] {
  const t = useT();
  const runtime = useEditor();
  return useCallback((): MenuItem[] => {
    const { controller } = runtime, current = controller.session;
    const items = timeline.elementContextMenu(controller.stored, current.sceneId, current.selection.selectedElements, { clipboardHasEntry: !controller.clipboard.isEmpty, expandedKeyframeElementIds: current.view.expandedKeyframeElementIds, effectsCopied: hasCopiedEffects() });
    // Items whose panels this build does not have are not offered.
    return items.filter((item) => "separator" in item || !item.action || !UNBUILT.has(item.action)).map((item, index): MenuItem => ("separator" in item ? { type: "separator" } : {
      id: `${item.id}-${index}`, label: t(item.label.replace(" ▸", "")), disabled: item.disabled, description: item.disabled && item.reason ? t(item.reason) : undefined, danger: item.id === "delete" || item.id === "ripple-delete",
      keys: item.action ? bindingKeys(item.action, isMac()) ?? undefined : undefined,
      onSelect: () => {
        if (item.action === "media.reveal") { const element = timeline.locate(controller.stored, current.selection.selectedElements[0])?.element; if (typeof element?.mediaId === "string") runtime.reveal(element.mediaId); }
        else if (item.action) runtime.act(item.action);
      },
    }));
  }, [runtime, t]);
}

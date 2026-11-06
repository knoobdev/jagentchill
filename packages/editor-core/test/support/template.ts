import type { ProjectDocument } from "@jagentchill/protocol";
import { audio, put, studio, text, tweak, video } from "./fixtures.ts";

/**
 * A template draft: three video slots on the main track (the third unfilled), one editable text, one replaceable
 * audio slot, two theme colours with one binding on the text colour.
 */
export function templateDraft(locked = true): ProjectDocument {
  let doc = put(studio(), "main", video("slot1", 0, 2), video("slot2", 2, 2), video("slot3", 4, 2));
  doc = put(doc, "t-text", text("title", 0, 2, { content: "Hello", color: "#ff0000" }), text("free", 2, 2));
  doc = put(doc, "t-audio", audio("music", 0, 6));
  return tweak(doc, (draft) => {
    delete draft.scenes[0].tracks.main.elements[2].mediaId;
    delete draft.scenes[0].tracks.main.elements[2].sourceDuration;
    draft.metadata.duration = 720_000;
    draft.template = {
      templateId: "tpl1", locked, sceneId: "s1",
      slots: ["slot1", "slot2", "slot3"].map((elementId, index) => ({
        slotId: `sl${index + 1}`, elementId, index: index + 1, accepts: "any", duration: 240_000, required: true, label: "", filled: index < 2,
        framing: { zoom: 1, panX: 0, panY: 0 }, sourceOffset: 0,
      })),
      editableTexts: [{ elementId: "title", label: "Title", maxLength: 40 }],
      audioSlots: [{ elementId: "music", label: "Music", replaceable: true }],
      themeColors: ["#ff0000", "#00ff00"],
      colorBindings: [{ colorIndex: 0, elementId: "title", field: "color" }],
    };
  });
}

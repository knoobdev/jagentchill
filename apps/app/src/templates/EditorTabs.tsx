import { ScrollView } from "react-native";
import { space, useToast } from "@jagentchill/ui";
import { useEditor } from "../editor/context";
import { useT } from "../locale";
import { BrandKitPanel } from "./BrandKit";
import { TemplatesTab } from "./TemplatesTab";

/** The Templates tab of the editor's asset panel: the same gallery as the Library; "Use template" starts a new project. */
export function EditorTemplatesTab() {
  return <ScrollView testID="editor-templates-tab" contentContainerStyle={{ padding: space[3] }}><TemplatesTab columns={2} /></ScrollView>;
}

/** The Brand kit tab of the editor's asset panel: the device's kit; a logo is added to the timeline, above the main track, with one press. */
export function EditorBrandTab(props: { readOnly: boolean }) {
  const t = useT();
  const toast = useToast();
  const runtime = useEditor();
  const insert = async (file: File) => {
    const result = await runtime.media.importFiles([{ file }]);
    const outcome = result.outcomes[0];
    if (!outcome || outcome.status === "failed") { toast.show({ kind: "warning", message: `${file.name}: ${t("Couldn't import this file")}` }); return; }
    runtime.addAssets([outcome.assetId], true);
  };
  return <ScrollView testID="editor-brand-tab" contentContainerStyle={{ padding: space[3] }}><BrandKitPanel dense onInsertLogo={props.readOnly ? undefined : (file) => void insert(file)} /></ScrollView>;
}

import { useLocalSearchParams } from "expo-router";
import { ScriptEditorScreen } from "../../../src/scripts/ScriptEditorScreen";

export default function Script() {
  const { scriptId } = useLocalSearchParams<{ scriptId: string }>();
  // A new id is a new editing session: nothing of the previous script's state carries over.
  return <ScriptEditorScreen key={scriptId} scriptId={scriptId} />;
}

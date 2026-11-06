import { useLocalSearchParams } from "expo-router";
import { ScriptEditorScreen } from "../../../src/scripts/ScriptEditorScreen";

export default function ScriptReview() {
  const { scriptId } = useLocalSearchParams<{ scriptId: string }>();
  return <ScriptEditorScreen key={scriptId} scriptId={scriptId} review />;
}

import { useLocalSearchParams } from "expo-router";
import { EditorScreen } from "../../src/editor/EditorScreen";

export default function Editor() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  // A new id is a new editing session: nothing of the previous project's state carries over.
  return <EditorScreen key={projectId} projectId={projectId} />;
}

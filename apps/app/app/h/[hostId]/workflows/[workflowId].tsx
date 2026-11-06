import { useLocalSearchParams } from "expo-router";
import { WorkflowEditorScreen } from "../../../../src/workflows/WorkflowEditorScreen";

export default function WorkflowRoute() {
  const params = useLocalSearchParams<{ hostId: string; workflowId: string; node?: string }>();
  return <WorkflowEditorScreen key={params.workflowId} workflowId={params.workflowId} node={params.node} />;
}

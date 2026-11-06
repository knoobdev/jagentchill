import { useLocalSearchParams } from "expo-router";
import { RunRoute } from "../../../../../src/prompt-video/RunRoute";

export default function WorkflowRunRoute() {
  const params = useLocalSearchParams<{ hostId: string; runId: string; node?: string; diagram?: string }>();
  return <RunRoute key={params.runId} runId={params.runId} node={params.node} diagram={params.diagram} />;
}

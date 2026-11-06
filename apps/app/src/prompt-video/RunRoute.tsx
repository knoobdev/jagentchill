import { useEffect, useState } from "react";
import { promptVideo as pv } from "@jagentchill/editor-core";
import type { WorkflowRunRecord } from "@jagentchill/protocol";
import { useHost } from "../host";
import { RunScreen } from "../workflows/RunScreen";
import { VideoRunScreen } from "./VideoRunScreen";

/**
 * The screen of a run: a run of "One prompt → video" opens in its own view (stages, editable results, shots); any other
 * run, and that one when its diagram is asked for, opens in the run view of workflows.
 */
export function RunRoute(props: { runId: string; node?: string; diagram?: string }) {
  const { connection } = useHost();
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  useEffect(() => {
    if (!connection || props.diagram || props.node) return;
    let alive = true;
    void connection.call<{ run: WorkflowRunRecord }>("jagentchill.workflow.run.get", { runId: props.runId }).then((found) => { if (alive) setWorkflowId(found.run.workflowId); }, () => { if (alive) setWorkflowId(""); });
    return () => { alive = false; };
  }, [connection, props.runId, props.diagram, props.node]);
  // Until the run is known the run view of workflows shows its own loading and error states.
  if (!props.diagram && !props.node && workflowId === pv.TEMPLATE_ID) return <VideoRunScreen runId={props.runId} />;
  return <RunScreen runId={props.runId} node={props.node} />;
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowExecution } from "@jagentchill/protocol";
import type { RunData } from "../workflows/data";
import { pipelineState, type PipelineState } from "./pipelineState";
export type { PipelineStage, PipelineState } from "./pipelineState";

/** The run that makes a film, by step, read again at every change of the run (shown by `Progress.tsx`). */
export function usePipeline(run: RunData): PipelineState {
  const [byNode, setByNode] = useState<Record<string, WorkflowExecution>>({});
  const latest = useRef(0);
  useEffect(() => {
    if (!run.snapshot) { setByNode({}); return; }
    const mine = ++latest.current;
    void run.executions().then((list) => { if (mine === latest.current) setByNode(Object.fromEntries(list.filter((exec) => exec.path === "").map((exec) => [exec.nodeId, exec]))); }, () => undefined);
  }, [run.version, run.snapshot === null]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => pipelineState(run.snapshot?.run ?? null, byNode), [byNode, run.snapshot]);
}

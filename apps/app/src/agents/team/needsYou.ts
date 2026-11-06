import type { TeamDissent, TeamRun } from "@jagentchill/protocol";

/** The disagreements the lead gave to the person and that are still open, with the run each belongs to. */
export function escalatedDissents<R extends Pick<TeamRun, "dissents">>(runs: readonly R[]): { run: R; dissent: TeamDissent }[] {
  return runs.flatMap((run) => (run.dissents ?? []).filter((dissent) => dissent.status === "open" && dissent.outcome === "ESCALATED_TO_HUMAN").map((dissent) => ({ run, dissent })));
}
/**
 * Whether the Agents tab shows its "Needs you" heading: only when something is drawn under it — a result that waits
 * for sign-off (a run that waits for a decision on a disagreement has none), a disagreement the person decides, a
 * hand-off. The activity log has no such section.
 */
export function needsYou(view: "roster" | "team" | "activity", waiting: Pick<TeamRun, "waitingReason"> | undefined, escalated: readonly unknown[], offered: readonly unknown[]): boolean {
  if (view === "activity") return false;
  return (waiting !== undefined && waiting.waitingReason !== "dissent") || escalated.length > 0 || offered.length > 0;
}

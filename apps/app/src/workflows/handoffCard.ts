import { workflow as wf } from "@jagentchill/editor-core";
import type { AgentHandback } from "@jagentchill/protocol";

/**
 * A step's hand-off package in the shape of a team hand-back, so that the same card shows both (the package's field
 * names follow the hand-back record): the summary with what is delivered and decided as "What changed or was
 * inspected", the evidence, what is uncertain or still asked, and what speaks against it. A part the package does not
 * state stays empty — the card says "Not stated", it is never filled in.
 */
export function handoffAsHandback(pkg: wf.Handoff, names: { from: string; to: string }, key: string, /** The words for a deliverable that is kept with the run instead of travelling in the package. */ kept: string): AgentHandback {
  const lines = (items: readonly string[]): string => items.map((item) => `• ${item}`).join("\n");
  const delivered = pkg.deliverables.map((entry) => `• ${entry.name}: ${entry.ref ? kept : typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value)}`);
  // The summary of a package the workflow put together IS its one deliverable's text: it is not printed twice.
  const repeated = pkg.deliverables.length === 1 && typeof pkg.deliverables[0].value === "string" && pkg.deliverables[0].value.trim().startsWith(pkg.summary.replace(/…$/, ""));
  return {
    handbackId: `handoff-${key}`, agentId: pkg.from.agentId, toAgentId: "", status: "done",
    whatChangedOrInspected: [repeated ? String(pkg.deliverables[0].value).trim() : pkg.summary, repeated ? "" : delivered.join("\n"), lines(pkg.decisions)].filter(Boolean).join("\n\n"),
    evidence: lines(pkg.evidence), remainingUncertainty: lines([...pkg.uncertainties, ...pkg.openQuestions]), counterEvidence: lines(pkg.counterEvidence),
    ...(pkg.nextSuggestedAction ? { currentDirection: pkg.nextSuggestedAction } : {}),
    fromTitle: names.from, toTitle: names.to, openQuestions: pkg.openQuestions, risks: [], nextSteps: [], artefacts: [], created_ms: pkg.created_ms,
    // Nobody decides on a step's package: the next step takes it as it is.
    state: "accepted",
  };
}

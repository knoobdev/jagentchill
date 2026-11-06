import type { AgentArtefact, AgentOutcome, TeamRole } from "@jagentchill/protocol";

/** One settled child, as its caller is told. */
export type Notification = {
  kind: "agent_notification"; agentId: string; title: string; outcome: AgentOutcome; reason?: string; summary: string; handbackId?: string;
  artefacts: AgentArtefact[]; usage: { costUsd: number }; hop?: number;
  /** The agent had read content from outside the user and the system: what it reports is data of that kind too (`agent-editing-tools.Untrusted content handling`). */
  untrusted?: true;
};

/** The first message of a sub-agent: who it is, for whom it works, what it may touch, how its work goes back. */
export function childPrompt(input: { title: string; parentTitle: string; prompt: string; team?: string; role?: TeamRole; writes: boolean }): string {
  const { role } = input;
  const lines = [
    `You are "${input.title}", a sub-agent created by "${input.parentTitle}"${role && input.team ? `, working as ${role.label} (${role.tier}) in the team "${input.team}"` : ""}. You work for that agent, not for the user: do not ask the user questions.`,
  ];
  if (role) {
    lines.push(`Responsibility: ${role.contract.responsibility}`, `Ownership boundary: ${role.contract.ownershipBoundary}`, `Expected hand-back: ${role.contract.expectedHandback}`);
    if (role.instructions?.trim()) lines.push(role.instructions.trim());
  }
  lines.push(input.writes
    ? "You may edit the project with the jc_* editing tools. Stage your changes and submit ONE proposal (jc_proposal_submit); the user decides on it. Only one agent writes to a project at a time."
    : "You do not edit the project: the editing tools refuse you. Read what you need and describe any change you want in your hand-back.");
  lines.push(
    "When the work is done call jc_agent_handback {whatChangedOrInspected, evidence, remainingUncertainty, counterEvidence} — all four are required; where one has nothing to say, write \"None\" — and end your turn; your caller receives it. Without a hand-back your last message is what your caller receives.",
    "", "Assignment:", input.prompt,
  );
  return lines.join("\n");
}

/** Settled children as one message to the agent that waits for them: one block each, data only. */
export function notificationText(notes: Notification[]): string {
  const blocks = notes.map(({ hop: _hop, ...note }) => JSON.stringify(note, null, 1));
  return `${notes.length === 1 ? "A sub-agent settled." : `${notes.length} sub-agents settled.`} This message is from the server, not from the user.\n\n${blocks.join("\n\n")}\n\nUse jc_agent_status for details. Do not poll.`;
}

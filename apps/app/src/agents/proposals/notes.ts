/**
 * The host tells a session's agent what a person decided — about its proposal, a permission it asked for, a question it
 * put — with a message of its own that opens the agent's next turn. That message is the editor talking to the agent,
 * never something the person wrote: in the chat it is ONE quiet status line, and its body (ids, JSON) is never shown.
 *
 * What makes a message the host's is NOT its wording — a person can type or paste the same words, and their message must
 * stay theirs. It is the SERVER'S MARK: the host records every message it delivers itself and hands the history to a
 * device with `jagentchill.author = "host"` on exactly those (server/src/agents/sessions.ts `markAuthor`); the timeline
 * carries it as `host` on the item. A message without the mark is a person's (or another agent's) and is never hidden.
 * Pure: no React, so it is tested with `node --test apps/app/src/agents/proposals/notes.test.ts`.
 */
const LEAD = "[JAgentChill] ", MARK = "This is a status message of the editor, not a request of the user.";
/** The keys of the locale resources. */
export const STATUS_NOTES = {
  applied: "The agent was told: proposal applied", rejected: "The agent was told: proposal rejected", proposal: "The agent was told the outcome of the proposal",
  proposalChanged: "Proposal could not be applied because the timeline changed", proposalFailed: "The proposal could not be applied",
  allowed: "The agent was told: you allowed this", denied: "The agent was told: you did not allow this",
  answered: "The agent was told your answer", skipped: "The agent was told: you skipped its question",
  other: "The editor sent the agent a status update",
  picture: "Picture added to the media library", pictureFailed: "The picture did not finish",
};

export type HostRecordKind = "permission" | "question" | "proposal";
/** What a message says of itself when it has the form of the host's word to the agent. Says nothing about who wrote it. */
export type HostNoteClaim = { kind: HostRecordKind; id: string; state: string; /** `<kind>-<id>`: the id of the record's card in the chat. */ record: string; line: string };

/** Reads a message that has the form the host writes (server `note`, `outcomeMessage`): the lead, the mark as its own line, one JSON object with the record's id as the last line. */
export function hostNoteClaim(text: string): HostNoteClaim | null {
  const lines = text.trim().split("\n");
  if (lines.length < 3 || !lines[0].startsWith(LEAD) || lines[lines.length - 2] !== MARK) return null;
  let data: unknown;
  try { data = JSON.parse(lines[lines.length - 1]); } catch { return null; }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const fields = data as { requestId?: unknown; questionId?: unknown; proposalId?: unknown; state?: unknown };
  const state = typeof fields.state === "string" ? fields.state : "", head = lines[0].slice(LEAD.length);
  const claim = (kind: HostRecordKind, id: unknown, line: string): HostNoteClaim | null => (typeof id === "string" && id ? { kind, id, state, record: `${kind}-${id}`, line } : null);
  if (head.startsWith("Proposal ")) return claim("proposal", fields.proposalId, state === "accepted" || state === "partially_accepted" ? STATUS_NOTES.applied : state === "rejected" ? STATUS_NOTES.rejected : state === "stale" ? STATUS_NOTES.proposalChanged : state === "failed" ? STATUS_NOTES.proposalFailed : STATUS_NOTES.proposal);
  if (head.startsWith("Permission request ")) return claim("permission", fields.requestId, state === "denied" ? STATUS_NOTES.denied : state === "allowed" || state === "allowed_once" || state === "allowed_session" ? STATUS_NOTES.allowed : STATUS_NOTES.other);
  if (head.startsWith("Your question ")) return claim("question", fields.questionId, state === "answered" ? STATUS_NOTES.answered : state === "skipped" ? STATUS_NOTES.skipped : STATUS_NOTES.other);
  return null;
}

/**
 * The messages of a conversation that the host wrote to the agent, by message id, with the status line that stands in
 * their place: the ones the server marked (`host`), and only those. The text is read only to choose WHICH line — a
 * marked message in a form this build does not know still gets a line, never its body.
 */
/** The host's word that a picture made on this computer is ready (or did not finish). */
function pictureLine(text: string): string | undefined {
  if (text.startsWith(`${LEAD}The picture made on this computer is in the media library`)) return STATUS_NOTES.picture;
  if (text.startsWith(`${LEAD}The picture being made on this computer`)) return STATUS_NOTES.pictureFailed;
  return undefined;
}
export function hostNotes(messages: ReadonlyArray<{ id: string; text: string; host?: boolean }>): Map<string, string> {
  const notes = new Map<string, string>();
  for (const message of messages) if (message.host === true) notes.set(message.id, hostNoteClaim(message.text)?.line ?? pictureLine(message.text) ?? STATUS_NOTES.other);
  return notes;
}

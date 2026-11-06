/**
 * Who may do what to whom between agents (`Ownership checks along the tree`, `Who-can-call-whom policy presets`,
 * `Team shape enforcement at the tool endpoint`). ONE table for the way an agent can reach another:
 *
 *  - the `jc_agent_*` tools: every call is decided by `decide` before it has any effect.
 *
 * Nothing here reads a database or a model: the facts are gathered by the caller, the answer is a function of them.
 */
import type { AgentTier, ErrorCode } from "@jagentchill/protocol";

export type Verb = "status" | "activity" | "list" | "wait" | "send" | "create" | "cancel" | "archive" | "update" | "set_mode" | "set_model" | "handoff";
/** `read`: everything of the target. `reach`: it can be waited for and written to. `act`: it can be changed. `offer`: it can be named. */
type Need = "read" | "reach" | "act" | "configure" | "offer" | "none";

export const AGENT_RULES: Record<Verb, { tool: string; need: Need }> = {
  create: { tool: "jc_agent_create", need: "none" },
  send: { tool: "jc_agent_send", need: "reach" },
  wait: { tool: "jc_agent_wait", need: "reach" },
  status: { tool: "jc_agent_status", need: "read" },
  activity: { tool: "jc_agent_activity", need: "read" },
  list: { tool: "jc_agent_list", need: "read" },
  cancel: { tool: "jc_agent_cancel", need: "act" },
  archive: { tool: "jc_agent_archive", need: "act" },
  update: { tool: "jc_agent_update", need: "act" },
  set_mode: { tool: "jc_agent_set_mode", need: "configure" },
  set_model: { tool: "jc_agent_set_model", need: "configure" },
  handoff: { tool: "jc_agent_handoff", need: "offer" },
};

export type Facts = {
  /** The host preset: inside the session's tree, or also the other members of the caller's team run. */
  preset: "tree" | "team";
  sameTree: boolean; self: boolean;
  /** The target's chain of owners leads to the caller. */
  owned: boolean;
  /** Owned, or created below the caller: whoever handed work off keeps reading it. */
  below: boolean;
  /** The caller's chain of owners, or of creation, leads to the target. */
  above: boolean;
  /** The target is the agent the caller reports to. */
  directOwner: boolean;
  /** The target is the reviewer agent of a result: it hears from the server only. */
  reviewer?: boolean;
  /** Both are in the same team run that has not ended (its Director included), with the tier of each. */
  run?: { caller?: AgentTier; target?: AgentTier };
};
export type Refusal = { code: ErrorCode; message: string };
/** `full`: the caller may read all of the target. `identity`: its id, title and state, nothing else. */
export type Grant = { grant: "full" | "identity" };

const refuse = (code: ErrorCode, message: string): Refusal => ({ code, message });
const UNKNOWN = (agentId: string) => refuse("AGENT_NOT_FOUND", `There is no agent ${agentId}. List the agents you can reach with jc_agent_list.`);

/**
 * The decision for one call. An id the caller cannot read at all is answered exactly like an id that does not exist,
 * so no call tells an agent what else runs on the host.
 */
export function decide(verb: Verb, facts: Facts, agentId: string): Grant | Refusal {
  if (!facts.sameTree) return UNKNOWN(agentId);
  const need = AGENT_RULES[verb].need, mate = !!facts.run;
  // No agent steers a reviewer: what it reviews reaches it from the server, marked as data. It can be looked at and waited for, nothing more.
  if (facts.reviewer && !facts.self && need !== "read" && verb !== "wait") return refuse("AGENT_POLICY_DENIED", "The reviewer of a result is not messaged, changed or handed work by other agents: it gets the result from the host and answers the host. End your turn; you are told the outcome.");
  const readable = facts.self || facts.below || (facts.preset === "team" && mate);
  if (need === "offer" || need === "none") return { grant: readable ? "full" : "identity" };
  if (need === "read") {
    if (readable) return { grant: "full" };
    if (!facts.above) return UNKNOWN(agentId);
    return verb === "status" || verb === "list" ? { grant: "identity" } : refuse("AGENT_NOT_OWNED", "Of the agents above you only the name and the state can be read (jc_agent_status), not what they did.");
  }
  if (need === "reach") {
    if (verb === "wait") return readable && !facts.self ? { grant: "full" } : facts.directOwner ? { grant: "identity" } : facts.above || facts.self ? refuse("AGENT_NOT_OWNED", "You can wait for agents you created and for the agent you report to.") : UNKNOWN(agentId);
    // A message to oneself is answered by the loop guard, which says why.
    if (facts.self) return { grant: "full" };
    if (mate) {
      const { caller, target } = facts.run!;
      // The shape of a run: the Director talks to the lead, the lead gives bounded assignments and never prompts a peer.
      if ((caller === "lead" || caller === "supervisor") && target === "peer") return refuse("TEAM_SHAPE_VIOLATION", "In a team run a peer is not prompted directly. Wait for its hand-back, or give a new bounded assignment with jc_team_create_peer.");
      if (caller === "supervisor" && target === "lead") return { grant: "full" };
      if (caller === "peer" && !facts.directOwner) {
        return facts.preset === "team" && target === "peer" ? { grant: "full" }
          : refuse("AGENT_POLICY_DENIED", "In a team a peer talks to the agent that gave it its assignment. Put what the other role needs in your hand-back (jc_agent_handback).");
      }
    }
    if (facts.owned) return { grant: "full" };
    if (facts.directOwner) return { grant: "identity" };
    return refuse("AGENT_POLICY_DENIED", "You can message the agents you created and the agent you report to. Put what anyone else needs in your hand-back (jc_agent_handback).");
  }
  // act and configure: owned descendants only; no preset widens it.
  if (need === "configure" && mate && !facts.self) return refuse("TEAM_SHAPE_VIOLATION", "In a team run no member changes another member's mode or model: the roles and the host's routing decide them. Ask the user.");
  if (facts.self || !facts.owned) return refuse("AGENT_NOT_OWNED", "You can do this only to agents you created, or that they created — not to yourself, your caller or the session's own agent.");
  return { grant: "full" };
}

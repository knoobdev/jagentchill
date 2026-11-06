import type { Team, TeamRole } from "@jagentchill/protocol";

type Contract = [responsibility: string, ownershipBoundary: string, expectedHandback: string, canWrite: boolean];
const role = (roleId: string, tier: TeamRole["tier"], label: string, orcRole: string, contract: Contract): TeamRole => ({
  roleId, tier, label, orcRole, enabled: true,
  contract: { responsibility: contract[0], ownershipBoundary: contract[1], expectedHandback: contract[2], canWrite: contract[3] },
});

const DIRECTOR: Contract = [
  "Understands what the person wants, decides which roles the task needs, gives each one a bounded assignment and answers to the person for the result.",
  "Owns the brief and the final answer. Does not edit the project: edits are assigned to a role that writes.",
  "A short account to the person: what was done, by whom, what is waiting for a decision.", false,
];
const LEAD: Contract = [
  "Plans the work, staffs the roles, integrates what they hand back and reports to the Director.",
  "Owns the plan and the order of the assignments. Does not edit the project.",
  "What was assigned, what came back, what is still open.", false,
];
const SCREENWRITER: Contract = [
  "Writes scripts, hooks, narration and dialogue for the video.",
  "Owns the words. Does not change the timeline.",
  "The text, with the choices made and anything the Director must decide.", false,
];
const STORYBOARD: Contract = [
  "Breaks a script into shots: what is seen, for how long, in which order.",
  "Owns the shot list. Does not change the timeline.",
  "The shot list with timings and the media each shot needs.", false,
];
const EDITOR: Contract = [
  "Edits the timeline: cuts, order, text, audio, effects, as the assignment says.",
  "Owns the changes of its own proposal on the project it was given. One editor writes at a time.",
  "The proposal it submitted, what it changed and what it left alone.", true,
];
const RESEARCHER: Contract = [
  "Finds facts, references and media the others need.",
  "Owns what it found and where it came from. Does not change the timeline.",
  "Findings with their sources, and what could not be found.", false,
];
const REVIEWER: Contract = [
  "Checks a result against the brief and says what is wrong, in order of importance.",
  "Owns the review. Never edits the project.",
  "A verdict (accept or change) with the findings that justify it.", false,
];
const CASTING: Contract = [
  "Defines characters, locations and props and keeps them consistent.",
  "Owns the cast sheet. Does not change the timeline.",
  "The cast sheet: every character, location and prop with what fixes its look.", false,
];
const VOICE: Contract = [
  "Chooses voices and directs the delivery of every spoken line.",
  "Owns the voice plan. Does not change the timeline.",
  "The voice per character and the direction per line.", false,
];

const LIMITS = { maxConcurrentPeersPerLead: 3, maxAssignmentsPerBrief: 12 };

/** The teams of `multi-agent-orchestration.Shipped team templates`, with the contracts of "Shipped role contracts". */
export function shippedTeams(now: number): Team[] {
  const base = { enabled: true, limits: LIMITS, writerPolicy: "lead_assigns" as const, created_ms: now, updated_ms: now, rev: 0 };
  return [
    {
      ...base, id: "video-production", templateId: "video-production", name: "Video production team", description: "A Director with a producer, a screenwriter, a storyboard artist, an editor, a researcher and a reviewer.",
      roles: [
        role("supervisor", "supervisor", "Director", "director", DIRECTOR), role("producer", "lead", "Producer", "lead", LEAD),
        role("screenwriter", "peer", "Screenwriter", "screenwriter", SCREENWRITER), role("storyboard", "peer", "Storyboard", "storyboard", STORYBOARD),
        role("editor", "peer", "Editor", "editor", EDITOR), role("researcher", "peer", "Researcher", "peer", RESEARCHER), role("reviewer", "peer", "Reviewer", "reviewer", REVIEWER),
      ],
    },
    {
      ...base, id: "film-studio", templateId: "film-studio", name: "Film studio team", description: "A Director with a showrunner, writers, casting, a voice director, an editor and three reviewers.",
      roles: [
        role("supervisor", "supervisor", "Director", "director", DIRECTOR), role("showrunner", "lead", "Showrunner", "lead", LEAD),
        role("screenwriter", "peer", "Screenwriter", "screenwriter", SCREENWRITER), role("storyboard", "peer", "Storyboard", "storyboard", STORYBOARD),
        role("casting", "peer", "Casting", "peer", CASTING), role("voice-director", "peer", "Voice director", "peer", VOICE), role("editor", "peer", "Editor", "editor", EDITOR),
        role("reviewer-story", "peer", "Story reviewer", "reviewer", REVIEWER), role("reviewer-technical", "peer", "Technical reviewer", "reviewer", REVIEWER), role("reviewer-compliance", "peer", "Compliance reviewer", "reviewer", REVIEWER),
      ],
    },
  ];
}

/** What a team's own rules add to the schema: one enabled supervisor, an enabled lead, at least one enabled peer, role ids of their own. */
export function teamProblems(team: Pick<Team, "roles">): string | undefined {
  const ids = team.roles.map((entry) => entry.roleId);
  if (new Set(ids).size !== ids.length) return "Every role needs an id of its own.";
  const enabled = team.roles.filter((entry) => entry.enabled);
  if (enabled.filter((entry) => entry.tier === "supervisor").length !== 1) return "A team has exactly one enabled Director (supervisor) role.";
  if (!enabled.some((entry) => entry.tier === "lead")) return "A team needs an enabled lead role.";
  if (!enabled.some((entry) => entry.tier === "peer")) return "A team needs at least one enabled peer role.";
  return undefined;
}

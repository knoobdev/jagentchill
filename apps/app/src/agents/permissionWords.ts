import { formatUsd } from "@jagentchill/app-core";
import type { PermissionMoney, PermissionRequest } from "@jagentchill/protocol";

type T = (key: string, params?: Record<string, string | number>) => string;

/** The title of a paid generation call's card, by what it makes. */
const GENERATE_TITLES: Record<string, string> = { image: "Generate image", tts: "Generate speech", music: "Generate music", video: "Generate video" };
/** Where the allowance a person set stands, by its kind. */
const STANDING_LINES: Record<NonNullable<PermissionMoney["standing"]>["kind"], string> = {
  message: "With this one, the paid calls of this message come to {total}. You are asked above {limit}.",
  session: "This session and its agents have spent {spent} of the {limit} they may spend without asking.",
  session_unknown: "Not everything this session and its agents have spent is known yet, so it cannot be counted against the {limit} they may spend without asking.",
};

/**
 * The titles and sentences the host words itself (in English, `ctx.permit({ toolLabel, detail })` of the server's
 * tools), as patterns: what they capture (a name the person or the agent gave, a count) goes into the same sentence in
 * the person's language. Every `toolLabel` the server can send has its pattern here — `permissionWords.test.ts` reads
 * the server's sources and fails when one is missing. A title or a line no pattern knows is shown as the host wrote it.
 */
const HOST_TITLES: ReadonlyArray<readonly [RegExp, string, ...string[]]> = [
  [/^Import media from a URL$/, "Import media from a URL"],
  [/^Move project to trash$/, "Move project to trash"],
  [/^Restore project from trash$/, "Restore project from trash"],
  [/^Create the workflow “(.*)”$/s, "Create the workflow “{name}”", "name"],
  [/^Change the workflow “(.*)”$/s, "Change the workflow “{name}”", "name"],
  [/^Start “(.*)”$/s, "Start “{name}”", "name"],
  [/^Delete the character “(.*)”$/s, "Delete the character “{name}”", "name"],
  [/^Delete the scene “(.*)”$/s, "Delete the scene “{name}”", "name"],
  [/^Delete shot (\d+)$/, "Delete shot {n}", "n"],
  [/^Generate image$/, "Generate image"], [/^Generate speech$/, "Generate speech"], [/^Generate music$/, "Generate music"], [/^Generate video$/, "Generate video"],
];
const HOST_LINES: ReadonlyArray<readonly [RegExp, string, ...string[]]> = [
  [/^Project "(.*)" is moved to the host trash\. It can be restored from there for 30 days\.$/s, "Project “{name}” is moved to the host trash. It can be restored from there for 30 days.", "name"],
  [/^Project "(.*)" is restored from the host trash\.$/s, "Project “{name}” is restored from the host trash.", "name"],
  [/^An empty workflow with only its trigger\.$/, "An empty workflow with only its trigger."],
  [/^Add step “(.*)” \(([\w.-]+)\)$/, "Add step “{name}” ({type})", "name", "type"],
  [/^Change step “(.*)”$/, "Change step “{name}”", "name"],
  [/^Remove step “(.*)”$/, "Remove step “{name}”", "name"],
  [/^Connect “(.*)” to “(.*)”$/, "Connect “{from}” to “{to}”", "from", "to"],
  [/^Disconnect “(.*)” from “(.*)”$/, "Disconnect “{from}” from “{to}”", "from", "to"],
  [/^Change a connection$/, "Change a connection"], [/^Remove a connection$/, "Remove a connection"],
  [/^Set the workflow's parameters$/, "Set the workflow's parameters"], [/^Set the workflow's variables$/, "Set the workflow's variables"], [/^Set the workflow's outputs$/, "Set the workflow's outputs"],
  [/^Change the workflow's settings$/, "Change the workflow's settings"], [/^Rename or describe the workflow$/, "Rename or describe the workflow"],
  [/^The character and its reference picture are removed from the film\.$/, "The character and its reference picture are removed from the film."],
  [/^The character and its reference picture are removed from the film\. (\d+) line\(s\) spoken by them fall back to the narrator\.$/, "The character and its reference picture are removed from the film. Lines spoken by them that fall back to the narrator: {n}.", "n"],
  [/^The scene and its (\d+) shot\(s\) are removed from the film\x3b voice lines bound to those shots are unbound\.$/, "The scene and its shots ({n}) are removed from the film, and voice lines bound to those shots are unbound.", "n"],
  [/^The shot and its image are removed from the film\x3b no voice line is bound to it\.$/, "The shot and its image are removed from the film. No voice line is bound to it."],
  [/^The shot and its image are removed from the film\x3b (\d+) voice line\(s\) bound to it are unbound\.$/, "The shot and its image are removed from the film. Voice lines bound to it that are unbound: {n}.", "n"],
];
const worded = (t: T, patterns: typeof HOST_TITLES, text: string): string | null => {
  for (const [pattern, sentence, ...names] of patterns) { const found = pattern.exec(text); if (found) return t(sentence, Object.fromEntries(names.map((name, index) => [name, found[index + 1] ?? ""]))); }
  return null;
};
/** The host's own title of a request, in the person's language. */
export const hostTitle = (t: T, toolLabel: string): string => worded(t, HOST_TITLES, toolLabel) ?? toolLabel;
/** The host's own detail: a sentence it knows as a whole, else each of its lines that it knows (a workflow's outline is one change a line). */
export const hostDetail = (t: T, detail: string): string => worded(t, HOST_LINES, detail) ?? detail.split("\n").map((line) => worded(t, HOST_LINES, line) ?? line).join("\n");

/**
 * The words of a permission card that the HOST made: for a paid generation call the host sends the facts (`money`) and
 * the card is worded here, in the person's language — title, money line, where the allowance stands, and the words
 * the call asks with (the person's or the agent's own text, never translated). Any other request: the host's own
 * title and detail, in the person's language where the sentence is one the host is known to write (`HOST_TITLES`,
 * `HOST_LINES`); a URL, an outline of names and anything else is shown as it is.
 */
export function permissionWords(t: T, request: Pick<PermissionRequest, "toolLabel" | "detail" | "money">): { title: string; detail: string } {
  const money = request.money;
  if (!money || !GENERATE_TITLES[money.capability]) return { title: hostTitle(t, request.toolLabel), detail: hostDetail(t, request.detail) };
  const usd = (amount: number) => formatUsd(amount, { fine: true });
  // The money line: the model and what the call costs.
  const line = money.amountUsd === null ? t("{model} — the price is not known.", { model: money.modelLabel }) : t("{model} — about {cost}.", { model: money.modelLabel, cost: usd(money.amountUsd) });
  const standing = !money.standing ? "" : money.standing.kind === "message" ? t(STANDING_LINES.message, { total: usd(money.standing.totalUsd), limit: usd(money.standing.allowanceUsd) })
    : money.standing.kind === "session" ? t(STANDING_LINES.session, { spent: usd(money.standing.spentUsd), limit: usd(money.standing.allowanceUsd) }) : t(STANDING_LINES.session_unknown, { limit: usd(money.standing.allowanceUsd) });
  return { title: t(GENERATE_TITLES[money.capability]), detail: [line, standing, money.words ? `“${money.words}”` : ""].filter(Boolean).join(" ") };
}

import type { AuthorDisplay } from "@jagentchill/protocol";

type T = (key: string, params?: Record<string, string | number>) => string;

/**
 * "Last edited by …" of a document on the host, worded from the host's facts about who wrote it last (`AuthorDisplay`)
 * — an agent is "the agent", with its name when it has one; a device is its name (the last one the host knew). No id
 * is ever shown. `name` is what a host that sends no facts gave as the name.
 */
export function lastEditedBy(t: T, display: AuthorDisplay | undefined, name: string): string {
  if (!display) return t("Last edited by {name}", { name });
  switch (display.kind) {
    case "device": return display.name ? t("Last edited by {name}", { name: display.name }) : t("Last edited by a device that is no longer paired");
    case "agent": return display.name ? t("Last edited by the agent “{name}”", { name: display.name }) : t("Last edited by the agent");
    case "run": return t("Last edited by a workflow run");
    case "film": return t("Last edited by Film Studio");
    case "automation": return t("Last edited by an automation");
  }
}
/** Who holds the edit lease, to put in front of "… is editing this project" and the like. */
export function holderPhrase(t: T, display: AuthorDisplay | undefined, name: string): string {
  if (!display) return name;
  switch (display.kind) {
    case "device": return display.name ?? t("A device that is no longer paired");
    case "agent": return display.name ? t("The agent “{name}”", { name: display.name }) : t("The agent");
    case "run": return t("A workflow run");
    case "film": return t("Film Studio");
    case "automation": return t("An automation");
  }
}

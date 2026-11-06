import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Restatement = { capability: string; line: number; text: string; structure: string };
/**
 * The document-schema lint: a spec other than `project-document` MUST NOT restate a document structure. A sentence of
 * the form "SHALL be `{…}`" whose braces list keys of one structure of the document (at least three keys, four in
 * five of them members of that structure) is a restated schema. `structures` are the member keys of the document's
 * structures, read from the Zod schemas.
 */
export function findRestatedSchemas(capability: string, markdown: string, structures: Record<string, string[]>): Restatement[] {
  if (capability === "project-document") return [];
  const found: Restatement[] = [];
  markdown.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(/SHALL be `?\{([^}]*)\}`?/g)) {
      const keys = match[1].split(",").map((part) => /^\s*([a-z][A-Za-z0-9_]*)/.exec(part)?.[1]).filter((key): key is string => key !== undefined);
      if (keys.length < 3) continue;
      for (const [structure, members] of Object.entries(structures)) {
        if (keys.filter((key) => members.includes(key)).length / keys.length >= 0.8) { found.push({ capability, line: index + 1, text: match[0], structure }); break; }
      }
    }
  });
  return found;
}
/** Runs the lint over every `specs/<capability>/spec.md` of a change. */
export function lintSpecs(specsDir: string, structures: Record<string, string[]>): Restatement[] {
  return readdirSync(specsDir).flatMap((capability) => {
    try { return findRestatedSchemas(capability, readFileSync(join(specsDir, capability, "spec.md"), "utf8"), structures); } catch { return []; }
  });
}

/** The capabilities named as behaviour owners in the ownership table of `project-document.Field ownership`. */
export function ownershipTable(spec: string): { section: string; fields: string; owners: string[] }[] {
  const start = spec.indexOf("### Requirement: Field ownership");
  return spec.slice(start).split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| Document section") && !line.startsWith("|---")).map((line) => {
    const [section, fields, owner] = line.split("|").slice(1, -1).map((cell) => cell.trim());
    return { section, fields, owners: [...owner.matchAll(/`([a-z-]+)`/g)].map((match) => match[1]) };
  });
}

// Reads the normative catalogue tables of the specs and writes them as data (`src/catalogue.generated.ts`).
// The schema test runs the same extraction and fails when the committed data differs from the tables.
//
//   node scripts/sync-catalogue.ts [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const specs = join(import.meta.dirname, "../../../openspec/changes/build-jagentchill/specs");
const read = (file: string): string[] => readFileSync(join(specs, file), "utf8").split("\n");
/** The cells of a table row; the last cell keeps any `|` it contains (algorithms write `|x|`). */
function cells(line: string, count: number): string[] | null {
  if (!line.startsWith("| ") || !line.endsWith(" |")) return null;
  let rest = line.slice(1, -1);
  const out: string[] = [];
  for (let index = 0; index < count - 1; index++) {
    const bar = rest.indexOf("|");
    if (bar < 0) return null;
    out.push(rest.slice(0, bar).trim());
    rest = rest.slice(bar + 1);
  }
  return [...out, rest.trim()];
}
const id = (cell: string): string | null => /^`([a-z0-9-]+)`$/.exec(cell)?.[1] ?? null;
const list = (cell: string): string[] => cell.split(",").map((word) => word.trim()).filter(Boolean);

export function extractCatalogue() {
  // Transitions: the spec table (category, id, name, params) joined with the catalogue (keywords, algorithm).
  const transitionNotes = new Map<string, { keywords: string[]; algorithm: string }>();
  for (const line of read("transitions/catalog.md")) {
    const row = cells(line, 3);
    const key = row && id(row[0]);
    if (row && key) transitionNotes.set(key, { keywords: list(row[1]), algorithm: row[2] });
  }
  const transitions = [];
  let featured: string[] = [];
  for (const line of read("transitions/spec.md")) {
    const row = cells(line, 4);
    const key = row && id(row[1]);
    if (row && key) {
      const notes = transitionNotes.get(key);
      if (!notes) throw new Error(`transition ${key} has no row in catalog.md`);
      transitions.push({ category: row[0], id: key, name: row[2], params: row[3], keywords: notes.keywords, algorithm: notes.algorithm });
    }
    const curated = /in this order: ([^;]+);/.exec(line);
    if (curated && line.includes('"Featured"')) featured = list(curated[1]);
  }

  const effectNotes = new Map<string, { flags: string; keywords: string[]; algorithm: string }>();
  const filterNotes = new Map<string, { category: string; recipe: string }>();
  let section = "";
  for (const line of read("visual-effects-filters/catalog.md")) {
    if (line.startsWith("## ")) section = line.slice(3);
    if (section.startsWith("Effects")) {
      const row = cells(line, 4);
      const key = row && id(row[0]);
      if (row && key) effectNotes.set(key, { flags: row[1], keywords: list(row[2]), algorithm: row[3] });
    } else if (section.startsWith("Filters")) {
      const row = cells(line, 3);
      const key = row && id(row[0]);
      if (row && key) filterNotes.set(key, { category: row[1], recipe: row[2] });
    }
  }
  const effects = [], filters = [];
  let requirement = "";
  for (const line of read("visual-effects-filters/spec.md")) {
    if (line.startsWith("### Requirement: ")) requirement = line.slice(17);
    if (requirement === "Bundled effect library") {
      const row = cells(line, 4);
      const key = row && id(row[1]);
      if (row && key) {
        const notes = effectNotes.get(key);
        if (!notes) throw new Error(`effect ${key} has no row in catalog.md`);
        // Every field is always written, an empty one included.
        effects.push({ category: row[0], id: key, name: row[2], params: row[3], flags: notes.flags ?? "", keywords: notes.keywords, algorithm: notes.algorithm });
      }
    } else if (requirement === "Bundled filter library") {
      const row = cells(line, 2);
      if (!row || !/\(\d+\)$/.test(row[0])) continue;
      for (const entry of row[1].split(";")) {
        const match = /^`([a-z0-9-]+)` — (.+)$/.exec(entry.trim());
        if (match) filters.push({ category: row[0].replace(/ \(\d+\)$/, ""), id: match[1], name: match[2], recipe: filterNotes.get(match[1])!.recipe });
      }
    }
  }
  // Clip animations: the spec table (group, id, name) joined with the catalogue (channel tables).
  const clipNames = new Map<string, { group: string; name: string }>();
  for (const line of read("keyframe-animation/spec.md")) {
    const row = cells(line, 2);
    const group = row && /^(In|Out|Combo) \(\d+\)$/.exec(row[0])?.[1].toLowerCase();
    if (!row || !group) continue;
    for (const entry of row[1].split(";")) {
      const match = /^`([a-z0-9-]+)` — (.+)$/.exec(entry.trim());
      if (match) clipNames.set(match[1], { group, name: match[2] });
    }
  }
  const clipAnimations = [];
  section = "";
  for (const line of read("keyframe-animation/catalog.md")) {
    if (line.startsWith("## ")) section = line.slice(3);
    const group = /^(In|Out|Combo) \(\d+\)$/.exec(section)?.[1].toLowerCase();
    if (!group) continue;
    // The Out table has a "Mirror of" column before the channels.
    const row = cells(line, group === "out" ? 3 : 2);
    const key = row && id(row[0]);
    if (!row || !key) continue;
    const named = clipNames.get(key);
    if (!named || named.group !== group) throw new Error(`clip animation ${key} is not in the ${group} group of spec.md`);
    clipAnimations.push({ group, id: key, name: named.name, channels: row[row.length - 1] });
  }
  return { transitions, featuredTransitions: featured, effects, filters, clipAnimations };
}

export function catalogueSource(): string {
  const data = extractCatalogue();
  return `// GENERATED by scripts/sync-catalogue.ts from the normative tables of
// openspec/changes/build-jagentchill/specs/{transitions,visual-effects-filters,keyframe-animation}/{spec,catalog}.md. Do not edit.
export const CATALOGUE = ${JSON.stringify(data, null, 1)} as const;
`;
}

if (import.meta.main) {
  const file = join(import.meta.dirname, "../src/catalogue.generated.ts");
  const next = catalogueSource();
  if (process.argv.includes("--check")) {
    if (readFileSync(file, "utf8") !== next) { console.error("src/catalogue.generated.ts differs from the spec tables; run `node scripts/sync-catalogue.ts`"); process.exit(1); }
  } else writeFileSync(file, next);
  const data = extractCatalogue();
  console.log(`${data.transitions.length} transitions, ${data.effects.length} effects, ${data.filters.length} filters, ${data.clipAnimations.length} clip animations`);
}

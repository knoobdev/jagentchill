// The golden coverage check: every catalogue id (effect, filter, transition, blend mode, mask type) needs a golden
// case — three per transition. Exits non-zero naming each id that has none.
//
//   node scripts/golden-coverage.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BLEND_MODES, MASK_TYPES } from "@jagentchill/protocol";
import { GOLDEN_CASES } from "../test/golden/cases.ts";

const specs = join(import.meta.dirname, "../../../openspec/changes/build-jagentchill/specs");
/** Ids in the first column of the catalogue tables of a file, optionally only under one heading. */
function tableIds(file: string, section?: RegExp): string[] {
  const ids: string[] = [];
  let inside = section === undefined;
  for (const line of readFileSync(join(specs, file), "utf8").split("\n")) {
    if (line.startsWith("#")) inside = section === undefined || section.test(line);
    const match = /^\| `([a-z0-9-]+)` \|/.exec(line);
    if (inside && match) ids.push(match[1]);
  }
  return [...new Set(ids)];
}

export function goldenCoverage(): { kind: string; id: string; have: number; need: number }[] {
  const have = new Map<string, number>();
  for (const entry of GOLDEN_CASES) {
    const key = entry.group === "transition" ? `transition:${entry.id.replace(/^transition-/, "").replace(/-\d+$/, "")}` : `${entry.group}:${entry.id.replace(/^(blend|mask|effect|filter)-/, "").replace(/-feather$/, "")}`;
    have.set(key, (have.get(key) ?? 0) + 1);
  }
  const wanted: { kind: string; id: string; need: number }[] = [
    ...BLEND_MODES.map((id) => ({ kind: "blend", id, need: 1 })),
    ...MASK_TYPES.map((id) => ({ kind: "mask", id, need: 1 })),
    ...tableIds("transitions/catalog.md").map((id) => ({ kind: "transition", id, need: 3 })),
    ...tableIds("visual-effects-filters/catalog.md", /effect/i).map((id) => ({ kind: "effect", id, need: 1 })),
    ...tableIds("visual-effects-filters/catalog.md", /filter/i).map((id) => ({ kind: "filter", id, need: 1 })),
  ];
  return wanted.map((entry) => ({ ...entry, have: have.get(`${entry.kind}:${entry.id}`) ?? 0 })).filter((entry) => entry.have < entry.need);
}

if (import.meta.main) {
  const missing = goldenCoverage();
  const byKind = new Map<string, string[]>();
  for (const entry of missing) byKind.set(entry.kind, [...(byKind.get(entry.kind) ?? []), entry.id]);
  for (const [kind, ids] of byKind) console.error(`${kind}: ${ids.length} ids without a golden case: ${ids.join(", ")}`);
  console.log(`${GOLDEN_CASES.length} golden cases; ${missing.length} catalogue ids are not covered`);
  if (missing.length > 0) process.exit(1);
}

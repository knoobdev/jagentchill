// Bakes every filter recipe of `visual-effects-filters/catalog.md` into a 33-point `.cube` table
// (`color-adjustment.LUT bake procedure`): binary64, the chain order of the engine, six decimals, single line feeds.
//
//   node scripts/bake-luts.ts           writes packages/content/luts/<filter id>.cube
//   node scripts/bake-luts.ts --check   fails, naming the filter, when a committed file differs or is missing
//
// The 12 built-in LUTs of `color-adjustment/catalog.md` are baked by the same procedure once that capability lands
// its catalogue data; this script covers the 39 filters.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FILTER_ROWS } from "../packages/content/src/index.ts";
import { bakeRecipe, cubeText, parseRecipe } from "../packages/editor-core/src/catalogue/recipe.ts";

export const LUT_DIRECTORY = join(import.meta.dirname, "../packages/content/luts");
/** `filter id → .cube text` for every recipe row. A row whose recipe cannot be read fails the bake by name. */
export function bakeAll(rows: readonly { id: string; recipe: string }[] = FILTER_ROWS): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    try { out.set(row.id, cubeText(bakeRecipe(parseRecipe(row.recipe)))); }
    catch (error) { throw new Error(`${row.id}: ${(error as Error).message}`); }
  }
  return out;
}
/** Filter ids whose committed file is missing or differs from the bake. */
export function staleTables(directory = LUT_DIRECTORY, rows: readonly { id: string; recipe: string }[] = FILTER_ROWS): string[] {
  return [...bakeAll(rows)].filter(([id, text]) => { const file = join(directory, `${id}.cube`); return !existsSync(file) || readFileSync(file, "utf8") !== text; }).map(([id]) => id);
}

if (import.meta.main) {
  if (process.argv.includes("--check")) {
    const stale = staleTables();
    for (const id of stale) console.error(`packages/content/luts/${id}.cube differs from its recipe; run \`node scripts/bake-luts.ts\``);
    console.log(`${FILTER_ROWS.length} recipes checked, ${stale.length} stale`);
    if (stale.length > 0) process.exit(1);
  } else {
    mkdirSync(LUT_DIRECTORY, { recursive: true });
    const baked = bakeAll();
    for (const [id, text] of baked) writeFileSync(join(LUT_DIRECTORY, `${id}.cube`), text);
    console.log(`${baked.size} tables written to packages/content/luts`);
  }
}

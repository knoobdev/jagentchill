/**
 * The token lint gate. Fails, naming file and line, when a component style states a literal colour, sets a text colour to a
 * fill token, or uses a margin, padding or gap that is not a spacing token.
 * Usage: node scripts/lint-tokens.ts [directory …]   (default: this package's `src`)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { SPACE_VALUES, TEXT_GRADE } from "../src/tokens.ts";

export type Finding = { file: string; line: number; rule: "literal-colour" | "text-fill-token" | "off-grid-spacing"; message: string };

// Files that hold values by design: the token source, generated icons, and the colour arithmetic of user-chosen content colours.
const EXEMPT = [/tokens\.ts$/, /icons\.gen\.ts$/, /logic\/color\.ts$/, /contrast\.ts$/];
const COLOUR = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b(?![\w-])|\b(?:rgba?|hsla?)\(\s*\d/;
const FILLS = Object.keys(TEXT_GRADE).join("|");
const TEXT_FILL = new RegExp(`<Text\\b[^>]*\\bcolor="(${FILLS})"|\\bcolor:\\s*(?:theme\\.)?color\\("(${FILLS})"\\)`);
const SPACING = /\b(?:margin|padding)(?:Top|Bottom|Left|Right|Start|End|Horizontal|Vertical|Inline|Block)?\s*:\s*(-?\d+(?:\.\d+)?)\b|\b(?:gap|rowGap|columnGap)\s*:\s*(-?\d+(?:\.\d+)?)\b/g;

export function lintSource(file: string, source: string): Finding[] {
  if (EXEMPT.some((pattern) => pattern.test(file))) return [];
  const findings: Finding[] = [];
  source.split("\n").forEach((text, index) => {
    const line = index + 1;
    const code = text.replace(/(?<!:)\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
    // Example values handed to a component as data (a user's colour) are marked where they stand.
    if (/content-colour/.test(text)) return;
    const colour = COLOUR.exec(code);
    if (colour) findings.push({ file, line, rule: "literal-colour", message: `literal colour ${colour[0]} — use a colour token` });
    const fill = TEXT_FILL.exec(code);
    if (fill) { const token = (fill[1] ?? fill[2]) as keyof typeof TEXT_GRADE; findings.push({ file, line, rule: "text-fill-token", message: `text colour set to the fill token \`${token}\` — use \`${TEXT_GRADE[token]}\`` }); }
    for (const match of code.matchAll(SPACING)) {
      const value = Math.abs(Number(match[1] ?? match[2]));
      if (!SPACE_VALUES.includes(value)) findings.push({ file, line, rule: "off-grid-spacing", message: `${match[0].trim()} is not a spacing token` });
    }
  });
  return findings;
}

function walk(directory: string): string[] {
  if (!statSync(directory).isDirectory()) return [directory];
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}
export function lintDirectories(directories: string[]): Finding[] {
  return directories.flatMap((directory) => walk(directory).flatMap((file) => lintSource(relative(process.cwd(), file), readFileSync(file, "utf8"))));
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const roots = process.argv.slice(2).length ? process.argv.slice(2) : [join(import.meta.dirname, "../src")];
  const findings = lintDirectories(roots.map((root) => resolve(root)));
  for (const finding of findings) console.error(`${finding.file}:${finding.line}  ${finding.rule}  ${finding.message}`);
  if (findings.length) { console.error(`\n${findings.length} token lint error${findings.length === 1 ? "" : "s"}`); process.exit(1); }
  console.log("token lint: clean");
}

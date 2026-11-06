import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/** Every `.ts` / `.tsx` source under a directory, skipping dependencies and build output. */
export function sourcesUnder(directory: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    let entries: string[];
    try { entries = readdirSync(current); } catch { return; }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === "pkg" || entry === "target" || entry === "dist" || entry.startsWith(".")) continue;
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry) && !entry.endsWith(".d.ts")) out.push(path);
    }
  };
  walk(directory);
  return out.sort();
}

/** A type-checked program over the files, with the ECMAScript library only: no DOM, no Node globals. */
export function programOf(files: string[]): ts.Program {
  return ts.createProgram(files, {
    target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ["lib.es2023.d.ts"], types: [], noEmit: true, allowImportingTsExtensions: true, skipLibCheck: true, strict: true, jsx: ts.JsxEmit.Preserve,
  });
}

export const lineOf = (file: ts.SourceFile, node: ts.Node): number => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;

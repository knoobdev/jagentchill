import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".") || name === "dist" || name === "build") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
};
const EXPORTED_TYPE = /^export\s+(?:declare\s+)?(?:type|interface|class)\s+([A-Za-z_]\w*)/gm;

/** The names of the document structures: every type the protocol package's `project-document` module exports. */
export function documentTypeNames(protocolModuleDir: string): Set<string> {
  const names = new Set<string>();
  // The modules that declare the stored shapes; helper types of the schema kit and the field list name no structure.
  for (const file of ["values.ts", "animation.ts", "element-fields.ts", "elements.ts", "structure.ts"]) {
    for (const match of readFileSync(join(protocolModuleDir, file), "utf8").matchAll(EXPORTED_TYPE)) names.add(match[1]);
  }
  return names;
}

export type ForeignDeclaration = { file: string; name: string };
/**
 * The document-type rule of the dependency lint: no package other than `packages/protocol` declares and exports a
 * type named for a document structure. A re-export (`export type { X } from "@jagentchill/protocol"`) declares nothing
 * and is allowed.
 */
export function findForeignDocumentTypes(repoRoot: string, sourceRoots: string[], names: Set<string>): ForeignDeclaration[] {
  const found: ForeignDeclaration[] = [];
  for (const root of sourceRoots) {
    const dir = join(repoRoot, root);
    try { statSync(dir); } catch { continue; }
    for (const file of walk(dir)) {
      const path = relative(repoRoot, file).split(sep).join("/");
      if (path.startsWith("packages/protocol/")) continue;
      for (const match of readFileSync(file, "utf8").matchAll(EXPORTED_TYPE)) if (names.has(match[1])) found.push({ file: path, name: match[1] });
    }
  }
  return found;
}

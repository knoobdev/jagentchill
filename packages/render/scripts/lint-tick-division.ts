// The lint rule of the time base: the `/` operator is never applied to a tick value (a `MediaTime`) outside the time
// module of editor-core, where the exact frame and retime maths live. Exits non-zero naming the file and line.
//
//   node scripts/lint-tick-division.ts [directory…]     default: packages/render/src and packages/editor-core/src
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { lineOf, programOf, sourcesUnder } from "./ts-program.ts";

export type TickDivision = { file: string; line: number; text: string };

const repository = resolve(import.meta.dirname, "../../..");
/** The one place where ticks may be divided. */
const TIME_MODULE = [join(repository, "packages/editor-core/src/time") + sep, join(repository, "packages/editor-core/src/time.ts")];

const isTicks = (checker: ts.TypeChecker, node: ts.Expression): boolean => {
  const type = checker.getTypeAtLocation(node);
  const parts = type.isUnion() ? type.types : [type];
  return parts.some((part) => part.getProperty("__mediaTime") !== undefined);
};

export function lintTickDivision(directories: string[]): TickDivision[] {
  const files = directories.flatMap((directory) => sourcesUnder(directory)).filter((file) => !TIME_MODULE.some((allowed) => file === allowed || file.startsWith(allowed)));
  if (files.length === 0) return [];
  const program = programOf(files);
  const checker = program.getTypeChecker();
  const out: TickDivision[] = [];
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.SlashToken || node.operatorToken.kind === ts.SyntaxKind.SlashEqualsToken)
        && (isTicks(checker, node.left) || isTicks(checker, node.right))) {
        out.push({ file, line: lineOf(source, node), text: node.getText(source) });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return out;
}

if (import.meta.main) {
  const given = process.argv.slice(2);
  const directories = given.length > 0 ? given.map((directory) => resolve(directory)) : [join(repository, "packages/render/src"), join(repository, "packages/editor-core/src")];
  const found = lintTickDivision(directories);
  for (const division of found) console.error(`${relative(repository, division.file)}:${division.line}: "/" applied to a tick value: ${division.text}`);
  if (found.length > 0) process.exit(1);
  console.log("no division on tick values outside the time module");
}

// The dependency-boundary check of the engine packages. Exits non-zero and names the file and the forbidden symbol.
//
//   editor-core   pure TypeScript: no import of render / render-wasm, no DOM, WebGPU, WebCodecs, Web Audio or wasm global
//   render-wasm   imports no TypeScript package
//   render        depends on editor-core and render-wasm
//   apps, ui      reach the engine only through the EngineSurface port
//
//   node scripts/check-boundaries.ts [--root <repository root>]
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { lineOf, programOf, sourcesUnder } from "./ts-program.ts";

export type Violation = { file: string; line: number; symbol: string; rule: string };

/** Globals of the browser platform that pure code never names. */
export const FORBIDDEN_GLOBALS = new Set([
  "document", "window", "navigator", "self", "location", "localStorage", "sessionStorage", "indexedDB", "requestAnimationFrame", "cancelAnimationFrame",
  "HTMLElement", "HTMLCanvasElement", "HTMLVideoElement", "HTMLImageElement", "OffscreenCanvas", "CanvasRenderingContext2D", "ImageBitmap", "createImageBitmap",
  "Image", "Path2D", "Worker", "SharedWorker", "MessageChannel", "FontFace",
  "AudioContext", "OfflineAudioContext", "AudioWorkletNode", "AudioBuffer", "AudioNode",
  "VideoDecoder", "VideoEncoder", "AudioDecoder", "AudioEncoder", "VideoFrame", "AudioData", "EncodedVideoChunk", "EncodedAudioChunk", "ImageDecoder",
  "GPU", "GPUDevice", "GPUAdapter", "GPUTexture", "GPUCanvasContext", "WebGL2RenderingContext", "WebGLRenderingContext",
  "WebAssembly",
]);
const ENGINE_PACKAGES = ["@jagentchill/render", "@jagentchill/render-wasm"];
/** What application UI code may import from `@jagentchill/render`: the port and its types, and the writers of files the engine is given. */
export const SURFACE_API = new Set([
  "createEngineSurface", "createMobileEngineSurface", "EngineSurfacePort", "EngineFailure", "PlayheadExtrapolator", "EngineSurface", "EngineSurfaceOptions",
  "EngineEvent", "PortOptions",
  // The producer contract of the person matte: the file format a matte job writes and the entry it delivers. It
  // touches no engine state.
  "createPersonMatteWriter", "personMatteStill", "personMatteEntry", "personMatteKey", "PersonMatteWriter",
]);

const isNameOnly = (node: ts.Identifier): boolean => {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
    // `globalThis.document` reaches the same global.
    return !(ts.isIdentifier(parent.expression) && parent.expression.text === "globalThis");
  }
  if (ts.isQualifiedName(parent) && parent.right === node) return true;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)
    || ts.isMethodSignature(parent) || ts.isEnumMember(parent) || ts.isGetAccessor(parent) || ts.isSetAccessor(parent)) && parent.name === node) return true;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return true;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return true;
  if (ts.isJsxAttribute(parent)) return true;
  return false;
};

function importedModule(node: ts.Node): ts.StringLiteralLike | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) return node.moduleSpecifier;
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) return node.arguments[0];
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) return node.argument.literal;
  return undefined;
}

function checkEditorCore(root: string, out: Violation[]): void {
  const directory = join(root, "packages/editor-core");
  const files = sourcesUnder(join(directory, "src"));
  if (files.length === 0) return;
  const program = programOf(files);
  const checker = program.getTypeChecker();
  const renderDirs = [join(root, "packages/render") + sep, join(root, "packages/render-wasm") + sep];
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) continue;
    const name = relative(root, file);
    const visit = (node: ts.Node): void => {
      const module = importedModule(node);
      if (module) {
        const target = module.text;
        const intoEngine = ENGINE_PACKAGES.some((engine) => target === engine || target.startsWith(`${engine}/`))
          || (target.startsWith(".") && renderDirs.some((engineDir) => (resolve(file, "..", target) + sep).startsWith(engineDir)));
        if (intoEngine) out.push({ file: name, line: lineOf(source, node), symbol: target, rule: "editor-core imports the engine" });
        if (/\.wasm$/.test(target)) out.push({ file: name, line: lineOf(source, node), symbol: target, rule: "editor-core imports wasm" });
      }
      if (ts.isIdentifier(node) && FORBIDDEN_GLOBALS.has(node.text) && !isNameOnly(node)) {
        const symbol = ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
        const declarations = symbol?.declarations ?? [];
        // A name with a declaration in the sources is a local; anything else is the platform global.
        const local = declarations.some((declaration) => !program.isSourceFileDefaultLibrary(declaration.getSourceFile()) && !declaration.getSourceFile().isDeclarationFile);
        const isDeclarationName = declarations.some((declaration) => (declaration as ts.NamedDeclaration).name === node);
        if (!local && !isDeclarationName) out.push({ file: name, line: lineOf(source, node), symbol: node.text, rule: "editor-core names a browser global" });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}

function readJson(path: string): Record<string, any> | undefined {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; }
}

function checkManifests(root: string, out: Violation[]): void {
  const wasm = readJson(join(root, "packages/render-wasm/package.json"));
  if (wasm) {
    for (const dependency of Object.keys({ ...wasm.dependencies, ...wasm.peerDependencies })) {
      if (dependency.startsWith("@jagentchill/")) out.push({ file: "packages/render-wasm/package.json", line: 1, symbol: dependency, rule: "render-wasm imports a TypeScript package" });
    }
  }
  const core = readJson(join(root, "packages/editor-core/package.json"));
  if (core) {
    for (const dependency of Object.keys({ ...core.dependencies, ...core.devDependencies, ...core.peerDependencies })) {
      if (ENGINE_PACKAGES.includes(dependency)) out.push({ file: "packages/editor-core/package.json", line: 1, symbol: dependency, rule: "editor-core imports the engine" });
    }
  }
  const render = readJson(join(root, "packages/render/package.json"));
  if (render) {
    for (const needed of ["@jagentchill/editor-core", "@jagentchill/render-wasm"]) {
      if (!render.dependencies?.[needed]) out.push({ file: "packages/render/package.json", line: 1, symbol: needed, rule: "render depends on editor-core and render-wasm" });
    }
  }
}

/** Import statements only: these trees are large and need no type information. */
function checkUi(root: string, out: Violation[]): void {
  for (const directory of ["apps", "packages/ui", "packages/client"]) {
    if (!existsSync(join(root, directory))) continue;
    for (const file of sourcesUnder(join(root, directory))) {
      const text = readFileSync(file, "utf8");
      if (!text.includes("@jagentchill/render")) continue;
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2023, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const name = relative(root, file);
      const visit = (node: ts.Node): void => {
        const module = importedModule(node);
        if (module) {
          const target = module.text;
          if (target === "@jagentchill/render-wasm" || target.startsWith("@jagentchill/render-wasm/") || target.startsWith("@jagentchill/render/")) {
            out.push({ file: name, line: lineOf(source, node), symbol: target, rule: "UI code reaches the engine only through the EngineSurface port" });
          } else if (target === "@jagentchill/render") {
            const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
            const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : undefined;
            if (!named || clause?.name) out.push({ file: name, line: lineOf(source, node), symbol: target, rule: "UI code imports named members of the EngineSurface port" });
            for (const element of named ?? []) {
              const imported = (element.propertyName ?? element.name).text;
              if (!SURFACE_API.has(imported)) out.push({ file: name, line: lineOf(source, node), symbol: imported, rule: "UI code reaches the engine only through the EngineSurface port" });
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
}

export function checkBoundaries(root: string): Violation[] {
  const out: Violation[] = [];
  checkEditorCore(root, out);
  checkManifests(root, out);
  checkUi(root, out);
  return out;
}

if (import.meta.main) {
  const rootFlag = process.argv.indexOf("--root");
  const root = resolve(rootFlag > 0 ? process.argv[rootFlag + 1] : join(import.meta.dirname, "../../.."));
  const violations = checkBoundaries(root);
  for (const violation of violations) console.error(`${violation.file}:${violation.line}: forbidden symbol "${violation.symbol}" (${violation.rule})`);
  if (violations.length > 0) process.exit(1);
  console.log("dependency boundaries hold");
}

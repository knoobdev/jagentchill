import fs from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node apps/app/scripts/check-library-mobile-layout.mjs <maestro-hierarchy.json>");
  process.exit(2);
}

const tree = JSON.parse(fs.readFileSync(file, "utf8"));
const nodes = [];
function visit(node) {
  nodes.push(node?.attributes ?? {});
  for (const child of node?.children ?? []) visit(child);
}
visit(tree);
const frame = (id) => {
  const attrs = nodes.find((item) => item["resource-id"] === id);
  const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(attrs?.bounds ?? "");
  return match ? match.slice(1).map(Number) : null;
};
const toolbar = frame("library-toolbar");
const grid = frame("library-grid");
const sort = nodes.find((item) => item.accessibilityText?.trim() === "Sort by");
const sortMatch = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(sort?.bounds ?? "");
const sortFrame = sortMatch ? sortMatch.slice(1).map(Number) : null;
if (!toolbar || !grid || !sortFrame) {
  console.error("FAIL: hierarchy is missing Library toolbar, Sort by, or grid bounds");
  process.exit(1);
}
const [, toolbarTop, , toolbarBottom] = toolbar;
const [, sortTop, , sortBottom] = sortFrame;
const [, gridTop] = grid;
if (sortTop < toolbarTop || sortBottom > toolbarBottom || gridTop < toolbarBottom) {
  console.error(`FAIL: toolbar ${toolbar[1]}..${toolbar[3]}, Sort by ${sortTop}..${sortBottom}, grid top ${gridTop}`);
  process.exit(1);
}
console.log(`PASS: Sort by ${sortTop}..${sortBottom} sits inside toolbar ${toolbarTop}..${toolbarBottom}; grid starts at ${gridTop}`);

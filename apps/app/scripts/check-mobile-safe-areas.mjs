import fs from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node apps/app/scripts/check-mobile-safe-areas.mjs <maestro-hierarchy.json>");
  process.exit(2);
}

const tree = JSON.parse(fs.readFileSync(file, "utf8"));
const violations = [];
let inspected = 0;
function visit(node) {
  const attrs = node?.attributes ?? {};
  const label = attrs.accessibilityText?.trim();
  const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(attrs.bounds ?? "");
  if (label && match && (node?.children?.length ?? 0) === 0) {
    const [, left, top, right, bottom] = match.map(Number);
    const height = bottom - top;
    if (right > left && height >= 40 && height <= 120) {
      // The OS status bar is exposed in Maestro's tree too; it is not app content or an app control.
      if (!(top < 59 && bottom <= 59)) {
        inspected += 1;
        if (top < 59 || bottom > 818) violations.push({ label, bounds: attrs.bounds, id: attrs["resource-id"] ?? "" });
      }
    }
  }
  for (const child of node?.children ?? []) visit(child);
}
visit(tree);
if (!inspected) {
  console.error(`FAIL: no labeled app elements found in ${file}`);
  process.exit(1);
}
if (violations.length) {
  console.error(`FAIL: ${violations.length}/${inspected} labeled app elements cross safe bounds (top >= 59, bottom <= 818)`);
  for (const item of violations) console.error(`${item.bounds} ${item.id} ${item.label}`);
  process.exit(1);
}
console.log(`PASS: ${inspected} labeled app elements within [59,818] safe bounds`);

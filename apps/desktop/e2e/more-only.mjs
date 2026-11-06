// Runs the second part alone. Usage: node e2e/more-only.mjs [--packaged <executable>]
import { check } from "./lib.mjs";
import more from "./more.mjs";
const at = process.argv.indexOf("--packaged"), results = [];
await more({ packaged: at > 0 ? process.argv[at + 1] : undefined, results, check });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);

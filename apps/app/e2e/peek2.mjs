// Screenshots of given routes in a fresh profile. Usage: node apps/app/e2e/peek2.mjs <dir> <route>...
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const [dir, ...routes] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await c.newPage();
p.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 300)));
for (const r of routes) { await p.goto("http://localhost:8081" + r, { waitUntil: "networkidle", timeout: 180000 }); await p.waitForTimeout(2500); await p.screenshot({ path: `${dir}/${r.replace(/\W+/g, "_")}.png` }); console.log(r); }
await b.close();

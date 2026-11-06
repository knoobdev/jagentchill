// Development aid: open routes, print page errors and visible text, save a screenshot per route.
// Usage: node apps/app/e2e/peek.mjs <width>x<height> <light|dark> <route> [route…]
import { chromium } from "playwright";
const [size = "1440x900", scheme = "light", ...routes] = process.argv.slice(2);
const [width, height] = size.split("x").map(Number);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width, height }, colorScheme: scheme, hasTouch: width < 720, isMobile: width < 720 });
p.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 600)));
p.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text().slice(0, 400)));
for (const route of routes.length ? routes : ["/"]) {
  await p.goto("http://localhost:8081" + route, { waitUntil: "networkidle", timeout: 180000 }); await p.waitForTimeout(1500);
  console.log(route, "→", new URL(p.url()).pathname, "|", (await p.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 600));
  await p.screenshot({ path: `.dev/shots/peek-${width}-${scheme}${route.replace(/[^a-z0-9]+/gi, "-")}.png` });
}
await b.close();

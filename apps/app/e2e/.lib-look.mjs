import { chromium } from "playwright";
const b = await chromium.launch();
for (const [w, h, cat] of [[1440, 900, "templates"], [1440, 900, "luts"], [1440, 900, "fonts"], [1440, 900, "stickers"], [390, 844, "luts"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: "light" });
  p.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 300)));
  await p.goto(`http://localhost:8096/library/${cat}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `.dev/shots/library/look/${w}-${cat}.png` });
  await p.close();
}
await b.close();

// End-to-end in a real browser on the PRODUCTION web build: the gate that keeps the screens translated and accessible.
// It walks every screen (lib/i18n-walk.mjs) in Vietnamese and in Japanese and fails when a screen shows text that is
// still English, or when axe-core reports a WCAG A/AA violation that is not in EXCEPTIONS below.
// REAL: the app, its storage, one ffmpeg-made clip imported through the UI; with a server log file as first argument
// also a throwaway JAgentChill Server and its Gateway, paired through the pairing screens. No model is used at all.
// Usage: [JAGENTCHILL_PORT=<port>] node apps/app/e2e/i18n-a11y.mjs [server-log-file|-] [out-dir]
//   env: E2E_BASE (default http://localhost:8092) · JC_LANGS=vi,ja · JC_SIZES=1440x900[,390x844] · JC_ONLY=<regex of screen names>
//        JC_MEASURE=1 → never fails, also counts text that does not fit, writes <out-dir>/report-<label>.json and shots of misfits
//        JC_SHOT_SCREENS=<regex> → a screenshot of each matching screen · JC_LABEL=<label> · JC_CHECKS=english,fit,axe[,motion,rtl,keys] · JC_SCHEME=dark · JC_REDUCED_MOTION=1 (with the motion check)
//        the rtl check walks the screens a second time in a document that says dir="rtl" and compares each with its left-to-right self
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { keyboardProbe, motionProbe, notMirrored, probe, testIdRects, walk } from "./lib/i18n-walk.mjs";

// A/AA violations that remain, each with the reason it is not fixed here. Keep this list short; an entry is a debt.
// { rule, screen: RegExp, target?: RegExp (the selector or the markup of every failing element must match), why }
export const EXCEPTIONS = [
  { rule: "label-content-name-mismatch", screen: /./, why: "An experimental axe rule (off in axe's own default set). Its \"visible text\" glues sibling boxes with no space (\"Mẫu12\" for a tab and its count badge, \"TThiết bị này\" for an avatar initial and a name), so a named tab or row with a badge cannot pass. The visible label IS the start of each name (WCAG 2.5.3); 84 lookups of other e2e scripts depend on those names." },
  { rule: "target-size", screen: /^\/editor/, why: "Track header (mute, solo, hide, lock 20×24; track name 57×16; Cover 40×16) and the speed stops 24×16 have the sizes of the design frame, below the 24×24 of WCAG 2.5.8. Proposal in the piece's report: 24 px slots in the track header." },
  { rule: "target-size", screen: /^\/projects/, target: /checkbox/, why: "The 16 px checkbox of a project row: packages/ui Checkbox widens its hit area only at touch density. Proposal: a 24×24 minimum hit area at regular density (moves the row's content by 8 px)." },
  { rule: "aria-required-children", screen: /\/film\//, target: /film-tabs/, why: "A stage that cannot be opened yet is a disabled tab inside a focusable tooltip wrapper that says why; the wrapper is a child of the tab list. Making the tab itself focusable lost the contrast exemption of a disabled control (1.39:1)." },
];
// Visible text that is still English on a Vietnamese or Japanese screen and is not fixed here. { screen: RegExp, text: RegExp, why }
export const ENGLISH_EXCEPTIONS = [
  { screen: /\/film/, text: /^This film is no longer on the host\.$/, why: "The server's error message is shown as the description of the empty state (server text, no resource key)." },
];

const [logFile = "-", out = ".dev/shots/i18n-a11y"] = process.argv.slice(2);
const base = process.env.E2E_BASE ?? "http://localhost:8092";
const languages = (process.env.JC_LANGS ?? "vi,ja").split(",");
const sizes = (process.env.JC_SIZES ?? "1440x900").split(",").map((size) => size.split("x").map(Number));
const only = process.env.JC_ONLY ? new RegExp(process.env.JC_ONLY) : null;
const measure = process.env.JC_MEASURE === "1";
const checks = new Set((process.env.JC_CHECKS ?? (measure ? "english,fit,axe" : "english,axe")).split(","));
const label = process.env.JC_LABEL ?? "run";
mkdirSync(out, { recursive: true });

let host = null, setup = null;
if (logFile !== "-") {
  if (!process.env.JAGENTCHILL_PORT) throw new Error("JAGENTCHILL_PORT must name the throwaway server (never the owner's)");
  const { pairAdmin } = await import("../../../server/scripts/live-lib.ts");
  const firstOffer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))[0];
  setup = await pairAdmin(firstOffer, logFile, "Host setup");
  const codes = new Map();
  setup.on((event, payload) => { if (event === "jagentchill.pairing.requested") codes.set(payload.request.deviceName, payload.code); });
  host = {
    offer: async () => (await setup.call("jagentchill.pairing.offer.create", { role: "admin" })).url,
    code: async (name) => { for (let wait = 0; wait < 100 && !codes.has(name); wait++) await new Promise((resolve) => setTimeout(resolve, 100)); if (!codes.has(name)) throw new Error(`no pairing code for ${name}`); return codes.get(name); },
  };
}

const excepted = (screen, violation) => EXCEPTIONS.find((entry) => entry.rule === violation.id && entry.screen.test(screen) && (!entry.target || violation.nodes.every((node) => entry.target.test(`${node.target} ${node.html}`))));
const BAD_FIT = new Set(["clipped", "squeezed", "spill", "cut-by-ancestor", "page-scrolls-sideways"]);
const browser = await chromium.launch();
const report = [];
let failures = 0;
for (const language of languages) for (const [width, height] of sizes) {
  const rows = [];
  const problems = await walk({
    browser, base, language, width, height, host, only, scheme: process.env.JC_SCHEME ?? "light", reducedMotion: process.env.JC_REDUCED_MOTION === "1",
    log: (line) => { if (line.startsWith("SKIP")) console.log(`     ${line}`); },
    visit: async (screen, page) => {
      const found = await probe(page, language, { axe: checks.has("axe") });
      const english = checks.has("english") ? found.english.filter((entry) => !ENGLISH_EXCEPTIONS.some((rule) => rule.screen.test(screen) && rule.text.test(entry.text))) : [];
      const misfits = checks.has("fit") ? found.misfits.filter((entry) => BAD_FIT.has(entry.kind)) : [];
      const ellipsis = checks.has("fit") ? found.misfits.filter((entry) => entry.kind === "ellipsis").length : 0;
      const axe = found.axe.filter((violation) => !excepted(screen, violation));
      // Reduced motion and right-to-left readiness are measured on request (JC_CHECKS=…,motion,rtl); they are reported, not gated.
      const motion = checks.has("motion") ? await motionProbe(page) : [];
      const rects = checks.has("rtl") ? await testIdRects(page) : null;
      const keys = checks.has("keys") ? await keyboardProbe(page) : null;
      rows.push({ screen, keys, english, misfits, ellipsis, axe, excepted: found.axe.length - axe.length, exceptedAxe: found.axe.filter((violation) => !axe.includes(violation)).map((violation) => `${violation.id}×${violation.count}`), englishExcepted: checks.has("english") ? found.english.length - english.length : 0, motion, rtl: [], rects });
      if (process.env.JC_SHOT_SCREENS && new RegExp(process.env.JC_SHOT_SCREENS).test(screen)) await page.screenshot({ path: `${out}/${label}-${language}-${width}-${screen.replace(/[^\w]+/g, "_")}.png` });
      if (measure && misfits.length) {
        // Evidence: the screen as it is, the offenders outlined (the outline is added for the picture only, then removed).
        await page.evaluate(() => { for (const element of document.querySelectorAll("[data-misfit]")) element.style.outline = "2px solid magenta"; });
        await page.screenshot({ path: `${out}/${label}-${language}-${width}-${screen.replace(/[^\w]+/g, "_")}.png` });
        await page.evaluate(() => { for (const element of document.querySelectorAll("[data-misfit]")) { element.style.outline = ""; element.removeAttribute("data-misfit"); } });
      }
    },
  });
  if (checks.has("rtl")) {
    // The same screens once more, in a document that says dir="rtl" from the start; each is compared with its left-to-right self.
    await walk({ browser, base, language, width, height, host, only, rtl: true, scheme: process.env.JC_SCHEME ?? "light",
      visit: async (screen, page) => {
        const row = rows.find((entry) => entry.screen === screen);
        if (row?.rects) row.rtl = notMirrored(row.rects, await testIdRects(page));
        if (process.env.JC_SHOT_SCREENS && new RegExp(process.env.JC_SHOT_SCREENS).test(screen)) await page.screenshot({ path: `${out}/${label}-rtl-${language}-${width}-${screen.replace(/[^\w]+/g, "_")}.png` });
      } });
    for (const row of rows) delete row.rects;
  }
  const sum = (pick) => rows.reduce((total, row) => total + pick(row), 0);
  const totals = { english: sum((row) => row.english.length), misfits: sum((row) => row.misfits.length), axe: sum((row) => row.axe.length), axeNodes: sum((row) => row.axe.reduce((total, violation) => total + violation.count, 0)), axeExcepted: sum((row) => row.excepted), englishExcepted: sum((row) => row.englishExcepted), motion: sum((row) => row.motion.length), rtl: sum((row) => row.rtl.length) };
  console.log(`\n== ${language} ${width}×${height} — ${rows.length} screens walked, ${problems.length} not reached — english ${totals.english} · misfit ${totals.misfits} · axe ${totals.axe} rules / ${totals.axeNodes} elements · excepted: english ${totals.englishExcepted}, axe ${totals.axeExcepted}${checks.has("motion") ? ` · still moving ${totals.motion}` : ""}${checks.has("rtl") ? ` · not mirrored ${totals.rtl}` : ""}`);
  for (const row of rows) {
    const nodes = row.axe.reduce((total, violation) => total + violation.count, 0);
    if (row.keys) console.log(`     keys: ${row.keys.stops} stops · no focus ring ${row.keys.noRing.length} · stuck ${row.keys.stuck.length}  ${row.screen}${row.keys.noRing.length ? `   no ring: ${row.keys.noRing.slice(0, 5).join(" | ")}` : ""}${row.keys.stuck.length ? `   STUCK: ${row.keys.stuck.join(" | ")}` : ""}`);
    if (row.motion.length || row.rtl.length) console.log(`     motion ${row.motion.length} · rtl ${row.rtl.length}  ${row.screen}${row.motion.length ? `   moving: ${[...new Set(row.motion.map((entry) => `${entry.kind}@${entry.at}`))].slice(0, 6).join(", ")}` : ""}${row.rtl.length ? `   not mirrored: ${row.rtl.slice(0, 8).map((entry) => entry.at).join(", ")}` : ""}`);
    if (!row.english.length && !row.misfits.length && !row.axe.length) continue;
    console.log(`${String(row.english.length).padStart(4)} en ${String(row.misfits.length).padStart(3)} fit ${String(row.axe.length).padStart(2)}/${String(nodes).padEnd(3)} axe  ${row.screen}${row.axe.length ? `   [${row.axe.map((violation) => `${violation.id}×${violation.count}`).join(", ")}]` : ""}`);
  }
  for (const problem of problems) console.log(`   NOT REACHED ${problem.screen} — ${problem.error}`);
  report.push({ language, width, height, totals, rows, problems });
  if (totals.english || totals.axe || problems.length) failures++;
}
await browser.close();
setup?.close?.();
writeFileSync(`${out}/report-${label}.json`, JSON.stringify(report, null, 1));
console.log(`\nreport ${out}/report-${label}.json`);
if (!measure && failures) { console.log("FAIL i18n-a11y: untranslated text, axe violations or unreachable screens (see above)"); process.exit(1); }
console.log(measure ? "measured" : "ok   i18n-a11y: zero untranslated visible strings, zero axe A/AA violations outside EXCEPTIONS");
process.exit(0);

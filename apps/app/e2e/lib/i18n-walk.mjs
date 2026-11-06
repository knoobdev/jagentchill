// The walk of the i18n / accessibility checks: every screen the shell reaches without a host, then (when a host is
// given) the host screens, each probed for (1) visible text that is still English, (2) text that does not fit its box,
// (3) axe-core violations of WCAG A/AA. Real storage of a fresh browser profile; one ffmpeg-made clip is imported
// through the UI so the editor's inspector has something selected. Nothing is seeded or mocked. Used by
// apps/app/e2e/i18n-a11y.mjs (the gate) and by its `--measure` mode (the before/after numbers).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { en } from "../../src/locale/en.ts";
import { ja } from "../../src/locale/ja.ts";
import { vi } from "../../src/locale/vi.ts";

const TABLES = { en, vi, ja };
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// ── What may stay in Latin letters on a Vietnamese or Japanese screen (spec "Untranslated content"): product, provider
// and model names, file names, identifiers, units, key names, timecodes. One entry per reason; keep it short.
export const ALLOWED = [
  /^(JAgentChill|Claude Code|Claude|Codex|OpenCode|Gemini( CLI)?|OpenRouter|OpenAI|Anthropic|Google( Drive)?|Dropbox|Tailscale|FFmpeg|GitHub|YouTube|TikTok|Instagram|ORC|MCP|LUTs?|SRT|VTT|ASS|EDL|FCPXML|OTIO|ProRes|H\.26[45]|HEVC|AV1|VP9|AAC|Opus|MP[34]|MOV|WebM|GIF|PNG|JPE?G|WAV|FLAC|HDR|SDR|sRGB|Rec\. ?\d+|RGB|HSL|HEX|CPU|GPU|RAM|API|URL|ID|QR|AI|OK|CLI|USD|UTC|PIN|OTP|LAN|IP|HTTP|HTTPS|JSON|CSV|PDF|SFX|BPM|FPS|LUFS|EQ)(\b.{0,3})?$/,
  /^[\w .()\-]+\.(mp4|mov|webm|mkv|png|jpe?g|gif|wav|mp3|m4a|srt|vtt|json|cube|ttf|otf|zip|jcpack|jctemplate)$/i, // file names
  /^[\d\s.,:;×x/+\-–—%°#()≈<>=|·•…]*(px|pt|fps|Hz|kHz|dB|LUFS|ms|s|min|h|KB|MB|GB|TB|kbps|Mbps|bit|K|k|p|x|em|deg)?[\d\s.,:;×x/+\-–—%°#()≈<>=|·•…]*$/, // numbers with a unit
  /^(\d+:)?\d+:\d+([.:;]\d+)?( ?\/ ?(\d+:)?\d+:\d+([.:;]\d+)?)?$/, // timecodes
  /^((Ctrl|Cmd|Alt|Shift|Option|Meta|Enter|Esc|Tab|Space|Del|Delete|Backspace|Home|End|PgUp|PgDn|F\d+|[A-Z0-9]|[⌘⌥⇧⌃↑↓←→+,./\[\]\\;'=`-])\s*\+?\s*)+$/, // key names and chords
  /^[a-z0-9]+([._:/@-][a-z0-9]+)+$/i, // identifiers, model ids, host names, versions
  /^v?\d+(\.\d+)+/, // versions
  /^[0-9a-f]{6,}$/i, /^#[0-9a-f]{3,8}$/i, // ids, colours
  /^(https?|jagentchill):\/\//,
  /^[A-Za-z]$/, /^(Aa|Ag|Abc|T|B|I|U)$/, // glyph samples and one-letter controls
  /^(VBR|CBR|CRF|stereo|mono|kbps|Mbps|kHz|Hz|fps|bit|px|iOS|Android|macOS|Windows|Linux|Web|\.[a-z0-9]{2,5})$/, // codec words, operating systems, file extensions
  /^([0-9a-f]{4} ){1,7}[0-9a-f]{4}$/i, // key fingerprints
  /^\d{1,2} thg \d{1,2}(, \d{4})?( \d{1,2}:\d{2})?$/, // a Vietnamese short date ("8 thg 10, 2026"): no diacritic, yet Vietnamese
  /^(Copilot|Qwen Code|Kilo Code|Pi|Cursor|Kiro|Kimi)( \(ACP\))?$|^(Claude|Codex|Gemini|OpenCode) \(ACP\)$/, // agent runtimes: proper names
  /^\d+ ?[×x] ?\d+( \(.*\))?$/, /^\d+:\d+$/, // sizes, aspect ratios
];
// Text this script itself types (user content: never translated).
export const USER_CONTENT = [/^Walk /, /^Studio browser( (vi|ja|en) \d+( rtl)?)?$/, /^walk-clip/, /^Host setup$/];
// Places whose text is data of the host or of a catalogue, not a screen string (spec "Untranslated content": proper names of
// providers and models, identifiers, file contents). Keyed by the nearest test id. What the HOST words in English and
// should word through resource keys (runtime descriptions, "… is not installed on this host.") is listed in the piece's
// report, not hidden here: only names and identifiers are.
export const DATA_PLACES = [
  /^provider-/, /^runtime-/, /^role-/, // provider, runtime and model-role rows: names and ids from the host's catalogue
  /^library-item-name$/, // font family names
  /^skills-installed$/, /^skill-/, // skill names and descriptions come from the skill files on the host
  /^sticker-emoji-/, // emoji names (CLDR English short names; see EXCEPTIONS in the report)
];

const squash = (text) => text.replace(/\s+/g, " ").trim();
// Names the app gives at creation are STORED in the language of that moment (a film made on the Vietnamese pass is still
// "Phim chưa đặt tên 2" on the Japanese pass of the same host): user content from then on, in whichever language.
const STORED_NAMES = new Set(["Untitled film", "New project"].flatMap((key) => [key, vi[key], ja[key]]).filter(Boolean));
const storedName = (text) => STORED_NAMES.has(text.replace(/ \d+$/, ""));
const translatedScript = { vi: /[À-ɏḀ-ỿ]/, ja: /[぀-ヿ㐀-鿿＀-￯]/ };
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const kept = new Map();
/** The values of a language's table that the translator left in Latin letters, as exact strings and as placeholder patterns. */
function keptLatin(language) {
  if (kept.has(language)) return kept.get(language);
  const exact = new Set(), patterns = [];
  for (const value of Object.values(TABLES[language])) {
    if (translatedScript[language].test(value.replace(/\{\w+\}/g, ""))) continue;
    if (value.includes("{")) patterns.push(new RegExp(`^${squash(value).split(/\{\w+\}/).map(escape).join(".+?")}$`)); else exact.add(squash(value));
  }
  kept.set(language, { exact, patterns });
  return kept.get(language);
}
/** Why a visible string counts as untranslated in `language`, or null: "key" = an English source string whose translation exists and was not used; "literal" = English text that no table knows. */
export function untranslated(language, raw) {
  const text = squash(raw);
  if (language === "en" || !/[A-Za-z]{2,}/.test(text) || translatedScript[language].test(text) || storedName(text)) return null;
  const table = keptLatin(language);
  const fine = (part) => !/[A-Za-z]{2,}/.test(part) || ALLOWED.some((rule) => rule.test(part)) || USER_CONTENT.some((rule) => rule.test(part)) || table.exact.has(part) || table.patterns.some((rule) => rule.test(part));
  // A line of facts joined by " · " ("Host · JAgentChill", "H.264 · 10.0 Mbps VBR") is fine when each fact is.
  if (fine(text) || text.split(/ · |, /).every((part) => fine(part.trim()) || part.trim().split(" ").every(fine))) return null;
  const translation = TABLES[language][text];
  return translation !== undefined && translation !== text ? "key" : "literal";
}

/** In the page: every visible string (text nodes and the naming attributes) and every text that does not fit its box. */
function collect() {
  const seen = (element) => { if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false; const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  const where = (element) => { const owner = element.closest("[data-testid]"); const role = element.closest("[role]"); return `${owner ? owner.getAttribute("data-testid") : element.tagName.toLowerCase()}${role ? ` (${role.getAttribute("role")})` : ""}`; };
  // User content never goes through the tables: field values are skipped, and so is anything under an element that says so.
  // (`dir="auto"` cannot be the sign: react-native-web puts it on every text.)
  const authored = (element) => Boolean(element.closest('[contenteditable="true"], code, pre, [data-user-content]'));
  const strings = [], misfits = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const owners = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement, text = node.nodeValue.trim();
    if (!text || !element || ["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "OPTION"].includes(element.tagName) || !seen(element)) continue;
    if (!authored(element)) strings.push({ text, at: where(element), via: "text" });
    owners.add(element);
  }
  for (const element of document.body.querySelectorAll("[aria-label], [placeholder], [title], [alt], [aria-valuetext], [aria-description]")) {
    if (!seen(element) || authored(element)) continue;
    for (const name of ["aria-label", "placeholder", "title", "alt", "aria-valuetext", "aria-description"]) { const value = element.getAttribute(name); if (value && value.trim()) strings.push({ text: value.trim(), at: where(element), via: name }); }
  }
  for (const element of owners) {
    const style = getComputedStyle(element), box = element.getBoundingClientRect();
    const hidesX = style.overflowX === "hidden" || style.overflowX === "clip", hidesY = style.overflowY === "hidden" || style.overflowY === "clip";
    const ellipsis = style.textOverflow === "ellipsis" || style.webkitLineClamp !== "none";
    const text = element.textContent.trim().slice(0, 80);
    const tag = () => { const id = `misfit-${misfits.length}`; element.setAttribute("data-misfit", id); return id; };
    const report = (kind, by) => misfits.push({ kind, by: Math.round(by), text, at: where(element), box: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)], mark: tag() });
    if (hidesX && element.scrollWidth > element.clientWidth + 1) { report(ellipsis ? "ellipsis" : "clipped", element.scrollWidth - element.clientWidth); continue; }
    if (hidesY && element.scrollHeight > element.clientHeight + 2) { report(ellipsis ? "ellipsis" : "clipped", element.scrollHeight - element.clientHeight); continue; }
    // Text squeezed into a sliver: a label of several words broken over three or more lines in a column narrower than 96 px
    // (the sign of a row that gave its text no minimum width).
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3;
    if (text.length >= 8 && box.width < 96 && box.height >= lineHeight * 2.6) { report("squeezed", Math.round(box.height / lineHeight)); continue; }
    // Text that leaves its own box, or that an ancestor cuts off. (The ink of wrapped lines hangs a few pixels over the
    // box where a line ends in a space: only a real overflow counts.)
    const range = document.createRange(); range.selectNodeContents(element);
    const ink = range.getBoundingClientRect();
    if (ink.width === 0) continue;
    if (element.scrollWidth > element.clientWidth + 1 || ink.right > box.right + 6 || ink.left < box.left - 6) { report("spill", Math.max(ink.right - box.right, box.left - ink.left, element.scrollWidth - element.clientWidth)); continue; }
    // The timeline scrolls by moving its content under a clipping viewport: what is outside is scrolled away, not cut.
    if (element.closest('[data-testid="timeline-ruler"], [data-testid="timeline-tracks"], [data-testid="timeline"]')) continue;
    for (let parent = element.parentElement, depth = 0; parent && depth < 4; parent = parent.parentElement, depth++) {
      const outer = getComputedStyle(parent);
      if (outer.overflowX !== "hidden" && outer.overflowX !== "clip") continue;
      const frame = parent.getBoundingClientRect();
      if (frame.width > 0 && (ink.right > frame.right + 6 || ink.left < frame.left - 6)) report("cut-by-ancestor", Math.max(ink.right - frame.right, frame.left - ink.left));
      break;
    }
  }
  if (document.documentElement.scrollWidth > window.innerWidth + 1) misfits.push({ kind: "page-scrolls-sideways", by: document.documentElement.scrollWidth - window.innerWidth, text: "", at: "html", box: [0, 0, 0, 0], mark: "" });
  return { strings, misfits };
}

/**
 * Reduced motion (run the walk with `reducedMotion: true`): what still moves. Counted: running animations and CSS
 * transitions longer than the 120 ms fade the requirement allows, outside essential motion (playback, the playhead,
 * progress bars).
 */
export async function motionProbe(page) {
  return page.evaluate(() => {
    const essential = (element) => Boolean(element?.closest?.('[role="progressbar"], [data-testid="player"], [data-testid="playhead"], video, canvas'));
    const where = (element) => element?.closest?.("[data-testid]")?.getAttribute("data-testid") ?? element?.tagName?.toLowerCase() ?? "?";
    const found = [];
    for (const animation of document.getAnimations()) {
      const timing = animation.effect?.getComputedTiming?.() ?? {}, target = animation.effect?.target;
      if (animation.playState !== "running" || essential(target)) continue;
      if (timing.iterations === Infinity || Number(timing.duration) > 120) found.push({ kind: timing.iterations === Infinity ? "loop" : "animation", ms: Number(timing.duration), at: where(target) });
    }
    for (const element of document.body.querySelectorAll("*")) {
      const style = getComputedStyle(element);
      const longest = Math.max(0, ...style.transitionDuration.split(",").map((value) => parseFloat(value) * (value.includes("ms") ? 1 : 1000)));
      if (longest > 120 && style.transitionProperty !== "none" && !essential(element) && element.checkVisibility()) found.push({ kind: "transition", ms: longest, property: style.transitionProperty.slice(0, 40), at: where(element) });
    }
    return found;
  });
}

/**
 * Keyboard: Tab is pressed through the screen (at most `presses` times). Reported: how many different stops were
 * reached, the stops that show no focus indicator (no outline on the element, on its first child or on its parent,
 * and no change of border colour), and a trap — a stop that Tab does not leave (outside a modal dialog, which traps on purpose).
 */
export async function keyboardProbe(page, presses = 40) {
  const read = () => page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return null;
    const ring = (node) => { if (!node) return false; const style = getComputedStyle(node); return (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none"; };
    const style = getComputedStyle(element);
    const name = element.getAttribute("data-testid") ?? element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 30) ?? element.tagName.toLowerCase();
    // A field shows focus by its border (design-system: "focus (2 px accent border)"): remembered here, compared after the round.
    // A splitter and a slider draw it on a child (the accent line, the thumb's border): the first descendants count too.
    element.setAttribute("data-jc-border", [element, ...[...element.querySelectorAll("*")].slice(0, 8)].map((node) => { const look = getComputedStyle(node); return `${look.borderTopColor} ${look.borderTopWidth} ${node.offsetWidth}x${node.offsetHeight}`; }).join("|"));
    return { key: `${element.tagName}|${name}|${Math.round(element.getBoundingClientRect().x)}|${Math.round(element.getBoundingClientRect().y)}`, name: `${element.getAttribute("role") ?? element.tagName.toLowerCase()} ${name}`,
      ring: ring(element) || ring(element.parentElement) || ring(element.parentElement?.parentElement) || [...element.querySelectorAll("*")].slice(0, 14).some(ring), border: style.borderTopColor, field: /^(INPUT|TEXTAREA)$/.test(element.tagName) || element.isContentEditable,
      modal: Boolean(element.closest('[role="dialog"], [aria-modal="true"]')) };
  });
  const stops = new Map(), noRing = [], stuck = [];
  let previous = null, repeats = 0;
  for (let press = 0; press < presses; press++) {
    await page.keyboard.press("Tab");
    const now = await read();
    if (!now) { previous = null; continue; }
    if (previous && now.key === previous.key) { if (++repeats === 2 && !now.modal) stuck.push(now.name); } else repeats = 0;
    if (!stops.has(now.key)) { stops.set(now.key, now); if (!now.ring && !now.field) noRing.push(now.name); }
    else if (stops.size > 3 && now.key === [...stops.keys()][0]) break; // back at the first stop: the round is complete
    previous = now;
  }
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(120);
  // Stops whose border is the same focused and unfocused had no indicator at all; the others showed it by their border.
  const byBorder = new Set(await page.evaluate(() => [...document.querySelectorAll("[data-jc-border]")].map((element) => { const changed = element.getAttribute("data-jc-border") !== [element, ...[...element.querySelectorAll("*")].slice(0, 8)].map((node) => { const look = getComputedStyle(node); return `${look.borderTopColor} ${look.borderTopWidth} ${node.offsetWidth}x${node.offsetHeight}`; }).join("|"); element.removeAttribute("data-jc-border"); const name = element.getAttribute("data-testid") ?? element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 30) ?? element.tagName.toLowerCase(); return changed ? `${element.getAttribute("role") ?? element.tagName.toLowerCase()} ${name}` : null; }).filter(Boolean)));
  return { stops: stops.size, noRing: noRing.filter((name) => !byBorder.has(name)), stuck };
}

/**
 * Right-to-left readiness. The app takes its direction from the document when it starts, so the walk is done twice — once
 * as it is and once with `rtl: true` (the document says `dir="rtl"` before the app loads) — and `testIdRects` is read at
 * each screen of both. `notMirrored` then names every element with a test id that is not at the mirrored place. What
 * the requirement keeps unmirrored (the timeline, the player, sliders, code) is skipped.
 */
export async function testIdRects(page) {
  return page.evaluate(() => {
    const kept = '[data-testid="timeline"], [data-testid="player"], [data-testid="player-stage"], [role="slider"], code, pre, canvas, video, [data-testid="timeline-tracks"], [data-testid="timeline-ruler"]';
    const out = {};
    for (const element of document.querySelectorAll("[data-testid]")) {
      const id = element.getAttribute("data-testid");
      // A run of text inside a sentence is placed by the bidirectional algorithm, not by the layout.
      if (id in out || element.closest(kept) || !element.checkVisibility() || getComputedStyle(element).display === "inline") continue;
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.height > 0 && box.right > 0 && box.left < window.innerWidth) out[id] = [box.left, box.right, box.width];
    }
    return { out, width: document.documentElement.clientWidth };
  });
}
export function notMirrored(before, after) {
  const stuck = [];
  for (const [id, [left, right, width]] of Object.entries(before.out)) {
    const now = after.out[id];
    if (!now || Math.abs(now[2] - width) > 2) continue; // gone or resized: not comparable
    const mirrored = before.width - right;
    // An element centred on the page is at its mirrored place already.
    if (Math.abs(now[0] - mirrored) > 2) stuck.push({ at: id, ltr: Math.round(left), rtl: Math.round(now[0]), expected: Math.round(mirrored) });
  }
  return stuck;
}

/** One probe of the page as it is now. */
export async function probe(page, language, options = {}) {
  const { strings, misfits } = await page.evaluate(collect);
  const english = [], known = new Set();
  for (const entry of strings) {
    const why = untranslated(language, entry.text);
    const id = `${entry.via}|${squash(entry.text)}`;
    if (why && DATA_PLACES.some((rule) => rule.test(entry.at.replace(/ \(.*$/, "")))) continue;
    if (why && !known.has(id)) { known.add(id); english.push({ text: squash(entry.text).slice(0, 140), why, via: entry.via, at: entry.at }); }
  }
  let axe = [];
  if (options.axe !== false) {
    await page.evaluate(`${axeSource}; undefined`);
    axe = await page.evaluate(async (tags) => {
      const result = await window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
      return result.violations.map((violation) => ({ id: violation.id, impact: violation.impact, count: violation.nodes.length, nodes: violation.nodes.slice(0, 6).map((node) => ({ target: String(node.target[0]).slice(0, 160), html: node.html.slice(0, 200), why: (node.any[0]?.message ?? node.all[0]?.message ?? node.none[0]?.message ?? "").slice(0, 220) })) }));
    }, AXE_TAGS);
  }
  return { english, misfits, axe };
}

/**
 * Walks the screens and calls `visit(screen, page)` at each state. `host` (optional): `{ offer(): Promise<string>, code(deviceName): Promise<string> }`.
 * Screen names are paths and test ids only, so they are the same in every language.
 */
export async function walk({ browser, base, language, width, height, host, visit, only, scheme = "light", reducedMotion, rtl = false, log = () => {} }) {
  const table = TABLES[language] ?? {};
  const T = (text) => table[text] ?? text;
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, locale: { vi: "vi-VN", ja: "ja-JP", en: "en-US" }[language] ?? language, ...(reducedMotion ? { reducedMotion: "reduce" } : {}) });
  // Right-to-left pass: the document declares its direction before the app reads it.
  if (rtl) await context.addInitScript(() => { const set = () => { if (document.documentElement) document.documentElement.dir = "rtl"; }; set(); document.addEventListener("readystatechange", set); });
  const device = `Studio browser ${language} ${width}${rtl ? " rtl" : ""}`;
  const page = await context.newPage();
  const problems = [];
  const visible = (locator) => locator.filter({ visible: true }).first();
  const tid = (id) => visible(page.getByTestId(id));
  // The pairing sheet is not translated yet (apps/app/src/pairing): its fields answer to the English label too.
  const field = (name) => visible(page.getByLabel(T(name), { exact: true }).or(page.getByLabel(name, { exact: true })));
  const settle = async () => { await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {}); await page.waitForTimeout(450); };
  const wanted = (name) => !only || only.test(name);
  const at = async (name, run) => {
    if (!wanted(name)) return false;
    try { if (run) await run(); await settle(); await visit(name, page); log(`ok   ${name}`); return true; } catch (error) { problems.push({ screen: name, error: String(error).split("\n")[0].slice(0, 240) }); log(`SKIP ${name} — ${String(error).split("\n")[0].slice(0, 200)}`); await page.keyboard.press("Escape").catch(() => {}); return false; }
  };
  const go = (path) => page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  /** Every tab of every tab list on the screen, in turn (the first of each list is the state already probed). */
  const tabs = async (name, scope = page) => {
    const lists = await scope.locator('[role="tablist"]').filter({ visible: true }).count();
    for (let list = 0; list < lists; list++) {
      const count = await scope.locator('[role="tablist"]').filter({ visible: true }).nth(list).locator('[role="tab"]').count();
      for (let index = 0; index < count; index++) {
        const tab = scope.locator('[role="tablist"]').filter({ visible: true }).nth(list).locator('[role="tab"]').nth(index);
        const label = await tab.getAttribute("data-testid").catch(() => null) ?? `${list}.${index}`;
        if ((await tab.getAttribute("aria-selected").catch(() => null)) === "true" && index === 0) continue;
        await at(`${name} › tab ${label}`, async () => { await tab.scrollIntoViewIfNeeded({ timeout: 4000 }); await tab.click({ timeout: 6000 }); });
      }
    }
  };

  // ── Without a host ──────────────────────────────────────────────────────────────────────────────────────────────
  // The compact Home has no "What do you want to make?" heading: its composer is the sign that the screen is up.
  const homeUp = () => visible(page.getByText(T("What do you want to make?"))).or(tid("composer-send")).first().waitFor({ timeout: 120_000 });
  await at("/home", async () => { await go("/home"); await homeUp(); });
  for (const path of ["/projects", "/projects/trash", "/library", "/library/templates", "/library/packs", "/library/fonts", "/library/luts", "/library/sounds", "/library/stickers", "/library/brand-kits", "/exports/queue", "/exports/history", "/exports/links", "/scripts", "/devices", "/pair/start", "/settings", "/settings/general", "/settings/editing", "/settings/storage", "/settings/sync", "/no-such-screen"]) {
    await at(path, () => go(path));
  }
  // The editor: a project made through the UI, one real clip imported and placed, then every tab of the asset panel and of the inspector.
  if (wanted("/editor")) {
    const dir = join(tmpdir(), `jagentchill-i18n-walk-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const clip = join(dir, "walk-clip.mp4");
      execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=330", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", clip]);
      await at("/editor (empty)", async () => {
        await go("/projects"); await settle();
        await visible(page.getByRole("button", { name: T("Create your first project"), exact: true })).click({ timeout: 60_000 });
        await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/, { timeout: 30_000 });
        await tid(width < 700 ? "player" : "timeline").waitFor({ timeout: 60_000 });
      });
      if (width >= 700) {
        await tabs("/editor (empty)");
        await at("/editor (clip selected)", async () => {
          await tid("panel-tab-media").click({ timeout: 6000 });
          const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 15_000 }), tid("media-dropzone").click()]);
          await chooser.setFiles([clip]);
          await tid("thumb-walk-clip.mp4").waitFor({ timeout: 60_000 });
          await tid("thumb-walk-clip.mp4").dblclick();
          await page.waitForFunction(() => document.querySelectorAll('[data-testid^="clip-"]').length >= 1, null, { timeout: 30_000 });
          await page.locator('[data-testid^="clip-"]').filter({ visible: true }).first().click();
        });
        await tabs("/editor (clip selected)", tid("inspector"));
        await at("/editor › editor menu", async () => { await visible(page.getByRole("button", { name: T("Editor menu"), exact: true })).click({ timeout: 6000 }); });
        await page.keyboard.press("Escape").catch(() => {});
        await at("/editor › export dialog", async () => { await tid("open-export").click({ timeout: 6000 }); });
        await page.keyboard.press("Escape").catch(() => {});
      } else {
        await tabs("/editor (empty)");
      }
    } finally { rmSync(dir, { recursive: true }); }
    await at("/projects (one project)", () => go("/projects"));
  }

  // ── With a paired throwaway host ────────────────────────────────────────────────────────────────────────────────
  if (host && (!only || only.test("/h/"))) {
    let hostId = null;
    try {
      const offer = await host.offer();
      await go("/pair/start"); await settle();
      await field("Pairing link").fill(offer);
      await field("Name of this device").fill(device);
      await visible(page.getByRole("button", { name: T("Continue") }).or(page.getByRole("button", { name: "Continue" }))).click();
      const code = await host.code(device);
      await at("/pair/verify", null);
      await field("Verification code").fill(code);
      // The wide layout ends on a "Connected" step; the compact one goes straight to Home.
      await Promise.race([visible(page.getByText(T("Connected"), { exact: true })).waitFor({ timeout: 30_000 }), page.waitForURL(/\/home$/, { timeout: 30_000 })]);
      await at("/pair (connected)", null);
      await go("/devices"); await settle();
      // The id of the paired host, read from the app's own identity store (the compact layout has no link that carries it).
      hostId = await page.evaluate(() => new Promise((resolve) => {
        const request = indexedDB.open("jagentchill-identity");
        request.onerror = () => resolve(null);
        request.onsuccess = () => { const all = request.result.transaction("hosts").objectStore("hosts").getAllKeys(); all.onsuccess = () => resolve(all.result[0] ?? null); all.onerror = () => resolve(null); };
      }));
    } catch (error) { if (process.env.JC_DEBUG_SHOT) await page.screenshot({ path: process.env.JC_DEBUG_SHOT }).catch(() => {}); problems.push({ screen: "pairing", error: String(error).split("\n")[0].slice(0, 240) }); log(`SKIP pairing — ${String(error).split("\n")[0].slice(0, 200)}`); }
    if (hostId) {
      const h = `/h/${hostId}`;
      await at("/home (host)", async () => { await go("/home"); await homeUp(); });
      await at("/devices (host)", () => go("/devices"));
      for (const path of ["/sessions", "/workflows", "/workflows/video", "/film", "/film/hub", "/automations", "/automations/new", "/agents", "/skills", "/usage/overview", "/usage/providers", "/usage/projects", "/usage/sessions", "/usage/plan"]) {
        if (await at(`/h/*${path}`, () => go(`${h}${path}`)) && /sessions$|agents$|skills$/.test(path)) await tabs(`/h/*${path}`);
      }
      for (const section of ["runtimes", "model-routing", "secrets", "usage", "host-storage", "skills"]) {
        if (await at(`/settings/host/*/${section}`, () => go(`/settings/host/${hostId}/${section}`))) await tabs(`/settings/host/*/${section}`);
      }
      // Film Studio: a film made with the screen's own button, then each stage of its first episode.
      let film = null;
      await at("/h/*/film/* (new film)", async () => { await go(`${h}/film`); await settle(); await tid("film-new").click({ timeout: 20_000 }); await page.waitForURL(/\/film\/film_[0-9a-f]+\/episode\/[^/]+\/story/, { timeout: 30_000 }); film = /\/film\/(film_[0-9a-f]+)\/episode\/([^/]+)\//.exec(page.url()); });
      if (film) {
        for (const stage of ["script", "assets", "storyboard", "video", "voice", "sound", "timeline"]) await at(`/h/*/film/*/episode/*/${stage}`, () => go(`${h}/film/${film[1]}/episode/${film[2]}/${stage}`));
        await at("/h/*/film/*/direction", () => go(`${h}/film/${film[1]}/direction`));
        await at("/h/*/film (one film)", () => go(`${h}/film`));
      }
    }
  }
  await context.close();
  return problems;
}

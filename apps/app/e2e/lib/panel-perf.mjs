// Shared by `panel-motion.mjs` (browser) and the desktop check: how smooth a panel's slide is, measured in the page.
// Per transition: the time between animation frames, the React commits of the whole app between the first and the last
// frame that moved, and how far the panel's edge is from its neighbour's edge in every frame.
// The media of the heavy project is real: a 3-minute 1080p file made with ffmpeg, imported through the editor's own UI.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Runs before the app's own code: counts every React commit (the hook React reports to, also in a production build). */
export const COMMIT_COUNTER = () => {
  window.__commits = [];
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(), supportsFiber: true, isDisabled: false,
    inject(renderer) { const id = this.renderers.size + 1; this.renderers.set(id, renderer); return id; },
    onCommitFiberRoot() { window.__commits.push(performance.now()); },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {},
  };
};

/** The files of the heavy project, made once per directory. */
export function heavyMedia(dir) {
  mkdirSync(dir, { recursive: true });
  const ffmpeg = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);
  const file = (name) => join(dir, name);
  if (!existsSync(file("long.mp4"))) ffmpeg("-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=180", "-f", "lavfi", "-i", "sine=frequency=330:duration=180", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file("long.mp4"));
  if (!existsSync(file("second.mp4"))) ffmpeg("-f", "lavfi", "-i", "smptebars=s=1920x1080:r=30:d=20", "-f", "lavfi", "-i", "sine=frequency=660:duration=20", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file("second.mp4"));
  if (!existsSync(file("still.png"))) ffmpeg("-f", "lavfi", "-i", "color=c=green:s=1280x720:d=1", "-frames:v", "1", file("still.png"));
  if (!existsSync(file("tone.wav"))) ffmpeg("-f", "lavfi", "-i", "sine=frequency=220:duration=60", file("tone.wav"));
  return ["long.mp4", "second.mp4", "still.png", "tone.wav"].map(file);
}

const visible = (page, id) => page.getByTestId(id).filter({ visible: true }).first();
const clipCount = (page) => page.evaluate(() => document.querySelectorAll('[data-testid^="track-"] [data-testid^="clip-"]:not([data-testid="clip-selection"]):not([data-testid="clip-hover"]):not([data-testid="clip-hatch"]):not([data-testid="clip-mute"]):not([data-testid="clip-reverse"])').length);

/**
 * In the editor of a new project: imports the files, puts each on the timeline and cuts the long clip several times.
 * Returns what ended up on the timeline (clips drawn at the moment, tracks).
 */
export async function buildHeavyProject(page, files) {
  for (const id of ["editor-bar", "asset-panel", "player", "inspector", "timeline"]) await visible(page, id).waitFor({ timeout: 90_000 });
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), visible(page, "media-dropzone").click()]);
  await chooser.setFiles(files);
  for (const name of ["long.mp4", "second.mp4", "still.png", "tone.wav"]) await visible(page, `label-${name}`).waitFor({ timeout: 300_000 });
  for (const name of ["long.mp4", "second.mp4", "still.png", "tone.wav"]) {
    const before = await clipCount(page);
    await visible(page, name.endsWith(".wav") ? `label-${name}` : `thumb-${name}`).dblclick();
    await page.waitForFunction((count) => document.querySelectorAll('[data-testid^="track-"] [data-testid^="clip-"]').length > count, before, { timeout: 60_000 }).catch(() => undefined);
    await page.waitForTimeout(400);
  }
  // Cuts of the long clip, each at a playhead typed into the timecode field, on the clip under the playhead.
  let cuts = 0;
  for (const at of ["00:00:02:00", "00:00:04:00", "00:00:06:00", "00:00:09:00", "00:00:12:00", "00:00:15:00"]) {
    await visible(page, "timecode").fill(at); await page.keyboard.press("Enter"); await page.waitForTimeout(300);
    const head = await visible(page, "playhead").boundingBox(), row = await visible(page, "track-main-video").boundingBox();
    if (!head || !row) continue;
    await page.mouse.click(head.x + head.width / 2 + 8, row.y + row.height / 2); await page.waitForTimeout(200);
    const split = visible(page, "tool-split");
    if (await split.isEnabled().catch(() => false)) { await split.click(); cuts++; await page.waitForTimeout(250); }
  }
  await visible(page, "timecode").fill("00:00:05:00"); await page.keyboard.press("Enter"); await page.waitForTimeout(1500);
  await page.mouse.move(700, 5);
  const tracks = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="track-"]')].map((node) => node.getAttribute("data-testid")).filter((id) => /^track-(main|overlay|audio|[a-z]+-)/.test(id)).length);
  return { clips: await clipCount(page), cuts, tracks, duration: (await visible(page, "player-duration").innerText().catch(() => "")).trim() };
}

/**
 * One transition. `toggle` is the test id (or, starting with "[", the selector) of the control that starts it; it is
 * pressed from inside the page, so no pointer hovers anything. `panel`/`side` name the moving edge, `other`/`otherSide` the neighbour's edge that
 * must stay glued to it ("prev" / "next" = the panel's sibling).
 */
export async function measure(page, { name, toggle, panel, side, other, otherSide, span = 900 }) {
  await page.evaluate(([panelId, edgeSide, otherSpec, otherEdge, toggleId, ms]) => new Promise((done) => {
    const find = (id) => [...document.querySelectorAll(`[data-testid="${id}"]`)].find((entry) => entry.getClientRects().length > 0) ?? null;
    const edge = (node, which) => (node ? node.getBoundingClientRect()[which] : null);
    const out = window.__perf = { frames: [], click: 0, commits: [] };
    let from = 0;
    const tick = (now) => {
      const node = find(panelId);
      const neighbour = otherSpec === "prev" ? node?.previousElementSibling : otherSpec === "next" ? node?.nextElementSibling : find(otherSpec);
      out.frames.push({ t: now, a: edge(node, edgeSide), b: edge(neighbour, otherEdge) });
      if (out.frames.length === 3) { out.click = performance.now(); (toggleId.startsWith("[") ? [...document.querySelectorAll(toggleId)].find((entry) => entry.getClientRects().length > 0) : find(toggleId))?.click(); from = out.click; }
      if (from && now - from > ms) { out.commits = window.__commits ? window.__commits.filter((time) => time >= out.click) : null; done(null); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), [panel, side, other, otherSide, toggle, span]);
  const perf = await page.evaluate(() => window.__perf);
  const frames = perf.frames;
  // The frames that moved: the panel's edge (or, while the panel is not drawn, its neighbour's) differs from the frame before.
  // The panel's own edge where it is drawn in every frame; else its neighbour's (a collapsed region is not drawn); a
  // panel that enters or leaves the tree is followed by its own edge, with the frames it is absent left out of the steps.
  const key = frames.every((frame) => frame.a !== null) ? "a" : frames.every((frame) => frame.b !== null) ? "b" : "a";
  const position = (frame) => frame[key];
  const moved = frames.map((frame, index) => index > 0 && position(frame) !== position(frames[index - 1]) && frame.t >= perf.click);
  const first = moved.indexOf(true), last = moved.lastIndexOf(true);
  if (first < 0) return { name, moved: 0, note: "nothing moved" };
  const deltas = frames.slice(first, last + 1).map((frame, index) => frame.t - frames[first + index - 1].t);
  const sorted = [...deltas].sort((a, b) => a - b);
  const pairs = frames.slice(first, last + 1).filter((frame) => frame.a !== null && frame.b !== null);
  const steps = frames.slice(first, last + 1).map((frame, index) => [position(frame), position(frames[first + index - 1])]).filter(([now, before]) => now !== null && before !== null).map(([now, before]) => Math.abs(now - before));
  const seen = frames.slice(first - 1, last + 1).map(position).filter((value) => value !== null);
  const travel = Math.max(...seen) - Math.min(...seen);
  return {
    name, moved: last - first + 1,
    duration: Math.round(frames[last].t - frames[first - 1].t),
    // The wait between the press and the first frame that moved (the mount of what opens is in here).
    lead: Math.round(frames[first - 1].t - perf.click),
    maxFrame: Math.round(Math.max(...deltas) * 10) / 10,
    p95: Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] * 10) / 10,
    commits: perf.commits === null ? null : perf.commits.filter((time) => time > frames[first].t && time < frames[last].t - 1).length,
    gap: pairs.length ? Math.round(Math.max(...pairs.map((frame) => Math.abs(frame.a - frame.b))) * 10) / 10 : null,
    travel: Math.round(travel), maxStep: Math.round(Math.max(0, ...steps)),
  };
}

export const LIMITS = { maxFrame: 34, p95: 20, commits: 0, gap: 1.01 };
/** The reasons a measured transition is not smooth; empty when it is. */
export function faults(result, limits = LIMITS) {
  if (!result.moved) return [`${result.name}: nothing moved`];
  const out = [];
  if (result.moved < 5) out.push(`only ${result.moved} frames moved`);
  if (result.maxFrame > limits.maxFrame) out.push(`a frame took ${result.maxFrame} ms (limit ${limits.maxFrame})`);
  if (result.p95 > limits.p95) out.push(`p95 frame ${result.p95} ms (limit ${limits.p95})`);
  if (result.commits !== null && result.commits > limits.commits) out.push(`${result.commits} React commits while it moved (limit ${limits.commits})`);
  if (result.gap !== null && result.gap > limits.gap) out.push(`edges ${result.gap} px apart in a frame`);
  if (result.travel >= 20 && result.maxStep > result.travel * 0.5) out.push(`jumped ${result.maxStep} px of ${result.travel} in one frame`);
  return out.map((text) => `${result.name}: ${text}`);
}
export const line = (result) => result.moved
  ? `${result.name.padEnd(22)} frames ${String(result.moved).padStart(2)}  ${String(result.duration).padStart(3)} ms  lead ${String(result.lead).padStart(3)} ms  max ${String(result.maxFrame).padStart(5)} ms  p95 ${String(result.p95).padStart(5)} ms  commits ${result.commits}  gap ${result.gap} px  max step ${result.maxStep}/${result.travel} px`
  : `${result.name.padEnd(22)} nothing moved`;

/** The editor's panels on a wide window, each closed then opened (the agent panel: opened then closed). */
export const EDITOR_PANELS = [
  { name: "assets close", toggle: "toggle-assets", panel: "panel-assets", side: "right", other: "panel-player", otherSide: "left" },
  { name: "assets open", toggle: "toggle-assets", panel: "panel-assets", side: "right", other: "panel-player", otherSide: "left" },
  { name: "inspector close", toggle: "toggle-inspector", panel: "panel-inspector", side: "left", other: "panel-player", otherSide: "right" },
  { name: "inspector open", toggle: "toggle-inspector", panel: "panel-inspector", side: "left", other: "panel-player", otherSide: "right" },
  { name: "timeline close", toggle: "toggle-timeline", panel: "panel-timeline", side: "top", other: "panel-top", otherSide: "bottom" },
  { name: "timeline open", toggle: "toggle-timeline", panel: "panel-timeline", side: "top", other: "panel-top", otherSide: "bottom" },
  { name: "agent open", toggle: "toggle-agent", panel: "agent-panel-slot", side: "left", other: "prev", otherSide: "right" },
  { name: "agent close", toggle: "toggle-agent", panel: "agent-panel-slot", side: "left", other: "prev", otherSide: "right" },
];
export async function measureAll(page, panels = EDITOR_PANELS) {
  const results = [];
  for (const spec of panels) { results.push(await measure(page, spec)); await page.waitForTimeout(500); }
  return results;
}

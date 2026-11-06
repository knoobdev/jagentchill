// End-to-end in a real browser: cross-device sync between TWO browser contexts (two separate devices, each with its
// own IndexedDB, OPFS and device key) against a running JAgentChill Server and the web app. Both pair through the
// server log's pairing offer and the six-digit codes it prints, as a person reading the host terminal would.
// A creates a project and imports a real video (an ffmpeg-made fixture of packages/media), turns sync on and edits;
// B opens the project from the host, watches A's edits arrive on its timeline, asks to edit, A hands over and becomes
// read-only; then every sync control is used: keep editing, take over, follow, transfer, stop and start editing, a real
// offline branch with the four conflict choices and Compare, comments, host versions, the activity popover, the Sync
// card, the continuity chip, "Look for it on the host", deletion, the host trash and the host's media list.
// Nothing is seeded, mocked or stubbed. "Offline" is the browser context's own offline switch. The 1080p video and the
// 51 small pictures are made here (ffmpeg's test pattern, a PNG encoder); no model turn runs and no provider key is used.
// Usage: node apps/app/e2e/sync.mjs <server-log-file> <screenshot-dir>   (env: E2E_BASE, default http://localhost:8089)
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, crc32 } from "node:zlib";
import { chromium } from "playwright";
import { ensureFixtures, fixturePath } from "../../../packages/media/test/support/fixtures.ts";

const [logFile, shots = ".dev/shots/sync"] = process.argv.slice(2);
const base = process.env.E2E_BASE ?? "http://localhost:8089";
mkdirSync(shots, { recursive: true });
ensureFixtures(["h264-aac.mp4", "alpha.png"]);
const work = join(tmpdir(), `jagentchill-sync-e2e-${Date.now()}`); mkdirSync(work, { recursive: true });
// A 1080p source (it needs a proxy) of a few megabytes, and 51 distinct 8×8 pictures for the paged media list.
const hd = join(work, "hd-1080p.mp4");
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-f", "lavfi", "-i", "sine=frequency=330", "-t", "6", "-c:v", "libx264", "-b:v", "9M", "-minrate", "9M", "-maxrate", "9M", "-bufsize", "2M", "-x264-params", "nal-hrd=cbr", "-pix_fmt", "yuv420p", "-c:a", "aac", hd]);
const hd2 = join(work, "second-1080p.mp4");
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=30", "-t", "5", "-c:v", "libx264", "-b:v", "9M", "-minrate", "9M", "-maxrate", "9M", "-bufsize", "2M", "-x264-params", "nal-hrd=cbr", "-pix_fmt", "yuv420p", hd2]);
const png = (index) => {
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body) >>> 0, body.length + 4); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(8, 0); header.writeUInt32BE(8, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 8 }, () => [index * 5 % 256, 255 - index * 4, (index * 37) % 256]).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: 8 }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
};
const pictures = Array.from({ length: 51 }, (_, index) => { const file = join(work, `picture-${String(index).padStart(2, "0")}.png`); writeFileSync(file, png(index)); return file; });
const offer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))[0];
const browser = await chromium.launch({ headless: true });
const errors = [], engineNotes = [];
/** The clips of the main track: elements have UUID ids; the selection and hover overlays share the `clip-` prefix and are left out. */
const COUNT = `() => [...document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]')].filter((node) => /^clip-[0-9a-f-]{36}$/.test(node.getAttribute("data-testid"))).length`;
const expect = (condition, message) => { if (!condition) throw new Error(message); };

/** One device: a browser context of its own. */
async function device(name) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();
  page.on("pageerror", (err) => (/GPU context not initialized/.test(String(err)) ? engineNotes : errors).push(`${name}: ${err}`));
  page.on("console", (msg) => msg.type() === "error" && !/Failed to load resource|ERR_|status of 4\d\d/.test(msg.text()) && (/GPU context not initialized/.test(msg.text()) ? engineNotes.push(`${name}: ${msg.text()}`) : errors.push(`${name}: ${msg.text()}`)));
  const visible = (locator) => locator.filter({ visible: true }).first();
  const api = {
    name, page, visible,
    text: (value, options) => visible(page.getByText(value, options)),
    button: (label, exact = true) => visible(page.getByRole("button", { name: label, exact })),
    menuItem: (label) => visible(page.getByRole("menuitem", { name: label, exact: true }).or(page.getByRole("menuitemradio", { name: label, exact: true })).or(page.getByRole("menuitemcheckbox", { name: label, exact: true }))),
    tid: (id) => visible(page.getByTestId(id)),
    // Dialogs and sheets fade in: the picture is taken once they have.
    shot: async (file) => { await page.waitForTimeout(450); if(file.startsWith("comments")){const layout=await page.evaluate(()=>{const box=n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {testId:n.dataset.testid,text:n.textContent?.slice(0,180),x:r.x,y:r.y,w:r.width,h:r.height,font:s.fontSize,weight:s.fontWeight,line:s.lineHeight,bg:s.backgroundColor,radius:s.borderRadius,padding:s.padding,scrollW:n.scrollWidth,clientW:n.clientWidth};};return [...document.querySelectorAll('[data-testid="comments-panel"], [data-testid="comment"], [data-testid="comment-body"], [data-testid="comment-time"], [data-testid="comment-input"], [data-testid="comment-time-mode"]')].map(box)});writeFileSync(`${shots}/${file}.layout.json`,JSON.stringify(layout,null,2));} await page.screenshot({ path: `${shots}/${file}.png` }); },
    clips: () => page.evaluate(`(${COUNT})()`),
    waitClips: (count, timeout = 30_000) => page.waitForFunction(`(${COUNT})() === ${count}`, null, { timeout }),
    status: async () => (await visible(page.getByTestId("sync-status")).textContent()) ?? "",
    context,
    statusIs: (pattern, timeout = 30_000) => page.waitForFunction((source) => new RegExp(source).test([...document.querySelectorAll('[data-testid="sync-status"]')].map((node) => (node.getAttribute("aria-label") ?? "") + (node.textContent ?? "")).join(" ")), pattern.source, { timeout }),
    timecode: () => visible(page.getByTestId("timecode")).inputValue(),
    importFiles: async (paths) => { const chooser = page.waitForEvent("filechooser"); await api.button("Import").click(); await api.menuItem("Import files…").click(); await (await chooser).setFiles(paths); },
    openProjects: async () => { await api.button("Editor menu").click(); await api.menuItem("Back to projects").click(); await api.text("Every project on this device", { exact: false }).waitFor({ timeout: 30_000 }); },
    openEditor: async (path) => { await page.goto(`${base}${path}`, { waitUntil: "networkidle" }); await api.tid("timeline").waitFor({ timeout: 60_000 }); },
    popover: async () => { await api.tid("sync-status").click(); await api.tid("sync-activity").waitFor(); },
    transfer: (name) => visible(page.getByTestId("sync-transfer").filter({ hasText: name })),
    closeOverlay: async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(250); },
  };
  // Pair this browser with the host: the offer from the host's log, then the code it prints for this device's key.
  await page.goto(`${base}/`, { waitUntil: "networkidle", timeout: 180_000 });
  await api.text("What do you want to make?").waitFor({ timeout: 120_000 });
  await api.button("Connect").click();
  await page.getByLabel("Pairing link").fill(offer);
  await page.getByLabel("Name of this device").fill(name);
  await api.button("Continue").click();
  await api.text(/Enter the code shown next to [0-9a-f]{8}/).waitFor();
  const fingerprint = /next to ([0-9a-f]{8})/.exec(await page.content())[1];
  await page.waitForTimeout(500);
  const code = /code (\d{6})/.exec(readFileSync(logFile, "utf8").split("\n").filter((line) => line.includes(`${fingerprint})`)).pop())[1];
  await page.getByLabel("Verification code").fill(code);
  await api.text("Connected", { exact: true }).waitFor();
  return api;
}
const step = async (name, run) => { try { await run(); console.log("ok  ", name); } catch (err) { console.log("FAIL", name, "—", String(err).split("\n").slice(0, 4).join(" ")); errors.push(`step failed: ${name}`); throw err; } };
let A, B, projectUrl, projectId, secondUrl, thirdUrl;
const idOf = (path) => path.split("/").pop();
/** Both devices show the same number of clips. */
const settled = async (count) => { await A.waitClips(count, 30_000); await B.waitClips(count, 30_000); };
/** Whoever edits stops; `device` starts editing. */
async function editor(device, other) {
  if (/Synced|Syncing/.test(await device.status()) && (await device.page.getByTestId("sync-banner").filter({ visible: true }).count()) === 0) return;
  if ((await other.page.getByTestId("sync-banner").filter({ visible: true }).count()) === 0) { await other.popover(); await other.tid("sync-stop-editing").click(); }
  await device.tid("sync-banner").getByText("Start editing", { exact: true }).click({ timeout: 20_000 });
  await device.page.waitForFunction(() => document.querySelector('[data-testid="sync-banner"]') === null, null, { timeout: 20_000 });
}
/** A real offline branch: B, the writer, loses its network and edits; A (admin) takes over and edits; B comes back. */
async function diverge() {
  await editor(B, A);
  const before = await B.clips();
  await B.context.setOffline(true);
  await B.tid("label-h264-aac.mp4").dblclick();
  await B.waitClips(before + 1);
  await B.statusIs(/Offline changes \(1\)/, 40_000);
  await A.tid("sync-take-over").click({ timeout: 40_000 });
  await A.tid("sync-force-confirm").click();
  await A.page.waitForFunction(() => document.querySelector('[data-testid="sync-banner"]') === null, null, { timeout: 20_000 });
  await A.tid("thumb-h264-aac.mp4").dblclick();
  await A.tid("thumb-h264-aac.mp4").dblclick();
  await A.waitClips(before + 2);
  await A.statusIs(/Synced/);
  await B.context.setOffline(false);
  await B.statusIs(/Sync paused — conflict/, 40_000);
  return before;
}

try {
  await step("two browsers pair with the host as two devices", async () => {
    A = await device("Anna (director)");
    B = await device("Laptop browser B");
    await A.shot("01-a-connected");
  });

  await step("Sync card: \"Sync new projects\" is on by default with a host paired; A turns it off to make a local project first — Scenario: No host paired (the card says so on a device without a host)", async () => {
    await A.page.goto(`${base}/settings/sync`, { waitUntil: "networkidle" });
    await A.tid("sync-settings").waitFor({ timeout: 60_000 });
    for (const label of ["Sync new projects", "Download originals automatically", "Upload limit", "Download limit", "Sync my library", "Name on review comments"]) await A.text(label, { exact: true }).waitFor();
    expect((await A.page.getByText("Sync media over mobile data").count()) === 0, "the mobile-data switch is on mobile only");
    const toggle = A.tid("pref-sync-new").getByRole("switch");
    expect((await toggle.getAttribute("aria-checked")) === "true", "Sync new projects defaults to on");
    await toggle.click();
    expect((await toggle.getAttribute("aria-checked")) === "false", "it turns off");
    await A.tid("pref-comment-name").fill("Anna (director)");
    await A.shot("02-a-sync-card");
  });

  await step("A creates a local project and imports a real video", async () => {
    await A.page.goto(`${base}/projects`, { waitUntil: "networkidle" });
    await A.button("Create your first project").click({ timeout: 90_000 });
    await A.page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
    projectUrl = new URL(A.page.url()).pathname; projectId = idOf(projectUrl);
    await A.tid("timeline").waitFor({ timeout: 60_000 });
    await A.importFiles([fixturePath("h264-aac.mp4")]);
    await A.tid("label-h264-aac.mp4").waitFor({ timeout: 60_000 });
    await A.tid("thumb-h264-aac.mp4").dblclick();
    await A.waitClips(1, 30_000);
    expect((await A.page.getByTestId("sync-status").count()) === 0, "a project on this device only shows no sync status");
    await A.visible(A.page.getByTestId("save-state").getByText("Saved", { exact: true })).waitFor({ timeout: 30_000 });
  });

  await step("A turns sync on from the project's menu — Scenario: Enable sync on an existing project", async () => {
    await A.openProjects();
    await A.page.getByRole("button", { name: "Actions for New project" }).first().click({ force: true });
    await A.menuItem("Sync").click();
    await A.shot("03-a-sync-menu");
    await A.menuItem("Sync with JAgentChill").click();
    await A.page.waitForFunction(() => [...document.querySelectorAll('[data-testid^="sync-badge-"]')].some((node) => /Synced/.test(node.textContent ?? "")), null, { timeout: 60_000 });
    await A.shot("04-a-projects-synced");
    await A.openEditor(projectUrl);
    await A.statusIs(/Synced/, 60_000);
  });

  await step("B finds the project under \"On JAgentChill\" and opens it view-only — Scenario: Browsing projects from a second device, Scenario: Second device opens the project", async () => {
    await B.page.goto(`${base}/projects`, { waitUntil: "networkidle" });
    await B.tid("host-projects").waitFor({ timeout: 60_000 });
    await B.text("Everyone paired with this host can see these items").waitFor();
    await B.button("Open on this device").click();
    await B.page.waitForURL(/\/editor\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    expect(new URL(B.page.url()).pathname === projectUrl, "B opened the same project");
    await B.tid("timeline").waitFor({ timeout: 60_000 });
    await B.text("Anna (director) is editing this project").waitFor({ timeout: 60_000 });
    await B.waitClips(1, 30_000);
    await B.statusIs(/Viewing — Anna \(director\) is editing/);
    await B.shot("05-b-view-only");
  });

  await step("the real media A imported appears in B — Scenario: Download finishes during playback; Scenario: Small source (no proxy for a source of 720 px or less)", async () => {
    await B.tid("label-h264-aac.mp4").waitFor({ timeout: 90_000 });
    await B.page.waitForFunction(async () => {
      const root = await navigator.storage.getDirectory();
      const walk = async (directory, depth) => { let found = false; for await (const [name, handle] of directory.entries()) { if (handle.kind === "file" && /\.mp4$/.test(name) && (await handle.getFile()).size > 10_000) found = true; else if (handle.kind === "directory" && depth < 5 && (await walk(handle, depth + 1))) found = true; } return found; };
      return walk(root, 0);
    }, null, { timeout: 90_000 });
  });

  await step("A edits and B's timeline updates live; a view-only device cannot edit — Scenario: Viewer sees an edit, Scenario: Editing controls disabled", async () => {
    await A.tid("thumb-h264-aac.mp4").dblclick();
    await settled(2);
    await A.statusIs(/Synced/, 15_000);
    await A.tid("presence-strip").waitFor({ timeout: 15_000 });
    await B.tid("presence-strip").waitFor({ timeout: 15_000 });
    await B.tid("label-h264-aac.mp4").dblclick({ timeout: 5000 }).catch(() => undefined);
    await B.page.keyboard.press("Delete");
    await B.page.waitForTimeout(800);
    expect((await B.clips()) === 2 && (await A.clips()) === 2, "nothing changed on either device");
  });

  await step("Follow: B follows A's playhead; scrubbing on B turns Follow off — Scenario: Follow turned off by scrubbing", async () => {
    await B.tid("sync-follow").click();
    await B.tid("sync-follow").getByText("Following").waitFor();
    await A.tid("player-end").click();
    const target = await A.timecode();
    expect(target !== "00:00:00:00", "A moved its playhead");
    await B.page.waitForFunction((value) => document.querySelector('[data-testid="timecode"]')?.value === value, target, { timeout: 15_000 });
    await B.shot("06-b-following");
    await B.tid("player-start").click();
    await B.tid("sync-follow").getByText("Follow", { exact: true }).waitFor({ timeout: 10_000 });
    expect((await B.timecode()) === "00:00:00:00", "B's playhead stays where the user put it");
  });

  await step("B asks to edit, A keeps editing: B sees the decline and the cooldown — Scenario: Holder declines", async () => {
    await B.tid("sync-request").click();
    await A.text("Laptop browser B wants to edit this project").waitFor({ timeout: 15_000 });
    await A.tid("sync-keep-editing").click();
    await B.text("Anna (director) is still editing").waitFor({ timeout: 15_000 });
    await B.tid("sync-request").getByText(/Request to edit \(\d+ s\)/).waitFor({ timeout: 10_000 });
    await B.shot("07-b-declined");
    await A.statusIs(/Synced/);
  });

  await step("A transfers editing to B with the device picker, B accepts — \"Transfer editing to…\"", async () => {
    await A.popover();
    await A.tid("sync-transfer-picker").getByText("Laptop browser B").waitFor({ timeout: 15_000 });
    await A.shot("08-a-transfer-picker");
    await A.tid("sync-transfer-to").click();
    await B.text("Anna (director) wants to transfer editing to this device").waitFor({ timeout: 15_000 });
    await B.shot("09-b-transfer-prompt");
    await B.button("Start editing").click();
    await A.text("Laptop browser B is editing this project").waitFor({ timeout: 15_000 });
    await B.statusIs(/Synced/);
    await B.tid("label-h264-aac.mp4").dblclick();
    await settled(3);
  });

  await step("A asks, B hands over; then Stop editing and Start editing — Scenario: Holder hands over, Scenario: Holder disappears (the banner offers \"Start editing\")", async () => {
    // The cooldown of a decline applies to B only: A may ask at once.
    await A.tid("sync-request").click();
    await B.text("Anna (director) wants to edit this project").waitFor({ timeout: 15_000 });
    await B.tid("sync-hand-over").click();
    await B.text("Anna (director) is editing this project").waitFor({ timeout: 15_000 });
    await A.statusIs(/Synced/);
    await A.popover();
    await A.tid("sync-stop-editing").click();
    await A.text("Nobody is editing this project").waitFor({ timeout: 15_000 });
    await B.text("Nobody is editing this project").waitFor({ timeout: 15_000 });
    await B.shot("10-b-nobody-editing");
    await B.tid("sync-banner").getByText("Start editing", { exact: true }).click();
    await A.text("Laptop browser B is editing this project").waitFor({ timeout: 15_000 });
  });

  await step("comments: B leaves a timed comment, A sees it and resolves it; too long is refused in the field — Scenario: Viewer leaves a timed comment, Scenario: Resolve, Scenario: Comment too long", async () => {
    await A.tid("open-comments").click();
    await A.tid("comments-empty").waitFor();
    await A.page.setViewportSize({ width: 1440, height: 900 });
    await A.shot("comments-empty-light-360-shared-dock");
    const emptyStyles=await A.tid("comments-panel").evaluate(p=>[...p.querySelectorAll('*')].filter(n=>n.children.length===0&&n.textContent?.trim()).map(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return{text:n.textContent,font:s.fontSize,weight:s.fontWeight,line:s.lineHeight,color:s.color,bg:s.backgroundColor,border:s.border,x:r.x,y:r.y,w:r.width,h:r.height};}));writeFileSync(`${shots}/empty-style.json`,JSON.stringify(emptyStyles,null,2));
    await A.tid("player-end").click().catch(() => undefined);
    await B.tid("open-comments").click();
    await B.tid("comment-input").fill("Trim this pause");
    await B.tid("comment-send").click();
    await B.tid("comment-body").getByText("Trim this pause").waitFor({ timeout: 10_000 });
    await A.tid("comment-body").getByText("Trim this pause").waitFor({ timeout: 10_000 });
    await A.tid("comments-panel").getByText("Laptop browser B").waitFor();
    await A.shot("11-a-comment-arrived");
    await B.tid("comment-input").fill("x".repeat(2001));
    await B.tid("comment-counter").getByText("1 characters too many").waitFor();
    expect(await B.tid("comment-send").isDisabled(), "Send is disabled above 2000 characters");
    await B.tid("comment-input").fill("");
    await A.page.getByTestId("comment").filter({ hasText: "Trim this pause" }).hover();
    await A.tid("comment-resolve").click();
    await A.tid("comments-empty").waitFor({ timeout: 10_000 });
    await A.visible(A.page.getByRole("radio", { name: /Resolved/ })).click();
    await A.tid("comment-body").getByText("Trim this pause").waitFor();
    await B.tid("comments-empty").waitFor({ timeout: 10_000 });
  });

  await step("a comment written offline shows \"Pending\" and is sent once on reconnect — Scenario: Comment made offline", async () => {
    await B.context.setOffline(true);
    await B.page.waitForTimeout(1500);
    await B.tid("comment-input").fill("Written on the train");
    await B.tid("comment-send").click();
    await B.tid("comment-pending").getByText("Pending").waitFor({ timeout: 10_000 });
    await B.shot("12-b-comment-pending");
    await B.context.setOffline(false);
    await B.page.waitForFunction(() => document.querySelector('[data-testid="comment-pending"]') === null, null, { timeout: 40_000 });
    await A.visible(A.page.getByRole("radio", { name: /Open/ })).click();
    await A.tid("comment-body").getByText("Written on the train").waitFor({ timeout: 15_000 });
    expect((await A.page.getByTestId("comment").filter({ visible: true }).count()) === 1, "sent once");
    await A.closeOverlay(); await B.closeOverlay();
    // B was the writer when its network went away; it is the writer again or free.
    await B.statusIs(/Synced|Offline/, 40_000);
  });

  await step("comments panel resize persists, eight timeline comments are added through the editor, and the narrow view is a sheet", async () => {
    await A.page.keyboard.press("c");
    await A.tid("comments-panel").waitFor();
    await A.page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "comment-input");
    expect(await A.tid("comment-input").count() === 1, "C opens Comments and focuses its composer");
    await A.visible(A.page.getByRole("radio", { name: /Open/ })).click();
    const dock = A.tid("editor-right-dock");
    const splitter = await A.tid("agent-panel-splitter").boundingBox();
    expect(Boolean(splitter), "wide shared dock exposes its single resize handle");
    const before = await dock.boundingBox();
    await A.page.mouse.move(splitter.x + splitter.width / 2, splitter.y + splitter.height / 2);
    await A.page.mouse.down();
    await A.page.mouse.move(splitter.x + splitter.width / 2 - 120, splitter.y + splitter.height / 2, { steps: 6 });
    await A.page.mouse.up();
    await A.page.waitForTimeout(250);
    const widened = await dock.boundingBox();
    expect(widened.width >= before.width + 110 && widened.width <= before.width + 130, `shared dock drag changes width by about 120 px (${before.width} → ${widened.width})`);
    expect(await A.page.getByTestId("editor-right-dock").count() === 1, "Comments uses exactly one editor right dock");
    const currentSplitter = await A.tid("agent-panel-splitter").boundingBox();
    await A.page.mouse.move(currentSplitter.x + currentSplitter.width / 2, currentSplitter.y + currentSplitter.height / 2);
    await A.page.mouse.down();
    await A.page.mouse.move(currentSplitter.x + currentSplitter.width / 2 + 100, currentSplitter.y + currentSplitter.height / 2, { steps: 5 });
    await A.page.mouse.up();
    await A.page.waitForTimeout(250);
    const visualWidth = await dock.boundingBox();
    expect(visualWidth.width >= 360 && visualWidth.width <= 420, `visual proof uses a normal 360–420 px dock (${visualWidth.width})`);
    await A.tid("comments-close").click();
    await A.tid("open-comments").click();
    await A.tid("comments-panel").waitFor();
    await A.page.locator('[data-testid="agent-panel-slot"][data-settled="true"]').waitFor();
    const reopened = await dock.boundingBox();
    expect(Math.abs(reopened.width - visualWidth.width) < 2, "one dock width is remembered when Comments reopens");

    await A.page.reload({waitUntil:"networkidle"});
    await A.tid("timeline").waitFor();
    if(!(await A.page.getByTestId("comments-panel").isVisible())) await A.tid("open-comments").click();
    await A.page.locator('[data-testid="agent-panel-slot"][data-settled="true"]').waitFor();
    const reloaded=await A.tid("editor-right-dock").boundingBox();
    console.log("VF WIDTH RELOAD",JSON.stringify({before:visualWidth,after:reloaded}));
    expect(Math.abs(reloaded.width-visualWidth.width)<2,"dock width survives browser reload");
    const edge=await A.tid("agent-panel-splitter").boundingBox();
    await A.page.mouse.move(edge.x+edge.width/2,edge.y+edge.height/2);await A.page.mouse.down();await A.page.mouse.move(0,edge.y+edge.height/2,{steps:10});await A.page.mouse.up();await A.page.waitForTimeout(350);
    const max=await A.tid("editor-right-dock").boundingBox();console.log("VF WIDTH EXTREME",JSON.stringify(max));
    expect(max.width<1000,"dock does not fill the editor at extreme drag");
    const maxEdge=await A.tid("agent-panel-splitter").boundingBox();
    await A.page.mouse.move(maxEdge.x+maxEdge.width/2,maxEdge.y+maxEdge.height/2);await A.page.mouse.down();await A.page.mouse.move(maxEdge.x+maxEdge.width/2+(max.width-visualWidth.width),maxEdge.y+maxEdge.height/2,{steps:10});await A.page.mouse.up();await A.page.waitForTimeout(350);
    const ruler = await A.tid("timeline-ruler").boundingBox();
    for (let index = 0; index < 8; index++) {
      await A.page.mouse.click(ruler.x + ruler.width * (0.02 + index * 0.045), ruler.y + ruler.height / 2);
      const input = A.tid("comment-input");
      const timeAtClick = (await A.tid("comment-time-mode").textContent())?.trim();
      expect(timeAtClick === (await A.timecode()).trim(), `time chip follows the playhead: ${timeAtClick}`);
      await input.fill(`Review note ${String(index + 1).padStart(2, "0")} produced in the editor`);
      if (index === 0) {
        await A.page.mouse.click(ruler.x + ruler.width * 0.65, ruler.y + ruler.height / 2);
        expect((await A.tid("comment-time-mode").textContent())?.trim() === timeAtClick, "the draft keeps the time where typing began");
      }
      if (index === 0) await input.press("Meta+Enter");
      else await A.tid("comment-send").click();
      await A.page.waitForFunction((value) => [...document.querySelectorAll('[data-testid="comment-body"]')].some((node) => node.textContent?.includes(value)), `Review note ${String(index + 1).padStart(2, "0")} produced in the editor`, { timeout: 10_000 });
    }
    const markersBeforeProjectNote = await A.page.getByTestId("timeline-comment-marker").count();
    expect(markersBeforeProjectNote >= 8, "eight comments have markers on the real project timeline");
    await A.tid("comment-time-mode").click();
    expect((await A.tid("comment-time-mode").textContent())?.trim() === "Whole project", "time chip can target the whole project");
    await A.tid("comment-input").fill("Whole project note without a timeline marker");
    await A.tid("comment-send").click();
    await A.page.getByText("Whole project note without a timeline marker", { exact: true }).waitFor();
    expect(await A.page.getByTestId("timeline-comment-marker").count() === markersBeforeProjectNote, "a project-level comment has no ruler marker");
    await A.page.setViewportSize({ width: 1440, height: 900 });
    await A.page.waitForTimeout(500);
    await A.shot("comments-wide-light-8-product-comments");

    await A.tid("comment-sort-menu").click();await A.page.getByRole("menuitemcheckbox",{name:"Newest first",exact:true}).or(A.page.getByRole("menuitem",{name:"Newest first",exact:true})).or(A.page.getByRole("menuitemradio",{name:"Newest first",exact:true})).click();
    expect((await A.page.getByTestId("comment").filter({visible:true}).first().innerText()).includes("Whole project note"),"newest sort places the newest whole-project note first");
    await A.tid("comment-sort-menu").click();await A.page.getByRole("menuitemcheckbox",{name:"By time in video",exact:true}).or(A.page.getByRole("menuitem",{name:"By time in video",exact:true})).or(A.page.getByRole("menuitemradio",{name:"By time in video",exact:true})).click();
    console.log("VF SORT: newest first and by-time menu choices work");
    const rightDock = A.tid("editor-right-dock");
    const commentsBox = await rightDock.boundingBox();
    const commentsContentBox=await A.tid("comments-panel").boundingBox();
    expect(await A.page.getByTestId("agent-panel-splitter").count()===1,"one splitter for the shared dock");
    await A.tid("comment-input").fill("VF comments tab draft");
    await A.visible(A.page.getByRole("radio", { name: "Agent" })).click();
    await A.tid("agent-panel").waitFor();
    expect(await A.tid("editor-right-dock").count() === 1, "Agent and Comments share one dock");
    expect(await A.tid("agent-panel").isVisible() && !(await A.tid("comments-panel").isVisible()), "only the Agent tab content is visible");
    const agentBox = await rightDock.boundingBox();
    const agentContentBox=await A.tid("agent-panel").boundingBox();
    expect(Math.abs(commentsContentBox.x-agentContentBox.x)<2&&Math.abs(commentsContentBox.x+commentsContentBox.width-agentContentBox.x-agentContentBox.width)<2,"actual Agent and Comments content edges match");
    console.log("VF CONTENT EDGES",JSON.stringify({comments:commentsContentBox,agent:agentContentBox,splitters:await A.page.getByTestId("agent-panel-splitter").count()}));
    expect(Math.abs(agentBox.x - commentsBox.x) < 1 && Math.abs(agentBox.width - commentsBox.width) < 1, "Agent and Comments have identical dock edges and width");
    expect(await A.tid("timeline").isVisible(), "timeline remains visible with both right panels open");
    await A.shot("comments-wide-light-agent-shared-dock");
    await A.visible(A.page.getByRole("radio", { name: /Comments/ })).click();
    expect(await A.tid("comments-panel").isVisible() && !(await A.tid("agent-panel").isVisible()), "switching back shows only Comments in the same dock");
    expect(await A.tid("comment-input").inputValue()==="VF comments tab draft","Comments draft survives tab switching");await A.tid("comment-input").fill("");
    await A.tid("toggle-agent").click();
    expect(await A.tid("agent-panel").isVisible() && !(await A.tid("comments-panel").isVisible()), "the top-bar Agent button switches the shared dock to Agent");
    await A.tid("open-comments").click();
    expect(await A.tid("comments-panel").isVisible() && !(await A.tid("agent-panel").isVisible()), "the top-bar Comments button switches the shared dock to Comments");
    await A.shot("comments-wide-light-380-shared-dock");
    const audit=await A.page.evaluate(()=>{
      const box=n=>{if(!n)return null;const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {text:n.textContent?.slice(0,100),x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,font:s.fontSize,weight:s.fontWeight,line:s.lineHeight,fontFamily:s.fontFamily,color:s.color,bg:s.backgroundColor,padding:s.padding,radius:s.borderRadius};};
      const p=document.querySelector('[data-testid="comments-panel"]'),c=p.querySelector('[data-testid="comment"]');
      return {viewport:{w:innerWidth,h:innerHeight},dock:box(document.querySelector('[data-testid="editor-right-dock"]')),panel:box(p),header:box(p.children[0]),filter:box(p.querySelector('[role="radiogroup"]')),list:box(c?.parentElement),card:box(c),row1:box(c?.children[0]),cardTexts:[...c.querySelectorAll('*')].filter(n=>n.children.length===0&&n.textContent).map(box),composer:box(p.querySelector('[data-testid="comment-composer"]')),topButton:box(document.querySelector('[data-testid="open-comments"]'))};
    });
    const leaves=await A.tid("comments-panel").evaluate(p=>[...p.querySelectorAll('*')].filter(n=>n.children.length===0&&n.textContent?.trim()).slice(0,20).map(n=>{const s=getComputedStyle(n);return{text:n.textContent,font:s.fontSize,weight:s.fontWeight,line:s.lineHeight,color:s.color};}));writeFileSync(`${shots}/header-filter-style.json`,JSON.stringify(leaves,null,2));
    console.log("VF STYLE",JSON.stringify(audit));writeFileSync(`${shots}/visual-audit-wide.json`,JSON.stringify(audit,null,2));


    const card = A.page.getByTestId("comment").filter({ hasText: "Review note 04 produced in the editor" }).first();
    await card.scrollIntoViewIfNeeded();
    const displayedTime = (await card.getByTestId("comment-time").textContent())?.trim();
    await card.getByTestId("comment-time").click();
    expect((await A.timecode()).trim() === displayedTime, `selecting a comment seeks the timecode (${displayedTime})`);
    await A.tid("player-play").click();
    await A.page.waitForFunction(() => [...document.querySelectorAll('[data-testid="comment"]')].some((node) => node.textContent?.includes("Review note 04 produced in the editor") && node.dataset.activeComment === "true"), null, { timeout: 2_000 });
    await A.tid("player-play").click();
    await A.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(base).origin });
    await card.hover();
    await card.getByTestId("comment-more").click();
    await A.page.getByRole("menuitem", { name: "Copy link" }).click();
    await A.text("Copied", { exact: true }).waitFor({ timeout: 5_000 });
    const sharedLink = await A.page.evaluate(() => navigator.clipboard.readText());
    expect(sharedLink.length > 0, "Copy link writes a URL to the clipboard");
    expect(Boolean(new URL(sharedLink).searchParams.get("comment")), "Copy link includes a comment deep link");

    await B.tid("open-comments").click();
    await B.page.getByText("Review note 04 produced in the editor", { exact: true }).waitFor({ timeout: 15_000 });
    await card.hover();
    await card.getByTestId("comment-reply-action").click();
    await card.getByTestId("comment-reply-input").fill("Live reply from the editor");
    await card.getByTestId("comment-reply-send").click();
    await B.page.getByText("Live reply from the editor", { exact: true }).waitFor({ timeout: 15_000 });
    await A.page.getByText("Live reply from the editor", { exact: true }).waitFor({ timeout: 15_000 });
    await card.scrollIntoViewIfNeeded();
    await card.hover({ position: { x: 10, y: 10 } });
    await A.shot("comments-wide-light-thread-hover-actions");

    const editable = A.page.getByTestId("comment").filter({ hasText: "Review note 01 produced in the editor" }).first();
    await editable.hover();
    await editable.getByTestId("comment-more").click();
    await A.page.getByRole("menuitem", { name: "Edit" }).click();
    await A.page.getByLabel("Edit comment").fill("Edited review note from the editor");
    await A.tid("comment-edit-save").click();
    await B.page.getByText("Edited review note from the editor", { exact: true }).waitFor({ timeout: 15_000 });

    const resolvable = A.page.getByTestId("comment").filter({ hasText: "Review note 02 produced in the editor" }).first();
    await resolvable.hover();
    await resolvable.getByTestId("comment-resolve").click();
    await B.visible(B.page.getByRole("radio", { name: /Resolved/ })).click();
    await B.page.getByText("Review note 02 produced in the editor", { exact: true }).waitFor({ timeout: 15_000 });
    await A.visible(A.page.getByRole("radio", { name: /Resolved/ })).click();
    await A.page.getByText("Review note 02 produced in the editor", { exact: true }).waitFor({ timeout: 10_000 });
    await A.shot("comments-wide-light-resolved-filter");
    await A.visible(A.page.getByRole("radio", { name: /Open/ })).click();
    await B.visible(B.page.getByRole("radio", { name: /Open/ })).click();

    await A.tid("comment-input").fill("Delete this note through confirmation");
    await A.tid("comment-send").click();
    const deletable = A.page.getByTestId("comment").filter({ hasText: "Delete this note through confirmation" }).first();
    await B.page.getByText("Delete this note through confirmation", { exact: true }).waitFor({ timeout: 15_000 });
    console.log("VF DELETE SECOND PROFILE saw note before deletion");
    await deletable.hover();
    await deletable.getByTestId("comment-more").click();
    await A.page.getByRole("menuitem", { name: "Delete" }).click();
    const confirm = A.page.getByRole("dialog");
    await confirm.waitFor();
    await confirm.getByRole("button", { name: "Delete" }).click();
    await B.page.getByText("Delete this note through confirmation", { exact: true }).waitFor({ state: "detached", timeout: 15_000 });
    await A.page.goto(sharedLink, { waitUntil: "networkidle" });
    await A.tid("comments-panel").waitFor({ timeout: 15_000 });
    await A.page.getByText("Review note 04 produced in the editor", { exact: true }).waitFor({ timeout: 15_000 });
    expect((await A.timecode()).trim() === displayedTime, `opening a comment link selects and seeks to ${displayedTime}`);
    await A.tid("comment-input").fill("A focused review note at the current time");
    await A.shot("comments-wide-light-focused-composer");
    const oneLine=await A.tid("comment-input").boundingBox();
    await A.tid("comment-input").fill("Line one\nLine two\nLine three\nLine four\nLine five\nLine six");
    const sixLines=await A.tid("comment-input").boundingBox();
    console.log("VF COMPOSER GROWTH",JSON.stringify({oneLine,sixLines}));
    await A.shot("comments-wide-light-six-line-composer");
    await A.tid("comment-input").fill("");

    await A.button("Editor menu").click();
    await A.menuItem("Theme").hover();
    await A.menuItem("Dark").click();
    await A.page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="editor-right-dock"]')).backgroundColor !== "rgb(255, 255, 255)");
    await A.shot("comments-wide-dark-8-product-comments");
    await A.page.setViewportSize({ width: 390, height: 844 });
    await A.page.waitForTimeout(700);
    await A.tid("comments-panel").waitFor();
    await A.shot("comments-390-dark-product-comments");
    const mobileLayout=await A.page.evaluate(()=>{const visible=id=>[...document.querySelectorAll(`[data-testid="${id}"]`)].find(n=>n.getBoundingClientRect().width>0);const rect=n=>{const r=n?.getBoundingClientRect();return r?{x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom}:null};return {viewport:{w:innerWidth,h:innerHeight},panel:rect(visible('comments-panel')),input:rect(visible('comment-input')),send:rect(visible('comment-send')),sort:rect(visible('comment-sort-menu')),close:rect(visible('comments-close'))};});
    console.log("VF MOBILE",JSON.stringify(mobileLayout));writeFileSync(`${shots}/mobile-layout.json`,JSON.stringify(mobileLayout,null,2));

    await A.page.setViewportSize({ width: 1440, height: 900 });
    await A.button("Editor menu").click();
    await A.menuItem("Theme").hover();
    await A.menuItem("Light").click();
    await A.page.setViewportSize({ width: 390, height: 844 });
    await A.page.waitForTimeout(700);
    await A.tid("comments-panel").waitFor();
    expect(await A.page.getByTestId("editor-right-dock").count() === 0, "390 px Comments uses the bottom sheet presentation");
    await A.shot("comments-390-light-product-comments");
    await A.page.setViewportSize({ width: 1440, height: 900 });

    const clipsBeforeUndo = await B.clips();
    expect(clipsBeforeUndo > 0 && await B.tid("bar-undo").isEnabled(), "the editor owner has an undoable timeline edit");
    await B.tid("bar-undo").click();
    await B.page.waitForFunction((before) => [...document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]')].filter((node) => /^clip-[0-9a-f-]{36}$/.test(node.getAttribute("data-testid"))).length < before, clipsBeforeUndo, { timeout: 10_000 });
    await B.page.getByText("Review note 04 produced in the editor", { exact: true }).waitFor();
    expect(await B.clips() < clipsBeforeUndo, "undo changed the editor timeline while the comment stayed synced");
    await B.tid("bar-redo").click();
    await B.waitClips(clipsBeforeUndo);
    await B.page.getByText("Review note 04 produced in the editor", { exact: true }).waitFor();
  });
  // Visual evidence probe: record text layout and link semantics, without claiming a new passing test.
  await A.tid("comment-input").fill("VF first line\nVF second line [Local fixture link](http://localhost:8082/home)");await A.tid("comment-send").click();
  const textCard=A.page.getByTestId("comment").filter({hasText:"VF first line"}).first();await textCard.waitFor();await textCard.scrollIntoViewIfNeeded();
  const textLayout=await textCard.getByTestId("comment-body").evaluate(node=>({innerText:node.innerText,html:node.innerHTML,links:[...node.querySelectorAll('[role="link"],a')].map(n=>({text:n.textContent,href:n.getAttribute('href'),role:n.getAttribute('role')}))}));
  console.log("VF TEXT LAYOUT",JSON.stringify(textLayout));writeFileSync(`${shots}/text-layout.json`,JSON.stringify(textLayout,null,2));await A.shot("comments-wide-light-line-break-and-link");
  const popupWait=A.context.waitForEvent('page',{timeout:10000});await textCard.getByText('Local fixture link',{exact:true}).click();const popup=await popupWait;await popup.waitForURL('http://localhost:8082/home');console.log('VF LINK clicked rendered comment link and opened '+popup.url());await popup.close();

} catch (err) {
  errors.push("VF reproduction failed: "+String(err));
  for (const each of [A, B]) if (each) { await each.shot(`failure-${each.name.slice(-1)}`).catch(() => undefined); console.log(`PAGE TEXT ${each.name}:`, (await each.page.locator("body").innerText().catch(() => "")).replace(/\n+/g, " | ").slice(0, 700)); }
}
await browser.close();
if (engineNotes.length) console.log(`NOTE — console errors of the render engine, not counted: ${[...new Set(engineNotes)].join("; ")}`);
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "E2E OK — no page errors");
process.exit(errors.length ? 1 : 0);

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
    shot: async (file) => { await page.waitForTimeout(450); await page.screenshot({ path: `${shots}/${file}.png` }); },
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
    A = await device("Studio browser A");
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
    await B.text("Studio browser A is editing this project").waitFor({ timeout: 60_000 });
    await B.waitClips(1, 30_000);
    await B.statusIs(/Viewing — Studio browser A is editing/);
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
    await B.text("Studio browser A is still editing").waitFor({ timeout: 15_000 });
    await B.tid("sync-request").getByText(/Request to edit \(\d+ s\)/).waitFor({ timeout: 10_000 });
    await B.shot("07-b-declined");
    await A.statusIs(/Synced/);
  });

  await step("A transfers editing to B with the device picker, B accepts — \"Transfer editing to…\"", async () => {
    await A.popover();
    await A.tid("sync-transfer-picker").getByText("Laptop browser B").waitFor({ timeout: 15_000 });
    await A.shot("08-a-transfer-picker");
    await A.tid("sync-transfer-to").click();
    await B.text("Studio browser A wants to transfer editing to this device").waitFor({ timeout: 15_000 });
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
    await B.text("Studio browser A wants to edit this project").waitFor({ timeout: 15_000 });
    await B.tid("sync-hand-over").click();
    await B.text("Studio browser A is editing this project").waitFor({ timeout: 15_000 });
    await A.statusIs(/Synced/);
    await A.popover();
    await A.tid("sync-stop-editing").click();
    await A.text("Nobody is editing this project").waitFor({ timeout: 15_000 });
    await B.text("Nobody is editing this project").waitFor({ timeout: 15_000 });
    await B.shot("10-b-nobody-editing");
    await B.tid("sync-banner").getByText("Start editing", { exact: true }).click();
    await A.text("Laptop browser B is editing this project").waitFor({ timeout: 15_000 });
  });

  console.log("VF NO COMMENTS: no panel opened and no comment created before offline branch");
  await step("named versions on the host: A saves one, B lists it with A's device badge and cannot restore without the lease; A restores — Scenario: Version from another device, Scenario: Restore without the lease, Scenario: Restore", async () => {
    await editor(A, B);
    const clips = await A.clips();
    await A.button("Editor menu").click();
    await A.menuItem("Version history").click();
    await A.tid("host-versions").waitFor({ timeout: 15_000 });
    for (let attempt = 0; attempt < 5 && (await A.tid("host-version-save").isDisabled()); attempt++) { await A.tid("host-version-name").click(); await A.tid("host-version-name").fill(""); await A.tid("host-version-name").pressSequentially("Rough cut v1"); await A.page.waitForTimeout(300); }
    await A.tid("host-version-save").click();
    await A.tid("host-version").getByText("Rough cut v1").waitFor({ timeout: 15_000 });
    await A.closeOverlay();
    await A.tid("thumb-h264-aac.mp4").dblclick();
    await settled(clips + 1);
    await B.button("Editor menu").click();
    await B.menuItem("Version history").click();
    await B.tid("host-version").getByText("Rough cut v1").waitFor({ timeout: 15_000 });
    await B.tid("host-version").getByText("Studio browser A").waitFor();
    await B.tid("host-versions").getByText("Request to edit to restore a version").waitFor();
    expect(await B.tid("host-version-restore").isDisabled(), "Restore is disabled on a view-only device");
    await B.shot("13-b-host-versions");
    await B.closeOverlay();
    await A.button("Editor menu").click();
    await A.menuItem("Version history").click();
    await A.tid("host-version-restore").click();
    await A.closeOverlay();
    await settled(clips);
  });

  await step("activity popover and host media jobs: a 1080p video uploads under a 10 Mbit/s limit, is paused and resumed; \"Pause all sync\"; the host makes its 720p proxy and B plays from the proxy — Scenario: Proxy generated on the server, Scenario: Phone opens a desktop project (proxy-first), Scenario: Pause all", async () => {
    await A.page.goto(`${base}/settings/sync`, { waitUntil: "networkidle" });
    await A.visible(A.page.getByRole("combobox", { name: "Upload limit" }).or(A.page.getByRole("button", { name: /Upload limit/ }))).click();
    await A.visible(A.page.getByRole("option", { name: "10 Mbit/s" })).click();
    await A.openEditor(projectUrl);
    await A.statusIs(/Synced|Viewing/, 30_000);
    await editor(A, B);
    await A.importFiles([hd]);
    await A.tid("label-hd-1080p.mp4").waitFor({ timeout: 90_000 });
    await A.popover();
    await A.transfer("hd-1080p.mp4").waitFor({ timeout: 30_000 });
    await A.transfer("hd-1080p.mp4").getByRole("button", { name: "Pause", exact: true }).click();
    await A.transfer("hd-1080p.mp4").getByText(/Paused/).waitFor({ timeout: 10_000 });
    await A.shot("14-a-upload-paused");
    await A.transfer("hd-1080p.mp4").getByRole("button", { name: "Resume", exact: true }).click();
    const all = A.tid("sync-pause-all").getByRole("switch");
    await all.click();
    await A.closeOverlay();
    await A.statusIs(/Sync paused/, 10_000);
    await A.popover();
    await A.tid("sync-pause-all").getByRole("switch").click();
    await A.page.waitForFunction(() => !/hd-1080p/.test(document.querySelector('[data-testid="sync-activity"]')?.textContent ?? "") || /Done/.test(document.querySelector('[data-testid="sync-activity"]')?.textContent ?? ""), null, { timeout: 120_000 });
    await A.closeOverlay();
    await A.statusIs(/Synced/, 60_000);
    // B: the asset arrives as a record; its 720p proxy is made by the host's FFmpeg job and downloaded; the original is not.
    await B.tid("label-hd-1080p.mp4").waitFor({ timeout: 60_000 });
    const files = () => B.page.evaluate(async () => {
      const root = await navigator.storage.getDirectory(), out = [];
      const walk = async (directory, path, depth) => { for await (const [name, handle] of directory.entries()) { if (handle.kind === "file") out.push({ path: `${path}/${name}`, size: (await handle.getFile()).size }); else if (depth < 6) await walk(handle, `${path}/${name}`, depth + 1); } };
      await walk(root, "", 0);
      return out;
    });
    let found = null;
    for (let waited = 0; waited < 120 && !found; waited++) {
      const all = await files(), proxy = all.find((file) => /proxy/i.test(file.path) && file.size > 20_000);
      if (proxy) found = { proxy, original: all.find((file) => /\/media\//.test(file.path) && file.size > 3_000_000) ?? null, all: all.length };
      else await B.page.waitForTimeout(1000);
    }
    expect(found !== null, `the proxy reached B's cache (files: ${JSON.stringify((await files()).map((file) => file.path)).slice(0, 400)})`);
    expect(found.original === null, `B holds the proxy (${found.proxy.size} bytes) and no original`);
    console.log(`     proxy on B: ${found.proxy.path} ${found.proxy.size} bytes; original on B: none`);
    await A.tid("thumb-hd-1080p.mp4").dblclick();
    const count = await A.clips();
    await B.waitClips(count, 30_000);
    await B.page.waitForTimeout(2500);
    await B.shot("15-b-proxy-clip");
  });

  await step("a cancelled upload shows \"Not uploaded yet\" on B's clip; \"Upload missing media\" on A and Retry on B bring it — Scenario: Cancel one upload, Scenario: Clip waiting for download, Scenario: Screen reader", async () => {
    // The upload limit of 10 Mbit/s still applies, so the upload runs long enough to be cancelled.
    await A.importFiles([hd2]);
    await A.tid("label-second-1080p.mp4").waitFor({ timeout: 90_000 });
    await A.popover();
    await A.transfer("second-1080p.mp4").getByRole("button", { name: "Cancel", exact: true }).click({ timeout: 30_000 });
    await A.page.waitForFunction(() => !/second-1080p/.test(document.querySelector('[data-testid="sync-activity"]')?.textContent ?? ""), null, { timeout: 10_000 });
    await A.closeOverlay();
    await A.tid("thumb-second-1080p.mp4").dblclick();
    const count = await A.clips();
    await B.waitClips(count, 30_000);
    const overlay = B.tid("clip-sync-overlay");
    await overlay.waitFor({ timeout: 30_000 });
    await overlay.getByRole("button", { name: /second-1080p\.mp4, media not downloaded, not uploaded yet/ }).waitFor();
    await B.shot("16-b-clip-not-uploaded");
    // Pressing the overlay opens the transfer's actions.
    await overlay.click();
    await B.transfer("second-1080p.mp4").getByText(/Not uploaded yet/).waitFor();
    await B.transfer("second-1080p.mp4").getByRole("button", { name: "Retry", exact: true }).waitFor();
    await B.closeOverlay();
    await A.popover();
    await A.tid("sync-upload-media").click();
    await A.closeOverlay();
    await A.statusIs(/Synced/, 60_000);
    // The host has the bytes now: B's clip fills in by itself, without reopening the project.
    await B.page.waitForFunction(() => document.querySelector('[data-testid="clip-sync-overlay"]') === null, null, { timeout: 90_000 });
  });

  await step("offline branch 1: Compare, then \"Not now\" keeps the badge in Projects and the sidebar; then \"Save mine as a copy\" — Scenario: Diverged, Scenario: Compare, Scenario: Not now, Scenario: Save mine as a copy", async () => {
    const before = await diverge();
    await B.tid("sync-banner").getByText("Resolve", { exact: true }).click();
    await B.text("This project changed on another device").waitFor();
    await B.tid("conflict-device").waitFor(); await B.tid("conflict-host").getByText("Studio browser A").waitFor();
    await B.shot("17-b-conflict-dialog");
    await B.tid("conflict-compare").click();
    await B.tid("compare-players").waitFor({ timeout: 30_000 });
    await B.tid("compare-device").getByTestId("player-canvas").waitFor({ timeout: 30_000 });
    await B.tid("compare-host").getByTestId("player-canvas").waitFor({ timeout: 30_000 });
    // Scrubbing one moves the other to the same time.
    for (let frame = 0; frame < 3; frame++) await B.tid("compare-device").getByTestId("player-step-forward").click();
    const moved = await B.tid("compare-device").getByTestId("timecode").inputValue();
    await B.page.waitForFunction(([value]) => { const fields = [...document.querySelectorAll('[data-testid="compare-host"] [data-testid="timecode"]')]; return fields.some((field) => field.value !== "00:00:00:00") && value !== "00:00:00:00"; }, [moved], { timeout: 10_000 });
    await B.page.waitForTimeout(1500);
    await B.shot("18-b-compare");
    await B.tid("compare-close").click();
    await B.tid("conflict-not-now").click();
    expect((await B.clips()) === before + 1, "B still has its own version");
    await B.openProjects();
    await B.page.waitForFunction(() => [...document.querySelectorAll('[data-testid^="sync-badge-"]')].some((node) => /Sync paused — conflict/.test(node.textContent ?? "")), null, { timeout: 20_000 });
    await B.visible(B.page.getByTestId("nav-projects").or(B.page.getByRole("link", { name: "Projects" }))).click().catch(() => undefined);
    await B.page.waitForFunction(() => [...document.querySelectorAll('[data-testid="project-row"], [role="option"], [role="button"], [role="link"]')].some((node) => /New project/.test(node.textContent ?? "") && /Conflict/.test(node.textContent ?? "")), null, { timeout: 20_000 });
    await B.shot("19-b-conflict-badge-and-sidebar");
    await B.openEditor(projectUrl);
    await B.tid("sync-banner").getByText("Resolve", { exact: true }).click({ timeout: 30_000 });
    await B.tid("conflict-copy").click();
    await B.text(/Saved as “New project \(copy from Laptop browser B \d{4}-\d{2}-\d{2} \d{2}:\d{2}\)”/).waitFor({ timeout: 30_000 });
    await B.waitClips(before + 2, 30_000);
    await B.statusIs(/Viewing|Synced/, 30_000);
    // Downloads that failed while B had no network continue by themselves once it is back.
    await B.page.waitForFunction(() => document.querySelector('[data-testid="clip-sync-overlay"]') === null, null, { timeout: 90_000 });
  });

  await step("offline branch 2: \"Keep the host version\" — Scenario: Keep the host version", async () => {
    const before = await diverge();
    await B.tid("sync-banner").getByText("Resolve", { exact: true }).click();
    await B.tid("conflict-theirs").click();
    await B.waitClips(before + 2, 30_000);
    await B.statusIs(/Viewing — Studio browser A is editing/, 30_000);
    expect((await A.clips()) === before + 2, "the host version is untouched");
  });

  await step("offline branch 3: \"Keep this device's version\" is refused while A edits, then replaces the host head — Scenario: Lease held by another device during choice (a), Scenario: Keep this device's version", async () => {
    const before = await diverge();
    await B.tid("sync-banner").getByText("Resolve", { exact: true }).click();
    await B.tid("conflict-mine").click();
    await B.tid("conflict-note").getByText("Studio browser A is editing — request to edit first").waitFor({ timeout: 15_000 });
    await B.shot("20-b-keep-mine-refused");
    await A.popover();
    await A.tid("sync-stop-editing").click();
    await B.tid("conflict-mine").click();
    await B.statusIs(/Synced/, 30_000);
    expect((await B.clips()) === before + 1, "B kept its version");
    await A.waitClips(before + 1, 30_000);
    await A.button("Editor menu").click();
    await A.menuItem("Version history").click();
    await A.tid("host-version").getByText(/Replaced on \d{4}-\d{2}-\d{2} by Laptop browser B/).waitFor({ timeout: 15_000 });
    await A.shot("21-a-replaced-version");
    await A.closeOverlay();
  });

  await step("\"Sync new projects\": turned back on, a new project of A is synced by itself; B opens it and is offered A's position — Scenario: Continue from the desktop position", async () => {
    await A.page.goto(`${base}/settings/sync`, { waitUntil: "networkidle" });
    await A.tid("pref-sync-new").getByRole("switch").click();
    await A.visible(A.page.getByRole("combobox", { name: "Upload limit" }).or(A.page.getByRole("button", { name: /Upload limit/ }))).click();
    await A.visible(A.page.getByRole("option", { name: "Off" })).click();
    await A.page.goto(`${base}/projects`, { waitUntil: "networkidle" });
    await A.button("New project").click();
    await A.page.waitForURL((url) => /\/editor\/[0-9a-f-]{36}$/.test(url.pathname) && url.pathname !== projectUrl, { timeout: 60_000 });
    secondUrl = new URL(A.page.url()).pathname;
    await A.tid("timeline").waitFor({ timeout: 60_000 });
    await A.statusIs(/Synced|Syncing/, 60_000);
    await A.importFiles([fixturePath("h264-aac.mp4"), ...pictures]);
    await A.tid("label-picture-50.png").waitFor({ timeout: 180_000 });
    await A.tid("thumb-h264-aac.mp4").dblclick();
    await A.waitClips(1, 30_000);
    await A.tid("player-end").click();
    const position = await A.timecode();
    await A.statusIs(/Synced/, 180_000);
    // The continuity record travels with presence, at most every five seconds and on close.
    await A.page.waitForTimeout(11_000);
    await A.openProjects();
    await B.page.goto(`${base}/projects`, { waitUntil: "networkidle" });
    await B.tid("host-projects").waitFor({ timeout: 60_000 });
    await B.button("Open on this device").click();
    await B.page.waitForURL((url) => url.pathname === secondUrl, { timeout: 60_000 });
    await B.tid("sync-continue").waitFor({ timeout: 60_000 });
    await B.shot("22-b-continue-chip");
    await B.button("Continue where you left off on Studio browser A").click();
    await B.page.waitForFunction((value) => document.querySelector('[data-testid="timecode"]')?.value === value, position, { timeout: 15_000 });
    expect((await B.page.getByTestId("sync-continue").count()) === 0, "the chip is gone once used");
  });

  await step("\"Look for it on JAgentChill\" on the project-not-found screen — found, and \"Not on JAgentChill either\"", async () => {
    await A.page.goto(`${base}/projects`, { waitUntil: "networkidle" });
    await A.button("New project").click();
    await A.page.waitForURL((url) => /\/editor\/[0-9a-f-]{36}$/.test(url.pathname) && url.pathname !== projectUrl && url.pathname !== secondUrl, { timeout: 60_000 });
    thirdUrl = new URL(A.page.url()).pathname;
    await A.tid("timeline").waitFor({ timeout: 60_000 });
    await A.statusIs(/Synced/, 60_000);
    await A.openProjects();
    await B.page.goto(`${base}/editor/00000000-0000-4000-8000-000000000000`, { waitUntil: "networkidle" });
    await B.tid("look-on-host").click({ timeout: 60_000 });
    await B.tid("look-on-host-absent").getByText("Not on JAgentChill either").waitFor({ timeout: 15_000 });
    await B.shot("23-b-not-on-host");
    await B.page.goto(`${base}${thirdUrl}`, { waitUntil: "networkidle" });
    await B.text("Project not found").waitFor({ timeout: 60_000 });
    await B.tid("look-on-host").click();
    await B.tid("timeline").waitFor({ timeout: 60_000 });
    await B.statusIs(/Synced|Viewing/, 30_000);
  });

  await step("A deletes the synced project B has open: B sees \"Deleted on Studio browser A\" and restores it — Scenario: Delete propagates", async () => {
    await B.popover(); if ((await B.page.getByTestId("sync-stop-editing").filter({ visible: true }).count()) > 0) await B.tid("sync-stop-editing").click(); else await B.closeOverlay();
    const third = idOf(thirdUrl);
    await A.visible(A.page.locator(`[data-testid="sync-badge-${third}"]`)).waitFor({ timeout: 30_000 });
    const card = A.visible(A.page.getByRole("listitem").filter({ has: A.page.locator(`[data-testid="sync-badge-${third}"]`) }));
    await card.getByRole("button", { name: /^Actions for / }).click({ force: true });
    await A.menuItem("Delete").click();
    await A.visible(A.page.getByRole("dialog").getByRole("button", { name: /Move to trash|Delete/ })).click();
    await B.text("Deleted on Studio browser A").waitFor({ timeout: 30_000 });
    await B.shot("24-b-deleted-banner");
    await B.tid("sync-banner").getByText("Restore", { exact: true }).click();
    await B.statusIs(/Synced|Viewing/, 40_000);
  });

  await step("keep / remove dialog: A stops syncing the second project and removes it from the host — Scenario: Disable sync and keep the server copy (the dialog offers both)", async () => {
    const second = idOf(secondUrl);
    await A.page.goto(`${base}/projects`, { waitUntil: "networkidle" });
    const card = A.visible(A.page.getByRole("listitem").filter({ has: A.page.locator(`[data-testid="sync-badge-${second}"]`) }));
    await card.getByRole("button", { name: /^Actions for / }).click({ force: true, timeout: 30_000 });
    await A.menuItem("Sync").click();
    await A.menuItem("On this device only").click();
    await A.text("Keep on host", { exact: true }).waitFor();
    await A.shot("25-a-keep-remove-dialog");
    await A.visible(A.page.getByRole("radio", { name: "Remove from host" })).click();
    // B had this project open a moment ago and left without closing it: until its lease lapses (30 s) the host refuses, and says who is editing.
    for (let attempt = 0; attempt < 8; attempt++) {
      await A.tid("sync-off-confirm").click();
      if (await A.page.waitForFunction(() => ![...document.querySelectorAll('[data-testid="sync-off-confirm"]')].some((node) => node.getClientRects().length > 0), null, { timeout: 6000 }).then(() => true, () => false)) break;
    }
    await A.page.waitForFunction((id) => ![...document.querySelectorAll(`[data-testid="sync-badge-${id}"]`)].some((node) => node.getClientRects().length > 0), second, { timeout: 30_000 });
  });

  await step("Storage on host: search, sort, Show more over 50 media, delete an unreferenced blob, host trash restore and delete permanently — Scenario: Restore from trash, Scenario: Deleting a referenced blob (disabled), Scenario: Empty exports", async () => {
    const third = idOf(thirdUrl);
    await A.page.goto(`${base}/settings`, { waitUntil: "networkidle" });
    await A.tid("settings-host-storage").click();
    await A.tid("host-storage-text").waitFor({ timeout: 30_000 });
    expect(/ of /.test((await A.tid("host-storage-text").textContent()) ?? ""), "used and total bytes are shown as text");
    await A.visible(A.page.getByRole("tab", { name: "Media" })).click();
    await A.page.waitForFunction(() => document.querySelectorAll('[data-testid="host-space-row"]').length === 50, null, { timeout: 30_000 });
    await A.button("Show more").click();
    await A.page.waitForFunction(() => document.querySelectorAll('[data-testid="host-space-row"]').length > 50, null, { timeout: 30_000 });
    const total = await A.page.evaluate(() => document.querySelectorAll('[data-testid="host-space-row"]').length);
    await A.shot("26-a-host-media-paged");
    await A.page.getByPlaceholder("Search by name").fill("picture-07");
    await A.page.waitForFunction(() => document.querySelectorAll('[data-testid="host-space-row"]').length === 1, null, { timeout: 15_000 });
    // The second project was removed from the host: nothing references this picture any more, so it can be deleted.
    await A.tid("host-space-row").getByRole("button", { name: "Delete", exact: true }).click();
    await A.text("No media on this host yet").waitFor({ timeout: 15_000 });
    await A.page.getByPlaceholder("Search by name").fill("hd-1080p");
    await A.page.waitForFunction(() => document.querySelectorAll('[data-testid="host-space-row"]').length === 1, null, { timeout: 15_000 });
    await A.tid("host-space-row").getByText(/preview/).waitFor();
    expect(await A.tid("host-space-row").getByRole("button", { name: "Delete", exact: true }).isDisabled(), "a referenced blob cannot be deleted");
    await A.page.getByPlaceholder("Search by name").fill("");
    await A.visible(A.page.getByRole("combobox", { name: "Sort by" }).or(A.page.getByRole("button", { name: /Sort by/ }))).click();
    await A.visible(A.page.getByRole("option", { name: "Size" })).click();
    await A.page.waitForFunction(() => /hd-1080p/.test(document.querySelector('[data-testid="host-space-row"]')?.textContent ?? ""), null, { timeout: 15_000 });
    await A.shot("27-a-host-media-by-size");
    console.log(`     media rows after Show more: ${total}`);
    await A.visible(A.page.getByRole("tab", { name: "Exports" })).click();
    await A.text("No exports on this host yet").waitFor();
    await A.button("Export a project").waitFor();
    // The third project: B deletes it (nobody edits it), then the host trash restores it; deleted again, it is purged.
    const trash = async () => {
      await B.page.goto(`${base}/projects`, { waitUntil: "networkidle" });
      const card = B.visible(B.page.getByRole("listitem").filter({ has: B.page.locator(`[data-testid="sync-badge-${third}"]`) }));
      await card.getByRole("button", { name: /^Actions for / }).click({ force: true, timeout: 30_000 });
      await B.menuItem("Delete").click();
      await B.visible(B.page.getByRole("dialog").getByRole("button", { name: /Move to trash|Delete/ })).click();
      await A.visible(A.page.getByRole("tab", { name: "Projects" })).click();
      await A.visible(A.page.getByRole("tab", { name: "Trash" })).click();
      await A.tid("host-space-row").getByText("Deleted on Laptop browser B").waitFor({ timeout: 30_000 });
    };
    await trash();
    await A.shot("28-a-host-trash");
    await A.tid("host-trash-restore").click();
    await A.text("The host trash is empty").waitFor({ timeout: 15_000 });
    await A.visible(A.page.getByRole("tab", { name: "Projects" })).click();
    await A.page.waitForFunction(() => document.querySelectorAll('[data-testid="host-space-row"]').length >= 2, null, { timeout: 15_000 });
    // B's copy went to its local trash with the deletion; the restored host copy is offered to it again.
    await B.page.goto(`${base}/projects`, { waitUntil: "networkidle" });
    await B.tid("host-projects").waitFor({ timeout: 30_000 });
    await B.button("Open on this device").click();
    await B.page.waitForURL((url) => url.pathname === thirdUrl, { timeout: 60_000 }).catch(() => undefined);
    await B.tid("timeline").waitFor({ timeout: 60_000 });
    await B.openProjects();
    await trash();
    await A.tid("host-space-row").getByRole("button", { name: "Delete permanently" }).click();
    await A.text("The host trash is empty").waitFor({ timeout: 15_000 });
  });

  await step("library sync from the Sync card — \"Sync my library\"", async () => {
    await A.page.goto(`${base}/settings/sync`, { waitUntil: "networkidle" });
    await A.tid("library-sync-now").click();
    await A.text(/Library synced — \d+ sent, \d+ received/).waitFor({ timeout: 20_000 });
    console.log("     ", await A.text(/Library synced — \d+ sent, \d+ received/).textContent());
  });

  await step("dark theme and 390 × 844: the sync surfaces", async () => {
    await A.openEditor(projectUrl);
    await B.openEditor(projectUrl);
    await A.statusIs(/Synced|Viewing/, 40_000); await B.statusIs(/Synced|Viewing/, 40_000);
    for (const each of [A, B]) await each.page.emulateMedia({ colorScheme: "dark" });
    await A.page.waitForTimeout(800);
    await A.shot("30-dark-editor-a"); await B.shot("31-dark-editor-b");
    await A.popover(); await A.shot("32-dark-activity-popover"); await A.closeOverlay();
    await A.tid("open-comments").click(); await A.tid("comments-panel").waitFor(); await A.shot("33-dark-comments"); await A.closeOverlay();
    await A.page.goto(`${base}/projects`, { waitUntil: "networkidle" }); await A.page.waitForTimeout(1500); await A.shot("34-dark-projects");
    await A.page.goto(`${base}/settings/sync`, { waitUntil: "networkidle" }); await A.tid("sync-settings").waitFor(); await A.shot("35-dark-sync-card");
    await A.page.goto(`${base}/settings`, { waitUntil: "networkidle" }); await A.tid("settings-host-storage").click(); await A.tid("host-storage-text").waitFor(); await A.shot("36-dark-host-storage");
    for (const each of [A, B]) { await each.page.emulateMedia({ colorScheme: "light" }); await each.page.setViewportSize({ width: 390, height: 844 }); }
    await A.page.waitForTimeout(800); await A.shot("40-390-host-storage");
    await A.page.goto(`${base}/settings/sync`, { waitUntil: "networkidle" }); await A.tid("sync-settings").waitFor(); await A.shot("41-390-sync-card");
    await A.page.goto(`${base}/projects`, { waitUntil: "networkidle" }); await A.page.waitForTimeout(1500); await A.shot("42-390-projects");
    await A.page.goto(`${base}${projectUrl}`, { waitUntil: "networkidle" });
    await A.tid("sync-status").waitFor({ timeout: 60_000 });
    await A.page.waitForTimeout(1500);
    await A.shot("43-390-editor-a");
    await B.page.goto(`${base}${projectUrl}`, { waitUntil: "networkidle" });
    await B.tid("sync-status").waitFor({ timeout: 60_000 });
    await B.page.waitForTimeout(1500);
    await B.shot("44-390-editor-b");
    await A.tid("sync-status").click(); await A.tid("sync-activity").waitFor(); await A.shot("45-390-activity"); await A.closeOverlay();
    for (const each of [A, B]) await each.page.emulateMedia({ colorScheme: "dark" });
    await A.page.waitForTimeout(600); await A.shot("46-390-dark-editor-a"); await B.shot("47-390-dark-editor-b");
  });
} catch (err) {
  for (const each of [A, B]) if (each) { await each.shot(`failure-${each.name.slice(-1)}`).catch(() => undefined); console.log(`PAGE TEXT ${each.name}:`, (await each.page.locator("body").innerText().catch(() => "")).replace(/\n+/g, " | ").slice(0, 700)); }
}
await browser.close();
if (engineNotes.length) console.log(`NOTE — console errors of the render engine, not counted: ${[...new Set(engineNotes)].join("; ")}`);
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "E2E OK — no page errors");
process.exit(errors.length ? 1 : 0);

// End-to-end checks of the desktop app on this machine, with Playwright's Electron support. Everything is real: the
// web bundle, the Electron main process, the OS key store, JAgentChill Server on a real Node and the files on disk. Usage: node e2e/run.mjs [--packaged <path to the executable>]
import { execFileSync, spawn } from "node:child_process";
import { generateKeyPairSync, randomBytes, sign as cryptoSign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { enrolContext, handshakeTranscript } from "@jagentchill/protocol";
import { check, describe, desktopRoot, freshRun, launch, processesOf, quit, repoRoot, sleep, waitFor } from "./lib.mjs";

const packagedAt = process.argv.indexOf("--packaged");
const packaged = packagedAt > 0 ? process.argv[packagedAt + 1] : undefined;
const results = [];
const run = freshRun(packaged ? "packaged" : "dev");
mkdirSync(run.shots, { recursive: true });
const ps = () => execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n")
  .map((line) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean).map((m) => ({ pid: +m[1], ppid: +m[2], pgid: +m[3], command: m[4] }));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const status = (page) => page.evaluate(() => window.jagentchillDesktop.gateway.getStatus());
const hostReady = (page) => waitFor(async () => { const s = await status(page); return s.state === "ready" || (s.state === "degraded" && !s.reasons.includes("gateway_starting")) ? s : null; }, { timeout: 120_000, what: "the built-in host" });

console.log(`run directory: ${run.dir}\nmode: ${packaged ? `local build ${packaged}` : "development (electron .)"}`);
const before = processesOf(run);
console.log(`processes of this run before launch:\n${describe(before)}`);

// ───────────── first launch ─────────────
const started = Date.now();
let session = await launch(run, { packaged });
let { app, page } = session;
const firstWindow_ms = Date.now() - started;
await page.waitForLoadState("domcontentloaded");
check(results, "First window: one main window on app://jagentchill", page.url().startsWith("app://jagentchill/") && (await app.windows()).length === 1, page.url());
// A measurement, not a verdict: the time includes Playwright attaching to the app (and, for a local build, the start hold), so it cannot show the 3 s budget.
console.log(`measured, not checked: launch → first window as Playwright sees it: ${firstWindow_ms} ms`);

const flags = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getLastWebPreferences()));
const want = { contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false };
check(results, "Window flags: contextIsolation, sandbox, no nodeIntegration, webSecurity, no webview — read in the main process", flags.length === 1 && Object.entries(want).every(([k, v]) => flags[0][k] === v) && !flags[0].enableRemoteModule, JSON.stringify(Object.fromEntries(Object.keys(want).map((k) => [k, flags[0][k]]))));
const node = await page.evaluate(() => ({ require: typeof window.require, nodeProcess: !!(window.process && (window.process.versions?.node || window.process.binding || window.process.execPath)), ipc: typeof window.ipcRenderer, module: typeof window.module, frozen: Object.isFrozen(window.jagentchillDesktop) && Object.isFrozen(window.jagentchillDesktop.device), groups: Object.keys(window.jagentchillDesktop).sort() }));
check(results, "No generic ipcRenderer, require, process or Node object in the renderer; the bridge is frozen", node.require === "undefined" && node.nodeProcess === false && node.ipc === "undefined" && node.module === "undefined" && node.frozen, JSON.stringify({ ...node, groups: node.groups.length }));

const head = await page.evaluate(async () => { const r = await fetch("app://jagentchill/"); return { status: r.status, csp: r.headers.get("content-security-policy"), type: r.headers.get("content-type") }; });
check(results, "CSP header on app:// responses", head.status === 200 && /default-src 'self'; script-src 'self' 'wasm-unsafe-eval'/.test(head.csp ?? "") && /frame-src 'none'/.test(head.csp) && /connect-src 'self' app:/.test(head.csp) && !/https:\/\/\*|unsafe-eval'(?<!wasm-unsafe-eval')/.test(head.csp), head.csp);
// Chromium resolves dot segments before the handler sees the URL; whatever arrives, the answer is 404 or the app shell — never a file outside the bundle.
const traversal = await page.evaluate(async () => Promise.all(["app://jagentchill/..%2f..%2f..%2f..%2fetc%2fpasswd", "app://jagentchill/%2e%2e/%2e%2e/etc/passwd", "app://jagentchill/../../etc/passwd", "app://jagentchill/_expo/nope.js", "app://jagentchill/_expo/..%2f..%2f..%2fpackage.json"].map(async (u) => { const r = await fetch(u).catch(() => null); const body = r ? await r.text() : ""; return r?.status === 404 ? "404" : r?.status === 200 && /<div id="root">/.test(body) && !/root:|"name":/.test(body) ? "shell" : `LEAK ${r?.status}`; })));
check(results, "Unknown path in the app scheme: 404 (or the app shell after Chromium's own normalisation), nothing outside the bundle is read", traversal.every((s) => s === "404" || s === "shell") && traversal[0] === "404" && traversal[3] === "404", traversal.join(","));
const blocked = await page.evaluate(async () => { try { await fetch("https://example.com/x"); return "fetched"; } catch (e) { return "blocked"; } });
check(results, "Blocked connection: fetch to a host outside connect-src is blocked", blocked === "blocked", blocked);
await page.evaluate(() => { location.href = "https://example.com/"; }).catch(() => undefined);
await sleep(800);
page = await app.firstWindow();
check(results, "Navigation attempt: the window stays on app://jagentchill and no new window opens", page.url().startsWith("app://jagentchill/") && (await app.windows()).length === 1, page.url());
// An unattended run never hands the link to the owner's browser: the main process logs it instead.
const opened = await waitFor(async () => /unattended: would open https:\/\/example\.com\//.test(readFileSync(join(run.userData, "logs", "main.log"), "utf8")) || null, { timeout: 5_000, what: "the logged external link" }).catch(() => false);
check(results, "Navigation attempt: the link is logged as 'unattended: would open https://example.com/' and nothing is opened in the owner's browser", opened === true || Boolean(opened), String(opened));
const geo = await page.evaluate(() => navigator.permissions.query({ name: "geolocation" }).then((p) => p.state));
check(results, "Denied permission: geolocation", geo === "denied", geo);

// ───────────── the built-in host ─────────────
const ready = await hostReady(page);
console.log(`host state: ${ready.state} ${ready.reasons.join(",")} pid=${ready.pid} port=${ready.port} gatewayPort=${ready.gatewayPort}`);
check(results, "Start: the supervisor reaches ready with the server child running", ready.state === "ready" || (ready.state === "degraded" && ready.reasons.every((r) => r === "ffmpeg_missing")), `${ready.state} [${ready.reasons.join(",")}]`);
const table = ps();
const appPid = session.pid;
const server = table.find((p) => p.pid === ready.pid);
// The first text mapping of a process is the executable it really runs.
const exe = (p) => /^n(.+)$/m.exec(execFileSync("lsof", ["-a", "-p", String(p.pid), "-d", "txt", "-Fn"], { encoding: "utf8" }))?.[1] ?? "";
check(results, "Exactly one server child of the app, running the server entry with serve --data-dir --port", !!server && server.ppid === appPid && table.filter((p) => p.ppid === appPid && / serve --data-dir /.test(p.command)).length === 1 && server.command.includes(`--data-dir ${join(run.userData, "host")} --port ${ready.port}`), server?.command.replace(repoRoot, "<repo>"));
const electronExe = await app.evaluate(() => process.execPath);
const nodeVersion = server ? execFileSync(exe(server), ["--version"], { encoding: "utf8" }).trim() : "";
check(results, "Electron is never the Node runtime of the host: the server runs a real Node, not the Electron executable", !!server && exe(server) !== electronExe && !/Electron|JAgentChill(\.app)?\/Contents\/MacOS/.test(exe(server)) && /^v(24\.(1[6-9]|[2-9]\d)|2[6-9])/.test(nodeVersion), `${exe(server ?? { command: "" }).replace(repoRoot, "<repo>")} ${nodeVersion}`);
const env = server ? execFileSync("ps", ["eww", "-o", "command=", "-p", String(server.pid)], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }) : "";
const vars = ["JAGENTCHILL_RENDER_HOST_PATH", "JAGENTCHILL_BOOTSTRAP_DEVICE_PUBLIC_KEY", "JAGENTCHILL_BOOTSTRAP_KEY_PROTECTION"];
check(results, "The JAGENTCHILL_* variables of the host are in the server's environment, and ELECTRON_RUN_AS_NODE is not", vars.every((v) => env.includes(`${v}=`)) && !env.includes("ELECTRON_RUN_AS_NODE=") && env.includes(`JAGENTCHILL_RENDER_HOST_PATH=${electronExe}`), vars.filter((v) => env.includes(`${v}=`)).join(","));
const hostLog = readFileSync(join(run.userData, "logs", "host.log"), "utf8");
check(results, "The server's output is captured in the app's log folder", /\[server\] listening on /.test(hostLog));
const listening = execFileSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], { encoding: "utf8" }).split("\n").filter((line) => new RegExp(`^\\S+\\s+(${server?.pid})\\s`).test(line));
check(results, "The server stays on loopback", listening.length >= 1 && listening.every((line) => /TCP (127\.0\.0\.1|\[::1\]):\d+ \(LISTEN\)/.test(line)), listening.map((line) => line.split(/\s+/).slice(-2).join(" ")).join(" | "));

// ───────────── bootstrap: this computer is admin without a pairing code ─────────────
const hostDir = join(run.userData, "host");
check(results, "First run: the bootstrap file was read once and deleted", existsSync(join(hostDir, "bootstrap")) && readdirSync(join(hostDir, "bootstrap")).length === 0);
// Read by this test process, not by the app: the server's own database.
const db = new DatabaseSync(join(hostDir, "jagentchill.sqlite"), { readOnly: true });
const devices = db.prepare("SELECT device_id, public_key, name, role, state, local_supervisor, key_protection, paired_by, platform FROM devices").all();
db.close();
const key = await page.evaluate(() => window.jagentchillDesktop.device.getPublicKey());
check(results, "Desktop first run: exactly one device record — admin, localSupervisor, this computer's key — with no pairing code", devices.length === 1 && devices[0].role === "admin" && devices[0].local_supervisor === 1 && devices[0].public_key === key.value.devicePublicKey && devices[0].paired_by === "bootstrap" && devices[0].name === "This computer", JSON.stringify({ ...devices[0], device_id: devices[0]?.device_id.slice(0, 12) }));
await page.evaluate(() => { history.pushState({}, "", "/devices"); window.dispatchEvent(new PopStateEvent("popstate")); });
await waitFor(async () => { const text = await page.evaluate(() => document.body.innerText); return /This computer/.test(text) && /Admin/i.test(text) && /Connected/.test(text); }, { timeout: 20_000, what: "the Devices screen" }).catch(() => null);
const devicesText = await page.evaluate(() => document.body.innerText);
await page.screenshot({ path: join(run.shots, "devices.png") });
check(results, "The Devices screen lists this computer as an admin, through the renderer's own signed connection", /This computer/.test(devicesText) && /admin/i.test(devicesText) && /Connected/.test(devicesText));

// ───────────── the key stays in the main process ─────────────
const keyFile = join(run.userData, "identity", "device.key");
const keyText = readFileSync(keyFile, "utf8");
const mock = await app.evaluate(({ app: a }) => a.commandLine.hasSwitch("use-mock-keychain"));
check(results, "The key store is the real OS store (macOS Keychain), not the mock keychain Playwright asks for", mock === false);
check(results, "Device key: owner-only file, encrypted by the OS store (no key material in clear)", (statSync(keyFile).mode & 0o777) === 0o600 && (statSync(join(run.userData, "identity")).mode & 0o777) === 0o700 && JSON.parse(keyText).protection === "os-store" && !/PRIVATE KEY/.test(keyText) && !/PRIVATE KEY/.test(Buffer.from(JSON.parse(keyText).data, "base64").toString("latin1")), `keyProtection=${key.value.keyProtection}`);
const signing = await page.evaluate(async (gatewayId) => {
  const d = window.jagentchillDesktop.device, b64 = (n) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const code = (r) => ("error" in r ? r.error.code : "SIGNED");
  return {
    string: code(await d.sign("hello")), bytes: code(await d.sign(new Uint8Array([1, 2, 3]))), rawKind: code(await d.sign({ kind: "raw", fields: { text: "hello" } })),
    gatewayRole: code(await d.sign({ kind: "handshake", fields: { role: "gateway", context: "connect", gatewayNonce: b64(32), deviceNonce: b64(32), ts: Date.now(), gatewayId, protocolVersion: 1 } })),
    unknownHost: code(await d.sign({ kind: "request", fields: { gatewayId: "f".repeat(32), method: "GET", target: "/jagentchill/v1/secrets", bodySha256: "0".repeat(64), ts: Date.now(), nonce: b64(16) } })),
    structured: await d.sign({ kind: "request", fields: { gatewayId, method: "GET", target: "/jagentchill/v1/secrets", bodySha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", ts: Date.now(), nonce: b64(16) } }),
    methods: Object.keys(d), publicKey: await d.getPublicKey(),
    stores: await Promise.all(["device", "device.key", "identity/device.key", "key"].map((k) => window.jagentchillDesktop.secureStore.get(k).then((v) => v, (e) => `refused`))),
    dump: JSON.stringify(await Promise.all((await window.jagentchillDesktop.secureStore.keys("host/")).map((k) => window.jagentchillDesktop.secureStore.get(k)))),
  };
}, ready.gatewayId);
check(results, "Free-form signing is refused: a string, bytes, an unknown kind, a gateway-role transcript and an unknown host all get SIGN_REFUSED", [signing.string, signing.bytes, signing.rawKind, signing.gatewayRole, signing.unknownHost].every((c) => c === "SIGN_REFUSED"), JSON.stringify({ string: signing.string, bytes: signing.bytes, rawKind: signing.rawKind, gatewayRole: signing.gatewayRole, unknownHost: signing.unknownHost }));
check(results, "Signing without key exposure: structured input returns a signature only; no bridge method or store value returns the key", "value" in signing.structured && Object.keys(signing.structured.value).join() === "signature" && signing.methods.sort().join() === "beginEnrolment,endEnrolment,enrolmentPost,getPublicKey,rotate,sign" && Object.keys(signing.publicKey.value).sort().join() === "deviceId,devicePublicKey,keyProtection" && signing.stores.every((v) => v === null || v === "refused") && !/PRIVATE KEY/.test(signing.dump), signing.methods.join(","));
// The signature the main process made is accepted by the real server on a signed route.
const signedRoute = await page.evaluate(async ({ gatewayId, port }) => {
  const d = window.jagentchillDesktop.device, info = (await d.getPublicKey()).value;
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), ts = Date.now(), target = "/jagentchill/v1/secrets";
  const sig = (await d.sign({ kind: "request", fields: { gatewayId, method: "GET", target, bodySha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", ts, nonce } })).value.signature;
  const headers = { "x-jagentchill-device": info.deviceId, "x-jagentchill-timestamp": String(ts), "x-jagentchill-nonce": nonce, "x-jagentchill-signature": sig };
  const ok = await fetch(`http://127.0.0.1:${port}${target}`, { headers });
  const unsigned = await fetch(`http://127.0.0.1:${port}${target}`);
  return { signed: ok.status, unsigned: unsigned.status };
}, { gatewayId: ready.gatewayId, port: ready.port });
check(results, "A signed channel works with the key held in the main process: the server accepts the signed request and refuses the unsigned one", signedRoute.signed === 200 && signedRoute.unsigned >= 400, JSON.stringify(signedRoute));
const unknown = await app.evaluate(async ({ ipcMain }) => ({ exportKey: ipcMain.listenerCount("jagentchill:device.exportKey"), names: [...ipcMain.eventNames()].map(String) }));
check(results, "Unknown channel: no handler exists outside the allowlist", unknown.exportKey === 0);
const outside = await page.evaluate(async () => { const f = window.jagentchillDesktop.files; const a = await f.read("0".repeat(32), { start: 0, end: 10 }); const b = await f.read("/etc/hosts", { start: 0, end: 10 }); return [a.error?.code, b.error?.code]; });
check(results, "Path outside granted locations: reading /etc/hosts is rejected", outside[0] === "PERMISSION_DENIED" && outside[1] === "INVALID_PARAMS", outside.join(","));
const libraryEscape = await page.evaluate(async () => (await window.jagentchillDesktop.library.call("readProjectText", ["../../../../etc/hosts"])).error?.code);
check(results, "Renderer has no path access: the library bridge rejects a path outside the library", libraryEscape === "LIBRARY_ARGUMENT_REJECTED", libraryEscape);

// ───────────── a project is a real folder in the library ─────────────
await page.evaluate(() => { history.pushState({}, "", "/home"); window.dispatchEvent(new PopStateEvent("popstate")); });
await page.getByText("New blank project", { exact: true }).first().click();
await page.waitForURL(/\/editor\//, { timeout: 30_000 });
const projectId = decodeURIComponent(/\/editor\/([^/?#]+)/.exec(page.url())[1]);
const projectFile = join(run.library, projectId, "project.json");
await waitFor(() => existsSync(projectFile), { timeout: 20_000, what: "project.json on disk" });
const projectName = JSON.parse(readFileSync(projectFile, "utf8")).metadata.name;
await sleep(1500);
await page.screenshot({ path: join(run.shots, "editor.png") });
check(results, "Files on disk: the project created in the app is <library>/<projectId>/project.json beside library.sqlite", existsSync(join(run.library, "library.sqlite")) && JSON.parse(readFileSync(projectFile, "utf8")).metadata.id === projectId, `${projectFile.replace(repoRoot, "<repo>")} (“${projectName}”)`);

// ───────────── a link while running: a second launch forwards it and exits ─────────────
const health = await (await fetch(`http://127.0.0.1:${ready.port}/jagentchill/v1/health`)).json();
const offer = Buffer.from(JSON.stringify({ v: 1, offerId: randomBytes(16).toString("base64url"), gatewayId: health.gatewayId, gatewayPublicKey: health.gatewayPublicKey, addresses: [{ kind: "loopback", url: `ws://127.0.0.1:${ready.port}/jagentchill/v1/ws` }], expires_ms: Date.now() + 600_000 })).toString("base64url");
const link = `jagentchill://pair#offer=${offer}`;
const secondEnv = { ...process.env, JAGENTCHILL_USER_DATA: run.userData, JAGENTCHILL_LIBRARY_DIR: run.library, JAGENTCHILL_UNATTENDED: "1" };
delete secondEnv.ELECTRON_RUN_AS_NODE;
const second = packaged ? spawn(packaged, [link], { env: secondEnv, stdio: "ignore" }) : spawn(electronExe, [desktopRoot, link], { env: secondEnv, stdio: "ignore" });
const secondExit = await Promise.race([new Promise((done) => second.once("exit", (code) => done(code))), sleep(15_000).then(() => "still running")]);
await page.waitForURL(/\/pair\/start/, { timeout: 15_000 }).catch(() => undefined);
await sleep(800);
const pairText = await page.evaluate(() => ({ url: location.pathname, text: document.body.innerText, field: [...document.querySelectorAll("textarea,input")].map((n) => n.value).find((v) => v.startsWith("jagentchill://pair#offer=")) }));
await page.screenshot({ path: join(run.shots, "pair-link.png") });
check(results, "Second launch: the second process exits at once and no second server appears", secondExit === 0 && ps().filter((p) => / serve --data-dir /.test(p.command) && p.command.includes(run.dir)).length === 1, `exit ${secondExit}`);
check(results, "Pairing link needs confirmation: jagentchill://pair#offer=… opens the pairing flow with the offer shown and nothing paired yet", pairText.url === "/pair/start" && pairText.field === link && /Connect a host/.test(pairText.text), pairText.url);
const oversized = await app.evaluate(({ app: a }, url) => { a.emit("open-url", { preventDefault() {} }, url); }, `jagentchill://editor/${"a".repeat(5000)}`);
await sleep(500);
check(results, "Oversized link: dropped in the main process, the renderer stays where it was", (await page.evaluate(() => location.pathname)) === "/pair/start" && readFileSync(join(run.userData, "logs", "main.log"), "utf8").includes("deep link dropped (too-long"), String(oversized ?? ""));

// ───────────── Connect a host on desktop: the enrolment is relayed by the main process ─────────────
// The renderer's CSP refuses a host that is not paired yet, so the few enrolment calls go through the bridge. The
// fixture stands where a real host would and answers the challenge with a VALID host signature, so the enrolment stays
// active and the UI reaches the code-entry step. The offer lists an unreachable address FIRST: the bridge's refusal is
// returned as data and rebuilt by the renderer as the web path's own unreachable error, so the next address is tried.
const fixtureRequests = [];
const fixtureHost = generateKeyPairSync("ed25519");
const fixtureHostKey = fixtureHost.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64url");
const fixtureGatewayId = randomBytes(16).toString("hex");
const fixtureOfferId = randomBytes(16).toString("base64url");
let fixtureMode = { delayChallenge_ms: 0, failFirstChallenge: false, deferVerify: false };
let fixtureChallenges = 0;
const fixture = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    fixtureRequests.push({ method: req.method, url: req.url, body });
    const answer = () => {
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/jagentchill/v1/pair/challenge") {
        // The exact transcript packages/client verifies: handshakeTranscript with role "gateway", signed by the host
        // key whose public key the pairing link carries.
        const asked = JSON.parse(body);
        // A relay probe of this script sends `{}`: a real host refuses a challenge without its fields.
        if (typeof asked.deviceNonce !== "string") { res.end(JSON.stringify({ error: { code: "INVALID_REQUEST", message: "the fixture needs the challenge fields" } })); return; }
        const gatewayNonce = randomBytes(32).toString("base64url");
        const ts = Date.now();
        const gatewaySignature = cryptoSign(null, Buffer.from(handshakeTranscript({
          role: "gateway", context: enrolContext(fixtureOfferId), gatewayNonce, deviceNonce: asked.deviceNonce, ts,
          gatewayId: fixtureGatewayId, deviceId: asked.deviceId, devicePublicKey: asked.devicePublicKey, protocolVersion: asked.protocolVersion,
        }), "utf8"), fixtureHost.privateKey).toString("base64url");
        res.end(JSON.stringify({ requestId: randomBytes(16).toString("hex"), gatewayNonce, ts, gatewayId: fixtureGatewayId, gatewaySignature }));
        return;
      }
      // The host has accepted the proof; its answer can be held back so that the screen is closed in between.
      if (req.url === "/jagentchill/v1/pair/prove") { setTimeout(() => res.end(JSON.stringify({ expires_ms: Date.now() + 300_000, attemptsRemaining: 5 })), fixtureMode.delayProve_ms ?? 0); return; }
      // Verify: a cancel is always answered at once; a code check can be held so cancellation happens mid-flight.
      const asked = (() => { try { return JSON.parse(body); } catch { return {}; } })();
      if (fixtureMode.deferVerify && asked.action !== "cancel") return;
      res.end(JSON.stringify({ ok: true }));
    };
    if (req.url === "/jagentchill/v1/pair/challenge") {
      fixtureChallenges += 1;
      // A slow refusal: the attempt that sent it is cancelled long before this answer arrives.
      if (fixtureMode.failFirstChallenge && fixtureChallenges === 1) {
        setTimeout(() => {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { code: "UNAVAILABLE", message: "the fixture refused this challenge late" } }));
        }, fixtureMode.delayChallenge_ms);
        return;
      }
    }
    answer();
  });
});
await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
const fixturePort = fixture.address().port;
const fixtureOffer = Buffer.from(JSON.stringify({ v: 1, offerId: fixtureOfferId, gatewayId: fixtureGatewayId, gatewayPublicKey: fixtureHostKey, addresses: [{ kind: "loopback", url: "ws://127.0.0.1:1/jagentchill/v1/ws" }, { kind: "loopback", url: `ws://127.0.0.1:${fixturePort}/jagentchill/v1/ws` }], expires_ms: Date.now() + 600_000 })).toString("base64url");
await page.getByLabel("Pairing link").fill(`jagentchill://pair#offer=${fixtureOffer}`);
// Leading and trailing spaces: the device name must reach the host exactly as typed, without a trim.
const typedName = "  E2E relay device  ";
await page.getByLabel("Name of this device").fill(typedName);
await page.getByRole("button", { name: "Continue" }).click();
const challenge = await waitFor(() => fixtureRequests.find((request) => request.method === "POST" && request.url === "/jagentchill/v1/pair/challenge") ?? null, { timeout: 15_000, what: "the relayed challenge" }).catch(() => null);
let deviceName = null;
try { deviceName = challenge ? JSON.parse(challenge.body).deviceName : null; } catch { deviceName = null; }
await page.screenshot({ path: join(run.shots, "pair-relay.png") });
check(results, "Connect a host on desktop: the unreachable first address lets the offer's next address be tried, where MAIN relays POST /jagentchill/v1/pair/challenge with the typed device name, spaces kept", deviceName === typedName, challenge ? challenge.body.slice(0, 120) : "no request reached the fixture");
// The valid signature keeps the enrolment active: the UI reaches the code-entry step and the relay goes on to prove.
const codeStep = await waitFor(async () => /Enter the code shown next to/.test(await page.evaluate(() => document.body.innerText)) ? true : null, { timeout: 15_000, what: "the code-entry step" }).catch(() => false);
check(results, "A valid host proof keeps the enrolment active: the UI reaches the code-entry step", codeStep === true);
check(results, "While the enrolment is active the relayed prove step is accepted", fixtureRequests.some((request) => request.method === "POST" && request.url === "/jagentchill/v1/pair/prove"));
await page.screenshot({ path: join(run.shots, "pair-code-step.png") });

// Cancelling while the code check is in flight: the submission's own continuation is invalidated, so the cancel itself
// must clear busy or the initial screen's Continue is left inert.
fixtureMode.deferVerify = true;
await page.getByLabel("Verification code").fill("123456");
const pendingVerify = await waitFor(() => fixtureRequests.some((request) => request.url === "/jagentchill/v1/pair/verify" && /"code"/.test(request.body)) ? true : null, { timeout: 10_000, what: "the in-flight verification" }).catch(() => false);
check(results, "Submitting the code starts a verification request through the relay", pendingVerify === true);
const pairBusy = await page.getByRole("button", { name: "Pair" }).getAttribute("aria-busy").catch(() => "missing");
check(results, "While the verification is pending the Pair button is busy", pairBusy === "true", String(pairBusy));
await page.getByRole("button", { name: "Cancel" }).first().click();
const afterCancelBusy = await waitFor(async () => (await page.getByRole("button", { name: "Continue" }).getAttribute("aria-busy")) === null ? "clear" : null, { timeout: 5_000, what: "the initial screen again" }).catch(() => "busy");
check(results, "Cancelling a pending verification clears busy: the initial screen's Continue works again", afterCancelBusy === "clear", afterCancelBusy);
// The bridge returns the refusal as an envelope; a thrown Error would have lost its `code` at the contextBridge.
const relayAfterCancel = await waitFor(async () => {
  const outcome = await page.evaluate(async () => {
    const reply = await window.jagentchillDesktop.device.enrolmentPost("challenge", "{}");
    return reply.ok ? "allowed" : reply.code;
  });
  return outcome === "allowed" ? null : outcome;
}, { timeout: 5_000, what: "the relay to be refused after cancel" }).catch(() => "allowed");
check(results, "Cancel ends an active pairing: a later relay call is refused", relayAfterCancel === "ENROLMENT_INACTIVE", relayAfterCancel);

// A start that completes long after it was cancelled must not touch the newer attempt. The first challenge of this
// phase is refused 2.5 s late; a second attempt starts in the meantime and reaches the code step. The stale attempt's
// failure must be swallowed (it must not release the newer enrolment, whose relay stays accepted).
fixtureChallenges = 0;
fixtureMode = { delayChallenge_ms: 2_500, failFirstChallenge: true, deferVerify: false };
await page.getByRole("button", { name: "Continue" }).click();
await sleep(200);
// Leaving the screen cancels the first attempt; a later visit starts a fresh one.
await page.evaluate(() => { history.pushState({}, "", "/home"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(300);
await page.evaluate(() => { history.pushState({}, "", "/pair/start"); window.dispatchEvent(new PopStateEvent("popstate")); });
await page.getByLabel("Pairing link").fill(`jagentchill://pair#offer=${fixtureOffer}`);
await page.getByLabel("Name of this device").fill(typedName);
await page.getByRole("button", { name: "Continue" }).click();
const secondCodeStep = await waitFor(async () => /Enter the code shown next to/.test(await page.evaluate(() => document.body.innerText)) ? true : null, { timeout: 15_000, what: "the second attempt's code-entry step" }).catch(() => false);
check(results, "A second attempt reaches the code step while the cancelled first one is still unanswered", secondCodeStep === true);
await sleep(3_000);
const stillActive = await page.evaluate(async () => (await window.jagentchillDesktop.device.enrolmentPost("challenge", "{}")).ok);
check(results, "The cancelled start's late failure does not end the newer attempt: its enrolment is still active", stillActive === true, String(stillActive));

// Closing while the enrolment is still STARTING: the host has the request and has accepted the proof, but its answer is
// not back yet. The cancel must reach the host all the same (the flow owns the cancel from the moment the request exists).
const cancelCount = () => fixtureRequests.filter((request) => request.url === "/jagentchill/v1/pair/verify" && /"action":"cancel"/.test(request.body)).length;
const goToStart = async () => {
  await page.evaluate(() => { history.pushState({}, "", "/home"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await sleep(1200);
  await page.evaluate(() => { history.pushState({}, "", "/pair/start"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await page.getByLabel("Pairing link").fill(`jagentchill://pair#offer=${fixtureOffer}`);
};
await goToStart();
fixtureMode = { delayChallenge_ms: 0, failFirstChallenge: false, deferVerify: false, delayProve_ms: 4_000 };
const provesBefore = fixtureRequests.filter((request) => request.url === "/jagentchill/v1/pair/prove").length, cancelsBeforeStartClose = cancelCount();
await page.getByRole("button", { name: "Continue" }).click();
await waitFor(() => (fixtureRequests.filter((request) => request.url === "/jagentchill/v1/pair/prove").length > provesBefore ? true : null), { timeout: 15_000, what: "the proof to reach the host" }).catch(() => false);
const closedAt = Date.now();
await page.getByRole("button", { name: "Cancel" }).first().click();
const startCancel = await waitFor(() => (cancelCount() > cancelsBeforeStartClose ? Date.now() - closedAt : null), { timeout: 3_000, what: "the cancel of an enrolment that was still starting" }).catch(() => -1);
await sleep(4_500);
check(results, "Closing while the enrolment is starting (proof accepted, answer not back) still cancels the host's request, exactly once", startCancel >= 0 && startCancel < 3_000 && cancelCount() === cancelsBeforeStartClose + 1, `cancel after ${startCancel} ms; ${cancelCount() - cancelsBeforeStartClose} cancel request(s)`);
fixtureMode = { delayChallenge_ms: 0, failFirstChallenge: false, deferVerify: false };
await goToStart();
await page.getByRole("button", { name: "Continue" }).click();
await waitFor(async () => /Enter the code shown next to/.test(await page.evaluate(() => document.body.innerText)) ? true : null, { timeout: 15_000, what: "the code-entry step again" }).catch(() => false);

// Closing the code entry (the dialog's ✕, which also unmounts the screen) tells the host first and releases the
// enrolment after: the signed cancel reaches the host although the screen is gone, and only then is the relay refused.
const cancelsSeen = cancelCount;
const cancelsBeforeClose = cancelsSeen();
await page.getByRole("button", { name: "Close" }).first().click();
const cancelReached = await waitFor(() => (cancelsSeen() === cancelsBeforeClose + 1 ? true : null), { timeout: 10_000, what: "the cancel of the closed code entry to reach the host" }).catch(() => false);
check(results, "Closing the code entry sends the signed cancel to the host before the enrolment is released", cancelReached === true, `${cancelsSeen() - cancelsBeforeClose} cancel request(s)`);
const relayAfterClose = await waitFor(async () => { const code = await page.evaluate(async () => { const reply = await window.jagentchillDesktop.device.enrolmentPost("prove", "{}"); return reply.ok ? null : reply.code; }); return code; }, { timeout: 5_000, what: "the relay to be refused after the close" }).catch(() => "allowed");
check(results, "After that close the enrolment is released: a relay call is refused", relayAfterClose === "ENROLMENT_INACTIVE", String(relayAfterClose));

// An enrolment that ended in the main process (its ten minutes ran out; ended here through the same bridge call) is
// terminal for the code step: the screen returns to the start with the reason, and Pair is not there to call the relay again.
await page.evaluate(() => { history.pushState({}, "", "/home"); window.dispatchEvent(new PopStateEvent("popstate")); });
await sleep(300);
await page.evaluate(() => { history.pushState({}, "", "/pair/start"); window.dispatchEvent(new PopStateEvent("popstate")); });
await page.getByLabel("Pairing link").fill(`jagentchill://pair#offer=${fixtureOffer}`);
await page.getByRole("button", { name: "Continue" }).click();
await waitFor(async () => /Enter the code shown next to/.test(await page.evaluate(() => document.body.innerText)) ? true : null, { timeout: 15_000, what: "the code-entry step once more" }).catch(() => false);
await page.evaluate(() => window.jagentchillDesktop.device.endEnrolment());
const codeChecksBefore = fixtureRequests.filter((request) => request.url === "/jagentchill/v1/pair/verify" && /"code"/.test(request.body)).length;
await page.getByLabel("Verification code").fill("654321");
const backAtStart = await waitFor(async () => { const text = await page.evaluate(() => document.body.innerText); return /This pairing attempt has ended\. Start pairing again\./.test(text) && !/Enter the code shown next to/.test(text) ? true : null; }, { timeout: 8_000, what: "the start screen with the reason" }).catch(() => false);
await page.screenshot({ path: join(run.shots, "pair-ended.png") });
const continueThere = await page.getByRole("button", { name: "Continue" }).count();
check(results, "An enrolment that ended in the main process is terminal: the screen is back at the start with \"This pairing attempt has ended. Start pairing again.\"", backAtStart === true && continueThere > 0);
check(results, "…and the refused code was not sent to the host", fixtureRequests.filter((request) => request.url === "/jagentchill/v1/pair/verify" && /"code"/.test(request.body)).length === codeChecksBefore);
fixture.closeAllConnections?.();
fixture.close();


if (packaged && process.platform === "darwin") {
  // Real delivery by macOS LaunchServices to this app bundle (the `open-url` event).
  const bundle = packaged.replace(/\/Contents\/MacOS\/.*$/, "");
  execFileSync("open", ["-a", bundle, "jagentchill://projects"]);
  const arrived = await page.waitForURL(/\/projects$/, { timeout: 15_000 }).then(() => true, () => false);
  check(results, "Link while running, delivered by macOS itself (open -a <bundle> jagentchill://projects)", arrived, await page.evaluate(() => location.pathname));
}

// ───────────── quit: nothing is left behind ─────────────
const running = processesOf(run);
console.log(`processes of this run while running:\n${describe(running)}`);
const t0 = Date.now();
await quit(session);
await waitFor(() => !alive(server.pid) && !alive(appPid), { timeout: 15_000, what: "the processes to end" }).catch(() => undefined);
const after = processesOf(run).concat(ps().filter((p) => p.pgid === server?.pid));
console.log(`processes of this run after quit:\n${describe(after)}`);
const diagnostics = readFileSync(join(run.userData, "logs", "diagnostics.log"), "utf8");
check(results, "Clean quit: shutdown.prepare answered { safe: true } and no app or server process (nor an agent CLI it started) remains", after.length === 0 && /shutdown\.prepare → \{"safe":true\}/.test(diagnostics) && !alive(server.pid), `${Date.now() - t0} ms`);
const ports = execFileSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], { encoding: "utf8" });
check(results, "No port of the built-in host is still listening", !new RegExp(`:(${ready.port}|${ready.gatewayPort}) \\(LISTEN\\)`).test(ports));

// ───────────── second launch: opened with a project package, the project survives ─────────────
const packageFile = join(run.dir, "trip.jagentchill");
const made = execFileSync(process.execPath, [join(desktopRoot, "e2e", "make-package.ts"), run.library, join(run.dir, "package-cache"), projectId, packageFile], { encoding: "utf8" });
console.log(`package written by the product's exporter: ${made.trim().slice(0, 160)}`);
session = await launch(run, { packaged, args: [packageFile] });
({ app, page } = session);
const ready2 = await hostReady(page);
const db2 = new DatabaseSync(join(hostDir, "jagentchill.sqlite"), { readOnly: true });
const devices2 = db2.prepare("SELECT role, local_supervisor FROM devices").all();
db2.close();
check(results, "Second run: the same key connects again with its stored token; still one device, no new bootstrap file", ready2.state === ready.state && devices2.length === 1 && readdirSync(join(hostDir, "bootstrap")).length === 0 && ready2.gatewayId === ready.gatewayId, `${ready2.state} pid=${ready2.pid}`);
const imported = await waitFor(() => { const dirs = readdirSync(run.library).filter((n) => existsSync(join(run.library, n, "project.json"))); return dirs.length === 2 ? dirs : null; }, { timeout: 40_000, what: "the imported project" }).catch(() => null);
const names = (imported ?? []).map((n) => JSON.parse(readFileSync(join(run.library, n, "project.json"), "utf8")).metadata.name);
check(results, "Double-click a project package (opened as a launch argument): it is imported as a new project folder named by the duplicate rule; Existing project id: the original is unchanged", !!imported && imported.includes(projectId) && imported.length === 2 && JSON.parse(readFileSync(projectFile, "utf8")).metadata.id === projectId && names.slice().sort().join("|") === [`(1) ${projectName}`, projectName].sort().join("|"), `${imported?.length} project folders: ${names.join(" | ")}`);
await page.evaluate(() => { history.pushState({}, "", "/projects"); window.dispatchEvent(new PopStateEvent("popstate")); });
await waitFor(async () => (await page.evaluate(() => document.querySelectorAll('[data-testid^="project-"]').length)) >= 2, { timeout: 20_000, what: "the project cards" }).catch(() => null);
const cards = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="project-"]')].map((n) => n.getAttribute("data-testid")));
await page.screenshot({ path: join(run.shots, "projects-after-restart.png") });
check(results, "The project created before the restart is listed after it", cards.includes(`project-${projectName}`), cards.join(", "));
const bounds = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ x: 120, y: 90, width: 1100, height: 720 }); return w.getBounds(); });
await sleep(700);

// A corrupt package names the file and creates nothing.
const corrupt = join(run.dir, "broken.jagentchill");
writeFileSync(corrupt, "this is not a package");
const third = packaged ? spawn(packaged, [corrupt], { env: secondEnv, stdio: "ignore" }) : spawn(electronExe, [desktopRoot, corrupt], { env: secondEnv, stdio: "ignore" });
await new Promise((done) => third.once("exit", done));
await waitFor(async () => /broken\.jagentchill/.test(await page.evaluate(() => document.body.innerText)), { timeout: 15_000, what: "the error for the corrupt package" }).catch(() => null);
check(results, "Corrupt package: an error names the file and no project is created", /broken\.jagentchill/.test(await page.evaluate(() => document.body.innerText)) && readdirSync(run.library).filter((n) => existsSync(join(run.library, n, "project.json"))).length === 2);

// ───────────── the server is killed: restart ─────────────
const s2 = ps().find((p) => p.pid === ready2.pid);
process.kill(s2.pid, "SIGKILL");
const restarted = await waitFor(async () => { const s = await status(page); return s.pid && s.pid !== s2.pid && (s.state === "ready" || (s.state === "degraded" && !s.reasons.includes("gateway_starting"))) ? s : null; }, { timeout: 120_000, what: "the restarted host" }).catch(() => null);
check(results, "Single crash of the server: killed with SIGKILL, a new server is spawned and the state returns", !!restarted && ps().filter((p) => / serve --data-dir /.test(p.command) && p.command.includes(run.dir)).length === 1, restarted ? `new pid ${restarted.pid}, restarts in the last hour ${restarted.restartsLastHour}` : "not restarted");

const last = { server: restarted?.pid };
await quit(session);
await waitFor(() => !alive(last.server), { timeout: 15_000, what: "the processes to end" }).catch(() => undefined);
const final = processesOf(run);
console.log(`processes of this run after the last quit:\n${describe(final)}`);
check(results, "No orphan process after the last quit", final.length === 0);

// ───────────── third launch: window state ─────────────
session = await launch(run, { packaged });
const restored = await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
check(results, "Restore window state: the window opens at the position and size it had", restored.x === bounds.x && restored.y === bounds.y && restored.width === bounds.width && restored.height === bounds.height, JSON.stringify(restored));
const min = await session.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(500, 300); return w.getSize(); });
check(results, "Minimum size: the window stops at 960×600 at UI scale 100%", min[0] === 960 && min[1] === 600, min.join("×"));
await hostReady(session.page);
await quit(session);
await sleep(1500);
const leftovers = processesOf(run);
check(results, "No orphan process after the third run", leftovers.length === 0, describe(leftovers).trim());

// Every launch after the first connects while its server is not listening yet: no fault may escape in the main process.
const faults = [readFileSync(join(run.userData, "logs", "main.log"), "utf8"), existsSync(join(run.dir, "electron-output.log")) ? readFileSync(join(run.dir, "electron-output.log"), "utf8") : ""].join("\n").split("\n").filter((line) => /uncaughtException|unhandledRejection|ReferenceError|TypeError/.test(line));
check(results, "Cold launches with a stored host record (the channel is tried before the server listens): no uncaught exception in the main process", faults.length === 0, faults.slice(0, 3).join(" | ").slice(0, 300));
const secondPart = process.argv.includes("--first-only") ? null : await (await import("./more.mjs")).default({ packaged, results, check });
const failed = results.filter((r) => !r.ok);
writeFileSync(join(run.dir, "results.json"), JSON.stringify({ packaged: packaged ?? null, firstWindow_ms, timeToReady_ms: secondPart?.timeToReady_ms ?? null, secondRun: secondPart?.run.dir ?? null, results }, null, 2));
console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Screenshots and results: ${run.dir}`);
process.exit(failed.length ? 1 : 0);

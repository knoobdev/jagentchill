import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APP_ORIGIN, GRANTED_PERMISSIONS, WEB_PREFERENCES, acceptDeepLink, connectSources, contentSecurityPolicy, createHeldQueue, dropSummary, expandDrop, externalOpen, fileKind,
  launchTargets, navigationAllowed, permissionGranted, renderHostCsp, resolveAppRequest, senderAllowed, PRODUCT_FILE_TYPES,
} from "../src/index.ts";

const files = new Set(["/b/web/index.html", "/b/web/_expo/static/js/web/entry-1.js", "/b/web/wasm/engine.wasm", "/etc/passwd"]);
const bundle = { root: "/b/web", separator: "/" as const, isFile: (path: string) => files.has(path) };

test("First window: the shell and its assets are served from the bundle under app://jagentchill", () => {
  assert.equal(APP_ORIGIN, "app://jagentchill");
  assert.deepEqual(resolveAppRequest("app://jagentchill/", bundle), { status: 200, file: "/b/web/index.html", mime: "text/html; charset=utf-8", fallback: false });
  assert.deepEqual(resolveAppRequest("app://jagentchill/_expo/static/js/web/entry-1.js", bundle), { status: 200, file: "/b/web/_expo/static/js/web/entry-1.js", mime: "text/javascript; charset=utf-8", fallback: false });
  assert.equal((resolveAppRequest("app://jagentchill/wasm/engine.wasm?v=1", bundle) as { mime: string }).mime, "application/wasm");
  // A route of the single-page app gets the shell; a missing asset stays missing.
  assert.deepEqual(resolveAppRequest("app://jagentchill/editor/p_123?time=4#x", bundle), { status: 200, file: "/b/web/index.html", mime: "text/html; charset=utf-8", fallback: true });
  assert.deepEqual(resolveAppRequest("app://jagentchill/_expo/missing.js", bundle), { status: 404 });
});

test("Unknown path in the app scheme: a path that resolves outside the bundled export is 404 and reads nothing", () => {
  const probed: string[] = [];
  const watching = { ...bundle, isFile: (path: string) => { probed.push(path); return files.has(path); } };
  for (const url of [
    "app://jagentchill/../../etc/passwd", "app://jagentchill/..%2f..%2fetc%2fpasswd", "app://jagentchill/%2e%2e/%2e%2e/etc/passwd", "app://jagentchill/a/..\\..\\etc\\passwd",
    "app://jagentchill/%252e%252e/etc/passwd", "app://jagentchill//etc/passwd/..", "app://jagentchill/./../etc/passwd", "app://jagentchill/c:/windows/win.ini", "app://jagentchill/%00",
    "app://other/index.html", "app://jagentchill.evil/index.html", "file:///etc/passwd", "app://jagentchill/%E0%A4%A",
  ]) assert.deepEqual(resolveAppRequest(url, watching), { status: 404 }, url);
  assert.ok(probed.every((path) => path.startsWith("/b/web/")), probed.join(", "));
});

test("Window flags: every window is created with the listed web preferences", () => {
  assert.deepEqual(WEB_PREFERENCES, { contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false });
  assert.equal("enableRemoteModule" in WEB_PREFERENCES, false);
});

test("Blocked connection: connect-src names the app, the built-in server's loopback port and paired hosts, and nothing else", () => {
  assert.deepEqual(connectSources({}), ["'self'", "app:", "blob:", "data:", "jagentchill-gw:", "jagentchill-file:"]);
  const csp = contentSecurityPolicy({ serverPort: 18910 });
  assert.equal(csp, "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: jagentchill-gw: jagentchill-file:; media-src 'self' blob: jagentchill-gw: jagentchill-file:; font-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; worker-src 'self' blob:; connect-src 'self' app: blob: data: jagentchill-gw: jagentchill-file: http://127.0.0.1:18910 ws://127.0.0.1:18910");
  assert.equal(csp.includes("example.com"), false);
  assert.equal(csp.includes("unsafe-eval'") && !csp.includes("wasm-unsafe-eval"), false);
  assert.match(renderHostCsp(), /connect-src app: blob: data: jagentchill-file:$/);
});

test("Newly paired host: its address is in connect-src as soon as the policy is recomputed, with the matching WebSocket scheme", () => {
  const sources = connectSources({ serverPort: 18910, pairedOrigins: ["https://studio.tailnet.ts.net", "http://192.168.1.20:18790", "javascript:alert(1)", "https://a b"], egressHosts: ["fonts.example.org", "bad host"] });
  assert.deepEqual(sources.slice(8), ["https://studio.tailnet.ts.net", "wss://studio.tailnet.ts.net", "http://192.168.1.20:18790", "ws://192.168.1.20:18790", "https://fonts.example.org"]);
});

test("CSP is frozen: relayed enrolment never widens it, so the policy for given inputs stays byte-identical", () => {
  const inputs = { serverPort: 18910, pairedOrigins: ["https://studio.tailnet.ts.net", "http://192.168.1.20:18790"], egressHosts: ["fonts.example.org"] };
  assert.equal(contentSecurityPolicy(inputs), "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: jagentchill-gw: jagentchill-file:; media-src 'self' blob: jagentchill-gw: jagentchill-file:; font-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; worker-src 'self' blob:; connect-src 'self' app: blob: data: jagentchill-gw: jagentchill-file: http://127.0.0.1:18910 ws://127.0.0.1:18910 https://studio.tailnet.ts.net wss://studio.tailnet.ts.net http://192.168.1.20:18790 ws://192.168.1.20:18790 https://fonts.example.org");
  assert.equal(contentSecurityPolicy({}), "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: jagentchill-gw: jagentchill-file:; media-src 'self' blob: jagentchill-gw: jagentchill-file:; font-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; worker-src 'self' blob:; connect-src 'self' app: blob: data: jagentchill-gw: jagentchill-file:");
});

test("Navigation attempt: only app://jagentchill is a destination of a window", () => {
  assert.equal(navigationAllowed("app://jagentchill/projects"), true);
  for (const url of ["https://example.com", "app://evil/", "file:///etc/hosts", "javascript:alert(1)", "about:blank", "not a url"]) assert.equal(navigationAllowed(url), false, url);
});

test("External link: https and mailto open in the system browser. Refused scheme: file, javascript and the rest open nothing", () => {
  assert.deepEqual(externalOpen("https://example.com/notes?x=1"), { open: true, url: "https://example.com/notes?x=1" });
  assert.deepEqual(externalOpen("mailto:someone@example.com"), { open: true, url: "mailto:someone@example.com" });
  assert.deepEqual(externalOpen("file:///etc/passwd"), { open: false, scheme: "file" });
  assert.deepEqual(externalOpen("javascript:alert(1)"), { open: false, scheme: "javascript" });
  assert.deepEqual(externalOpen("http://example.com"), { open: false, scheme: "http" });
  assert.deepEqual(externalOpen("https://user:pw@example.com"), { open: false, scheme: "https" });
  assert.deepEqual(externalOpen("smb://server/share"), { open: false, scheme: "smb" });
  assert.deepEqual(externalOpen("::"), { open: false, scheme: "invalid" });
});

test("Denied permission: geolocation is denied. Granted permission: media and the short list are granted to the app only", () => {
  assert.equal(permissionGranted("geolocation", "app://jagentchill/"), false);
  for (const permission of ["midi", "openExternal", "hid", "serial", "usb", "idle-detection", "window-management"]) assert.equal(permissionGranted(permission, "app://jagentchill/"), false, permission);
  for (const permission of GRANTED_PERMISSIONS) assert.equal(permissionGranted(permission, "app://jagentchill/editor/x", { userGesture: true }), true, permission);
  assert.equal(permissionGranted("media", "https://example.com/"), false);
  assert.equal(permissionGranted("display-capture", "app://jagentchill/", { userGesture: false }), false);
});

test("Unknown channel: only a frame of the app itself may call the bridge", () => {
  assert.equal(senderAllowed("app://jagentchill/home"), true);
  for (const url of ["https://example.com/", "app://other/", "file:///x.html", "", undefined, null]) assert.equal(senderAllowed(url), false);
});

test("Oversized link: a 5,000-character link and a foreign scheme are dropped in the main process", () => {
  assert.deepEqual(acceptDeepLink(`jagentchill://editor/${"a".repeat(5000)}`), { ok: false, reason: "too-long" });
  assert.deepEqual(acceptDeepLink(`jagentchill://${"a".repeat(4096 - 14)}`).ok, true);
  for (const url of ["https://example.com", "jagentchill:editor/x", "JAGENTCHILL://editor/x", "jagentchillx://a", "jagentchill://a b", " jagentchill://a"]) assert.deepEqual(acceptDeepLink(url), { ok: false, reason: "wrong-scheme" }, url);
  assert.deepEqual(acceptDeepLink(42), { ok: false, reason: "not-a-string" });
  assert.deepEqual(acceptDeepLink("jagentchill://pair#offer=abc"), { ok: true, url: "jagentchill://pair#offer=abc" });
});

test("Link while starting: links are held (at most 10) until the renderer subscribes, then delivered in arrival order", () => {
  const queue = createHeldQueue<string>(10);
  for (let i = 0; i < 12; i++) queue.push(`jagentchill://editor/p${i}`);
  assert.equal(queue.size, 10);
  assert.equal(queue.skipped, 2);
  const seen: string[] = [];
  const off = queue.subscribe((url) => seen.push(url));
  assert.deepEqual(seen, Array.from({ length: 10 }, (_unused, i) => `jagentchill://editor/p${i}`));
  queue.push("jagentchill://projects");
  assert.equal(seen[10], "jagentchill://projects");
  off();
  queue.push("jagentchill://library");
  assert.equal(queue.size, 1);
});

test("Second launch: forwarded arguments yield links and files; switches and unknown files are ignored", () => {
  const isFile = (path: string) => !path.includes("missing");
  assert.deepEqual(launchTargets(["/app/JAgentChill", "--allow-file-access", "jagentchill://editor/p_1", "/Users/a/trip.jagentchill", "/Users/a/notes.json", "/Users/a/missing.jagentchill", "https://example.com/x", "--hidden"], { isFile }),
    { links: ["jagentchill://editor/p_1"], files: ["/Users/a/trip.jagentchill"], hidden: true, renderHost: false, rejected: ["https://example.com/x"] });
  assert.equal(launchTargets(["electron", ".", "--render-host"], { skip: 2, isFile }).renderHost, true);
  assert.deepEqual(launchTargets(["C:\\JAgentChill.exe", "C:\\Users\\a\\intro.jcworkflow"], { isFile }).files, ["C:\\Users\\a\\intro.jcworkflow"]);
});

test("Old extension is not registered: every product type has one final extension and .json, .jchill are never handled", () => {
  assert.deepEqual(PRODUCT_FILE_TYPES.map((type) => type.ext), ["jagentchill", "jctpl", "jcpack", "jcworkflow", "jcscript", "jckeys", "fountain"]);
  assert.deepEqual(PRODUCT_FILE_TYPES.filter((type) => type.default).map((type) => type.ext), ["jagentchill"]);
  assert.equal(PRODUCT_FILE_TYPES.find((type) => type.ext === "jagentchill")!.mime, "application/vnd.jagentchill.project+zip");
  for (const path of ["a.json", "a.jchill", "a.jchill-keys.json", "a.jcworkflow.json", "a.txt", "noextension"]) assert.equal(fileKind(path), null, path);
  assert.equal(fileKind("/x/Trip.JAGENTCHILL"), "project-package");
  assert.equal(fileKind("intro.jcworkflow"), "workflow");
  assert.deepEqual(["a.mp4", "a.MOV", "a.flac", "a.webp", "a.srt"].map(fileKind), ["media", "media", "media", "media", "subtitle"]);
});

test("Drop a folder: 12 videos and 3 text files give 12 imported, 3 skipped; hidden files, depth and the 2,000-file limit are respected", async () => {
  const tree: Record<string, string[]> = { "/d": [...Array.from({ length: 12 }, (_unused, i) => `/d/v${String(i).padStart(2, "0")}.mp4`), "/d/a.txt", "/d/b.txt", "/d/c.txt"] };
  const fs = { isDirectory: async (path: string) => path in tree, list: async (path: string) => (tree[path] ?? []).map((child) => ({ path: child, directory: child in tree })) };
  const result = await expandDrop(["/d"], fs);
  assert.equal(dropSummary(result.files.length, result.skipped), "12 imported, 3 skipped");
  // Five levels of folders are entered; the sixth is skipped. Hidden entries are skipped at any level.
  const deep: Record<string, string[]> = { "/r": ["/r/.hidden.mp4", "/r/1"], "/r/1": ["/r/1/2"], "/r/1/2": ["/r/1/2/3"], "/r/1/2/3": ["/r/1/2/3/4"], "/r/1/2/3/4": ["/r/1/2/3/4/ok.mp4", "/r/1/2/3/4/5"], "/r/1/2/3/4/5": ["/r/1/2/3/4/5/too-deep.mp4"] };
  const deepFs = { isDirectory: async (path: string) => path in deep, list: async (path: string) => (deep[path] ?? []).map((child) => ({ path: child, directory: child in deep })) };
  assert.deepEqual(await expandDrop(["/r"], deepFs), { files: ["/r/1/2/3/4/ok.mp4"], skipped: 2 });
  const many = { "/m": Array.from({ length: 2005 }, (_unused, i) => `/m/${i}.png`) } as Record<string, string[]>;
  const manyResult = await expandDrop(["/m"], { isDirectory: async (path) => path in many, list: async (path) => (many[path] ?? []).map((child) => ({ path: child, directory: false })) });
  assert.deepEqual([manyResult.files.length, manyResult.skipped], [2000, 5]);
});

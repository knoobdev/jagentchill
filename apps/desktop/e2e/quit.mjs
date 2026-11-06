// The app never leaves its server (or an agent CLI the server started) behind, on a packaged build, unattended (hidden windows, nothing opened).
//   1. launch → quit through the app's real quit path (app.quit(): before-quit, the stop sequence), three times on one data
//      directory: after each, no process of the run is left (command line with the run's directory, or a descendant of the
//      server) and the server and Gateway ports are free;
//   2. launch → kill -9 of the app: the server notices within 10 s, takes the agent CLIs it started with it, ports free;
//   3. a server that cannot answer (SIGSTOP) whose app was killed is found by the next launch through the pid file of the
//      data directory and ended before a new one starts: never two servers on one data directory.
// Usage: node e2e/quit.mjs --packaged <absolute path of the executable of the e2e copy>
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { check, describe, freshRun, launch, processesOf, quit, sleep, waitFor } from "./lib.mjs";

const at = process.argv.indexOf("--packaged");
const packaged = at > 0 ? process.argv[at + 1] : undefined;
if (!packaged) { console.error("usage: node e2e/quit.mjs --packaged <executable>"); process.exit(2); }
const results = [];
const run = freshRun("quit");
console.log(`run directory: ${run.dir}`);
const ps = () => execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n")
  .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean).map((m) => ({ pid: +m[1], ppid: +m[2], command: m[3] }));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const portOpen = (port) => new Promise((done) => { const socket = createConnection({ port, host: "127.0.0.1" }); socket.once("connect", () => { socket.destroy(); done(true); }); socket.once("error", () => done(false)); });
const descendants = (roots) => { const all = ps(), found = new Set(roots); let grew = true; while (grew) { grew = false; for (const p of all) if (found.has(p.ppid) && !found.has(p.pid)) { found.add(p.pid); grew = true; } } return [...found]; };
const serverFile = join(run.userData, "host", "run", "server.json");
const serverPid = () => (existsSync(serverFile) ? JSON.parse(readFileSync(serverFile, "utf8")).pid : undefined);
const status = (page) => page.evaluate(() => window.jagentchillDesktop.gateway.getStatus());
async function ready(page) {
  return waitFor(async () => { const s = await status(page); return s.state === "ready" || (s.state === "degraded" && !s.reasons.includes("gateway_starting")) ? s : null; }, { timeout: 120_000, what: "the host ready" });
}
/** What is left of an app: processes of the run, and whatever hangs under the server it had. */
const leftOf = (serverPidBefore) => { const mine = new Set(processesOf(run).map((p) => p.pid)); for (const pid of descendants(serverPidBefore ? [serverPidBefore] : [])) if (alive(pid)) mine.add(pid); return [...mine].filter((pid) => alive(pid) && pid !== process.pid); };
const killLeft = () => { for (const pid of leftOf(serverPid())) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } } };

let ports = [];
for (let round = 1; round <= 3; round++) {
  const session = await launch(run, { packaged });
  const s = await ready(session.page);
  ports = [s.port, s.gatewayPort].filter(Boolean);
  const server = serverPid();
  const children = descendants([server]);
  console.log(`round ${round}: app pid ${session.pid}, server pid ${server}, ports ${ports.join("/")}, ${children.length} processes under the server`);
  const started = Date.now();
  await quit(session);
  const appGone = !alive(session.pid);
  // "app.exit only after the server is gone": nothing may need a grace period after the app itself has ended.
  const left = leftOf(server);
  const busy = (await Promise.all(ports.map(portOpen))).filter(Boolean).length;
  check(results, `Quit ${round}/3 through the real quit path: the app ends, and no process of the run is left (server ${server} gone: ${!alive(server)}), ports free`, appGone && left.length === 0 && busy === 0,
    `${Date.now() - started} ms; left: ${describe(ps().filter((p) => left.includes(p.pid)))}; ports still open: ${busy}`);
  if (left.length) killLeft();
}

// kill -9 of the app: the server must go by itself.
{
  const session = await launch(run, { packaged });
  const s = await ready(session.page);
  const server = serverPid(), under = descendants([server]);
  ports = [s.port, s.gatewayPort].filter(Boolean);
  const from = Date.now();
  process.kill(session.pid, "SIGKILL");
  const gone = await waitFor(() => (under.every((pid) => !alive(pid)) ? true : null), { timeout: 10_000, every: 200, what: "the server leaving" }).catch(() => false);
  const took = Date.now() - from;
  const busy = (await Promise.all(ports.map(portOpen))).filter(Boolean).length;
  check(results, "kill -9 of the app: the server and its Gateway are gone within 10 s and the ports are free", gone === true && busy === 0, `${took} ms; ${under.length} processes watched; ports open: ${busy}`);
  if (!gone) killLeft();
}

// An orphan that does not answer: SIGSTOP the server, kill the app; the next launch ends it before it starts its own.
{
  const first = await launch(run, { packaged });
  await ready(first.page);
  const orphan = serverPid();
  process.kill(orphan, "SIGSTOP");
  process.kill(first.pid, "SIGKILL");
  await sleep(1500);
  const stillThere = alive(orphan);
  const second = await launch(run, { packaged });
  const s = await ready(second.page);
  const fresh = serverPid();
  check(results, "Orphan server (stopped, app killed) is ended by the next launch on the same data directory; a new server runs", stillThere && !alive(orphan) && fresh !== orphan && alive(fresh), `orphan ${orphan} → new server ${fresh}, state ${s.state}`);
  const servers = ps().filter((p) => /jagentchill-server\.mjs serve/.test(p.command) && p.command.includes(run.dir));
  check(results, "Never two servers on one data directory", servers.length === 1, `${servers.length} server process(es): ${servers.map((p) => p.pid).join(",")}`);
  await quit(second);
  const left = leftOf(fresh);
  check(results, "Final quit leaves nothing behind", left.length === 0, `left: ${left.join(",") || "none"}`);
  if (left.length) killLeft();
}
const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed. Run: ${run.dir}`);
process.exit(failed.length ? 1 : 0);

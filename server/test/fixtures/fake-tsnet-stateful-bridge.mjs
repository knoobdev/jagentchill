import { readFileSync } from "node:fs";

const stateFile = process.env.TSNET_TEST_STATE_FILE;
if (!stateFile) process.exit(2);
const emit = (state) => {
  if (state === "connected") process.stdout.write("TSNET_READY fake-host.example.ts.net 43111\n");
  else process.stdout.write("TSNET_LOGIN_URL https://login.tailscale.com/a/fake-token\n");
};
let previous = "";
const poll = () => {
  let current = "login";
  try { current = readFileSync(stateFile, "utf8").trim(); } catch { /* Wait for a test state file. */ }
  if (current !== previous) { previous = current; emit(current); }
};
poll();
const timer = setInterval(poll, 25);
const stop = () => { clearInterval(timer); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

#!/usr/bin/env node
// Deterministic bridge fixture for desktop e2e; never opens a socket or contacts Tailscale.
console.log("TSNET_LOGIN_URL https://login.tailscale.com/fake-login-url");
setTimeout(() => console.log("TSNET_READY jc-test.tailnet.ts.net"), 250);
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
setInterval(() => {}, 60_000);

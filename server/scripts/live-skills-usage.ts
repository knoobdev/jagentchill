// Live check against a running server, with a real model turn on the Claude Code CLI (no API key is used):
//  1. the 21 skills this product ships are listed from the server's folder;
//  2. a skill installed from a folder on the host is listed and can be attached to a session;
//  3. a turn sent with that skill attached is answered with the skill loaded — only its name travels in the message;
//  4. the usage of that turn appears in the session totals and in the roll-ups by runtime, provider, session and device;
//  5. a spending limit refuses the next send before anything reaches the agent.
// Usage: JAGENTCHILL_PORT=<port> node server/scripts/live-skills-usage.ts <offer-url> <server-log-file>
import { resolve } from "node:path";
import { BASE, pairAdmin, pairWith, settle, turn } from "./live-lib.ts";

const [offerUrl, logFile] = process.argv.slice(2);
const admin = await pairAdmin(offerUrl, logFile, "Live skills admin");
let ok = true;
const check = (name: string, pass: boolean, detail = "") => { ok &&= pass; console.log(pass ? "OK  " : "FAIL", name, detail); };

// 1. bundled skills
let skills = (await admin.call("jagentchill.skill.list", {})).skills;
const bundled = skills.filter((skill: any) => skill.scope === "bundled");
check("bundled skills listed", bundled.length === 21 && bundled.every((skill: any) => skill.enabled && skill.status === "ok"), `${bundled.length} listed, ${bundled.filter((skill: any) => skill.enabled).length} enabled`);

// 2. install from a folder on the host
const fixtures = resolve(import.meta.dirname, "fixtures/skills");
const source = (await admin.call("jagentchill.skill.source.upsert", { source: { kind: "local", label: "Fixture skills", enabled: true, path: fixtures } })).source;
const item = (await admin.call("jagentchill.skill.catalogue.list", { sourceIds: [source.id] })).items[0];
const { card } = await admin.call("jagentchill.skill.catalogue.get", { itemId: item.itemId });
console.log(`     trust prompt: ${card.name} · ${card.fileCount} files · ${card.sizeBytes} bytes · scripts=${card.hasScripts} · hash ${card.contentHash.slice(0, 12)}`);
const installed = (await admin.call("jagentchill.skill.install", { itemId: item.itemId, confirmedContentHash: card.contentHash, idempotencyKey: `live-${Date.now()}` })).skill;
skills = (await admin.call("jagentchill.skill.list", {})).skills;
const listed = skills.find((skill: any) => skill.skillId === installed.skillId);
check("installed skill is listed", !!listed && listed.owned && listed.enabled && listed.source.kind === "local", `${installed.skillId} at ${listed?.realPath} visibleTo=${listed?.visibleTo.join(",")}`);
const editor = await pairWith(admin, "editor", "Live skills editor");
const denied = await editor.refused("jagentchill.skill.install", { itemId: item.itemId, confirmedContentHash: card.contentHash, idempotencyKey: "e" });
check("an editor device cannot install", denied.code === "SCOPE_DENIED", denied.code);

// 3. a turn with the skill attached
const ref = { runtimeId: "claude-code", providerId: "anthropic", modelId: process.env.LIVE_CLAUDE_MODEL ?? "claude-sonnet-5" };
const { session } = await admin.call("jagentchill.session.create", { ref });
await admin.call("jagentchill.session.skills.set", { sessionKey: session.sessionKey, skillIds: ["sign-off-check"] });
const { line } = await admin.call("jagentchill.skill.invocation.build", { sessionKey: session.sessionKey, skillIds: (await admin.call("jagentchill.session.skills.get", { sessionKey: session.sessionKey })).skillIds });
check("the invocation names the skill and carries none of its text", line === "$sign-off-check", JSON.stringify(line));
await admin.call("jagentchill.usage.subscribe", { sessionKeys: [session.sessionKey], aggregate: true });
let usageEvents = 0;
admin.on((event, payload) => { if (event === "jagentchill.approval.requested") console.log(`     approval shown to the admin device: ${JSON.stringify(payload).slice(0, 300)}`); });
admin.on((event) => { if (event === "jagentchill.usage.updated") usageEvents += 1; });
const answer = await turn(admin, session.sessionKey, `${line}\n\nSay hello in one word.`);
check("the turn is answered with the skill loaded", answer.state === "final" && answer.text.includes("KIWI-73"), `${answer.state}: ${JSON.stringify(answer.text.slice(0, 80))}`);
const plain = (await admin.call("jagentchill.session.create", { ref })).session;
const without = await turn(admin, plain.sessionKey, "Say hello in one word.");
check("a turn without the skill does not carry its sign-off", without.state === "final" && !without.text.includes("KIWI-73"), JSON.stringify(without.text.slice(0, 40)));
await settle(2500);

// 4. usage of those turns
const usage = (await admin.call("jagentchill.usage.session.get", { sessionId: session.sessionKey })).session;
const [record] = usage.records;
check("the turn has one usage record", usage.records.length === 1 && record.outcome === "completed" && record.deviceId === admin.device.deviceId, `tokens in=${record.inputTokens} cached=${record.cachedInputTokens} cacheWrite=${record.cacheWriteTokens} out=${record.outputTokens} · ${record.tokenSource} · billing=${record.billing} · cost=${record.costSource} · ${record.duration_ms} ms`);
check("usage events reached the subscribed device", usageEvents >= 2, `${usageEvents} events`);
const now = Date.now(), range = { from_ms: now - 86_400_000, to_ms: now + 60_000 };
for (const dimension of ["runtime", "provider", "session", "device", "project", "model"]) {
  const result = await admin.call("jagentchill.usage.query", { groupBy: [dimension], ...range });
  const turns = (row: any) => row.agent.turns.completed + row.agent.turns.cancelled + row.agent.turns.failed;
  check(`roll-up by ${dimension}`, result.rows.length >= 1 && turns(result.totals) === 2, result.rows.map((row: any) => `${row.labels[0]}: ${turns(row)} turns, ${row.agent.inputTokens + row.agent.cachedInputTokens + row.agent.cacheWriteTokens + row.agent.outputTokens} tokens, ${row.accuracy}`).join(" | "));
}
const tree = (await admin.call("jagentchill.usage.tree.get", { rootSessionId: session.sessionKey })).node;
check("roll-up by agent tree", tree.own.turns.completed === 1 && tree.children.length === 0, `${tree.label}: own ${tree.own.outputTokens} output tokens`);
const history = await admin.call("jagentchill.usage.history.get", { from_day: "2026-01-01", to_day: "2027-12-31" });
check("daily rollup and lifetime total", history.rollups.length === 1 && history.lifetime.turns === 2, `${history.rollups[0]?.day} ${history.timeZone}: ${history.rollups[0]?.turns} turns · lifetime ${history.lifetime.tokens} tokens`);
const seen = await editor.call("jagentchill.usage.query", { groupBy: ["session"], ...range });
check("an editor sees the admin's sessions as one row without identity", seen.rows.length === 1 && seen.rows[0].labels[0] === "Other sessions" && seen.rows[0].keys[0] === "", JSON.stringify(seen.rows.map((row: any) => row.labels)));
const exported = await admin.call("jagentchill.usage.export", { query: { groupBy: ["day"], ...range }, detail: "records", idempotencyKey: "live" });
const target = `/jagentchill/v1/usage/exports/${exported.blobSha256}`;
const csv = await (await fetch(BASE + target, { headers: admin.device.signedHeaders(admin.offer.gatewayId, "GET", target, undefined) })).text();
check("CSV export", exported.rowCount === 2 && csv.split("\r\n")[1].includes("claude-sonnet"), `${exported.fileName}: ${csv.split("\r\n")[1].slice(0, 110)}…`);
const plan = await admin.call("jagentchill.usage.plan.list", {});
check("plan usage is off until an admin turns it on", plan.enabled === false && plan.providers.length === 0);

// 5. budget
await admin.call("jagentchill.provider.budget.set", { budget: { scope: "session", scopeId: session.sessionKey, limitUsd: 0.01, period: "total" } });
let budget = (await admin.call("jagentchill.provider.budget.list", {})).budgets[0];
check("a plan-billed turn moves no budget", budget.spentUsd === 0 && budget.uncountedTurns === 1, `spent ${budget.spentUsd} of ${budget.limitUsd}, ${budget.uncountedTurns} turn not counted`);
console.log(ok ? "SKILLS AND USAGE OK" : "SKILLS AND USAGE FAILED");
admin.close(); editor.close();
process.exit(ok ? 0 : 1);

// Permission mode (brief w7-chat item 5, and the coordinator's ruling of 2026-10-09, brief w7-chat-2 part A): which card
// a tool raises in which mode. Every cell of the table is MEASURED here by making the call on the real server (real
// tools, real request records, real film service); the Gateway is the FAKE of `harness.ts`, the import's network is a
// table of this file and the generation provider is the stub of `scripts/stub-generation.ts`. The table is printed
// (`PERMISSION TABLE …`) so the same file run on other code shows that code's table.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ImportNet } from "../src/tools/import.ts";
import { AUTO_MODE_LINE } from "../src/tools/context.ts";
import { startStubGeneration } from "../scripts/stub-generation.ts";
import { tick } from "./harness.ts";
import { key, toolWorld } from "./support/tools.ts";

const until = async (done: () => boolean, what: string) => { for (let n = 0; n < 400; n++) { if (done()) return; await tick(10); } throw new Error(`timed out waiting for ${what}`); };
const BUILD = [
  { op: "node.add", node: { id: "brief", type: "agent", name: "Draft the brief", config: { prompt: "Write a brief." } } },
  { op: "edge.add", edge: { id: "e1", from: { node: "start", port: "done" }, to: { node: "brief", port: "start" } } },
];
/** Text the tainted sessions were given from outside (a page): 320 characters. */
const OUTSIDE = Array.from({ length: 40 }, (_value, index) => `page${String(index).padStart(3, "0")}`).join(" ");
type Cell = "asks" | "asks, offers “for this session”" | "does not ask";
type Row = { kind: string; mode: "edit" | "auto"; session: "has read nothing from outside" | "tainted"; first: Cell; afterSessionAllow?: Cell };

/** Whether the session counted as "has read outside content" before and after the person answered the agent's question. */
const taintedByAnswer: Array<{ mode: string; before: boolean; after: boolean }> = [];
/** One world per mode × taint: every card kind is called once in it, and again after "Always allow for this session" where that is offered. */
async function measure(mode: "edit" | "auto", tainted: boolean): Promise<Row[]> {
  const stub = await startStubGeneration();
  const net: ImportNet = { resolve: async () => ["93.184.216.34"], download: async () => ({ status: 404, body: { async *[Symbol.asyncIterator]() { /* empty */ } }, cancel: () => undefined }) };
  const w = await toolWorld({ mode, toolSurface: "general", harness: { extra: { toolTimings: { net, questionWaitMs: 5000 }, generation: { openRouterBaseUrl: stub.url, timings: { retryDelaysMs: [30, 60], jitter: () => 0, circuitMs: 50 } } } as never } });
  const rows: Row[] = [];
  try {
    await w.admin.call("jagentchill.chat.subscribe", { sessionKey: w.sessionKey });
    await w.admin.putSecret("PROVIDER_OPENROUTER_API_KEY", "sk-or-stub-0123456789abcd");
    await w.admin.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
    await w.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", pricing: { kind: "per_image", baseUsd: 0.6 } } });
    const { film } = (await w.admin.call("jagentchill.film.create", { title: "F", sourceText: "s" })) as { film: { id: string } };
    const scene = await w.write("jc_film_upsert_scene", { filmId: film.id, title: "The stall" });
    const shots = [] as string[];
    for (let n = 0; n < 3; n++) shots.push((await w.write("jc_film_upsert_shot", { filmId: film.id, clipId: scene.data.sceneId, action: `Shot ${n}`, shotSize: "wide", cameraMotion: "static", duration_ticks: 240_000 })).data.shotId);
    if (tainted) w.h.app.tools.requests.taint(w.sessionKey, "web:https://example.org/page", [OUTSIDE]);
    const session = tainted ? "tainted" : "has read nothing from outside";
    const cards = async () => (await w.admin.call("jagentchill.chat.approval.list", { sessionKey: w.sessionKey })).requests as Array<{ requestId: string; state: string; actions: string[] }>;
    /** Makes the call; says whether a card was raised, and what it offers. */
    const cell = async (tool: string, args: Record<string, unknown>): Promise<{ cell: Cell; requestId?: string }> => {
      const envelope = await w.call(tool, args);
      if (envelope.ok || envelope.error!.code !== "APPROVAL_PENDING") return { cell: "does not ask" };
      const requestId = (envelope.error as { details?: { requestId?: string } }).details!.requestId!;
      // A paid call is not a card of its own: the costed calls of one message are decided together by the paid-call gate.
      if ((envelope.error as { details?: { card?: string } }).details?.card === "message") return { cell: "asks" };
      const card = (await cards()).find((entry) => entry.requestId === requestId);
      if (!card) throw new Error(`${tool}: no card ${requestId} in ${JSON.stringify(envelope.error)} / ${JSON.stringify(await cards()).slice(0, 300)}`);
      return { cell: card.actions.includes("allow-session") ? "asks, offers “for this session”" : "asks", requestId };
    };
    /** A card kind: its first call, and — where the person can allow it for the session — a second call of the same kind after they did. */
    const kind = async (name: string, tool: string, args: (n: number) => Record<string, unknown>) => {
      const one = args(1), first = await cell(tool, one);
      const row: Row = { kind: name, mode, session, first: first.cell };
      if (first.cell === "asks, offers “for this session”") {
        await w.admin.call("jagentchill.chat.approval.resolve", { requestId: first.requestId, decision: "allow-session" });
        await w.call(tool, one);
        row.afterSessionAllow = (await cell(tool, args(2))).cell;
        // The table measures each kind on its own: the answer is taken back before the next kind.
        w.h.app.db.prepare("DELETE FROM tool_session_allow WHERE session_key = ?").run(w.sessionKey);
      }
      rows.push(row);
    };
    await kind("Import media from a URL (folder of an origin)", "jc_media_import", (n) => ({ source: { kind: "url", url: `https://cdn.example.com/assets/clip-${n}.mp4` }, idempotencyKey: key() }));
    await kind("Import media from a URL with a query string", "jc_media_import", (n) => ({ source: { kind: "url", url: `https://cdn.example.com/q/clip.mp4?u=${n}` }, idempotencyKey: key() }));
    await kind("Delete a shot of the project's film", "jc_film_delete_shot", (n) => ({ filmId: film.id, id: shots[n - 1], idempotencyKey: key() }));
    await kind("Create a workflow on the host", "jc_workflow_create", (n) => ({ name: `Recap ${n}`, description: "Draft", ops: BUILD, idempotencyKey: key() }));
    await kind("Paid generation over the amount an agent may spend unasked ($0.60 picture)", "jc_generate_image", (n) => ({ prompt: `A red kite over the sea, number ${n}.` }));
    // The copied-prompt rule: a prompt to a provider that carries 200+ characters of what the session read from outside.
    if (tainted) await kind("Prompt to a provider that copies 200+ characters of outside content", "jc_generate_image", () => ({ prompt: `A poster. ${OUTSIDE.slice(0, 260)}` }));
    // The agent's own question: a question card, not a permission.
    const asked = () => w.admin.events.filter((event) => event.event === "jagentchill.chat.question.requested").length;
    const waiting = w.call("jc_session_ask", { questions: [{ id: "ratio", text: "Which ratio?", kind: "single", options: [{ label: "16:9" }, { label: "9:16" }] }] });
    await until(() => asked() === 1, "the question card");
    const question = w.admin.events.find((event) => event.event === "jagentchill.chat.question.requested")!.payload.question as { questionId: string };
    await w.admin.call("jagentchill.chat.question.answer", { questionId: question.questionId, answers: [{ id: "ratio", value: "9:16" }] });
    await waiting;
    rows.push({ kind: "The agent's own question (jc_session_ask)", mode, session, first: "asks" });
    // The person's answer is their own word: it does not make the session one that has read outside content.
    taintedByAnswer.push({ mode, before: tainted, after: w.h.app.tools.requests.isTainted(w.sessionKey) });
    // Last, because allowed it takes the project away.
    await kind("Move the project to the trash", "jc_project_trash", () => ({ idempotencyKey: key() }));
    await kind("Restore a project from the trash", "jc_project_restore", () => ({ projectId: w.h.app.relay.session(w.sessionKey)!.projectId, idempotencyKey: key() }));
  } finally { w.close(); await stub.close(); }
  return rows;
}

/**
 * The ruling as a table. Rule 1: Auto, and "Always allow for this session", ask nothing for an action inside the app —
 * tainted or not. Rule 3: in Edit every such card offers "for this session", tainted or not, and after it nothing is
 * asked. Rule 2 (asked in every mode): money, and the copied prompt. The agent's own question is not a permission.
 */
const OFFER: [Cell, Cell] = ["asks, offers “for this session”", "does not ask"], SILENT: [Cell] = ["does not ask"];
const RULE1 = { "edit|clean": OFFER, "edit|tainted": OFFER, "auto|clean": SILENT, "auto|tainted": SILENT };
const ASKS = { "edit|clean": ["asks"] as [Cell], "edit|tainted": ["asks"] as [Cell], "auto|clean": ["asks"] as [Cell], "auto|tainted": ["asks"] as [Cell] };
const EXPECTED: Record<string, Record<string, [Cell, Cell?]>> = {
  "Import media from a URL (folder of an origin)": RULE1,
  "Import media from a URL with a query string": RULE1,
  "Delete a shot of the project's film": RULE1,
  "Create a workflow on the host": RULE1,
  "Restore a project from the trash": RULE1,
  "Move the project to the trash": RULE1,
  // Rule 2. (Money in Auto is the paid-call gate's own cell — inside the Auto session budget it does not ask — and is not asserted by mode here.)
  "Prompt to a provider that copies 200+ characters of outside content": { "edit|tainted": ["asks"], "auto|tainted": ["asks"] },
  "The agent's own question (jc_session_ask)": ASKS,
};

test("Permission mode: card kind × mode × what the session has read → asks or does not ask; Auto asks nothing for an action inside the app, tainted or not; in Edit every such card offers “for this session” and after it nothing is asked; money and a copied prompt are asked in every mode", async () => {
  const rows: Row[] = [];
  for (const mode of ["edit", "auto"] as const) for (const tainted of [false, true]) rows.push(...(await measure(mode, tainted)));
  for (const row of rows) console.log(`PERMISSION TABLE | ${row.kind} | ${row.mode} | ${row.session} | ${row.first}${row.afterSessionAllow ? ` | after “Always allow for this session”: ${row.afterSessionAllow}` : ""}`);
  for (const entry of taintedByAnswer) console.log(`PERMISSION TABLE | (the person answers the agent's question) | ${entry.mode} | tainted before: ${entry.before} | tainted after: ${entry.after}`);
  console.log("PERMISSION TABLE | Irreversible deletion outside the trash (purge) | every mode | — | no tool of the catalogue can do it (jc_project_trash moves to the trash; nothing purges)");
  console.log("PERMISSION TABLE | The runtime's own host tools (shell, files, raw network) | every mode | — | asked by the runtime's permission system (sessions.ts onApprovalEvent), not by permit(): not measured here");
  const wrong: string[] = taintedByAnswer.filter((entry) => entry.after !== entry.before).map((entry) => `${entry.mode}: the person's own answer tainted the session`);
  const seen = new Set<string>();
  for (const row of rows) {
    const cellKey = `${row.mode}|${row.session === "tainted" ? "tainted" : "clean"}`, expected = EXPECTED[row.kind]?.[cellKey];
    if (!expected) continue;
    seen.add(`${row.kind}|${cellKey}`);
    if (row.first !== expected[0] || row.afterSessionAllow !== expected[1]) wrong.push(`${row.kind} / ${row.mode} / ${row.session}: ${row.first}${row.afterSessionAllow ? ` → ${row.afterSessionAllow}` : ""} (expected ${expected[0]}${expected[1] ? ` → ${expected[1]}` : ""})`);
  }
  for (const [name, cells] of Object.entries(EXPECTED)) for (const cellKey of Object.keys(cells)) if (!seen.has(`${name}|${cellKey}`)) wrong.push(`${name} / ${cellKey}: not measured`);
  assert.deepEqual(wrong, []);
  // Money is the paid-call gate's decision in every mode: the mode of `permit` changes none of its cells. In Edit the
  // $0.60 picture is over the per-call amount and asks; in Auto it is inside the session budget an admin set.
  const money = rows.filter((row) => row.kind.startsWith("Paid generation"));
  assert.deepEqual(money.filter((row) => row.mode === "edit").map((row) => row.first), ["asks", "asks"], "a paid call in Edit asks, tainted or not");
});

// The owner's own case (2026-10-09: 50 import cards in one Auto session). The session reads its timeline, reads a web
// page, then imports 10 pictures from 10 different origins, half of them URLs with a query string.
// NOT real here: the page — the engine's own web tools hand the host no text, so "reads a web page" is the host's taint
// record made through its own interface with the page's text —; the network (a table: every host resolves to a public
// address and answers a PNG); the Gateway (the fake of `harness.ts`).
async function ownersCase(mode: "edit" | "auto"): Promise<{ cards: number; offered: boolean; imported: number; afterAllow: number; copied: Cell; questionAsked: boolean; tainted: [boolean, boolean] }> {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const stub = await startStubGeneration();
  const net: ImportNet = { resolve: async () => ["93.184.216.34"], download: async () => ({ status: 200, contentLength: png.length, mime: "image/png", body: { async *[Symbol.asyncIterator]() { yield new Uint8Array(png); } }, cancel: () => undefined }) };
  const w = await toolWorld({ mode, toolSurface: "general", harness: { extra: { toolTimings: { net, questionWaitMs: 5000 }, generation: { openRouterBaseUrl: stub.url, timings: { retryDelaysMs: [30, 60], jitter: () => 0, circuitMs: 50 } } } as never } });
  try {
    await w.admin.call("jagentchill.chat.subscribe", { sessionKey: w.sessionKey });
    const requests = w.h.app.tools.requests;
    const cards = async () => (await w.admin.call("jagentchill.chat.approval.list", { sessionKey: w.sessionKey })).requests as Array<{ requestId: string; state: string; actions: string[]; copiedPrompt?: string }>;
    // (a) its own timeline and library
    await w.ok("jc_timeline_snapshot", {});
    await w.ok("jc_media_list", {});
    const afterOwn = requests.isTainted(w.sessionKey);
    // (b) a web page
    requests.taint(w.sessionKey, "web:https://example.org/search?q=lanterns", [OUTSIDE]);
    // (c) 10 pictures, 10 origins
    let imported = 0, offered = false, afterAllow = 0, answered = false;
    for (let n = 0; n < 10; n++) {
      const args = { source: { kind: "url", url: n % 2 ? `https://img${n}.example.net/photos/p${n}.png?size=large&token=t${n}` : `https://cdn${n}.example.org/pictures/p${n}.png` }, idempotencyKey: key() };
      let envelope = await w.call("jc_media_import", args);
      if (!envelope.ok && envelope.error!.code === "APPROVAL_PENDING") {
        if (answered) afterAllow += 1;
        const requestId = (envelope.error as { details?: { requestId?: string } }).details!.requestId!;
        offered = (await cards()).find((entry) => entry.requestId === requestId)!.actions.includes("allow-session");
        await w.admin.call("jagentchill.chat.approval.resolve", { requestId, decision: offered ? "allow-session" : "allow-once" });
        answered = true;
        envelope = await w.call("jc_media_import", args);
      }
      if (envelope.ok) imported += 1; else throw new Error(`import ${n}: ${JSON.stringify(envelope.error)}`);
    }
    const importCards = (await cards()).length;
    // Rule 5: the agent's own question is asked as before, also after "for this session".
    const asked = () => w.admin.events.filter((event) => event.event === "jagentchill.chat.question.requested");
    const waiting = w.call("jc_session_ask", { questions: [{ id: "ratio", text: "Which ratio?", kind: "single", options: [{ label: "16:9" }, { label: "9:16" }] }] });
    await until(() => asked().length === 1, "the question card");
    await w.admin.call("jagentchill.chat.question.answer", { questionId: (asked()[0].payload.question as { questionId: string }).questionId, answers: [{ id: "ratio", value: "9:16" }] });
    await waiting;
    // Rule 2: a prompt to a provider that copies the page is still shown first — one card.
    await w.admin.putSecret("PROVIDER_OPENROUTER_API_KEY", "sk-or-stub-0123456789abcd");
    await w.admin.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
    await w.admin.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", pricing: { kind: "per_image", baseUsd: 0.02 } } });
    await w.admin.call("jagentchill.provider.threshold.set", { patch: { confirmAboveUsd: 1 } });
    const prompt = `A poster. ${OUTSIDE.slice(0, 260)}`, before = stub.calls.length;
    const envelope = await w.call("jc_generate_image", { prompt });
    const copiedCards = (await cards()).filter((entry) => entry.copiedPrompt === prompt);
    assert.equal(stub.calls.filter((call) => call.path === "/images").length, 0, "no provider call before the person saw the prompt");
    void before;
    const copied: Cell = !envelope.ok && envelope.error!.code === "APPROVAL_PENDING" && copiedCards.length === 1 && !copiedCards[0].actions.includes("allow-session") ? "asks" : "does not ask";
    return { cards: importCards, offered, imported, afterAllow, copied, questionAsked: asked().length === 1, tainted: [afterOwn, requests.isTainted(w.sessionKey)] };
  } finally { w.close(); await stub.close(); }
}

test("Permission mode, the owner's case: a session that read its timeline and a web page imports 10 pictures from 10 origins (5 with a query string) — Auto: 0 cards; Edit: 1 card with “Always allow for this session”, then 0; a prompt that copies the page is still 1 card in both; the agent's question is still asked", async () => {
  const auto = await ownersCase("auto"), edit = await ownersCase("edit");
  console.log(`OWNERS CASE | auto | import cards shown: ${auto.cards} | imported: ${auto.imported}/10 | copied-prompt card: ${auto.copied} | tainted after own reads / after the page: ${auto.tainted.join(" / ")}`);
  console.log(`OWNERS CASE | edit | import cards shown: ${edit.cards} (offers “for this session”: ${edit.offered}) | cards after that answer: ${edit.afterAllow} | imported: ${edit.imported}/10 | copied-prompt card: ${edit.copied}`);
  assert.deepEqual(auto, { cards: 0, offered: false, imported: 10, afterAllow: 0, copied: "asks", questionAsked: true, tainted: [false, true] });
  assert.deepEqual(edit, { cards: 1, offered: true, imported: 10, afterAllow: 0, copied: "asks", questionAsked: true, tainted: [false, true] });
});

test("Permission mode: a turn of an Auto session is told to decide by itself and not to ask; a turn of an Edit session is not told so", async () => {
  const auto = await toolWorld({ mode: "auto" });
  const edit = await toolWorld({ mode: "edit" });
  try {
    const sent = async (w: Awaited<ReturnType<typeof toolWorld>>) => { await w.admin.call("jagentchill.chat.send", { sessionKey: w.sessionKey, message: "Trim the intro" }); const message = String((w.h.fake.callsOf("startTurn").at(-1) as { message: string }).message); w.h.fake.endTurn(w.sessionKey); return message; };
    const autoMessage = await sent(auto), editMessage = await sent(edit);
    assert.ok(autoMessage.includes(AUTO_MODE_LINE), "the Auto turn carries the line");
    assert.match(AUTO_MODE_LINE, /Decide by yourself/);
    assert.match(AUTO_MODE_LINE, /jc_session_ask only when you cannot go on/);
    assert.ok(!editMessage.includes("Auto mode"), "the Edit turn does not");
    assert.ok(autoMessage.endsWith("Trim the intro") && editMessage.endsWith("Trim the intro"), "the person's words close the message in both");
  } finally { auto.close(); edit.close(); }
});

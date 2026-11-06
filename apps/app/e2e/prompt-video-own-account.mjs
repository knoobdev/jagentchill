// End-to-end in a real browser on the PRODUCTION web build: the start card of a prompt-to-video run whose writing and
// picture check run on the person's OWN signed-in account (ruling R9) — those parts are in no amount, are never
// "price not known", and the card says so in one quiet line; the paid parts (pictures, voice, music) are ONE total.
// REAL: the app, the JAgentChill Server (the template, its estimate, the spend gate, the billing classifier), its Gateway child.
// TEST DOUBLES: (a) the generation provider — server/scripts/stub-generation.ts; (b) "Claude Code" is the FAKE `claude`
// program of `own-account.mjs` on the test host's PATH (`.dev/orc/tmp/w2-screens-5/fake-cli/claude`): it answers only
// `--version` and `auth status` and cannot answer a turn — so what is proven here is the QUESTION (and that a start
// confirming only the amount is accepted), not a finished video. The owner's real Claude Code is never started.
// Usage: STUB_GEN_URL=… node apps/app/e2e/prompt-video-own-account.mjs <run-dir> <web-base> ; SHOTS=<dir>
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { pairAdmin, putSecret } from "../../../server/scripts/live-lib.ts";

const [runDir, base = "http://localhost:8087"] = process.argv.slice(2);
const logFile = `${runDir}/server.log`, shots = process.env.SHOTS ?? ".dev/shots/pv5";
mkdirSync(shots, { recursive: true });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => process.exit(1));

const firstOffer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))[0];
const setup = await pairAdmin(firstOffer, logFile, "Host setup");
const codes = new Map();
setup.on((event, payload) => { if (event === "jagentchill.pairing.requested") codes.set(payload.request.deviceName, payload.code); });
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };
const finish = async (browser) => { await browser?.close().catch(() => undefined); setup.close?.(); const ok = results.length && results.every(Boolean); console.log(ok ? "PROMPT-VIDEO OWN ACCOUNT OK" : "PROMPT-VIDEO OWN ACCOUNT FAILED"); process.exit(ok ? 0 : 1); };

// The generation double, with list prices for every paid part (as `own-account.mjs` prices the reader and the listener).
await putSecret(setup, "PROVIDER_OPENROUTER_API_KEY", "sk-or-stub-e2e-0123456789wxyz");
await setup.call("jagentchill.provider.connect", { providerId: "openrouter", secretNames: ["PROVIDER_OPENROUTER_API_KEY"] });
await setup.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "openai/gpt-5-image-mini", capability: "image", pricing: { kind: "per_image", baseUsd: 0.011 } } });
await setup.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "google/gemini-3.8-flash-lite-tts", capability: "tts", pricing: { kind: "per_character", perThousandUsd: 0.000125 } } });
await setup.call("jagentchill.provider.model.upsert", { providerId: "openrouter", model: { id: "qwen/qwen3-asr-1.7b", capability: "transcription", pricing: { kind: "per_call", usd: 0.00002 } } });
let claude = null;
for (let attempt = 0; attempt < 40 && !claude; attempt++) {
  const group = (await setup.call("jagentchill.runtime.models.list", {})).groups.find((entry) => entry.runtimeId === "claude-code");
  const model = group?.providers.flatMap((provider) => provider.models.map((entry) => ({ providerId: provider.providerId, modelId: entry.modelId, label: entry.label, readiness: entry.readiness }))).find((entry) => entry.readiness === "ready");
  if (model) claude = { runtimeId: "claude-code", providerId: model.providerId, modelId: model.modelId, label: model.label, runtime: group.label };
  else { await new Promise((resolve) => setTimeout(resolve, 1500)); await setup.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: ["claude-code"] }).catch(() => undefined); }
}
if (!claude) { check("setup: the host lists the (fake) Claude Code with a model that is ready", false); await finish(); }
console.log(`     the own-account runtime: ${claude.runtime}, model ${claude.label ?? claude.modelId}`);
const profile = (ref) => ({ enabled: true, profiles: [{ id: "default", runtime: ref.runtimeId, provider: ref.providerId, model: ref.modelId, params: {}, enabled: true }], defaultProfileId: "default", routes: { default: { primary: { profileId: "default" }, fallbacks: [] } }, limits: {} });
const state = await setup.call("jagentchill.orc.config.get", {});
await setup.call("jagentchill.orc.config.update", { expectedRevision: state.revision, patch: { enabled: true, roles: { director: profile(claude), vision: profile(claude) } } });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const button = (name) => visible(page.getByRole("button", { name, exact: true }));
const type = async (locator, value) => { await locator.click(); await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.press("Delete"); await page.keyboard.insertText(value); };
const language = async (label) => {
  await page.goto(`${base}/settings/general`, { waitUntil: "networkidle" });
  await visible(page.getByRole("combobox").filter({ hasText: /English|Tiếng Việt|日本語|\((EN|VI|JA)\)/ })).click({ timeout: 60_000 });
  await visible(page.getByRole("option", { name: label, exact: true })).click();
  await page.waitForTimeout(800);
};
const card = async (url) => {
  await page.goto(url, { waitUntil: "networkidle", timeout: 180_000 });
  await tid("pv-setup-title").waitFor({ timeout: 60_000 });
  await type(tid("pv-duration"), "10");
  await page.waitForFunction(() => /3 /.test(document.querySelector('[data-testid="pv-assumptions"]')?.textContent ?? ""), null, { timeout: 30_000 });
  await tid("pv-confirm").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  await tid("pv-confirm").scrollIntoViewIfNeeded();
  return {
    words: (await tid("pv-confirm").innerText()).replace(/\n+/g, " / "),
    own: (await page.getByTestId("pv-confirm-own").filter({ visible: true }).count()) ? (await tid("pv-confirm-own").innerText()).trim() : "",
    unpriced: await page.getByTestId("pv-confirm-unpriced").filter({ visible: true }).count(),
    amount: Number(await tid("pv-confirm").getAttribute("data-amount")),
    // The rows of the estimate table, by step (w7 item 4).
    rows: await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-testid^="pv-estimate-row-"]')].filter((node) => node.getClientRects().length > 0 && node.getAttribute("data-testid") !== "pv-estimate-row-cost").map((node) => [node.getAttribute("data-testid").slice("pv-estimate-row-".length), node.innerText.replace(/\s+/g, " ").trim()]))),
  };
};

try {
  const offer = (await setup.call("jagentchill.pairing.offer.create", { role: "admin" })).url;
  await page.goto(`${base}/home`, { waitUntil: "networkidle", timeout: 180_000 });
  await visible(page.getByText("What do you want to make?")).waitFor({ timeout: 120_000 });
  await button("Connect").click();
  await visible(page.getByLabel("Pairing link")).fill(offer);
  await visible(page.getByLabel("Name of this device")).fill("Own account card");
  await button("Continue").click();
  await visible(page.getByText(/Enter the code shown next to [0-9a-f]{8}/)).waitFor();
  for (let wait = 0; wait < 50 && !codes.has("Own account card"); wait++) await page.waitForTimeout(100);
  await visible(page.getByLabel("Verification code")).fill(codes.get("Own account card"));
  await visible(page.getByText("Connected", { exact: true })).waitFor();
  const hostId = /\(host ([0-9a-f]+)\)/.exec(readFileSync(logFile, "utf8"))[1];
  const url = `${base}/h/${hostId}/workflows/video?prompt=${encodeURIComponent("A calm film about making tea at dawn")}`;

  const en = await card(url);
  console.log(`     START CARD (en): ${en.words}`);
  check("The card asks ONE amount, a number", en.amount > 0 && /This run may spend up to \$\d/.test(en.words), String(en.amount));
  check("No model is “price not known” and no part is “Price unknown”", en.unpriced === 0 && !/Price unknown|is not known/.test(en.words), en.words.slice(0, 400));
  check("ONE quiet line names the person's own account and the parts that run on it", new RegExp(`^On your own ${claude.runtime} account, not billed by this app: .+`).test(en.own) && !en.own.includes("\n"), en.own);
  check("No model id, role name or code is on the card", !/claude-cli|claude-code|runtime:|own_account|director|vision\b/.test(en.words), en.words.slice(-300));
  // w7 item 4: no "$0.00" row. The writing on the person's own account is NOT a row of the table (it was "Brief · Chat
  // model · $0.00"); the voice, which costs a fraction of a cent here, reads "less than $0.01"; a step no model does has no price.
  console.log(`     ESTIMATE ROWS (en): ${JSON.stringify(en.rows)}`);
  check("w7-4: no row of the estimate shows a zero price", !Object.values(en.rows).some((row) => /\$0\.00(?!\d)|\$0\.0000/.test(row)), JSON.stringify(en.rows));
  check("w7-4: the money question shows no zero price either (\"Voice $0.00\")", !/\$0\.00(?!\d)|\$0\.0000/.test(en.words), en.words.slice(0, 200));
  check("w7-4: the steps on the person's own account are no money rows", !("brief" in en.rows) && !("script_draft" in en.rows) && !("shot_list" in en.rows) && "assets" in en.rows, Object.keys(en.rows).join(", "));
  check("w7-4: a real amount under one cent reads \"less than $0.01\"", /less than \$0\.01$/.test(en.rows.voiceover ?? ""), en.rows.voiceover ?? "(no voice row)");
  await tid("pv-estimate-cost").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/39-own-account-estimate-rows-en.png` });
  await tid("pv-confirm").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/40-own-account-start-card-en.png` });

  // The host accepts a start that confirms ONLY the amount: nothing about the own-account model has to be allowed.
  const params = { prompt: "A calm film about making tea at dawn", targetDuration_s: 10, aspectRatio: "9:16", resolution: "1080p", frameRate: 30, language: "en", style: "auto", voice: "auto", musicMood: "auto", captions: true, mode: "auto" };
  const started = await setup.call("jagentchill.workflow.video.start", { confirmedUsd: en.amount, params }).then((value) => ({ value }), (error) => ({ error }));
  check("A start that confirms only the amount is accepted (no model has to be allowed by name)", !!started.value, JSON.stringify(started.error?.details ?? started.error?.code ?? null).slice(0, 300));
  const runId = started.value?.run?.runId ?? started.value?.runId;
  if (runId) await setup.call("jagentchill.workflow.run.cancel", { runId }).catch(() => undefined);

  await language("Tiếng Việt");
  const vi = await card(url);
  console.log(`     START CARD (vi): ${vi.words}`);
  check("Vietnamese: the same single amount and the own-account line, nothing left in English", vi.amount === en.amount && new RegExp(`^Chạy bằng tài khoản ${claude.runtime} của chính bạn, ứng dụng này không tính tiền: .+`).test(vi.own) && !/This run|not billed|Price unknown|You are asked/.test(vi.words), vi.own);
  const costVi = (await tid("pv-estimate-cost").innerText()).trim(), tableVi = await page.locator("body").innerText();
  const broken = /(^|[\s–])[,.]\d+\s?\$/m.exec(`${costVi}\n${tableVi}`)?.[0] ?? "";
  check("Vietnamese: every figure of a range is whole (“0,073 $ – 0,15 $”, never “,15 $”)", /^0,\d+\s\$ – 0,\d+\s\$$/.test(costVi) && !broken, `${costVi}${broken ? ` — broken figure ${JSON.stringify(broken)}` : ""}`);
  await page.screenshot({ path: `${shots}/41-own-account-start-card-vi.png` });
  await language("English");
} catch (error) {
  check("the script ran to its end", false, String(error).slice(0, 400));
  await page.screenshot({ path: `${shots}/failure-own-account-card.png` }).catch(() => undefined);
}
await finish(browser);

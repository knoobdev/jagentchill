// W23a end-to-end in a real browser (system Chrome) against a fresh JAgentChill Server and the Expo web dev server:
// Providers shows its Sign-in & keys and Endpoints tabs and More providers again; a custom endpoint is added through
// the Endpoints tab, OpenCode is set to run on it (CLI runtimes ▸ Sign-in used), and the model picker shows the
// endpoint's models under OpenCode.
// REAL: the app, the server (endpoint store, discovery, runtime sign-in, model list).
// TEST DOUBLES: (a) the endpoint — a small OpenAI-compatible HTTP server started by this script on 127.0.0.1:18952 that
// only lists two models (no model is ever run); (b) `opencode` on the server's PATH is a shell script that answers
// `--version` and `auth list` only. No real CLI and no provider is called; no agent turn is run.
// Usage: JC_CHROME_PATH=… node apps/app/e2e/providers-endpoint-w23a.mjs <server-log> <web-base> <shots-dir>
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { chromium } from "playwright";

const [logFile, base = "http://localhost:18951", shots = ".dev/shots/w23a"] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

// The endpoint double: an OpenAI-compatible model list, nothing else.
const asked = [];
const endpoint = createServer((req, res) => {
  asked.push(`${req.method} ${req.url} ${req.headers.authorization ? "with-key" : "no-key"}`);
  if (req.url === "/v1/models") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: [{ id: "e2e-relay-large", object: "model" }, { id: "e2e-relay-mini", object: "model" }] }));
  res.writeHead(404, { "content-type": "application/json" }).end("{}");
});
await new Promise((resolve) => endpoint.listen(18952, "127.0.0.1", resolve));

const browser = await chromium.launch({ ...(process.env.JC_CHROME_PATH ? { executablePath: process.env.JC_CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));
const visible = (locator) => locator.filter({ visible: true }).first();
const text = (value, options) => visible(page.getByText(value, options));
const tid = (id) => visible(page.getByTestId(id));
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const fill = async (label, value) => { const field = visible(page.getByLabel(label, { exact: true })); await field.click(); await field.fill(value); };

try {
  const offer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))[0];
  await page.goto(`${base}/`, { waitUntil: "networkidle", timeout: 300_000 });
  await text("What do you want to make?").waitFor({ timeout: 300_000 });
  // The pairing link opens the paste-and-verify path with the link filled in.
  await page.goto(`${base}/pair?offer=${encodeURIComponent(offer.split("offer=")[1])}`, { waitUntil: "networkidle" });
  await visible(page.getByLabel("Pairing link")).waitFor({ timeout: 60_000 });
  await visible(page.getByLabel("Name of this device")).fill("W23a browser");
  await visible(page.getByRole("button", { name: "Continue", exact: true })).click();
  await text("Verify pairing", { exact: true }).waitFor();
  const fingerprint = /next to ([0-9a-f]{8})/.exec(await page.content())[1];
  await page.waitForTimeout(500);
  const code = /code (\d{6})/.exec(readFileSync(logFile, "utf8").split("\n").filter((line) => line.includes(`${fingerprint})`)).pop())[1];
  await page.keyboard.type(code);
  if (await visible(page.getByRole("button", { name: "Pair", exact: true })).isEnabled().catch(() => false)) await visible(page.getByRole("button", { name: "Pair", exact: true })).click().catch(() => undefined);
  await text("Verify pairing", { exact: true }).waitFor({ state: "hidden", timeout: 30_000 });
  const hostId = /\(host ([0-9a-f]+)\)/.exec(readFileSync(logFile, "utf8"))[1];
  const settings = (tab) => `${base}/settings/host/${hostId}/runtimes${tab ? `/${tab}` : ""}`;

  // 1. Providers: the tabs, the buttons and More providers are back.
  await page.goto(settings(), { waitUntil: "networkidle" });
  await text("More providers").waitFor({ timeout: 60_000 });
  const tabs = await page.getByRole("tab").filter({ visible: true }).allInnerTexts();
  check("Providers has the tabs Sign-in & keys and Endpoints", tabs.includes("Sign-in & keys") && tabs.includes("Endpoints"), tabs.join(" | "));
  check("Providers has Add provider, Sign in or add an API key, Add a custom endpoint", await tid("add-provider").count() && await tid("open-keys").count() && await tid("open-endpoints").count());
  check("More providers lists providers a CLI runs on a key of", await tid("provider-anthropic").count() > 0 && await tid("provider-groq").count() > 0);
  await shot("01-providers-tab");

  // 2. Sign-in & keys: every provider with search and group filters; the API-key sheet of OpenRouter.
  await page.goto(settings("keys"), { waitUntil: "networkidle" });
  await tid("provider-openrouter").waitFor({ timeout: 60_000 });
  await visible(page.getByLabel("Search providers")).fill("open");
  await page.waitForTimeout(300);
  check("Sign-in & keys: the search narrows the list", await tid("provider-openai").count() > 0 && await tid("provider-groq").count() === 0);
  await shot("02-sign-in-and-keys-search");
  await tid("provider-openrouter").click();
  await tid("method-api-key").waitFor();
  await page.waitForTimeout(800);
  check("The provider sheet has an account sign-in (OpenRouter) and an API key field", await tid("method-oauth").count() > 0 && await tid("api-key-input").count() > 0);
  await shot("03-openrouter-sheet");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // 3. Endpoints: add a custom endpoint; its models are discovered at once.
  await page.goto(settings("endpoints"), { waitUntil: "networkidle" });
  await tid("add-endpoint").click();
  await fill("Name", "Lab relay");
  await fill("Base URL", "http://127.0.0.1:18952/v1");
  await fill("API key", "e2e-relay-key-0123456789");
  await shot("04-add-endpoint-form");
  await tid("endpoint-save").click();
  await tid("endpoint-lab-relay").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  check("The endpoint was asked for its models with its key", asked.some((line) => line === "GET /v1/models with-key"), asked.join(", "));
  await shot("05-endpoint-added");

  // 4. CLI runtimes: OpenCode is set to run on the endpoint.
  await page.goto(settings("runtimes"), { waitUntil: "networkidle" });
  await tid("runtime-acp-opencode").waitFor({ timeout: 60_000 });
  await visible(page.getByTestId("runtime-acp-opencode").getByRole("button", { name: "OpenCode" })).click();
  await tid("runtime-signin").waitFor();
  await visible(page.getByRole("radio", { name: /^Lab relay/ })).click();
  await text("Sign-in changed").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await shot("06-opencode-sign-in-used");
  await page.keyboard.press("Escape");

  // 5. The model picker shows the endpoint's models under OpenCode.
  await page.goto(`${base}/home`, { waitUntil: "networkidle" });
  await text("What do you want to make?").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await shot("07a-home");
  await visible(page.getByRole("button", { name: /^Model: |e2e-relay|No AI runtime is ready|Select model/ })).click();
  await tid("model-browser").waitFor();
  await page.waitForTimeout(500);
  if (!(await page.getByTestId("model-group-acp-opencode/lab-relay").filter({ visible: true }).count()) && (await page.getByRole("button", { name: "All models" }).filter({ visible: true }).count())) await visible(page.getByRole("button", { name: "All models" })).click();
  await tid("model-group-acp-opencode/lab-relay").waitFor({ timeout: 60_000 });
  check("The picker has a group “OpenCode · Lab relay”", /OpenCode/.test(await tid("model-group-acp-opencode/lab-relay").innerText()) && /Lab relay/.test(await tid("model-group-acp-opencode/lab-relay").innerText()), (await tid("model-group-acp-opencode/lab-relay").innerText()).replace(/\n/g, " "));
  await shot("07-picker-groups");
  await tid("model-group-acp-opencode/lab-relay").click();
  await tid("model-acp-opencode/lab-relay/e2e-relay-large").waitFor({ timeout: 30_000 });
  check("The endpoint's models are listed under OpenCode", await tid("model-acp-opencode/lab-relay/e2e-relay-mini").count() > 0);
  await shot("08-picker-endpoint-models");
  check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} catch (error) {
  check("the script ran to its end", false, String(error).slice(0, 500));
  await shot("failure").catch(() => undefined);
}
await browser.close();
endpoint.close();
const ok = results.length > 0 && results.every(Boolean);
console.log(ok ? "W23A ENDPOINT E2E OK" : "W23A ENDPOINT E2E FAILED");
process.exit(ok ? 0 : 1);

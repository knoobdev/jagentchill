// W24a end-to-end in a real browser (system Chrome) against a fresh JAgentChill Server and the Expo web dev server:
// Settings ▸ Providers ▸ Generation ▸ Local models — the hardware check of THIS machine, a download of Qwen-Image-2.1
// (progress, pause, resume, hash check, engine unpacked), ready, then "Use for the Image role".
// REAL: the app, the server (hardware check of this Mac, downloads with Range resume and SHA-256, unzip, the generation
// catalogue, ORC). TEST DOUBLE (mode "fixture"): the files downloaded are small random files and a ZIP holding a fake
// engine, served by `local-models-w24a-fixture.mjs` — so the sizes on screen are kilobytes, not gigabytes.
// Mode "real": the server runs with the REAL manifest; only the check is shown (nothing is downloaded).
// Usage: JC_CHROME_PATH=… node apps/app/e2e/local-models-w24a.mjs <fixture|real> <server-log> <web-base> <shots-dir>
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const [mode = "fixture", logFile, base = "http://localhost:18951", shots = ".dev/shots/w24a"] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const browser = await chromium.launch({ ...(process.env.JC_CHROME_PATH ? { executablePath: process.env.JC_CHROME_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));
const visible = (locator) => locator.filter({ visible: true }).first();
const text = (value, options) => visible(page.getByText(value, options));
const tid = (id) => visible(page.getByTestId(id));
// A shot of the card: the window is made tall enough for the whole card (the settings page scrolls inside the app, not the window).
const shot = async (name, target) => {
  await page.waitForTimeout(400);
  if (!target) return void (await page.screenshot({ path: `${shots}/${name}.png` }));
  const size = page.viewportSize();
  await page.setViewportSize({ width: size.width, height: 2400 }); await page.waitForTimeout(500);
  await target.screenshot({ path: `${shots}/${name}.png` });
  await page.setViewportSize(size); await page.waitForTimeout(300);
};

try {
  const offer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))[0];
  await page.goto(`${base}/`, { waitUntil: "networkidle", timeout: 300_000 });
  await text("What do you want to make?").waitFor({ timeout: 300_000 });
  await page.goto(`${base}/pair?offer=${encodeURIComponent(offer.split("offer=")[1])}`, { waitUntil: "networkidle" });
  await visible(page.getByLabel("Pairing link")).waitFor({ timeout: 60_000 });
  await visible(page.getByLabel("Name of this device")).fill("W24a browser");
  await visible(page.getByRole("button", { name: "Continue", exact: true })).click();
  await text("Verify pairing", { exact: true }).waitFor();
  const fingerprint = /next to ([0-9a-f]{8})/.exec(await page.content())[1];
  await page.waitForTimeout(500);
  const code = /code (\d{6})/.exec(readFileSync(logFile, "utf8").split("\n").filter((line) => line.includes(`${fingerprint})`)).pop())[1];
  await page.keyboard.type(code);
  if (await visible(page.getByRole("button", { name: "Pair", exact: true })).isEnabled().catch(() => false)) await visible(page.getByRole("button", { name: "Pair", exact: true })).click().catch(() => undefined);
  await text("Verify pairing", { exact: true }).waitFor({ state: "hidden", timeout: 30_000 });
  const hostId = /\(host ([0-9a-f]+)\)/.exec(readFileSync(logFile, "utf8"))[1];
  const generationTab = `${base}/settings/host/${hostId}/runtimes/generation`;

  // 1. The card with the hardware check, before anything is downloaded.
  await page.goto(generationTab, { waitUntil: "networkidle" });
  await tid("local-models-card").waitFor({ timeout: 60_000 });
  await tid("local-check").click();
  await page.waitForTimeout(1200);
  const gpu = await tid("local-gpu").innerText(), memory = await tid("local-memory").innerText();
  check("The check shows this Mac's graphics and memory", /Apple/.test(gpu) && /GB/.test(memory), `${gpu} | ${memory}`);
  const card = tid("local-models-card");
  await card.scrollIntoViewIfNeeded();
  const verdicts = await Promise.all(["q4", "q5", "q6", "q8"].map(async (quant) => `${quant}=${await tid(`local-verdict-${quant}`).innerText()}`));
  check("A verdict per quant is shown before any download", verdicts.length === 4 && verdicts.every((entry) => /Runs|Not/.test(entry)), verdicts.join(", "));
  await tid("local-quant-q4").click();
  await shot(mode === "real" ? "01-real-check-this-mac" : "01-check-before-download", card);
  if (mode === "real") {
    check("The real download size is shown (gigabytes)", /GB/.test(await tid("local-total").innerText()), await tid("local-total").innerText());
    await tid("local-variant-uncensored").click();
    await shot("02-real-check-uncensored", card);
    check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
  } else {
    // 2. Download: progress, pause, resume, ready.
    await tid("local-download").click();
    await tid("local-progress").waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => /[1-9]\d* kB of/.test(document.querySelector('[data-testid="local-progress"]')?.textContent ?? ""), null, { timeout: 30_000 }).catch(() => undefined);
    await shot("02-downloading", card);
    check("Progress is shown while downloading", /of/.test(await tid("local-progress").innerText()), await tid("local-progress").innerText());
    await tid("local-pause").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="local-state"]')?.textContent === "Paused", null, { timeout: 30_000 });
    await shot("03-paused", card);
    check("Pause keeps the progress", /of/.test(await tid("local-progress").innerText()), await tid("local-progress").innerText());
    await tid("local-resume").click();
    await tid("local-ready").waitFor({ timeout: 120_000 });
    await shot("04-ready", card);
    check("Ready after the download, the files checked", /Ready to make pictures/.test(await tid("local-ready").innerText()), await tid("local-ready").innerText());
    check("The folder where the files live is shown", /models$/.test((await tid("local-folder").innerText()).trim()), await tid("local-folder").innerText());
    await page.mouse.wheel(0, -4000);
    await page.waitForTimeout(500);
    check("The provider row says Downloaded", (await tid("generation-connection-local-qwen-image").innerText()) === "Downloaded", await tid("generation-connection-local-qwen-image").innerText());
    // 3. Verify the files, then the Image role of Model routing.
    await tid("local-verify").click();
    await text("Every file matches its checksum").waitFor({ timeout: 30_000 });
    await tid("local-use-image-role").click();
    await page.waitForFunction(() => document.querySelector('[data-testid="local-orc"]')?.textContent === "The Image role uses this model", null, { timeout: 30_000 });
    await shot("05-image-role", card);
    check("The Image role uses the local model", true);
    await page.goto(`${base}/settings/host/${hostId}/model-routing`, { waitUntil: "networkidle" }).catch(() => undefined);
    await visible(page.getByPlaceholder("Search roles…")).fill("Image");
    await page.waitForTimeout(800);
    await visible(page.getByRole("button", { name: /^Image/ })).click().catch(() => undefined);
    await page.waitForTimeout(800);
    await shot("06-model-routing");
    // 4. The same card at 390 px and in dark.
    await page.goto(generationTab, { waitUntil: "networkidle" });
    await tid("local-models-card").waitFor({ timeout: 60_000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    await shot("07-mobile-390", tid("local-models-card"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(800);
    await shot("08-dark", tid("local-models-card"));
    check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
  }
} catch (error) {
  check("the script ran to its end", false, String(error).slice(0, 500));
  await shot("failure").catch(() => undefined);
}
await browser.close();
const ok = results.length > 0 && results.every(Boolean);
console.log(ok ? "W24A LOCAL MODELS E2E OK" : "W24A LOCAL MODELS E2E FAILED");
process.exit(ok ? 0 : 1);

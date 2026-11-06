// Scratch probe of the script studio coder (not a test): the import dialog's split radios.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const base = process.argv[2] ?? "http://localhost:8094";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 600)));
const v = (l) => l.filter({ visible: true }).first();
writeFileSync("/tmp/notes.txt", "The shop opens at nine.\n\nMai turns the sign.\n\n\nA customer waits outside.\n\n\nThe lamp is already on.\n");
await page.goto(`${base}/scripts`, { waitUntil: "networkidle" });
const chooser = page.waitForEvent("filechooser");
await v(page.getByRole("button", { name: "New script from a format" })).click();
await v(page.getByRole("menuitem").filter({ hasText: "Import" })).click();
await (await chooser).setFiles("/tmp/notes.txt");
await v(page.getByText("No scene headings were found")).waitFor();
const state = async (tag) => console.log(tag, await v(page.getByTestId("import-counts")).innerText(), "| checked:", await page.getByRole("radio").evaluateAll((n) => n.map((x) => x.getAttribute("aria-checked"))));
await state("before");
await v(page.getByRole("radio", { name: "Split into scenes by blank-line groups" })).click();
for (const ms of [0, 300, 1500]) { await page.waitForTimeout(ms); await state(`after ${ms}`); }
await browser.close();

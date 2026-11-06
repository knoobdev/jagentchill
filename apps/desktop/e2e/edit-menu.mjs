// The Edit menu's text-editing items (the only way ⌘A/⌘C/⌘X/⌘V/⌘Z reach a field on macOS) act on the focused field:
// in the Home chat box, with nothing selected in any editor. Driven through the real application menu of the real app.
// Usage: node e2e/edit-menu.mjs
import { freshRun, launch } from "./lib.mjs";
const run = freshRun("edit-menu");
const { app, page } = await launch(run);
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };
const menu = (label) => app.evaluate(({ Menu, BrowserWindow }, label) => {
  const find = (items) => { for (const item of items) { if (item.label === label) return item; if (item.submenu) { const hit = find(item.submenu.items); if (hit) return hit; } } return null; };
  const item = find(Menu.getApplicationMenu().items);
  if (!item) return { found: false };
  const state = { found: true, enabled: item.enabled, accelerator: item.accelerator ?? null };
  item.click(undefined, BrowserWindow.getAllWindows()[0], undefined);
  return state;
}, label);
const box = page.locator("textarea").first();
await box.waitFor({ timeout: 120_000 });
await box.click();
await box.fill("JAgentChill copy test");
const value = () => box.inputValue();
const sel = () => box.evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd));
let state = await menu("Select all"); await page.waitForTimeout(400);
check("Select all is enabled with ⌘A and selects the chat box text", state.found && state.enabled && /A$/.test(state.accelerator ?? "") && (await sel()) === "JAgentChill copy test", JSON.stringify(state) + " selected=" + (await sel()));
state = await menu("Cut"); await page.waitForTimeout(400);
check("Cut is enabled with ⌘X and empties the box", state.enabled && (await value()) === "", JSON.stringify(state) + " value=" + (await value()));
state = await menu("Paste"); await page.waitForTimeout(400);
check("Paste is enabled with ⌘V and brings the text back", state.enabled && (await value()) === "JAgentChill copy test", JSON.stringify(state) + " value=" + (await value()));
state = await menu("Undo"); await page.waitForTimeout(400);
check("Undo is enabled with ⌘Z and removes the pasted text", state.enabled && (await value()) === "", JSON.stringify(state) + " value=" + (await value()));
await box.fill("second"); await menu("Select all"); await page.waitForTimeout(300);
state = await menu("Copy"); await page.waitForTimeout(300);
const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
check("Copy is enabled with ⌘C and puts the selection on the clipboard", state.enabled && clip === "second", JSON.stringify(state) + " clipboard=" + clip);
await app.close().catch(() => {});
console.log(results.every(Boolean) ? "EDIT MENU OK" : "EDIT MENU FAILED");
process.exit(results.every(Boolean) ? 0 : 1);

// ⌘A / ⌘X / ⌘V / ⌘Z / ⌘C typed into the Home chat box of the real app. The keys are sent as input events through the
// window's web contents (the path a pressed key takes: main process first, then the page), not by clicking menu items.
// Usage: node e2e/edit-keys.mjs
import { freshRun, launch } from "./lib.mjs";
const run = freshRun("edit-keys");
const { app, page } = await launch(run);
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };
const press = async (keyCode, modifiers = [process.platform === "darwin" ? "meta" : "control"]) => {
  await app.evaluate(({ BrowserWindow }, { keyCode, modifiers }) => { const contents = BrowserWindow.getAllWindows()[0].webContents; contents.sendInputEvent({ type: "keyDown", keyCode, modifiers }); contents.sendInputEvent({ type: "keyUp", keyCode, modifiers }); }, { keyCode, modifiers });
  await page.waitForTimeout(500);
};
const box = page.locator("textarea").first();
await box.waitFor({ timeout: 120_000 });
await box.click();
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.focus());
await box.fill("JAgentChill copy test");
const value = () => box.inputValue();
const sel = () => box.evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd));
await box.evaluate((el) => el.setSelectionRange(0, 0));
await press("A"); check("⌘A selects everything in the chat box", (await sel()) === "JAgentChill copy test", "selected=" + JSON.stringify(await sel()));
await press("X"); check("⌘X cuts it", (await value()) === "", "value=" + JSON.stringify(await value()));
await press("V"); check("⌘V pastes it back", (await value()) === "JAgentChill copy test", "value=" + JSON.stringify(await value()));
await press("Z"); check("⌘Z undoes the paste", (await value()) === "", "value=" + JSON.stringify(await value()));
await box.fill("second line"); await press("A"); await press("C");
const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
check("⌘C copies the selection", clip === "second line", "clipboard=" + JSON.stringify(clip));
await app.close().catch(() => {});
console.log(results.every(Boolean) ? "EDIT KEYS OK" : "EDIT KEYS FAILED");
process.exit(results.every(Boolean) ? 0 : 1);

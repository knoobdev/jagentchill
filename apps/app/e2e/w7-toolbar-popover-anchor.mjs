// W7 shared composer popover anchors. Local fake CLI runtimes only; this does not start a model turn.
// Usage: JAGENTCHILL_PORT=18995 JAGENTCHILL_GATEWAY_PORT=18996 node apps/app/e2e/w7-toolbar-popover-anchor.mjs --port 18995 --web http://localhost:8083 <shots-dir> [--assert]
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { createHarness, SAMPLE_MODELS } from "../../../server/test/harness.ts";
import { withSkillGateway, writeSkill } from "../../../server/test/support/skills.ts";

const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const port = Number(arg("--port"));
const web = arg("--web");
const shots = process.argv.slice(2).filter((value, index, all) => !["--port", "--web"].includes(value) && !["--port", "--web"].includes(all[index - 1]) && !value.startsWith("--"))[0];
const runDir = ".dev/run-w7n-popovers-1";
const dataDir = `${runDir}/data`;
const check = process.argv.includes("--assert");
const only = process.argv.includes("--only") ? arg("--only") : undefined;
if (port < 18995 || port > 18999 || Number(process.env.JAGENTCHILL_PORT) !== port || Number(process.env.JAGENTCHILL_GATEWAY_PORT) !== port + 1 || !web || !web.startsWith("http://localhost:8083") || !shots || existsSync(runDir)) throw new Error("Use a fresh W7 popover run directory, ports 18995–18999 and web 8083.");
mkdirSync(dataDir, { recursive: true });
mkdirSync(shots, { recursive: true });

let harness, browser;
try {
  harness = await createHarness({ dataDir, listenPort: port, allowedOrigins: [web], installed: ["claude", "codex"], models: SAMPLE_MODELS });
  const skillGateway = withSkillGateway(harness);
  writeSkill(skillGateway.managedSkillsDir, "popover-fixture", "A local fixture skill shown in the composer picker.");
  const admin = await harness.pair("Popover fixture admin", "admin");
  await admin.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: ["claude-code", "codex"] });
  await harness.settled();
  console.log(`FIXTURE RUNTIMES ${JSON.stringify((await admin.call("jagentchill.runtime.models.list", {})).groups.map((group) => ({ runtimeId: group.runtimeId, providers: group.providers.map((provider) => ({ providerId: provider.providerId, models: provider.models.map((model) => model.modelId) })) })))} `);
  console.log(`FIXTURE SKILLS ${JSON.stringify((await admin.call("jagentchill.skill.list", {})).skills.map((skill) => ({ name: skill.name, enabled: skill.enabled })))}`);
  const offer = (await admin.call("jagentchill.pairing.offer.create", { role: "admin" })).url;
  const codes = new Map();
  admin.events.push = (event) => { if (event.event === "jagentchill.pairing.requested") codes.set(event.payload.request.deviceName, event.payload.code); return 0; };
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 2000, height: 1100 }, colorScheme: "light" });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const tid = (name) => page.getByTestId(name);
  const button = (name) => page.getByRole("button", { name, exact: true }).filter({ visible: true }).first();
  const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
  const phase = check ? "after" : "before";
  const measure = async (where, name, trigger, prepare, keepOpen = false, expectedSide = "top", expectedAlign = "either", showBoxes = false) => {
    if (prepare) await prepare();
    const triggerBefore = await trigger.boundingBox();
    assert(triggerBefore, `${where} ${name} trigger box exists before opening`);
    const triggerNode = await trigger.elementHandle();
    assert(triggerNode, `${where} ${name} DOM trigger exists before opening`);
    await trigger.click();
    const pop = page.getByTestId("popover").filter({ visible: true }).last();
    await pop.waitFor();
    await page.waitForTimeout(220);
    // Some workflow layouts briefly expose a stale/duplicate toolbar control before opening. Measure the actual
    // activated control after the open transition; triggerBefore remains in the report to show any layout movement.
    const triggerAfter = await triggerNode.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    // Overflow menu rows disappear when their child picker opens; retain their last visible box in that case.
    const triggerBox = triggerAfter.width > 0 && triggerAfter.height > 0 ? triggerAfter : triggerBefore;
    const suffix = where.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const popoverBox = await pop.boundingBox();
    assert(triggerBox && popoverBox, `${where} ${name} boxes exist after opening`);
    const delta = { left: +(popoverBox.x - triggerBox.x).toFixed(2), right: +((popoverBox.x + popoverBox.width) - (triggerBox.x + triggerBox.width)).toFixed(2), above: +(triggerBox.y - (popoverBox.y + popoverBox.height)).toFixed(2), triggerBefore, triggerAfter, trigger: triggerBox, popover: popoverBox };
    if (showBoxes) await page.evaluate((boxes) => {
      const colors = ["#f00", "#0a0", "#06f"];
      boxes.forEach((box, index) => {
        const mark = document.createElement("div");
        mark.dataset.popoverDebugBox = String(index);
        Object.assign(mark.style, { position: "fixed", pointerEvents: "none", zIndex: "2147483647", left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px`, border: `2px ${index === 0 ? "dashed" : "solid"} ${colors[index]}`, boxSizing: "border-box" });
        document.body.append(mark);
      });
    }, [triggerBefore, triggerBox, popoverBox]);
    await shot(`${phase}-${suffix}-${name.toLowerCase()}-${page.viewportSize().width}`);
    if (showBoxes) await page.locator("[data-popover-debug-box]").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
    console.log(`MEASURE ${where} ${name} ${JSON.stringify(delta)}`);
    if (check) {
      const viewport = page.viewportSize();
      const leftAligned = Math.abs(delta.left) <= 8;
      const rightAligned = Math.abs(delta.right) <= 8;
      const requestedStart = triggerBox.x;
      const requestedEnd = triggerBox.x + triggerBox.width - popoverBox.width;
      const wouldOverflow = requestedStart + popoverBox.width > viewport.width - 8 || requestedEnd < 8;
      const viewportClamped = Math.abs(popoverBox.x - 8) <= 1 || Math.abs(popoverBox.x + popoverBox.width - (viewport.width - 8)) <= 1;
      if (expectedSide === "right") {
        assert(Math.abs(popoverBox.x - (triggerBox.x + triggerBox.width + 4)) <= 8 || viewportClamped, `${where} ${name}: submenu opens beside its row or is viewport-clamped; delta=${JSON.stringify(delta)}`);
        assert(popoverBox.y >= 0 && popoverBox.y + popoverBox.height <= viewport.height, `${where} ${name}: submenu is vertically inside viewport`);
      } else {
        assert(expectedAlign === "right" ? rightAligned : leftAligned || rightAligned || (wouldOverflow && viewportClamped), `${where} ${name}: ${expectedAlign === "right" ? "right-aligned" : "left/right aligned or explicitly viewport-clamped"}; delta=${JSON.stringify(delta)}`);
        assert(popoverBox.y + popoverBox.height <= triggerBox.y, `${where} ${name}: popover opens above trigger; delta=${JSON.stringify(delta)}`);
        assert(delta.above >= 4 && delta.above <= 8, `${where} ${name}: vertical gap is 4–8 px; delta=${JSON.stringify(delta)}`);
      }
      assert(popoverBox.x >= 0 && popoverBox.y >= 0 && popoverBox.x + popoverBox.width <= viewport.width && popoverBox.y + popoverBox.height <= viewport.height, `${where} ${name}: popover inside viewport`);
      const overlapX = Math.max(0, Math.min(popoverBox.x + popoverBox.width, triggerBox.x + triggerBox.width) - Math.max(popoverBox.x, triggerBox.x));
      const overlapY = Math.max(0, Math.min(popoverBox.y + popoverBox.height, triggerBox.y + triggerBox.height) - Math.max(popoverBox.y, triggerBox.y));
      assert(!(overlapX > 0 && overlapY > 0), `${where} ${name}: popover does not cover its trigger`);
    }
    if (!keepOpen) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(280);
      if (prepare) { await page.keyboard.press("Escape"); await page.waitForTimeout(280); }
    }
    return delta;
  };
  const pairBrowser = async () => {
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByLabel("Pairing link", { exact: true }).fill(offer);
    await page.getByLabel("Name of this device", { exact: true }).fill("Popover browser");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByText(/Enter the code shown next to/).waitFor();
    for (let n = 0; n < 100 && !codes.has("Popover browser"); n++) await page.waitForTimeout(50);
    await page.getByLabel("Verification code", { exact: true }).fill(codes.get("Popover browser"));
    await page.getByText("Connected", { exact: true }).waitFor();
  };

  await page.addInitScript(() => {
    localStorage.setItem("jagentchill.agents.models.draft", JSON.stringify({ v: 1, value: { runtimeId: "codex", providerId: "openai", modelId: "gpt-x" } }));
    localStorage.setItem("jagentchill.editor.agent-panel.width", JSON.stringify({ v: 1, value: 680 }));
  });
  await page.goto(`${web}/home`, { waitUntil: "networkidle" });
  await page.getByText("What do you want to make?").waitFor();
  await pairBrowser();
  if (only === "editor-resize-open") {
    page.setDefaultTimeout(8_000);
    await page.setViewportSize({ width: 2000, height: 1100 });
    await page.goto(`${web}/projects`, { waitUntil: "networkidle" });
    await button("New project").click();
    await page.waitForURL(/\/editor\/[^/]+$/);
    await tid("editor-regions").waitFor();
    await tid("toggle-agent").click();
    const panel = tid("agent-panel"); await panel.waitFor();
    const composer = tid("composer").filter({ visible: true }).last();
    const skills = composer.getByRole("button", { name: "Skills", exact: true }).filter({ visible: true }).last();
    await skills.waitFor(); await page.waitForTimeout(350);
    const initialTrigger = await skills.boundingBox(); assert(initialTrigger, "Editor Skills trigger box exists before opening");
    assert(await skills.elementHandle(), "Editor Skills trigger handle exists");
    await skills.click();
    const popover = tid("popover").filter({ visible: true }).last(); await popover.waitFor({ state: "visible" });
    await page.waitForTimeout(220);
    const boxOf = async (node) => node.evaluate((element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    const readOpen = async () => {
      const box = await popover.boundingBox().catch(() => null);
      const opacity = await popover.evaluate((node) => Number(getComputedStyle(node).opacity)).catch(() => 0);
      return opacity > 0.8 ? box : null;
    };
    const liveSkillsBox = () => composer.evaluate((node) => {
      const matches = [...node.querySelectorAll("button,[role='button']")].filter((element) => {
        const label = (element.getAttribute("aria-label") ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
        const r = element.getBoundingClientRect();
        if (label !== "Skills" || r.width <= 0 || r.height <= 0 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
        for (let parent = element; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || parent.getAttribute("aria-hidden") === "true") return false;
        }
        return true;
      });
      const rect = matches.at(-1)?.getBoundingClientRect();
      return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
    });
    const assertAnchored = async (where, previous) => {
      const popupBox = await readOpen();
      if (!popupBox) { console.log(`MEASURE ${where} Skills popover closed`); return false; }
      const triggerBox = await liveSkillsBox(), viewport = page.viewportSize();
      if (!triggerBox) {
        const controls = await composer.evaluate((node) => [...node.querySelectorAll("button,[role='button']")].map((element) => { const r = element.getBoundingClientRect(); return { label: element.getAttribute("aria-label") ?? element.textContent?.trim(), x: r.x, y: r.y, width: r.width, height: r.height }; }).filter((rect) => rect.width > 0 && rect.height > 0));
        console.log(`MEASURE ${where} visible composer controls ${JSON.stringify(controls)}`);
        await shot(`debug-${where.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}-missing-trigger`);
        assert(!(await readOpen()), `${where}: popover closes when Skills trigger leaves the toolbar`);
        console.log(`MEASURE ${where} Skills trigger left toolbar; popover closed`);
        return false;
      }
      const left = Math.abs(popupBox.x - triggerBox.x) <= 8;
      const right = Math.abs(popupBox.x + popupBox.width - triggerBox.x - triggerBox.width) <= 8;
      const gap = triggerBox.y - popupBox.y - popupBox.height;
      console.log(`MEASURE ${where} raw ${JSON.stringify({ trigger: triggerBox, popover: popupBox, viewport, left, right, gap })}`);
      await shot(`debug-${where.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`);
      assert(left || right || popupBox.x <= 8 || popupBox.x + popupBox.width >= viewport.width - 8, `${where}: popover follows or viewport-clamps against trigger`);
      assert(gap >= 4 && gap <= 8, `${where}: popover remains 4–8 px above trigger`);
      assert(popupBox.x >= 0 && popupBox.y >= 0 && popupBox.x + popupBox.width <= viewport.width && popupBox.y + popupBox.height <= viewport.height, `${where}: popover remains in viewport`);
      if (previous && Math.max(Math.abs(triggerBox.x - previous.trigger.x), Math.abs(triggerBox.y - previous.trigger.y)) > 1) {
        assert(Math.max(Math.abs(popupBox.x - previous.popover.x), Math.abs(popupBox.y - previous.popover.y)) > 1, `${where}: popover did not stay at its stale pre-change position`);
      }
      console.log(`MEASURE ${where} ${JSON.stringify({ trigger: triggerBox, popover: popupBox, gap })}`);
      return { trigger: triggerBox, popover: popupBox };
    };
    const initialPopup = await readOpen();
    assert(initialPopup, "Editor Skills popover opens before resize");
    await shot("after-editor-skills-open-2000");
    const initial = { trigger: initialTrigger, popover: initialPopup };
    await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(1200);
    const afterResize = await assertAnchored("Editor panel after viewport resize to 1440", initial);
    if (afterResize) await shot("after-editor-skills-open-resized-1440");
    await page.setViewportSize({ width: 2000, height: 1100 }); await page.waitForTimeout(500);
    const wideAgain = await assertAnchored("Editor panel after viewport restored to 2000", afterResize ?? initial);
    const splitter = tid("agent-panel-splitter");
    const splitterBox = await splitter.boundingBox(), panelBefore = await panel.boundingBox();
    assert(splitterBox && panelBefore, "Editor splitter and panel are measurable before drag");
    await page.mouse.move(splitterBox.x + splitterBox.width / 2, splitterBox.y + 300);
    await page.mouse.down();
    await page.mouse.move(splitterBox.x + splitterBox.width / 2 + 20, splitterBox.y + 300, { steps: 8 });
    await page.mouse.up(); await page.waitForTimeout(300);
    const panelAfter = await panel.boundingBox();
    const afterDrag = await assertAnchored("Editor panel during narrower splitter drag", wideAgain ?? initial);
    console.log(`MEASURE Editor panel drag ${JSON.stringify({ before: panelBefore, after: panelAfter, deltaWidth: panelAfter ? +(panelAfter.width - panelBefore.width).toFixed(2) : null, popupOpenAfter: Boolean(afterDrag) })}`);
    assert(panelAfter && Math.abs(panelAfter.width - panelBefore.width) > 10, "Editor agent panel width changes during splitter drag");
    if (await liveSkillsBox()) {
      assert(afterDrag, "Skills popover stays open and follows its trigger during splitter drag");
    } else assert(!(await readOpen()), "Skills popover closes if the splitter drag replaces its trigger with More settings");
    await shot("after-editor-skills-open-panel-drag");
    assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
    console.log(`SCREENSHOTS ${shots}`);
    console.log("CONTENT source: fake local Codex CLI runtime and SAMPLE_MODELS fixture; no model turn or provider request.");
    await browser.close(); browser = undefined;
    admin.ws.terminate(); harness.stop(); harness = undefined;
  } else if (only === "film-1920" || only === "script-1920") {
    page.setDefaultTimeout(8_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const isFilm = only === "film-1920";
    let composer;
    if (isFilm) {
      await page.goto(`${web}/h/${encodeURIComponent(admin.offer.gatewayId)}/film`, { waitUntil: "networkidle" });
      await button("New film").click();
      await page.waitForURL(/\/film\/[^/]+\/episode\/[^/]+\/story/);
      await button("Film assistant").click();
      const panel = tid("film-agent-panel"); await panel.waitFor();
      composer = panel.getByTestId("composer").filter({ visible: true }).last();
    } else {
      await page.goto(`${web}/scripts`, { waitUntil: "networkidle" });
      await button("New script").click();
      await page.waitForURL(/\/scripts\/[^/]+$/);
      await tid("script-editor").waitFor();
      const toggle = tid("toggle-agent");
      if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
      composer = tid("composer").filter({ visible: true }).last();
    }
    const model = composer.getByRole("button", { name: /gpt-x/ }).filter({ visible: true }).last();
    await model.waitFor(); await page.waitForTimeout(350);
    await shot(`after-${isFilm ? "film" : "script"}-toolbar-1920`);
    await measure(`${isFilm ? "Film Studio" : "Script Studio"} 1920`, "model", model);
    const skills = composer.getByRole("button", { name: "Skills", exact: true }).filter({ visible: true }).last();
    if (await skills.count()) await measure(`${isFilm ? "Film Studio" : "Script Studio"} 1920`, "Skills", skills);
    else {
      const moreSettings = composer.getByRole("button", { name: "More settings", exact: true }).filter({ visible: true }).last();
      const settingsMenu = page.getByRole("menu", { name: "More settings", exact: true }).filter({ visible: true }).last();
      await moreSettings.click(); await settingsMenu.waitFor({ state: "visible" }); await page.waitForTimeout(220);
      await measure(`${isFilm ? "Film Studio" : "Script Studio"} 1920 overflow`, "Skills", settingsMenu.getByRole("menuitem", { name: /Skills/ }).filter({ visible: true }).last());
    }
    assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
    console.log(`SCREENSHOTS ${shots}`);
    console.log("CONTENT source: fake local Codex CLI runtime and SAMPLE_MODELS fixture; no model turn or provider request.");
    await browser.close(); browser = undefined;
    admin.ws.terminate(); harness.stop(); harness = undefined;
  } else if (only === "slash-390") {
    page.setDefaultTimeout(8_000);
    const inspectPalette = async (where, composer) => {
      const input = composer.getByLabel("Message", { exact: true });
      await input.fill("/");
      const palette = composer.getByTestId("slash-command-menu");
      await palette.waitFor({ state: "visible" });
      await page.waitForTimeout(100);
      const composerBox = await composer.boundingBox(), contentBox = await composer.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.left + node.clientLeft, y: rect.top + node.clientTop, width: node.clientWidth, height: node.clientHeight };
      }), inputBox = await input.boundingBox(), paletteBox = await palette.boundingBox();
      assert(composerBox && contentBox && inputBox && paletteBox, `${where} slash palette boxes exist`);
      const innerEdge = { x: composerBox.x + 1, y: composerBox.y + 1, width: composerBox.width - 2, height: composerBox.height - 2 };
      const data = { composer: composerBox, content: contentBox, innerEdge, input: inputBox, palette: paletteBox, xDelta: +(paletteBox.x - innerEdge.x).toFixed(2), widthDelta: +(paletteBox.width - innerEdge.width).toFixed(2), gap: +(inputBox.y - (paletteBox.y + paletteBox.height)).toFixed(2) };
      console.log(`MEASURE ${where} slash-palette ${JSON.stringify(data)}`);
      assert(Math.abs(data.xDelta) <= 1, `${where} palette starts at the composer's left edge`);
      assert(Math.abs(data.widthDelta) <= 1, `${where} palette spans the composer's full width`);
      assert(data.gap >= -1 && data.gap <= 1, `${where} palette sits directly above the message field`);
      const viewport = page.viewportSize();
      assert(paletteBox.x >= 0 && paletteBox.y >= 0 && paletteBox.x + paletteBox.width <= viewport.width && paletteBox.y + paletteBox.height <= viewport.height, `${where} palette is inside the viewport`);
      await shot(`after-${where.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}-slash-390`);
      await input.fill("");
    };
    await page.setViewportSize({ width: 390, height: 844 });
    await inspectPalette("Home 390", tid("composer").filter({ visible: true }).first());
    const { session } = await admin.call("jagentchill.session.create", { ref: { runtimeId: "codex", providerId: "openai", modelId: "gpt-x" } });
    await admin.call("jagentchill.session.access.set", { sessionKey: session.sessionKey, access: "host" });
    await page.goto(`${web}/h/${encodeURIComponent(admin.offer.gatewayId)}/sessions/${encodeURIComponent(session.sessionKey)}`, { waitUntil: "networkidle" });
    const composer = tid("composer").filter({ visible: true }).last();
    await composer.getByLabel("Message", { exact: true }).waitFor();
    await inspectPalette("Session view 390", composer);
    assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
    console.log(`SCREENSHOTS ${shots}`);
    console.log("CONTENT source: fake local Codex CLI runtime and SAMPLE_MODELS fixture; no model turn or provider request.");
    await browser.close(); browser = undefined;
    admin.ws.terminate(); harness.stop(); harness = undefined;
  } else if (only === "workflow-1920") {
    page.setDefaultTimeout(8_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const workflow = await admin.call("jagentchill.workflow.create", { name: "Popover fixture workflow" });
    await page.goto(`${web}/h/${encodeURIComponent(admin.offer.gatewayId)}/workflows/${encodeURIComponent(workflow.document.id)}`, { waitUntil: "networkidle" });
    await tid("wf-canvas").waitFor();
    await tid("wf-toggle-agent").click();
    const panel = tid("wf-agent-panel"); await panel.waitFor();
    const composer = panel.getByTestId("composer").filter({ visible: true }).last();
    const attach = composer.getByRole("button", { name: "Attach", exact: true }).filter({ visible: true }).last();
    await attach.waitFor();
    let previous = null, stable = 0;
    for (let attempt = 0; attempt < 20 && stable < 3; attempt++) {
      const rect = await attach.boundingBox();
      if (!rect) throw new Error("Workflow Attach trigger disappeared during panel entrance");
      stable = previous && Math.max(Math.abs(rect.x - previous.x), Math.abs(rect.y - previous.y), Math.abs(rect.width - previous.width), Math.abs(rect.height - previous.height)) < 0.5 ? stable + 1 : 0;
      previous = rect;
      if (stable < 3) await page.waitForTimeout(50);
    }
    assert(stable >= 3, `Workflow Attach trigger settles before the menu is opened: ${JSON.stringify(previous)}`);
    await shot("after-workflow-toolbar-1920");
    await measure("Workflow panel 1920", "attach", attach, undefined, false, "top", "either", true);
    assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
    console.log(`SCREENSHOTS ${shots}`);
    console.log("CONTENT source: fake local Codex CLI runtime and SAMPLE_MODELS fixture; no model turn or provider request.");
    await browser.close(); browser = undefined;
    admin.ws.terminate(); harness.stop(); harness = undefined;
  } else if (only === "session-1440") {
    page.setDefaultTimeout(8_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const { session } = await admin.call("jagentchill.session.create", { ref: { runtimeId: "codex", providerId: "openai", modelId: "gpt-x" } });
    await admin.call("jagentchill.session.access.set", { sessionKey: session.sessionKey, access: "host" });
    await page.goto(`${web}/h/${encodeURIComponent(admin.offer.gatewayId)}/sessions/${encodeURIComponent(session.sessionKey)}`, { waitUntil: "networkidle" });
    const composer = tid("composer").filter({ visible: true }).last();
    await composer.getByRole("button", { name: /gpt-x/ }).waitFor({ timeout: 15_000 });
    await composer.getByRole("button", { name: /^Thinking:/ }).waitFor({ timeout: 15_000 });
    await shot("after-session-view-1440-toolbar");
    await measure("Session view 1440", "model", composer.getByRole("button", { name: /gpt-x/ }).filter({ visible: true }).last());
    await measure("Session view 1440", "attach", composer.getByRole("button", { name: "Attach", exact: true }).filter({ visible: true }).last());
    await measure("Session view 1440", "thinking", composer.getByRole("button", { name: /^Thinking:/ }).filter({ visible: true }).last());
    const options = composer.getByRole("button", { name: "Send options", exact: true }).filter({ visible: true }).last();
    const moreSettings = composer.getByRole("button", { name: "More settings", exact: true }).filter({ visible: true }).last();
    const settingsMenu = page.getByRole("menu", { name: "More settings", exact: true }).filter({ visible: true }).last();
    if (await options.count()) await measure("Session view 1440", "options", options);
    else if (await moreSettings.count()) await measure("Session view 1440", "options", moreSettings, undefined, true);
    else console.log("SKIP Session view 1440 options: no options control is rendered");
    const skills = composer.getByRole("button", { name: "Skills", exact: true }).filter({ visible: true }).last();
    if (await skills.count()) await measure("Session view 1440", "Skills", skills);
    else {
      const menuSkills = settingsMenu.getByRole("menuitem", { name: /Skills/ }).filter({ visible: true }).last();
      await measure("Session view 1440 overflow", "Skills", menuSkills);
    }
    const permission = composer.getByRole("button", { name: "Edit", exact: true }).filter({ visible: true }).last();
    if (await permission.count()) await measure("Session view 1440", "permission", permission);
    else {
      const menuPermission = settingsMenu.getByRole("menuitem", { name: /^Edit$/ }).filter({ visible: true }).last();
      if (!(await menuPermission.count())) {
        await moreSettings.click(); await settingsMenu.waitFor({ state: "visible" }); await page.waitForTimeout(220);
      }
      await measure("Session view 1440 overflow", "permission", menuPermission, undefined, false, "right");
    }
    // Mount the adjacent context meter in a clean screen state after measuring nested menu layers.
    await page.reload({ waitUntil: "networkidle" });
    const ring = tid("context-meter").filter({ visible: true }).last();
    await ring.waitFor({ state: "visible" });
    if (await ring.count()) {
      await measure("Session view 1440", "context-ring", ring, undefined, false, "top", "right");
    } else console.log("SKIP Session view 1440 context-ring: no context ring is rendered");
    assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
    console.log(`SCREENSHOTS ${shots}`);
    console.log("CONTENT source: fake local Codex CLI runtime and SAMPLE_MODELS fixture; no model turn or provider request.");
    await browser.close(); browser = undefined;
    admin.ws.terminate(); harness.stop(); harness = undefined;
  } else {
  const home = tid("composer").filter({ visible: true }).first();
  await home.getByRole("button", { name: /gpt-x/ }).filter({ visible: true }).first().waitFor({ timeout: 60_000 });
  await home.getByRole("button", { name: /^Thinking:/ }).waitFor();
  const homeSkills = home.getByRole("button", { name: "Skills", exact: true }).filter({ visible: true }).first();
  const homeModel = home.getByRole("button", { name: /gpt-x/ }).filter({ visible: true }).first();
  await shot(`${phase}-home-toolbar-2000`);
  await measure("Home 2000", "Skills", homeSkills);
  await measure("Home 2000", "model", homeModel);
  await measure("Home 2000", "attach", button("Attach"));
  await measure("Home 2000", "thinking", home.getByRole("button", { name: /^Thinking:/ }).filter({ visible: true }).first());
  await measure("Home 2000", "permission", button("Edit"));
  await measure("Home 2000", "target", button("Agent"));
  await home.getByLabel("Message", { exact: true }).fill("popover measurement draft");
  await measure("Home 2000", "send-options", button("Send options"));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await shot(`${phase}-home-toolbar-390`);
  const more = home.getByRole("button", { name: "More settings", exact: true }).filter({ visible: true }).first();
  if (await more.count()) await measure("Home 390", "More settings", more);
  // Reset the menu owner after measuring More settings so the overflow-row case starts from a clean surface state.
  await page.reload({ waitUntil: "networkidle" });
  await home.getByRole("button", { name: /gpt-x/ }).filter({ visible: true }).first().waitFor();
  const compactSkills = home.getByRole("button", { name: "Skills", exact: true }).filter({ visible: true }).first();
  if (await compactSkills.count()) await measure("Home 390", "Skills", compactSkills);
  else {
    const compactMore = home.getByRole("button", { name: "More settings", exact: true }).filter({ visible: true }).first();
    const moreMenu = page.getByRole("menu", { name: "More settings", exact: true }).filter({ visible: true }).last();
    const menuSkills = moreMenu.getByRole("menuitem", { name: /Skills/ }).filter({ visible: true }).first();
    await measure("Home 390 overflow", "Skills", menuSkills, async () => {
      await compactMore.click();
      await moreMenu.waitFor({ state: "visible" });
      await menuSkills.waitFor();
      await page.waitForTimeout(350);
    });
  }
  const compactModel = home.getByRole("button", { name: /gpt-x/ }).filter({ visible: true }).first();
  await measure("Home 390", "model", compactModel);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  const mediumSkills = home.getByRole("button", { name: "Skills", exact: true }).filter({ visible: true }).first();
  const mediumModel = home.getByRole("button", { name: /gpt-x/ }).filter({ visible: true }).first();
  await measure("Home 1440", "Skills", mediumSkills);
  await measure("Home 1440", "model", mediumModel);

  await page.setViewportSize({ width: 2000, height: 1100 });
  await page.waitForTimeout(300);
  await page.goto(`${web}/projects`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.waitForURL(/\/editor\/[^/]+$/);
  await tid("editor-regions").waitFor();
  await tid("toggle-agent").click();
  const editor = tid("composer").filter({ visible: true }).last();
  await editor.getByRole("button", { name: "Attach", exact: true }).waitFor();
  await page.waitForTimeout(1000);
  if (!(await editor.getByRole("button", { name: /^Thinking:/ }).count())) console.log("SKIP Editor right panel: Thinking control not rendered for the selected fake CLI model");
  console.log(`EDITOR BOXES ${JSON.stringify(await page.evaluate(() => ({ viewport: [innerWidth, innerHeight], panel: document.querySelector('[data-testid="agent-panel"]')?.getBoundingClientRect().toJSON(), slot: document.querySelector('[data-testid="agent-panel-slot"]')?.getBoundingClientRect().toJSON(), composer: document.querySelector('[data-testid="composer"]')?.getBoundingClientRect().toJSON() })))} `);
  const editorSkills = editor.getByRole("button", { name: "Skills", exact: true }).filter({ visible: true }).first();
  const editorModel = editor.getByRole("button", { name: /gpt-x/ }).filter({ visible: true }).first();
  await shot("before-editor-right-wide");
  for (const [name, locator] of [["Skills", editorSkills], ["model", editorModel], ["attach", editor.getByRole("button", { name: "Attach", exact: true }).filter({ visible: true }).first()], ["thinking", editor.getByRole("button", { name: /^Thinking:/ }).filter({ visible: true }).first()], ["permission", editor.getByRole("button", { name: "Edit", exact: true }).filter({ visible: true }).first()]]) {
    if (await locator.count()) await measure("Editor right panel 2000", name, locator);
    else console.log(`SKIP Editor right panel 2000 ${name}: trigger not rendered`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  await measure("Editor right panel resized 1440", "Skills", editor.getByRole("button", { name: "Skills", exact: true }).filter({ visible: true }).first());
  await measure("Editor right panel resized 1440", "model", editor.getByRole("button", { name: /gpt-x/ }).filter({ visible: true }).first());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await shot("after-editor-right-toolbar-390");
  const narrowEditorSkills = editor.getByRole("button", { name: "Skills", exact: true }).filter({ visible: true }).first();
  if (await narrowEditorSkills.count()) await measure("Editor right panel resized 390", "Skills", narrowEditorSkills);
  else {
    const narrowMore = editor.getByRole("button", { name: "More settings", exact: true }).filter({ visible: true }).first();
    if (await narrowMore.count()) {
      const narrowMenu = page.getByRole("menu", { name: "More settings", exact: true }).filter({ visible: true }).last();
      const narrowMenuSkills = narrowMenu.getByRole("menuitem", { name: /Skills/ }).filter({ visible: true }).first();
      await measure("Editor right panel resized 390 overflow", "Skills", narrowMenuSkills, async () => {
        await narrowMore.click();
        await narrowMenu.waitFor({ state: "visible" });
        await narrowMenuSkills.waitFor();
        await page.waitForTimeout(350);
      });
    } else console.log("SKIP Editor right panel 390: agent composer is not rendered at this viewport");
  }
  const narrowEditorModel = editor.getByRole("button", { name: /gpt-x/ }).filter({ visible: true }).first();
  if (await narrowEditorModel.count()) await measure("Editor right panel resized 390", "model", narrowEditorModel);

  const measureComposer = async (where, composer) => {
    const run = async (name, locator) => {
      if (await locator.count()) await measure(where, name, locator.first());
      else console.log(`SKIP ${where} ${name} trigger is not rendered`);
    };
    await run("attach", composer.getByRole("button", { name: "Attach", exact: true }).filter({ visible: true }));
    await run("model", composer.getByRole("button", { name: /gpt-x/ }).filter({ visible: true }));
    await run("thinking", composer.getByRole("button", { name: /^Thinking:/ }).filter({ visible: true }));
    await run("permission", composer.getByRole("button", { name: "Edit", exact: true }).filter({ visible: true }));
    await run("Skills", composer.getByRole("button", { name: "Skills", exact: true }).filter({ visible: true }));
  };

  await page.setViewportSize({ width: 1920, height: 1080 });
  const workflow = await admin.call("jagentchill.workflow.create", { name: "Popover fixture workflow" });
  await page.goto(`${web}/h/${encodeURIComponent(admin.offer.gatewayId)}/workflows/${encodeURIComponent(workflow.document.id)}`, { waitUntil: "networkidle" });
  await tid("wf-canvas").waitFor();
  await tid("wf-toggle-agent").click();
  const workflowPanel = tid("wf-agent-panel");
  await workflowPanel.waitFor();
  const workflowComposer = workflowPanel.getByTestId("composer").filter({ visible: true }).last();
  await workflowComposer.getByRole("button", { name: /gpt-x/ }).waitFor();
  await shot("after-workflow-toolbar-1920");
  await measureComposer("Workflow panel 1920", workflowComposer);

  await page.goto(`${web}/h/${encodeURIComponent(admin.offer.gatewayId)}/film`, { waitUntil: "networkidle" });
  await button("New film").click();
  await page.waitForURL(/\/film\/[^/]+\/episode\/[^/]+\/story/);
  await button("Film assistant").click();
  const filmPanel = tid("film-agent-panel");
  await filmPanel.waitFor();
  const filmComposer = filmPanel.getByTestId("composer").filter({ visible: true }).last();
  await filmComposer.getByRole("button", { name: /gpt-x/ }).waitFor();
  await shot("after-film-toolbar-1920");
  await measureComposer("Film Studio panel 1920", filmComposer);

  await page.goto(`${web}/scripts`, { waitUntil: "networkidle" });
  await button("New script").click();
  await page.waitForURL(/\/scripts\/[^/]+$/);
  await tid("script-editor").waitFor();
  if (await tid("toggle-agent").getAttribute("aria-pressed") !== "true") await tid("toggle-agent").click();
  const scriptComposer = tid("composer").filter({ visible: true }).last();
  await scriptComposer.getByRole("button", { name: /gpt-x/ }).waitFor();
  await shot("after-script-toolbar-1920");
  await measureComposer("Script Studio panel 1920", scriptComposer);

  assert.deepEqual(errors, [], `browser errors: ${errors.join("; ")}`);
  console.log(`SCREENSHOTS ${shots}`);
  console.log("CONTENT source: fake local Codex CLI runtime and SAMPLE_MODELS fixture; no model turn or provider request.");
  await browser.close(); browser = undefined;
  admin.ws.terminate(); harness.stop(); harness = undefined;
  }
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (harness) harness.stop();
}

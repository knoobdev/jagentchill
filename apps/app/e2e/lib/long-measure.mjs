// The measuring half of the long-chat part of chat-w7.mjs (brief w7-chat item 1): opens ONE seeded session on one build
// in a browser that has never seen it and measures — first paint of the last messages, bytes of history, what is
// mounted, memory, scrolling up, whether the reader's place is held, opening again. A module of its own so that the
// seeded host can stay up while builds (and this file) change: chat-w7.mjs loads it anew for every measurement.
import { writeFileSync } from "node:fs";

export async function measureLong({ browser, setup, codes, gatewayId, sessionKey, LAST, shots, report }, label, url) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "light" });
    const tab = await ctx.newPage();
    const cdp = await ctx.newCDPSession(tab);
    await cdp.send("Performance.enable");
    const history = { requests: 0, bytes: 0, ids: new Set() };
    tab.on("websocket", (socket) => {
      socket.on("framesent", ({ payload }) => { if (typeof payload === "string" && payload.includes('"jagentchill.chat.history"')) { try { history.ids.add(JSON.parse(payload).id); history.requests += 1; } catch { /* not a request */ } } });
      socket.on("framereceived", ({ payload }) => { if (typeof payload === "string" && payload.startsWith('{"t":"res"')) { const id = /"id":"([^"]+)"/.exec(payload.slice(0, 80))?.[1]; if (id && history.ids.has(id)) history.bytes += Buffer.byteLength(payload); } });
    });
    await tab.addInitScript((last) => {
      window.__long = { firstPaint: null, tasks: [], frames: [] };
      new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__long.tasks.push({ at: performance.timeOrigin + entry.startTime, ms: entry.duration }); }).observe({ entryTypes: ["longtask"] });
      let before = performance.now();
      const tick = (now) => {
        window.__long.frames.push({ at: performance.timeOrigin + now, ms: now - before }); before = now;
        if (window.__long.frames.length > 4000) window.__long.frames.shift();
        if (window.__long.firstPaint === null && document.querySelector('[data-testid="chat-scroll"]')?.textContent?.includes(last)) {
          const row = [...document.querySelectorAll('[data-testid="assistant-message"]')].find((node) => node.textContent.includes(last));
          const box = row?.getBoundingClientRect();
          if (box && box.bottom > 0 && box.top < window.innerHeight) window.__long.firstPaint = Date.now();
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, LAST);
    const see = (id) => tab.getByTestId(id).filter({ visible: true }).first();
    const offer = (await setup.call("jagentchill.pairing.offer.create", { role: "admin" })).url, device = `Long ${label} ${Date.now() % 100000}`;
    await tab.goto(`${url}/pair/start`, { waitUntil: "networkidle", timeout: 180_000 });
    await tab.getByLabel("Pairing link", { exact: true }).fill(offer);
    await tab.getByLabel("Name of this device", { exact: true }).fill(device);
    await tab.getByRole("button", { name: "Continue" }).filter({ visible: true }).first().click();
    await tab.getByText(/next to [0-9a-f]{8}/).waitFor();
    for (let wait = 0; wait < 80 && !codes.has(device); wait++) await tab.waitForTimeout(100);
    await tab.getByTestId("pairing-verification-code").fill(codes.get(device));
    await tab.waitForTimeout(300);
    const route = `${url}/h/${gatewayId}/sessions/${encodeURIComponent(sessionKey)}`;
    const heap = async () => Math.round(((await cdp.send("Performance.getMetrics")).metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? 0) / 1e6 * 10) / 10;
    const mounted = () => tab.evaluate(() => { const root = document.querySelector('[data-testid="chat-scroll"]'); return { nodes: root ? root.querySelectorAll("*").length : 0, assistant: root?.querySelectorAll('[data-testid="assistant-message"]').length ?? 0, groups: root?.querySelectorAll('[data-testid="activity-group"]').length ?? 0, proposals: root?.querySelectorAll('[data-testid="proposal-card"]').length ?? 0 }; });
    /** Opens the route; ms until the last answer is painted inside the viewport, and until the main thread was quiet for 1 s. */
    const openOnce = async () => {
      Object.assign(history, { requests: 0, bytes: 0 }); history.ids.clear();
      const t0 = Date.now();
      await tab.goto(route, { waitUntil: "commit" });
      await tab.waitForFunction(() => window.__long?.firstPaint, null, { timeout: 180_000, polling: 50 });
      const painted = await tab.evaluate(() => window.__long.firstPaint);
      // Quiet: one second with no task over 50 ms and no frame over 50 ms.
      let quietAt = null;
      for (let waited = 0; waited < 60_000 && quietAt === null; waited += 250) {
        await tab.waitForTimeout(250);
        const lastBusy = await tab.evaluate(() => Math.max(0, ...window.__long.tasks.map((task) => task.at + task.ms), ...window.__long.frames.filter((frame) => frame.ms > 50).map((frame) => frame.at)));
        if (Date.now() - Math.max(lastBusy, painted) >= 1000) quietAt = Math.max(lastBusy, painted);
      }
      return { first_paint_of_last_messages_ms: painted - t0, main_thread_quiet_ms: quietAt === null ? null : Math.round(quietAt - t0), history_requests: history.requests, history_bytes: history.bytes };
    };
    const cold = await openOnce();
    await tab.waitForTimeout(500);
    const afterOpen = { ...(await mounted()), heap_mb: await heap() };
    await tab.screenshot({ path: `${shots}/long-${label}-1-opened.png` });
    // Test-only writer/frame recorder for the W11 jump investigation. Setters are wrapped on this page's live list
    // and content style; each animation-frame sample also records the virtual window, loading state and visible row.
    const installScrollTrace = async () => tab.evaluate(() => {
      const list = document.querySelector('[data-testid="chat-scroll"]');
      if (!list || window.__w11ScrollTrace) return;
      const trace = window.__w11ScrollTrace = { frames: [], writers: [], list };
      const own = Object.getOwnPropertyDescriptor(list, "scrollTop");
      let proto = Object.getPrototypeOf(list), inherited;
      while (proto && !inherited) { inherited = Object.getOwnPropertyDescriptor(proto, "scrollTop"); proto = Object.getPrototypeOf(proto); }
      const nativeGet = own?.get ?? inherited?.get, nativeSet = own?.set ?? inherited?.set;
      if (nativeGet && nativeSet) Object.defineProperty(list, "scrollTop", { configurable: true, get() { return nativeGet.call(this); }, set(value) { trace.writers.push({ kind: "scrollTop", value, stack: new Error().stack }); nativeSet.call(this, value); } });
      for (const method of ["scrollTo", "scrollBy", "scrollIntoView"]) {
        const native = list[method];
        if (typeof native === "function") Object.defineProperty(list, method, { configurable: true, value(...args) { trace.writers.push({ kind: method, args, stack: new Error().stack }); return native.apply(this, args); } });
      }
      const contentStyle = list.firstElementChild?.style;
      let styleProto = Object.getPrototypeOf(contentStyle), transform;
      while (styleProto && !transform) { transform = Object.getOwnPropertyDescriptor(styleProto, "transform"); styleProto = Object.getPrototypeOf(styleProto); }
      const nativeGetProperty = CSSStyleDeclaration.prototype.getPropertyValue, nativeSetProperty = CSSStyleDeclaration.prototype.setProperty;
      if (contentStyle) Object.defineProperty(contentStyle, "transform", { configurable: true, enumerable: true, get() { return transform?.get ? transform.get.call(this) : nativeGetProperty.call(this, "transform"); }, set(value) { trace.writers.push({ kind: "transform", value, stack: new Error().stack }); if (transform?.set) transform.set.call(this, value); else if (value) nativeSetProperty.call(this, "transform", value); else this.removeProperty("transform"); } });
      const frame = () => {
        const box = list.getBoundingClientRect(), win = list.querySelector('[data-testid="chat-window"]');
        const rows = [...list.querySelectorAll("[data-wkey]")];
        const visible = rows.find((row) => { const r = row.getBoundingClientRect(); return r.bottom > box.top + 1 && r.top < box.bottom - 1; });
        const held = trace.heldAnchor ?? null;
        const marked = list.querySelector('[data-step]');
        trace.frames.push({ at: performance.now(), scrollTop: list.scrollTop, scrollHeight: list.scrollHeight, transform: getComputedStyle(list.firstElementChild ?? list).transform, compensation: trace.compensation ?? null, heldKey: held?.key ?? visible?.dataset.wkey ?? null, heldOffset: held?.offset ?? (visible ? visible.getBoundingClientRect().top - box.top : null), markedKey: marked?.dataset.wkey ?? null, markedOffset: marked ? marked.getBoundingClientRect().top - box.top : null, markedMounted: Boolean(marked), window: win ? [win.dataset.first, win.dataset.end] : null, loadingOlder: Boolean(trace.loadingOlder ?? list.querySelector('[data-testid="chat-loading-older"]')), hasOlder: trace.hasOlder ?? null });
        if (trace.active) requestAnimationFrame(frame);
      };
      trace.active = true; requestAnimationFrame(frame);
    });
    // Scrolling up: 40 wheel steps of 600 px; the frames while it scrolls, and where a row that was on screen ends up
    // when older messages are put above it.
    await see("chat-scroll").hover();
    await installScrollTrace();
    await tab.evaluate(() => { window.__long.frames = []; window.__long.tasks = []; });
    const scrollStart = Date.now();
    let jumps = 0, worstJump = 0, checked = 0, noRowInView = 0, rowGone = 0, blankViewport = 0;
    const jumpSamples = [];
    // Before every wheel step a row in the middle of the viewport is marked; after it the same row must have moved
    // down by what was scrolled (0…600 px, a little more while the browser finishes the step before) — anything else is
    // the list jumping under the reader (older messages put in above it, rows re-measured).
    const mark = (n) => tab.evaluate((step) => { const list = document.querySelector('[data-testid="chat-scroll"]'), rows = [...list.querySelectorAll('[data-testid="assistant-message"]')].filter((node) => { const box = node.getBoundingClientRect(); return box.top > 70 && box.top < window.innerHeight - 220; }); const row = rows[0], box = list.getBoundingClientRect(); if (!row) return null; row.setAttribute("data-step", String(step)); return { top: row.getBoundingClientRect().top - box.top, scrollTop: list.scrollTop, key: row.closest("[data-wkey]")?.dataset.wkey ?? null }; }, n);
    const where = (n) => tab.evaluate((step) => { const list = document.querySelector('[data-testid="chat-scroll"]'), row = list.querySelector(`[data-step="${step}"]`); if (!row) return null; const win = list.querySelector('[data-testid="chat-window"]'), box = list.getBoundingClientRect(); return { top: row.getBoundingClientRect().top - box.top, scrollTop: list.scrollTop, compensation: window.__w11ScrollTrace?.compensation ?? 0, key: row.closest("[data-wkey]")?.dataset.wkey ?? null, transform: getComputedStyle(list.firstElementChild ?? list).transform, window: win ? [win.dataset.first, win.dataset.end] : null, loadingOlder: Boolean(window.__w11ScrollTrace?.loadingOlder), hasOlder: window.__w11ScrollTrace?.hasOlder ?? null }; }, n);
    for (let step = 0; step < 40; step++) {
      const before = await mark(step);
      await tab.mouse.wheel(0, -600);
      await tab.waitForTimeout(60);
      const after = await where(step);
      if (before === null) noRowInView += 1; else if (after === null) rowGone += 1;
      // Is anything of the conversation drawn in the viewport right after the step (or only a spacer)?
      if (await tab.evaluate(() => { const list = document.querySelector('[data-testid="chat-scroll"]'), box = list.getBoundingClientRect(); const rows = [...list.querySelectorAll('[data-testid="assistant-message"],[data-testid="activity-group"],[data-testid="proposal-card"],[data-testid="chat-loading-older"]')]; return !rows.some((node) => { const r = node.getBoundingClientRect(); return r.bottom > box.top + 40 && r.top < box.bottom - 40; }); })) blankViewport += 1;
      if (before !== null && after !== null) { checked += 1; const syntheticMove = after.hasOlder === false && after.compensation > before.compensation ? after.compensation - before.compensation : 0; const moved = after.top - before.top + after.scrollTop - before.scrollTop - syntheticMove; if (Math.abs(moved) > 2) { jumps += 1; worstJump = Math.max(worstJump, Math.abs(moved)); jumpSamples.push({ step, readerKey: before.key, rowLayoutShiftPx: Math.round(moved * 10) / 10, expectedSyntheticMovementPx: syntheticMove, before, after }); } }
    }
    await tab.waitForTimeout(1200);
    const frames = await tab.evaluate(() => ({ frames: window.__long.frames.map((frame) => frame.ms), tasks: window.__long.tasks.map((task) => task.ms) }));
    const sorted = [...frames.frames].sort((a, b) => a - b);
    const scrollTrace = await tab.evaluate(() => { const trace = window.__w11ScrollTrace; trace.active = false; return { frames: trace.frames, writers: trace.writers }; });
    writeFileSync(`${shots}/long-${label}-scroll-trace.json`, JSON.stringify(scrollTrace));
    const scrolled = { seconds: Math.round((Date.now() - scrollStart) / 100) / 10, frame_ms_p50: Math.round(sorted[Math.floor(sorted.length * 0.5)] ?? 0), frame_ms_p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0), frame_ms_max: Math.round(sorted.at(-1) ?? 0), frames_over_50ms: sorted.filter((ms) => ms > 50).length, long_tasks: frames.tasks.length, longest_task_ms: Math.round(Math.max(0, ...frames.tasks)), steps_checked_for_a_jump: checked, steps_with_no_answer_row_in_view: noRowInView, steps_whose_row_was_unmounted: rowGone, steps_with_nothing_drawn_in_the_viewport: blankViewport, list_jumps_under_the_reader: jumps, worst_jump_px: Math.round(worstJump), jump_samples: jumpSamples, history_requests_total: history.requests, history_bytes_total: history.bytes, per_frame_samples: scrollTrace.frames.length, scrollTop_writers: scrollTrace.writers.filter((writer) => writer.kind === "scrollTop").length, transform_writers: scrollTrace.writers.filter((writer) => writer.kind === "transform").length };
    console.log(`numbers w11-40-step-${label}: ${JSON.stringify(scrolled)}`);
    await tab.screenshot({ path: `${shots}/long-${label}-40-step-reader.png` });
    if (process.env.W11_DIAG_ONLY === "1" && jumps !== 0) throw new Error(`40-step reader row moved ${worstJump}px after accounting for scrollTop`);
    const afterScroll = { ...(await mounted()), heap_mb: await heap(), oldest_turn_on_screen: await tab.evaluate(() => { const text = document.querySelector('[data-testid="chat-scroll"]')?.textContent ?? ""; const turns = [...text.matchAll(/Turn (\d+):/g)].map((match) => Number(match[1])); return turns.length ? Math.min(...turns) : null; }) };
    // W11: record the actual scroll offset every animation frame while real CDP wheel events are sent in one
    // direction. Unlike the older reach check above, this catches a backwards jump during downward paging.
    const directedWheel = async (width, height) => {
      await tab.setViewportSize({ width, height });
      await tab.waitForTimeout(250);
      const list = await see("chat-scroll").evaluate((node) => {
        node.scrollTop = 0;
        return { x: Math.round(node.getBoundingClientRect().left + node.clientWidth / 2), y: Math.round(node.getBoundingClientRect().top + node.clientHeight / 2) };
      });
      await tab.waitForTimeout(250);
      const run = async (direction, stopAt, maxEvents = 2400) => {
        await tab.evaluate((dir) => { window.__directedScroll = { direction: dir, values: [] }; const list = document.querySelector('[data-testid="chat-scroll"]'); const sample = () => { window.__directedScroll.values.push(list?.scrollTop ?? 0); if (window.__directedScroll.values.length < 30000) requestAnimationFrame(sample); }; requestAnimationFrame(sample); }, direction);
        let stable = 0, before = await see("chat-scroll").evaluate((node) => node.scrollTop), sent = 0;
        for (; sent < maxEvents && stable < 12; sent++) {
          await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: list.x, y: list.y, deltaX: 0, deltaY: direction === "down" ? 40 : -40 });
          await tab.waitForTimeout(16);
          const now = await see("chat-scroll").evaluate((node) => node.scrollTop);
          stable = Math.abs(now - before) < 1 ? stable + 1 : 0;
          before = now;
          const maxTop = await see("chat-scroll").evaluate((node) => node.scrollHeight - node.clientHeight);
          if (stopAt === "bottom" && now >= maxTop - 1) break;
          if (stopAt === "middle" && direction === "up" && now <= maxTop / 2) break;
        }
        await tab.waitForTimeout(100);
        return await tab.evaluate(() => {
          const values = window.__directedScroll?.values ?? [];
          let jumps = 0, worst = 0;
          for (let i = 1; i < values.length; i++) {
            const delta = values[i] - values[i - 1], wrong = window.__directedScroll.direction === "down" ? delta < -2 : delta > 2;
            if (wrong) { jumps++; worst = Math.max(worst, Math.abs(delta)); }
          }
          const list = document.querySelector('[data-testid="chat-scroll"]');
          return { frames: values.length, wrong_direction_frames: jumps, worst_wrong_direction_px: Math.round(worst * 10) / 10, final_top: Math.round(list?.scrollTop ?? 0), max_top: Math.round((list?.scrollHeight ?? 0) - (list?.clientHeight ?? 0)) };
        }).then((result) => ({ ...result, wheel_events: sent }));
      };
      const downFromTop = await run("down", "bottom");
      const bottom = await see("chat-scroll").evaluate((node) => Math.round(node.scrollTop));
      const upToMiddle = await run("up", "middle");
      const middle = await see("chat-scroll").evaluate((node) => Math.round(node.scrollTop));
      const downAgain = await run("down", "bottom");
      await tab.screenshot({ path: `${shots}/w11-${label}-directed-wheel-${width}x${height}.png` });
      return { viewport: `${width}x${height}`, bottom_top: bottom, middle_top: middle, down_from_top: downFromTop, up_to_middle: upToMiddle, down_again: downAgain };
    };
    const directedWheelResults = process.env.W11_DIAG_ONLY === "1" ? [] : [await directedWheel(1440, 900), await directedWheel(1100, 700)];
    console.log(`numbers w11-directed-wheel-${label}: ${JSON.stringify(directedWheelResults)}`);
    const randomWalk = async (width, height, seed) => {
      await tab.setViewportSize({ width, height }); await tab.waitForTimeout(200);
      const point = await see("chat-scroll").evaluate((node) => { node.scrollTop = 1000; const r = node.getBoundingClientRect(); return { x: Math.round(r.left + node.clientWidth / 2), y: Math.round(r.top + node.clientHeight / 2) }; });
      await tab.waitForTimeout(150);
      const result = await tab.evaluate(() => {
        const list = document.querySelector('[data-testid="chat-scroll"]'), trace = window.__w11ScrollTrace;
        const state = window.__w11RandomTrace = { frames: [], steps: [], active: true, list };
        const tick = () => {
          const box = list.getBoundingClientRect(), win = list.querySelector('[data-testid="chat-window"]');
          const anchor = trace?.heldAnchor ?? null;
          const node = anchor ? [...list.querySelectorAll("[data-wkey]")].find((row) => row.dataset.wkey === anchor.key) : null;
          state.frames.push({ at: performance.now(), top: list.scrollTop, height: list.scrollHeight, transform: getComputedStyle(list.firstElementChild ?? list).transform, compensation: trace?.compensation ?? null, heldKey: anchor?.key ?? null, heldOffset: anchor?.offset ?? null, heldMounted: Boolean(node), heldRectOffset: node ? node.getBoundingClientRect().top - box.top : null, window: win ? [win.dataset.first, win.dataset.end] : null, loadingOlder: Boolean(trace?.loadingOlder ?? list.querySelector('[data-testid="chat-loading-older"]')), hasOlder: trace?.hasOlder ?? null, writerCount: trace?.writers.length ?? 0 });
          if (state.active) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        return true;
      });
      if (!result) throw new Error("random walk sampler did not start");
      let random = seed >>> 0;
      const next = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 0x100000000; };
      for (let index = 0; index < 200; index++) {
        const deltaY = index === 0 ? -600 : Math.round((next() < 0.5 ? -1 : 1) * (100 + next() * 2900));
        const firstFrame = await tab.evaluate(() => window.__w11RandomTrace.frames.length);
        let remaining = Math.abs(deltaY), measured = 0, unmounted = 0, worstShift = 0, maxTop = 0, finalTop = 0;
        const direction = Math.sign(deltaY), substepShifts = [];
        for (let part = 0; remaining > 0; part++) {
          const amount = Math.min(100, remaining), wheelDelta = direction * amount, marker = `${index}-${part}`;
          const beforeState = await see("chat-scroll").evaluate((node, key) => {
            const bounds = node.getBoundingClientRect(), row = [...node.querySelectorAll('[data-testid="assistant-message"]')].find((entry) => { const r = entry.getBoundingClientRect(); return r.top > bounds.top && r.top < bounds.bottom; });
            if (row) row.setAttribute("data-w11-random-anchor", key);
            return { top: Math.round(node.scrollTop), compensation: window.__w11ScrollTrace?.compensation ?? 0, hasOlder: window.__w11ScrollTrace?.hasOlder ?? null, rowKey: row?.closest("[data-wkey]")?.dataset.wkey ?? null, rowOffset: row ? row.getBoundingClientRect().top - bounds.top : null };
          }, marker);
          await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: wheelDelta });
          await tab.waitForTimeout(16);
          const afterState = await tab.evaluate((key) => { const node = document.querySelector('[data-testid="chat-scroll"]'), row = node.querySelector(`[data-w11-random-anchor="${key}"]`); const result = { top: Math.round(node.scrollTop), compensation: window.__w11ScrollTrace?.compensation ?? 0, hasOlder: window.__w11ScrollTrace?.hasOlder ?? null, rowKey: row?.closest("[data-wkey]")?.dataset.wkey ?? null, rowOffset: row ? row.getBoundingClientRect().top - node.getBoundingClientRect().top : null }; row?.removeAttribute("data-w11-random-anchor"); return result; }, marker);
          const syntheticMove = afterState.hasOlder === false && afterState.compensation > beforeState.compensation ? afterState.compensation - beforeState.compensation : 0;
          const shift = beforeState.rowKey && afterState.rowKey === beforeState.rowKey && afterState.rowOffset !== null ? afterState.rowOffset - beforeState.rowOffset + afterState.top - beforeState.top - syntheticMove : null;
          if (shift === null) unmounted++; else { measured++; worstShift = Math.max(worstShift, Math.abs(shift)); substepShifts.push({ deltaY: wheelDelta, readerKey: beforeState.rowKey, layoutShiftPx: Math.round(shift * 10) / 10, expectedSyntheticMovementPx: syntheticMove, before: beforeState, after: afterState }); }
          finalTop = afterState.top; maxTop = await see("chat-scroll").evaluate((node) => node.scrollHeight - node.clientHeight);
          remaining -= amount;
        }
        const pause = index === 0 ? 300 : Math.round(next() * 300); await tab.waitForTimeout(pause);
        await tab.evaluate(({ step, delta, pauseMs, sampleStart, measuredSubsteps, unmountedSubsteps, worst, shifts, final, max }) => window.__w11RandomTrace.steps.push({ step, deltaY: delta, pause_ms: pauseMs, measured_substeps: measuredSubsteps, unmounted_substeps: unmountedSubsteps, reader_row_layout_shift_px: worst, substep_shifts: shifts, final_top: final, max_top: max, firstFrame: sampleStart, lastFrame: window.__w11RandomTrace.frames.length }), { step: index, delta: deltaY, pauseMs: pause, sampleStart: firstFrame, measuredSubsteps: measured, unmountedSubsteps: unmounted, worst: worstShift, shifts: substepShifts, final: finalTop, max: maxTop });
      }
      await tab.waitForTimeout(200);
      const data = await tab.evaluate((seed) => { const state = window.__w11RandomTrace, trace = window.__w11ScrollTrace, measured = state.steps.filter((step) => step.reader_row_layout_shift_px !== null); state.active = false; return { seed, steps: state.steps, frames: state.frames, writers: trace?.writers ?? [], measured_row_steps: measured.length, unmounted_row_steps: state.steps.length - measured.length, reader_row_jumps_over_2px: measured.filter((step) => Math.abs(step.reader_row_layout_shift_px) > 2).length, worst_reader_row_shift_px: Math.max(0, ...measured.map((step) => Math.abs(step.reader_row_layout_shift_px))), older_page_loading_frames: state.frames.filter((frame) => frame.loadingOlder).length, older_pages_remaining_at_end: state.frames.at(-1)?.hasOlder ?? null, final_top: Math.round(state.list.scrollTop), max_top: Math.round(state.list.scrollHeight - state.list.clientHeight) }; }, seed);
      await tab.screenshot({ path: `${shots}/long-${label}-random-walk-${width}x${height}.png` });
      writeFileSync(`${shots}/long-${label}-random-walk-${width}x${height}.json`, JSON.stringify(data));
      if (data.reader_row_jumps_over_2px) throw new Error(`fixed-seed random walk moved the held reader row at ${width}x${height}: ${data.worst_reader_row_shift_px}px`);
      return { viewport: `${width}x${height}`, ...data };
    };
    const randomWalkResults = [await randomWalk(1440, 900, 7015), await randomWalk(1100, 700, 7015)];
    if (!randomWalkResults.some((walk) => walk.older_page_loading_frames > 0)) throw new Error("fixed-seed random walks never overlapped an older-page load");
    console.log(`numbers w11-random-walk-${label}: ${JSON.stringify(randomWalkResults.map(({ steps, frames, ...summary }) => summary))}`);
    await tab.screenshot({ path: `${shots}/long-${label}-2-scrolled-up.png` });
    // An older page arriving while the reader stands still: open again, go up to just below the first loaded message
    // without a wheel, and see where the row being read is when the page before it has been put in above.
    let held = null;
    if (label !== "old") {
      await tab.goto(route, { waitUntil: "commit" });
      await tab.waitForFunction(() => window.__long?.firstPaint, null, { timeout: 180_000, polling: 50 });
      await tab.waitForTimeout(800);
      const requestsBefore = history.requests, early = [];
      const state = (tag) => tab.evaluate(([name, requests]) => { const list = document.querySelector('[data-testid="chat-scroll"]'), mark = document.querySelector('[data-testid="chat-window"]'); return `${name}: top ${Math.round(list.scrollTop)} of ${list.scrollHeight - list.clientHeight}, window ${mark ? `${mark.dataset.placed} ${mark.dataset.first}-${mark.dataset.end}/${mark.dataset.rows}` : "none"}, requests ${requests}`; }, [tag, history.requests]);
      early.push(await state("opened"));
      await tab.evaluate(() => { const list = document.querySelector('[data-testid="chat-scroll"]'); list.scrollTop = Math.max(0, list.scrollTop - 400); });
      await tab.waitForTimeout(300);
      early.push(await state("400 px up"));
      await tab.evaluate(() => { const list = document.querySelector('[data-testid="chat-scroll"]'); list.scrollTop = 1200; });
      await tab.waitForTimeout(60);
      early.push(await state("at 1200"));
      let top0 = null;
      for (let waited = 0; waited < 3000 && top0 === null; waited += 50) { top0 = await mark("hold"); if (top0 === null) await tab.waitForTimeout(50); }
      const trace = [];
      const snap = async () => trace.push(await tab.evaluate((requests) => { const list = document.querySelector('[data-testid="chat-scroll"]'); const row = document.querySelector('[data-step="hold"]'); return { top: Math.round(list.scrollTop), height: list.scrollHeight, spacer: Math.round(document.querySelector('[data-testid="chat-spacer-above"]')?.getBoundingClientRect().height ?? 0), rows: list.querySelectorAll("[data-wkey]").length, held: row ? Math.round(row.getBoundingClientRect().top) : null, requests, window: (() => { const mark = document.querySelector('[data-testid="chat-window"]'); return mark ? `${mark.dataset.placed} ${mark.dataset.first}-${mark.dataset.end}/${mark.dataset.rows}` : null; })() }; }, history.requests));
      for (let waited = 0; waited < 8000 && history.requests === requestsBefore; waited += 100) await tab.waitForTimeout(100);
      for (let n = 0; n < 12; n++) { await snap(); await tab.waitForTimeout(75); }
      const top1 = await where("hold");
      held = { older_page_requested: history.requests > requestsBefore, a_row_was_in_view: top0 !== null, row_still_mounted: top1 !== null, mounted_part_before_and_after: [early.at(-1), trace.at(-1) ? `after: top ${trace.at(-1).top}, window ${trace.at(-1).window}, requests ${trace.at(-1).requests}` : null], row_being_read_moved_px: top0 !== null && top1 !== null ? Math.round((top1 - top0) * 10) / 10 : null };
      await tab.screenshot({ path: `${shots}/long-${label}-4-older-page-arrived.png` });
    }
    // Open again on this device (a reload): what the device kept is painted first.
    const warm = await openOnce();
    await tab.screenshot({ path: `${shots}/long-${label}-3-opened-again.png` });
    await ctx.close();
    report(`long-${label}`, { build: url, opened_first_time: cold, mounted_after_open: afterOpen, scrolling_up_40_steps: scrolled, mounted_after_scrolling: afterScroll, directed_wheel: directedWheelResults, random_walk: randomWalkResults.map(({ steps, frames, ...summary }) => summary), older_page_arrives_while_reading: held, opened_again_on_this_device: warm });
    return { cold, warm, afterOpen, scrolled };
}

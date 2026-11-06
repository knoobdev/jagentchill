// Verifier: catalogue fixtures + two generated six-second MP3s. Production shelf/player, actual Audio events.
// W7-M3: browser regression for progressive preview, natural end, replay, and Add during/after preview.
// Catalogue answers are saved Openverse fixtures; media bytes are a generated tone fulfilled at the signed stream
// request, so this test makes no provider requests and has no audible output (headless Chromium is muted).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { pairAdmin } from "../../../server/scripts/live-lib.ts";

const [runDir, shots = ".dev/shots/w7m3-music"] = process.argv.slice(2), base = process.env.E2E_BASE ?? "http://localhost:8085";
mkdirSync(shots, { recursive: true });
const logFile = `${runDir}/server.log`, firstOffer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))?.[0];
if (!firstOffer) throw new Error("No pairing offer in this run's server log.");
const setup = await pairAdmin(firstOffer, logFile, "Host setup"), codes = new Map();
setup.on((event, payload) => { if (event === "jagentchill.pairing.requested") codes.set(payload.request.deviceName, payload.code); });
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const page = await context.newPage(), errors = [], streamIds = [], tracksByStream = new Map();
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
await context.addInitScript(() => {
  window.__vf = { presses: [], events: [], eof: [], audio: [], streams: 0 };
  document.addEventListener('click', e => { if(e.target instanceof Element && e.target.closest('[data-testid="audio-preview"]')) window.__vf.presses.push(performance.now()); },true);
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function() {
    if (!this.__vf) {
      this.__vf=true; this.muted=true;
      const i=window.__vf.audio.push(this)-1;
      for(const name of ['loadedmetadata','canplay','playing','pause','ended','error']) this.addEventListener(name,() => window.__vf.events.push({name,audio:i,at:performance.now(),fromPress:performance.now()-window.__vf.presses.at(-1),paused:this.paused,time:this.currentTime,duration:this.duration}));
    }
    return play.call(this);
  };
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async (input,init) => {
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    const response=await nativeFetch(input,init);
    if(!url.includes('/jagentchill/v1/music/stream/')) return response;
    const index=window.__vf.streams++, bytes=new Uint8Array(await response.arrayBuffer());
    let n=0;
    const body=new ReadableStream({async pull(c) {
      if(index===0 && n<3) {
        if(n>0) await new Promise(r=>setTimeout(r,1200));
        const a=Math.floor(bytes.length*n/3), b=Math.floor(bytes.length*(n+1)/3);
        c.enqueue(bytes.slice(a,b)); n++; return;
      }
      if(index>0 && n++===0) { c.enqueue(bytes); return; }
      window.__vf.eof.push({stream:index,at:performance.now(),audio:window.__vf.audio.map(a=>({paused:a.paused,time:a.currentTime,duration:a.duration,ended:a.ended}))}); c.close();
    }},{highWaterMark:0});
    return new Response(body,{status:response.status,headers:response.headers});
  };
});
const tones = [readFileSync(`${runDir}/tone.mp3`), readFileSync(`${runDir}/tone2.mp3`)];
await page.route("**/jagentchill/v1/music/stream/**", async (route) => {
  const id = new URL(route.request().url()).pathname.split("/").at(-1);
  streamIds.push(id);
  tracksByStream.set(id, (tracksByStream.get(id) ?? 0) + 1);
  await route.fulfill({ status: 200, contentType: "audio/mpeg", headers: { "accept-ranges": "bytes", "cache-control": "private, no-store" }, body: tones[streamIds.length - 1] ?? tones[0] });
});
const visible = (locator) => locator.filter({ visible: true }).first(), tid = (id) => visible(page.getByTestId(id));
const button = (name, exact = true) => visible(page.getByRole("button", { name, exact })), field = (name) => visible(page.getByLabel(name, { exact: true }));
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
try {
  const offer = (await setup.call("jagentchill.pairing.offer.create", { role: "admin" })).url;
  await page.goto(`${base}/home`, { waitUntil: "networkidle", timeout: 180_000 });
  await visible(page.getByText("What do you want to make?")).waitFor({ timeout: 90_000 });
  await button("Connect").click(); await field("Pairing link").fill(offer); await field("Name of this device").fill("W7-M3 preview"); await button("Continue", false).click();
  await visible(page.getByText(/Enter the code shown next to [0-9a-f]{8}/)).waitFor();
  for (let wait = 0; wait < 100 && !codes.has("W7-M3 preview"); wait++) await page.waitForTimeout(100);
  await field("Verification code").fill(codes.get("W7-M3 preview")); await visible(page.getByText("Connected", { exact: true })).waitFor();
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await button("Create your first project").click({ timeout: 90_000 }); await tid("timeline").waitFor({ timeout: 90_000 }); await tid("panel-tab-audio").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="audio-music"]')?.getAttribute("data-state") === "ready", null, { timeout: 90_000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="audio-music-row"]').length >= 2, null, { timeout: 30_000 });
  const rowAt = async (index) => page.locator('[data-testid="audio-music-row"]').nth(index), firstId = await (await rowAt(0)).getAttribute("data-track"), secondId = await (await rowAt(1)).getAttribute("data-track");
  const firstRow = page.locator(`[data-testid="audio-music-row"][data-track="${firstId}"]`), secondRow = page.locator(`[data-testid="audio-music-row"][data-track="${secondId}"]`);

  const assert=(v,msg)=>{if(!v) throw Error(msg)};
  const events=()=>page.evaluate(()=>window.__vf.events);
  const waitPlay=(audio,count)=>page.waitForFunction(([a,n])=>window.__vf.events.filter(e=>e.name==='playing'&&e.audio===a).length>n,[audio,count],{timeout:15000});
  const clips=()=>page.locator('[data-testid^="clip-"][role="listitem"]');
  const firstTitle=(await firstRow.innerText()).split('\n')[0], secondTitle=(await secondRow.innerText()).split('\n')[0];
  await firstRow.getByTestId('audio-preview').click(); await waitPlay(0,0);
  const firstPlaying=(await events()).find(e=>e.name==='playing'&&e.audio===0);
  assert((await page.evaluate(()=>window.__vf.eof)).length===0,'Must really play before EOF');
  console.log('F11',JSON.stringify(firstPlaying)); await shot('vf-11-playing-before-eof');
  await firstRow.getByTestId('audio-preview').click();
  assert(await page.evaluate(()=>window.__vf.audio[0].paused),'Stop did not pause');
  await firstRow.getByTestId('audio-preview').click(); await waitPlay(0,1);
  assert((await page.evaluate(()=>window.__vf.eof)).length===0,'Replay must occur during download');
  console.log('F13 replay-during-download',JSON.stringify((await events()).filter(e=>e.name==='playing'&&e.audio===0)));
  await shot('vf-13-replayed-during-download');
  await firstRow.getByTestId('audio-add').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-testid^="clip-"][role="listitem"]').length===1,null,{timeout:20000});
  await page.waitForTimeout(500); assert(await clips().count()===1,'Add during preview duplicated a clip');
  await shot('vf-13-added-during-preview');
  await secondRow.getByTestId('audio-preview').click(); await waitPlay(1,0);
  await page.waitForFunction(()=>window.__vf.eof.some(e=>e.stream===1),null,{timeout:10000});
  await page.waitForTimeout(300);
  const afterEof=await page.evaluate(()=>{const a=window.__vf.audio[1];return {paused:a.paused,ended:a.ended,time:a.currentTime,duration:a.duration}});
  assert(!afterEof.paused&&!afterEof.ended,'Download EOF paused short track');
  await shot('vf-12-unpaused-after-eof');
  await page.waitForFunction(()=>window.__vf.events.some(e=>e.audio===1&&e.name==='ended'),null,{timeout:15000});
  const natural=(await events()).find(e=>e.audio===1&&e.name==='ended');
  assert(natural.time>5.8,'Short track did not naturally play to end');
  console.log('F12 EOF',JSON.stringify(await page.evaluate(()=>window.__vf.eof)),'afterEOF',JSON.stringify(afterEof),'ended',JSON.stringify(natural));
  await shot('vf-12-natural-ended');
  await secondRow.getByTestId('audio-preview').click(); await waitPlay(1,1);
  await secondRow.getByTestId('audio-preview').click();
  await secondRow.getByTestId('audio-preview').click(); await waitPlay(1,2);
  await page.waitForFunction(()=>window.__vf.events.filter(e=>e.audio===1&&e.name==='ended').length===2,null,{timeout:15000});
  console.log('F13 replay-after-completion',JSON.stringify((await events()).filter(e=>e.audio===1&&e.name==='playing')));
  await secondRow.getByTestId('audio-add').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-testid^="clip-"][role="listitem"]').length===2,null,{timeout:20000});
  await page.waitForTimeout(500);
  const clipText=await clips().allInnerTexts();
  assert(clipText.length===2 && clipText.filter(t=>t.includes(firstTitle)).length===1 && clipText.filter(t=>t.includes(secondTitle)).length===1,'Expected one timeline clip per title '+JSON.stringify(clipText));
  assert(await firstRow.count()===0 && await secondRow.count()===0,'Added tracks should leave catalogue');
  assert(streamIds.length===2 && tracksByStream.get(firstId)===1 && tracksByStream.get(secondId)===1,'Add/replay caused another download');
  await tid('audio-licence').click(); await tid('licence-check').waitFor();
  const licence=await page.getByTestId('licence-row').filter({visible:true}).allInnerTexts();
  assert(licence.length===2 && [firstTitle,secondTitle].every(t=>licence.some(l=>l.includes(t)&&/CC BY|CC0/.test(l)&&/https:\/\//.test(l)&&/Attribution required/.test(l))),'Missing saved licence line '+JSON.stringify(licence));
  await page.waitForTimeout(700); await shot('vf-13-two-clips-licence-lines');
  const evidence={firstPlaying,afterEof,natural,events:await events(),eof:await page.evaluate(()=>window.__vf.eof),clipText,licence,streamIds,errors};
  writeFileSync(`${shots}/evidence.json`,JSON.stringify(evidence,null,2));
  assert(errors.length===0,'Browser errors '+errors.join('; '));
  console.log('VERIFIER 3/3 findings behaved correctly; clips',JSON.stringify(clipText),'licences',JSON.stringify(licence));
} catch (error) {
  writeFileSync(`${shots}/failure.json`,JSON.stringify({events:await page.evaluate(()=>window.__vf.events),eof:await page.evaluate(()=>window.__vf.eof),errors,error:String(error)},null,2)); await shot("vf-failure").catch(() => undefined); throw error;
} finally { await browser.close(); setup.close(); }

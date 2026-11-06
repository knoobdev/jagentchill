import { chromium } from "playwright";
for (const [name, options] of [["shell", {}], ["chrome", { channel: "chrome", args: ["--enable-unsafe-webgpu", "--enable-features=WebGPU"] }], ["chrome-headed-gpu", { channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] }]]) {
  try {
    const browser = await chromium.launch(options);
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:1/").catch(() => {});
    await page.goto("data:text/html,<p>x</p>").catch(() => {});
    const out = await page.evaluate(async () => {
      const cfg = async (kind, config) => { try { return (await globalThis[kind].isConfigSupported(config)).supported; } catch (e) { return String(e).slice(0, 60); } };
      let adapter = null;
      try { adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null; } catch {}
      const gl = document.createElement("canvas").getContext("webgl2");
      const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
      return {
        secure: isSecureContext, gpu: !!navigator.gpu, adapter: adapter ? { fallback: adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter, vendor: adapter.info?.vendor } : null,
        gl: gl ? gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : null,
        h264dec: await cfg("VideoDecoder", { codec: "avc1.640028", codedWidth: 1920, codedHeight: 1080 }),
        h264enc: await cfg("VideoEncoder", { codec: "avc1.640028", width: 1920, height: 1080, framerate: 30 }),
        vp9enc: await cfg("VideoEncoder", { codec: "vp09.00.40.08", width: 1920, height: 1080, framerate: 30 }),
        vp8enc: await cfg("VideoEncoder", { codec: "vp8", width: 1920, height: 1080, framerate: 30 }),
        aacenc: await cfg("AudioEncoder", { codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2 }),
        aacdec: await cfg("AudioDecoder", { codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2 }),
        opusenc: await cfg("AudioEncoder", { codec: "opus", sampleRate: 48000, numberOfChannels: 2 }),
        ua: navigator.userAgent.slice(-40),
      };
    });
    console.log(name, JSON.stringify(out));
    await browser.close();
  } catch (error) { console.log(name, "failed", String(error).slice(0, 200)); }
}

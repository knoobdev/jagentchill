import { createHash } from "node:crypto";

export const MOTION_SCENE_LIMITS = {
  sourceBytes: 256 * 1024,
  width: 1920,
  height: 1080,
  durationSeconds: 30,
  frameCount: 1200,
} as const;

export type MotionSceneSpec = {
  html: string;
  width: number;
  height: number;
  durationSeconds: number;
  fps: number;
};

/** Validates the bounded input contract shared by the motion-scene tool and the Electron renderer. */
export function validateMotionScene(input: MotionSceneSpec): { frameCount: number; sha256: string } {
  if (typeof input.html !== "string" || input.html.trim().length === 0) throw new RangeError("Scene HTML is empty.");
  const sourceBytes = Buffer.byteLength(input.html, "utf8");
  if (sourceBytes > MOTION_SCENE_LIMITS.sourceBytes) throw new RangeError(`Scene HTML is larger than ${MOTION_SCENE_LIMITS.sourceBytes} bytes.`);
  if (!Number.isInteger(input.width) || input.width < 1 || input.width > MOTION_SCENE_LIMITS.width) throw new RangeError(`Scene width must be 1–${MOTION_SCENE_LIMITS.width} pixels.`);
  if (!Number.isInteger(input.height) || input.height < 1 || input.height > MOTION_SCENE_LIMITS.height) throw new RangeError(`Scene height must be 1–${MOTION_SCENE_LIMITS.height} pixels.`);
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0 || input.durationSeconds > MOTION_SCENE_LIMITS.durationSeconds) throw new RangeError(`Scene duration must be greater than 0 and at most ${MOTION_SCENE_LIMITS.durationSeconds} seconds.`);
  if (!Number.isFinite(input.fps) || input.fps < 1 || input.fps > 60) throw new RangeError("Scene frame rate must be 1–60 fps.");
  const frameCount = Math.ceil(input.durationSeconds * input.fps);
  if (frameCount > MOTION_SCENE_LIMITS.frameCount) throw new RangeError(`A scene may contain at most ${MOTION_SCENE_LIMITS.frameCount} frames.`);
  return { frameCount, sha256: createHash("sha256").update(input.html).digest("hex") };
}

/** Stable JavaScript installed before scene code. Scene code supplies window.__jcSeek(seconds). */
export const MOTION_SCENE_BOOTSTRAP = `(() => {
  const fixedNow = 0;
  let randomState = 0x4a434d53;
  const originalDate = Date;
  class FixedDate extends originalDate { constructor(...args) { super(...(args.length ? args : [fixedNow])); } static now() { return fixedNow; } }
  Object.defineProperty(window, 'Date', { value: FixedDate, configurable: false });
  Math.random = () => { randomState = (1664525 * randomState + 1013904223) >>> 0; return randomState / 0x100000000; };
  Object.defineProperty(window, 'fetch', { value: () => Promise.reject(new Error('Network access is disabled while rendering a motion scene.')), configurable: false });
  Object.defineProperty(window, 'requestAnimationFrame', { value: () => 0, configurable: false });
  Object.defineProperty(window, 'cancelAnimationFrame', { value: () => {}, configurable: false });
  const applyTime = async (seconds) => {
    randomState = 0x4a434d53;
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime = seconds * 1000;
    }
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  Object.defineProperty(window, '__jcApplyTime', { value: applyTime, configurable: false });
})();`;

export function sceneHtmlForRender(html: string): string {
  const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; media-src data: blob:; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; font-src data:; connect-src \'none\'; object-src \'none\'; frame-src \'none\';">';
  const boot = `<script>${MOTION_SCENE_BOOTSTRAP}</script>`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${csp}${boot}`);
  return `<!doctype html><html><head>${csp}${boot}</head><body>${html}</body></html>`;
}

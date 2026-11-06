import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Real media files for the tests, generated with the ffmpeg binary of this machine into the OS temp directory.
 * Nothing here is committed and nothing is third-party: every picture and tone is synthesised.
 */
export const FIXTURE_DIR = join(tmpdir(), "jagentchill-media-fixtures-v3");

const tone = (seconds: number, rate: number, stereo: boolean) =>
  `aevalsrc=${stereo ? "sin(2*PI*440*t)|sin(2*PI*660*t)" : "sin(2*PI*440*t)"}:s=${rate}:d=${seconds}`;
const picture = (size: string, rate: string, seconds: number) => `testsrc=size=${size}:rate=${rate}:duration=${seconds}`;

const RECIPES: Record<string, string[]> = {
  // H.264 + AAC stereo 48 kHz, 640 × 360, 30 fps, 2 s.
  "h264-aac.mp4": ["-f", "lavfi", "-i", picture("640x360", "30", 2), "-f", "lavfi", "-i", tone(2, 48000, true), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"],
  // VP9 + Opus mono, 320 × 240, 25 fps, 2 s.
  "vp9-opus.webm": ["-f", "lavfi", "-i", picture("320x240", "25", 2), "-f", "lavfi", "-i", tone(2, 48000, false), "-c:v", "libvpx-vp9", "-b:v", "200k", "-c:a", "libopus", "-shortest"],
  // A phone clip: HEVC coded 1920 × 1080 with a 90° display rotation, 29.97 fps, AAC.
  "phone-hevc.mp4": ["-noautorotate", "-display_rotation:v:0", "90", "-f", "lavfi", "-i", picture("1920x1080", "30000/1001", 1), "-f", "lavfi", "-i", tone(1, 44100, false), "-c:v", "libx265", "-x265-params", "log-level=error", "-tag:v", "hvc1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"],
  // 60 fps with audio, for the reload scenario.
  "sixty.mp4": ["-f", "lavfi", "-i", picture("320x180", "60", 1), "-f", "lavfi", "-i", tone(1, 48000, false), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"],
  // 0.6 s video: the thumbnail frame is the one at 0.3 s.
  "short.webm": ["-f", "lavfi", "-i", picture("320x240", "25", 0.6), "-c:v", "libvpx-vp9", "-b:v", "200k"],
  // 0.6 s whose colour tells the time: red for 0–0.2 s, green for 0.2–0.4 s, blue for 0.4–0.6 s.
  "tricolour.webm": ["-f", "lavfi", "-i", "color=c=red:s=160x120:r=25:d=0.2", "-f", "lavfi", "-i", "color=c=0x00ff00:s=160x120:r=25:d=0.2", "-f", "lavfi", "-i", "color=c=blue:s=160x120:r=25:d=0.2", "-filter_complex", "[0][1][2]concat=n=3:v=1:a=0", "-c:v", "libvpx-vp9", "-b:v", "200k"],
  // Silent video.
  "silent.webm": ["-f", "lavfi", "-i", picture("160x120", "24", 1), "-c:v", "libvpx-vp9", "-b:v", "100k"],
  // 3840 × 2160 one-second clip for the proxy policy.
  "uhd.webm": ["-f", "lavfi", "-i", picture("3840x2160", "30", 0.5), "-c:v", "libvpx-vp9", "-b:v", "500k", "-deadline", "realtime", "-cpu-used", "8"],
  // 10 s mono sine at full scale, 44.1 kHz, 16-bit PCM.
  "sine-10s.wav": ["-f", "lavfi", "-i", tone(10, 44100, false), "-c:a", "pcm_s16le"],
  // Three hours of sound, small enough to generate quickly: 8 kHz 8-bit mono PCM (86 MB, kept in the temp directory only).
  "long-3h.wav": ["-f", "lavfi", "-i", "sine=frequency=220:sample_rate=8000:duration=10800", "-c:a", "pcm_u8"],
  // 3 s stereo MP3 at 44.1 kHz.
  "tone.mp3": ["-f", "lavfi", "-i", tone(3, 44100, true), "-c:a", "libmp3lame", "-b:a", "128k"],
  // 64 × 48 PNG with an alpha channel (left half transparent).
  "alpha.png": ["-f", "lavfi", "-i", "color=c=red@1.0:s=64x48,format=rgba,geq=r='255':g='0':b='0':a='if(lt(X,32),0,255)'", "-frames:v", "1"],
  "opaque.png": ["-f", "lavfi", "-i", "color=c=blue:s=32x32", "-frames:v", "1", "-pix_fmt", "rgb24"],
  // 6000 × 4000 JPEG for the thumbnail size scenario.
  "large.jpg": ["-f", "lavfi", "-i", "testsrc=size=6000x4000:rate=1", "-frames:v", "1", "-q:v", "20"],
  "plain.jpg": ["-f", "lavfi", "-i", "testsrc=size=80x40:rate=1", "-frames:v", "1"],
  "anim.gif": ["-f", "lavfi", "-i", picture("32x32", "5", 1)],
  "still.gif": ["-f", "lavfi", "-i", "color=c=green:s=16x16", "-frames:v", "1"],
  "picture.webp": ["-f", "lavfi", "-i", "color=c=green:s=48x24", "-frames:v", "1"],
  "picture.bmp": ["-f", "lavfi", "-i", "color=c=green:s=20x10", "-frames:v", "1"],
};

/** EXIF block (APP1) holding one tag: Orientation. */
function exifOrientation(orientation: number): Uint8Array {
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, /* 1 entry */ 0, 1, /* tag 0x0112 SHORT ×1 */ 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, /* next IFD */ 0, 0, 0, 0];
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  return Uint8Array.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]);
}

const DERIVED: Record<string, () => Uint8Array> = {
  // The 80 × 40 JPEG stored sideways: EXIF orientation 6 makes it display as 40 × 80.
  "exif-rotated.jpg": () => {
    const source = fixture("plain.jpg"), exif = exifOrientation(6), out = new Uint8Array(source.length + exif.length);
    out.set(source.subarray(0, 2)); out.set(exif, 2); out.set(source.subarray(2), 2 + exif.length);
    return out;
  },
  // An MP4 cut before its index (ffmpeg writes `moov` last): unreadable.
  "truncated.mp4": () => fixture("h264-aac.mp4").subarray(0, 20_000),
  "scripted.svg": () => new TextEncoder().encode(
    `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="120" height="60" viewBox="0 0 120 60">` +
    `<script>window.parent.__svgScriptRan = true; fetch("/svg-script-fetch");</script><image xlink:href="/svg-external.png" width="10" height="10"/><rect width="120" height="60" fill="#00ff00"/></svg>`),
  "notes.docx": () => Uint8Array.from([0x50, 0x4b, 3, 4, 20, 0, 6, 0, 8, 0, 0, 0, 33, 0, ...new TextEncoder().encode("[Content_Types].xml word/document.xml")]),
};

export const fixturePath = (name: string): string => join(FIXTURE_DIR, name);
/**
 * The test files run in parallel processes and share this directory. A fixture is produced under a private name that
 * keeps its extension (ffmpeg picks the muxer from it) and only renamed into place once complete, so no reader ever
 * sees the bytes of a file another process is still writing.
 */
function generateFixture(name: string, path: string): void {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const staging = join(FIXTURE_DIR, `${name}.${process.pid}-${Math.random().toString(36).slice(2)}${name.slice(name.lastIndexOf("."))}`);
  try {
    if (DERIVED[name]) writeFileSync(staging, DERIVED[name]());
    else execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...RECIPES[name], staging], { stdio: ["ignore", "ignore", "inherit"] });
    renameSync(staging, path);
  } catch (error) {
    rmSync(staging, { force: true });
    throw error;
  }
}
export function fixture(name: string): Uint8Array {
  const path = fixturePath(name);
  if (!existsSync(path)) {
    if (!DERIVED[name] && !RECIPES[name]) throw new Error(`unknown fixture ${name}`);
    generateFixture(name, path);
  }
  return new Uint8Array(readFileSync(path));
}
/** Everything except the three-hour file, which only the long-file scenario asks for. */
export const ALL_FIXTURES = [...Object.keys(RECIPES), ...Object.keys(DERIVED)].filter((name) => name !== "long-3h.wav");
export const ensureFixtures = (names: string[] = ALL_FIXTURES): void => { for (const name of names) fixture(name); };

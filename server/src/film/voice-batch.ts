/**
 * One speaker, one recording. A speech model asked for each line on its own picks how it sounds each time — measured
 * on a real provider, three lines of one character came back at 138, 179 and 157 Hz, and the person heard the old
 * woman turn young and the accent move. Asked for all the lines of a speaker in ONE call, the same three came back at
 * 152, 145 and 147 Hz. So a speaker's lines are spoken together and the recording is cut back into the lines here.
 *
 * Pure functions over 16-bit mono samples: no provider, no file system.
 */
import { film as fm } from "@jagentchill/editor-core";

const { speechMatch, spokenWords } = fm;

export type Pcm = { samples: Int16Array; rate: number };
export type Piece = { from: number; to: number };

/** The samples of a 16-bit WAV file (the first `data` chunk; mono, or the first channel of more). */
export function pcmOfWav(bytes: Uint8Array): Pcm | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (bytes.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return undefined;
  let at = 12, rate = 0, channels = 1, bits = 16;
  while (at + 8 <= bytes.length) {
    const id = tag(at), size = view.getUint32(at + 4, true), body = at + 8;
    if (id === "fmt ") { channels = view.getUint16(body + 2, true); rate = view.getUint32(body + 4, true); bits = view.getUint16(body + 14, true); }
    if (id === "data") {
      if (bits !== 16 || !rate || !channels) return undefined;
      const frames = Math.floor(Math.min(size, bytes.length - body) / (2 * channels)), samples = new Int16Array(frames);
      for (let index = 0; index < frames; index++) samples[index] = view.getInt16(body + index * 2 * channels, true);
      return { samples, rate };
    }
    at = body + size + (size % 2);
  }
  return undefined;
}

/** The samples as bytes (little-endian), for a WAV writer. */
export const bytesOfPcm = (samples: Int16Array): Uint8Array => { const out = new Uint8Array(samples.length * 2), view = new DataView(out.buffer); samples.forEach((value, index) => view.setInt16(index * 2, value, true)); return out; };

/**
 * The stretches of speech between pauses: a pause is `pauseMs` of samples under the floor. Each piece keeps a little
 * air before and after it, so a cut never clips a consonant.
 */
export function splitAtPauses(pcm: Pcm, pauseMs = 420, floor = 500): Piece[] {
  const window = Math.max(1, Math.round(pcm.rate / 50)), needed = Math.ceil(pauseMs / 20), pieces: Piece[] = [];
  let start = -1, quiet = 0;
  const count = Math.floor(pcm.samples.length / window);
  for (let index = 0; index < count; index++) {
    let peak = 0;
    for (let at = index * window, end = at + window; at < end; at++) { const value = Math.abs(pcm.samples[at]); if (value > peak) peak = value; }
    if (peak > floor) { if (start < 0) start = index; quiet = 0; }
    else if (start >= 0 && ++quiet >= needed) { pieces.push({ from: start, to: index - quiet + 1 }); start = -1; quiet = 0; }
  }
  if (start >= 0) pieces.push({ from: start, to: count - quiet });
  const lead = Math.round(pcm.rate * 0.06), trail = Math.round(pcm.rate * 0.12);
  return pieces.filter((piece) => piece.to > piece.from).map((piece, index, all) => ({
    from: Math.max(index ? all[index - 1].to * window : 0, piece.from * window - lead),
    to: Math.min(index + 1 < all.length ? all[index + 1].from * window : pcm.samples.length, piece.to * window + trail),
  }));
}

/**
 * Which pieces are which line. The pieces come in the order the lines were spoken; a line may have been cut in two at
 * a comma, so each line takes one or more pieces in a row — as many as make what was heard closest to its words.
 * Undefined when the recording cannot be laid over the lines (a line missing, words elsewhere): the caller then
 * records the lines one by one instead of guessing.
 */
export function alignPieces(lines: readonly string[], heard: readonly string[], least = 0.7): { from: number; to: number; score: number }[] | undefined {
  const out: { from: number; to: number; score: number }[] = [];
  let at = 0;
  for (let index = 0; index < lines.length; index++) {
    const left = lines.length - index - 1, most = heard.length - left;
    if (at >= most) return undefined;
    let best = -1, end = at;
    for (let to = at + 1; to <= most; to++) {
      const score = speechMatch(lines[index], heard.slice(at, to).join(" "));
      // The last line takes everything that is left; the others stop where they read best (the first such place).
      if (index === lines.length - 1 ? to === most : score > best + 1e-9) { best = score; end = to; }
      if (index < lines.length - 1 && spokenWords(heard.slice(at, to).join(" ")).length > spokenWords(lines[index]).length * 1.6 + 2) break;
    }
    if (index === lines.length - 1) best = speechMatch(lines[index], heard.slice(at, end).join(" "));
    if (best < least) return undefined;
    out.push({ from: at, to: end, score: Math.round(best * 100) / 100 });
    at = end;
  }
  return at === heard.length ? out : undefined;
}

/** The pitch of a voice: the median fundamental of its voiced 40 ms frames, by autocorrelation (70–400 Hz). 0 when nothing is voiced. */
export function medianPitch(pcm: Pcm): number {
  const frame = Math.round(pcm.rate * 0.04), low = Math.floor(pcm.rate / 400), high = Math.ceil(pcm.rate / 70), found: number[] = [];
  for (let start = 0; start + frame + high < pcm.samples.length; start += frame) {
    let energy = 0;
    for (let at = start; at < start + frame; at += 4) energy += pcm.samples[at] * pcm.samples[at];
    if (energy / (frame / 4) < 250_000) continue;
    const sums = new Float64Array(high + 1);
    let best = 0;
    for (let candidate = low; candidate <= high; candidate++) {
      let sum = 0;
      for (let at = start; at < start + frame; at += 4) sum += pcm.samples[at] * pcm.samples[at + candidate];
      sums[candidate] = sum;
      if (sum > best) best = sum;
    }
    if (best <= 0) continue;
    // A wave matches itself as well two periods later as one: the SHORTEST lag that matches almost as well as the best
    // is the period (taking the best alone reads a voice an octave low on some frames and not on others).
    let lag = low;
    while (lag <= high && sums[lag] < best * 0.9) lag++;
    while (lag < high && sums[lag + 1] > sums[lag]) lag++;
    if (lag <= high) found.push(pcm.rate / lag);
  }
  if (!found.length) return 0;
  found.sort((a, b) => a - b);
  return Math.round(found[Math.floor(found.length / 2)]);
}

/** How far a line's pitch is from its speaker's, as a share (0.2 = a fifth away). A voice that moves more than that sounds like someone else. */
export const pitchDrift = (line: number, speaker: number): number => (line > 0 && speaker > 0 ? Math.abs(line - speaker) / speaker : 0);
export const PITCH_DRIFT_MAX = 0.2;

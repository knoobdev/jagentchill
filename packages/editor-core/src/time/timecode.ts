import { TICKS_PER_SECOND, type Rational } from "@jagentchill/protocol";
import { mediaTimeFromFrame, mediaTimeToFrame, roundedFrameRate, type MediaTime } from "./media-time.ts";

export const TIMECODE_FORMATS = ["MM:SS", "HH:MM:SS", "HH:MM:SS:CS", "HH:MM:SS:FF"] as const;
export type TimecodeFormat = (typeof TIMECODE_FORMATS)[number];

const TICKS_PER_CENTISECOND = TICKS_PER_SECOND / 100;
const two = (value: number): string => String(value).padStart(2, "0");

function fields(timeCode: string): number[] | null {
  const trimmed = timeCode.trim();
  if (trimmed === "") return null;
  const parts = trimmed.split(":");
  // A field is an unsigned decimal integer that fits 32 bits, optionally written with a plus sign.
  if (!parts.every((part) => /^\+?[0-9]+$/.test(part) && Number(part) <= 0xffff_ffff)) return null;
  return parts.map(Number);
}

/** The format with as many colon-separated fields as the text has; four fields read as frames. */
export function guessTimecodeFormat(timeCode: string): TimecodeFormat | null {
  const parts = fields(timeCode);
  if (!parts) return null;
  return parts.length === 2 ? "MM:SS" : parts.length === 3 ? "HH:MM:SS" : parts.length === 4 ? "HH:MM:SS:FF" : null;
}

/** Formats a time; a negative time formats as zero. `HH:MM:SS:FF` needs the frame rate and is `null` without it. */
export function formatTimecode(time: number, format: TimecodeFormat = "HH:MM:SS:CS", rate?: Rational): string | null {
  const total = Math.max(0, time);
  const secondTicks = total % TICKS_PER_SECOND;
  const totalSeconds = (total - secondTicks) / TICKS_PER_SECOND;
  const seconds = totalSeconds % 60;
  const totalMinutes = (totalSeconds - seconds) / 60;
  const minutes = totalMinutes % 60;
  const hours = (totalMinutes - minutes) / 60;
  if (format === "MM:SS") return `${two(minutes)}:${two(seconds)}`;
  if (format === "HH:MM:SS") return `${two(hours)}:${two(minutes)}:${two(seconds)}`;
  if (format === "HH:MM:SS:CS") return `${two(hours)}:${two(minutes)}:${two(seconds)}:${two(Math.floor(secondTicks / TICKS_PER_CENTISECOND))}`;
  if (!rate) return null;
  try {
    // The frame field is the index of the frame, inside its second, that contains the time.
    return `${two(hours)}:${two(minutes)}:${two(seconds)}:${two(mediaTimeToFrame(secondTicks, rate))}`;
  } catch {
    return null;
  }
}

/** Parses a timecode; malformed input is `null`, never an exception. */
export function parseTimecode(timeCode: string, format: TimecodeFormat = "HH:MM:SS:CS", rate?: Rational): MediaTime | null {
  const parts = fields(timeCode);
  if (!parts) return null;
  const whole = (hours: number, minutes: number, seconds: number) => (hours * 3600 + minutes * 60 + seconds) * TICKS_PER_SECOND;
  if (format === "MM:SS") {
    if (parts.length !== 2 || parts[1] >= 60) return null;
    return whole(0, parts[0], parts[1]) as MediaTime;
  }
  if (parts.length !== (format === "HH:MM:SS" ? 3 : 4) || parts[1] >= 60 || parts[2] >= 60) return null;
  const base = whole(parts[0], parts[1], parts[2]);
  if (format === "HH:MM:SS") return base as MediaTime;
  if (format === "HH:MM:SS:CS") return parts[3] >= 100 ? null : (base + parts[3] * TICKS_PER_CENTISECOND) as MediaTime;
  if (!rate) return null;
  try {
    if (parts[3] >= roundedFrameRate(rate)) return null;
    return (base + mediaTimeFromFrame(parts[3], rate)) as MediaTime;
  } catch {
    return null;
  }
}

// What the Music shelf says and remembers without asking anyone: the words of its chips and of its "cannot be shown"
// line, the note that a starter's project still waits for its music, and the "More music" sources. No network here.
import type { MusicDown } from "./remote.ts";

/** The chips of the shelf as a person reads them; the ids are the host's (`MUSIC_CHIPS`). */
export const CHIP_LABELS: Record<string, string> = { chill: "Lo-fi & chill", upbeat: "Upbeat", cinematic: "Cinematic", hiphop: "Hip-hop & trap", dance: "EDM & dance", acoustic: "Acoustic", corporate: "Corporate", house: "House", piano: "Piano", travel: "Travel" };
/** One line for the shelf when the catalogue cannot be shown. */
export const DOWN_LINES: Record<MusicDown["reason"], string> = {
  no_host: "Connect to a host to browse music. Your own files still work.",
  offline: "The music catalogue can't be reached right now. Your own files still work.",
  rate_limited: "The music catalogue's free limit is used up for now. Try again later. Your own files still work.",
  provider_error: "The music catalogue isn't answering right now. Your own files still work.",
  not_connected: "No music catalogue is connected on this host. Your own files still work.",
  not_found: "The catalogue no longer has this track.",
};

// — A starter's music: named by the template, fetched once when its project is first opened on a connected device. —
const KEY = "jagentchill.starterMusic.";
const store = (): Storage | undefined => { try { return globalThis.localStorage; } catch { return undefined; } };
/** Remembers that the project made from a starter still waits for its music. */
export const expectStarterMusic = (projectId: string, templateId: string): void => { try { store()?.setItem(KEY + projectId, templateId); } catch { /* without the note the project simply keeps its empty Music track */ } };
export const expectedStarterMusic = (projectId: string): string | null => { try { return store()?.getItem(KEY + projectId) ?? null; } catch { return null; } };
export const settleStarterMusic = (projectId: string): void => { try { store()?.removeItem(KEY + projectId); } catch { /* nothing to forget */ } };

// — "More music": a person's own route to sources whose licence is for THEIR videos, through the ordinary import. —
/** The sources named in the Audio panel: what each is and its rule, in one line, and the page that opens in the person's browser. Nothing is fetched from them by the app. */
export const MORE_MUSIC = [
  { id: "pixabay", name: "Pixabay Music", line: "Pixabay: free, no credit needed.", url: "https://pixabay.com/music/" },
  { id: "ncs", name: "NCS", line: "NCS: free for your videos, credit required.", url: "https://ncs.io/" },
];
/** A file whose name says it is an NCS release ("Artist - Title [NCS Release].mp3", "… (NCS Release)", "NCS - …"). */
export function ncsRelease(fileName: string): { artist: string; title: string } | null {
  const base = fileName.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/_/g, " ").trim();
  if (!/\bNCS\b|NoCopyrightSounds/i.test(base)) return null;
  const plain = base.replace(/[[(]\s*NCS(?:\s+Release|\s+Lyric\s+Video)?\s*[\])]/gi, "").replace(/\bNoCopyrightSounds\b/gi, "").replace(/^\s*NCS\s*[-–:]\s*/i, "").replace(/\s+/g, " ").replace(/\s*[-–]\s*$/, "").trim();
  const parts = plain.split(/\s+[-–]\s+/);
  return parts.length >= 2 ? { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() } : { artist: "", title: plain };
}
/** The credit NCS asks for, in its own form, from what the file name gives; a person pastes the release's full credit over it. */
export const ncsCredit = (release: { artist: string; title: string }): string => `Song: ${release.artist ? `${release.artist} - ` : ""}${release.title} [NCS Release]\nMusic provided by NoCopyrightSounds`;

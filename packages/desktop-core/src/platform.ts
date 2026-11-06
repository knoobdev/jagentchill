import type { Environment, OsPlatform } from "./os.ts";
import { PRODUCT_FILE_TYPES } from "./links.ts";

export const APP_NAME = "JAgentChill";
export const APP_ID = "com.jagentchill.desktop";
export const DESKTOP_FILE = "jagentchill.desktop";

type Env = Readonly<Record<string, string | undefined>>;
const join = (platform: OsPlatform, ...parts: string[]) => parts.join(platform === "win32" ? "\\" : "/");

/** Where the app keeps things, per OS. The project library is the user's, visible and movable; nothing derived lives in it. */
export function desktopPaths(platform: OsPlatform, env: Env, home: string) {
  if (platform === "darwin") {
    return {
      userData: join(platform, home, "Library", "Application Support", APP_NAME), logs: join(platform, home, "Library", "Logs", APP_NAME),
      cache: join(platform, home, "Library", "Caches", APP_NAME), library: join(platform, home, "Movies", APP_NAME),
    };
  }
  if (platform === "win32") {
    const roaming = env.APPDATA ?? join(platform, home, "AppData", "Roaming"), local = env.LOCALAPPDATA ?? join(platform, home, "AppData", "Local");
    return {
      userData: join(platform, roaming, APP_NAME), logs: join(platform, roaming, APP_NAME, "logs"), cache: join(platform, local, APP_NAME, "Cache"),
      library: join(platform, env.USERPROFILE ?? home, "Videos", APP_NAME),
    };
  }
  const config = env.XDG_CONFIG_HOME || join(platform, home, ".config"), cache = env.XDG_CACHE_HOME || join(platform, home, ".cache"), state = env.XDG_STATE_HOME || join(platform, home, ".local", "state");
  return {
    userData: join(platform, config, APP_NAME), logs: join(platform, state, APP_NAME, "logs"), cache: join(platform, cache, APP_NAME),
    library: join(platform, env.XDG_VIDEOS_DIR || join(platform, home, "Videos"), APP_NAME),
  };
}

/** Chromium switches per OS for the pinned Electron major. A change here is a change of `docs/product/TOOLCHAIN.md`. */
export function gpuSwitches(platform: OsPlatform, opts: { vaapi?: boolean } = {}): string[] {
  if (platform !== "linux") return [];
  const features = ["Vulkan", ...(opts.vaapi ? ["VaapiVideoDecodeLinuxGL", "VaapiVideoEncoder"] : [])];
  return [`--enable-features=${features.join(",")}`, "--enable-unsafe-webgpu"];
}
export const GPU_CRASH_LIMIT = 3;
export const GPU_CRASH_WINDOW_MS = 60_000;
/** Three GPU-process crashes inside a minute: relaunch once without GPU acceleration. */
export function gpuCrashTracker(now: () => number = Date.now) {
  let crashes: number[] = [];
  return { crashed(): boolean { const at = now(); crashes = crashes.filter((time) => at - time < GPU_CRASH_WINDOW_MS); crashes.push(at); return crashes.length >= GPU_CRASH_LIMIT; } };
}

const desktopQuote = (value: string): string => (/[\s"'\\$`<>|&;*?#()~]/.test(value) ? `"${value.replace(/(["\\$`])/g, "\\$1")}"` : value);
/** The per-user launcher entry the AppImage writes for itself: it carries the scheme handler and the product MIME types. */
export function linuxDesktopEntry(execPath: string, opts: { hidden?: boolean; autostart?: boolean } = {}): string {
  const mime = ["x-scheme-handler/jagentchill", ...PRODUCT_FILE_TYPES.map((type) => type.mime)].join(";");
  return [
    "[Desktop Entry]", "Type=Application", `Name=${APP_NAME}`, "Comment=Video editor and agent platform",
    `Exec=${desktopQuote(execPath)}${opts.hidden ? " --hidden" : ""} %U`, "Icon=jagentchill", "Terminal=false",
    ...(opts.autostart ? ["X-GNOME-Autostart-enabled=true"] : ["Categories=AudioVideo;Video;AudioVideoEditing;", `MimeType=${mime};`, "StartupWMClass=JAgentChill"]),
    "",
  ].join("\n");
}
/** `Exec=` of an existing entry, to see whether the AppImage has moved. */
export const desktopEntryExec = (entry: string): string | null => {
  const line = /^Exec=(.*)$/m.exec(entry)?.[1];
  if (!line) return null;
  const quoted = /^"((?:[^"\\]|\\.)*)"/.exec(line);
  return quoted ? quoted[1].replace(/\\(.)/g, "$1") : line.split(" ")[0];
};
export function linuxMimePackage(): string {
  const types = PRODUCT_FILE_TYPES.map((type) => [
    `  <mime-type type="${type.mime}">`, `    <comment>${type.name}</comment>`, `    <glob pattern="*.${type.ext}"/>`,
    ...(type.mime.endsWith("+zip") ? ['    <sub-class-of type="application/zip"/>'] : type.mime.endsWith("+json") ? ['    <sub-class-of type="application/json"/>'] : []),
    "  </mime-type>",
  ].join("\n"));
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">', ...types, "</mime-info>", ""].join("\n");
}
/** The files the AppImage registers itself with, relative to the user's data and config directories. */
export function linuxRegistrationFiles(dataHome: string, configHome: string) {
  return {
    desktop: `${dataHome}/applications/${DESKTOP_FILE}`, mime: `${dataHome}/mime/packages/jagentchill.xml`,
    icon: `${dataHome}/icons/hicolor/256x256/apps/jagentchill.png`, autostart: `${configHome}/autostart/${DESKTOP_FILE}`,
    databases: [{ command: "update-desktop-database", args: [`${dataHome}/applications`] }, { command: "update-mime-database", args: [`${dataHome}/mime`] }],
  };
}
/** The registry values of the per-user protocol handler and file classes on Windows (`HKCU\Software\Classes`). */
export function windowsRegistration(exePath: string): { key: string; name: string; value: string }[] {
  const command = `"${exePath}" "%1"`, classes = "HKCU\\Software\\Classes";
  const out = [
    { key: `${classes}\\jagentchill`, name: "", value: "URL:JAgentChill" }, { key: `${classes}\\jagentchill`, name: "URL Protocol", value: "" },
    { key: `${classes}\\jagentchill\\shell\\open\\command`, name: "", value: command },
  ];
  for (const type of PRODUCT_FILE_TYPES) {
    const progId = `JAgentChill.${type.ext}`;
    out.push({ key: `${classes}\\${progId}`, name: "", value: type.name }, { key: `${classes}\\${progId}\\shell\\open\\command`, name: "", value: command });
    // Only the project package becomes the default; the other types are offered in "Open with".
    out.push(type.default ? { key: `${classes}\\.${type.ext}`, name: "", value: progId } : { key: `${classes}\\.${type.ext}\\OpenWithProgids`, name: progId, value: "" });
  }
  return out;
}
export const WINDOWS_RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

/** A tray exists always on macOS and Windows; on Linux only when a status-notifier watcher has a registered host. */
export const trayAvailable = (platform: OsPlatform, linux: { watcherRegistered: boolean; hostRegistered: boolean } = { watcherRegistered: false, hostRegistered: false }): boolean =>
  platform !== "linux" || (linux.watcherRegistered && linux.hostRegistered);
export const NO_TRAY_TEXT = "Your desktop has no system tray";

/** What an update can do on this install: replace itself, download the new package for the person to open, or only point at the download. */
export function updateMode(input: { platform: OsPlatform; packaged: boolean; appImage: boolean; writable: boolean; macSigned?: boolean; feedGiven?: boolean }): "auto" | "manual" | "link" | "off" {
  // A build run from source cannot replace itself; given a feed it can still find, download and verify a version.
  if (!input.packaged) return input.feedGiven ? "manual" : "off";
  if (!input.writable) return "link";
  // macOS installs an update only into a signed app (`macCanSelfUpdate`): an unsigned build downloads the new version for the person to open.
  if (input.platform === "darwin" && input.macSigned === false) return "manual";
  return input.platform === "linux" && !input.appImage ? "link" : "auto";
}
/**
 * What Personal ▸ Updates shows for an install: only controls that work and sentences that are true.
 * `note`: "unsigned" — the build downloads and verifies, the person opens the file; "package-manager" — only where a
 * package manager really owns the install (`managed`: a Linux package that is not an AppImage), never for a read-only
 * macOS or Windows install. `download`: "package" fetches the update here; "link" opens the published package in the
 * browser (an install the app cannot replace); null when there is nothing that would work.
 */
export function updateControls(input: { mode: "auto" | "manual" | "link" | "off"; status: string; reason?: string; managed?: boolean; downloadUrl?: string }): { note: "unsigned" | "package-manager" | null; autoDownload: boolean; download: "package" | "link" | null; retry: boolean } {
  const link = input.mode === "link";
  const managed = link && input.managed === true;
  return {
    note: input.mode === "manual" ? "unsigned" : managed ? "package-manager" : null,
    autoDownload: input.mode === "auto" || input.mode === "manual",
    download: input.status !== "available" || input.mode === "off" ? null : !link ? "package" : !managed && input.downloadUrl ? "link" : null,
    // A download that failed (disk, network, checksum) is started again from the beginning.
    retry: input.mode === "manual" && input.status === "error" && (input.reason === "download" || input.reason === "verification"),
  };
}
export const UPDATE_FIRST_CHECK_MS = 30_000;
export const UPDATE_INTERVAL_MS = 6 * 3_600_000;
export const UPDATE_REMIND_MS = 4 * 3_600_000;
/** The app never restarts by itself into an update while any of these holds; it installs on the next quit instead. */
export function restartBlockers(input: { unsavedProjects: number; runningExports: number; runningJobs: number; openTerminals: number; recording: boolean }): string[] {
  return [
    ...(input.unsavedProjects > 0 ? ["unsaved"] : []), ...(input.runningExports > 0 ? ["export"] : []), ...(input.runningJobs > 0 ? ["job"] : []),
    ...(input.openTerminals > 0 ? ["terminal"] : []), ...(input.recording ? ["recording"] : []),
  ];
}

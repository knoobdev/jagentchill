/** `process.platform`, without needing Node's types where this package is read by the app. */
export type OsPlatform = "darwin" | "win32" | "linux" | "aix" | "android" | "freebsd" | "haiku" | "openbsd" | "sunos" | "cygwin" | "netbsd";
export type Environment = Record<string, string | undefined>;

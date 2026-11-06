export type OsName = "mac" | "windows" | "linux" | "ios" | "android";
export type KeyInfo = { key: string; shift: boolean; alt: boolean; ctrl: boolean; meta: boolean; repeat: boolean; preventDefault(): void; stopPropagation?(): void };
export type PreferenceStorage = { get(key: string): string | null; set(key: string, value: string): void };

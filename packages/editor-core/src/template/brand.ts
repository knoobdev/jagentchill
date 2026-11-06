/**
 * The brand kit of a device: logos, named colours and fonts with roles. It is one library record; a logo's bytes are a
 * library file like an imported sticker's.
 */
export const BRAND_LIMITS = { logos: 20, colors: 24, fonts: 10, name: 40 } as const;
export const BRAND_ROLES = ["heading", "body", "caption"] as const;
export type BrandRole = (typeof BRAND_ROLES)[number];
export type BrandLogo = { id: string; name: string; file: string; sha256: string; size: number; width: number; height: number; mime: string; addedAt_ms: number };
export type BrandColor = { id: string; name: string; value: string };
export type BrandFont = { family: string; roles: BrandRole[] };
export type BrandKit = { id: string; name: string; logos: BrandLogo[]; colors: BrandColor[]; fonts: BrandFont[]; updated_ms: number };

export const EMPTY_BRAND_KIT: BrandKit = { id: "default", name: "Brand kit", logos: [], colors: [], fonts: [], updated_ms: 0 };
export const isEmptyBrandKit = (kit: BrandKit): boolean => kit.logos.length === 0 && kit.colors.length === 0 && kit.fonts.length === 0;
const HEX = /^#[0-9a-fA-F]{6}$/;
/** "#0055ff" from what a colour field holds ("0055FF", "#05f"); `null` when it is no colour. */
export function brandColorValue(input: string): string | null {
  const raw = input.trim().replace(/^#/, "");
  const long = /^[0-9a-fA-F]{3}$/.test(raw) ? [...raw].map((digit) => digit + digit).join("") : raw;
  return HEX.test(`#${long}`) ? `#${long.toLowerCase()}` : null;
}
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
/** The kit a stored record holds: entries that are not what this build writes are dropped, the limits are kept. */
export function readBrandKit(value: unknown): BrandKit {
  if (!isObject(value)) return EMPTY_BRAND_KIT;
  const list = (key: string): Record<string, unknown>[] => (Array.isArray(value[key]) ? (value[key] as unknown[]).filter(isObject) : []);
  return {
    id: typeof value.id === "string" ? value.id : "default",
    name: typeof value.name === "string" && value.name.trim() !== "" ? value.name.slice(0, BRAND_LIMITS.name) : "Brand kit",
    logos: list("logos").filter((logo) => typeof logo.id === "string" && typeof logo.file === "string").slice(0, BRAND_LIMITS.logos) as unknown as BrandLogo[],
    colors: list("colors").flatMap((color) => { const hex = typeof color.value === "string" ? brandColorValue(color.value) : null; return hex && typeof color.id === "string" ? [{ id: color.id, name: typeof color.name === "string" ? color.name.slice(0, BRAND_LIMITS.name) : "", value: hex }] : []; }).slice(0, BRAND_LIMITS.colors),
    fonts: list("fonts").flatMap((font) => (typeof font.family === "string" && font.family !== "" ? [{ family: font.family, roles: (Array.isArray(font.roles) ? font.roles : []).filter((role): role is BrandRole => (BRAND_ROLES as readonly unknown[]).includes(role)) }] : [])).slice(0, BRAND_LIMITS.fonts),
    updated_ms: Number(value.updated_ms) || 0,
  };
}

export type BrandChange =
  | { kind: "add-color"; id: string; name: string; value: string } | { kind: "rename-color"; id: string; name: string } | { kind: "set-color"; id: string; value: string } | { kind: "remove-color"; id: string }
  | { kind: "add-font"; family: string } | { kind: "remove-font"; family: string } | { kind: "set-role"; family: string; role: BrandRole; on: boolean }
  | { kind: "add-logo"; logo: BrandLogo } | { kind: "remove-logo"; id: string };
export class BrandRefused extends Error { constructor(message: string) { super(message); this.name = "BrandRefused"; } }

/** One change of the kit. A role belongs to one font: giving it to a font takes it from the others. */
export function changeBrandKit(kit: BrandKit, change: BrandChange, now_ms: number): BrandKit {
  const next: BrandKit = { ...kit, logos: [...kit.logos], colors: [...kit.colors], fonts: kit.fonts.map((font) => ({ ...font, roles: [...font.roles] })), updated_ms: now_ms };
  switch (change.kind) {
    case "add-color": {
      const value = brandColorValue(change.value) ?? (() => { throw new BrandRefused("Enter a colour like #1e6bff"); })();
      if (next.colors.length >= BRAND_LIMITS.colors) throw new BrandRefused("A brand kit holds up to 24 colours");
      next.colors.push({ id: change.id, name: change.name.trim().slice(0, BRAND_LIMITS.name), value });
      break;
    }
    case "rename-color": next.colors = next.colors.map((color) => (color.id === change.id ? { ...color, name: change.name.trim().slice(0, BRAND_LIMITS.name) } : color)); break;
    case "set-color": { const value = brandColorValue(change.value); if (!value) throw new BrandRefused("Enter a colour like #1e6bff"); next.colors = next.colors.map((color) => (color.id === change.id ? { ...color, value } : color)); break; }
    case "remove-color": next.colors = next.colors.filter((color) => color.id !== change.id); break;
    case "add-font":
      if (next.fonts.some((font) => font.family === change.family)) break;
      if (next.fonts.length >= BRAND_LIMITS.fonts) throw new BrandRefused("A brand kit holds up to 10 fonts");
      next.fonts.push({ family: change.family, roles: [] });
      break;
    case "remove-font": next.fonts = next.fonts.filter((font) => font.family !== change.family); break;
    case "set-role": for (const font of next.fonts) { font.roles = font.roles.filter((role) => role !== change.role); if (font.family === change.family && change.on) font.roles.push(change.role); } break;
    case "add-logo":
      if (next.logos.some((logo) => logo.sha256 === change.logo.sha256)) break;
      if (next.logos.length >= BRAND_LIMITS.logos) throw new BrandRefused("A brand kit holds up to 20 logos");
      next.logos.push(change.logo);
      break;
    case "remove-logo": next.logos = next.logos.filter((logo) => logo.id !== change.id); break;
  }
  return next;
}
/** The number the Library tab shows: what the kit holds. */
export const brandItemCount = (kit: BrandKit): number => kit.logos.length + kit.colors.length + kit.fonts.length;

// Bundled editor content: the normative catalogues of the content capabilities, shipped as data.
export * from "./text/presets.ts";
export * from "./text/bubbles.ts";
export * from "./text/animations.ts";
export * from "./text/templates.ts";

import type { Registries } from "../registries.ts";
import { TEXT_ANIMATIONS } from "./text/animations.ts";
import { TEXT_BUBBLES } from "./text/bubbles.ts";
/** The registries of text content the validator consults: the bundled text animation and bubble ids. */
export const TEXT_REGISTRIES: Pick<Registries, "textAnimations" | "bubbles"> = { textAnimations: TEXT_ANIMATIONS.map((animation) => animation.id), bubbles: TEXT_BUBBLES.map((bubble) => bubble.id) };
export * from "./stickers/shapes.ts";
export * from "./stickers/drawing.ts";
export * from "./stickers/stickers.ts";
export * from "./captions/styles.ts";

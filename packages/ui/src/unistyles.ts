/** Registers the token export with react-native-unistyles under exactly two themes, `light` and `dark`. */
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";
import { borderWidth, breakpoints, control, iconSize, motion, palettes, radius, space, typography, zIndex, type Scheme } from "./tokens.ts";

const shared = { space, radius, borderWidth, typography, motion, iconSize, control, zIndex };
export const unistylesThemes = { light: { colors: palettes.light, ...shared }, dark: { colors: palettes.dark, ...shared } } as const;

type AppThemes = typeof unistylesThemes;
type AppBreakpoints = typeof breakpoints;
declare module "react-native-unistyles" {
  export interface UnistylesThemes extends AppThemes {}
  export interface UnistylesBreakpoints extends AppBreakpoints {}
}

let configured = false;
export function registerThemes(initial: Scheme): void {
  if (configured) return;
  configured = true;
  StyleSheet.configure({ themes: unistylesThemes, breakpoints, settings: { initialTheme: initial } });
}
export function applyScheme(scheme: Scheme): void {
  registerThemes(scheme);
  if (UnistylesRuntime.themeName !== scheme) UnistylesRuntime.setTheme(scheme);
}

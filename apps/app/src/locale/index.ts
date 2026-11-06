import { useMemo } from "react";
import { languageOf, useTheme } from "@jagentchill/ui";
import { en } from "./en";
import { ja } from "./ja";
import { vi } from "./vi";

/** The locale resources of the screens: English is the source text and the key; `vi` and `ja` translate every key. */
export const RESOURCES: Record<"en" | "vi" | "ja", Record<string, string>> = { en, vi, ja };
export type Values = Record<string, string | number>;
export type T = (text: string, values?: Values) => string;

export function translate(locale: string, text: string, values?: Values): string {
  const template = RESOURCES[languageOf(locale)][text] ?? text;
  return values ? template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? "")) : template;
}
/** The translator of the current UI language. */
export function useT(): T {
  const { locale } = useTheme();
  return useMemo(() => (text: string, values?: Values) => translate(locale, text, values), [locale]);
}

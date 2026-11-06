import { exporting, preference } from "@jagentchill/app-core";
import { usePref } from "../../state";

export { exporting };
/** What exporting keeps per device: the settings last used (the default of a project with none) and the saved presets. */
const EXPORT_PREFS = {
  last: preference<exporting.StoredExportSettings | null>("export.last", null, (value): value is exporting.StoredExportSettings | null => value === null || (typeof value === "object" && !Array.isArray(value))),
  presets: preference<exporting.UserPreset[]>("export.presets", [], exporting.isUserPresets),
};
type Values = { last: exporting.StoredExportSettings | null; presets: exporting.UserPreset[] };
export function usePrefValue<K extends keyof Values>(key: K): [Values[K], (value: Values[K]) => void] {
  return usePref(EXPORT_PREFS[key] as never) as unknown as [Values[K], (value: Values[K]) => void];
}
export const presetOf = (settings: Pick<exporting.ExportSettings, "presetId">, user: exporting.UserPreset[]): string => exporting.presetName(settings, user);

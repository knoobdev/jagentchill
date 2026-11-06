import { useCallback } from "react";
import type { film as fm } from "@jagentchill/editor-core";
import { useToast } from "@jagentchill/ui";
import type { FilmData, FilmEstimate, Outcome } from "./data";

/** What every stage of the studio is given: the film as the host holds it, what is being made for it, and what the device may do. */
export type StageProps = {
  data: FilmData; film: fm.Film; estimate: FilmEstimate | null;
  /** The device may change the film / may spend on generation. */
  mayEdit: boolean; mayRun: boolean;
  /** A model is set to write the script (Model routing); `false` none is — "Make the film" says so instead of starting; `null` not known yet. */
  writer: boolean | null;
  go(stage: fm.StageId): void;
};
/** Runs a change and says why when the host refuses it. */
export function useAct(): (work: Promise<Outcome | { ok: boolean; message?: string }>) => Promise<boolean> {
  const toast = useToast();
  return useCallback(async (work) => { const result = await work; if (!result.ok) toast.show({ kind: "error", message: (result as { message?: string }).message ?? "" }); return result.ok; }, [toast]);
}
export const running = (data: FilmData, key: string): boolean => data.activity[key]?.state === "running";
export const failed = (data: FilmData, key: string): string | null => (data.activity[key]?.state === "failed" ? data.activity[key].message ?? "" : null);

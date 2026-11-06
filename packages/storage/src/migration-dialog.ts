import { systemClock, type Clock } from "./autosave.ts";
import { restoreBackup, runMigrations, type MigrationOutcome, type RunnerOptions } from "./migrate.ts";
import type { StoragePort } from "./port.ts";
import { storageString, type StorageLocale } from "./strings.ts";

/** The dialog stays visible at least this long, so that a fast run does not flicker. */
export const MIGRATION_DIALOG_MIN_MS = 1000;
export type MigrationFailureRow = {
  id: string; name: string;
  /** "Migration failed", or "Not enough storage to update this project". */
  status: string;
  step: string | null; error: string;
  /** What "Copy details" puts on the clipboard. */
  details: string;
  actions: { id: "copy-details" | "restore-backup"; label: string; enabled: boolean }[];
};
export type MigrationDialogState = {
  /** The modal "Updating your projects"; it has no dismiss control and closes by itself. */
  visible: boolean;
  title: string;
  projectName: string;
  /** "N of M" */
  counter: string;
  index: number; total: number;
  /** 0…1 */
  progress: number;
  dismissible: false;
  /** After the run, when any project failed: the failed projects, each with "Copy details" and "Restore backup". */
  summary: MigrationFailureRow[] | null;
};

/**
 * The state of the migration progress dialog, driven by the runner. When no project needs migration the dialog is
 * never shown.
 */
export function createMigrationDialog(port: StoragePort, options: { clock?: Clock; locale?: StorageLocale; onChange?: (state: MigrationDialogState) => void } = {}) {
  const clock = options.clock ?? systemClock, locale = options.locale;
  let state: MigrationDialogState = { visible: false, title: storageString("migrationTitle", {}, locale), projectName: "", counter: "", index: 0, total: 0, progress: 0, dismissible: false, summary: null };
  const set = (patch: Partial<MigrationDialogState>) => { state = { ...state, ...patch }; options.onChange?.(state); };
  const wait = (ms: number) => new Promise<void>((resolve) => { clock.setTimeout(resolve, ms); });

  return {
    get state(): MigrationDialogState { return state; },
    /** Runs the migration with the dialog. Resolves when the dialog has closed. */
    async run(runner: Omit<RunnerOptions, "onProgress">, run: typeof runMigrations = runMigrations): Promise<MigrationOutcome[]> {
      let shownAt: number | null = null;
      const names = new Map<string, string>();
      const outcomes = await run(port, {
        ...runner,
        onProgress: ({ id, name, index, total }) => {
          shownAt ??= clock.now();
          names.set(id, name);
          set({ visible: true, summary: null, projectName: name, index, total, counter: storageString("nOfM", { n: index, m: total }, locale), progress: total === 0 ? 0 : (index - 1) / total });
        },
      });
      if (shownAt === null) return outcomes;
      set({ progress: 1 });
      const elapsed = clock.now() - shownAt;
      if (elapsed < MIGRATION_DIALOG_MIN_MS) await wait(MIGRATION_DIALOG_MIN_MS - elapsed);
      const failed: MigrationFailureRow[] = [];
      for (const outcome of outcomes) {
        if (outcome.status !== "failed" && outcome.status !== "no-space") continue;
        const name = names.get(outcome.id) ?? "", hasBackup = (await port.listBackups(outcome.id)).length > 0;
        const status = outcome.status === "failed" ? storageString("migrationFailed", {}, locale) : outcome.message;
        const step = outcome.status === "failed" ? outcome.step : null, error = outcome.status === "failed" ? outcome.error : outcome.message;
        failed.push({
          id: outcome.id, name, status, step, error,
          details: [`${status}: ${name || outcome.id}`, `project: ${outcome.id}`, `from version: ${outcome.from}`, ...(step ? [`step: ${step}`] : []), `error: ${error}`].join("\n"),
          actions: [{ id: "copy-details", label: storageString("copyDetails", {}, locale), enabled: true }, { id: "restore-backup", label: storageString("restoreBackup", {}, locale), enabled: hasBackup }],
        });
      }
      set({ visible: false, summary: failed.length > 0 ? failed : null });
      return outcomes;
    },
    /** "Restore backup" of a failed project: its most recent backup becomes the record again. */
    async restoreBackup(projectId: string): Promise<boolean> {
      const [backup] = await port.listBackups(projectId);
      if (!backup) return false;
      await restoreBackup(port, projectId, backup.name);
      return true;
    },
    /** The summary was read. */
    closeSummary(): void { set({ summary: null }); },
  };
}

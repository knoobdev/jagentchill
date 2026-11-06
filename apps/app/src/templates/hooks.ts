import { useEffect, useState } from "react";
import type { StoragePort } from "@jagentchill/storage";
import { useDevice } from "../state";
import { bundledEntries, listPersonalTemplates, onTemplatesChange, type TemplateEntry } from "./store";

const BUNDLED = bundledEntries();
let lastPersonal: TemplateEntry[] | null = null;
/** The starter templates and My templates, read again whenever a template changes; `personal` is `null` while the first read runs. */
export function useTemplates(): { storage: StoragePort | null; bundled: TemplateEntry[]; personal: TemplateEntry[] | null; failed: boolean; retry(): void } {
  const { storage, storageError } = useDevice();
  const [personal, setPersonal] = useState<TemplateEntry[] | null>(lastPersonal);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    // Storage that cannot open holds no personal template; the starters are listed all the same.
    if (!storage) { if (storageError) setPersonal([]); return; }
    let cancelled = false;
    const load = () => void listPersonalTemplates(storage).then((list) => { if (!cancelled) { lastPersonal = list; setFailed(false); setPersonal(list); } }).catch(() => { if (!cancelled) setFailed(true); });
    load();
    const off = onTemplatesChange(load);
    return () => { cancelled = true; off(); };
  }, [storage, storageError, attempt]);
  return { storage: storage ?? null, bundled: BUNDLED, personal, failed, retry: () => setAttempt((count) => count + 1) };
}

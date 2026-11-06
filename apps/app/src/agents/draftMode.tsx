import { AGENT_PREFS, groupOf, listedModes, MODE_ICON, type BrowserModel } from "@jagentchill/app-core";
import type { ComposerPill, MenuItem } from "@jagentchill/ui";
import { useHost } from "../host";
import { useT } from "../locale";
import { usePref } from "../state";
import { useAgentData } from "./data";

/** The mode pill shared by every composer that creates a session from a draft. */
export function useDraftMode(model: BrowserModel | null | undefined, disabled = false): { pill: ComposerPill | null; modeId: string | undefined } {
  const t = useT();
  const { role } = useHost();
  const data = useAgentData();
  const [saved, setSaved] = usePref(AGENT_PREFS.modeByRuntime);
  const group = groupOf(data.catalogue, model?.ref);
  const modes = listedModes(group, { role: role ?? "viewer" });
  const available = modes.filter((entry) => entry.supported && !entry.isUnattended);
  const current = available.find((entry) => entry.id === saved[model?.ref.runtimeId ?? ""]) ?? available.find((entry) => entry.id === group?.defaultModeId);
  if (!group || !current) return { pill: null, modeId: undefined };
  const menu: MenuItem[] = available.map((entry) => ({ id: entry.id, label: entry.label, description: entry.description, checked: entry.id === current.id, disabled, onSelect: () => setSaved({ ...saved, [model!.ref.runtimeId]: entry.id }) }));
  return {
    pill: { id: "mode", label: current.label, icon: (MODE_ICON[current.id] ?? "sliders") as ComposerPill["icon"], menu },
    modeId: current.id,
  };
}

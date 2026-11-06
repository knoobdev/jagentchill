import { AGENT_PREFS, refKey, thinkingChoice, type BrowserModel } from "@jagentchill/app-core";
import type { ComposerPill, MenuItem } from "@jagentchill/ui";
import { useT } from "../locale";
import { usePref } from "../state";

/** The names of the thinking levels a runtime reports by id; an id that is not here is shown as the runtime labels it. */
const THINKING_LABEL: Record<string, string> = { off: "Off", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", adaptive: "Adaptive", max: "Max", ultra: "Ultra" };
/** What each level means for the answer, its speed and its tokens. */
const THINKING_TEXT: Record<string, string> = {
  off: "Answers without thinking first. Fastest, fewest tokens.",
  minimal: "A brief check before answering.",
  low: "Light thinking, for simple edits.",
  medium: "Balanced thinking, for everyday work.",
  high: "Thinks longer about hard requests. Slower, more tokens.",
  xhigh: "Thinks much longer. Slowest of the fixed levels, most tokens.",
  adaptive: "The model decides how much to think for each message.",
  max: "The most thinking this model allows.",
  ultra: "The most thinking, and the agent may split the work between helper agents.",
};

type Translate = ReturnType<typeof useT>;
const titled = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);
/** The label of a thinking option: the product's name of a known level, else the runtime's own label. */
export const thinkingLabel = (t: Translate, option: { id: string; label: string }) => (THINKING_LABEL[option.id] ? t(THINKING_LABEL[option.id]) : titled(option.label));

/**
 * The thinking control of a composer: the sparkles icon and the current level, opening the model's levels with what
 * each means and the model's default marked. `null` when the model offers no choice. Every composer draws this pill —
 * a live session applies the choice to the session, a draft keeps it for the session it creates.
 */
export function thinkingPill(t: Translate, model: BrowserModel | null | undefined, selectedId: string | null | undefined, options: { disabled?: boolean; onSelect(optionId: string): void }): ComposerPill | null {
  const current = thinkingChoice(model, selectedId);
  if (!model || current === null) return null;
  const items: MenuItem[] = [
    { type: "caption", label: t("Thinking levels") },
    ...model.thinkingOptions.map((option): MenuItem => {
      const text = THINKING_TEXT[option.id] ? t(THINKING_TEXT[option.id]) : undefined;
      const isDefault = option.id === model.defaultThinkingOptionId;
      return {
        id: option.id, label: isDefault ? t("{option} (default)", { option: thinkingLabel(t, option) }) : thinkingLabel(t, option), ...(text ? { description: text } : {}),
        checked: option.id === current, disabled: options.disabled, onSelect: () => options.onSelect(option.id),
      };
    }),
  ];
  const shown = model.thinkingOptions.find((option) => option.id === current)!;
  return { id: "thinking", label: `${t("Thinking")}: ${thinkingLabel(t, shown)}`, icon: "sparkles", menu: items };
}

/**
 * The thinking control of a composer whose session does not exist yet: it shows what this device remembers for the
 * draft's model (else the model's default) and `optionId` is what the session is created with.
 */
export function useDraftThinking(model: BrowserModel | null | undefined, disabled = false): { pill: ComposerPill | null; /** Sent as `thinkingOptionId` of `session.create`; absent when the model has no choice or its default stands. */ optionId: string | undefined } {
  const t = useT();
  const [remembered, setRemembered] = usePref(AGENT_PREFS.thinkingByModel);
  const key = model ? refKey(model.ref) : "";
  const pill = thinkingPill(t, model, remembered[key], { disabled, onSelect: (optionId) => setRemembered({ ...remembered, [key]: optionId }) });
  const chosen = thinkingChoice(model, remembered[key]);
  return { pill, optionId: chosen !== null && remembered[key] === chosen ? chosen : undefined };
}

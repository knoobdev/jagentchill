import { useEffect, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { Composer, type ComposerPill, type ComposerProps, useTheme, useToast } from "@jagentchill/ui";
import { startDictation } from "../platform/media";
import { useT } from "../locale";
import { useFileDrop } from "./useFileDrop";

type AgentComposerProps = Omit<ComposerProps, "mode" | "pills" | "trailing"> & {
  model?: ComposerPill;
  target?: ComposerPill;
  permission?: ComposerPill | null;
  skills?: ComposerPill | null;
  options?: ComposerPill[];
  context?: ReactNode;
  onFiles?(files: File[]): void;
  overlays?: ReactNode;
};

/** The full chat composer. Every agent surface supplies its state; toolbar order and file gestures stay the same. */
export function AgentComposer(props: AgentComposerProps) {
  const { model, target, permission, skills, options, context, onFiles, overlays, ...composer } = props;
  const thinking = options?.find((pill) => pill.id === "thinking");
  const remainingOptions = options?.filter((pill) => pill.id !== "thinking") ?? [];
  const t = useT(), theme = useTheme(), toast = useToast();
  const surface = useRef<View>(null);
  const stopDictation = useRef<(() => void) | null>(null);
  const [localDictating, setLocalDictating] = useState(false);
  useFileDrop(surface, onFiles);
  useEffect(() => () => stopDictation.current?.(), []);
  const dictate = composer.onDictate ?? (() => {
    if (localDictating) { stopDictation.current?.(); return; }
    const base = composer.value ? `${composer.value.replace(/\s+$/, "")} ` : "";
    let spoken = "";
    const stop = startDictation(theme.locale, {
      onText: (text, final) => { if (final) spoken += text; composer.onChangeText(`${base}${spoken}${final ? "" : text}`); },
      onEnd: (error) => {
        setLocalDictating(false); stopDictation.current = null;
        if (error && error !== "aborted" && error !== "no-speech") toast.show({ kind: "warning", message: error === "not-allowed" ? t("Allow the microphone to dictate") : t("Dictation stopped: {reason}", { reason: error }) });
      },
    });
    if (stop) { stopDictation.current = stop; setLocalDictating(true); }
  });
  return (
    <>
      <View ref={surface} testID="agent-composer-surface">
        <Composer {...composer} onDictate={dictate} dictating={composer.onDictate ? composer.dictating : localDictating} mode={model} pills={[thinking, permission, skills, target, ...remainingOptions].filter((pill): pill is ComposerPill => !!pill)} trailing={context} />
      </View>
      {overlays}
    </>
  );
}

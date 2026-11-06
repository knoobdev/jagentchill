import { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { script as s } from "@jagentchill/editor-core";
import { Button, Chip, IconButton, Input, Select, Tap, Text, space, useTheme, useToast } from "@jagentchill/ui";
import { useT } from "../locale";
import { useScriptEditor } from "./context";

type Scope = "script" | "act" | "scene" | "selection";
const KIND_LABELS: Record<s.FindKind, string> = { any: "Any kind", dialogue: "Dialogue", narration: "Narration", action: "Action", on_screen_text: "On-screen text", notes: "Notes", shots: "Shots" };
const SCOPE_LABELS: Record<Scope, string> = { script: "Whole script", act: "Current act", scene: "Current scene", selection: "Selection" };

/** Find and replace: plain terms, counted and listed by scene; a replacement is one undo step. */
export function FindBar(props: { onFound(lineIds: ReadonlySet<string>): void; onClose(): void }) {
  const t = useT(), theme = useTheme(), toast = useToast(), editor = useScriptEditor(), { document } = editor;
  const [term, setTerm] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [scope, setScope] = useState<Scope>("script");
  const [kind, setKind] = useState<s.FindKind>("any");
  const [at, setAt] = useState(0);
  const [preview, setPreview] = useState(false);
  const scene = editor.selection.sceneId ? s.findScene(document, editor.selection.sceneId) : undefined;
  const matches = useMemo(() => s.findInScript(document, term, {
    matchCase, wholeWord, kind,
    scope: scope === "scene" && scene ? { type: "scene", sceneId: scene.id } : scope === "act" && scene?.actId ? { type: "act", actId: scene.actId } : scope === "selection" ? { type: "selection", lineIds: editor.selection.lineIds } : { type: "script" },
  }), [document, term, matchCase, wholeWord, kind, scope, scene, editor.selection.lineIds]);
  const index = matches.length ? Math.min(at, matches.length - 1) : 0, current = matches[index];
  useEffect(() => { props.onFound(new Set(matches.filter((match) => match.target === "line").map((match) => match.id))); }, [matches]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => props.onFound(new Set()), []); // eslint-disable-line react-hooks/exhaustive-deps
  const show = (match: s.FindMatch | undefined) => { if (!match) return; if (match.target === "shot") editor.select({ sceneId: match.sceneId, shotIds: [match.id] }); editor.scrollToScene(match.sceneId); };
  const step = (delta: number) => { if (!matches.length) return; const next = (index + delta + matches.length) % matches.length; setAt(next); show(matches[next]); };
  const replace = (list: readonly s.FindMatch[]) => {
    const done = editor.run(s.replaceMatches(list, replacement));
    if (done && list.length > 1) toast.show({ kind: "success", message: t("{n} replaced", { n: done.replaced }), action: { label: t("Undo"), onPress: () => { editor.session.undo(); } } });
  };
  const groups = s.groupMatches(document, matches), none = term !== "" && matches.length === 0, blocked = editor.readOnly || matches.length === 0;
  return (
    <View testID="find-bar" style={{ borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/app"), padding: space[2], gap: space[1] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[1], flexWrap: "wrap" }}>
        <Input size="sm" autoFocus value={term} maxLength={s.FIND_TERM_MAX} placeholder={t("Find")} aria={{ "aria-label": t("Find") }} leadingIcon="search" testID="find-term" style={{ width: 220 }}
          onChangeText={(text) => { setTerm(text); setAt(0); }} onKey={(key) => { if (key.key === "Enter") { key.preventDefault(); step(key.shift ? -1 : 1); } if (key.key === "Escape") props.onClose(); }} />
        <Text variant="meta" color={none ? "warning/text" : "text/secondary"} tabular testID="find-count" live="polite">{none ? t("No results") : matches.length ? t("{n} of {m}", { n: index + 1, m: matches.length }) : ""}</Text>
        <IconButton icon="chev-u" size="sm" label={t("Previous result")} testID="find-previous" disabled={!matches.length} onPress={() => step(-1)} />
        <IconButton icon="chev-d" size="sm" label={t("Next result")} testID="find-next" disabled={!matches.length} onPress={() => step(1)} />
        <Chip size="sm" label={t("Match case")} selected={matchCase} onPress={() => setMatchCase(!matchCase)} />
        <Chip size="sm" label={t("Whole word")} selected={wholeWord} onPress={() => setWholeWord(!wholeWord)} />
        <Select label={t("Search in")} size="sm" width={150} value={scope} onChange={(value) => { setScope(value); setAt(0); }} options={(Object.keys(SCOPE_LABELS) as Scope[]).map((value) => ({ value, label: t(SCOPE_LABELS[value]), disabled: (value === "scene" && !scene) || (value === "act" && !scene?.actId) || (value === "selection" && editor.selection.lineIds.length === 0) }))} />
        <Select label={t("Kind of content")} size="sm" width={150} value={kind} onChange={(value) => { setKind(value); setAt(0); }} options={(Object.keys(KIND_LABELS) as s.FindKind[]).map((value) => ({ value, label: t(KIND_LABELS[value]) }))} />
        <View style={{ flex: 1 }} />
        <IconButton icon="x" size="sm" label={t("Close find")} testID="find-close" onPress={props.onClose} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[1], flexWrap: "wrap" }}>
        <Input size="sm" value={replacement} maxLength={s.FIND_TERM_MAX} placeholder={t("Replace with")} aria={{ "aria-label": t("Replace with") }} readOnly={editor.readOnly} testID="find-replacement" style={{ width: 220 }} onChangeText={setReplacement} />
        <Button kind="outline" size="sm" label={t("Replace")} testID="find-replace" disabled={blocked} onPress={() => current && replace([current])} />
        <Button kind="outline" size="sm" label={t("Replace all in scope")} testID="find-replace-all" disabled={blocked} onPress={() => replace(matches)} />
        <Chip size="sm" label={t("Preview")} selected={preview} onPress={() => setPreview(!preview)} />
      </View>
      {matches.length ? (
        <ScrollView testID="find-results" style={{ maxHeight: 180 }}>
          {groups.map((group) => (
            <View key={group.sceneId} style={{ paddingTop: space[1] }}>
              <Text variant="caption" color="text/secondary">{group.label}</Text>
              {(preview ? s.previewReplace(group.matches, replacement) : group.matches.map((match) => ({ match, before: match.text, after: "" }))).map((entry) => {
                const position = matches.indexOf(entry.match), from = Math.max(0, entry.match.start - 30);
                return (
                  <Tap key={`${entry.match.id}:${entry.match.field}:${entry.match.start}`} role="button" label={t("Result {n}", { n: position + 1 })} testID="find-result" onPress={() => { setAt(position); show(entry.match); }}
                    style={(state) => ({ paddingVertical: space[0.5], paddingHorizontal: space[1], backgroundColor: position === index ? theme.color("accent/subtle") : state.hovered ? theme.color("bg/hover") : "transparent" })}>
                    <Text numberOfLines={1}>{`${from > 0 ? "…" : ""}${entry.before.slice(from, entry.match.end + 40)}`}</Text>
                    {preview ? <Text numberOfLines={1} color="text/secondary" testID="find-preview-after">{`+ ${from > 0 ? "…" : ""}${entry.after.slice(from, entry.match.start + replacement.length + 40)}`}</Text> : null}
                  </Tap>
                );
              })}
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

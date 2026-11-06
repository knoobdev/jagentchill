import { usePathname, useRouter } from "expo-router";
import { View } from "react-native";
import { matchesQuery, relativeTime } from "@jagentchill/app-core";
import { ListRow, Text, space, useTheme } from "@jagentchill/ui";
import { useT } from "../locale";
import { useScriptLibrary } from "./store";
import { LABELS } from "./strings";

/** The scripts of this device under the navigation, most recently edited first: the rows of the shell's secondary list. */
export function ScriptRows(props: { query: string; onNavigate?(): void }) {
  const t = useT(), theme = useTheme(), router = useRouter(), pathname = usePathname();
  const { scripts } = useScriptLibrary();
  if (scripts === null) return null;
  const rows = scripts.filter((script) => matchesQuery(script.title, props.query));
  if (rows.length === 0) return <View style={{ paddingVertical: space[2], paddingHorizontal: space[2] }}><Text color="text/secondary">{props.query ? t("No results") : t("No scripts yet")}</Text></View>;
  const now = Date.now();
  return (
    <>
      {rows.map((script) => (
        <ListRow key={script.id} title={script.title} icon="doc" testID="script-list-row" meta={`${t(LABELS.status[script.status])} · ${relativeTime(script.updated_ms, now, theme.locale)}`}
          selected={pathname === `/scripts/${script.id}` || pathname === `/scripts/${script.id}/review`} onPress={() => { router.push(`/scripts/${script.id}` as never); props.onNavigate?.(); }} />
      ))}
    </>
  );
}

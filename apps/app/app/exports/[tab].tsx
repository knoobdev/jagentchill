import { useLocalSearchParams } from "expo-router";
import { ExportsScreen, isExportTab } from "../../src/editor/export/ExportsScreen";
import { NotFoundScreen } from "../../src/shell/NotFound";

export default function ExportsTab() {
  const { tab } = useLocalSearchParams<{ tab: string }>();
  return isExportTab(tab) ? <ExportsScreen tab={tab} /> : <NotFoundScreen />;
}

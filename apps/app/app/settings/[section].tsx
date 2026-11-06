import { useLocalSearchParams } from "expo-router";
import { NotFoundScreen } from "../../src/shell/NotFound";
import { isSettingsSection, SettingsScreen } from "../../src/settings/SettingsScreen";

export default function SettingsSectionRoute() {
  const { section } = useLocalSearchParams<{ section: string }>();
  return isSettingsSection(section) ? <SettingsScreen section={section} /> : <NotFoundScreen />;
}

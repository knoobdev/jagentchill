import { useLocalSearchParams } from "expo-router";
import { HostSettingsRoute } from "../../../../../src/settings/HostSettings";

export default function HostSettingsItem() {
  const { section, itemId } = useLocalSearchParams<{ hostId: string; section: string; itemId: string }>();
  return <HostSettingsRoute section={section} item={itemId} />;
}

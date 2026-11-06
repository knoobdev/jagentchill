import { useLocalSearchParams } from "expo-router";
import { HostSettingsRoute } from "../../../../../src/settings/HostSettings";

export default function HostSettingsSection() {
  const { section } = useLocalSearchParams<{ hostId: string; section: string }>();
  return <HostSettingsRoute section={section} />;
}

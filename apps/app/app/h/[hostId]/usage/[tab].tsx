import { useLocalSearchParams } from "expo-router";
import { UsageScreen } from "../../../../src/usage/UsageScreen";

export default function UsageTab() {
  const { tab } = useLocalSearchParams<{ hostId: string; tab: string }>();
  return <UsageScreen key={tab} tab={tab} />;
}

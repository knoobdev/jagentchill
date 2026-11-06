import { useLocalSearchParams } from "expo-router";
import { AutomationDetailScreen } from "../../../../src/workflows/Automations";

export default function AutomationRoute() {
  const params = useLocalSearchParams<{ hostId: string; automationId: string }>();
  return <AutomationDetailScreen key={params.automationId} automationId={params.automationId} />;
}

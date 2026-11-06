import { useLocalSearchParams } from "expo-router";
import { SessionScreen } from "../../../../src/agents/SessionScreen";

export default function SessionRoute() {
  const params = useLocalSearchParams<{ hostId: string; sessionId: string; first?: string; focus?: string; workspace?: string }>();
  return <SessionScreen key={`${params.sessionId}:${params.workspace ?? "chat"}`} sessionKey={params.sessionId} first={params.first} focus={params.focus} workspaceRoute={params.workspace === "1"} />;
}

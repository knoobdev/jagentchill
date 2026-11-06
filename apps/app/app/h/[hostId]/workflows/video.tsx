import { useLocalSearchParams } from "expo-router";
import { SetupScreen } from "../../../../src/prompt-video/SetupScreen";

/** "One prompt → video": the setup of a new run, with what the Home composer already holds. */
export default function PromptVideoSetupRoute() {
  const params = useLocalSearchParams<{ hostId: string; prompt?: string; runtimeId?: string; providerId?: string; modelId?: string }>();
  const model = params.runtimeId && params.providerId && params.modelId ? { runtimeId: params.runtimeId, providerId: params.providerId, modelId: params.modelId } : null;
  return <SetupScreen prompt={params.prompt} model={model} />;
}

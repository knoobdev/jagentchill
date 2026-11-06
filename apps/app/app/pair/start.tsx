import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { useHost } from "../../src/host";
import { useT } from "../../src/locale";
import { ConnectHost } from "../../src/pairing/ConnectHost";
import { completeMobilePairing } from "../../src/pairing/complete-mobile-pairing";
import { Screen } from "../../src/shell/Shell";

/** "Add a host": the new-device side of pairing. */
export default function PairStart() {
  const t = useT();
  const router = useRouter();
  const { refreshHosts, selectHost } = useHost();
  // A pairing link opened from outside the app arrives here with its offer; nothing is trusted until the user continues.
  const { offer } = useLocalSearchParams<{ offer?: string }>();
  const leave = () => (router.canGoBack() ? router.back() : router.replace("/home"));
  return (
    <Screen title={t("Add a host")}>
      <View style={{ flex: 1 }} />
      <ConnectHost initialLink={typeof offer === "string" && offer ? `jagentchill://pair#offer=${offer}` : undefined} onClose={leave} onPaired={(gatewayId?: string) => completeMobilePairing(gatewayId, { selectHost, navigateHome: () => router.replace("/home"), refreshHosts })} />
    </Screen>
  );
}

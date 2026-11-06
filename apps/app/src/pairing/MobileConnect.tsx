import { useEffect, useState } from "react";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Linking, Platform, ScrollView, View } from "react-native";
import { PREFS } from "@jagentchill/app-core";
import { decodeOffer } from "@jagentchill/protocol";
import { Button, Card, Icon, Text, space } from "@jagentchill/ui";
import { useHost } from "../host";
import { clearPendingOffer, loadPendingOffer } from "../identity";
import { useT } from "../locale";
import { setPref } from "../state";
import { ConnectHost } from "./ConnectHost";
import { completeMobilePairing } from "./complete-mobile-pairing";
import { mobilePairingFlowKey } from "./mobile-pairing-flow-key";
import { Screen } from "../shell/Shell";

function Option(props: { title: string; description: string; icon: "qr" | "link" | "device"; onPress(): void }) {
  return <Card padding={space[3]} label={props.title} onPress={props.onPress} style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
    <Icon name={props.icon} size={22} color="accent" />
    <View style={{ flex: 1, gap: space[1] }}><Text variant="body-medium">{props.title}</Text><Text color="text/secondary">{props.description}</Text></View>
    <Icon name="chev-r" size={16} color="text/tertiary" />
  </Card>;
}

/** The native onboarding branch B's startup gate can render without changing the shared index route. */
export function MobileWelcome() {
  const t = useT();
  const router = useRouter();
  return <Screen title={t("Connect to JAgentChill")}>
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", gap: space[3], padding: space[4], maxWidth: 560, width: "100%", alignSelf: "center" }}>
      <View style={{ gap: space[2], marginBottom: space[2] }}>
        <Text variant="h1" level={1}>{t("Connect your computer to get started")}</Text>
      </View>
      <Option title={t("Scan QR code")} description={t("Scan the QR code shown on your computer.")} icon="qr" onPress={() => router.push("/pair-scan" as never)} />
      <Option title={t("Paste pairing link")} description={t("Paste the pairing link copied from your computer.")} icon="link" onPress={() => router.push("/pair-link" as never)} />
    </ScrollView>
  </Screen>;
}

/** Mobile's first pairing screen, kept in its own file so the desktop first-launch gate can call only the native branch. */
export function MobilePairStart() {
  const t = useT();
  const router = useRouter();
  return <Screen title={t("Connect to JAgentChill")}>
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", gap: space[3], padding: space[4], maxWidth: 560, width: "100%", alignSelf: "center" }}>
      <View style={{ gap: space[2], marginBottom: space[2] }}>
        <Text variant="h1" level={1}>{t("Connect your computer to get started")}</Text>
      </View>
      <Option title={t("Scan QR code")} description={t("Scan the QR code shown on your computer.")} icon="qr" onPress={() => router.push("/pair-scan" as never)} />
      <Option title={t("Paste pairing link")} description={t("Paste the pairing link copied from your computer.")} icon="link" onPress={() => router.push("/pair-link" as never)} />
    </ScrollView>
  </Screen>;
}

export function MobilePairScan() {
  const t = useT();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState("");
  const onScan = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    if (!data.includes("offer=")) { setError(t("This QR code is not a JAgentChill pairing link.")); setScanned(false); return; }
    router.replace({ pathname: "/pair-link", params: { link: data } } as never);
  };
  return <Screen title={t("Scan QR code")}>
    <View style={{ flex: 1, padding: space[4], gap: space[3], alignItems: "center", justifyContent: "center" }}>
      {Platform.OS === "web" ? <Text align="center">{t("Camera scanning is not available on web.")}</Text>
        : !permission?.granted ? <>
          <Text align="center">{permission?.canAskAgain === false
            ? t("Camera access is off. Allow camera access in your phone settings to scan a QR code, or paste the pairing link instead.")
            : t("Allow camera access to scan the QR code shown on your computer.")}</Text>
          {permission?.canAskAgain === false
            ? <Button kind="primary" label={t("Open Settings")} onPress={() => void Linking.openSettings()} />
            : <Button kind="primary" label={t("Allow camera")} onPress={() => void requestPermission()} />}
        </> : <View style={{ width: "100%", maxWidth: 420, aspectRatio: 1, overflow: "hidden", borderRadius: 16 }}>
          <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={onScan} />
        </View>}
      {error ? <Text color="danger">{error}</Text> : null}
      <Button kind="ghost" label={t("Paste pairing link")} onPress={() => router.replace("/pair-link" as never)} />
    </View>
  </Screen>;
}

export function MobilePairLink() {
  const t = useT();
  const router = useRouter();
  const { refreshHosts, selectHost } = useHost();
  const params = useLocalSearchParams<{ link?: string; offer?: string }>();
  const [saved, setSaved] = useState<string>();
  const initial = typeof params.link === "string" ? params.link : typeof params.offer === "string" ? `jagentchill://pair#offer=${params.offer}` : saved;
  useEffect(() => { if (initial) return; void loadPendingOffer().then((value) => {
    if (!value) return;
    if (!decodeOffer(value).ok) { void clearPendingOffer(); return; }
    setSaved(value);
  }); }, [initial]);
  const leave = () => router.replace("/pair-start" as never);
  return <Screen title={t("Paste pairing link")}>
    <View style={{ flex: 1 }} />
    {/* Saving a tailnet offer changes `initial` after ConnectHost mounts. Keep the pairing owner mounted so joining
        the tailnet resumes the same offer and enrolment screen instead of ending it in ConnectHost's cleanup. */}
    <ConnectHost key={mobilePairingFlowKey(initial)} initialLink={initial} onClose={leave} onPaired={(gatewayId) => {
      setPref(PREFS.welcomeSeen, true); void clearPendingOffer().catch(() => undefined);
      completeMobilePairing(gatewayId, { selectHost, navigateHome: () => router.replace("/home"), refreshHosts });
    }} />
  </Screen>;
}

/** Deep-link landing for `jagentchill://pair#offer=…`; Expo Router maps the `pair` authority to this route. */
export function PairDeepLink() {
  const params = useLocalSearchParams<{ offer?: string }>();
  const router = useRouter();
  useEffect(() => {
    const navigate = (value: string) => {
      const offer = /(?:#|[?&])offer=([^&#]+)/.exec(value)?.[1];
      if (offer) router.replace({ pathname: "/pair-link", params: { offer: decodeURIComponent(offer) } } as never);
    };
    if (typeof params.offer === "string" && params.offer) navigate(`?offer=${encodeURIComponent(params.offer)}`);
    void Linking.getInitialURL().then((url) => { if (url) navigate(url); });
    const subscription = Linking.addEventListener("url", ({ url }) => navigate(url));
    return () => subscription.remove();
  }, [params.offer, router]);
  // Reached without an offer (the link's fragment was lost, or the route was opened by hand): never a blank screen.
  return <MobileWelcome />;
}

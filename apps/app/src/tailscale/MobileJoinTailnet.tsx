import { useEffect, useRef, useState } from "react";
import { Linking, Platform, View } from "react-native";
import { Text, space } from "@jagentchill/ui";
import { useT } from "../locale";
import { getOptionalNativeTailscaleAdapter } from "./native";
import { useForegroundActive } from "../platform/foreground";
import { TailnetLoginFields } from "./TailnetLoginFields";

const adapter = getOptionalNativeTailscaleAdapter();

/** Embedded tsnet sign-in screen used between accepting a tailnet offer and showing its verification code. */
export function MobileJoinTailnet(props: { onConnected(): void; onCancel(): void }) {
  const t = useT();
  const foreground = useForegroundActive();
  const [authKey, setAuthKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const connectedCallback = useRef(props.onConnected);
  connectedCallback.current = props.onConnected;

  useEffect(() => {
    if (!waiting || !adapter || !foreground) return;
    let active = true;
    let opened = false;
    const poll = async () => {
      const status = await adapter.getStatus();
      if (!active) return;
      if (status === "connected") { setWaiting(false); connectedCallback.current(); return; }
      const url = adapter.getInteractiveLoginUrl();
      if (url) setLoginUrl(url);
      if (!opened && url && Platform.OS !== "web") { opened = true; void Linking.openURL(url).catch(() => setError(t("Could not open the Tailscale sign-in page."))); }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => { active = false; clearInterval(timer); };
  }, [waiting, t, foreground]);

  const signIn = async () => {
    if (!adapter) { setError(t("Tailscale login failed.")); return; }
    setBusy(true); setError("");
    setLoginUrl(null);
    const result = await adapter.startInteractiveLogin();
    setBusy(false);
    if (!result.ok) { setError(t("Tailscale login failed.")); return; }
    setWaiting(true);
  };

  const joinWithKey = async () => {
    const key = authKey.trim();
    if (!key || !adapter) return;
    setAuthKey(""); setBusy(true); setError("");
    const result = await adapter.loginWithAuthKey(key);
    setBusy(false);
    if (!result.ok) { setError(t("Tailscale login failed.")); return; }
    if (await adapter.getStatus() === "connected") props.onConnected();
    else setWaiting(true);
  };

  return <View testID="mobile-join-tailnet" style={{ gap: space[3], paddingVertical: space[2] }}>
    <Text variant="h1">{t("Join your tailnet")}</Text>
    <Text color="text/secondary">{t("Your phone reaches your computer over Tailscale. Sign in with the same Tailscale account as the computer.")}</Text>
    <TailnetLoginFields busy={busy} awaitingConnection={waiting} authKey={authKey} onAuthKeyChange={setAuthKey} onSignIn={() => void signIn()} onJoinWithAuthKey={() => void joinWithKey()} error={error}
      loginUrl={loginUrl} onOpenLogin={() => { if (loginUrl) void Linking.openURL(loginUrl).catch(() => setError(t("Could not open the Tailscale sign-in page."))); }}
      onCancelWaiting={props.onCancel} signInTestID="mobile-tailnet-sign-in" authKeyTestID="mobile-tailnet-auth-key" authKeySubmitTestID="mobile-tailnet-auth-key-submit" />
  </View>;
}

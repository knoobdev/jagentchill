import { View } from "react-native";
import { Button, Input, Text } from "@jagentchill/ui";
import { useT } from "../locale";

/** Shared sign-in/auth-key controls for desktop first launch and the mobile pairing detour. */
export function TailnetLoginFields(props: {
  busy: boolean;
  awaitingConnection: boolean;
  authKey: string;
  onAuthKeyChange(value: string): void;
  onSignIn(): void;
  onJoinWithAuthKey(): void;
  error?: string | null;
  unavailableReason?: string | null;
  /** The sign-in page of the Tailscale service, once the host has one: lets the person open it again. */
  loginUrl?: string | null;
  onOpenLogin?(): void;
  onCancelWaiting?(): void;
  signInTestID?: string;
  authKeyTestID?: string;
  authKeySubmitTestID?: string;
}) {
  const t = useT();
  return <>
    {props.unavailableReason ? <Text testID="tailscale-unavailable" role="alert" color="danger/text">{t("Tailscale is unavailable")}: {props.unavailableReason}</Text> : null}
    <Button testID={props.signInTestID ?? "tailscale-sign-in"} kind="primary" block label={props.busy ? t("Opening browser…") : props.awaitingConnection ? t("Connecting to Tailscale…") : t("Sign in with Tailscale")} disabled={!!props.unavailableReason} loading={props.busy || props.awaitingConnection} onPress={props.onSignIn} />
    {/* A spinner alone says nothing: while the sign-in is under way, say what the app is doing and what the person does next. */}
    {props.busy || props.awaitingConnection ? <View testID="tailscale-waiting" style={{ gap: 6, alignItems: "center" }}>
      <Text align="center">{t("Finish signing in in the browser…")}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {props.loginUrl && props.onOpenLogin ? <Button testID="tailscale-open-login" size="sm" label={t("Open the sign-in page again")} onPress={props.onOpenLogin} /> : null}
        {props.onCancelWaiting ? <Button testID="tailscale-cancel-waiting" size="sm" kind="ghost" label={t("Cancel")} onPress={props.onCancelWaiting} /> : null}
      </View>
    </View> : null}
    <Text variant="meta" color="text/secondary" align="center">{t("or")}</Text>
    <Input testID={props.authKeyTestID ?? "tailscale-auth-key"} accessibilityLabel={t("Auth key")} placeholder={t("Auth key")} value={props.authKey} onChangeText={props.onAuthKeyChange} secureTextEntry autoCapitalize="none" autoCorrect={false} />
    <Button testID={props.authKeySubmitTestID ?? "tailscale-auth-key-submit"} block label={t("Join with auth key")} disabled={!props.authKey.trim() || props.busy || props.awaitingConnection || !!props.unavailableReason} onPress={props.onJoinWithAuthKey} />
    {props.error ? <Text testID="connection-mode-error" role="alert" color="danger/text">{props.error}</Text> : null}
  </>;
}

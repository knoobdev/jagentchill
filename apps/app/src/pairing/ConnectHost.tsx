import { useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { EnrolmentSuperseded, createEnrolmentFlows, originOfAddress, upsertHostConnectionInProfiles, type FlowEnrolment, type HostRecord } from "@jagentchill/client";
import { decodeOffer } from "@jagentchill/protocol";
import { Button, Callout, Input, Modal, Text } from "@jagentchill/ui";
import { beginPairing, clearPendingOffer, defaultDeviceName, devicePlatform, endPairing, keyProtection, getHost, loadSigner, postEnrolment, saveHost, savePendingOffer } from "../identity";
import { APP_VERSION } from "../platform/build.ts";
import { useT } from "../locale";
import { messageFor } from "../messages";
import { desktop, isDesktop } from "../platform/desktop";
import { OtpCells } from "../shell/Otp";
import { getOptionalNativeTailscaleAdapter, logPairingTechnicalError } from "../tailscale/native";
import { MobileJoinTailnet } from "../tailscale/MobileJoinTailnet";
import type { TailnetProxyCredentials } from "../platform/desktop";
import { pairingLinkDisplay } from "./link-display.ts";
import { mobileOfferPath } from "./mobile-offer-path.ts";

// One pairing flow owns the bridge at a time — across screens too: the desktop's main process knows a single
// enrolment. Starting, cancelling, closing and leaving the screen all go through this one coordinator (see
// `createEnrolmentFlows`): the host is told before the main process is released, also while an enrolment is starting.
const flows = createEnrolmentFlows({
  // Pairing starts in the main process for the address being tried (nothing to do in a browser).
  begin: (origin) => beginPairingAt(origin),
  end: () => endPairing(),
  // In the desktop shell the enrolment calls cannot go to a host that is not paired yet: MAIN relays them.
  ...(isDesktop() ? { relay: (path: string, body: unknown) => postEnrolment(path.slice(path.lastIndexOf("/") + 1), JSON.stringify(body)) } : {}),
});
/** The link of the start in progress: `begin` above is told the address only. */
let startingLink = "";
let startingTailnetProxy: { origin: string; credentials: TailnetProxyCredentials } | undefined;
const beginPairingAt = (origin: string) => beginPairing(startingLink, origin, startingTailnetProxy?.origin === origin ? startingTailnetProxy.credentials : undefined);
/** An enrolment the host or the desktop has ended for good: the code step cannot go on. */
const TERMINAL = ["CODE_ATTEMPTS_EXCEEDED", "CODE_EXPIRED", "PAIRING_CANCELLED", "ENROLMENT_INACTIVE"];
const nativeTailnet = getOptionalNativeTailscaleAdapter();

/** The new-device side of pairing: paste the link, check the host, type the code a trusted device shows. */
export function ConnectHost(props: { onClose(): void; onPaired(gatewayId?: string): void; initialLink?: string }) {
  const [link, setLink] = useState(props.initialLink ?? "");
  const [name, setName] = useState(defaultDeviceName);
  const [enrolment, setEnrolment] = useState<FlowEnrolment | null>(null);
  const [joinTailnet, setJoinTailnet] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [linkFocused, setLinkFocused] = useState(false);
  const t = useT();

  // The screen's own generation: what a continuation compares with to know it was cancelled, closed or unmounted.
  const attempt = useRef(0);
  const activeTailnetOrigin = useRef<string | undefined>(undefined);
  /** Ends the flow: Cancel, the dialog's close and leaving the screen all come here. */
  const endFlow = (): void => { attempt.current += 1; void flows.end(); };
  // Leaving the screen ends it too; after a success the host is not waiting and nothing is sent.
  useEffect(() => endFlow, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function start() {
    const id = ++attempt.current;
    activeTailnetOrigin.current = undefined;
    setError(null);
    const decoded = decodeOffer(link.trim());
    if (!decoded.ok) { await clearPendingOffer(); return setError({ code: decoded.code }); }
    setBusy(true);
    try {
      let offer = decoded.offer;
      let tailnetOrigin: string | undefined;
      startingTailnetProxy = undefined;
      const tailnet = offer.addresses.find((address) => address.kind === "tailnet");
      if (nativeTailnet) {
        const status = tailnet ? await nativeTailnet.getStatus() : null;
        const path = mobileOfferPath({ hasNativeTailnet: true, hasTailnetAddress: !!tailnet, tailnetStatus: status, isDevelopment: __DEV__ });
        if (path === "join-tailnet") {
          await savePendingOffer(link.trim());
          setJoinTailnet(true);
          return;
        }
        if (path === "release-refused") {
          throw new Error(t("This computer has Tailscale turned off, so a phone cannot reach it. Turn Tailscale on in JAgentChill on the computer, then make a new pairing link."));
        }
        if (tailnet) {
          const target = new URL(tailnet.url).host;
          const proxy = nativeTailnet.getProxyAddress(target);
          if (!proxy) throw new Error(t("The embedded Tailscale proxy is unavailable."));
          tailnetOrigin = originOfAddress(tailnet.url);
          const proxyUrl = `ws://${proxy}/jagentchill/v1/ws`;
          offer = { ...offer, addresses: [{ ...tailnet, url: proxyUrl }] };
        }
      } else if (isDesktop()) {
        const tailnet = offer.addresses.find((address) => address.kind === "tailnet");
        if (tailnet) {
          const shell = desktop();
          const status = await shell?.tailnet.getStatus();
          if (status?.connected) {
            const credentials = await shell?.tailnet.getProxyCredentials();
            if (!credentials) throw new Error(t("The embedded Tailscale proxy is unavailable."));
            tailnetOrigin = originOfAddress(tailnet.url);
            if (tailnetOrigin) startingTailnetProxy = { origin: tailnetOrigin, credentials };
          }
        }
      }
      // On native, a tailnet offer uses the embedded node's loopback proxy after sign-in.
      const origins = offer.addresses.map((address) => originOfAddress(address.url));
      // The name is sent exactly as typed; only the emptiness check trims a copy.
      const deviceName = name.trim() === "" ? defaultDeviceName() : name;
      startingLink = link.trim();
      // How the key is protected is known only once the signer is loaded: the device's description is read then.
      const started = await flows.start(offer, origins, loadSigner, () => ({ deviceName, platform: devicePlatform(), appVersion: APP_VERSION, keyProtection: keyProtection() }));
      // Closed meanwhile: the coordinator is already telling the host and releasing.
      if (id !== attempt.current) return;
      activeTailnetOrigin.current = tailnetOrigin;
      setEnrolment(started);
    } catch (err) {
      if (id !== attempt.current || err instanceof EnrolmentSuperseded) return;
      if (Platform.OS === "ios" || Platform.OS === "android") logPairingTechnicalError("start", err);
      setError(err);
    } finally {
      startingTailnetProxy = undefined;
      if (id === attempt.current) setBusy(false);
    }
  }

  function cancelEnrolment(): void {
    // The pending submission's `finally` is stale from here on, so it will not clear the spinner itself; clear it here
    // or the initial screen's Continue stays inert.
    setBusy(false);
    activeTailnetOrigin.current = undefined;
    endFlow();
    void clearPendingOffer();
  }

  function close(): void {
    setBusy(false);
    activeTailnetOrigin.current = undefined;
    endFlow();
    void clearPendingOffer();
    props.onClose();
  }

  async function submit(value = code) {
    if (!enrolment || value.length !== 6) return;
    const id = attempt.current;
    setError(null);
    setBusy(true);
    try {
      const host = await enrolment.submitCode(value);
      if (id !== attempt.current) return;
      const tailnetOrigin = activeTailnetOrigin.current;
      activeTailnetOrigin.current = undefined;
      const savedHost: HostRecord = tailnetOrigin ? {
        ...host,
        origin: tailnetOrigin,
        connections: [{ id: `tailnet:${new URL(tailnetOrigin).host}`, kind: "tailnet", origin: tailnetOrigin, tailnetAddress: new URL(tailnetOrigin).host }],
        preferredConnectionId: `tailnet:${new URL(tailnetOrigin).host}`,
      } : host;
      // Pairing again with a host this device already knows adds the address just used to its saved connections.
      const known = await getHost(savedHost.gatewayId).catch(() => undefined);
      await saveHost(known ? upsertHostConnectionInProfiles([known], savedHost)[0]! : savedHost);
      await clearPendingOffer();
      // Cancellation during `saveHost` must not end a newer attempt's enrolment, reload the window or pair.
      if (id !== attempt.current) return;
      await flows.end();
      if (id !== attempt.current) return;
      // Select the new host before the reload so the next document opens its saved connection (including the embedded
      // loopback proxy route for a tailnet-only offer).
      if (isDesktop()) { await props.onPaired(host.gatewayId); window.location.reload(); return; }
      props.onPaired(host.gatewayId);
    } catch (err) {
      if (id !== attempt.current) return;
      if (Platform.OS === "ios" || Platform.OS === "android") logPairingTechnicalError("verify", err);
      setError(err);
      setCode("");
      // The enrolment is over (on the host, or in the main process: expired or ended): the code step has nothing left
      // to send. Back to the start, with the reason, and the main process is released.
      if (TERMINAL.includes((err as { code?: string }).code ?? "")) {
        await clearPendingOffer();
        enrolment.over();
        setEnrolment(null);
        void flows.end();
      }
    } finally {
      if (id === attempt.current) setBusy(false);
    }
  }

  if (!enrolment) {
    return (
      <Modal title={t("Connect a host")} description={t("On the host, open Devices → Pair a device and copy the link.")} onClose={close}
        footer={<><Button kind="ghost" label={t("Cancel")} onPress={close} />{!joinTailnet ? <Button kind="primary" label={t("Continue")} busy={busy} disabled={!link.trim()} onPress={start} /> : null}</>}>
        {joinTailnet ? <MobileJoinTailnet onConnected={() => { setJoinTailnet(false); void start(); }} onCancel={close} /> : null}
        {!joinTailnet && error ? <Callout tone="danger">{messageFor(error, t)}</Callout> : null}
        {!joinTailnet ? <View style={{ gap: 6 }}>
          <Text variant="body-medium">{t("Pairing link")}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Input accessibilityLabel={t("Pairing link")} testID="pairing-link-input" mono multiline={false} numberOfLines={1} autoCapitalize="none" autoCorrect={false} placeholder="jagentchill://pair#offer=…" value={pairingLinkDisplay(link, linkFocused)} onFocus={() => setLinkFocused(true)} onBlur={() => setLinkFocused(false)} onChangeText={setLink} clearable clearAlways clearLabel={t("Clear")} onClear={() => setLink("")} style={{ flex: 1 }} />
            <Button kind="secondary" size="sm" label={t("Paste")} testID="pairing-link-paste" onPress={() => { void Clipboard.getStringAsync().then(setLink).catch(() => undefined); }} />
          </View>
        </View> : null}
        {!joinTailnet ? <View style={{ gap: 6 }}>
          <Text variant="body-medium">{t("Name of this device")}</Text>
          <Input accessibilityLabel={t("Name of this device")} value={name} onChangeText={setName} maxLength={64} returnKeyType="go" onSubmitEditing={() => void start()} />
        </View> : null}
      </Modal>
    );
  }
  return (
    <Modal title={t("Verify pairing")} description={t("Enter the 6-digit code shown in the JAgentChill desktop connection popup, next to {fingerprint}.", { fingerprint: enrolment.fingerprint })}
      onClose={close}
      footer={<><Button kind="ghost" label={t("Cancel")} onPress={() => { cancelEnrolment(); setEnrolment(null); }} /><Button kind="primary" label={t("Pair")} busy={busy} disabled={code.length !== 6} onPress={() => submit()} /></>}>
      {error ? <Callout tone="danger">{messageFor(error, t)}</Callout> : null}
      <Text color="text/secondary">{t("Host")}: {t("JAgentChill")}</Text>
      <View style={{ alignItems: "center", paddingVertical: 8 }}>
        <OtpCells value={code} inputTestID="pairing-verification-code" onChange={(value) => { setCode(value); if (value.length === 6) void submit(value); }} onComplete={() => submit()} />
      </View>
    </Modal>
  );
}

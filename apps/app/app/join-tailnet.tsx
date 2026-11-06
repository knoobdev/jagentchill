import { useEffect, useState, useRef } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PREFS, startupRoute } from "@jagentchill/app-core";
import { Button, Card, Icon, Input, Text, useTheme, space } from "@jagentchill/ui";
import { useT } from "../src/locale";
import { desktop } from "../src/platform/desktop";
import { getPref } from "../src/state";
import { TailnetLoginFields } from "../src/tailscale/TailnetLoginFields";

type ConnectionMode = "tailscale" | "local";
const CONNECTION_NOTICE_KEY = "jagentchill.connectionNotice";
const TAILNET_RETURN_ROUTE_KEY = "jagentchill.tailnetReturnRoute";
function rememberConnectionNotice(mode: ConnectionMode, returnTo: string) {
  try { sessionStorage.setItem(CONNECTION_NOTICE_KEY, JSON.stringify({ mode, returnTo, createdAt: Date.now() })); } catch { /* Electron always provides session storage; keep the connection flow usable if storage is blocked. */ }
}
function rememberTailnetReturnRoute(route: string) {
  try { sessionStorage.setItem(TAILNET_RETURN_ROUTE_KEY, route); } catch { /* Keep the sign-in flow usable if storage is blocked. */ }
}
function clearTailnetReturnRoute() {
  try { sessionStorage.removeItem(TAILNET_RETURN_ROUTE_KEY); } catch { /* Ignore unavailable session storage. */ }
}
function clearConnectionNotice() {
  try { sessionStorage.removeItem(CONNECTION_NOTICE_KEY); } catch { /* Ignore unavailable session storage. */ }
}

/** The desktop's first-launch connection choice. The host remains stopped until the person chooses a mode. */
export default function JoinTailnet() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ manage?: string; pending?: string; returnTo?: string }>();
  const fallbackRoute = startupRoute({ welcomeSeen: true, lastRoute: getPref(PREFS.lastRoute) });
  const returnRoute = typeof params.returnTo === "string" && params.returnTo.startsWith("/") && !params.returnTo.startsWith("//") && !params.returnTo.startsWith("/join-tailnet")
    ? params.returnTo : fallbackRoute;
  const [choice, setChoice] = useState<ConnectionMode>("tailscale");
  const [busy, setBusy] = useState(false);
  // A sign-in that is under way marks the route (`pending=1`); the route change re-creates this screen, so the waiting
  // state starts from the route or the button would sit idle, with no sign of work, until the host answers.
  const [awaitingConnection, setAwaitingConnection] = useState(params.pending === "1");
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  /** This page instance asked the desktop to start the sign-in: a page that finds a sign-in pending without having asked (the app was reopened, the window reloaded) asks again, or nobody would open the browser. */
  const startedHere = useRef(false);
  const [authKey, setAuthKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const finishTailnetJoin = () => { clearTailnetReturnRoute(); router.replace(returnRoute as never); };

  useEffect(() => {
    let active = true;
    void desktop()?.tailnet.getStatus().then((status) => {
      if (!active) return;
      setUnavailableReason(status.unavailableReason ?? null);
      let pendingReturn = params.pending === "1";
      try { pendingReturn ||= sessionStorage.getItem(TAILNET_RETURN_ROUTE_KEY) === returnRoute; } catch { /* Ignore unavailable session storage. */ }
      if (status.unavailableReason && pendingReturn) { clearTailnetReturnRoute(); setAwaitingConnection(false); }
      else if (status.connected) finishTailnetJoin();
      else if (pendingReturn) setAwaitingConnection(true);
      else if (params.manage !== "1") {
        if (status.unavailableReason) setAwaitingConnection(false);
        else if (status.enabled && choice === "tailscale") setAwaitingConnection(true);
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [choice, params.manage, params.pending, returnRoute, router]);

  useEffect(() => {
    if (params.manage !== "1") return;
    void desktop()?.connectionMode.get().then((mode) => { if (mode) setChoice(mode); }).catch(() => undefined);
  }, [params.manage]);

  useEffect(() => {
    if (!awaitingConnection && params.pending !== "1") return;
    let active = true;
    const check = async () => {
      const status = await desktop()?.tailnet.getStatus().catch(() => null);
      if (!active || !status) return;
      setLoginUrl(status.loginUrl ?? null);
      if (status.connected) finishTailnetJoin();
      else if (status.unavailableReason) {
        clearTailnetReturnRoute();
        router.setParams({ pending: undefined } as never);
        setUnavailableReason(status.unavailableReason);
        setAwaitingConnection(false);
      }
    };
    void check();
    const timer = setInterval(check, 500);
    return () => { active = false; clearInterval(timer); };
  }, [awaitingConnection, params.pending, returnRoute, router]);

  const chooseLocal = async () => {
    const shell = desktop();
    if (!shell) return;
    setBusy(true);
    setError(null);
    clearTailnetReturnRoute();
    if (params.pending) router.setParams({ pending: undefined } as never);
    rememberConnectionNotice("local", returnRoute);
    try {
      await shell.connectionMode.set("local");
      router.replace(returnRoute as never);
    } catch (reason) {
      clearConnectionNotice();
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  // A sign-in left pending by an earlier page (app reopened or window reloaded mid-way): start it again so the browser opens.
  useEffect(() => {
    if (params.pending !== "1" || startedHere.current) return;
    const timer = setTimeout(() => { if (!startedHere.current) void signIn(); }, 1500);
    return () => clearTimeout(timer);
  }, [params.pending]); // eslint-disable-line react-hooks/exhaustive-deps
  const cancelWaiting = () => {
    clearTailnetReturnRoute();
    clearConnectionNotice();
    router.setParams({ pending: undefined } as never);
    setAwaitingConnection(false);
    setBusy(false);
    setLoginUrl(null);
  };
  const signIn = async () => {
    const shell = desktop();
    if (!shell) return;
    startedHere.current = true;
    setBusy(true);
    setError(null);
    rememberTailnetReturnRoute(returnRoute);
    rememberConnectionNotice("tailscale", returnRoute);
    router.setParams({ pending: "1" } as never);
    try {
      const status = await shell.tailnet.startLogin({ mode: "interactive" });
      if (status.unavailableReason) { clearTailnetReturnRoute(); router.setParams({ pending: undefined } as never); setUnavailableReason(status.unavailableReason); setAwaitingConnection(false); return; }
      setUnavailableReason(null);
      if (status.connected) finishTailnetJoin();
      else setAwaitingConnection(true);
    } catch (reason) {
      clearTailnetReturnRoute();
      router.setParams({ pending: undefined } as never);
      clearConnectionNotice();
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const joinWithAuthKey = async () => {
    const shell = desktop();
    const key = authKey.trim();
    if (!shell) return;
    if (!key) { setError(t("Enter a Tailscale auth key")); return; }
    setAuthKey("");
    setBusy(true);
    setError(null);
    rememberTailnetReturnRoute(returnRoute);
    rememberConnectionNotice("tailscale", returnRoute);
    router.setParams({ pending: "1" } as never);
    try {
      const status = await shell.tailnet.startLogin({ mode: "authKey", authKey: key });
      if (status.unavailableReason) { clearTailnetReturnRoute(); router.setParams({ pending: undefined } as never); setUnavailableReason(status.unavailableReason); setAwaitingConnection(false); return; }
      setUnavailableReason(null);
      if (status.connected) finishTailnetJoin();
      else setAwaitingConnection(true);
    } catch (reason) {
      clearTailnetReturnRoute();
      router.setParams({ pending: undefined } as never);
      clearConnectionNotice();
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const optionStyle = (selected: boolean) => ({
    flex: 1,
    minWidth: 188,
    borderColor: theme.color(selected ? "accent" : "border/hairline"),
    backgroundColor: theme.color(selected ? "accent/subtle" : "bg/app"),
  });

  return (
    <ScrollView style={{ flex: 1, width: "100%" }} contentContainerStyle={{ flexGrow: 1, width: "100%", minHeight: "100%", justifyContent: "center", padding: space[6], backgroundColor: theme.color("bg/app") }}>
      <View testID="join-tailnet-content" style={{ width: "100%", maxWidth: 520, alignSelf: "center", gap: space[5] }}>
        <View style={{ alignItems: "center", gap: space[2] }}>
          <View style={{ width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: theme.color("accent/subtle") }}>
            <Icon name="globe" size={24} color="accent/text" />
          </View>
          <Text variant="h1" level={1} align="center">{t("Join your tailnet")}</Text>
          <Text variant="body" color="text/secondary" align="center">{t("JAgentChill reaches your computer over Tailscale. Sign in to continue.")}</Text>
        </View>

        <Card padding={space[4]}>
          <View style={{ gap: space[3] }}>
            <Text variant="body-medium">{t("Connect type")}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
              <Card padding={space[3]} selected={choice === "tailscale"} onPress={() => { setChoice("tailscale"); setError(null); }} label={t("Tailscale (default)")} style={optionStyle(choice === "tailscale")}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
                  <Icon name="globe" size={16} color={choice === "tailscale" ? "accent/text" : "text/secondary"} />
                  <Text variant="body-medium">{t("Tailscale (default)")}</Text>
                </View>
              </Card>
              <Card padding={space[3]} selected={choice === "local"} onPress={() => { setChoice("local"); setError(null); }} label={t("Local")} style={optionStyle(choice === "local")}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
                  <Icon name="monitor" size={16} color={choice === "local" ? "accent/text" : "text/secondary"} />
                  <Text variant="body-medium">{t("Local")}</Text>
                </View>
              </Card>
            </View>

            {choice === "tailscale" ? (
              <>
                <Text color="text/secondary">{t("This device must be on the same tailnet as the computer running JAgentChill.")}</Text>
                <TailnetLoginFields busy={busy} awaitingConnection={awaitingConnection || params.pending === "1"} authKey={authKey} onAuthKeyChange={setAuthKey} onSignIn={() => void signIn()} onJoinWithAuthKey={() => void joinWithAuthKey()} error={error} unavailableReason={unavailableReason} loginUrl={loginUrl} onOpenLogin={() => { if (loginUrl) window.open(loginUrl, "_blank"); }} onCancelWaiting={cancelWaiting} />
              </>
            ) : (
              <>
                <Text color="text/secondary">{t("Use the local JAgentChill host on this computer.")}</Text>
                <Button testID="continue-local" kind="primary" block label={t("Continue with Local")} loading={busy} onPress={() => void chooseLocal()} />
              </>
            )}
            {choice !== "tailscale" && error ? <Text testID="connection-mode-error" role="alert" color="danger/text">{error}</Text> : null}
          </View>
        </Card>
      </View>
    </ScrollView>
  );
}

import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { AuthChoice, AuthProfile, LoginStep, ProviderListing } from "@jagentchill/protocol";
import { Button, Callout, FormField, Icon, IconButton, Input, SideSheet, Spinner, StatusPill, Text, radius, space, useTheme, useToast } from "@jagentchill/ui";
import { useAgentData } from "../agents/data";
import { codeOf, reasonOf } from "../agents/errors";
import { useHost } from "../host";
import { useT } from "../locale";
import { copyText } from "../platform/media";
import { openExternal } from "../platform/store";
import { useForegroundActive } from "../platform/foreground";
import { HEALTH, healthOf, methodOf, secretNameFor } from "./providers-model";
import { RuntimeInstallAction } from "./RuntimesTab";

export { HEALTH, secretNameFor };
/**
 * The sheet of one provider: every way it can be used on this host, side by side — the vendor's CLI installed on the
 * host (it signs in as itself; the server runs the CLI's own login and relays its steps), a sign-in under this app's
 * identity (OpenRouter), an API key — with the sign-ins already there. A key is typed here and leaves the device only
 * on the signed secret route; the channel carries its name. The host hands it to the CLIs that are set to run on it.
 */
export function ConnectSheet(props: { provider: ProviderListing | null; onClose(): void; onOpenRuntimes(): void }) {
  const t = useT();
  const foreground = useForegroundActive();
  const theme = useTheme();
  const toast = useToast();
  const { host, connection, secrets, can } = useHost();
  const data = useAgentData();
  const provider = props.provider ? data.providers.find((entry) => entry.providerId === props.provider!.providerId) ?? props.provider : null;
  const admin = can("jagentchill.config.write") && can("jagentchill.secrets.manage");
  const [busy, setBusy] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [reveal, setReveal] = useState(false);
  const [problem, setProblem] = useState<{ text: string; unreachable: boolean } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [login, setLogin] = useState<{ loginId: string; step: LoginStep; choice: AuthChoice; started_ms: number } | null>(null);
  const [answer, setAnswer] = useState("");
  const loginNow = useRef(login);
  loginNow.current = login;
  const loginRef = useRef<string | null>(null);
  const loginStarted = useRef(0);
  /** Answers on their way to the host: its state is not read back until they arrived. */
  const answering = useRef(0);
  const opened = useRef<string | null>(null);
  // While the host waits on the provider (a device code being approved, a token being exchanged) the sheet follows its state.
  const waiting = login && (login.step.kind === "device-code" || login.step.kind === "progress" || login.step.kind === "open-url") ? login.loginId : null;
  useEffect(() => {
    if (!waiting || !connection || !foreground) return;
    const read = () => void connection.call<{ step: LoginStep }>("jagentchill.provider.auth.login.status", { loginId: waiting }).then(({ step }) => {
      if (loginRef.current !== waiting || answering.current > 0) return;
      const current = loginNow.current;
      if (current && current.loginId === waiting && JSON.stringify(current.step) !== JSON.stringify(step)) show(waiting, current.choice, step);
    }).catch(() => undefined);
    const off = connection.on((event) => { if (event.event === "jagentchill.provider.auth.login.updated" && event.payload?.loginId === waiting) read(); });
    const timer = setInterval(read, 3000);
    return () => { off(); clearInterval(timer); };
  }, [waiting, connection, foreground]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setKey(""); setLabel(""); setReveal(false); setProblem(null); setResult(null); setLogin(null); setAnswer(""); loginRef.current = null; opened.current = null; }, [props.provider?.providerId]);
  if (!provider) return <SideSheet open={false} onClose={props.onClose} title="">{null}</SideSheet>;
  const cliChoices = provider.choices.filter((choice) => methodOf(choice) === "cli");
  const signIns = provider.choices.filter((choice) => methodOf(choice) === "oauth");
  const keyChoice = provider.choices.find((choice) => methodOf(choice) === "api-key" && choice.available);
  const keyProfile = provider.profiles.find((profile) => profile.type === "api-key" || profile.type === "oauth");
  const valid = key.trim().length >= 8 && key.trim().length <= 512;
  const cliRuntimeId = provider.providerId === "anthropic" ? "claude-code" : provider.providerId === "openai" ? "codex" : provider.providerId === "google" ? "gemini-cli" : undefined;
  const cli = data.catalogue?.groups.find((group) => group.kind === "cli" && group.runtimeId === cliRuntimeId);

  async function connect(saveAnyway = false) {
    if (!connection || !secrets || !keyChoice || !valid) return;
    setBusy("connect"); setProblem(null); setResult(null);
    try {
      // A replacement gets a name of its own, so a refused new key never overwrites the one in use (the host drops the
      // old one once the new one is accepted); a first key takes the provider's plain name.
      const name = secretNameFor(provider!.providerId, keyProfile ? (await secrets.list()).map((entry) => entry.name) : []);
      // The key travels on the signed route only; the call below names it.
      await secrets.put(name, key.trim());
      const done = await connection.call<{ connected: boolean; profile: AuthProfile; models: number }>("jagentchill.provider.auth.setApiKey", { providerId: provider!.providerId, choiceId: keyChoice.choiceId, secretName: name, ...(label.trim() ? { profileLabel: label.trim() } : {}), ...(saveAnyway ? { saveAnyway: true } : {}) });
      setKey(""); setLabel("");
      setResult(done.profile.health === "ok" ? t("Key accepted — {n} models", { n: done.models }) : t("Saved — {health}", { health: t(healthOf(done.profile).label) }));
      toast.show({ kind: "success", message: t("{provider} connected", { provider: provider!.label }) });
      data.reload();
    } catch (error) {
      const code = codeOf(error);
      setProblem(code === "runtime/auth-failed" ? { text: t("The provider rejected this key"), unreachable: false } : code === "TIMEOUT" || code === "runtime/endpoint-unreachable" || code === "UNAVAILABLE" ? { text: t("Unable to reach the provider"), unreachable: true } : { text: reasonOf(error), unreachable: false });
    } finally { setBusy(null); }
  }
  async function test(profile: AuthProfile) {
    setBusy(`test-${profile.profileId}`);
    try {
      const outcome = await connection!.call<{ health: string }>("jagentchill.provider.auth.test", { providerId: provider!.providerId, profileId: profile.profileId });
      toast.show({ kind: outcome.health === "ok" ? "success" : "warning", message: `${profile.label}: ${t(healthOf({ health: outcome.health as AuthProfile["health"], type: profile.type }).label)}` });
      data.reload();
    } catch (error) { toast.show({ kind: "error", message: reasonOf(error) }); } finally { setBusy(null); }
  }
  async function signOut(profile: AuthProfile) {
    setBusy(`out-${profile.profileId}`);
    try { await connection!.call("jagentchill.provider.auth.logout", { providerId: provider!.providerId, profileIds: [profile.profileId] }); toast.show({ kind: "success", message: t("{label} removed from the host", { label: profile.label }) }); data.reload(); }
    catch (error) { toast.show({ kind: "error", message: reasonOf(error) }); } finally { setBusy(null); }
  }
  // ---- the CLI's sign-in, driven step by step through the host ----
  const advance = (loginId: string, choice: AuthChoice, params: Record<string, unknown> = {}) => {
    answering.current += 1;
    void connection!.call<{ step: LoginStep }>("jagentchill.provider.auth.login.next", { loginId, ...params }).finally(() => { answering.current -= 1; }).then(({ step }) => { if (loginRef.current === loginId) show(loginId, choice, step); })
      .catch((error) => { if (loginRef.current === loginId) setLogin({ loginId, choice, started_ms: loginStarted.current, step: { kind: "error", code: codeOf(error), message: reasonOf(error) } }); });
  };
  function show(loginId: string, choice: AuthChoice, step: LoginStep) {
    setLogin({ loginId, choice, step, started_ms: loginStarted.current || Date.now() });
    if (step.kind === "open-url" && opened.current !== step.url) {
      // The sign-in page opens once. Where the page hands back a code, the host is asked for the paste step; a
      // sign-in that returns by itself (a callback to the host, the vendor's CLI) is followed by its state.
      opened.current = step.url;
      openExternal(step.url);
      if (step.returns === undefined || step.returns === "paste-code") advance(loginId, choice);
    }
    if (step.kind === "done") { loginRef.current = null; toast.show({ kind: "success", message: t("{provider} connected", { provider: provider!.label }) }); data.reload(); }
  }
  async function startLogin(choice: AuthChoice) {
    setBusy(`login-${choice.choiceId}`);
    try {
      const started = await connection!.call<{ loginId: string; step: LoginStep }>("jagentchill.provider.auth.login.start", { providerId: provider!.providerId, choiceId: choice.choiceId });
      loginRef.current = started.loginId; opened.current = null; loginStarted.current = Date.now();
      show(started.loginId, choice, started.step);
    } catch (error) { toast.show({ kind: "error", message: reasonOf(error) }); } finally { setBusy(null); }
  }
  async function cancelLogin() {
    const current = login;
    loginRef.current = null; opened.current = null; loginStarted.current = 0; setLogin(null); setAnswer("");
    if (current && current.step.kind !== "done" && current.step.kind !== "error") await connection!.call("jagentchill.provider.auth.login.cancel", { loginId: current.loginId }).catch(() => undefined);
  }
  async function submitAnswer() {
    if (!login || login.step.kind !== "enter-text" || !secrets) return;
    setBusy("answer");
    // A pasted address or code may hold a credential: it goes over the signed route under a single-use name.
    try { await secrets.put(login.step.secretName, answer); setAnswer(""); advance(login.loginId, login.choice); setLogin({ ...login, step: { kind: "progress", message: t("Checking…") } }); }
    catch (error) { toast.show({ kind: "error", message: reasonOf(error) }); } finally { setBusy(null); }
  }
  const box = { borderWidth: 1, borderColor: theme.color("border/hairline"), borderRadius: radius.md, padding: space[3], gap: space[2] } as const;
  const step = login?.step;

  /** One way to sign in, as the host offers it: who the provider will see, whether it is signed in already, what must be set up first. */
  const choiceRow = (choice: AuthChoice) => (
    <View key={choice.choiceId} testID={`choice-${choice.choiceId}`} style={{ gap: space[1] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Button size="sm" icon={methodOf(choice) === "cli" ? "kbd" : "ext"} label={choice.signedIn ? t("Sign in again — {label}", { label: choice.label }) : choice.label} disabled={!admin || busy !== null || !choice.available || !!choice.setup}
          loading={busy === `login-${choice.choiceId}`} testID={`login-${choice.choiceId}`} onPress={() => void startLogin(choice)} />
        {choice.signedIn ? <StatusPill label={choice.account ? `${t("Signed in")} · ${choice.account}` : t("Signed in")} tone="success" /> : null}
      </View>
      {choice.identity ? <Text variant="meta" color="text/secondary">{t("The provider sees: {identity}", { identity: choice.identity })}</Text> : null}
      {choice.hint ? <Text variant="meta" color="text/secondary">{choice.hint}</Text> : null}
      {choice.setup ? (
        <View style={{ gap: 2 }}>
          <Text variant="meta" color="warning/text">{t(choice.setup.reason === "needs-install" ? "Install the CLI on the host first" : "The host owner registers this app with the provider once")}</Text>
          {choice.setup.steps.map((line, index) => <Text key={index} variant="meta" color="text/secondary" selectable>{index + 1}. {line}</Text>)}
          {choice.setup.docsUrl ? <Text variant="meta" color="accent/text" underline onPress={() => openExternal(choice.setup!.docsUrl!)}>{t("Open the guide")}</Text> : null}
        </View>
      ) : !choice.available && choice.unavailableReason ? <Text variant="meta" color="text/tertiary">{choice.unavailableReason}</Text> : null}
    </View>
  );
  const loginBlock = () => (login ? (
            <View testID="login-step" style={{ gap: space[2] }}>
              <Text variant="meta" color="text/secondary">{login.choice.label}</Text>
              {step?.kind === "open-url" ? (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><Spinner size={14} label={t("Waiting for you to finish in the browser…")} /><Text>{t("Waiting for you to finish in the browser…")}</Text></View>
                  <Elapsed started_ms={login.started_ms} />
                  {step.instructions ? <Text variant="meta" color="text/secondary">{step.instructions}</Text> : null}
                  <Text variant="meta" color="accent/text" underline onPress={() => openExternal(step.url)}>{t("Open sign-in page")}</Text>
                  <View style={{ flexDirection: "row", gap: space[2] }}><Button size="xs" label={t("Open again")} onPress={() => openExternal(step.url)} /><Button size="xs" kind="ghost" label={t("Copy link")} onPress={() => void copyText(step.url).then((ok) => ok && toast.show({ kind: "success", message: t("Link copied") }))} /></View>
                </>
              ) : step?.kind === "device-code" ? (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><Spinner size={14} label={t("Waiting for you to finish in the browser…")} /><Text>{t("Waiting for you to finish in the browser…")}</Text></View>
                  <Elapsed started_ms={login.started_ms} />
                  <Text variant="mono" selectable style={{ fontSize: 28, lineHeight: 34 }}>{step.userCode}</Text>
                  {step.instructions ? <Text variant="meta" color="text/secondary">{step.instructions}</Text> : null}
                  <Text variant="meta" color="text/secondary" selectable>{step.verificationUrl}</Text>
                  <View style={{ flexDirection: "row", gap: space[2] }}><Button size="xs" label={t("Copy code")} onPress={() => void copyText(step.userCode).then((ok) => ok && toast.show({ kind: "success", message: t("Code copied") }))} /><Button size="xs" label={t("Open")} onPress={() => openExternal(step.verificationUrl)} /></View>
                  <Countdown until={step.expires_ms} />
                </>
              ) : step?.kind === "enter-text" ? (
                <>
                  {step.retryReason ? <Text variant="meta" color="danger/text">{step.retryReason}</Text> : null}
                  <FormField label={step.prompt}>{(ids) => <Input value={answer} onChangeText={setAnswer} secureTextEntry={step.masked} labelledBy={ids.labelledBy} autoFocus placeholder={t("Paste the address from your browser")} />}</FormField>
                  <View style={{ alignItems: "flex-start" }}><Button size="sm" kind="primary" label={t("Continue")} loading={busy === "answer"} disabled={!answer.trim()} onPress={() => void submitAnswer()} /></View>
                </>
              ) : step?.kind === "choose" ? (
                <>
                  <Text>{step.prompt}</Text>
                  {step.options.map((option) => <Button key={option.id} size="sm" label={option.label} onPress={() => { setLogin({ ...login, step: { kind: "progress", message: t("Checking…") } }); advance(login.loginId, login.choice, { answer: option.id }); }} />)}
                </>
              ) : step?.kind === "progress" ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><Spinner size={14} label={step.message} /><Text style={{ flex: 1 }}>{step.message || t("Waiting for sign-in…")}</Text></View>
              ) : step?.kind === "done" ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><Icon name="check-c" size={16} color="success" /><Text color="success/text">{step.account ? `${t("Connected")} · ${step.account}` : t("Connected")}</Text></View>
              ) : step?.kind === "error" ? (
                <>
                  <Text color="danger/text">{loginError(t, step.code)}</Text>
                  <View style={{ alignItems: "flex-start" }}><Button size="sm" label={t("Start again")} onPress={() => void startLogin(login.choice)} /></View>
                </>
              ) : null}
              {step && step.kind !== "done" ? <View style={{ alignItems: "flex-start" }}><Button size="xs" kind="ghost" label={t("Cancel sign-in")} onPress={() => void cancelLogin()} /></View> : null}
            </View>
  ) : null);
  return (
    <SideSheet open onClose={() => { void cancelLogin(); props.onClose(); }} title={provider.connected ? provider.label : t("Connect {provider}", { provider: provider.label })} dirty={key.length > 0}
      footer={keyChoice && admin ? <><Button kind="ghost" label={t("Cancel")} onPress={() => { void cancelLogin(); props.onClose(); }} /><Button kind="primary" label={t("Connect")} loading={busy === "connect"} disabled={!valid || busy !== null} testID="provider-connect" onPress={() => void connect()} /></> : <Button kind="ghost" label={t("Close")} onPress={() => { void cancelLogin(); props.onClose(); }} />}>
      <Text color="text/secondary">{provider.description}</Text>
      <Callout tone="info">{t("Prompts, reference images and frames you send leave this machine and go to this provider. Nothing is sent until you run a turn or a generation.")}</Callout>
      {!admin ? <Callout tone="warning">{t("Ask an admin device to connect this provider")}</Callout> : null}

      {provider.profiles.length ? (
        <View style={{ gap: space[1.5] }}>
          <Text variant="body-medium" level={3}>{t("Connected accounts")}</Text>
          {provider.profiles.map((profile) => (
            <View key={profile.profileId} testID="auth-profile" style={box}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
                <Icon name={profile.type === "cli-login" ? "kbd" : profile.type === "api-key" ? "key" : "user"} size={16} color="text/secondary" />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="body-medium" numberOfLines={1}>{profile.label}</Text>
                  <Text variant="meta" color="text/secondary" numberOfLines={1}>{[t(profile.type === "cli-login" ? "Installed CLI" : profile.type === "api-key" ? "API key" : "Account sign-in"), profile.keyHint ? `••••${profile.keyHint}` : profile.account].filter(Boolean).join(" · ")}</Text>
                </View>
                <StatusPill label={t(healthOf(profile).label)} tone={healthOf(profile).tone} />
              </View>
              {admin ? (
                <View style={{ flexDirection: "row", gap: space[2] }}>
                  <Button size="xs" label={t("Test connection")} loading={busy === `test-${profile.profileId}`} disabled={busy !== null} onPress={() => void test(profile)} />
                  <View style={{ flex: 1 }} />
                  <Button size="xs" kind="ghost" tone="danger" label={t(profile.type === "cli-login" ? "Sign out" : "Remove")} loading={busy === `out-${profile.profileId}`} disabled={busy !== null} onPress={() => void signOut(profile)} />
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {cliChoices.length || cliRuntimeId ? (
        <View testID="method-cli" style={box}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Icon name="kbd" size={16} color="text/secondary" />
            <Text variant="body-medium" style={{ flex: 1 }}>{t("Installed CLI")}{cliChoices[0]?.label ? ` · ${cliChoices[0].label}` : cli ? ` · ${cli.label}` : ""}</Text>
            {cli ? <StatusPill label={t(cli.readiness === "ready" ? "Ready" : cli.readiness === "needs-auth" ? "Signed out" : cli.readiness === "needs-install" ? "Not installed" : cli.readiness === "loading" ? "Checking" : "Error")} tone={cli.readiness === "ready" ? "success" : cli.readiness === "error" ? "danger" : "neutral"} /> : null}
          </View>
          <Text variant="meta" color="text/secondary">{t("Uses the CLI's own sign-in on {host}.", { host: host?.gatewayName ?? "" })}</Text>
          {admin && cli?.readiness === "needs-install" && cliRuntimeId ? <RuntimeInstallAction
            runtimeId={cliRuntimeId}
            label={cliChoices[0]?.label ?? cli.label}
            onInstalled={() => { data.reload(); }}
          /> : null}
          {provider.signInNote ? <Text variant="meta" color="text/secondary">{provider.signInNote}</Text> : null}
          {login && methodOf(login.choice) === "cli" ? loginBlock() : cliChoices.map((choice) => choiceRow(choice))}
          {cliRuntimeId ? <View style={{ alignItems: "flex-start" }}><Button size="xs" label={t("Open CLI runtimes")} onPress={props.onOpenRuntimes} /></View> : null}
        </View>
      ) : null}

      {signIns.length ? (
        <View testID="method-oauth" style={box}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><Icon name="user" size={16} color="text/secondary" /><Text variant="body-medium">{t("Account sign-in")}</Text></View>
          {login && methodOf(login.choice) === "oauth" ? loginBlock() : signIns.map((choice) => choiceRow(choice))}
        </View>
      ) : null}

      {keyChoice ? (
        <View testID="method-api-key" style={box}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><Icon name="key" size={16} color="text/secondary" /><Text variant="body-medium">{keyProfile ? t("Replace the API key") : t("API key")}</Text></View>
          {keyChoice.hint ? <Text variant="meta" color="text/secondary">{keyChoice.hint}</Text> : null}
          <FormField label={t("API key")} description={t("8–512 characters. Stored on the host; other devices only see the last four characters.")} error={problem?.text}>
            {(ids) => <Input value={key} onChangeText={(value) => { setKey(value); setProblem(null); }} secureTextEntry={!reveal} mono autoCapitalize="none" autoCorrect={false} disabled={!admin} labelledBy={ids.labelledBy} describedBy={ids.describedBy} invalid={!!problem} error={ids.error} testID="api-key-input"
              trailing={<IconButton icon="eye" size="xs" label={reveal ? t("Hide key") : t("Show key")} on={reveal} toggle onPress={() => setReveal(!reveal)} />} />}
          </FormField>
          <FormField label={t("Label")}>{(ids) => <Input value={label} onChangeText={setLabel} maxLength={40} placeholder={t("Team B")} disabled={!admin} labelledBy={ids.labelledBy} />}</FormField>
          {problem?.unreachable ? <View style={{ flexDirection: "row", gap: space[2] }}><Button size="xs" label={t("Save anyway")} onPress={() => void connect(true)} /><Button size="xs" label={t("Retry")} onPress={() => void connect()} /></View> : null}
          {result ? <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}><Icon name="check-c" size={14} color="success" /><Text variant="meta" color="success/text">{result}</Text></View> : null}
          <Text variant="meta" color="text/secondary">{t("A CLI runs on this key once it is chosen for it under CLI runtimes.")}</Text>
        </View>
      ) : null}

      {!cliChoices.length && !cliRuntimeId && !signIns.length && !keyChoice ? <Callout tone="info">{t("No agent CLI on this host runs on this provider.")}</Callout> : null}
    </SideSheet>
  );
}

function loginError(t: ReturnType<typeof useT>, code: string): string {
  if (code === "CANCELLED") return t("The sign-in was cancelled.");
  if (code === "runtime/launch-failed") return t("The CLI could not start its sign-in. Check that it is installed, then try again.");
  if (code === "runtime/signed-out") return t("The CLI did not finish signing in. Start again.");
  if (code === "runtime/auth-failed") return t("The provider did not accept this sign-in. Check the CLI message, then try again.");
  if (code === "runtime/login-expired") return t("This sign-in expired.");
  if (code === "SCOPE_DENIED") return t("This device can no longer change provider access. Start sign-in on an admin device.");
  if (code === "UNAVAILABLE") return t("The sign-in service is unavailable. Try again.");
  return t("The sign-in failed. Try again.");
}

function Elapsed(props: { started_ms: number }) {
  const t = useT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.floor((now - props.started_ms) / 1000));
  return <Text variant="meta" color="text/secondary" testID="login-elapsed">{t("{seconds} seconds elapsed", { seconds })}</Text>;
}

function Countdown(props: { until: number }) {
  const t = useT();
  const [now, setNow] = useState(Date.now());
  const foreground = useForegroundActive();
  useEffect(() => { if (!foreground) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [foreground]);
  const left = Math.max(0, Math.round((props.until - now) / 1000));
  return <Text variant="meta" color="text/secondary" tabular>{t("Code expires in {time}", { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` })}</Text>;
}

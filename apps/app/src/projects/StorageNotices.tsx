import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import {
  classicDataPresent, crashPrompt, createPersistenceRequest, dismissCrashPrompt, reopenAfterCrash, restoreOffered, type CrashPrompt, type MigrationDialogState, type PersistenceView, type RestoreOffer, type StorageLocale,
} from "@jagentchill/storage";
import { Banner, Button, ConfirmDialog, languageOf, Modal, ProgressBar, Text, space, useTheme, useToast } from "@jagentchill/ui";
import { useT } from "../locale";
import { classicOrigin, copyText, persistenceEnvironment, promptInstall } from "../platform/media";
import { storagePrefs, useDevice } from "../state";
import { useProjectActions } from "./actions";

/**
 * What the Projects screen says about this device's storage: the reopen prompt after a crash, the persistent-storage
 * request with its dialog and banner, and OpenCut classic data found on this origin.
 */
export function StorageNotices() {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();
  const actions = useProjectActions();
  const { storage, library } = useDevice();
  const locale = languageOf(theme.locale) as StorageLocale;
  const [crash, setCrash] = useState<CrashPrompt | null>(null);
  const [offer, setOffer] = useState<{ projectId: string; offer: RestoreOffer | null; reason: string } | null>(null);
  const [classic, setClassic] = useState(false);
  const persistence = useMemo(() => createPersistenceRequest(persistenceEnvironment(), storagePrefs, Date.now, locale), [locale]);
  const [persist, setPersist] = useState<PersistenceView | null>(null);
  useEffect(() => {
    if (!storage) return;
    let live = true;
    void crashPrompt(storage, { locale }).then((prompt) => { if (live) setCrash(prompt); }).catch(() => undefined);
    void persistence.onProjectsScreen().then((view) => { if (live) setPersist(view); }).catch(() => undefined);
    const origin = classicOrigin();
    if (origin) void classicDataPresent(origin).then((present) => { if (live) setClassic(present); }).catch(() => undefined);
    return () => { live = false; };
  }, [storage, locale, persistence]);
  if (!storage) return null;
  const reopen = async (prompt: CrashPrompt) => {
    setCrash(null);
    // Choosing Reopen answers the prompt; the editor writes the marker of its own session when it opens the project.
    await dismissCrashPrompt(storage).catch(() => undefined);
    try {
      const result = await reopenAfterCrash(storage, prompt.projectId, { locale });
      if (result.status === "opened") router.push(`/editor/${prompt.projectId}` as never);
      else setOffer({ projectId: prompt.projectId, offer: result.offer, reason: result.reason });
    } catch { router.push(`/editor/${prompt.projectId}` as never); }
  };
  const act = (id: string) => {
    if (id === "install") promptInstall();
    else if (id === "sync") router.push("/pair/start" as never);
    else if (id === "hide") setPersist(persistence.hideBanner());
  };
  const bannerActions = persist?.banner?.actions.filter((action) => action.id !== "hide").map((action) => ({ label: action.label, onPress: () => act(action.id) })) ?? [];
  const hide = persist?.banner?.actions.find((action) => action.id === "hide");
  return (
    <View style={{ gap: space[2] }}>
      {crash ? (
        <View testID="crash-prompt">
          <Banner id="crash" tone="warning" actions={[{ label: crash.actions[0].label, onPress: () => void reopen(crash) }, { label: crash.actions[1].label, onPress: () => { setCrash(null); void dismissCrashPrompt(storage); } }]}>{crash.detail ? `${crash.text} · ${crash.detail}` : crash.text}</Banner>
        </View>
      ) : null}
      {persist?.banner ? (
        <View testID="persist-banner">
          <Banner id="persist" tone="warning" actions={(hide && bannerActions.length < 2 ? [...bannerActions, { label: hide.label, onPress: () => act("hide") }] : bannerActions) as [{ label: string; onPress(): void }]}>{persist.banner.text}</Banner>
          {hide && bannerActions.length === 2 ? <View style={{ alignItems: "flex-end" }}><Button kind="link" size="xs" label={hide.label} onPress={() => act("hide")} /></View> : null}
        </View>
      ) : null}
      {classic ? <View testID="classic-banner"><Banner id="classic" tone="info" dismissible="session" actions={[{ label: t("Import"), onPress: () => { setClassic(false); void actions.importClassicOrigin(); } }]}>{t("OpenCut projects found — Import")}</Banner></View> : null}
      {persist?.dialog ? (
        <Modal title={persist.dialog.title} width={480} onClose={() => setPersist(persistence.notNow())} footer={<><View style={{ flex: 1 }} /><Button kind="ghost" label={persist.dialog.actions[1].label} onPress={() => setPersist(persistence.notNow())} /><Button kind="primary" label={persist.dialog.actions[0].label} onPress={() => void persistence.allow().then(setPersist)} /></>}>
          <Text>{persist.dialog.body}</Text>
        </Modal>
      ) : null}
      {offer ? (
        offer.offer ? <ConfirmDialog open title={t("Project could not be opened")} description={offer.reason} confirmLabel={offer.offer.text} onClose={() => setOffer(null)}
          onConfirm={() => { const pending = offer; setOffer(null); void restoreOffered(storage, pending.projectId, pending.offer!).then(async () => { await library?.refresh(pending.projectId); router.push(`/editor/${pending.projectId}` as never); }, (error) => toast.show({ kind: "error", message: error instanceof Error ? error.message : String(error) })); }} />
          : <Modal title={t("Project could not be opened")} width={480} onClose={() => setOffer(null)} footer={<><View style={{ flex: 1 }} /><Button label={t("Close")} onPress={() => setOffer(null)} /></>}><Text selectable>{offer.reason}</Text></Modal>
      ) : null}
    </View>
  );
}

/** "Updating your projects": shown while the migration runner works, with no dismiss control; then the failure summary. */
export function MigrationDialog(props: { state: MigrationDialogState | null; onRestore(projectId: string): Promise<boolean>; onCloseSummary(): void }) {
  const t = useT();
  const toast = useToast();
  const { state } = props;
  if (!state) return null;
  if (state.visible) {
    return (
      <Modal title={state.title} width={480} blocking hideClose onClose={() => {}}>
        <View testID="migration-dialog" style={{ gap: space[2] }}>
          <Text variant="body-medium" numberOfLines={1}>{state.projectName}</Text>
          <ProgressBar value={state.progress} label={state.title} />
          <Text variant="meta" color="text/secondary" live="polite">{state.counter}</Text>
        </View>
      </Modal>
    );
  }
  if (!state.summary) return null;
  return (
    <Modal title={state.title} width={640} onClose={props.onCloseSummary} footer={<><View style={{ flex: 1 }} /><Button label={t("Close")} onPress={props.onCloseSummary} /></>}>
      <View testID="migration-summary" style={{ gap: space[3] }}>
        {state.summary.map((row) => (
          <View key={row.id} style={{ gap: space[1] }}>
            <Text variant="body-medium">{row.name || row.id}</Text>
            <Text color="danger/text">{row.status}</Text>
            <Text variant="meta" color="text/secondary" selectable>{row.step ? `${row.step}: ${row.error}` : row.error}</Text>
            <View style={{ flexDirection: "row", gap: space[2] }}>
              <Button size="xs" label={row.actions[0].label} onPress={() => void copyText(row.details).then((ok) => { if (ok) toast.show({ kind: "info", message: t("Copied") }); })} />
              <Button size="xs" label={row.actions[1].label} disabled={!row.actions[1].enabled} onPress={() => void props.onRestore(row.id).then((ok) => { if (ok) toast.show({ kind: "success", message: t("Backup restored") }); })} />
            </View>
          </View>
        ))}
      </View>
    </Modal>
  );
}

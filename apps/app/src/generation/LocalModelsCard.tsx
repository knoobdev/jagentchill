import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { HostError } from "@jagentchill/client";
import { LOCAL_MODELS_CHANGED, type LocalModelQuant, type LocalModelVariant, type LocalModelsView, type OrcConfig } from "@jagentchill/protocol";
import { Avatar, Badge, Button, Callout, Card, Chip, ConfirmDialog, Dot, FormField, Input, ProgressBar, Radio, Select, Spinner, Tap, Text, space, useTheme, useToast } from "@jagentchill/ui";
import { useHost } from "../host";
import { useT } from "../locale";
import { PICTURE_SIZES, VERDICT_LABEL, bytesText, canDownload, defaultQuant, installOf, percentOf, progressText, usedByImageRole, verdictOf, withLocalImageRole } from "./local-models";

const message = (error: unknown, fallback: string) => (error instanceof HostError ? error.message : fallback);

/**
 * Settings ▸ Providers ▸ Generation ▸ Local models: Qwen-Image-2.1 on this host. The hardware check is shown before
 * anything is downloaded (a verdict per quant with the numbers measured and needed); then Download with progress,
 * pause / resume, cancel, verify, remove, where the files live, the picture size and time limit, and the Image role
 * of Model routing.
 */
export function LocalModelsCard(props: { admin: boolean }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const { connection, onEvent } = useHost();
  const [view, setView] = useState<LocalModelsView | null>(null);
  const [orc, setOrc] = useState<{ config: OrcConfig; revision: number } | null>(null);
  const [variant, setVariant] = useState<LocalModelVariant>("standard");
  const [chosen, setChosen] = useState<Partial<Record<LocalModelVariant, LocalModelQuant>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const load = useCallback(async () => {
    if (!connection) return;
    const [next, routing] = await Promise.all([connection.call<{ view: LocalModelsView }>("jagentchill.localModels.get", {}), connection.call<{ config: OrcConfig; revision: number }>("jagentchill.orc.config.get", {}).catch(() => null)]);
    setView(next.view); setOrc(routing);
  }, [connection]);
  useEffect(() => { void load().catch(() => undefined); }, [load]);
  useEffect(() => onEvent((event) => {
    if (event.event === LOCAL_MODELS_CHANGED && (event.payload as { view?: LocalModelsView } | undefined)?.view) setView((event.payload as { view: LocalModelsView }).view);
    if (event.event === "jagentchill.orc.config.changed") void load().catch(() => undefined);
  }), [onEvent, load]);
  const act = async (name: string, method: string, params: object, done?: string) => {
    if (!connection) return;
    setBusy(name); setProblem(null);
    try { const answer = await connection.call<{ view: LocalModelsView }>(method, params); if (answer?.view) setView(answer.view); if (done) toast.show({ kind: "success", message: done }); return answer; }
    catch (error) { setProblem(t(message(error, t("The request failed")))); return undefined; }
    finally { setBusy(null); }
  };
  if (!view) return <Card><View style={{ flexDirection: "row", gap: space[2], alignItems: "center" }}><Spinner size={16} /><Text color="text/secondary">{t("Checking this computer…")}</Text></View></Card>;

  const install = installOf(view, variant), quant = chosen[variant] ?? defaultQuant(view, variant), verdict = verdictOf(view, variant, quant);
  const meta = view.variants.find((entry) => entry.id === variant)!, size = meta.quants.find((entry) => entry.id === quant)!;
  const hardware = view.hardware, installedQuant = install?.state === "installed" ? install.quant : undefined;
  const modelLabel = variant === "standard" ? "Qwen-Image-2.1 (this computer)" : "Qwen-Image-2.1 Uncensored (this computer)";
  const section = (title: string) => <Text variant="meta" color="text/secondary" style={{ marginTop: space[2] }}>{t(title)}</Text>;
  const fact = (label: string, value: string, testID?: string) => (
    <View style={{ flexDirection: "row", gap: space[2] }}><Text color="text/secondary" style={{ width: 120 }}>{label}</Text><Text testID={testID} style={{ flex: 1 }}>{value}</Text></View>
  );
  const download = () => act("download", "jagentchill.localModels.download", { variant, quant });
  const useForImageRole = async () => {
    if (!connection || !orc) return;
    setBusy("orc"); setProblem(null);
    try {
      const fresh = await connection.call<{ config: OrcConfig; revision: number }>("jagentchill.orc.config.get", {});
      await connection.call("jagentchill.orc.config.update", { patch: { roles: { image: withLocalImageRole(fresh.config.roles.image, meta.modelId, t("On this computer")) } }, expectedRevision: fresh.revision });
      await load();
      toast.show({ kind: "success", message: t("The Image role now uses {model}", { model: t(modelLabel) }) });
    } catch (error) { setProblem(t(message(error, t("The request failed")))); } finally { setBusy(null); }
  };
  const routed = usedByImageRole(orc?.config, meta.modelId), narrow = theme.width < 640;

  return (
    <Card>
      <View testID="local-models-card" style={{ gap: space[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Avatar name="Qwen-Image-2.1" id="local-qwen-image" square size={24} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], flexWrap: "wrap" }}>
              <Text variant="body-medium">Qwen-Image-2.1</Text>
              <Badge label={t("On this computer")} />
              <Badge label={t("Free")} tone="accent" />
              {view.generating ? <Badge label={t("Making a picture")} tone="attention" /> : null}
            </View>
            <Text variant="meta" color="text/secondary">{t("Pictures made on this computer by Qwen-Image-2.1. Free, and nothing leaves the computer.")}</Text>
          </View>
        </View>
        <Text variant="meta" color="text/secondary">{t("License: {license} · Engine: {engine} {version}", { license: view.license.name, engine: view.engine.name, version: view.engine.version })}</Text>

        {section("This computer")}
        <View testID="local-hardware" style={{ gap: space[1], padding: space[2], borderRadius: 8, backgroundColor: theme.color("bg/subtle") }}>
          {hardware ? (
            <>
              {fact(t("Processor"), `${hardware.cpu.model} · ${t("{n} cores", { n: hardware.cpu.cores })}`)}
              {fact(t("Graphics"), hardware.gpu.kind === "apple" ? t("{name} · unified memory", { name: hardware.gpu.name }) : hardware.gpu.kind === "nvidia" ? t("{name} · {memory} of memory", { name: hardware.gpu.name, memory: bytesText(hardware.gpu.vramBytes) }) : t("No supported graphics processor"), "local-gpu")}
              {fact(t("Memory"), t("{total} · {free} free now", { total: bytesText(hardware.memory.totalBytes), free: bytesText(hardware.memory.availableBytes) }), "local-memory")}
              {fact(t("Free disk"), bytesText(hardware.disk.freeBytes), "local-disk")}
              {fact(t("Engine build"), view.engine.build ? `${view.engine.build.label} · ${bytesText(view.engine.build.bytes)}` : t("None for this computer"))}
            </>
          ) : <Text color="text/secondary">{t("Not checked yet")}</Text>}
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Button size="xs" kind="ghost" icon="refresh" label={t("Check again")} testID="local-check" loading={busy === "check"} onPress={() => void act("check", "jagentchill.localModels.check", {})} />
            {hardware ? <Text variant="meta" color="text/secondary">{t("Checked {time}", { time: new Date(hardware.checked_ms).toLocaleString() })}</Text> : null}
          </View>
        </View>

        {section("Variant")}
        <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }}>
          {view.variants.map((entry) => {
            const state = installOf(view, entry.id)?.state;
            return <View key={entry.id} testID={`local-variant-${entry.id}`}><Chip size="md" label={`${t(entry.label)}${state === "installed" ? ` · ${t("Ready")}` : state ? ` · ${t(STATE_LABEL[state])}` : ""}`} selected={variant === entry.id} onPress={() => setVariant(entry.id)} /></View>;
          })}
        </View>
        <Text variant="meta" color="text/secondary">{t(meta.description)}</Text>

        {section("Quant")}
        <View style={{ borderWidth: 1, borderColor: theme.color("border/hairline"), borderRadius: 8 }}>
          {meta.quants.map((entry, index) => {
            const row = verdictOf(view, variant, entry.id), word = row ? VERDICT_LABEL[row.verdict] : null, selected = entry.id === quant;
            return (
              <Tap key={entry.id} role="radio" checked={selected} label={t(entry.label)} testID={`local-quant-${entry.id}`} onPress={() => setChosen((current) => ({ ...current, [variant]: entry.id }))}
                style={(state) => ({ gap: space[1], paddingHorizontal: space[3], paddingVertical: space[2], borderTopWidth: index ? 1 : 0, borderTopColor: theme.color("border/hairline"), backgroundColor: selected ? theme.color("bg/subtle") : state.hovered ? theme.color("bg/hover") : "transparent" })}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: narrow ? "wrap" : "nowrap" }}>
                  <Radio selected={selected} onSelect={() => setChosen((current) => ({ ...current, [variant]: entry.id }))} accessibilityLabel={t(entry.label)} />
                  <Text variant="body-medium" style={narrow ? { flex: 1 } : { width: 130 }}>{t(entry.label)}</Text>
                  <Text tabular color="text/secondary" style={narrow ? undefined : { width: 80 }}>{bytesText(entry.downloadBytes)}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], flexGrow: 1, flexBasis: narrow ? "100%" : 0, paddingStart: narrow ? 28 : 0 }}>
                    {word ? <View style={{ flexDirection: "row", alignItems: "center", gap: space[1], flex: 1 }}><Dot tone={word.tone} label={t(word.label)} /><Text testID={`local-verdict-${entry.id}`} color={word.tone === "danger" ? "danger/text" : word.tone === "warning" ? "warning/text" : "text/primary"}>{t(word.label)}</Text></View> : <View style={{ flex: 1 }} />}
                    {row?.recommended ? <Badge label={t("Recommended")} tone="accent" /> : null}
                    {installedQuant === entry.id ? <Badge label={t("Installed")} /> : null}
                  </View>
                </View>
                {selected && row ? <View style={{ paddingStart: 28, gap: 2 }}>{row.reasons.map((reason) => <Text key={reason.text} variant="meta" color="text/secondary">{t(reason.text, reason.params)}</Text>)}</View> : null}
              </Tap>
            );
          })}
        </View>

        {section("Download")}
        <View testID="local-download-area" style={{ gap: space[2] }}>
          {!install || (install.quant !== quant && install.state === "installed") ? (
            <>
              <Text testID="local-total">{verdict && verdict.remainingBytes < verdict.downloadBytes ? t("Download {size} ({shared} already on this computer)", { size: bytesText(verdict.remainingBytes), shared: bytesText(verdict.downloadBytes - verdict.remainingBytes) }) : t("Download {size}", { size: bytesText(size.downloadBytes) })}</Text>
              {install?.state === "installed" ? <Text variant="meta" color="text/secondary">{t("The installed quant keeps working until this one is ready, then it is removed")}</Text> : null}
              {props.admin ? <View style={{ flexDirection: "row", gap: space[2] }}><Button kind="primary" size="sm" icon="download" testID="local-download" label={install?.state === "installed" ? t("Switch to this quant") : t("Download")} disabled={!canDownload(verdict)} loading={busy === "download"} onPress={() => void download()} /></View> : null}
            </>
          ) : (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
                <Dot tone={install.state === "installed" ? "success" : install.state === "failed" ? "danger" : install.state === "paused" ? "off" : "accent"} pulse={install.state === "downloading" || install.state === "verifying"} label={t(STATE_LABEL[install.state])} />
                <Text testID="local-state" variant="body-medium">{t(STATE_LABEL[install.state])}</Text>
                <Text color="text/secondary">{`${t(meta.quants.find((entry) => entry.id === install.quant)?.label ?? install.quant)} · ${bytesText(install.bytesTotal)}`}</Text>
              </View>
              {install.state !== "installed" ? (
                <View style={{ gap: space[1] }}>
                  <ProgressBar value={percentOf(install)} label={t("Download progress")} />
                  <Text testID="local-progress" variant="meta" color="text/secondary" tabular>{(({ text, params }) => t(text, params))(progressText(install))}</Text>
                  {install.files.filter((file) => file.state === "downloading" || file.state === "verifying").map((file) => <Text key={file.id} variant="meta" color="text/secondary">{t(file.state === "verifying" ? "Checking {file}…" : "Downloading {file}…", { file: t(file.label) })}</Text>)}
                </View>
              ) : (
                <Text variant="meta" color="text/secondary" testID="local-ready">{install.verified_ms ? t("Ready to make pictures · files checked {time}", { time: new Date(install.verified_ms).toLocaleString() }) : t("Ready to make pictures")}</Text>
              )}
              {(view.addOns ?? []).filter((addOn) => addOn.variant === variant).map((addOn) => (
                // What the installed variant fetches by itself (the uncensored text encoder and LoRA).
                <View key={addOn.label} testID="local-addon" style={{ gap: space[1] }}>
                  <Text variant="meta" color={addOn.state === "failed" ? "danger/text" : "text/secondary"} tabular>{addOn.state === "ready"
                    ? t("{label}: ready", { label: t(addOn.label) })
                    : addOn.state === "failed"
                      ? t("{label}: the download stopped ({error}); it is tried again by itself", { label: t(addOn.label), error: addOn.error ?? "" })
                      : t("{label}: downloading {done} of {total}", { label: t(addOn.label), done: bytesText(addOn.bytesDone), total: bytesText(addOn.bytesTotal) })}</Text>
                  {addOn.state !== "ready" ? <ProgressBar thin value={addOn.bytesTotal ? (addOn.bytesDone / addOn.bytesTotal) * 100 : null} label={t(addOn.label)} /> : null}
                </View>
              ))}
              {install.error ? <Callout tone="danger"><Text testID="local-error">{t(install.error.message)}</Text></Callout> : null}
              {props.admin ? (
                <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }}>
                  {install.state === "downloading" || install.state === "verifying" ? <Button size="sm" icon="pause" testID="local-pause" label={t("Pause")} loading={busy === "pause"} onPress={() => void act("pause", "jagentchill.localModels.pause", { variant })} /> : null}
                  {install.state === "paused" || install.state === "failed" ? <Button kind="primary" size="sm" icon="play" testID="local-resume" label={t("Resume")} loading={busy === "resume"} onPress={() => void act("resume", "jagentchill.localModels.resume", { variant })} /> : null}
                  {install.state !== "installed" ? <Button size="sm" kind="ghost" tone="danger" testID="local-cancel" label={t("Cancel download")} loading={busy === "cancel"} onPress={() => void act("cancel", "jagentchill.localModels.cancel", { variant })} /> : null}
                  {install.state === "installed" ? <Button size="sm" icon="check" testID="local-verify" label={t("Verify files")} loading={busy === "verify"} onPress={() => void act("verify", "jagentchill.localModels.verify", { variant }).then((answer) => { if (answer && (answer as { ok?: boolean }).ok) toast.show({ kind: "success", message: t("Every file matches its checksum") }); })} /> : null}
                  {install.state === "installed" ? <Button size="sm" kind="ghost" tone="danger" testID="local-remove" label={t("Remove")} onPress={() => setRemoving(true)} /> : null}
                </View>
              ) : null}
            </>
          )}
          {problem ? <Callout tone="danger"><Text testID="local-problem">{problem}</Text></Callout> : null}
        </View>

        {section("Where the files live")}
        <Text testID="local-folder" variant="meta" selectable style={{ fontFamily: "monospace" }}>{view.folder}</Text>

        {section("Pictures")}
        <View style={{ flexDirection: "row", gap: space[3], flexWrap: "wrap", alignItems: "flex-end" }}>
          <Select label={t("Picture size")} size="sm" width={260} disabled={!props.admin} value={String(view.settings.maxSide)} options={PICTURE_SIZES.map((entry) => ({ value: entry.value, label: t(entry.label) }))} onChange={(value) => void act("settings", "jagentchill.localModels.settings.set", { maxSide: Number(value) })} />
          <TimeLimit value={view.settings.timeLimitMinutes} disabled={!props.admin} onSave={(minutes) => void act("settings", "jagentchill.localModels.settings.set", { timeLimitMinutes: minutes })} />
        </View>
        <Text variant="meta" color="text/secondary">{t("One picture at a time. A smaller size or quant needs less memory and time.")}</Text>

        {section("Model routing")}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
          <Text testID="local-orc" style={{ flex: 1 }}>{routed ? t("The Image role uses this model") : t("The Image role can use this model: agents, one-prompt video and films then make their pictures here")}</Text>
          {props.admin && !routed ? <Button size="sm" testID="local-use-image-role" label={t("Use for the Image role")} disabled={install?.state !== "installed" && !(install?.state && installedQuant)} loading={busy === "orc"} onPress={() => void useForImageRole()} /> : null}
        </View>
      </View>
      <ConfirmDialog open={removing} title={t("Remove {model}?", { model: `Qwen-Image-2.1 ${t(meta.label)}` })} description={t("Its files are deleted from this computer. Files the other variant also uses are kept.")} confirmLabel={t("Remove")}
        onClose={() => setRemoving(false)} onConfirm={() => { setRemoving(false); void act("remove", "jagentchill.localModels.remove", { variant }, t("Removed")); }} />
    </Card>
  );
}

const STATE_LABEL: Record<NonNullable<ReturnType<typeof installOf>>["state"], string> = { downloading: "Downloading", paused: "Paused", verifying: "Checking files", installed: "Ready", failed: "Download failed" };

function TimeLimit(props: { value: number; disabled: boolean; onSave(minutes: number): void }) {
  const t = useT();
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  const commit = () => { const value = Math.round(Number(text)); if (Number.isFinite(value) && value >= 1 && value <= 240 && value !== props.value) props.onSave(value); else setText(String(props.value)); };
  return <View style={{ width: 160 }}><FormField label={t("Time limit per picture")}><Input accessibilityLabel={t("Time limit per picture")} size="sm" keyboardType="number-pad" suffix={t("min")} editable={!props.disabled} value={text} onChangeText={setText} onBlur={commit} onSubmitEditing={commit} /></FormField></View>;
}

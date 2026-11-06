import { useRouter } from "expo-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Image, ScrollView, View } from "react-native";
import { promptVideo as pv, script as scriptCore } from "@jagentchill/editor-core";
import type { WorkflowLogEntry } from "@jagentchill/protocol";
import { formatAmount, formatSeconds } from "@jagentchill/app-core";
import { BottomSheet, Button, Callout, ConfirmDialog, EmptyState, Icon, IconButton, Input, Segmented, Select, Skeleton, Spinner, Tabs, Tap, Text, Textarea, radius, space, useTheme, useToast } from "@jagentchill/ui";
import { useHost } from "../host";
import { useT } from "../locale";
import { useForegroundActive } from "../platform/foreground";
import { Screen, useHostScopeState } from "../shell/Shell";
import { useProjectSync } from "../sync/ProjectsSync";
import { failureOf, useRun, type RunData } from "../workflows/data";
import { NODE_STATUS_ICONS, NODE_STATUS_TOKENS, RUN_STATUS_LABELS, clock } from "../workflows/strings";
import { WORKFLOW_AGENT_PANEL, WorkflowAgentPanel, WorkflowAgentSlot } from "../workflows/WorkflowAgentPanel";
import { RunStatus } from "../workflows/WorkflowsScreen";
import { heldForBudget, useBlobUri, useRunEstimate, useShots, useSpend, useStages, type Spend, type Stage } from "./data";
import { CAN_PICK_PICTURES, pickPicture } from "./platform";
import { BudgetField, PicturesAsk, Preview, RunLog, TakeRows, Verdict, pictureVerdict } from "./RunParts";
import { CAMERA_LABELS, KIND_LABELS, MOTION_LABELS, SEVERITY_LABELS, STAGE_LABELS, STAGE_STATUS_LABELS, seconds, usd, usdRange } from "./strings";

const STEPS_WIDTH = 232;
const ACTIVE = new Set(["queued", "running", "paused", "waiting_approval"]);
const WRITTEN: readonly string[] = ["brief", "script_draft", "shot_list"];
type Act = RunData["act"];
type PanelProps = { stage: Stage; stages: Stage[]; params: pv.VideoParams; run: RunData; mayRun: boolean; /** May change the host's spending limits (an admin device). */ mayAdmin?: boolean; onShots(): void; spend: Spend | null; onBudget(budgetUsd: number): Promise<{ ok: true } | { ok: false; message: string }> };

const Label = (props: { children: string }) => <Text variant="meta" color="text/secondary">{props.children}</Text>;
const Row = (props: { label: string; children: ReactNode }) => <View style={{ gap: space[1] }}><Label>{props.label}</Label>{props.children}</View>;

/** The picture of a shot from the host's blob store. */
function Picture(props: { blobId?: string; ratio: number; testID?: string }) {
  const theme = useTheme(), uri = useBlobUri(props.blobId);
  return (
    <View testID={props.testID} {...({ dataSet: { loaded: uri ? "1" : "0" } } as object)} style={{ aspectRatio: props.ratio, borderRadius: radius.md, overflow: "hidden", backgroundColor: theme.color("bg/subtle"), alignItems: "center", justifyContent: "center" }}>
      {uri ? <Image source={{ uri }} resizeMode="cover" style={{ width: "100%", height: "100%" }} /> : props.blobId ? <Spinner size={16} /> : <Icon name="image" size="md" color="text/tertiary" />}
    </View>
  );
}

/** What a person does to a written stage: approve it as it stands (or as edited), or have it written again with notes. */
function Decide(props: { stage: Stage; run: RunData; edited?: unknown; invalid?: string }) {
  const t = useT(), toast = useToast();
  const [notes, setNotes] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { stage, run } = props, waiting = stage.status === "waiting_approval" && !!stage.check, passed = stage.check?.status === "succeeded";
  const act = async (method: string, params: Record<string, unknown>) => { setBusy(true); const result = await run.act(method, params); setBusy(false); if (!result.ok) toast.show({ kind: "error", message: result.message }); else setNotes(null); return result.ok; };
  if (!waiting && !passed) return null;
  return (
    <View style={{ gap: space[2] }}>
      {props.invalid ? <View testID="pv-invalid"><Callout tone="danger">{props.invalid}</Callout></View> : null}
      {notes !== null ? (
        <View style={{ gap: space[2] }}>
          <Textarea testID="pv-notes" value={notes} onChangeText={setNotes} placeholder={t("What should change?")} maxLength={2000} numberOfLines={3} />
          <View style={{ flexDirection: "row", gap: space[2] }}>
            <Button kind="strong" size="sm" label={t("Write again")} testID="pv-notes-send" loading={busy} disabled={!notes.trim()} onPress={() => void act("jagentchill.workflow.node.rerun", { nodeId: stage.id, notes: notes.trim() })} />
            <Button size="sm" kind="ghost" label={t("Cancel")} onPress={() => setNotes(null)} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          {waiting ? <Button kind="strong" size="sm" icon="check-c" label={props.edited !== undefined ? t("Approve with my edits") : t("Approve")} testID="pv-approve" loading={busy} disabled={!!props.invalid} onPress={() => void act("jagentchill.workflow.node.resolve", { nodeId: stage.check!.nodeId, path: "", outcome: "approved", ...(props.edited !== undefined ? { subject: props.edited } : {}) })} /> : null}
          {passed && props.edited !== undefined ? <Button kind="strong" size="sm" label={t("Save and run again from here")} testID="pv-save" loading={busy} disabled={!!props.invalid} onPress={() => void act("jagentchill.workflow.node.rerun", { nodeId: stage.check!.nodeId, outputs: { subject: props.edited } })} /> : null}
          <Button size="sm" icon="refresh" label={t("Ask for changes")} testID="pv-changes" onPress={() => setNotes("")} />
        </View>
      )}
    </View>
  );
}

function BriefPanel(props: PanelProps) {
  const t = useT(), brief = props.stage.value as pv.Brief;
  const [draft, setDraft] = useState<pv.Brief | null>(null);
  useEffect(() => setDraft(null), [brief]);
  const now = draft ?? brief, editable = props.mayRun;
  const set = (patch: Partial<pv.Brief>) => setDraft({ ...now, ...patch });
  const invalid = !now.title.trim() ? t("The title cannot be empty") : !now.visualStyle.text.trim() ? t("Describe the look") : undefined;
  return (
    <View style={{ gap: space[3] }}>
      <Row label={t("Title")}><Input testID="pv-brief-title" value={now.title} maxLength={80} readOnly={!editable} onChangeText={(title) => set({ title })} /></Row>
      <Row label={t("Audience")}><Text selectable>{now.audience}</Text></Row>
      <Row label={t("Tone")}><Input value={now.tone} maxLength={200} readOnly={!editable} onChangeText={(tone) => set({ tone })} /></Row>
      <Row label={t("Look")}><Textarea testID="pv-brief-look" value={now.visualStyle.text} maxLength={500} readOnly={!editable} numberOfLines={3} onChangeText={(text) => set({ visualStyle: { ...now.visualStyle, text } })} /></Row>
      <Row label={t("Key messages")}>{now.keyMessages.map((message, index) => <Text key={index} selectable>{`• ${message.text}`}</Text>)}</Row>
      <Row label={t("Structure")}>{now.structure.map((beat, index) => <Text key={index} selectable>{`${beat.label} — ${beat.targetDuration_s} s`}</Text>)}</Row>
      {now.openQuestions.length ? (
        <Row label={t("Questions")}>
          {now.openQuestions.map((question, index) => (
            <View key={question.id} style={{ gap: space[1] }}>
              <Text>{question.question}</Text>
              <Input testID={`pv-brief-answer-${index}`} value={question.answer ?? ""} maxLength={400} readOnly={!editable} placeholder={question.suggestedAnswers.join(" / ")}
                onChangeText={(answer) => {
                  // A person's answer rewrites the assumption its default made.
                  const before = `${question.question} — ${question.answer ?? ""}`;
                  set({ openQuestions: now.openQuestions.map((entry) => (entry.id === question.id ? { ...entry, answer } : entry)), assumptions: now.assumptions.map((entry) => (entry.text === before ? { text: `${question.question} — ${answer}`, source: "user" as const } : entry)) });
                }} />
            </View>
          ))}
        </Row>
      ) : null}
      {editable ? <Decide stage={props.stage} run={props.run} invalid={invalid} {...(draft ? { edited: draft } : {})} /> : null}
    </View>
  );
}

function ScriptPanel(props: PanelProps) {
  const t = useT(), script = props.stage.value as pv.Script;
  const [draft, setDraft] = useState<pv.Script | null>(null);
  useEffect(() => setDraft(null), [script]);
  const now = draft ?? script, own = !!props.params.script, target = own ? pv.scriptSeconds(script) : pv.speechTarget_s(props.params);
  // A spoken line takes the time its words take to read; the others keep the time the writer gave them.
  const edit = (id: string, text: string) => setDraft({ ...now, segments: now.segments.map((segment) => (segment.id === id ? { ...segment, text, estimatedDuration_s: pv.isSpoken({ ...segment, text }) ? Math.max(0.5, Math.round(scriptCore.readingSeconds(text, props.params.language) * 10) / 10) : segment.estimatedDuration_s } : segment)) });
  const total = pv.scriptSeconds(now), off = !own && Math.abs(total - target) > target * 0.1;
  const invalid = now.segments.some((segment) => segment.kind !== "silent" && !segment.text.trim()) ? t("A line cannot be empty") : off ? t("The script reads in {have} s but must read in {want} s (±10 %)", { have: formatAmount(total, { decimals: 1 }), want: formatAmount(target, { decimals: 1 }) }) : undefined;
  return (
    <View style={{ gap: space[3] }}>
      <Text variant="meta" color={off ? "danger/text" : "text/secondary"} testID="pv-script-total">{own ? t("Your own script, spoken as written · reads in {have} s", { have: formatAmount(total, { decimals: 1 }) }) : t("Reads in {have} s of {want} s", { have: formatAmount(total, { decimals: 1 }), want: formatAmount(target, { decimals: 1 }) })}</Text>
      {now.segments.map((segment, index) => (
        <View key={segment.id} style={{ gap: space[1] }}>
          <Label>{`${index + 1} · ${t(KIND_LABELS[segment.kind])}${segment.beatLabel ? ` · ${segment.beatLabel}` : ""} · ${formatSeconds(segment.estimatedDuration_s)}`}</Label>
          {segment.kind === "silent" ? <Text color="text/tertiary">{t("No words")}</Text> : <Textarea testID={`pv-script-line-${index}`} value={segment.text} maxLength={400} readOnly={!props.mayRun} numberOfLines={2} onChangeText={(text) => edit(segment.id, text)} />}
        </View>
      ))}
      {props.mayRun ? <Decide stage={props.stage} run={props.run} invalid={draft ? invalid : undefined} {...(draft ? { edited: draft } : {})} /> : null}
    </View>
  );
}

function ShotListPanel(props: PanelProps) {
  const t = useT(), list = props.stage.value as pv.ShotList, script = props.stages.find((stage) => stage.id === "script_draft")?.value as pv.Script | undefined;
  const [draft, setDraft] = useState<pv.ShotList | null>(null);
  useEffect(() => setDraft(null), [list]);
  const now = draft ?? list;
  const edit = (id: string, patch: Partial<pv.Shot>) => setDraft({ shots: now.shots.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot)) });
  const invalid = now.shots.some((shot) => !shot.description.trim()) ? t("Every shot needs a description") : undefined;
  return (
    <View style={{ gap: space[3] }}>
      <Text variant="meta" color="text/secondary" testID="pv-shots-total">{t("{n} shots · {time}", { n: now.shots.length, time: seconds(pv.totalTicks(now)) })}</Text>
      {now.shots.map((shot) => (
        <View key={shot.id} testID={`pv-shot-${shot.index}`} style={{ gap: space[1] }}>
          <Label>{`${t("Shot {n}", { n: shot.index + 1 })} · ${seconds(shot.duration_ticks)} · ${shot.shotSize}`}</Label>
          <Textarea testID={`pv-shot-description-${shot.index}`} value={shot.description} maxLength={800} readOnly={!props.mayRun} numberOfLines={2} onChangeText={(description) => edit(shot.id, { description })} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2], alignItems: "center" }}>
            <Select size="sm" width={150} label={t("Camera")} disabled={!props.mayRun} value={shot.cameraMotion} options={pv.CAMERA_MOTIONS.map((value) => ({ value, label: t(CAMERA_LABELS[value]) }))} onChange={(cameraMotion) => edit(shot.id, { cameraMotion })} />
            <View style={{ flex: 1, minWidth: 160 }}><Input size="sm" value={shot.onScreenText} maxLength={120} readOnly={!props.mayRun} placeholder={t("On-screen text")} onChangeText={(onScreenText) => edit(shot.id, { onScreenText })} /></View>
          </View>
          {/* The words live in the script: shown next to the shot, edited there. */}
          {script ? <Text variant="meta" color="text/tertiary" numberOfLines={2}>{shot.segmentIds.map((id) => script.segments.find((segment) => segment.id === id)?.text).filter(Boolean).join(" ")}</Text> : null}
        </View>
      ))}
      {props.mayRun ? <Decide stage={props.stage} run={props.run} invalid={draft ? invalid : undefined} {...(draft ? { edited: draft } : {})} /> : null}
    </View>
  );
}

/**
 * One tile per shot: its picture, what the check said about it, and what a person can do with that shot alone — have
 * it made again, put their own picture in its place, or leave it out of the video.
 */
function Shots(props: { stages: Stage[]; params: pv.VideoParams; run: RunData; runId: string; mayRun: boolean }) {
  const t = useT(), toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const assets = props.stages.find((stage) => stage.id === "assets");
  const live = useShots(props.run, props.runId, !!assets && assets.status !== "pending");
  const media = live.media ?? (assets?.value as pv.ShotMedia[] | undefined) ?? [];
  // Every shot of the shot list, also the ones a person left out; a shot that is in the video shows its final length.
  const written = (props.stages.find((stage) => stage.id === "shot_list")?.value as pv.ShotList | undefined)?.shots ?? [], timed = (props.stages.find((stage) => stage.id === "timing")?.value as pv.ShotList | undefined)?.shots ?? [];
  const [w, h] = props.params.aspectRatio.split(":").map(Number);
  if (!written.length) return <Text color="text/secondary" testID="pv-shots-empty">{t("The shots appear here once the shot list is written.")}</Text>;
  const making = assets?.status === "running" || assets?.status === "ready", settled = assets?.status === "succeeded" || assets?.status === "waiting_approval" || assets?.status === "failed";
  const doing = async (shotId: string, work: () => Promise<{ ok: true } | { ok: false; message: string }>) => { setBusy(shotId); const result = await work(); setBusy(null); if (!result.ok) toast.show({ kind: "error", message: result.message }); };
  const again = (shotId: string) => doing(shotId, () => props.run.act("jagentchill.workflow.node.rerun", { nodeId: "assets", notes: { shotId } }));
  const replace = (shotId: string) => doing(shotId, async () => {
    const file = await pickPicture();
    if (!file) return { ok: true };
    try { return await live.decide(shotId, "replace", await live.upload(file)); } catch (error) { return { ok: false, message: failureOf(error).message }; }
  });
  return (
    <View testID="pv-shots-grid" style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
      {written.map((shot) => {
        const entry = media.find((item) => item.shotId === shot.id), verdict = pictureVerdict(entry), length = timed.find((item) => item.id === shot.id)?.duration_ticks ?? shot.duration_ticks;
        const act = props.mayRun && settled && !making;
        return (
          <View key={shot.id} testID={`pv-tile-${shot.index}`} {...({ dataSet: { state: entry?.leftOut ? "deleted" : entry?.refused && !entry.media ? "refused" : entry?.media ? (entry.replaced ? "replaced" : "made") : "pending", check: entry?.check ? (entry.check.ok ? "ok" : "failed") : "none" } } as object)} style={{ width: 168, gap: space[1], opacity: entry?.leftOut ? 0.55 : 1 }}>
            <Picture blobId={entry?.media?.blobId} ratio={w / h} testID={`pv-tile-picture-${shot.index}`} />
            <Text variant="meta" numberOfLines={1}>{`${t("Shot {n}", { n: shot.index + 1 })} · ${seconds(length)}`}</Text>
            {verdict ? <Verdict verdict={verdict} testID={`pv-tile-verdict-${shot.index}`} /> : <Text variant="meta" color="text/secondary" numberOfLines={1}>{making ? t("Making…") : t("Pending")}</Text>}
            {entry?.media && !entry.leftOut ? <Text variant="meta" color="text/tertiary" numberOfLines={1}>{t(MOTION_LABELS[entry.motion])}</Text> : null}
            {entry?.refused && !entry.media && !entry.leftOut ? <Text variant="meta" color="text/secondary" numberOfLines={3} testID={`pv-tile-reason-${shot.index}`}>{entry.refused.message}</Text> : null}
            {entry?.check && !entry.check.ok && entry.media ? <Text variant="meta" color="text/secondary" numberOfLines={2}>{entry.check.why}</Text> : null}
            {act ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
                {entry?.leftOut ? <Button size="sm" kind="ghost" icon="undo" label={t("Bring back")} testID={`pv-tile-restore-${shot.index}`} loading={busy === shot.id} disabled={busy !== null} onPress={() => void doing(shot.id, () => live.decide(shot.id, "restore"))} /> : (
                  <>
                    {entry?.media && assets?.status === "succeeded" ? <Button size="sm" kind="ghost" icon="refresh" label={t("Make again")} testID={`pv-tile-again-${shot.index}`} loading={busy === shot.id} disabled={busy !== null} onPress={() => void again(shot.id)} /> : null}
                    {CAN_PICK_PICTURES ? <Button size="sm" kind="ghost" icon="image" label={t("Replace with my media")} testID={`pv-tile-replace-${shot.index}`} disabled={busy !== null} onPress={() => void replace(shot.id)} /> : null}
                    <Button size="sm" kind="ghost" icon="trash" label={t("Delete")} testID={`pv-tile-delete-${shot.index}`} disabled={busy !== null} onPress={() => void doing(shot.id, () => live.decide(shot.id, "delete"))} />
                  </>
                )}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function ReviewPanel(props: PanelProps & { projectId?: string; succeeded: boolean }) {
  const t = useT(), toast = useToast(), sync = useProjectSync();
  const report = props.stage.value as pv.ReviewReport & { project?: { projectId: string } };
  const [change, setChange] = useState<{ stage: string; notes: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const waiting = props.stage.status === "waiting_approval";
  const act = async (method: string, params: Record<string, unknown>) => { setBusy(true); const result = await props.run.act(method, params); setBusy(false); if (!result.ok) toast.show({ kind: "error", message: result.message }); else setChange(null); };
  const open = async () => { if (!props.projectId) return; setOpening(true); await sync.openFromHost(props.projectId); setOpening(false); };
  return (
    <View style={{ gap: space[3] }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[4] }}>
        <Row label={t("Score")}><Text variant="title-sm" tabular testID="pv-review-score">{String(report.score)}</Text></Row>
        <Row label={t("Duration")}><Text variant="title-sm" tabular testID="pv-review-duration">{formatSeconds(report.duration_s)}</Text></Row>
        <Row label={t("Target")}><Text variant="title-sm" tabular>{`${report.target_s} s`}</Text></Row>
        <Row label={t("Shots")}><Text variant="title-sm" tabular testID="pv-review-shots">{String(report.shots)}</Text></Row>
      </View>
      <View style={{ gap: space[1.5] }} testID="pv-review-findings">
        {report.findings.map((finding, index) => (
          <View key={index} style={{ flexDirection: "row", gap: space[2] }}>
            <Icon name={finding.severity === "info" ? "help" : "warn"} size={14} color={finding.severity === "blocker" ? "danger/text" : finding.severity === "warning" ? "warning/text" : "text/tertiary"} />
            <Text style={{ flex: 1 }} selectable>{`${t(SEVERITY_LABELS[finding.severity])}: ${finding.message}`}</Text>
          </View>
        ))}
      </View>
      {props.projectId ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}><Button icon="film" size="sm" label={props.succeeded ? t("Open in editor to export") : t("Open in editor")} testID="pv-open-editor" loading={opening} onPress={() => void open()} /></View> : null}
      {props.mayRun && (waiting || props.succeeded) ? (
        change ? (
          <View style={{ gap: space[2] }}>
            <Select label={t("What to change")} width={220} value={change.stage} options={WRITTEN.map((id) => ({ value: id, label: t(STAGE_LABELS[id]) }))} onChange={(stage) => setChange({ ...change, stage })} />
            <Textarea testID="pv-review-notes" value={change.notes} onChangeText={(notes) => setChange({ ...change, notes })} placeholder={t("What should change?")} maxLength={2000} numberOfLines={3} />
            <View style={{ flexDirection: "row", gap: space[2] }}>
              <Button kind="strong" size="sm" label={t("Write again")} testID="pv-review-send" loading={busy} disabled={!change.notes.trim()} onPress={() => void act("jagentchill.workflow.node.rerun", { nodeId: change.stage, notes: change.notes.trim() })} />
              <Button size="sm" kind="ghost" label={t("Cancel")} onPress={() => setChange(null)} />
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            {waiting ? <Button kind="strong" size="sm" icon="check-c" label={t("Accept")} testID="pv-accept" loading={busy} onPress={() => void act("jagentchill.workflow.node.resolve", { nodeId: "check_final", path: "", outcome: "approved" })} /> : null}
            <Button size="sm" icon="refresh" label={t("Ask for changes")} testID="pv-review-changes" onPress={() => setChange({ stage: "script_draft", notes: "" })} />
          </View>
        )
      ) : null}
    </View>
  );
}

/** The result of the selected stage, as content a person reads and edits, with what failed and the stage's own log. */
function StagePanel(props: PanelProps & { projectId?: string; succeeded: boolean }) {
  const t = useT(), theme = useTheme(), toast = useToast(), sync = useProjectSync();
  const { stage, run } = props, exec = stage.exec;
  const [logs, setLogs] = useState<WorkflowLogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let alive = true; void (stage.id === "assets" ? run.logs().then((entries) => entries.filter((entry) => pv.PICTURE_STEPS.includes(entry.nodeId))) : run.logs({ nodeId: stage.id })).then((entries) => { if (alive) setLogs(entries.slice(-30)); }, () => undefined); return () => { alive = false; }; }, [run.version, stage.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (method: string, params: Record<string, unknown>) => { setBusy(true); const result = await run.act(method, params); setBusy(false); if (!result.ok) toast.show({ kind: "error", message: result.message }); };
  const value = stage.value, has = value !== undefined && value !== null;
  let body: ReactNode = null;
  const ask = stage.id === "assets" ? <PicturesAsk stage={stage} run={run} mayRun={props.mayRun} onShots={props.onShots} /> : null;
  if (stage.status === "running" || stage.status === "ready") body = <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><Spinner size={14} /><Text color="text/secondary">{t("Working…")}</Text></View>;
  else if (!has && stage.id === "music" && stage.status === "succeeded") body = <Text color="text/secondary" testID="pv-no-music">{exec?.outputs?.skipped ? `${t("No music")}: ${String(exec.outputs.skipped)}` : t("No music")}</Text>;
  else if (!has) body = stage.status === "failed" ? null : <Text color="text/secondary">{t("Nothing here yet")}</Text>;
  else if (stage.id === "brief") body = <BriefPanel {...props} />;
  else if (stage.id === "script_draft") body = <ScriptPanel {...props} />;
  else if (stage.id === "shot_list") body = <ShotListPanel {...props} />;
  else if (stage.id === "assets") {
    const made = (value as pv.ShotMedia[]).filter((entry) => entry.media && !entry.leftOut), checked = made.filter((entry) => entry.check?.ok).length;
    body = (
      <View style={{ gap: space[2] }}>
        <Text testID="pv-pictures-count">{made.some((entry) => entry.check) ? t("{n} pictures · {checked} checked against their shot", { n: made.length, checked }) : t("{n} pictures · not checked against their shots", { n: made.length })}</Text>
        <Button size="sm" kind="link" label={t("Show the shots")} testID="pv-goto-shots" onPress={props.onShots} />
      </View>
    );
  }
  else if (stage.id === "voiceover") body = (value as pv.Take[]).length ? <TakeRows takes={value as pv.Take[]} script={props.stages.find((entry) => entry.id === "script_draft")?.value as pv.Script | undefined} /> : <Text color="text/secondary" testID="pv-no-voice-takes">{exec?.outputs?.skipped ? `${t("No narration")}: ${String(exec.outputs.skipped)}` : t("No narration")}</Text>;
  else if (stage.id === "music") body = <Text testID="pv-music-track">{`${(value as NonNullable<pv.MusicTrack>).media.name} · ${seconds((value as NonNullable<pv.MusicTrack>).media.duration_ticks ?? 0)}`}</Text>;
  else if (stage.id === "timing") body = <View style={{ gap: space[1] }}><Text testID="pv-timing-total">{t("{n} shots · {time}", { n: (value as pv.ShotList).shots.length, time: seconds(pv.totalTicks(value as pv.ShotList)) })}</Text>{(value as pv.ShotList).shots.map((shot) => <Text key={shot.id} color="text/secondary">{`${t("Shot {n}", { n: shot.index + 1 })} — ${seconds(shot.duration_ticks)}`}</Text>)}</View>;
  else if (stage.id === "captions") body = (value as pv.CaptionSet).cues.length ? <View style={{ gap: space[1] }} testID="pv-cues">{(value as pv.CaptionSet).cues.map((cue, index) => <Text key={index}>{`${seconds(cue.start_ticks)}  ${cue.text.replace(/\n/g, " / ")}`}</Text>)}</View> : <Text color="text/secondary">{t("No captions")}</Text>;
  else if (stage.id === "assemble") {
    const project = value as { projectId: string; name?: string }, report = exec?.outputs?.report as pv.AssembleReport | undefined;
    body = (
      <View style={{ gap: space[2] }}>
        <Text variant="body-medium" testID="pv-project-name">{project.name ?? t("Project")}</Text>
        {report ? <Text color="text/secondary" testID="pv-assemble-report">{t("{clips} clips · {voice} voice clips · {cues} captions · {music} music clips · {time}", { clips: report.clips, voice: report.voiceElements, cues: report.captionCues, music: report.musicElements, time: seconds(report.duration_ticks) })}</Text> : null}
        <View style={{ flexDirection: "row" }}><Button icon="film" size="sm" label={t("Open in editor")} testID="pv-open-project" onPress={() => void sync.openFromHost(project.projectId)} /></View>
      </View>
    );
  } else body = <ReviewPanel {...props} />;
  const budget = exec?.error?.code === "BUDGET_EXCEEDED", held = heldForBudget(exec);
  // The run would pass what was confirmed at its start: the one money question is asked again, with the new figure.
  const over = budget ? (exec?.error?.details as { reason?: string; scope?: string; confirmedUsd?: number | null; spentUsd?: number; modelId?: string; unpricedModels?: string[]; estimate?: { amountUsd?: number; unpricedModels?: string[] } } | undefined) : undefined;
  // The step would use a model whose price is not known and that nobody allowed for this run: nothing was sent to it. Only the person's own yes, to that model by name, lets it be used.
  const unpriced = over?.reason === "unpriced_model" && over.scope === "confirmed_estimate" ? (over.unpricedModels?.length ? over.unpricedModels : over.modelId ? [over.modelId] : []) : [];
  // The models of unknown price a run nobody confirmed would use: named on its first question, allowed by that confirmation.
  const namedAtFirst = over?.reason === "confirmation_required" && over.confirmedUsd === null ? over.estimate?.unpricedModels ?? [] : [];
  // `never`: nobody has confirmed any amount for this run yet (it was not started from the form) — the question is the first one, not "more".
  const more = over?.reason === "confirmation_required" && typeof over.estimate?.amountUsd === "number" ? { confirmedUsd: over.confirmedUsd ?? 0, never: over.confirmedUsd === null, spentUsd: over.spentUsd ?? 0, totalUsd: over.estimate.amountUsd } : null;
  const stop = over as { scope?: string; remainingUsd?: number } | undefined, ownBudget = stop?.scope === "session";
  // Which limit stopped the step, in words (the host's own message is a code-like line: it stays in the Log tab).
  const limitWords = !budget ? "" : ownBudget ? (props.spend?.budgetUsd ? t("The budget of this run ({amount}) does not cover the next step.", { amount: usd(props.spend.budgetUsd) }) : t("The budget of this run does not cover the next step."))
    : stop?.scope === "provider" ? t("The spending limit of the provider does not cover the next step.") : stop?.scope === "project" ? t("The spending limit of the project does not cover the next step.") : stop?.scope === "global" ? t("The spending limit of this host does not cover the next step.") : exec?.error?.message ?? "";
  // What the card above already says is not said again under "Log", and no error code is put before a person here.
  const notice = (stage.status === "failed" || held) && !!exec?.error;
  const shownLogs = logs.filter((entry) => !(notice && exec?.error && entry.message.includes(exec.error.message))).map((entry) => ({ ...entry, message: entry.message.replace(/^[A-Z][A-Z0-9_]{3,}: /, "") }));
  const confirmMore = async () => {
    if (!more || !exec) return;
    setBusy(true);
    const confirmed = await run.act("jagentchill.workflow.video.confirm", { confirmedUsd: more.totalUsd, ...(namedAtFirst.length ? { allowUnpriced: namedAtFirst } : {}) });
    // A paused run goes on by the confirmation itself; a step that FAILED on the guard (a run nobody followed) is retried.
    const result = confirmed.ok && !held ? await run.act("jagentchill.workflow.node.retry", { nodeId: exec.nodeId, path: "" }) : confirmed;
    setBusy(false);
    if (!result.ok) toast.show({ kind: "error", message: result.message });
  };
  const allowModels = async () => {
    if (!unpriced.length || !exec) return;
    setBusy(true);
    const allowed = await run.act("jagentchill.workflow.video.confirm", { allowUnpriced: unpriced });
    const result = allowed.ok && !held ? await run.act("jagentchill.workflow.node.retry", { nodeId: exec.nodeId, path: "" }) : allowed;
    setBusy(false);
    if (!result.ok) toast.show({ kind: "error", message: result.message });
  };
  return (
    <ScrollView testID={`pv-panel-${stage.id}`} style={{ flex: 1 }} contentContainerStyle={{ padding: space[4], gap: space[3], maxWidth: 760, width: "100%" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Text variant="title-sm" style={{ flex: 1 }}>{t(STAGE_LABELS[stage.id])}</Text>
        {stage.costUsd > 0 ? <Text variant="meta" color="text/secondary" tabular testID="pv-stage-cost">{usd(stage.costUsd)}</Text> : null}
        {props.mayRun && stage.status === "succeeded" && ["assets", "voiceover", "music"].includes(stage.id) ? <Button size="sm" kind="ghost" icon="refresh" label={t("Run again")} testID="pv-rerun" loading={busy} onPress={() => void act("jagentchill.workflow.node.rerun", { nodeId: stage.id, ...(stage.id === "music" ? {} : { notes: { all: true } }) })} /> : null}
      </View>
      {(stage.status === "failed" || held) && exec?.error && unpriced.length ? (
        <View testID="pv-allow-model" {...({ dataSet: { models: unpriced.join(",") } } as object)} style={{ gap: space[2] }}>
          <Callout tone="warning" title={t("The price of {model} is not known", { model: unpriced.join(", ") })}>{`${t("Nothing was sent to it. If you allow it, this run may use {model}; what it costs is not in the amount you confirmed.", { model: unpriced.join(", ") })}\n${t("What was already made is kept.")}`}</Callout>
          {props.mayRun ? <View style={{ flexDirection: "row" }}><Button size="sm" kind="strong" icon="check-c" label={t("Allow {model} and continue", { model: unpriced.join(", ") })} testID="pv-allow-model-go" loading={busy} onPress={() => void allowModels()} /></View> : null}
        </View>
      ) : (stage.status === "failed" || held) && exec?.error && more ? (
        <View testID="pv-confirm-more" {...({ dataSet: { total: String(more.totalUsd), confirmed: more.never ? "none" : String(more.confirmedUsd) } } as object)} style={{ gap: space[2] }}>
          {more.never ? <Callout tone="warning" title={t("Confirm the cost of this video")}>{`${t("This video is estimated at about {total}. Its cost was not confirmed when it was started.", { total: usd(more.totalUsd) })}${namedAtFirst.map((model) => `\n${t("The price of {model} is not known. What it costs is not in the amount above. Confirming allows this run to use it.", { model })}`).join("")}\n${t("Nothing is paid until you confirm.")}`}</Callout> : null}
          {more.never ? null : <Callout tone="warning" title={t("This video would cost more than you confirmed")}>{`${t("It has cost {spent} so far and would pass the {confirmed} you confirmed. It now comes to about {total}.", { spent: usd(more.spentUsd), confirmed: usd(more.confirmedUsd), total: usd(more.totalUsd) })}\n${t("What was already made is kept. Nothing more is spent until you confirm.")}`}</Callout>}
          {props.mayRun ? <View style={{ flexDirection: "row" }}><Button size="sm" kind="strong" icon="check-c" label={t("Confirm {amount} and continue", { amount: usd(more.totalUsd) })} testID="pv-confirm-more-go" loading={busy} onPress={() => void confirmMore()} /></View> : null}
        </View>
      ) : (stage.status === "failed" || held) && exec?.error ? (
        // A spending limit of the host (the run's own budget, a provider's, the host's) holds an attended run: the step waits, it has not failed.
        <View testID="pv-stage-error" {...({ dataSet: { code: exec.error.code, held: String(held) } } as object)} style={{ gap: space[2] }}>
          <Callout tone={held ? "warning" : "danger"} title={budget ? t("Spending limit reached") : t("This step failed")}>{budget ? `${limitWords}\n${ownBudget ? t("Raise the budget of this run, then continue. What was already made is kept.") : props.mayAdmin ? t("Raise the limit under Settings, Providers, Generation, then continue. What was already made is kept.") : t("Ask an admin device to raise the limit, then continue. What was already made is kept.")}` : exec.error.message}</Callout>
          {props.mayRun && budget && ownBudget ? (props.mayAdmin ? <BudgetField spend={props.spend} onSet={props.onBudget} /> : <Text variant="meta" color="text/secondary" testID="pv-budget-ask-admin">{t("Ask an admin device")}</Text>) : null}
          {props.mayRun ? <View style={{ flexDirection: "row" }}><Button size="sm" icon={held ? "play" : "refresh"} label={held ? t("Continue") : t("Retry")} testID="pv-retry" loading={busy} onPress={() => void (held ? act("jagentchill.workflow.run.resume", {}) : act("jagentchill.workflow.node.retry", { nodeId: exec.nodeId, path: "" }))} /></View> : null}
        </View>
      ) : null}
      {ask}
      {body}
      {shownLogs.length ? (
        <View style={{ gap: space[0.5], paddingTop: space[2], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }} testID="pv-stage-log">
          <Label>{t("Log")}</Label>
          {shownLogs.map((entry) => <Text key={entry.seq} variant="mono" selectable color={entry.level === "error" ? "danger/text" : entry.level === "warn" ? "warning/text" : "text/secondary"}>{entry.message.slice(0, 300)}</Text>)}
        </View>
      ) : null}
    </ScrollView>
  );
}

/**
 * A run of "One prompt → video": the stages on one side, the selected stage's result as editable content on the other,
 * the shots as a grid. It follows the run's stream, so what the host does is on screen as it happens.
 */
export function VideoRunScreen(props: { runId: string }) {
  const t = useT(), theme = useTheme(), router = useRouter(), toast = useToast();
  const { host, can, status: link } = useHost();
  const scope = useHostScopeState(t("Workflows"));
  const run = useRun(scope ? null : props.runId);
  const { stages, loaded } = useStages(run);
  const { spend, setBudget } = useSpend(run, props.runId);
  const listed = stages.find((stage) => stage.id === "shot_list")?.value as pv.ShotList | undefined, scripted = stages.find((stage) => stage.id === "script_draft")?.value as pv.Script | undefined;
  const estimate = useRunEstimate(run.snapshot?.run.params as unknown as pv.VideoParams | undefined, listed?.shots.length ? { shots: listed.shots.length, spoken: scripted?.segments.filter(pv.isSpoken).length ?? 0 } : null);
  const [picked, setPicked] = useState<pv.StageId | null>(null);
  const [tab, setTab] = useState("output");
  const [pane, setPane] = useState<"steps" | "output" | "shots" | "preview" | "log">("output");
  const [now, setNow] = useState(Date.now());
  const [confirm, setConfirm] = useState(false);
  const [agent, setAgent] = useState(false);
  const [width, setWidth] = useState(0);
  const record = run.snapshot?.run, active = !!record && ACTIVE.has(record.status);
  const foreground = useForegroundActive();
  useEffect(() => { if (!active || link !== "connected" || !foreground) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [active, link, foreground]);
  // Until a person picks a stage the screen follows the run: what needs them, what failed, what is running, the last one done.
  const follow = useMemo(() => (stages.find((stage) => stage.status === "waiting_approval") ?? stages.find((stage) => stage.status === "failed") ?? stages.find((stage) => stage.status === "running") ?? [...stages].reverse().find((stage) => stage.status === "succeeded") ?? stages[0]).id, [stages]);
  const base = `/h/${host?.gatewayId}/workflows`;
  if (scope) return <Screen title={t("Workflows")}>{scope}</Screen>;
  const crumbs = [{ id: "workflows", label: t("Workflows"), onPress: () => router.push(`${base}?tab=runs` as never) }, { id: "run", label: record ? `${record.workflowName} #${record.number}` : t("Run") }];
  if (run.error && !run.snapshot) return <Screen title={t("Run")} crumbs={crumbs}><EmptyState icon="warn" title={t("Unable to load run")} description={failureOf(run.error).message} actions={[{ label: t("Retry"), onPress: run.reload }]} /></Screen>;
  if (!run.snapshot || !record || !loaded) return <Screen title={t("Run")} crumbs={crumbs}><View style={{ padding: space[5], gap: space[2] }}>{Array.from({ length: 5 }, (_, at) => <Skeleton key={at} height={40} />)}</View></Screen>;

  const params = record.params as unknown as pv.VideoParams, mayRun = can("jagentchill.generation.run");
  const selected = stages.find((stage) => stage.id === (picked ?? follow))!;
  const brief = stages[0].value as pv.Brief | undefined, title = brief?.title ?? ((params.prompt ?? "").slice(0, 60) || t("Video"));
  const done = stages.filter((stage) => stage.status === "succeeded" || stage.status === "skipped").length;
  const elapsed = record.started_ms ? (record.finished_ms ?? now) - record.started_ms : 0;
  const cost = stages.reduce((sum, stage) => sum + stage.costUsd, 0);
  const projectId = (stages.find((stage) => stage.id === "assemble")?.value as { projectId?: string } | undefined)?.projectId;
  const shots = ((stages.find((stage) => stage.id === "shot_list")?.value as pv.ShotList | undefined)?.shots ?? []).length;
  const act = async (method: string) => { const result = await run.act(method); if (!result.ok) toast.show({ kind: "error", message: result.message }); };
  const context = `[One prompt → video, run #${record.number}: ${record.status}. Prompt: ${(params.prompt ?? params.script ?? "").slice(0, 400)}. Stage on screen: ${selected.label} (${selected.status}).]`;

  const stepList = (
    <ScrollView testID="pv-steps" style={theme.compact ? { flex: 1 } : { width: STEPS_WIDTH, flexGrow: 0, borderEndWidth: 1, borderEndColor: theme.color("border/hairline") }} contentContainerStyle={{ padding: space[2], gap: space[0.5] }}>
      <View style={{ paddingHorizontal: space[2], paddingVertical: space[1] }}><Text variant="meta" color="text/secondary" testID="pv-steps-done">{t("Steps · {done} of {total} done", { done, total: stages.length })}</Text></View>
      {stages.map((stage) => (
        <View key={stage.id} testID={`pv-step-${stage.id}`} {...({ dataSet: { status: stage.status } } as object)}>
        <Tap role="button" label={t(STAGE_LABELS[stage.id])} onPress={() => { setPicked(stage.id); setTab("output"); setPane("output"); }}
          style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[2], paddingVertical: space[1.5], borderRadius: radius.md, backgroundColor: selected.id === stage.id ? theme.color("bg/subtle") : "transparent" }}>
          {stage.status === "running" ? <Spinner size={14} /> : <Icon name={NODE_STATUS_ICONS[stage.status]} size={14} color={NODE_STATUS_TOKENS[stage.status]} />}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="body-medium" numberOfLines={1}>{t(STAGE_LABELS[stage.id])}</Text>
            <Text variant="meta" color={stage.status === "waiting_approval" ? "warning/text" : stage.status === "failed" ? "danger/text" : "text/secondary"} numberOfLines={1}>{t(STAGE_STATUS_LABELS[stage.status])}</Text>
          </View>
          {stage.costUsd > 0 ? <Text variant="meta" color="text/secondary" tabular>{usd(stage.costUsd)}</Text> : null}
        </Tap>
        </View>
      ))}
    </ScrollView>
  );
  const output = <StagePanel key={selected.id} stage={selected} stages={stages} params={params} run={run} mayRun={mayRun} mayAdmin={can("jagentchill.config.write")} onShots={() => { setTab("shots"); setPane("shots"); }} spend={spend} onBudget={setBudget} succeeded={record.status === "succeeded"} {...(projectId ? { projectId } : {})} />;
  const grid = <ScrollView testID="pv-shots" style={{ flex: 1 }} contentContainerStyle={{ padding: space[4] }}><Shots stages={stages} params={params} run={run} runId={props.runId} mayRun={mayRun} /></ScrollView>;
  const preview = <Preview stages={stages} params={params} />, log = <RunLog run={run} />;
  // The figure now in force: the new amount a held step asks for; else what was confirmed when that is more than the first estimate; else the estimate.
  const askedUsd = stages.map((stage) => (heldForBudget(stage.exec) ? (stage.exec?.error?.details as { reason?: string; estimate?: { amountUsd?: number } } | undefined) : undefined)).find((details) => details?.reason === "confirmation_required" && typeof details.estimate?.amountUsd === "number")?.estimate?.amountUsd;
  const confirmedUsd = spend?.confirmedUsd ?? null;
  const estimateText = askedUsd !== undefined ? usd(askedUsd) : estimate && confirmedUsd !== null && confirmedUsd > estimate.highUsd + 1e-9 ? null : estimate ? (estimate.lowUsd === estimate.highUsd ? usd(estimate.lowUsd) : usdRange(estimate.lowUsd, estimate.highUsd)) : null;
  const banner = link !== "connected" ? { tone: "warning" as const, text: t("Reconnecting… showing last known state") }
    : record.status === "waiting_approval" ? { tone: "warning" as const, text: t("Waiting for you") }
    : record.status === "paused" && record.pauseReason === "budget_exceeded" ? { tone: "warning" as const, text: t("Waiting for you") }
    : record.status === "paused" ? { tone: "info" as const, text: t("Paused") }
    : record.status === "succeeded" ? { tone: "success" as const, text: t("The video is ready: open it in the editor to watch and export it.") }
    : null;
  const overlayAgent = width > 0 && width - WORKFLOW_AGENT_PANEL.width - STEPS_WIDTH < 360;

  return (
    <Screen title={title} crumbs={[crumbs[0], { id: "run", label: title }]} documentTitle={title}
      actions={<>
        <RunStatus status={record.status} label={t(RUN_STATUS_LABELS[record.status])} />
        {theme.compact ? null : <Text variant="meta" color="text/secondary" testID="pv-mode-label">{params.mode === "auto" ? t("Auto") : t("Checkpoints")}</Text>}
        {theme.compact ? null : <Text variant="meta" color="text/secondary" tabular testID="pv-elapsed">{clock(elapsed)}</Text>}
        {theme.compact ? null : estimateText ? <Text variant="meta" color="text/secondary" tabular testID="pv-run-estimate" {...({ dataSet: { kind: askedUsd !== undefined ? "asked" : "estimate" } } as object)}>{t("Estimate {amount}", { amount: estimateText })}</Text>
          : confirmedUsd !== null && estimate ? <Text variant="meta" color="text/secondary" tabular testID="pv-run-estimate" {...({ dataSet: { kind: "confirmed" } } as object)}>{t("Confirmed {amount}", { amount: usd(confirmedUsd) })}</Text> : null}
        <IconButton icon="bot" size="sm" label={t("Agent")} on={agent} toggle testID="pv-toggle-agent" onPress={() => setAgent(!agent)} />
        <IconButton icon="flow" size="sm" label={t("Diagram")} testID="pv-diagram" onPress={() => router.push(`${base}/runs/${record.id}?diagram=1` as never)} />
        {mayRun && record.status === "running" ? <Button size="sm" icon="pause" label={t("Pause")} testID="pv-pause" onPress={() => void act("jagentchill.workflow.run.pause")} /> : null}
        {mayRun && record.status === "paused" && record.pauseReason !== "budget_exceeded" ? <Button size="sm" icon="play" label={t("Resume")} testID="pv-resume" onPress={() => void act("jagentchill.workflow.run.resume")} /> : null}
        {mayRun && active ? <Button size="sm" kind="ghost" label={t("Cancel")} testID="pv-cancel" onPress={() => setConfirm(true)} /> : null}
      </>}>
      {banner ? <View testID="pv-banner" style={{ paddingHorizontal: space[3], paddingTop: space[2] }}><Callout tone={banner.tone}>{banner.text}</Callout></View> : null}
      {theme.compact ? (
        <View style={{ flex: 1, minHeight: 0 }}>
          <View style={{ padding: space[2] }}><Segmented<"steps" | "output" | "shots" | "preview" | "log"> block size="sm" label={t("Run view")} value={pane} onChange={setPane} options={[{ value: "steps" as const, label: t("Steps") }, { value: "output" as const, label: t("Output") }, { value: "shots" as const, label: t("Shots") }, { value: "preview" as const, label: t("Preview") }, { value: "log" as const, label: t("Log") }]} /></View>
          {pane === "steps" ? stepList : pane === "shots" ? grid : pane === "preview" ? preview : pane === "log" ? log : output}
          <BottomSheet open={agent} onClose={() => setAgent(false)} title={t("Agent")}><View style={{ height: 560 }}><WorkflowAgentPanel sheet workflowId={record.workflowId} workflowName={title} context={context} overlay={false} onClose={() => setAgent(false)} /></View></BottomSheet>
        </View>
      ) : (
        <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
          {stepList}
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ paddingHorizontal: space[3], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}><Tabs id="pv-run" label={t("Run view")} items={[{ id: "output", label: t("Output") }, { id: "shots", label: shots ? `${t("Shots")} ${shots}` : t("Shots") }, { id: "preview", label: t("Preview") }, { id: "log", label: t("Log") }]} value={tab} onChange={setTab} /></View>
            {tab === "shots" ? grid : tab === "preview" ? preview : tab === "log" ? log : output}
          </View>
          <WorkflowAgentSlot open={agent} overlay={overlayAgent}><WorkflowAgentPanel workflowId={record.workflowId} workflowName={title} context={context} overlay={overlayAgent} onClose={() => setAgent(false)} /></WorkflowAgentSlot>
        </View>
      )}
      <View testID="pv-footer" style={{ height: 32, flexDirection: "row", alignItems: "center", gap: space[4], paddingHorizontal: space[4], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
        <Text variant="meta" color="text/secondary">{t("Elapsed {time}", { time: clock(elapsed) })}</Text>
        <Text variant="meta" color="text/secondary" testID="pv-cost" {...(spend?.budgetUsd ? {} : { style: { flex: 1 } })}>{t("Cost so far {amount}", { amount: usd(spend?.spentUsd ?? cost) })}</Text>
        {spend?.budgetUsd ? <Text variant="meta" color={spend.remainingUsd !== null && spend.remainingUsd <= 0 ? "danger/text" : "text/secondary"} testID="pv-budget-left" style={{ flex: 1 }} numberOfLines={1}>{t("Budget {budget} · {left} left", { budget: usd(spend.budgetUsd), left: usd(spend.remainingUsd ?? 0) })}</Text> : null}
        {active && link === "connected" ? <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}><Icon name="refresh" size={12} color="success" /><Text variant="meta" color="text/secondary">{t("Live")}</Text></View> : null}
      </View>
      <ConfirmDialog open={confirm} title={t("Cancel this run?")} description={t("Steps that are running are stopped. You can resume from where it stopped.")} confirmLabel={t("Cancel run")} onClose={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void act("jagentchill.workflow.run.cancel"); }} />
    </Screen>
  );
}

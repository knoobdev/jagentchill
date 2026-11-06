import { useState } from "react";
import { ScrollView, View } from "react-native";
import { SCRIPT_ASPECT_RATIOS, type ScriptEntityKind } from "@jagentchill/protocol";
import { script as s } from "@jagentchill/editor-core";
import { formatDateTime } from "@jagentchill/app-core";
import { Badge, Button, Callout, Checkbox, Chip, ConfirmDialog, FormDialog, FormField, IconButton, Input, Menu, RadioGroup, Select, Tabs, Text, Textarea, radius, space, useTheme, useToast, type MenuItem } from "@jagentchill/ui";
import { useT } from "../locale";
import { useScriptEditor, type InspectorTab } from "./context";
import { SCENE_COLORS } from "./Navigator";
import { LABELS, messageOf, optionsOf } from "./strings";

const TAB_LABELS = { details: "Details", selection: "Selection", review: "Review", versions: "Versions", comments: "Comments", activity: "Activity" };
const Section = (props: { title: string; children: React.ReactNode; testID?: string }) => <View testID={props.testID} style={{ gap: space[2] }}><Text variant="title-sm" level={3}>{props.title}</Text>{props.children}</View>;
/** A text field of the inspector: typed locally and written as the user types, one undo step per pause. */
function TextField(props: { label: string; value: string; max: number; multiline?: boolean; testID: string; readOnly?: boolean; onChange(value: string): void }) {
  const Field = props.multiline ? Textarea : Input;
  return <FormField label={props.label}>{() => <Field value={props.value} maxLength={props.max} readOnly={props.readOnly} testID={props.testID} onChangeText={props.onChange} />}</FormField>;
}
const list = (text: string, max: number, each: number): string[] => [...new Set(text.split(",").map((item) => item.trim().slice(0, each)).filter(Boolean))].slice(0, max);

function Details() {
  const t = useT(), theme = useTheme(), editor = useScriptEditor(), toast = useToast(), { document } = editor, { meta } = document, ro = editor.readOnly;
  const [target, setTarget] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | undefined>(undefined);
  const [tags, setTags] = useState<string | null>(null);
  const [avoid, setAvoid] = useState<string | null>(null);
  const [include, setInclude] = useState<string | null>(null);
  const [report, setReport] = useState<s.ConstraintReport | null>(null);
  const [entity, setEntity] = useState<{ kind: ScriptEntityKind; name: string } | null>(null);
  const [remove, setRemove] = useState<{ kind: ScriptEntityKind; id: string; name: string; replace: string } | null>(null);
  const [rename, setRename] = useState<{ kind: ScriptEntityKind; id: string; name: string; mentions: boolean } | null>(null);
  const set = (patch: Parameters<typeof s.setMeta>[0], key: string) => editor.run(s.setMeta(patch, `meta:${key}`));
  const constraints = document.constraints ?? {};
  const constrain = (patch: Partial<typeof constraints>) => { const next = { ...constraints, ...patch }; for (const key of Object.keys(next) as (keyof typeof next)[]) if (next[key] === undefined || (Array.isArray(next[key]) && (next[key] as unknown[]).length === 0)) delete next[key]; editor.run(s.setConstraints(next)); };
  const commitTarget = () => {
    if (target === null) return;
    const text = target.trim();
    setTarget(null);
    if (text === "") { setTargetError(undefined); set({ targetDuration_s: undefined }, "target"); return; }
    const ticks = s.parseDuration(text), seconds = ticks === null ? NaN : ticks / s.TICKS_PER_SECOND;
    // Out of range: the message is shown and the value is not saved.
    if (!(seconds >= 5 && seconds <= 10_800)) { setTargetError(t("Target duration must be between 5 seconds and 3 hours")); return; }
    setTargetError(undefined);
    set({ targetDuration_s: seconds }, "target");
  };
  return (
    <View style={{ gap: space[5] }}>
      <Section title={t("Details")} testID="inspector-details">
        <TextField label={t("Logline")} value={meta.logline} max={300} multiline readOnly={ro} testID="meta-logline" onChange={(logline) => set({ logline }, "logline")} />
        <TextField label={t("Synopsis")} value={meta.synopsis} max={4000} multiline readOnly={ro} testID="meta-synopsis" onChange={(synopsis) => set({ synopsis }, "synopsis")} />
        <FormField label={t("Genre")} description={t("Up to 3")}>{() => (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
            {optionsOf(t, LABELS.genre).map((option) => { const on = meta.genre.includes(option.value); return <Chip key={option.value} size="sm" label={option.label} selected={on} disabled={ro || (!on && meta.genre.length >= 3)} onPress={() => set({ genre: on ? meta.genre.filter((value) => value !== option.value) : [...meta.genre, option.value] }, "genre")} />; })}
          </View>
        )}</FormField>
        <TextField label={t("Tone")} value={meta.tone} max={200} readOnly={ro} testID="meta-tone" onChange={(tone) => set({ tone }, "tone")} />
        <TextField label={t("Audience")} value={meta.audience} max={200} readOnly={ro} testID="meta-audience" onChange={(audience) => set({ audience }, "audience")} />
        <FormField label={t("Language")} description={t("A language tag such as en, vi or ja")}>{() => <Input value={meta.language} maxLength={35} readOnly={ro} testID="meta-language" onChangeText={(language) => { if (language.trim().length >= 2) set({ language: language.trim() }, "language"); }} />}</FormField>
        <FormField label={t("Target duration")} description={t("Seconds or m:ss; empty for none")} error={targetError}>{() => <Input value={target ?? (meta.targetDuration_s === undefined ? "" : s.formatClock(meta.targetDuration_s * s.TICKS_PER_SECOND))} readOnly={ro} error={targetError} testID="meta-target" onChangeText={setTarget} onBlur={commitTarget} onSubmitEditing={commitTarget} />}</FormField>
        <FormField label={t("Aspect ratio")}>{() => <Select label={t("Aspect ratio")} disabled={ro} value={meta.aspectRatio} onChange={(aspectRatio) => set({ aspectRatio }, "ratio")} options={SCRIPT_ASPECT_RATIOS.map((value) => ({ value, label: value }))} />}</FormField>
        <FormField label={t("Pace")}>{() => <Select label={t("Pace")} disabled={ro} value={meta.pace} onChange={(pace) => set({ pace }, "pace")} options={optionsOf(t, LABELS.pace)} />}</FormField>
        <TextField label={t("Author")} value={meta.author} max={120} readOnly={ro} testID="meta-author" onChange={(author) => set({ author }, "author")} />
        <TextField label={t("Notes")} value={meta.notes} max={4000} multiline readOnly={ro} testID="meta-notes" onChange={(notes) => set({ notes }, "notes")} />
        <FormField label={t("Tags")} description={t("Separated by commas, up to 10")}>{() => <Input value={tags ?? meta.tags.join(", ")} readOnly={ro} testID="meta-tags" onChangeText={setTags} onBlur={() => { if (tags !== null) { set({ tags: list(tags, 10, 24) }, "tags"); setTags(null); } }} />}</FormField>
      </Section>
      <Section title={t("Constraints")} testID="inspector-constraints">
        <FormField label={t("Must avoid")} description={t("Words or phrases, separated by commas")}>{() => <Input value={avoid ?? (constraints.mustAvoid ?? []).join(", ")} readOnly={ro} testID="constraint-avoid" onChangeText={setAvoid} onBlur={() => { if (avoid !== null) { constrain({ mustAvoid: list(avoid, 50, 200) }); setAvoid(null); } }} />}</FormField>
        <FormField label={t("Must include")} description={t("Phrases or facts, separated by commas")}>{() => <Input value={include ?? (constraints.mustInclude ?? []).join(", ")} readOnly={ro} testID="constraint-include" onChangeText={setInclude} onBlur={() => { if (include !== null) { constrain({ mustInclude: list(include, 20, 200) }); setInclude(null); } }} />}</FormField>
        <FormField label={t("Longest spoken line")}>{() => <Select label={t("Longest spoken line")} disabled={ro} value={String(constraints.lineMaxChars ?? 400)} onChange={(value) => constrain({ lineMaxChars: value === "400" ? undefined : Number(value) })} options={["400", "300", "200", "120", "80"].map((value) => ({ value, label: t("{n} characters", { n: value }) }))} />}</FormField>
        <Checkbox label={t("Spoken lines must fit caption cues")} checked={!!constraints.captionSafe} disabled={ro} onChange={(captionSafe) => constrain({ captionSafe: captionSafe || undefined })} />
        <Checkbox label={t("No factual claim beyond the sources")} checked={constraints.claimsPolicy === "sources-only"} disabled={ro} onChange={(on) => constrain({ claimsPolicy: on ? "sources-only" : undefined })} />
        <View style={{ alignItems: "flex-start" }}><Button kind="outline" size="sm" icon="check-c" label={t("Check script")} testID="check-script" onPress={() => setReport(s.checkScript(document))} /></View>
        {report ? (
          <View testID="check-report" style={{ gap: space[1] }}>
            <Callout tone={report.passed ? "success" : "danger"}>{report.findings.length === 0 ? t("No problems found") : report.passed ? t("No blockers; see the warnings below") : t("This script has constraint violations")}</Callout>
            {report.findings.map((finding, index) => (
              <View key={index} testID="check-finding" style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
                <Badge label={finding.severity === "blocker" ? t("Blocker") : t("Warning")} tone={finding.severity === "blocker" ? "danger" : "warning"} />
                <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={2}>{finding.constraint === "mustAvoid" ? t("Contains a phrase to avoid: {excerpt}", { excerpt: finding.excerpt }) : finding.constraint === "speaker" ? t("Add a speaker") : finding.constraint === "claimsPolicy" ? t("Check this fact") : finding.message}</Text></View>
                {finding.targetId && s.findLine(document, finding.targetId) ? <Button kind="link" size="sm" label={t("Go to")} testID="check-goto" onPress={() => editor.goToLine(finding.targetId!)} /> : null}
              </View>
            ))}
          </View>
        ) : null}
      </Section>
      <Section title={t("Cast and places")} testID="inspector-cast">
        {(["characters", "locations", "props"] as const).map((kind) => (
          <View key={kind} style={{ gap: space[1] }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text variant="body-medium" style={{ flex: 1 }}>{t(LABELS.entity[kind])}</Text>
              {ro ? null : <IconButton icon="plus" size="xs" label={t("Add to {kind}", { kind: t(LABELS.entity[kind]) })} testID={`entity-add-${kind}`} onPress={() => setEntity({ kind, name: "" })} />}
            </View>
            {document.entities[kind].length === 0 ? <Text variant="meta" color="text/secondary">{t("None yet")}</Text> : document.entities[kind].map((item) => {
              const usage = s.entityUsage(document, kind, item.id);
              return (
                <View key={item.id} testID={`entity-${item.name}`} style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
                  <View style={{ width: 8, height: 8, borderRadius: radius.full, backgroundColor: theme.color(`clip/${SCENE_COLORS[item.colorIndex - 1]}`) }} />
                  <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1}>{item.name}</Text><Text variant="meta" color="text/secondary">{[usage.lines === 1 ? t("1 line") : t("{n} lines", { n: usage.lines }), usage.scenes === 1 ? t("1 scene") : t("{n} scenes", { n: usage.scenes })].join(" · ")}</Text></View>
                  {ro ? null : <IconButton icon="pencil" size="xs" label={t("Rename {name}", { name: item.name })} testID={`entity-rename-${item.name}`} onPress={() => setRename({ kind, id: item.id, name: item.name, mentions: kind === "characters" })} />}
                  {ro ? null : <IconButton icon="trash" size="xs" label={t("Delete {name}", { name: item.name })} testID={`entity-delete-${item.name}`} onPress={() => { const used = usage.lines + usage.scenes + usage.shots > 0; if (used) setRemove({ kind, id: item.id, name: item.name, replace: "" }); else editor.run(s.deleteEntity(kind, item.id)); }} />}
                </View>
              );
            })}
          </View>
        ))}
      </Section>
      <FormDialog open={!!entity} title={entity ? t("Add to {kind}", { kind: t(LABELS.entity[entity.kind]) }) : ""} submitLabel={t("Add")} dirty={!!entity?.name} canSubmit={!!entity?.name.trim()} onClose={() => setEntity(null)} onSubmit={() => { if (entity && editor.run(s.addEntity(entity.kind, entity.name)) !== undefined) setEntity(null); }}>
        <FormField label={t("Name")}>{() => <Input value={entity?.name ?? ""} maxLength={60} autoFocus testID="entity-name" onChangeText={(name) => entity && setEntity({ ...entity, name })} />}</FormField>
      </FormDialog>
      <FormDialog open={!!rename} title={rename ? t("Rename {name}", { name: document.entities[rename.kind].find((item) => item.id === rename.id)?.name ?? "" }) : ""} submitLabel={t("Rename")} dirty canSubmit={!!rename?.name.trim()} onClose={() => setRename(null)}
        onSubmit={() => { if (!rename) return; const done = rename.kind === "characters" ? editor.run(s.renameCharacter(rename.id, rename.name, rename.mentions)) : editor.run(s.updateEntity(rename.kind, rename.id, { name: rename.name.trim() })); if (done !== undefined || rename.kind !== "characters") { if (done && typeof done === "object" && "mentions" in done && (done.mentions as number) > 0) toast.show({ kind: "success", message: t("{n} mentions replaced", { n: done.mentions as number }) }); setRename(null); } }}>
        <View style={{ gap: space[2] }}>
          <FormField label={t("Name")}>{() => <Input value={rename?.name ?? ""} maxLength={60} autoFocus testID="entity-new-name" onChangeText={(name) => rename && setRename({ ...rename, name })} />}</FormField>
          {rename?.kind === "characters" ? <Checkbox label={t("Also replace mentions in action and dialogue")} checked={rename.mentions} onChange={(mentions) => setRename({ ...rename, mentions })} /> : null}
        </View>
      </FormDialog>
      <FormDialog open={!!remove} title={remove ? t("Delete {name}?", { name: remove.name }) : ""} description={t("It is used in this script.")} submitLabel={t("Delete")} dirty={false} onClose={() => setRemove(null)} onSubmit={() => { if (remove) { editor.run(s.deleteEntity(remove.kind, remove.id, remove.replace ? { replaceWith: remove.replace } : {})); setRemove(null); } }}>
        {remove ? <RadioGroup label={t("What happens to its references")} value={remove.replace} onChange={(replace) => setRemove({ ...remove, replace })} options={[{ value: "", label: t("Keep the name as text") }, ...document.entities[remove.kind].filter((item) => item.id !== remove.id).map((item) => ({ value: item.id, label: t("Replace with {name}", { name: item.name }) }))]} /> : null}
      </FormDialog>
    </View>
  );
}

function SelectionTab() {
  const t = useT(), editor = useScriptEditor(), { document } = editor, ro = editor.readOnly;
  const [override, setOverride] = useState<string | null>(null);
  const scene = editor.selection.sceneId ? s.findScene(document, editor.selection.sceneId) : undefined;
  const ref = editor.selection.lineIds.length === 1 ? s.findLine(document, editor.selection.lineIds[0]) : undefined;
  const picked = editor.selection.shotIds.length === 1 ? s.findShot(document, editor.selection.shotIds[0]) : undefined;
  if (!scene && !ref && !picked) return <Text color="text/secondary" testID="selection-empty">{t("Select a scene, a line or a shot to see its fields.")}</Text>;
  const setShot = (patch: s.ShotPatch) => { if (picked) editor.run(s.updateShots([picked.shot.id], patch)); };
  const commitOverride = () => { if (override === null || !scene) return; const ticks = override.trim() === "" ? undefined : s.parseDuration(override) ?? undefined; setOverride(null); editor.run(s.updateScenes([scene.id], { durationOverride_ticks: ticks })); };
  return (
    <View style={{ gap: space[5] }}>
      {scene ? (
        <Section title={t("Scene {n}", { n: s.sceneNumber(document, scene.id) })} testID="selection-scene">
          <TextField label={t("Title")} value={scene.title} max={80} readOnly={ro} testID="scene-title" onChange={(title) => editor.run(s.updateScenes([scene.id], { title }))} />
          <FormField label={t("Colour")}>{() => <Select label={t("Colour")} disabled={ro} value={String(scene.colorIndex ?? 0)} onChange={(value) => editor.run(s.updateScenes([scene.id], { colorIndex: value === "0" ? undefined : Number(value) }))} options={[{ value: "0", label: t("No colour") }, ...["Blue", "Purple", "Green", "Orange", "Pink", "Magenta", "Teal", "Amber"].map((name, index) => ({ value: String(index + 1), label: t(name) }))]} />}</FormField>
          <FormField label={t("Duration override")} description={t("Seconds or m:ss; empty to use the estimate")}>{() => <Input value={override ?? (scene.durationOverride_ticks === undefined ? "" : s.formatClock(scene.durationOverride_ticks))} readOnly={ro} testID="scene-override" onChangeText={setOverride} onBlur={commitOverride} onSubmitEditing={commitOverride} />}</FormField>
          <Checkbox label={t("Omitted")} checked={scene.omitted} disabled={ro} onChange={(omitted) => editor.run(s.updateScenes([scene.id], { omitted }))} />
        </Section>
      ) : null}
      {picked ? (
        <Section title={t("Shot {n}", { n: s.shotNumber(document, picked.shot.id) })} testID="selection-shot">
          <TextField label={t("Description")} value={picked.shot.description} max={800} multiline readOnly={ro} testID="selection-shot-description" onChange={(description) => setShot({ description })} />
          <FormField label={t("Size")}>{() => <Select label={t("Size")} disabled={ro} value={picked.shot.size} onChange={(size) => setShot({ size })} options={optionsOf(t, LABELS.size)} />}</FormField>
          <FormField label={t("Angle")}>{() => <Select label={t("Angle")} disabled={ro} value={picked.shot.angle} onChange={(angle) => setShot({ angle })} options={optionsOf(t, LABELS.angle)} />}</FormField>
          <FormField label={t("Movement")}>{() => <Select label={t("Movement")} disabled={ro} value={picked.shot.movement} onChange={(movement) => setShot({ movement })} options={optionsOf(t, LABELS.movement)} />}</FormField>
          <TextField label={t("Notes")} value={picked.shot.notes} max={600} multiline readOnly={ro} testID="selection-shot-notes" onChange={(notes) => setShot({ notes })} />
        </Section>
      ) : null}
      {ref ? (
        <Section title={t(LABELS.kind[ref.line.kind])} testID="selection-line">
          <FormField label={t("Kind")}>{() => <Select label={t("Kind")} disabled={ro} value={ref.line.kind} onChange={(kind) => editor.run(s.setLineKind([ref.line.id], kind))} options={optionsOf(t, LABELS.kind)} />}</FormField>
          <FormField label={t("Language of this line")} description={t("Empty to use the script's language")}>{() => <Input value={ref.line.language ?? ""} maxLength={35} readOnly={ro} testID="line-language" onChangeText={(language) => { if (language === "" || language.trim().length >= 2) editor.run(s.updateLine(ref.line.id, { language: language.trim() || undefined })); }} />}</FormField>
          <Checkbox label={t("Check this fact")} checked={!!ref.line.needsCheck} disabled={ro} onChange={(needsCheck) => editor.run(s.updateLine(ref.line.id, { needsCheck }))} />
          <Text variant="meta" color="text/secondary" testID="line-estimate">{t("Estimated {duration}", { duration: s.formatSeconds(s.lineTicks(document, ref.scene, ref.line.id)) })}</Text>
        </Section>
      ) : null}
    </View>
  );
}

function ReviewTab() {
  const t = useT(), theme = useTheme(), editor = useScriptEditor(), toast = useToast(), { session } = editor, { document } = session;
  const [note, setNote] = useState("");
  const policy = s.effectivePolicy(document), status = document.status, open = session.history.openReview;
  const act = (action: s.ReviewAction, done?: string) => { try { session.review(action); setNote(""); if (done) toast.show({ kind: "success", message: done }); } catch (error) { toast.show({ kind: "error", message: messageOf(t, error) }); } };
  const version = (id: string) => session.history.versions.find((entry) => entry.versionId === id)?.number ?? "?";
  const approval = s.approvalLabel(document, session.history);
  return (
    <View style={{ gap: space[5] }}>
      <Section title={t("Approval")} testID="review-policy">
        <FormField label={t("Who approves")}>{() => <Select label={t("Who approves")} disabled={status === "in_review" || status === "locked"} value={policy.mode} onChange={(mode) => act({ type: "set_policy", mode })} options={optionsOf(t, LABELS.policy)} />}</FormField>
        <Text variant="meta" color="text/secondary" testID="review-policy-source">{status === "in_review" ? t("Withdraw the review to change the policy") : policy.source === "script" ? t("Set by this script") : t("Default for scripts on this device")}</Text>
        {approval ? <View style={{ alignItems: "flex-start" }}><Chip size="sm" icon="check" label={`${t(approval)} · ${t("Version {n}", { n: version(document.approvedVersionId!) })}`} /></View> : null}
      </Section>
      <Section title={t("Review")} testID="review-actions">
        {status === "draft" ? <View style={{ alignItems: "flex-start" }}><Button kind="strong" size="sm" label={policy.mode === "auto" ? t("Submit") : t("Submit for review")} testID="review-submit" onPress={() => act({ type: "submit" }, policy.mode === "auto" ? t("Approved automatically — not reviewed") : t("Submitted for review"))} /></View> : null}
        {status === "changes_requested" ? <View style={{ alignItems: "flex-start" }}><Button kind="strong" size="sm" label={t("Resubmit")} testID="review-resubmit" onPress={() => act({ type: "resubmit" }, t("Submitted for review"))} /></View> : null}
        {status === "in_review" && open ? (
          <View style={{ gap: space[2] }}>
            <Text testID="review-ask">{t("{name} asks you to approve version {n}", { name: open.submitter.name === "This device" ? t("This device") : open.submitter.name, n: version(open.versionId) })}{open.round > 1 ? ` · ${t("Round {n}", { n: open.round })}` : ""}</Text>
            <FormField label={t("Note")} description={t("Required to request changes or to reject")}>{() => <Textarea value={note} maxLength={4000} testID="review-note" onChangeText={setNote} />}</FormField>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
              <Button kind="strong" size="sm" label={editor.readOnly ? t("Approve") : t("Approve with my edits")} testID="review-approve" onPress={() => act({ type: "approve", note, edited: !editor.readOnly }, t("Approved"))} />
              <Button kind="outline" size="sm" label={t("Request changes")} testID="review-request-changes" onPress={() => act({ type: "request_changes", note }, t("Changes requested"))} />
              <Button kind="outline" size="sm" tone="danger" label={t("Reject and close")} testID="review-reject" onPress={() => act({ type: "reject", note }, t("Rejected and closed"))} />
              <Button kind="ghost" size="sm" label={t("Withdraw")} testID="review-withdraw" onPress={() => act({ type: "withdraw" }, t("Review withdrawn"))} />
            </View>
          </View>
        ) : null}
        {status === "approved" ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
            <Button kind="outline" size="sm" label={t("Review this version")} testID="review-reopen" onPress={() => act({ type: "review_approved" })} />
            <Button kind="outline" size="sm" icon="lock" label={t("Lock")} testID="review-lock" onPress={() => act({ type: "lock" }, t("Locked"))} />
          </View>
        ) : null}
        {status === "locked" ? <View style={{ alignItems: "flex-start" }}><Button kind="outline" size="sm" icon="lock" label={t("Unlock")} testID="review-unlock" onPress={() => act({ type: "unlock" }, t("Unlocked"))} /></View> : null}
      </Section>
      <Section title={t("Review records")} testID="review-records">
        {session.history.reviews.length === 0 ? <Text color="text/secondary">{t("No reviews yet")}</Text> : [...session.history.reviews].reverse().map((record, index) => (
          <View key={`${record.reviewId}-${record.round}-${index}`} testID="review-record" style={{ gap: space[0.5], padding: space[2], borderWidth: 1, borderColor: theme.color("border/hairline"), borderRadius: radius.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[1], flexWrap: "wrap" }}>
              <Badge label={record.decision === "approve" ? t("Approved") : record.decision === "reject" ? t("Rejected and closed") : t("Changes requested")} tone={record.decision === "approve" ? "accent" : "warning"} />
              <Text variant="meta" color="text/secondary">{`${t("Version {n}", { n: version(record.versionId) })} · ${t("Round {n}", { n: record.round })} · ${record.reviewer.kind === "auto" ? t("Automatic policy") : record.reviewer.deviceName === "This device" ? t("This device") : record.reviewer.deviceName ?? ""}`}</Text>
            </View>
            <Text>{record.reviewer.kind === "auto" ? t("Approved automatically — not reviewed") : record.summary === "Approved" ? t("Approved") : record.summary}</Text>
            <Text variant="meta" color="text/secondary">{formatDateTime(record.decided_ms, theme.locale)}</Text>
          </View>
        ))}
      </Section>
    </View>
  );
}

function VersionsTab(props: { onView(versionId: string): void; onCompare(versionId: string): void; onDuplicate(versionId: string): void }) {
  const t = useT(), theme = useTheme(), editor = useScriptEditor(), toast = useToast(), { session } = editor, { document, history } = session;
  const [menu, setMenu] = useState<string | null>(null);
  const [name, setName] = useState<{ versionId: string | null; label: string } | null>(null);
  const [restore, setRestore] = useState<s.ScriptVersion | null>(null);
  const anchors = useState(() => new Map<string, { current: View | null }>())[0];
  const anchor = (id: string) => { let ref = anchors.get(id); if (!ref) { ref = { current: null }; anchors.set(id, ref); } return ref; };
  const versions = [...history.versions].reverse();
  const items = (version: s.ScriptVersion): MenuItem[] => [
    { id: "view", label: t("View"), icon: "eye", onSelect: () => props.onView(version.versionId) },
    { id: "compare", label: t("Compare with current"), icon: "split", onSelect: () => props.onCompare(version.versionId) },
    { id: "restore", label: t("Restore"), icon: "undo", onSelect: () => setRestore(version) },
    { id: "name", label: t("Name"), icon: "pencil", onSelect: () => setName({ versionId: version.versionId, label: version.label ?? "" }) },
    { id: "pin", label: version.pinned ? t("Unpin") : t("Pin"), icon: "pin", onSelect: () => session.setVersion(version.versionId, { pinned: !version.pinned }) },
    { id: "duplicate", label: t("Duplicate as new script"), icon: "copy", onSelect: () => props.onDuplicate(version.versionId) },
  ];
  return (
    <View style={{ gap: space[3] }}>
      <View style={{ alignItems: "flex-start" }}><Button kind="outline" size="sm" icon="plus" label={t("Save version")} testID="version-save" onPress={() => setName({ versionId: null, label: "" })} /></View>
      {history.notice ? <Callout tone="info">{t(history.notice)}</Callout> : null}
      {versions.map((version, index) => {
        const delta = s.versionDelta(versions[index + 1], version), isHead = version.versionId === document.headVersionId;
        return (
          <View key={version.versionId} testID={`version-${version.number}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: space[1], paddingBottom: space[2], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
            <View style={{ flex: 1, minWidth: 0, gap: space[0.5] }}>
              <Text variant="body-medium" numberOfLines={2}>{`${t("Version {n}", { n: version.number })} — ${version.label ?? t(version.summary)}`}</Text>
              <Text variant="meta" color="text/secondary">{`${version.author.kind === "import" ? t("Import") : version.author.deviceName === "This device" ? t("This device") : version.author.deviceName ?? ""} · ${formatDateTime(version.created_ms, theme.locale)}`}</Text>
              {delta ? <Text variant="meta" color="text/secondary" tabular>{delta}</Text> : null}
              <View style={{ flexDirection: "row", gap: space[1], flexWrap: "wrap" }}>
                {isHead ? <Badge label={t("Current")} tone="neutral" /> : null}
                {version.versionId === document.approvedVersionId ? <Badge label={document.status === "locked" ? t("Locked") : t("Approved")} tone="accent" /> : null}
                {history.openReview?.versionId === version.versionId ? <Badge label={t("In review")} tone="attention" /> : null}
                {version.pinned || (s.isPinned(document, history, version) && !isHead) ? <Badge label={t("Pinned")} tone="neutral" /> : null}
              </View>
            </View>
            <IconButton ref={anchor(version.versionId)} icon="more" size="xs" label={t("Actions for version {n}", { n: version.number })} testID={`version-menu-${version.number}`} expanded={menu === version.versionId} onPress={() => setMenu(version.versionId)} />
            <Menu open={menu === version.versionId} anchor={anchor(version.versionId)} items={items(version)} label={t("Version {n}", { n: version.number })} align="end" onClose={() => setMenu(null)} />
          </View>
        );
      })}
      <FormDialog open={!!name} title={name?.versionId ? t("Name this version") : t("Save version")} submitLabel={t("Save")} dirty={!!name?.label} canSubmit={!!name?.label.trim()} onClose={() => setName(null)}
        onSubmit={() => { if (!name) return; try { if (name.versionId) session.setVersion(name.versionId, { label: name.label.trim() }); else session.saveVersion(name.label.trim()); setName(null); } catch (error) { toast.show({ kind: "error", message: messageOf(t, error) }); } }}>
        <FormField label={t("Name")}>{() => <Input value={name?.label ?? ""} maxLength={80} autoFocus testID="version-name" onChangeText={(label) => name && setName({ ...name, label })} />}</FormField>
      </FormDialog>
      <ConfirmDialog open={!!restore} title={restore ? t("Restore version {n}?", { n: restore.number }) : ""} description={t("A new version with this content becomes the current one. Nothing is removed from the history.")} confirmLabel={t("Restore")} onClose={() => setRestore(null)}
        onConfirm={() => { const version = restore; setRestore(null); if (!version) return; try { session.restore(version.versionId); toast.show({ kind: "success", message: t("Version {n} restored", { n: version.number }) }); } catch (error) { toast.show({ kind: "error", message: messageOf(t, error) }); } }} />
    </View>
  );
}

function CommentsTab() {
  const t = useT(), theme = useTheme(), editor = useScriptEditor(), toast = useToast(), { session } = editor, { document } = session;
  const [body, setBody] = useState("");
  const [filter, setFilter] = useState<"open" | "resolved">("open");
  const lineId = editor.selection.lineIds.length === 1 ? editor.selection.lineIds[0] : null;
  const anchor: s.CommentInput["anchor"] = lineId && s.findLine(document, lineId) ? { target: "line", id: lineId } : editor.selection.sceneId && s.findScene(document, editor.selection.sceneId) ? { target: "scene", id: editor.selection.sceneId } : { target: "script", id: document.id };
  const shown = session.history.comments.filter((comment) => (filter === "open" ? !comment.resolved : comment.resolved));
  const where = (comment: s.ScriptHistoryStore["comments"][number]): string => comment.anchor.target === "script" ? t("Whole script") : comment.anchor.target === "scene" ? t("Scene {n}", { n: s.sceneNumber(document, comment.anchor.id) || "?" }) : t("Line");
  return (
    <View style={{ gap: space[3] }}>
      <FormField label={anchor.target === "line" ? t("Comment on the selected line") : anchor.target === "scene" ? t("Comment on the selected scene") : t("Comment on the script")}>{() => <Textarea value={body} maxLength={2000} testID="comment-body" onChangeText={setBody} />}</FormField>
      <View style={{ alignItems: "flex-start" }}><Button kind="strong" size="sm" label={t("Add comment")} testID="comment-add" disabled={!body.trim()} onPress={() => { try { session.addComment(anchor, body); setBody(""); } catch (error) { toast.show({ kind: "error", message: messageOf(t, error) }); } }} /></View>
      <Tabs id="comment-filter" variant="pill" size="xs" label={t("Comments")} value={filter} onChange={(id) => setFilter(id as "open" | "resolved")} items={[{ id: "open", label: t("Open"), count: session.history.comments.filter((comment) => !comment.resolved).length }, { id: "resolved", label: t("Resolved"), count: session.history.comments.filter((comment) => comment.resolved).length }]} />
      {shown.length === 0 ? <Text color="text/secondary" testID="comments-empty">{t("No comments yet")}</Text> : shown.map((comment) => {
        const state = s.commentState(document, comment);
        return (
          <View key={comment.commentId} testID="comment" {...({ dataSet: { state } } as object)} style={{ gap: space[0.5], padding: space[2], borderWidth: 1, borderColor: theme.color("border/hairline"), borderRadius: radius.sm }}>
            <Text variant="meta" color="text/secondary">{`${state === "detached" ? t("Detached") : where(comment)} · ${comment.author.name === "This device" ? t("This device") : comment.author.name} · ${formatDateTime(comment.created_ms, theme.locale)}`}</Text>
            {comment.quote && comment.anchor.target === "line" ? <Text variant="meta" color="text/secondary" numberOfLines={2} style={{ fontStyle: "italic" }}>{`“${comment.quote}”`}</Text> : null}
            {state === "changed" ? <Text variant="meta" color="warning/text">{t("Text changed since this comment")}</Text> : null}
            <Text>{comment.body}</Text>
            <View style={{ flexDirection: "row", gap: space[1] }}>
              {state !== "detached" && comment.anchor.target === "line" ? <Button kind="link" size="sm" label={t("Go to")} testID="comment-goto" onPress={() => editor.goToLine(comment.anchor.id)} /> : null}
              <Button kind="ghost" size="sm" label={comment.resolved ? t("Reopen") : t("Resolve")} testID="comment-resolve" onPress={() => session.updateComment(comment.commentId, { resolved: !comment.resolved })} />
              <Button kind="ghost" size="sm" tone="danger" label={t("Delete")} testID="comment-delete" onPress={() => session.deleteComment(comment.commentId)} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function ActivityTab() {
  const t = useT(), theme = useTheme(), { session } = useScriptEditor();
  const [group, setGroup] = useState<"all" | ReturnType<typeof s.auditGroup>>("all");
  const entries = [...session.history.audit].reverse().filter((entry) => group === "all" || s.auditGroup(entry) === group);
  const version = (id: string | undefined) => session.history.versions.find((entry) => entry.versionId === id)?.number;
  return (
    <View style={{ gap: space[3] }}>
      <Select label={t("Activity")} size="sm" value={group} onChange={(value) => setGroup(value as typeof group)} options={[{ value: "all", label: t("All activity") }, { value: "Reviews", label: t("Reviews") }, { value: "Edits", label: t("Edits") }, { value: "Links", label: t("Links") }]} />
      {entries.length === 0 ? <Text color="text/secondary">{t("No activity yet")}</Text> : entries.map((entry) => {
        const details = (entry.details ?? {}) as { notes?: string; fileName?: string; format?: string; to?: { mode?: string } };
        return (
          <View key={entry.id} testID="activity-entry" {...({ dataSet: { action: entry.action } } as object)} style={{ gap: space[0.5], paddingBottom: space[2], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
            <Text variant="body-medium">{t((LABELS.audit as Record<string, string>)[entry.action] ?? entry.action)}</Text>
            <Text variant="meta" color="text/secondary">{[entry.actor.name === "This device" ? t("This device") : entry.actor.name, version(entry.versionId) ? t("Version {n}", { n: version(entry.versionId)! }) : null, formatDateTime(entry.at_ms, theme.locale)].filter(Boolean).join(" · ")}</Text>
            {details.notes || details.fileName || details.to?.mode ? <Text variant="meta" color="text/secondary" numberOfLines={3}>{details.notes ?? details.fileName ?? t((LABELS.policy as Record<string, string>)[details.to!.mode!] ?? "")}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

/** The right pane: details, the selection, review, versions, comments and activity of the script. */
export function Inspector(props: { width: number | "100%"; tab: InspectorTab; onTab(tab: InspectorTab): void; onView(versionId: string): void; onCompare(versionId: string): void; onDuplicate(versionId: string): void }) {
  const t = useT(), theme = useTheme(), editor = useScriptEditor();
  const open = editor.session.history.comments.filter((comment) => !comment.resolved).length;
  return (
    <View testID="script-inspector" role="complementary" aria-label={t("Inspector")} style={{ width: props.width, borderStartWidth: 1, borderStartColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/app"), minHeight: 0, flex: 1 }}>
      <ScrollView horizontal style={{ flexGrow: 0, borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }} contentContainerStyle={{ paddingHorizontal: space[2] }}>
        <Tabs id="script-inspector" size="sm" label={t("Inspector")} value={props.tab} onChange={(id) => props.onTab(id as InspectorTab)} items={(Object.keys(TAB_LABELS) as InspectorTab[]).map((id) => ({ id, label: t(TAB_LABELS[id]), ...(id === "comments" && open ? { count: open } : {}) }))} />
      </ScrollView>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space[3] }} keyboardShouldPersistTaps="handled">
        {props.tab === "details" ? <Details /> : props.tab === "selection" ? <SelectionTab /> : props.tab === "review" ? <ReviewTab /> : props.tab === "versions" ? <VersionsTab onView={props.onView} onCompare={props.onCompare} onDuplicate={props.onDuplicate} /> : props.tab === "comments" ? <CommentsTab /> : <ActivityTab />}
      </ScrollView>
    </View>
  );
}

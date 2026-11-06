import { useEffect, useRef, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { findModel, formatAmount } from "@jagentchill/app-core";
import { workflow as wf } from "@jagentchill/editor-core";
import { WORKFLOW_CONDITION_OPS, WORKFLOW_LIMITS, type WorkflowDocument, type WorkflowListItem, type WorkflowNode, type WorkflowOp, type WorkflowParameter, type WorkflowPort } from "@jagentchill/protocol";
import { Button, IconButton, Input, NumberField, Segmented, Select, Switch, Text, Textarea, space, useTheme } from "@jagentchill/ui";
import { useAgentData } from "../agents/data";
import { ModelBrowser } from "../agents/ModelBrowser";
import { useT, type T } from "../locale";
import type { ApplyResult } from "./data";
import { ASSIGNEE_LABELS, CONDITION_OP_LABELS, FIELD_TYPE_LABELS, NODE_LABELS, ON_ERROR_LABELS, PARAM_TYPES, PORT_TYPES } from "./strings";

type Apply = (ops: WorkflowOp[], label: string) => ApplyResult;
type Config = Record<string, any>;
const ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/;
const options = <T extends string>(t: T_, table: Record<T, string>) => (Object.keys(table) as T[]).map((value) => ({ value, label: t(table[value]) }));
type T_ = T;

/** A heading of the panel with its controls under it. */
export function Section(props: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <View style={{ gap: space[2], paddingVertical: space[3] }}>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: 24 }}><Text variant="body-medium" level={3} style={{ flex: 1 }}>{props.title}</Text>{props.action}</View>
      {props.children}
    </View>
  );
}
export function Labelled(props: { label: string; children: ReactNode; help?: string }) {
  return (
    <View style={{ gap: space[1] }}>
      <Text variant="meta" color="text/secondary">{props.label}</Text>
      {props.children}
      {props.help ? <Text variant="meta" color="text/tertiary">{props.help}</Text> : null}
    </View>
  );
}

/**
 * A text control of the panel. What is typed is kept here and written 800 ms after the last change, or when the field
 * loses the focus; a value the model refuses is shown with its reason under the field and is not written.
 */
export function TextControl(props: { label: string; value: string; onCommit(text: string): string | undefined | void; multiline?: boolean; max?: number; mono?: boolean; placeholder?: string; disabled?: boolean; testID?: string; minLines?: number; check?(text: string): string | undefined }) {
  const t = useT(), theme = useTheme();
  const [text, setText] = useState(props.value);
  const [error, setError] = useState<string>();
  const state = useRef({ timer: undefined as ReturnType<typeof setTimeout> | undefined, text: props.value, sent: props.value, commit: props.onCommit, check: props.check, max: props.max });
  state.current.commit = props.onCommit;
  state.current.check = props.check;
  // A value changed elsewhere (undo, another device) replaces what the field shows unless it is being edited.
  useEffect(() => { if (props.value !== state.current.sent && !state.current.timer) { state.current.sent = state.current.text = props.value; setText(props.value); setError(undefined); } }, [props.value]);
  const flush = () => {
    const now = state.current;
    if (now.timer) { clearTimeout(now.timer); now.timer = undefined; }
    if (now.text === now.sent) return;
    const problem = (now.max !== undefined && now.text.length > now.max ? t("{label} must be {max} characters or fewer", { label: props.label, max: formatAmount(now.max) }) : undefined) ?? now.check?.(now.text);
    if (problem) return setError(problem);
    const refused = now.commit(now.text);
    if (refused) return setError(refused);
    now.sent = now.text;
    setError(undefined);
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (next: string) => {
    const now = state.current;
    now.text = next;
    setText(next);
    if (now.max !== undefined && next.length > now.max) setError(t("{label} must be {max} characters or fewer", { label: props.label, max: formatAmount(now.max) })); else if (error) setError(undefined);
    if (now.timer) clearTimeout(now.timer);
    now.timer = setTimeout(() => { now.timer = undefined; flush(); }, 800);
  };
  const Field = props.multiline ? Textarea : Input;
  const over = props.max !== undefined && text.length > props.max;
  return (
    <View style={{ gap: space[1] }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{props.label}</Text>
        {props.max !== undefined && props.multiline ? <Text variant="meta" tabular color={over ? "danger/text" : "text/tertiary"} testID={props.testID ? `${props.testID}-counter` : undefined}>{`${text.length.toLocaleString(theme.locale)} / ${props.max.toLocaleString(theme.locale)}`}</Text> : null}
      </View>
      <Field value={text} onChangeText={change} onBlur={flush} accessibilityLabel={props.label} aria-label={props.label} placeholder={props.placeholder} mono={props.mono} disabled={props.disabled} error={error} invalid={!!error} testID={props.testID}
        {...(props.multiline ? { minLines: props.minLines ?? 3, maxLines: 12 } : { size: "sm" as const })} />
    </View>
  );
}

/** A condition as rows of "left operator right" joined by All or Any. */
function ConditionBuilder(props: { label: string; value: unknown; onChange(next: unknown): void; disabled?: boolean; testID?: string }) {
  const t = useT();
  const record = (props.value ?? { all: [] }) as { all?: unknown[]; any?: unknown[] };
  const mode: "all" | "any" = Array.isArray(record.any) ? "any" : "all";
  const leaves = ((record[mode] ?? []) as Array<{ left?: string; op?: string; right?: unknown }>).filter((leaf) => leaf && typeof leaf === "object" && "left" in leaf);
  const write = (next: typeof leaves, as: "all" | "any" = mode) => props.onChange({ [as]: next });
  const parse = (text: string): unknown => (text === "true" ? true : text === "false" ? false : text !== "" && !Number.isNaN(Number(text)) ? Number(text) : text);
  return (
    <View style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{props.label}</Text>
        <Segmented size="xs" label={t("Match")} disabled={props.disabled} value={mode} onChange={(next) => write(leaves, next)} options={[{ value: "all", label: t("All") }, { value: "any", label: t("Any") }]} />
      </View>
      {leaves.map((leaf, index) => (
        <View key={index} style={{ gap: space[1] }}>
          <View style={{ flexDirection: "row", gap: space[1], alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}><TextControl label={t("Value")} mono value={leaf.left ?? ""} placeholder="inputs.value" disabled={props.disabled} testID={props.testID ? `${props.testID}-left-${index}` : undefined} onCommit={(left) => write(leaves.map((entry, at) => (at === index ? { ...entry, left } : entry)))} /></View>
            <View style={{ paddingTop: 18 }}><IconButton icon="x" size="sm" label={t("Remove condition")} disabled={props.disabled} onPress={() => write(leaves.filter((_, at) => at !== index))} /></View>
          </View>
          <Select size="sm" label={t("Operator")} disabled={props.disabled} value={(leaf.op ?? "eq") as (typeof WORKFLOW_CONDITION_OPS)[number]} options={WORKFLOW_CONDITION_OPS.map((value) => ({ value, label: t(CONDITION_OP_LABELS[value]) }))}
            onChange={(op) => write(leaves.map((entry, at) => (at === index ? (op === "exists" || op === "is_empty" ? { left: entry.left, op } : { ...entry, op }) : entry)))} />
          {leaf.op === "exists" || leaf.op === "is_empty" ? null : <TextControl label={t("Compared with")} mono disabled={props.disabled} testID={props.testID ? `${props.testID}-right-${index}` : undefined} value={leaf.right === undefined ? "" : typeof leaf.right === "string" ? leaf.right : JSON.stringify(leaf.right)} onCommit={(right) => write(leaves.map((entry, at) => (at === index ? { ...entry, right: parse(right) } : entry)))} />}
        </View>
      ))}
      <View style={{ alignItems: "flex-start" }}><Button kind="ghost" size="sm" icon="plus" label={t("Add condition")} disabled={props.disabled || leaves.length >= 8} testID={props.testID ? `${props.testID}-add` : undefined} onPress={() => write([...leaves, { left: "inputs.value", op: "eq", right: "" }])} /></View>
    </View>
  );
}

/** The ports a person declares: id, type, and whether a value is required. */
function PortList(props: { ports: WorkflowPort[]; onChange(ports: WorkflowPort[]): string | undefined | void; disabled?: boolean; side: "in" | "out" }) {
  const t = useT();
  const [error, setError] = useState<string>();
  const write = (ports: WorkflowPort[]) => setError(props.onChange(ports) || undefined);
  const add = () => { let index = props.ports.length + 1; while (props.ports.some((port) => port.id === `value_${index}`)) index++; write([...props.ports, { id: `value_${index}`, label: `value_${index}`, type: "any" }]); };
  return (
    <View style={{ gap: space[2] }}>
      {props.ports.map((port, index) => (
        <View key={`${port.id}-${index}`} style={{ flexDirection: "row", gap: space[1], alignItems: "flex-end" }}>
          <View style={{ flex: 1 }}><TextControl label={t("Name")} mono disabled={props.disabled} value={port.id} check={(text) => (ID.test(text) ? undefined : t("Use letters, digits, - and _; start with a letter"))} onCommit={(id) => props.onChange(props.ports.map((entry, at) => (at === index ? { ...entry, id, label: id } : entry))) || undefined} /></View>
          <Select size="sm" width={112} label={t("Type")} disabled={props.disabled} value={port.type as (typeof PORT_TYPES)[number]} options={[...new Set([...PORT_TYPES, port.type])].map((value) => ({ value: value as (typeof PORT_TYPES)[number], label: value }))} onChange={(type) => write(props.ports.map((entry, at) => (at === index ? { ...entry, type } : entry)))} />
          <IconButton icon="x" size="sm" label={t("Remove {name}", { name: port.id })} disabled={props.disabled} onPress={() => write(props.ports.filter((_, at) => at !== index))} />
        </View>
      ))}
      {error ? <Text variant="meta" color="danger/text" role="alert">{error}</Text> : null}
      <View style={{ alignItems: "flex-start" }}><Button kind="ghost" size="sm" icon="plus" label={props.side === "in" ? t("Add input") : t("Add output")} disabled={props.disabled || props.ports.length >= WORKFLOW_LIMITS.ports} testID={`wf-add-${props.side}put`} onPress={add} /></View>
    </View>
  );
}

/** The model an agent step runs on: the role the host routes, or one model chosen here. */
function RuntimeControl(props: { config: Config; onChange(runtime: Config): void; disabled?: boolean }) {
  const t = useT();
  const agents = useAgentData();
  const anchor = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const runtime = (props.config.runtime ?? { mode: "orc", role: "director" }) as Config;
  const ref = runtime.mode === "override" ? { runtimeId: String(runtime.runtime), providerId: String(runtime.provider), modelId: String(runtime.model) } : null;
  const chosen = ref && agents.catalogue ? findModel(agents.catalogue, ref) : undefined;
  return (
    <View style={{ gap: space[2] }}>
      <Segmented size="sm" block label={t("Model")} disabled={props.disabled} value={runtime.mode === "override" ? "override" : "orc"} options={[{ value: "orc", label: t("Use ORC role") }, { value: "override", label: t("Choose a model") }]}
        onChange={(mode) => { if (mode === "orc") props.onChange({ mode: "orc", role: "director" }); else setOpen(true); }} />
      {runtime.mode === "override" ? (
        <View ref={anchor} style={{ alignItems: "flex-start" }}>
          <Button size="sm" icon="bot" trailingIcon="chev-d" label={chosen?.label ?? String(runtime.model)} disabled={props.disabled} testID="wf-agent-model" onPress={() => setOpen(true)} />
        </View>
      ) : (
        <View ref={anchor}>
          <TextControl label={t("Role")} mono disabled={props.disabled} value={String(runtime.role ?? "director")} testID="wf-agent-role" check={(text) => (/^[a-z][a-z0-9-]{1,39}$/.test(text) ? undefined : t("Use lower-case letters, digits and -"))} onCommit={(role) => props.onChange({ mode: "orc", role })} />
        </View>
      )}
      <ModelBrowser open={open} onClose={() => setOpen(false)} anchor={anchor} current={ref} catalogue={agents.catalogue} onSelect={(model) => props.onChange({ mode: "override", runtime: model.ref.runtimeId, provider: model.ref.providerId, model: model.ref.modelId })} />
    </View>
  );
}

/** The fields of a form a person fills during a run. */
function FieldsBuilder(props: { fields: Config[]; onChange(fields: Config[]): void; disabled?: boolean }) {
  const t = useT();
  const { fields } = props;
  const patch = (index: number, change: Config) => props.onChange(fields.map((field, at) => (at === index ? { ...field, ...change } : field)));
  return (
    <View style={{ gap: space[3] }}>
      {fields.map((field, index) => (
        <View key={index} style={{ gap: space[1] }}>
          <View style={{ flexDirection: "row", gap: space[1], alignItems: "flex-end" }}>
            <View style={{ flex: 1 }}><TextControl label={t("Label")} disabled={props.disabled} value={String(field.label ?? "")} max={60} onCommit={(label) => patch(index, { label })} /></View>
            <IconButton icon="x" size="sm" label={t("Remove {name}", { name: String(field.label ?? field.id) })} disabled={props.disabled || fields.length <= 1} onPress={() => props.onChange(fields.filter((_, at) => at !== index))} />
          </View>
          <View style={{ flexDirection: "row", gap: space[2], alignItems: "center" }}>
            <Select size="sm" width={150} label={t("Type")} disabled={props.disabled} value={String(field.type ?? "text") as keyof typeof FIELD_TYPE_LABELS} options={options(t, FIELD_TYPE_LABELS)}
              onChange={(type) => patch(index, type === "select" || type === "multi_select" ? { type, options: field.options ?? ["Option 1", "Option 2"] } : { type, options: undefined })} />
            <Switch label={t("Required")} disabled={props.disabled} value={field.required === true} onChange={(required) => patch(index, { required })} />
          </View>
          {field.type === "select" || field.type === "multi_select" ? <TextControl label={t("Choices, one per line")} multiline minLines={2} disabled={props.disabled} value={((field.options ?? []) as string[]).join("\n")} check={(text) => (text.split("\n").filter((line) => line.trim()).length >= 2 ? undefined : t("Give at least two choices"))} onCommit={(text) => patch(index, { options: text.split("\n").map((line) => line.trim()).filter(Boolean) })} /> : null}
        </View>
      ))}
      <View style={{ alignItems: "flex-start" }}>
        <Button kind="ghost" size="sm" icon="plus" label={t("Add field")} disabled={props.disabled || fields.length >= 20} testID="wf-add-field"
          onPress={() => { let index = fields.length + 1; while (fields.some((field) => field.id === `field_${index}`)) index++; props.onChange([...fields, { id: `field_${index}`, label: `Field ${index}`, type: "text", required: false }]); }} />
      </View>
    </View>
  );
}

/** The type-specific controls of a node. Each writes one `node.update`. */
function ConfigControls(props: { doc: WorkflowDocument; node: WorkflowNode; workflows: WorkflowListItem[]; set(change: Config): string | undefined; disabled?: boolean }) {
  const t = useT();
  const { node, set, disabled } = props;
  const config = node.config as Config;
  switch (node.type) {
    case "agent":
      return (
        <>
          <TextControl label={t("Prompt")} multiline minLines={4} max={WORKFLOW_LIMITS.promptChars} disabled={disabled} value={String(config.promptTemplate ?? "")} testID="wf-agent-prompt" check={(text) => (text.trim() ? undefined : t("Prompt is required"))} onCommit={(promptTemplate) => set({ promptTemplate })} />
          <Text variant="meta" color="text/tertiary">{t("Insert a value with {{inputs.name}}, {{params.name}} or {{vars.name}}.")}</Text>
          <TextControl label={t("Instructions")} multiline minLines={2} max={WORKFLOW_LIMITS.textChars} disabled={disabled} value={String(config.instructions ?? "")} onCommit={(instructions) => set({ instructions })} />
          <RuntimeControl config={config} disabled={disabled} onChange={(runtime) => void set({ runtime })} />
          <NumberField label={t("Turns")} size="sm" min={1} max={20} step={1} disabled={disabled} value={Number(config.maxTurns ?? 4)} onCommit={(maxTurns) => void set({ maxTurns })} />
        </>
      );
    case "approval":
      return (
        <>
          <TextControl label={t("Title")} max={80} disabled={disabled} value={String(config.title ?? "")} testID="wf-approval-title" check={(text) => (text.trim() ? undefined : t("Title is required"))} onCommit={(title) => set({ title })} />
          <TextControl label={t("Instructions")} multiline max={1000} disabled={disabled} value={String(config.instructions ?? "")} onCommit={(instructions) => set({ instructions })} />
          <Labelled label={t("Policy")}><Segmented size="sm" block label={t("Policy")} disabled={disabled} value={config.policy?.mode === "auto" ? "auto" : "human"} options={[{ value: "human", label: t("A person approves") }, { value: "auto", label: t("Approve automatically") }]} onChange={(mode) => void set({ policy: { mode } })} /></Labelled>
          <Labelled label={t("Who can answer")}><Select size="sm" label={t("Who can answer")} disabled={disabled} value={String(config.assignee ?? "any_editor") as keyof typeof ASSIGNEE_LABELS} options={options(t, ASSIGNEE_LABELS)} onChange={(assignee) => void set({ assignee })} /></Labelled>
          <Switch label={t("The reviewer can edit the value")} disabled={disabled} value={config.allowEdit !== false} onChange={(allowEdit) => void set({ allowEdit })} />
        </>
      );
    case "branch": {
      const cases = (config.cases ?? []) as Array<{ id: string; label: string; condition: unknown }>;
      return (
        <>
          <Labelled label={t("Paths taken")}><Segmented size="sm" block label={t("Paths taken")} disabled={disabled} value={config.mode === "all_matches" ? "all_matches" : "first_match"} options={[{ value: "first_match", label: t("First match") }, { value: "all_matches", label: t("Every match") }]} onChange={(mode) => void set({ mode })} /></Labelled>
          {cases.map((entry, index) => (
            <View key={entry.id} style={{ gap: space[2], paddingTop: space[2] }}>
              <View style={{ flexDirection: "row", gap: space[1], alignItems: "flex-end" }}>
                <View style={{ flex: 1 }}><TextControl label={t("Case {n}", { n: index + 1 })} max={24} disabled={disabled} value={entry.label} check={(text) => (text.trim() ? undefined : t("Label is required"))} onCommit={(label) => set({ cases: cases.map((item, at) => (at === index ? { ...item, label } : item)) })} /></View>
                <IconButton icon="x" size="sm" label={t("Remove {name}", { name: entry.label })} disabled={disabled || cases.length <= 1} onPress={() => void set({ cases: cases.filter((_, at) => at !== index) })} />
              </View>
              <ConditionBuilder label={t("When")} disabled={disabled} value={entry.condition} testID={`wf-case-${index}`} onChange={(condition) => void set({ cases: cases.map((item, at) => (at === index ? { ...item, condition } : item)) })} />
            </View>
          ))}
          <View style={{ alignItems: "flex-start" }}>
            <Button kind="ghost" size="sm" icon="plus" label={t("Add case")} disabled={disabled || cases.length >= 8} testID="wf-add-case"
              onPress={() => { let index = cases.length + 1; while (cases.some((entry) => entry.id === `case_${index}`)) index++; void set({ cases: [...cases, { id: `case_${index}`, label: `Case ${index}`, condition: { all: [] } }] }); }} />
          </View>
          <Text variant="meta" color="text/tertiary">{t("Each case is an output of the step; \"else\" is taken when none matches.")}</Text>
        </>
      );
    }
    case "loop":
      return (
        <>
          <NumberField label={t("Most iterations")} size="sm" min={1} max={50} step={1} disabled={disabled} value={Number(config.maxIterations ?? 3)} onCommit={(maxIterations) => void set({ maxIterations })} />
          <ConditionBuilder label={t("Continue while")} disabled={disabled} value={config.continueWhile} testID="wf-loop-while" onChange={(continueWhile) => void set({ continueWhile })} />
          <Text variant="meta" color="text/tertiary">{t("Connect the last step of the body to \"next\"; \"result\" carries the last value out.")}</Text>
        </>
      );
    case "parallel": {
      const joins = props.doc.nodes.filter((entry) => entry.type === "join");
      const policy = typeof config.failurePolicy === "string" ? config.failurePolicy : "fail_fast";
      return (
        <>
          <NumberField label={t("At once")} size="sm" min={1} max={16} step={1} disabled={disabled} value={Number(config.concurrency ?? 4)} onCommit={(concurrency) => void set({ concurrency })} />
          <NumberField label={t("Most items")} size="sm" min={1} max={1000} step={1} disabled={disabled} value={Number(config.maxItems ?? 200)} onCommit={(maxItems) => void set({ maxItems })} />
          <Labelled label={t("When an item fails")}><Segmented size="sm" block label={t("When an item fails")} disabled={disabled} value={policy === "continue" ? "continue" : "fail_fast"} options={[{ value: "fail_fast", label: t("Stop the others") }, { value: "continue", label: t("Keep going") }]} onChange={(failurePolicy) => void set({ failurePolicy })} /></Labelled>
          <Labelled label={t("Joined by")} help={joins.length ? undefined : t("Add a Join step to collect the results.")}><Select size="sm" label={t("Joined by")} placeholder={t("Choose a Join step")} disabled={disabled || !joins.length} value={joins.some((entry) => entry.id === config.joinId) ? String(config.joinId) : null} options={joins.map((entry) => ({ value: entry.id, label: entry.name }))} onChange={(joinId) => void set({ joinId })} /></Labelled>
        </>
      );
    }
    case "join": {
      const parallels = props.doc.nodes.filter((entry) => entry.type === "parallel");
      return <Labelled label={t("Collects the body of")} help={parallels.length ? undefined : t("Add a Parallel step first.")}><Select size="sm" label={t("Collects the body of")} placeholder={t("Choose a Parallel step")} disabled={disabled || !parallels.length} value={parallels.some((entry) => entry.id === config.parallelId) ? String(config.parallelId) : null} options={parallels.map((entry) => ({ value: entry.id, label: entry.name }))} onChange={(parallelId) => void set({ parallelId })} /></Labelled>;
    }
    case "subworkflow": {
      const others = props.workflows.filter((entry) => entry.id !== props.doc.id);
      return <Labelled label={t("Workflow")} help={others.length ? undefined : t("There is no other workflow on this host yet.")}><Select size="sm" label={t("Workflow")} placeholder={t("Choose a workflow")} disabled={disabled || !others.length} value={others.some((entry) => entry.id === config.workflowId) ? String(config.workflowId) : null} options={others.map((entry) => ({ value: entry.id, label: entry.name }))} onChange={(workflowId) => void set({ workflowId })} /></Labelled>;
    }
    case "wait":
      return (
        <>
          <Labelled label={t("Wait")}><Segmented size="sm" block label={t("Wait")} disabled={disabled} value={config.mode === "until" ? "until" : "duration"} options={[{ value: "duration", label: t("For a time") }, { value: "until", label: t("Until a moment") }]} onChange={(mode) => void set(mode === "duration" ? { mode, seconds: 5, until: undefined } : { mode, until: "{{params.until}}", seconds: undefined })} /></Labelled>
          {config.mode === "until" ? <TextControl label={t("Moment (ISO date and time, or a template)")} mono disabled={disabled} value={String(config.until ?? "")} check={(text) => (text.trim() ? undefined : t("A moment is required"))} onCommit={(until) => set({ until })} />
            : <NumberField label={t("Seconds")} size="sm" min={1} max={2_592_000} step={1} disabled={disabled} value={Number(config.seconds ?? 5)} onCommit={(seconds) => void set({ seconds })} />}
        </>
      );
    case "human_input":
      return (
        <>
          <TextControl label={t("Title")} max={80} disabled={disabled} value={String(config.title ?? "")} check={(text) => (text.trim() ? undefined : t("Title is required"))} onCommit={(title) => set({ title })} />
          <TextControl label={t("Instructions")} multiline max={1000} disabled={disabled} value={String(config.instructions ?? "")} onCommit={(instructions) => set({ instructions })} />
          <FieldsBuilder fields={(config.fields ?? []) as Config[]} disabled={disabled} onChange={(fields) => void set({ fields })} />
          <Labelled label={t("Who can answer")}><Select size="sm" label={t("Who can answer")} disabled={disabled} value={String(config.assignee ?? "any_editor") as keyof typeof ASSIGNEE_LABELS} options={options(t, ASSIGNEE_LABELS)} onChange={(assignee) => void set({ assignee })} /></Labelled>
          <TextControl label={t("Button label")} max={24} disabled={disabled} value={String(config.submitLabel ?? "Continue")} check={(text) => (text.trim() ? undefined : t("Label is required"))} onCommit={(submitLabel) => set({ submitLabel })} />
        </>
      );
    case "notify":
      return (
        <>
          <TextControl label={t("Title")} max={80} disabled={disabled} value={String(config.title ?? "")} testID="wf-notify-title" check={(text) => (text.trim() ? undefined : t("Title is required"))} onCommit={(title) => set({ title })} />
          <TextControl label={t("Message")} multiline max={500} disabled={disabled} value={String(config.body ?? "")} testID="wf-notify-body" onCommit={(body) => set({ body })} />
          <Labelled label={t("Sent to")}><Select size="sm" label={t("Sent to")} disabled={disabled} value={String(config.target ?? "run_starter") as "run_starter" | "admins" | "all_paired"} options={[{ value: "run_starter", label: t("The device that started the run") }, { value: "admins", label: t("Admin devices") }, { value: "all_paired", label: t("Every paired device") }]} onChange={(target) => void set({ target })} /></Labelled>
          <Switch label={t("Needs attention")} disabled={disabled} value={config.level === "attention"} onChange={(on) => void set({ level: on ? "attention" : "info" })} />
        </>
      );
    default:
      return null;
  }
}

/** The parameters a run of the workflow is started with: the outputs of its trigger. */
export function ParametersEditor(props: { doc: WorkflowDocument; apply: Apply; disabled?: boolean }) {
  const t = useT();
  const [error, setError] = useState<string>();
  const params = props.doc.parameters;
  const write = (next: WorkflowParameter[]): string | undefined => { const result = props.apply([{ op: "param.set", parameters: next }], "Edit parameters"); const message = result.ok ? undefined : result.message; setError(message); return message; };
  const add = () => { let index = params.length + 1; while (params.some((param) => param.name === `param${index}`)) index++; write([...params, { name: `param${index}`, label: `param${index}`, type: "text", required: false, help: "", secret: false }]); };
  return (
    <View style={{ gap: space[3] }}>
      {params.map((param, index) => (
        <View key={`${param.name}-${index}`} style={{ gap: space[1] }}>
          <View style={{ flexDirection: "row", gap: space[1], alignItems: "flex-end" }}>
            <View style={{ flex: 1 }}><TextControl label={t("Name")} mono disabled={props.disabled} value={param.name} testID={`wf-param-name-${index}`} check={(text) => (/^[a-z][a-zA-Z0-9_]{0,39}$/.test(text) ? undefined : t("Start with a lower-case letter; use letters, digits and _"))} onCommit={(name) => write(params.map((entry, at) => (at === index ? { ...entry, name, label: entry.label === entry.name ? name : entry.label } : entry)))} /></View>
            <Select size="sm" width={104} label={t("Type")} disabled={props.disabled} value={param.type as (typeof PARAM_TYPES)[number]} options={[...new Set([...PARAM_TYPES, param.type])].map((value) => ({ value: value as (typeof PARAM_TYPES)[number], label: value }))} onChange={(type) => void write(params.map((entry, at) => (at === index ? { ...entry, type, default: undefined } : entry)))} />
            <IconButton icon="x" size="sm" label={t("Remove {name}", { name: param.name })} disabled={props.disabled} onPress={() => void write(params.filter((_, at) => at !== index))} />
          </View>
          <TextControl label={t("Label")} max={60} disabled={props.disabled} value={param.label} check={(text) => (text.trim() ? undefined : t("Label is required"))} onCommit={(label) => write(params.map((entry, at) => (at === index ? { ...entry, label } : entry)))} />
          <Switch label={t("Required")} disabled={props.disabled} value={param.required} onChange={(required) => void write(params.map((entry, at) => (at === index ? { ...entry, required } : entry)))} />
        </View>
      ))}
      {error ? <Text variant="meta" color="danger/text" role="alert">{error}</Text> : null}
      <View style={{ alignItems: "flex-start" }}><Button kind="ghost" size="sm" icon="plus" label={t("Add parameter")} disabled={props.disabled || params.length >= WORKFLOW_LIMITS.parameters} testID="wf-add-param" onPress={add} /></View>
    </View>
  );
}

/**
 * The configuration of the selected node: General, Inputs, Configuration and Advanced. Every control writes one
 * `node.update`; a value the model refuses is shown under its control and nothing is written.
 */
export function NodeInspector(props: { doc: WorkflowDocument; node: WorkflowNode; apply: Apply; workflows: WorkflowListItem[]; readOnly?: boolean; onDelete(): void; trigger?: ReactNode }) {
  const t = useT();
  const { node, doc } = props;
  const info = wf.NODE_TYPES[node.type];
  const disabled = props.readOnly;
  // A control that answers late (the model browser) merges into the configuration as it is then, not as it was drawn.
  const latest = useRef(node);
  latest.current = node;
  const update = (patch: Extract<WorkflowOp, { op: "node.update" }>["patch"]): string | undefined => { const result = props.apply([{ op: "node.update", id: node.id, patch }], "Edit step"); return result.ok ? undefined : result.message; };
  const set = (change: Config): string | undefined => {
    const next = Object.fromEntries(Object.entries({ ...latest.current.config, ...change }).filter(([, value]) => value !== undefined));
    const parsed = wf.CONFIG_SCHEMAS[node.type]?.safeParse(next);
    if (parsed && !parsed.success) return parsed.error.issues[0]?.message;
    return update({ config: next });
  };
  const range = wf.TIMEOUT_RANGE[node.type];
  return (
    <ScrollView testID="wf-inspector" contentContainerStyle={{ paddingHorizontal: space[4], paddingBottom: space[5] }}>
      <Section title={t("General")}>
        <TextControl label={t("Name")} max={60} disabled={disabled} value={node.name} testID="wf-node-name" check={(text) => (text.trim() ? undefined : t("Name is required"))} onCommit={(name) => update({ name: name.trim() })} />
        <TextControl label={t("Description")} multiline minLines={2} max={500} disabled={disabled} value={node.description} onCommit={(description) => update({ description })} />
        {node.type === "trigger" ? null : <Switch label={t("Enabled")} disabled={disabled} value={!node.disabled} onChange={(on) => void update({ disabled: !on })} />}
        <Text variant="meta" color="text/tertiary">{`${t(NODE_LABELS[node.type])} · ${node.id}`}</Text>
      </Section>
      {node.type === "trigger" ? (
        <>
          <Section title={t("Parameters")}><ParametersEditor doc={doc} apply={props.apply} disabled={disabled} /></Section>
          {props.trigger}
        </>
      ) : null}
      {info.userInputs ? <Section title={t("Inputs")}><PortList side="in" ports={node.inputs} disabled={disabled} onChange={(inputs) => update({ inputs })} /></Section> : null}
      {node.type === "trigger" ? null : <Section title={t("Configuration")}><ConfigControls doc={doc} node={node} workflows={props.workflows} set={set} disabled={disabled} /></Section>}
      {node.type === "trigger" ? null : (
        <Section title={t("Advanced")}>
          {range ? <NumberField label={t("Time limit (seconds)")} size="sm" min={range[0]} max={range[1]} step={1} disabled={disabled} value={node.timeout_s ?? null} onCommit={(timeout_s) => void update({ timeout_s })} /> : null}
          <Labelled label={t("If the step fails")}><Select size="sm" label={t("If the step fails")} disabled={disabled} value={node.onError} options={options(t, ON_ERROR_LABELS)} onChange={(onError) => void update({ onError })} /></Labelled>
          <Switch label={t("Protected — agent changes need my approval")} disabled={disabled} value={node.protected} onChange={(next) => void update({ protected: next })} />
        </Section>
      )}
      {node.type === "trigger" || disabled ? null : <View style={{ alignItems: "flex-start", paddingTop: space[2] }}><Button kind="ghost" tone="danger" size="sm" icon="trash" label={t("Delete step")} testID="wf-delete-node" onPress={props.onDelete} /></View>}
    </ScrollView>
  );
}

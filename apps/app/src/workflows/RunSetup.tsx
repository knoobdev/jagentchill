import { useEffect, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import type { WorkflowDocument, WorkflowParameter, WorkflowRunRecord } from "@jagentchill/protocol";
import { formatUsd } from "@jagentchill/app-core";
import { Callout, FormDialog, FormField, Input, Select, Switch, Text, Textarea, radius, space, useTheme } from "@jagentchill/ui";
import { useT } from "../locale";
import { failureOf, useWorkflowCalls, type RunMoneyAnswer, type RunMoneyGiven } from "./data";
import { PARAM_PROBLEMS } from "./strings";

const usd = (amount: number): string => formatUsd(amount, { fine: true });
const missingRoute = (answer: RunMoneyAnswer | null): string[] => (answer?.estimate.assumptions ?? []).flatMap((assumption) => {
  const match = /^Cannot run: no model for (.+)$/.exec(assumption);
  return match ? [match[1]] : [];
});

/** The value a run parameter takes from what was typed, or the reason it is refused. */
function paramValue(param: WorkflowParameter, text: string | boolean | undefined): { value?: unknown; error?: string } {
  if (param.type === "boolean") return { value: text === true };
  const raw = typeof text === "string" ? text : "";
  if (!raw.trim()) return param.required && param.default === undefined ? { error: PARAM_PROBLEMS.required } : {};
  if (param.type === "number" || param.type === "integer") { const number = Number(raw); return Number.isFinite(number) && (param.type === "number" || Number.isInteger(number)) ? { value: number } : { error: PARAM_PROBLEMS.number }; }
  if (param.type === "json" || /^list</.test(param.type)) { try { return { value: JSON.parse(raw) }; } catch { return { error: PARAM_PROBLEMS.json }; } }
  return { value: raw };
}

/** What the person's Start sends with the run: the amount they were shown, and the models of unknown price named to them. */
export const moneyGiven = (answer: RunMoneyAnswer | null): RunMoneyGiven | undefined =>
  (answer?.confirmation.needed ? { confirmedUsd: answer.confirmation.amountUsd, ...(answer.confirmation.perItemUsd ? { confirmedPerItemUsd: answer.confirmation.perItemUsd } : {}), ...(answer.confirmation.unpricedModels.length ? { allowUnpriced: answer.confirmation.unpricedModels } : {}) } : undefined);

/**
 * The run's ONE money question, in the words of the video run's: the most the run can spend, step by step, the models
 * whose price is not known by name, and when it would ask again. Rendered only when the host says a person has to be
 * asked — a run that cannot spend shows nothing.
 */
export function RunMoneyQuestion(props: { answer: RunMoneyAnswer }) {
  const t = useT(), theme = useTheme();
  const { estimate, confirmation } = props.answer;
  if (!confirmation.needed) return null;
  const priced = estimate.steps.filter((step) => step.highUsd !== null && step.highUsd > 0);
  // A list whose length only the run will know: its steps are quoted for one item — no number of items is made up.
  const each = confirmation.perItemUsd ?? 0, list = [...new Set(estimate.steps.flatMap((step) => (step.perItem && step.highUsd ? [step.perItem.name] : [])))].join(", ");
  // Ruling R10: an amount worked out from what a request to the model was MEASURED to carry on this host is said with "about" — the total when any of its steps is one, and each such step.
  const about = priced.some((step) => step.measured), stepUsd = (step: (typeof priced)[number]): string => (step.measured ? t("about {cost}", { cost: usd(step.highUsd ?? 0) }) : usd(step.highUsd ?? 0));
  return (
    <View testID="run-money" {...({ dataSet: { amount: String(confirmation.amountUsd), each: String(each), stops: String(confirmation.stopsAtUsd), unpriced: confirmation.unpricedModels.join(","), measured: String(about) } } as object)} style={{ gap: space[1], padding: space[3], borderRadius: radius.md, backgroundColor: theme.color("bg/subtle") }}>
      {each > 0 ? <Text variant="body-medium" testID="run-money-amount">{confirmation.amountUsd > 0 ? t(about ? "This run may spend about {amount}, and about {each} more for each item of “{list}”" : "This run may spend up to {amount}, and {each} more for each item of “{list}”", { amount: usd(confirmation.amountUsd), each: usd(each), list }) : t(about ? "This run may spend about {each} for each item of “{list}”" : "This run may spend up to {each} for each item of “{list}”", { each: usd(each), list })}</Text>
        : confirmation.amountUsd > 0 ? <Text variant="body-medium" testID="run-money-amount">{t(about ? "This run may spend about {amount}" : "This run may spend up to {amount}", { amount: usd(confirmation.amountUsd) })}</Text> : null}
      {each > 0 ? <Text variant="meta" color="text/secondary" testID="run-money-per-item">{t("How many items “{list}” will have is not known before the run, so there is no total yet.", { list })}</Text> : null}
      {priced.map((step) => (
        <Text key={step.nodeId} variant="meta" color="text/secondary" testID="run-money-step">{step.perItem ? t("{step} · {model}: {amount} for each item", { step: step.name, model: step.model, amount: stepUsd(step) }) : step.calls > 1 ? t("{step} · {model} · up to {n} times: {amount}", { step: step.name, model: step.model, n: step.calls, amount: stepUsd(step) }) : t("{step} · {model}: {amount}", { step: step.name, model: step.model, amount: stepUsd(step) })}</Text>
      ))}
      {/* A price that is not known is said plainly, by the model's name: the person's Start is the leave to use it. */}
      {confirmation.unpricedModels.map((model) => <View key={model} testID="run-money-unpriced" {...({ dataSet: { model } } as object)}><Text variant="meta" color="warning/text">{confirmation.amountUsd > 0 ? t("The price of {model} is not known. What it costs is not in the amount above. Starting allows this run to use it.", { model }) : t("The price of {model} is not known, so what this run costs cannot be shown here. Starting allows this run to use it.", { model })}</Text></View>)}
      {each > 0 ? <Text variant="meta" color="text/secondary">{t("You are asked once. After you confirm, the run goes to the end without another money question, however many items there are; it stops and asks again only if it would cost more than what is shown here.")}</Text>
        : confirmation.amountUsd > 0 ? <Text variant="meta" color="text/secondary">{t("You are asked once. After you confirm, the run goes to the end without another money question; it stops and asks again only if it would pass {amount}.", { amount: usd(confirmation.stopsAtUsd) })}</Text> : null}
    </View>
  );
}
/**
 * The one quiet line for steps on the person's own signed-in account (Claude Code, Codex): this app does not bill
 * them, so they are no part of a money question — the line only says so, and only where a start form is open anyway.
 */
export function OwnAccountLine(props: { answer: RunMoneyAnswer }) {
  const t = useT();
  const by = new Map<string, string[]>();
  for (const entry of props.answer.estimate.ownAccount ?? []) { const account = entry.account ?? entry.model; by.set(account, [...new Set([...(by.get(account) ?? []), entry.label])]); }
  if (!by.size) return null;
  return <View testID="run-own-account">{[...by].map(([account, steps]) => <Text key={account} variant="meta" color="text/secondary">{t("Runs on your own {account} account, not billed by this app: {steps}", { account, steps: steps.join(", ") })}</Text>)}</View>;
}
/** The label of the button that starts the run: with the amount when the person is asked about one. */
export function startLabel(t: ReturnType<typeof useT>, answer: RunMoneyAnswer | null): string {
  if (!answer?.confirmation.needed) return t("Run");
  const each = answer.confirmation.perItemUsd ?? 0;
  if (each > 0) return answer.confirmation.amountUsd > 0 ? t("Confirm {amount} + {each} per item and start", { amount: usd(answer.confirmation.amountUsd), each: usd(each) }) : t("Confirm {each} per item and start", { each: usd(each) });
  return answer.confirmation.amountUsd > 0 ? t("Confirm {amount} and start", { amount: usd(answer.confirmation.amountUsd) }) : t("Confirm and start");
}

/**
 * The form a run is started from: one control per parameter of the workflow, and — when the run can spend — its one
 * money question, asked for the values as they are typed. `fixed`: the parameters are given (a run started again):
 * no fields, only the question.
 */
export function RunSetup(props: { open: boolean; doc: Pick<WorkflowDocument, "id" | "name" | "parameters"> | null; fixed?: Record<string, unknown>; onClose(): void; onRun(params: Record<string, unknown>, money?: RunMoneyGiven): void; busy?: boolean }) {
  const t = useT(), calls = useWorkflowCalls();
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [submitted, setSubmitted] = useState(0);
  const [answer, setAnswer] = useState<RunMoneyAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { if (props.open) { setValues({}); setSubmitted(0); setAnswer(null); setProblem(null); } }, [props.open]);
  const params = props.fixed ? [] : props.doc?.parameters ?? [];
  const parsed = params.map((param) => ({ param, ...paramValue(param, values[param.name]) }));
  const valid = parsed.every((entry) => !entry.error);
  const given = props.fixed ?? Object.fromEntries(parsed.filter((entry) => entry.value !== undefined).map((entry) => [entry.param.name, entry.value]));
  const key = JSON.stringify(given), workflowId = props.doc?.id;
  // The estimate of the run as it would start now: asked again when a value changes (the amount depends on what is sent).
  const asked = useRef(0);
  useEffect(() => {
    if (!props.open || !workflowId || !valid) { setAnswer(null); return; }
    const mine = ++asked.current;
    setAsking(true);
    const timer = setTimeout(() => {
      calls.estimate(workflowId, JSON.parse(key) as Record<string, unknown>).then(
        (made) => { if (asked.current === mine) { setAnswer(made); setProblem(null); setAsking(false); } },
        (error) => { if (asked.current === mine) { setAnswer(null); setProblem(failureOf(error).message); setAsking(false); } },
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [props.open, workflowId, valid, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const unrouted = missingRoute(answer);
  return (
    <FormDialog open={props.open} title={t("Run {name}", { name: props.doc?.name ?? "" })} submitLabel={startLabel(t, answer)} dirty={Object.keys(values).length > 0} canSubmit={valid && !asking && !!answer && unrouted.length === 0} busy={props.busy} onClose={props.onClose}
      onSubmit={() => { setSubmitted((count) => count + 1); if (valid && answer && !asking && unrouted.length === 0) props.onRun(given, moneyGiven(answer)); }}>
      <View testID="run-setup" style={{ gap: space[3] }}>
        {params.length === 0 && !answer?.confirmation.needed && unrouted.length === 0 ? <Text color="text/secondary">{t("This workflow takes no parameters.")}</Text> : null}
        {parsed.map(({ param, error }) => (
          <FormField key={param.name} label={param.label} required={param.required} description={param.help || undefined} error={error && (submitted > 0 || values[param.name] !== undefined) ? t(error) : undefined}>
            {() => param.type === "boolean" ? <Switch accessibilityLabel={param.label} value={values[param.name] === true} onChange={(on) => setValues({ ...values, [param.name]: on })} />
              : param.enum ? <Select label={param.label} value={typeof values[param.name] === "string" ? String(values[param.name]) : null} placeholder={t("Choose")} options={param.enum.map((value) => ({ value: String(value), label: String(value) }))} onChange={(value) => setValues({ ...values, [param.name]: value })} />
              : param.type === "text" || param.type === "json" || param.multiline ? <Textarea testID={`run-param-${param.name}`} value={typeof values[param.name] === "string" ? String(values[param.name]) : ""} onChangeText={(text) => setValues({ ...values, [param.name]: text })} mono={param.type === "json"} minLines={3} />
              : <Input testID={`run-param-${param.name}`} value={typeof values[param.name] === "string" ? String(values[param.name]) : ""} onChangeText={(text) => setValues({ ...values, [param.name]: text })} />}
          </FormField>
        ))}
        {unrouted.map((role) => <Callout key={role} tone="danger"><Text testID={`run-cannot-run-${role}`}>{t("Cannot run: no model for {role}", { role })}</Text></Callout>)}
        {answer ? <RunMoneyQuestion answer={answer} /> : null}
        {answer ? <OwnAccountLine answer={answer} /> : null}
        {problem ? <Text variant="meta" color="danger/text" testID="run-money-problem">{problem}</Text> : null}
      </View>
    </FormDialog>
  );
}

/**
 * Starting a run from a button: a workflow that takes no parameters and asks nothing about money starts at once, with
 * no dialog; every other one opens the form (its parameters, and the money question when there is one).
 */
export function useRunStarter(input: { onStarted(run: WorkflowRunRecord): void; onError(error: unknown): void }): { begin(doc: Pick<WorkflowDocument, "id" | "name" | "parameters">, fixed?: Record<string, unknown>): Promise<void>; busy: boolean; dialog: ReactNode } {
  const calls = useWorkflowCalls();
  const [setup, setSetup] = useState<{ doc: Pick<WorkflowDocument, "id" | "name" | "parameters">; fixed?: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  const start = async (workflowId: string, params: Record<string, unknown>, money?: RunMoneyGiven) => {
    setBusy(true);
    try { const made = await calls.run(workflowId, params, money); setSetup(null); input.onStarted(made.run); } catch (error) { input.onError(error); } finally { setBusy(false); }
  };
  const begin = async (doc: Pick<WorkflowDocument, "id" | "name" | "parameters">, fixed?: Record<string, unknown>) => {
    if (busy) return;
    if (!fixed && doc.parameters.length) return void setSetup({ doc });
    setBusy(true);
    let setupNeeded = false;
    try { const estimate = await calls.estimate(doc.id, fixed ?? {}); setupNeeded = estimate.confirmation.needed || missingRoute(estimate).length > 0; } catch (error) { setBusy(false); return void input.onError(error); }
    setBusy(false);
    if (setupNeeded) setSetup({ doc, fixed: fixed ?? {} }); else await start(doc.id, fixed ?? {});
  };
  const dialog = <RunSetup open={!!setup} doc={setup?.doc ?? null} {...(setup?.fixed ? { fixed: setup.fixed } : {})} busy={busy} onClose={() => setSetup(null)} onRun={(params, money) => { if (setup) void start(setup.doc.id, params, money); }} />;
  return { begin, busy, dialog };
}

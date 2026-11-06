import { useState } from "react";
import { View } from "react-native";
import { RUN_STEPS, formatTimeOfDay, activityFeed, agentApproval, assignmentPill, handoffPill, handoffScopeLabel, runCounters, runPill, runStep } from "@jagentchill/app-core";
import type { AgentHandback, AgentHandoff, TeamAssignment, TeamRun } from "@jagentchill/protocol";
import { Badge, Button, Card, ConfirmDialog, Disclosure, Icon, Select, inlineIcon, StatusPill, Tap, Text, Textarea, radius, space, useTheme } from "@jagentchill/ui";
import { useT } from "../../locale";
import { ArtefactChips } from "./Artefacts";
import { EscalationNote, HandbackCard, ReviewRounds } from "./Cards";
import { DissentCard, DissentList, ProposalReviews } from "./Dissent";
import { Focusable } from "./focus";
import type { TeamRunsApi } from "./run";

/** The words of the run panel the screens translate from data (stage, route, status and hand-off labels). */
const RUN_WORDS = {
  steps: ["Director", "Lead", "Assignments", "Acceptance", "Relay"],
  pills: ["Working", "Handed back", "Accepted", "Failed", "Cancelled", "Needs approval", "Completed", "Queued", "Rejected", "Expired"], scopes: ["Task", "Lead", "Conversation"],
};
void RUN_WORDS;
/** The route categories of a brief, as the brief card names them. */
const ROUTE_LABELS = { planning: "Planning", script: "Script", edit: "Edit", search: "Search", research: "Research", audit: "Review", ui: "Visual design" };
const clock = (ts_ms: number) => formatTimeOfDay(ts_ms);

function Labelled(props: { label: string; children: string | string[]; testID?: string }) {
  const lines = Array.isArray(props.children) ? props.children : [props.children];
  if (!lines.length || !lines[0]) return null;
  return (
    <View style={{ gap: space[0.5] }} testID={props.testID}>
      <Text variant="meta" color="text/secondary">{props.label}</Text>
      {lines.map((line, index) => <Text key={index} selectable>{lines.length > 1 ? `• ${line}` : line}</Text>)}
    </View>
  );
}

/** Director → Lead → Assignments → Acceptance → Relay, with the steps behind the run ticked and the current one marked. */
function Stepper(props: { run: TeamRun }) {
  const t = useT();
  const theme = useTheme();
  const at = runStep(props.run);
  return (
    <View testID="run-stepper" {...({ dataSet: { stage: props.run.stage ?? "", status: props.run.status } } as object)} style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[1] }}>
      {RUN_STEPS.map((step, index) => {
        const current = index === at.current, done = index < at.done || (at.current === -1 && index < at.done);
        return (
          <View key={step.id} style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
            {index ? <Icon name={inlineIcon(theme.rtl, "chev-r")} size={12} color="text/tertiary" /> : null}
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[1], paddingHorizontal: space[2], height: 24, borderRadius: radius.full, borderWidth: 1, borderColor: theme.color(current ? "accent" : "border/hairline"), backgroundColor: current ? theme.color("accent/subtle") : "transparent" }}>
              {done && !current ? <Icon name="check" size={12} color="success" /> : null}
              <Text variant="meta" color={current ? "accent/text" : done ? "text/primary" : "text/tertiary"}>{t(step.label)}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function AssignmentRow(props: { assignment: TeamAssignment; handback?: AgentHandback; mayAct: boolean; api: Pick<TeamRunsApi, "resolveHandback"> }) {
  const t = useT();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const { assignment } = props, pill = assignmentPill(assignment.status);
  return (
    <View testID={`run-assignment-${assignment.id}`} {...({ dataSet: { status: assignment.status, role: assignment.roleId } } as object)}>
      <Tap role="button" label={`${assignment.roleLabel} — ${assignment.title}`} expanded={open} onPress={() => setOpen(!open)}
        style={(interaction) => ({ minHeight: theme.compact ? 44 : 32, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[1], borderRadius: radius.sm, backgroundColor: interaction.hovered ? theme.color("bg/hover") : "transparent" })}>
        <Icon name={open ? "chev-d" : inlineIcon(theme.rtl, "chev-r")} size={12} color="text/tertiary" />
        <Text variant="body-medium" numberOfLines={1} style={{ flexShrink: 0 }}>{assignment.roleLabel}</Text>
        <Text color="text/secondary" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>{assignment.title}</Text>
        {assignment.grantsWrite ? <Badge label={t("Writer")} tone="accent" /> : null}
        <StatusPill label={t(pill.label)} status={pill.status} />
      </Tap>
      {open ? (
        <View style={{ gap: space[2], marginLeft: space[4], paddingLeft: space[3], paddingVertical: space[2], borderLeftWidth: 2, borderLeftColor: theme.color("border/hairline") }}>
          <Labelled label={t("Assignment")}>{assignment.assignment}</Labelled>
          <Labelled label={t("Ownership boundary")}>{assignment.ownershipBoundary}</Labelled>
          <Labelled label={t("Expected hand-back")}>{assignment.expectedHandback}</Labelled>
          {props.handback ? <HandbackCard handback={props.handback} mayAct={props.mayAct} api={props.api} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The result of a run waiting for the person: what the team says it did, on what evidence, and what is still
 * uncertain, with the acceptance criteria of the brief beside it. Laid out like the chat's approval card.
 */
export function SignoffCard(props: { run: TeamRun; mayAct: boolean; api: Pick<TeamRunsApi, "signoff"> }) {
  const t = useT();
  const { run } = props, result = run.candidate;
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState<"request_changes" | "reject" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!result) return null;
  const decide = async (decision: "approve" | "request_changes" | "reject") => {
    setBusy(decision);
    if (await props.api.signoff(run.id, decision, note.trim() || undefined)) { setNote(""); setAsking(null); }
    setBusy(null);
  };
  return (
    <Focusable kind="agent.approval_required" id={run.id}>
    <Card padding={space[3]}>
      <View testID="run-signoff" style={{ gap: space[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Icon name="shield" size={16} color="accent" />
          <Text variant="title-sm" style={{ flex: 1 }}>{t("Result of {team}", { team: run.teamName })}</Text>
          <StatusPill label={t("Waiting for your approval")} tone="warning" />
        </View>
        <Labelled label={t("Summary")} testID="run-signoff-summary">{result.summary}</Labelled>
        <Labelled label={t("Evidence")}>{result.evidence}</Labelled>
        <Labelled label={t("Remaining uncertainty")}>{result.remainingUncertainty}</Labelled>
        <Labelled label={t("Acceptance")}>{run.brief.acceptanceCriteria}</Labelled>
        <ArtefactChips artefacts={result.artefacts} />
        {run.approval?.escalated ? <EscalationNote approval={run.approval} /> : null}
        {run.approval ? <ReviewRounds approval={run.approval} /> : null}
        {props.mayAct ? (
          <>
            {asking ? <Textarea value={note} onChangeText={setNote} minLines={2} maxLines={5} maxLength={4000} placeholder={asking === "reject" ? t("Why is it rejected? (optional)") : t("What should change?")} accessibilityLabel={t("What should change?")} testID="run-signoff-note" /> : null}
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
              {asking ? (
                <>
                  <Button kind="primary" size="sm" label={asking === "reject" ? t("Reject") : t("Send request")} testID="run-signoff-send" loading={busy === asking} disabled={busy !== null || (asking === "request_changes" && !note.trim())} onPress={() => void decide(asking)} />
                  <Button kind="ghost" size="sm" label={t("Back")} disabled={busy !== null} onPress={() => { setAsking(null); setNote(""); }} />
                </>
              ) : (
                <>
                  <Button kind="primary" size="sm" label={t("Approve")} testID="run-signoff-approve" loading={busy === "approve"} disabled={busy !== null} onPress={() => void decide("approve")} />
                  <Button size="sm" label={t("Request changes")} testID="run-signoff-changes" disabled={busy !== null} onPress={() => setAsking("request_changes")} />
                  <Button kind="ghost" size="sm" label={t("Reject")} testID="run-signoff-reject" disabled={busy !== null} onPress={() => setAsking("reject")} />
                </>
              )}
            </View>
          </>
        ) : null}
      </View>
    </Card>
    </Focusable>
  );
}

/** One hand-off: who offers what to whom, the package, its state, and the person's actions while it is pending. */
export function HandoffCard(props: { handoff: AgentHandoff; mayAct: boolean; api: Pick<TeamRunsApi, "resolveHandoff"> }) {
  const t = useT(), { rtl } = useTheme();
  const { handoff } = props, pill = handoffPill(handoff);
  const [history, setHistory] = useState(false);
  const [questions, setQuestions] = useState(false);
  const [busy, setBusy] = useState(false);
  const decide = async (decision: "accept" | "reject" | "cancel") => { setBusy(true); await props.api.resolveHandoff(handoff.id, decision, decision === "reject" ? t("Rejected by a person") : undefined); setBusy(false); };
  return (
    <Focusable kind="agent.handoff_pending" id={handoff.id}>
    <Card padding={space[3]}>
      <View testID={`handoff-${handoff.id}`} aria-label={t("Hand-off from {from} to {to}, {status}", { from: handoff.fromTitle, to: handoff.toTitle, status: t(pill.label) })} {...({ dataSet: { status: handoff.status, scope: handoff.scope } } as object)} style={{ gap: space[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Icon name={inlineIcon(rtl, "arrow-r")} size={14} color="text/secondary" />
          <Text variant="body-medium" style={{ flex: 1 }} numberOfLines={1}>{t("Hand-off · {scope}", { scope: t(handoffScopeLabel(handoff.scope)) })}</Text>
          <StatusPill label={t(pill.label)} status={pill.status} />
        </View>
        <Text variant="meta" color="text/secondary">{`${handoff.fromTitle} → ${handoff.toTitle} · ${clock(handoff.created_ms)}`}</Text>
        {handoff.raisesPermission && handoff.status === "pending" ? <Text testID="handoff-permission-ask">{t("{to} may do more in this project than {from}. That is why you decide whether it takes this work over.", { from: handoff.fromTitle, to: handoff.toTitle })}</Text> : null}
        {handoff.scope === "conversation" && handoff.status === "pending" ? <Text testID="handoff-conversation-ask">{t("{from} asks to let {to} answer you in this conversation from here on. You decide.", { from: handoff.fromTitle, to: handoff.toTitle })}</Text> : null}
        <Text selectable numberOfLines={6}>{handoff.package.brief}</Text>
        <Disclosure title={t("History")} open={history} onToggle={setHistory}><Text selectable>{handoff.package.historySummary}</Text></Disclosure>
        {handoff.package.openQuestions.length ? (
          <Disclosure title={t("Open questions ({count})", { count: handoff.package.openQuestions.length })} open={questions} onToggle={setQuestions}>
            <View style={{ gap: space[0.5] }}>{handoff.package.openQuestions.map((line, index) => <Text key={index} selectable>{`• ${line}`}</Text>)}</View>
          </Disclosure>
        ) : null}
        {handoff.note ? <Text variant="meta" color="text/secondary" selectable>{handoff.note}</Text> : null}
        {handoff.status === "pending" && handoff.decision === "human" && !props.mayAct ? <Text variant="meta" color="text/secondary" testID="handoff-readonly">{t("This device cannot approve")}</Text> : null}
        {handoff.status === "pending" && props.mayAct ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
            <Button kind="primary" size="sm" label={t("Accept for {receiver}", { receiver: handoff.toTitle })} testID={`handoff-accept-${handoff.id}`} disabled={busy} onPress={() => void decide("accept")} />
            <Button size="sm" label={t("Reject")} testID={`handoff-reject-${handoff.id}`} disabled={busy} onPress={() => void decide("reject")} />
            <Button kind="ghost" size="sm" label={t("Cancel hand-off")} testID={`handoff-cancel-${handoff.id}`} disabled={busy} onPress={() => void decide("cancel")} />
          </View>
        ) : null}
      </View>
    </Card>
    </Focusable>
  );
}

/**
 * The Team view of a session that has a team: the request box, and for the chosen run its header (status, steps,
 * counters, cancel), the brief, the lead's plan with the assignments, the result with its approval record, and the
 * event log.
 */
export function TeamRunPanel(props: { teamName: string; mayAct: boolean; api: TeamRunsApi; working: number; /** The cards that wait for the person (sign-off, an escalated disagreement) are drawn by the caller under its "Needs you" heading: they are not drawn a second time here. */ cardsAbove?: boolean }) {
  const t = useT();
  const theme = useTheme();
  const { runs } = props.api;
  const [request, setRequest] = useState("");
  const [starting, setStarting] = useState(false);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [plan, setPlan] = useState(true);
  const [log, setLog] = useState(false);
  const run = runs.find((entry) => entry.id === chosenId) ?? runs[0];
  const live = runs.find((entry) => entry.status === "running" || entry.status === "waiting_human" || entry.status === "briefing" || entry.status === "paused");
  const start = async () => {
    const text = request.trim();
    if (!text || starting) return;
    setStarting(true);
    if (await props.api.start(text)) { setRequest(""); setChosenId(null); }
    setStarting(false);
  };
  const pill = run ? runPill(run) : null, counters = run ? runCounters(run) : null, result = run?.acceptedResult, approval = run?.approval;
  const lastRound = approval?.rounds.at(-1), byAgent = agentApproval(approval);
  return (
    <View testID="team-run-panel" style={{ gap: space[3] }}>
      {props.mayAct && !live ? (
        <View style={{ gap: space[1] }}>
          <Textarea value={request} onChangeText={setRequest} minLines={2} maxLines={8} maxLength={32_000} placeholder={t("What do you want the team to do?")} accessibilityLabel={t("What do you want the team to do?")} testID="run-request"
            onKey={(key) => { if (key.key === "Enter" && !key.shift && !key.alt && !key.ctrl && !key.meta) { key.preventDefault(); void start(); } }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{t("Enter to send · Shift+Enter for a new line")}</Text>
            <Button kind="primary" size="sm" label={t("Start the team")} testID="run-start" loading={starting} disabled={!request.trim()} onPress={() => void start()} />
          </View>
        </View>
      ) : null}
      {run && pill && counters ? (
        <>
          <View testID="run-header" {...({ dataSet: { run: run.id, status: run.status } } as object)} style={{ gap: space[2] }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
              <Text variant="body-medium" numberOfLines={1} style={{ flexShrink: 1 }}>{run.teamName}</Text>
              <StatusPill label={t(pill.label)} status={pill.status} />
              <View style={{ flex: 1 }} />
              {runs.length > 1 ? <Select label={t("Run")} width={theme.compact ? 180 : 240} value={run.id} options={runs.map((entry) => ({ value: entry.id, label: `${clock(entry.created_ms)} · ${entry.brief.objective.slice(0, 40)}` }))} onChange={setChosenId} /> : null}
              {props.mayAct && run === live ? <Button size="sm" icon="stop" label={t("Cancel run")} testID="run-cancel" onPress={() => setConfirming(true)} /> : null}
            </View>
            <Stepper run={run} />
            <Text variant="meta" color="text/secondary" testID="run-counters">{[t("Peers {count}", { count: counters.peers }), t("Assignments {count}", { count: counters.assignments }), run.endReason && run.status !== "completed" ? run.endReason : ""].filter(Boolean).join(" · ")}</Text>
          </View>
          {run.status === "paused" ? (
            <Card padding={space[3]}>
              <View testID="run-paused" style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
                <Text style={{ flex: 1, minWidth: 180 }}>{t("The host restarted. Resume the team run?")}</Text>
                {props.mayAct ? <Button kind="primary" size="sm" label={t("Resume")} testID="run-resume" onPress={() => void props.api.resume(run.id)} /> : null}
              </View>
            </Card>
          ) : null}
          {!props.cardsAbove && run.status === "waiting_human" && run.waitingReason !== "dissent" ? <SignoffCard run={run} mayAct={props.mayAct} api={props.api} /> : null}
          {props.cardsAbove ? null : (run.dissents ?? []).filter((dissent) => dissent.status === "open" && dissent.outcome === "ESCALATED_TO_HUMAN").map((dissent) => <DissentCard key={dissent.id} run={run} dissent={dissent} mayAct={props.mayAct} api={props.api} />)}
          <ProposalReviews reviews={props.api.proposalReviews.filter((review) => review.runId === run.id)} />
          {run.approval?.status === "reviewing" ? (
            <Card padding={space[3]}>
              <View testID="run-reviewing" style={{ gap: space[2] }}>
                <Text>{t("{reviewer} is checking the result against the brief. Nobody needs to do anything: the result is approved when it passes, and comes to you when the reviewer cannot pass it.", { reviewer: run.approval.reviewerTitle ?? t("A reviewer agent") })}</Text>
                <ReviewRounds approval={run.approval} />
              </View>
            </Card>
          ) : run.approval?.status === "changes_requested" && run.approval.reviews?.length ? (
            <Card padding={space[3]}>
              <View testID="run-review-changes" style={{ gap: space[2] }}>
                <Text>{t("The reviewer asked for changes. The team is revising the result.")}</Text>
                <ReviewRounds approval={run.approval} />
              </View>
            </Card>
          ) : null}
          <Card padding={space[3]}>
            <View testID="run-brief" style={{ gap: space[2] }}>
              <Text variant="title-sm">{t("Brief")}</Text>
              <Labelled label={t("Objective")} testID="run-brief-objective">{run.brief.objective}</Labelled>
              <Labelled label={t("Route")}>{t(ROUTE_LABELS[run.brief.routeCategory])}</Labelled>
              <Labelled label={t("Constraints")}>{run.brief.constraints}</Labelled>
              <Labelled label={t("Deliverables")}>{run.brief.deliverables}</Labelled>
              <Labelled label={t("Acceptance")}>{run.brief.acceptanceCriteria}</Labelled>
              <Labelled label={t("Validation")}>{run.brief.validationPlan}</Labelled>
              <Text variant="meta" color="text/tertiary">{t("Prepared without a model")}</Text>
            </View>
          </Card>
          {run.assignments.length ? (
            <View testID="run-plan">
              <Disclosure title={run.assignments.length === 1 ? t("Lead plan · 1 bounded assignment") : t("Lead plan · {count} bounded assignments", { count: run.assignments.length })} open={plan} onToggle={setPlan}>
                <View>{run.assignments.map((assignment) => <AssignmentRow key={assignment.id} assignment={assignment} handback={props.api.handbacks.find((entry) => entry.handbackId === assignment.handbackId)} mayAct={props.mayAct} api={props.api} />)}</View>
                <DissentList run={run} />
              </Disclosure>
            </View>
          ) : null}
          {result ? (
            <Card padding={space[3]}>
              <View testID="run-result" style={{ gap: space[2] }}>
                <Text variant="title-sm">{t("Result")}</Text>
                <Labelled label={t("Summary")}>{result.summary}</Labelled>
                <Labelled label={t("Evidence")}>{result.evidence}</Labelled>
                <Labelled label={t("Remaining uncertainty")}>{result.remainingUncertainty}</Labelled>
                <ArtefactChips artefacts={result.artefacts} />
                {lastRound ? <Text variant="meta" color="text/secondary" testID="run-approval">{byAgent ? t("Approved by {reviewer} (agent) · {total}/100 · round {round}", byAgent) : lastRound.decidedBy.kind === "policy" ? t("Auto-approved by policy") : t("Approved by a person at {time}", { time: clock(lastRound.ts_ms) })}{approval?.raisedByHostMinimum ? ` · ${approval.mode === "agent" ? t("The host requires a review") : t("The host requires a person's sign-off")}` : ""}</Text> : null}
                {approval ? <ReviewRounds approval={approval} /> : null}
              </View>
            </Card>
          ) : null}
          <View testID="run-events">
            <Disclosure title={t("Event log")} open={log} onToggle={setLog} summary={<Text variant="meta" color="text/secondary">{run.events.length}</Text>}>
              <View style={{ gap: space[1] }}>
                {[...run.events].reverse().map((event, index) => (
                  <View key={index} style={{ flexDirection: "row", gap: space[2] }}>
                    <Text variant="meta" color="text/tertiary" tabular style={{ width: 64 }}>{clock(event.ts_ms)}</Text>
                    <Text variant="meta" style={{ flex: 1 }} selectable>{event.text}</Text>
                  </View>
                ))}
              </View>
            </Disclosure>
          </View>
        </>
      ) : <Text color="text/secondary" testID="run-empty">{t("{team} has not been given a request in this session yet.", { team: props.teamName })}</Text>}
      <ConfirmDialog open={confirming} title={t("Stop the team? {count} agents are still working. Work that was handed back is kept.", { count: props.working })} confirmLabel={t("Stop the team")}
        onConfirm={() => { setConfirming(false); if (live) void props.api.cancel(live.id); }} onClose={() => setConfirming(false)} />
    </View>
  );
}

/** The activity log of a session's agents: what its team runs recorded and what became of its hand-offs, newest first, with the hand-offs as cards. */
export function ActivityLog(props: { api: TeamRunsApi; mayAct: boolean }) {
  const t = useT();
  const { runs, handoffs, handbacks } = props.api;
  const feed = activityFeed(runs, handoffs);
  return (
    <View testID="agents-activity" style={{ gap: space[3] }}>
      {handoffs.length ? (
        <View style={{ gap: space[2] }}>
          <Text variant="body-medium">{t("Hand-offs")}</Text>
          {handoffs.map((handoff) => <HandoffCard key={handoff.id} handoff={handoff} mayAct={props.mayAct} api={props.api} />)}
        </View>
      ) : null}
      {props.api.proposalReviews.length ? (
        <View testID="agents-proposal-reviews" style={{ gap: space[2] }}>
          <Text variant="body-medium">{t("Proposals checked by a reviewer agent")}</Text>
          <ProposalReviews reviews={props.api.proposalReviews} />
        </View>
      ) : null}
      {handbacks.length ? (
        <View testID="agents-handbacks" style={{ gap: space[2] }}>
          <Text variant="body-medium">{t("Hand-backs")}</Text>
          {handbacks.map((handback) => <HandbackCard key={handback.handbackId} handback={handback} mayAct={props.mayAct} api={props.api} />)}
        </View>
      ) : null}
      <View style={{ gap: space[1] }}>
        <Text variant="body-medium">{t("Activity log")}</Text>
        {feed.length === 0 ? <Text color="text/secondary" testID="agents-activity-empty">{t("Nothing has been recorded yet. Team runs and hand-offs between agents appear here.")}</Text> : null}
        {feed.map((entry) => (
          <View key={entry.id} testID="activity-entry" {...({ dataSet: { kind: entry.kind } } as object)} style={{ flexDirection: "row", gap: space[2], minHeight: 24, alignItems: "center" }}>
            <Text variant="meta" color="text/tertiary" tabular style={{ width: 64 }}>{clock(entry.ts_ms)}</Text>
            <Text style={{ flex: 1 }} selectable>{entry.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

import { useState } from "react";
import { View } from "react-native";
import { dissentOutcome, proposalEscalationReason } from "@jagentchill/app-core";
import type { ProposalReview, TeamDissent, TeamRun, TeamRunApproval } from "@jagentchill/protocol";
import { Button, Card, StatusPill, Text, Textarea, space, useTheme } from "@jagentchill/ui";
import { Focusable } from "./focus";
import { useT } from "../../locale";
import { ReviewRounds } from "./Cards";
import type { TeamRunsApi } from "./run";

/** The sentences these cards translate from data. */
const WORDS = ["A person sided with the lead", "A person sided with {role}", "A person gave another direction", "Waiting for your decision", "Waiting for the lead to decide", "The lead asked for more evidence", "The lead decided",
  "The proposal passed the review but could not be applied just then.", "The reviewer agent still did not pass the proposal after the last revision round.", "The reviewer agent passed the proposal, but this host now asks for a person's decision.",
  "The reviewer agent passed the result, but this host now asks for a person's sign-off.", "Disagrees", "The team disagrees on something and needs your decision", "A proposal needs your decision: the reviewer agent could not pass it"];
void WORDS;

function Position(props: { who: string; children: string[]; testID: string }) {
  const theme = useTheme();
  return (
    <View testID={props.testID} style={{ flex: 1, minWidth: 220, gap: space[1], padding: space[2], borderRadius: 8, borderWidth: 1, borderColor: theme.color("border/hairline") }}>
      <Text variant="meta" color="text/secondary">{props.who}</Text>
      {props.children.filter(Boolean).map((line, index) => <Text key={index} selectable>{line}</Text>)}
    </View>
  );
}

/**
 * A disagreement the lead gave to the person: what the lead holds and what the peer holds, side by side, and the three
 * ways to decide — with the lead, with the peer, or another direction in the person's own words.
 */
export function DissentCard(props: { run: TeamRun; dissent: TeamDissent; mayAct: boolean; api: Pick<TeamRunsApi, "resolveEscalation"> }) {
  const t = useT();
  const { dissent, run } = props;
  const [other, setOther] = useState(false);
  const [direction, setDirection] = useState("");
  const [busy, setBusy] = useState<"lead" | "peer" | "other" | null>(null);
  const decide = async (decision: "lead" | "peer" | "other") => { setBusy(decision); await props.api.resolveEscalation(run.id, dissent.id, decision, decision === "other" ? direction.trim() : undefined); setBusy(null); };
  return (
    <Focusable kind="agent.dissent_escalated" id={dissent.id}>
    <Card padding={space[3]}>
      <View testID={`run-dissent-${dissent.id}`} {...({ dataSet: { status: dissent.status } } as object)} style={{ gap: space[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
          <Text variant="body-medium" style={{ flex: 1, minWidth: 180 }}>{t("The team disagrees — you decide")}</Text>
          <StatusPill label={t("Needs you")} status="needs approval" />
        </View>
        <Text color="text/secondary">{t("The lead and {role} “{title}” see this differently. Work on it waits for your decision.", { role: dissent.peerRoleLabel, title: dissent.peerTitle })}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          <Position who={t("The lead says")} testID="dissent-lead">{[dissent.rationale ?? ""]}</Position>
          <Position who={t("{role} says", { role: dissent.peerRoleLabel })} testID="dissent-peer">{[dissent.claim ?? "", dissent.requestedResolution ? t("Asks for: {request}", { request: dissent.requestedResolution }) : ""]}</Position>
        </View>
        {props.mayAct ? (
          <>
            {other ? <Textarea value={direction} onChangeText={setDirection} minLines={2} maxLines={6} maxLength={4000} autoFocus placeholder={t("What should the team do instead?")} accessibilityLabel={t("What should the team do instead?")} testID="dissent-direction" /> : null}
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
              {other ? (
                <>
                  <Button kind="primary" size="sm" label={t("Send direction")} testID="dissent-send" loading={busy === "other"} disabled={busy !== null || !direction.trim()} onPress={() => void decide("other")} />
                  <Button kind="ghost" size="sm" label={t("Back")} disabled={busy !== null} onPress={() => { setOther(false); setDirection(""); }} />
                </>
              ) : (
                <>
                  <Button kind="primary" size="sm" label={t("Side with lead")} testID="dissent-side-lead" loading={busy === "lead"} disabled={busy !== null} onPress={() => void decide("lead")} />
                  <Button size="sm" label={t("Side with {role}", { role: dissent.peerRoleLabel })} testID="dissent-side-peer" loading={busy === "peer"} disabled={busy !== null} onPress={() => void decide("peer")} />
                  <Button kind="ghost" size="sm" label={t("Give other direction")} testID="dissent-other" disabled={busy !== null} onPress={() => setOther(true)} />
                </>
              )}
            </View>
          </>
        ) : <Text variant="meta" color="text/secondary" testID="dissent-readonly">{t("This device cannot decide")}</Text>}
      </View>
    </Card>
    </Focusable>
  );
}

/** Every disagreement of a run and how it ended (the one that waits for the person has its own card above). */
export function DissentList(props: { run: TeamRun }) {
  const t = useT();
  const dissents = props.run.dissents ?? [];
  if (!dissents.length) return null;
  return (
    <View testID="run-dissents" style={{ gap: space[1] }}>
      <Text variant="body-medium">{dissents.length === 1 ? t("1 disagreement") : t("{count} disagreements", { count: dissents.length })}</Text>
      {dissents.map((dissent) => {
        const outcome = dissentOutcome(dissent);
        return (
          <View key={dissent.id} testID={`run-dissent-row-${dissent.id}`} {...({ dataSet: { status: dissent.status, outcome: dissent.outcome ?? "" } } as object)} style={{ gap: space[0.5] }}>
            <Text>{`${dissent.peerRoleLabel} “${dissent.peerTitle}” — ${t(outcome.label, { role: dissent.peerRoleLabel })}`}</Text>
            {dissent.claim || dissent.requestedResolution ? <Text variant="meta" color="text/secondary" selectable>{[dissent.claim, dissent.requestedResolution ? t("Asks for: {request}", { request: dissent.requestedResolution }) : ""].filter(Boolean).join(" · ")}</Text> : null}
            {outcome.text ? <Text variant="meta" color="text/secondary" selectable>{outcome.text}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

/** The agent reviews of proposals: who checks which proposal, every round, and how it ended. */
export function ProposalReviews(props: { reviews: ProposalReview[] }) {
  const t = useT();
  if (!props.reviews.length) return null;
  return (
    <View testID="proposal-reviews" style={{ gap: space[2] }}>
      {props.reviews.map((review) => {
        const reviewer = review.reviewerTitle ?? t("A reviewer agent"), passed = review.reviews.findLast((round) => round.passed);
        const line = review.status === "reviewing" ? t("{reviewer} is checking this proposal. It is applied when it passes, and comes to you when the reviewer cannot pass it.", { reviewer })
          : review.status === "interrupted" ? t("The host restarted while {reviewer} was checking this proposal. The check starts again when you resume the team's work.", { reviewer })
          : review.status === "approved" && passed ? t("Approved by {reviewer} (agent) · {total}/100 · round {round}", { reviewer, total: passed.total, round: passed.round })
          : review.status === "changes_requested" ? t("The reviewer asked for changes. {author} is revising the proposal.", { author: review.authorTitle })
          : review.status === "escalated" ? `${t(proposalEscalationReason(review))} ${t("Decide on it in the chat.")}`
          : review.status === "approved" ? t("A person accepted this proposal.")
          : review.status === "rejected" ? t("A person rejected this proposal.")
          : review.human ? (review.human.decision === "reject" ? t("A person rejected it before the review ended.") : t("A person accepted it before the review ended."))
          : t("A person decided on it before the review ended.");
        return (
          <Focusable key={review.id} kind="agent.proposal_ready" id={review.subject.id}>
          <Card padding={space[3]}>
            <View testID={`proposal-review-${review.id}`} {...({ dataSet: { status: review.status, proposal: review.subject.id } } as object)} style={{ gap: space[2] }}>
              <Text variant="body-medium">{t("Proposal “{title}” by {author}", { title: review.title, author: review.authorTitle })}</Text>
              <Text color="text/secondary" testID="proposal-review-line">{line}</Text>
              <ReviewRounds approval={{ reviews: review.reviews, policy: review.policy, reviewerTitle: reviewer, ...(review.warning ? { warning: review.warning } : {}) } as TeamRunApproval} />
            </View>
          </Card>
          </Focusable>
        );
      })}
    </View>
  );
}

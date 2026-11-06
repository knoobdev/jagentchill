import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { APPROVAL_DEFAULTS, DEFAULT_REVIEW_CRITERIA, ORC_BUILTIN_ROLES, type AgentCallPreset, type ApprovalMode, type ApprovalPolicy, type ReviewCriterion, type Team, type TeamRole } from "@jagentchill/protocol";
import { Badge, Button, Callout, Card, ConfirmDialog, EmptyState, FormField, GroupedSettingCard, Input, RadioGroup, Select, SettingRow, SkeletonList, Switch, Text, Textarea, space, useToast, type Crumb } from "@jagentchill/ui";
import { useHost } from "../../host";
import { useT } from "../../locale";
import { SettingsPageFrame } from "../../settings/SettingsScreen";
import { reasonOf } from "../errors";
import { hostSettingsRoute } from "../ModelBrowser";
import { useAgentLimits, useTeam, useTeams } from "./data";
import { useAgentPolicies } from "./run";

const REVIEWER_ROLES = ORC_BUILTIN_ROLES.filter((role) => role.capability === "llm");
const criterionId = (label: string, taken: string[]): string => {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^[^a-z]+/, "").replace(/_+$/, "").slice(0, 28) || "criterion";
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}_${n}`;
  return id;
};
/**
 * What a reviewer agent checks a team's result against: the role it runs on, the score that passes, the lowest score a
 * single criterion may have, how often the team may revise, which findings block, and the criteria with their weights.
 * A field left as it is keeps the host's standard value, which the row shows.
 */
function ReviewPolicyRows(props: { policy: ApprovalPolicy; admin: boolean; onChange(policy: ApprovalPolicy): void; /** The start of the rows' test ids: two policies of a team are edited on one screen. */ id?: string }) {
  const t = useT();
  const { policy, admin } = props, id = props.id ?? "team-review";
  const persona = policy.reviewer?.persona, role = policy.reviewer?.role ?? APPROVAL_DEFAULTS.reviewerRole;
  /** The reviewer as the policy names it; a persona without a name is not a persona. */
  const setPersona = (next: { name: string; instructions?: string }) => set({ reviewer: { role, ...(policy.reviewer?.profileId ? { profileId: policy.reviewer.profileId } : {}), ...(next.name.trim() ? { persona: { name: next.name, ...(next.instructions?.trim() ? { instructions: next.instructions } : {}) } } : {}) } });
  const criteria: ReviewCriterion[] = policy.criteria ?? DEFAULT_REVIEW_CRITERIA.map((entry) => ({ ...entry }));
  const set = (change: Partial<ApprovalPolicy>) => props.onChange({ ...policy, ...change });
  const number = (text: string, min: number, max: number): number | undefined => { const value = Number(text); return text.trim() !== "" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : undefined; };
  const setCriteria = (next: ReviewCriterion[]) => set({ criteria: next });
  const steps = (from: number, to: number, by: number) => Array.from({ length: Math.floor((to - from) / by) + 1 }, (_, index) => String(from + index * by));
  return (
    <>
      <SettingRow label={t("Reviewer")} description={t("The routing role whose model the reviewer agent runs on. It only reads and scores; it never edits and never reviews its own work.")}>
        <View testID={`${id}-role`}><Select label={t("Reviewer")} width={220} disabled={!admin} value={policy.reviewer?.role ?? APPROVAL_DEFAULTS.reviewerRole} options={REVIEWER_ROLES.map((role) => ({ value: role.id, label: t(role.label) }))} onChange={(next) => set({ reviewer: { ...policy.reviewer, role: next } })} /></View>
      </SettingRow>
      <SettingRow label={t("Reviewer's name")} description={t("Who the reviewer is to the people who read its reviews, for example “Continuity checker”. Leave empty to call it Reviewer.")}>
        <Input size="sm" value={persona?.name ?? ""} maxLength={60} readOnly={!admin} placeholder={t("Reviewer")} accessibilityLabel={t("Reviewer's name")} testID={`${id}-persona-name`} onChangeText={(name) => setPersona({ name, ...(persona?.instructions ? { instructions: persona.instructions } : {}) })} style={{ width: 220 }} />
      </SettingRow>
      {persona?.name.trim() ? (
        <View style={{ gap: space[1], paddingHorizontal: space[3], paddingVertical: space[2] }}>
          <Text variant="body-medium">{t("How this reviewer judges")}</Text>
          <Text variant="meta" color="text/secondary">{t("Said to the reviewer before every review, in your own words.")}</Text>
          <Textarea value={persona.instructions ?? ""} onChangeText={(instructions) => setPersona({ name: persona.name, instructions })} minLines={2} maxLines={6} maxLength={4000} readOnly={!admin} placeholder={t("For example: judge continuity before anything else.")} accessibilityLabel={t("How this reviewer judges")} testID={`${id}-persona-instructions`} />
        </View>
      ) : null}
      <SettingRow label={t("Score that passes")} description={t("The weighted total, out of 100, a review needs.")}>
        <View testID={`${id}-threshold`}><Select label={t("Score that passes")} width={100} disabled={!admin} value={String(policy.threshold ?? APPROVAL_DEFAULTS.threshold)} options={steps(50, 95, 5).map((value) => ({ value, label: value }))} onChange={(value) => set({ threshold: Number(value) })} /></View>
      </SettingRow>
      <SettingRow label={t("Lowest score of a single criterion")} description={t("A result with one criterion under this does not pass, whatever its total.")}>
        <View testID={`${id}-floor`}><Select label={t("Lowest score of a single criterion")} width={100} disabled={!admin} value={String(policy.criterionFloor ?? APPROVAL_DEFAULTS.criterionFloor)} options={steps(0, 90, 10).map((value) => ({ value, label: value }))} onChange={(value) => set({ criterionFloor: Number(value) })} /></View>
      </SettingRow>
      <SettingRow label={t("Revision rounds")} description={t("How often the team may revise after a failed review before the result comes to you.")}>
        <View testID={`${id}-rounds`}><Select label={t("Revision rounds")} width={100} disabled={!admin} value={String(policy.maxRounds ?? APPROVAL_DEFAULTS.maxRounds)} options={steps(0, 5, 1).map((value) => ({ value, label: value }))} onChange={(value) => set({ maxRounds: Number(value) })} /></View>
      </SettingRow>
      <SettingRow label={t("Findings that block")} description={t("A finding this serious, or worse, keeps a result from passing.")}>
        <View testID={`${id}-severity`}><Select label={t("Findings that block")} width={220} disabled={!admin} value={policy.blockOnSeverity ?? APPROVAL_DEFAULTS.blockOnSeverity}
          options={[{ value: "critical", label: t("Critical only") }, { value: "high", label: t("High and critical") }, { value: "medium", label: t("Medium and worse") }, { value: "none", label: t("None blocks") }]} onChange={(value) => set({ blockOnSeverity: value as ApprovalPolicy["blockOnSeverity"] })} /></View>
      </SettingRow>
      <View testID={`${id}-criteria`} style={{ gap: space[2], paddingHorizontal: space[3], paddingVertical: space[2] }}>
        <Text variant="body-medium">{t("What the reviewer scores")}</Text>
        <Text variant="meta" color="text/secondary">{t("Each criterion gets a score from 0 to 100; the weight says how much it counts in the total.")}</Text>
        {criteria.map((entry, index) => (
          <View key={entry.id} style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Input size="sm" value={policy.criteria ? entry.label : t(entry.label)} maxLength={120} readOnly={!admin} accessibilityLabel={t("Criterion {n}", { n: index + 1 })} testID={`${id}-criterion-${index}`} onChangeText={(label) => setCriteria(criteria.map((item, at) => (at === index ? { ...item, label } : item)))} style={{ flex: 1, minWidth: 120 }} />
            <Input size="sm" value={String(entry.weight)} readOnly={!admin} inputMode="numeric" accessibilityLabel={t("Weight of criterion {n}", { n: index + 1 })} testID={`${id}-weight-${index}`} onChangeText={(text) => setCriteria(criteria.map((item, at) => (at === index ? { ...item, weight: number(text, 1, 100) ?? item.weight } : item)))} style={{ width: 64 }} />
            {admin ? <Button kind="ghost" size="sm" icon="trash" iconOnly label={t("Remove criterion {n}", { n: index + 1 })} disabled={criteria.length <= 1} onPress={() => setCriteria(criteria.filter((_, at) => at !== index))} /> : null}
          </View>
        ))}
        {admin ? (
          <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }}>
            <Button size="sm" icon="plus" label={t("Add a criterion")} testID="team-review-add" disabled={criteria.length >= 12} onPress={() => setCriteria([...criteria, { id: criterionId(t("New criterion"), criteria.map((entry) => entry.id)), label: t("New criterion"), weight: 10 }])} />
            {policy.criteria ? <Button kind="ghost" size="sm" label={t("Use the standard criteria")} onPress={() => { const { criteria: _own, ...rest } = policy; props.onChange(rest); }} /> : null}
          </View>
        ) : null}
      </View>
    </>
  );
}

/** "Not set on the team": the level above decides. */
const INHERIT = "inherit";

const TIERS: Array<{ value: TeamRole["tier"]; label: string }> = [{ value: "supervisor", label: "Director" }, { value: "lead", label: "Lead" }, { value: "peer", label: "Peer" }];
const ORC_ROLES = ORC_BUILTIN_ROLES.filter((role) => role.capability === "llm" && role.group !== "understanding");
const SLUG = /^[a-z][a-z0-9-]{1,39}$/;
const slugOf = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^[^a-z]+/, "").slice(0, 40);
const numberIn = (text: string, min: number, max: number): number | null => { const value = Number(text); return Number.isInteger(value) && value >= min && value <= max ? value : null; };

/** Settings → Teams: the teams of the host, and the editor of one team (its roles, who writes, its limits). */
export function TeamsScreen(props: { teamId?: string }) {
  return props.teamId ? <TeamEditor teamId={props.teamId} /> : <TeamList />;
}

function useCrumbs(last?: string): Crumb[] {
  const t = useT();
  const router = useRouter();
  const { host } = useHost();
  const list: Crumb[] = [{ id: "settings", label: t("Settings"), onPress: () => router.push("/settings" as never) }, { id: "host", label: host?.gatewayName ?? t("Host") }];
  if (!last) return [...list, { id: "teams", label: t("Teams") }];
  return [...list, { id: "teams", label: t("Teams"), onPress: () => host && router.push(hostSettingsRoute(host.gatewayId, "teams") as never) }, { id: "team", label: last }];
}

function TeamList() {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const { host, connection, can } = useHost();
  const admin = can("jagentchill.config.write");
  const { teams, error, reload } = useTeams();
  const limits = useAgentLimits();
  const policies = useAgentPolicies();
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const crumbs = useCrumbs();
  const act = async (method: string, teamId: string) => {
    if (!connection) return;
    try { await connection.call(method, { teamId }); reload(); } catch (failure) { toast.show({ kind: "error", message: reasonOf(failure) }); }
  };
  const open = (teamId: string) => host && router.push(hostSettingsRoute(host.gatewayId, "teams", teamId) as never);
  return (
    <SettingsPageFrame crumbs={crumbs} title={t("Teams")} description={t("Teams of agents with fixed roles. A session that is given a team has its agent act as the Director and staff the other roles.")}>
      {!admin ? <Text variant="meta" color="text/secondary">{t("Managed by the host admin")}</Text> : null}
      {error ? <Callout tone="danger" actions={[{ label: t("Retry"), onPress: reload }]}>{reasonOf(error)}</Callout> : null}
      {limits.limits ? (
        <GroupedSettingCard>
          <SettingRow label={t("Agents working at once per session")} description={t("How many agents of one session may work at the same time, the session's own agent included.")}>
            <Select label={t("Agents working at once per session")} width={72} disabled={!admin} value={String(limits.limits.maxConcurrentAgentsPerTree)} options={[2, 4, 8, 16, 32].map((value) => ({ value: String(value), label: String(value) }))} onChange={(value) => void limits.set({ maxConcurrentAgentsPerTree: Number(value) })} />
          </SettingRow>
          <SettingRow label={t("Levels of sub-agents")} description={t("How deep an agent's sub-agents may create their own.")} last>
            <Select label={t("Levels of sub-agents")} width={72} disabled={!admin} value={String(limits.limits.maxDepth)} options={[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: String(value) }))} onChange={(value) => void limits.set({ maxDepth: Number(value) })} />
          </SettingRow>
        </GroupedSettingCard>
      ) : null}
      {policies.approval ? (
        <GroupedSettingCard>
          <SettingRow label={t("Approval policy")} description={t("Who signs off the result of a team run when its team does not say.")}>
            <View testID="host-approval-default"><Select label={t("Approval policy")} width={220} disabled={!admin} value={policies.approval.default} options={[{ value: "human", label: t("A person signs off") }, { value: "agent", label: t("A reviewer agent checks it") }, { value: "auto", label: t("Accepted automatically") }]}
              onChange={(value) => void policies.setApproval({ default: value as ApprovalMode })} /></View>
          </SettingRow>
          <SettingRow label={t("The least every team must have")} description={t("No team's policy is weaker than this. With a reviewer agent as the least, a member's proposed edit still needs a person: an agent never accepts an edit.")} last>
            <View testID="host-approval-minimum" {...({ dataSet: { minimum: policies.approval.minimum } } as object)}><Select label={t("The least every team must have")} width={220} disabled={!admin} value={policies.approval.minimum}
              options={[{ value: "auto", label: t("Nothing: the team decides") }, { value: "agent", label: t("At least a reviewer agent") }, { value: "human", label: t("Always a person") }]}
              onChange={(value) => void policies.setApproval({ minimum: value as ApprovalMode })} /></View>
          </SettingRow>
        </GroupedSettingCard>
      ) : null}
      {policies.preset ? (
        <Card padding={space[3]}>
          <View testID="agents-call-preset" {...({ dataSet: { preset: policies.preset } } as object)} style={{ gap: space[2] }}>
            <Text variant="body-medium">{t("Who agents can call")}</Text>
            <RadioGroup label={t("Who agents can call")} value={policies.preset} onChange={(value) => void policies.setPreset(value as AgentCallPreset)}
              options={[{ value: "tree", label: t("Same session tree — an agent reaches the agents it created and the one it reports to"), disabled: !admin }, { value: "team", label: t("Team members — the members of one team run can also message each other"), disabled: !admin }]} />
          </View>
        </Card>
      ) : null}
      {!teams && !error ? <SkeletonList rows={2} meta /> : null}
      {teams && teams.length === 0 ? <EmptyState icon="user" title={t("No teams")} description={t("Reset a shipped team or ask an admin device to add one.")} /> : null}
      {(teams ?? []).map((team) => (
        <Card key={team.id} padding={space[3]}>
          <View testID={`team-row-${team.id}`} style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
            <View style={{ flex: 1, minWidth: 180, gap: space[0.5] }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
                <Text variant="body-medium" numberOfLines={1}>{team.name}</Text>
                {team.template ? <Badge label={t("Template")} /> : null}
                {!team.enabled ? <Badge label={t("Off")} /> : null}
              </View>
              <Text variant="meta" color="text/secondary" numberOfLines={2}>{`${t("{count} roles", { count: team.roleCount })}${team.description ? ` · ${team.description}` : ""}`}</Text>
            </View>
            <Button size="sm" label={admin ? t("Edit") : t("View")} testID={`team-open-${team.id}`} onPress={() => open(team.id)} />
            {admin ? <Button kind="ghost" size="sm" label={t("Duplicate")} testID={`team-duplicate-${team.id}`} onPress={() => void act("jagentchill.orc.team.duplicate", team.id)} /> : null}
            {admin && team.templateId && !team.template ? <Button kind="ghost" size="sm" label={t("Reset to template")} testID={`team-reset-${team.id}`} onPress={() => void act("jagentchill.orc.team.reset", team.id)} /> : null}
            {admin ? <Button kind="ghost" size="sm" tone="danger" label={t("Delete")} testID={`team-delete-${team.id}`} onPress={() => setRemoving({ id: team.id, name: team.name })} /> : null}
          </View>
        </Card>
      ))}
      <ConfirmDialog open={!!removing} title={t("Delete the team “{name}”?", { name: removing?.name ?? "" })} description={t("Sessions that use it go on without a team.")} confirmLabel={t("Delete")}
        onConfirm={() => { const team = removing; setRemoving(null); if (team) void act("jagentchill.orc.team.delete", team.id); }} onClose={() => setRemoving(null)} />
    </SettingsPageFrame>
  );
}

function TeamEditor(props: { teamId: string }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const { host, connection, can } = useHost();
  const admin = can("jagentchill.config.write");
  const stored = useTeam(props.teamId);
  const [draft, setDraft] = useState<Team | null>(null);
  const [limitText, setLimitText] = useState({ peers: "", assignments: "", cost: "", turns: "" });
  const [saving, setSaving] = useState(false);
  const [newRole, setNewRole] = useState("");
  useEffect(() => {
    setDraft(stored.team);
    if (stored.team) setLimitText({ peers: String(stored.team.limits.maxConcurrentPeersPerLead), assignments: String(stored.team.limits.maxAssignmentsPerBrief), cost: stored.team.limits.maxRunCostUsd !== undefined ? String(stored.team.limits.maxRunCostUsd) : "", turns: stored.team.limits.maxRunTurns !== undefined ? String(stored.team.limits.maxRunTurns) : "" });
  }, [stored.team]);
  const crumbs = useCrumbs(draft?.name ?? props.teamId);
  if (stored.missing) {
    return (
      <SettingsPageFrame crumbs={crumbs} title={t("Teams")}>
        <EmptyState icon="user" title={t("This team no longer exists")} actions={host ? [{ label: t("All teams"), onPress: () => router.push(hostSettingsRoute(host.gatewayId, "teams") as never) }] : undefined} />
      </SettingsPageFrame>
    );
  }
  if (!draft || !stored.team) return <SettingsPageFrame crumbs={crumbs} title={t("Teams")}><SkeletonList rows={4} meta /></SettingsPageFrame>;
  const patch = (change: Partial<Team>) => setDraft({ ...draft, ...change });
  const patchRole = (roleId: string, change: Partial<TeamRole>) => patch({ roles: draft.roles.map((role) => (role.roleId === roleId ? { ...role, ...change } : role)) });
  const patchContract = (roleId: string, change: Partial<TeamRole["contract"]>) => patch({ roles: draft.roles.map((role) => (role.roleId === roleId ? { ...role, contract: { ...role.contract, ...change } } : role)) });
  const peers = numberIn(limitText.peers, 1, 12), assignments = numberIn(limitText.assignments, 1, 100);
  const cost = limitText.cost.trim() === "" ? undefined : Number(limitText.cost);
  const costValid = cost === undefined || (Number.isFinite(cost) && cost >= 0.01 && cost <= 10_000);
  const turns = limitText.turns.trim() === "" ? undefined : numberIn(limitText.turns, 3, 2000);
  const limitsOut = { maxConcurrentPeersPerLead: peers, maxAssignmentsPerBrief: assignments, ...(cost !== undefined ? { maxRunCostUsd: cost } : {}), ...(turns ? { maxRunTurns: turns } : {}) };
  const enabled = draft.roles.filter((role) => role.enabled);
  const problem = !draft.name.trim() ? t("Give the team a name.")
    : enabled.filter((role) => role.tier === "supervisor").length !== 1 ? t("A team has exactly one enabled Director role.")
    : !enabled.some((role) => role.tier === "lead") ? t("A team needs an enabled lead role.")
    : !enabled.some((role) => role.tier === "peer") ? t("A team needs at least one enabled peer role.")
    : draft.roles.some((role) => !role.label.trim() || !role.contract.responsibility.trim() || !role.contract.ownershipBoundary.trim() || !role.contract.expectedHandback.trim()) ? t("Every role needs a label, a responsibility, an ownership boundary and an expected hand-back.")
    : peers === null ? t("Peers working at once per lead is a whole number from 1 to 12.")
    : assignments === null ? t("Assignments per task is a whole number from 1 to 100.")
    : !costValid ? t("The cost limit is between 0.01 and 10,000 USD, or empty for none.")
    : turns === null ? t("The turn limit is a whole number from 3 to 2,000, or empty for the host's limit.") : null;
  const dirty = JSON.stringify({ ...draft, limits: limitsOut }) !== JSON.stringify(stored.team);
  const save = async () => {
    if (!connection || problem || peers === null || assignments === null) return;
    setSaving(true);
    try {
      const { created_ms: _created, updated_ms: _updated, ...team } = draft;
      const result = await connection.call<{ team: Team; template: boolean }>("jagentchill.orc.team.save", { team: { ...team, name: team.name.trim(), limits: limitsOut } });
      stored.set(result.team, result.template);
      toast.show({ kind: "success", message: t("Team saved") });
    } catch (failure) { toast.show({ kind: "error", message: reasonOf(failure) }); }
    setSaving(false);
  };
  const addRole = () => {
    const label = newRole.trim(), roleId = slugOf(label);
    if (!label || !SLUG.test(roleId) || draft.roles.some((role) => role.roleId === roleId)) { toast.show({ kind: "error", message: t("Give the role a name of its own, starting with a letter.") }); return; }
    patch({ roles: [...draft.roles, { roleId, tier: "peer", label: label.slice(0, 40), orcRole: "peer", enabled: true, contract: { responsibility: "", ownershipBoundary: "", expectedHandback: "", canWrite: false } }] });
    setNewRole("");
  };
  return (
    <SettingsPageFrame crumbs={crumbs} title={draft.name || t("Teams")} description={stored.template ? t("A shipped team. Saving a change makes it yours; “Reset to template” in the list brings the original back.") : undefined}
      actions={admin ? <><Button size="sm" label={t("Discard")} disabled={!dirty || saving} testID="team-discard" onPress={() => setDraft(stored.team)} /><Button kind="primary" size="sm" label={t("Save")} loading={saving} disabled={!dirty || !!problem} testID="team-save" onPress={() => void save()} /></> : undefined}>
      {!admin ? <Text variant="meta" color="text/secondary">{t("Managed by the host admin")}</Text> : null}
      {admin && dirty && problem ? <Callout tone="warning">{problem}</Callout> : null}
      <GroupedSettingCard>
        <SettingRow label={t("Name")}><Input size="sm" value={draft.name} maxLength={60} readOnly={!admin} accessibilityLabel={t("Name")} testID="team-name" onChangeText={(name) => patch({ name })} style={{ width: 280 }} /></SettingRow>
        <SettingRow label={t("Description")}><Input size="sm" value={draft.description} maxLength={280} readOnly={!admin} accessibilityLabel={t("Description")} onChangeText={(description) => patch({ description })} style={{ width: 280 }} /></SettingRow>
        <SettingRow label={t("Enabled")} description={t("A team that is off cannot be chosen for a session.")}><Switch value={draft.enabled} disabled={!admin} accessibilityLabel={t("Enabled")} onChange={(value) => patch({ enabled: value })} /></SettingRow>
        <SettingRow label={t("Who edits the project")} description={t("“The Director assigns” lets only the one agent it gave the write assignment edit; “First come” lets every writing role edit in turn.")}>
          <Select label={t("Who edits the project")} width={200} disabled={!admin} value={draft.writerPolicy} options={[{ value: "lead_assigns", label: t("The Director assigns") }, { value: "queue", label: t("First come, in turn") }]} onChange={(writerPolicy) => patch({ writerPolicy })} />
        </SettingRow>
        <SettingRow label={t("Peers working at once per lead")}><Input size="sm" value={limitText.peers} readOnly={!admin} invalid={peers === null} inputMode="numeric" accessibilityLabel={t("Peers working at once per lead")} testID="team-limit-peers" onChangeText={(peersText) => setLimitText({ ...limitText, peers: peersText })} style={{ width: 80 }} /></SettingRow>
        <SettingRow label={t("Assignments per task")}><Input size="sm" value={limitText.assignments} readOnly={!admin} invalid={assignments === null} inputMode="numeric" accessibilityLabel={t("Assignments per task")} onChangeText={(text) => setLimitText({ ...limitText, assignments: text })} style={{ width: 80 }} /></SettingRow>
        <SettingRow label={t("Turn limit of a session with this team")} description={t("Turns the Director and its agents may take together after each message of yours. It also holds where no cost is known. Empty: the host's limit.")}>
          <Input size="sm" value={limitText.turns} readOnly={!admin} invalid={turns === null} inputMode="numeric" accessibilityLabel={t("Turn limit of a session with this team")} testID="team-limit-turns" onChangeText={(text) => setLimitText({ ...limitText, turns: text })} style={{ width: 80 }} />
        </SettingRow>
        <SettingRow label={t("Cost limit of a session with this team")} description={t("In USD, for the Director and all its agents together. Empty: no limit.")} last>
          <Input size="sm" value={limitText.cost} readOnly={!admin} invalid={!costValid} inputMode="decimal" prefix="$" accessibilityLabel={t("Cost limit of a session with this team")} testID="team-limit-cost" onChangeText={(text) => setLimitText({ ...limitText, cost: text })} style={{ width: 100 }} />
        </SettingRow>
      </GroupedSettingCard>
      <Text variant="body-medium">{t("Approval")}</Text>
      <GroupedSettingCard>
        <SettingRow label={t("Result of a run")} description={t("Who signs off what the team hands to you at the end of a request.")}>
          <View testID="team-approval-result"><Select label={t("Result of a run")} width={220} disabled={!admin} value={draft.resultApproval?.mode ?? INHERIT}
            options={[{ value: INHERIT, label: t("Host default") }, { value: "human", label: t("A person signs off") }, { value: "agent", label: t("A reviewer agent checks it") }, { value: "auto", label: t("Accepted automatically") }]}
            onChange={(value) => { const { resultApproval: own, ...rest } = draft; setDraft(value === INHERIT ? rest : { ...rest, resultApproval: { ...own, mode: value as ApprovalMode } }); }} /></View>
        </SettingRow>
        {draft.resultApproval?.mode === "agent" ? <ReviewPolicyRows policy={draft.resultApproval} admin={admin} onChange={(resultApproval) => patch({ resultApproval })} /> : null}
        <SettingRow label={t("Proposals of team members")} description={t("Who accepts an edit a member proposes on the project.")} last={draft.proposalApproval?.mode !== "agent"}>
          <View testID="team-approval-proposal"><Select label={t("Proposals of team members")} width={220} disabled={!admin} value={draft.proposalApproval?.mode ?? INHERIT}
            options={[{ value: INHERIT, label: t("The session's mode decides") }, { value: "human", label: t("A person decides") }, { value: "agent", label: t("A reviewer agent checks it") }, { value: "auto", label: t("Accepted automatically") }]}
            onChange={(value) => { const { proposalApproval: own, ...rest } = draft; setDraft(value === INHERIT ? rest : { ...rest, proposalApproval: { ...own, mode: value as ApprovalMode } }); }} /></View>
        </SettingRow>
        {draft.proposalApproval?.mode === "agent" ? <ReviewPolicyRows id="team-proposal-review" policy={draft.proposalApproval} admin={admin} onChange={(proposalApproval) => patch({ proposalApproval })} /> : null}
      </GroupedSettingCard>
      <Text variant="body-medium">{t("Roles")}</Text>
      {draft.roles.map((role) => (
        <Card key={role.roleId} padding={space[3]}>
          <View testID={`team-role-${role.roleId}`} style={{ gap: space[2] }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
              <Switch value={role.enabled} disabled={!admin} accessibilityLabel={t("Role enabled")} onChange={(value) => patchRole(role.roleId, { enabled: value })} />
              <Input size="sm" value={role.label} maxLength={40} readOnly={!admin} accessibilityLabel={t("Role label")} testID={`team-role-label-${role.roleId}`} onChangeText={(label) => patchRole(role.roleId, { label })} style={{ width: 180 }} />
              <Select label={t("Tier")} width={120} disabled={!admin} value={role.tier} options={TIERS.map((tier) => ({ value: tier.value, label: t(tier.label) }))} onChange={(tier) => patchRole(role.roleId, { tier })} />
              <Select label={t("Model role")} width={160} disabled={!admin} value={role.orcRole} options={ORC_ROLES.map((entry) => ({ value: entry.id, label: t(entry.label) }))} onChange={(orcRole) => patchRole(role.roleId, { orcRole })} />
              {host ? <Button kind="ghost" size="xs" label={t("Models of this role")} testID={`team-role-models-${role.roleId}`} onPress={() => router.push(hostSettingsRoute(host.gatewayId, "model-routing") as never)} /> : null}
              <View style={{ flex: 1 }} />
              {admin && role.tier === "peer" ? <Button kind="ghost" size="xs" tone="danger" label={t("Remove role")} onPress={() => patch({ roles: draft.roles.filter((entry) => entry.roleId !== role.roleId) })} /> : null}
            </View>
            <FormField label={t("Responsibility")}><Textarea value={role.contract.responsibility} maxLength={1000} readOnly={!admin} minLines={2} maxLines={5} accessibilityLabel={t("Responsibility")} onChangeText={(responsibility) => patchContract(role.roleId, { responsibility })} /></FormField>
            <FormField label={t("Ownership boundary")}><Textarea value={role.contract.ownershipBoundary} maxLength={1000} readOnly={!admin} minLines={1} maxLines={4} accessibilityLabel={t("Ownership boundary")} onChangeText={(ownershipBoundary) => patchContract(role.roleId, { ownershipBoundary })} /></FormField>
            <FormField label={t("Expected hand-back")}><Textarea value={role.contract.expectedHandback} maxLength={1000} readOnly={!admin} minLines={1} maxLines={4} accessibilityLabel={t("Expected hand-back")} onChangeText={(expectedHandback) => patchContract(role.roleId, { expectedHandback })} /></FormField>
            <FormField label={t("Instructions")} description={t("Added to this role's agents when they are created")}><Textarea value={role.instructions ?? ""} maxLength={4000} readOnly={!admin} minLines={1} maxLines={6} accessibilityLabel={t("Instructions")} onChangeText={(instructions) => patchRole(role.roleId, { instructions })} /></FormField>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
              <Switch value={role.contract.canWrite} disabled={!admin || role.tier !== "peer"} accessibilityLabel={t("Edits the project")} onChange={(value) => patchContract(role.roleId, { canWrite: value })} />
              <Text>{t("Edits the project")}</Text>
            </View>
          </View>
        </Card>
      ))}
      {admin ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Input size="sm" value={newRole} maxLength={40} placeholder={t("Name of a new role")} accessibilityLabel={t("Name of a new role")} testID="team-new-role" onChangeText={setNewRole} onSubmitEditing={addRole} style={{ width: 240 }} />
          <Button size="sm" icon="plus" label={t("Add role")} disabled={!newRole.trim() || draft.roles.length >= 24} testID="team-add-role" onPress={addRole} />
        </View>
      ) : null}
    </SettingsPageFrame>
  );
}

/** The "Maximum sub-agents per session" row of the model routing page: how many agents one agent may have working at once. */
export function AgentLimitRow(props: { admin: boolean }) {
  const t = useT();
  const router = useRouter();
  const { host } = useHost();
  const limits = useAgentLimits();
  return (
    <>
      <SettingRow label={t("Maximum sub-agents per session")}>
        <Select label={t("Maximum sub-agents per session")} width={72} disabled={!props.admin || !limits.limits} value={limits.limits ? String(limits.limits.maxConcurrentChildren) : null} placeholder="—"
          options={[1, 2, 3, 4, 6, 8, 12, 20].map((value) => ({ value: String(value), label: String(value) }))} onChange={(value) => void limits.set({ maxConcurrentChildren: Number(value) })} />
      </SettingRow>
      <SettingRow label={t("Teams")} description={t("Teams of agents with fixed roles: who directs, who writes, who reviews.")} last>
        <Button size="sm" label={t("Manage teams")} testID="orc-open-teams" onPress={() => host && router.push(hostSettingsRoute(host.gatewayId, "teams") as never)} />
      </SettingRow>
    </>
  );
}

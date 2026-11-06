import { useEffect, useMemo, useState } from "react";
import { Image, Platform, ScrollView, View } from "react-native";
import { clockOf, durationBadge, relativeTime } from "@jagentchill/app-core";
import { acceptPatch, mainScene, sceneDuration, tracksIn, type StatePatch } from "@jagentchill/editor-core";
import type { ProjectDocument, ProposalChange, ProposalView } from "@jagentchill/protocol";
import { loadProject } from "@jagentchill/storage";
import { Button, EmptyState, Icon, Segmented, Tap, Text, radius, space, useTheme, type ColorToken, type IconName } from "@jagentchill/ui";
import type { Session } from "../host";
import { useT } from "../locale";
import { useProjectActions } from "../projects/actions";
import { useDevice, useLibraryState, useProjectImage } from "../state";
import { SessionPlayer } from "./SessionPlayer";
import { ProposalCard } from "./proposals/ProposalCard";
import { useProposals } from "./proposals/data";

type Proposals = ReturnType<typeof useProposals>;
/** Proposals the person can see: one the agent is still putting together has no card yet. */
export const shownProposals = (proposals: ProposalView[]): ProposalView[] =>
  proposals.filter((proposal) => proposal.state !== "open").sort((a, b) => (b.submitted_ms ?? b.created_ms) - (a.submitted_ms ?? a.created_ms));

const CHANGE_KIND: Record<ProposalChange["kind"], { icon: IconName; color: ColorToken; label: string }> = {
  add: { icon: "plus", color: "success", label: "Added" },
  modify: { icon: "pencil", color: "accent", label: "Modified" },
  remove: { icon: "trash", color: "danger", label: "Removed" },
  move: { icon: "arrow-r", color: "accent", label: "Moved" },
};

/** The change list of one proposal: what was added, modified, removed or moved, in the host's own words. */
function ChangeList(props: { proposal: ProposalView }) {
  const t = useT();
  const theme = useTheme();
  const [open, setOpen] = useState(true);
  const { changes } = props.proposal;
  if (!changes.length) return null;
  return (
    <View testID="changes-list" style={{ gap: 2 }}>
      <Tap role="button" label={t("{n} changes", { n: changes.length })} expanded={open} testID="changes-toggle" onPress={() => setOpen(!open)} style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], minHeight: theme.touch ? 32 : 24 }}>
        <Icon name={open ? "chev-d" : "chev-r"} size={14} color="text/secondary" />
        <Text variant="meta" color="text/secondary" style={{ fontWeight: "500" }}>{changes.length === 1 ? t("1 change") : t("{n} changes", { n: changes.length })}</Text>
      </Tap>
      {open ? changes.map((change) => {
        const kind = CHANGE_KIND[change.kind];
        const accepted = props.proposal.acceptedChangeIds ? props.proposal.acceptedChangeIds.includes(change.changeId) : null;
        return (
          <View key={change.changeId} testID="change-row" {...({ dataSet: { kind: change.kind } } as object)} style={{ flexDirection: "row", alignItems: "flex-start", gap: space[2], paddingVertical: space[1], paddingStart: space[4], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
            <View style={{ marginTop: 2 }}><Icon name={kind.icon} size={14} color={kind.color} label={t(kind.label)} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="body-medium" numberOfLines={1}>{change.label}</Text>
              <Text variant="meta" color="text/secondary">{change.summary}</Text>
            </View>
            <Text variant="meta" color={accepted === false ? "text/tertiary" : kind.color}>{accepted === false ? t("Not applied") : t(kind.label)}</Text>
          </View>
        );
      }) : null}
    </View>
  );
}

/**
 * The Changes tab of a session (`chat-agent.Changes tab`): every proposal the session's agent made to the project —
 * pending, applied, rejected — newest first, each with its before and after pictures, its counts and its change list,
 * and the same actions as its card in the chat (accept, reject, review in the editor, revert).
 */
export function ChangesTab(props: { api: Proposals; sessionKey: string }) {
  const t = useT();
  const { api } = props;
  const list = shownProposals(api.proposals);
  if (!api.loaded) return <View style={{ flex: 1 }} />;
  if (!list.length) return <EmptyState icon="layers" title={t("No changes in this session")} description={t("Changes the agent proposes to a project are listed here, with what each one adds, modifies and removes.")} />;
  return (
    <ScrollView testID="changes-tab" contentContainerStyle={{ padding: space[4], gap: space[4] }}>
      {list.map((proposal) => (
        <View key={proposal.proposalId} testID="changes-entry" style={{ gap: space[1] }}>
          <ProposalCard proposal={proposal} resolve={api.resolve} revert={api.revert} />
          <ChangeList proposal={proposal} />
        </View>
      ))}
    </ScrollView>
  );
}

const ZONE_COLOR: Record<string, ColorToken> = { audio: "success", overlay: "accent", main: "accent" };
type Bar = { id: string; label: string; start: number; duration: number };
type Lane = { id: string; name: string; zone: string; bars: Bar[] };
/** The tracks of the project's main scene with their clips, top to bottom as the editor stacks them. */
function lanesOf(document: ProjectDocument): { lanes: Lane[]; duration: number } {
  const scene = mainScene(document) ?? document.scenes[0];
  if (!scene) return { lanes: [], duration: 0 };
  const lanes: Lane[] = [];
  for (const ref of tracksIn(scene, "")) {
    const track = ref.track as { id?: unknown; name?: unknown; elements?: unknown };
    const elements = (Array.isArray(track.elements) ? track.elements : []) as Array<{ id: string; name?: string; content?: string; type?: string; startTime: number; duration: number }>;
    lanes.push({ id: String(track.id), name: typeof track.name === "string" ? track.name : "", zone: ref.zone, bars: elements.map((element) => ({ id: element.id, label: element.name || element.content || element.type || "", start: element.startTime, duration: element.duration })) });
  }
  return { lanes, duration: sceneDuration(scene) };
}

/**
 * The Timeline preview tab of a session: the bound project in the editor's preview engine, to play and scrub — as it
 * is, or with the newest pending proposal applied — above a read-only miniature of the timeline, with what that
 * proposal touches outlined. Where the engine does not run (native builds, a proposal whose base is not this device's
 * copy) the proposal's before and after pictures stand in. Read from this device's copy; nothing here edits it.
 */
export function TimelinePreviewTab(props: { session: Session | undefined; api: Proposals }) {
  const t = useT();
  const theme = useTheme();
  const { storage } = useDevice();
  const library = useLibraryState();
  const actions = useProjectActions();
  const projectId = props.session?.projectId;
  const project = projectId ? library.projects.find((entry) => entry.id === projectId) ?? null : null;
  const proposal = shownProposals(props.api.proposals.filter((entry) => entry.projectId === projectId))[0];
  const frames = proposal?.frames;
  const pending = proposal?.state === "pending" || proposal?.state === "applying";
  const [side, setSide] = useState<"current" | "proposed">("proposed");
  const cover = useProjectImage(project?.id ?? "", project?.cover ?? null, actions.imageVersion);
  const [document, setDocument] = useState<ProjectDocument | null>(null);
  // The copy is read again when the project was saved or a proposal of it changed state.
  const stamp = `${project?.id}:${project?.updated_ms}:${proposal?.proposalId}:${proposal?.state}`;
  useEffect(() => {
    setDocument(null);
    if (!storage || !project) return;
    let cancelled = false;
    void loadProject(storage, project.id).then((loaded) => { if (!cancelled) setDocument(loaded.document as ProjectDocument); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [storage, stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  const timeline = useMemo(() => (document ? lanesOf(document) : null), [document]);
  // The proposed project: the proposal's patch list over this device's copy; null when that copy is not its base.
  const proposed = useMemo(() => {
    if (!document || !proposal || !(proposal.state === "pending" || proposal.state === "applying")) return null;
    try { return acceptPatch(document, proposal.preview.patches as StatePatch); } catch { return null; }
  }, [document, proposal?.proposalId, proposal?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) return <EmptyState icon="film" title={t("No project in this session")} description={projectId ? t("The project of this session is not on this device.") : t("Start a session with a project selected on Home to see it here.")} />;
  // Before a proposal is applied the project still looks like "before"; afterwards like "after".
  const applied = proposal?.state === "accepted" || proposal?.state === "partially_accepted";
  const frame = frames ? (pending ? (side === "proposed" ? frames.after : frames.before) : applied && proposal?.revert?.state !== "reverted" ? frames.after : frames.before) : null;
  const picture = frame ? `data:${frame.mime};base64,${frame.dataBase64}` : cover;
  const outline = (id: string): ColorToken | null => !proposal ? null : proposal.elements.added.includes(id) ? "success" : proposal.elements.modified.includes(id) ? "accent" : proposal.elements.removed.includes(id) ? "danger" : null;
  const total = Math.max(timeline?.duration ?? 0, 1);
  const played = Platform.OS === "web" && storage && document ? (pending && side === "proposed" ? proposed : document) : null;
  return (
    <ScrollView testID="timeline-preview" contentContainerStyle={{ padding: space[3], gap: space[3] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
        <Text variant="body-medium" numberOfLines={1} style={{ flex: 1, minWidth: 120 }}>{project.name}</Text>
        <Text variant="meta" color="text/secondary">{durationBadge(project.duration)} · {relativeTime(project.updated_ms, Date.now(), theme.locale)}</Text>
        {pending && frames ? <Segmented size="sm" label={t("Which state to show")} options={[{ value: "current" as const, label: t("Current") }, { value: "proposed" as const, label: t("Proposed") }]} value={side} onChange={(value) => setSide(value as "current" | "proposed")} /> : null}
        <Button size="sm" icon="ext" label={t("Open in editor")} onPress={() => actions.open(project)} />
      </View>
      {played && storage ? (
        <View testID="timeline-preview-player" {...({ dataSet: { source: played === document ? "project" : "proposal" } } as object)}
          style={{ aspectRatio: 16 / 9, maxHeight: 460, alignSelf: "stretch", borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: theme.color("border/hairline") }}>
          <SessionPlayer storage={storage} projectId={project.id} document={played} onOpen={() => actions.open(project)} />
        </View>
      ) : <View testID="timeline-preview-picture" {...({ dataSet: { source: frame ? "proposal" : cover ? "project" : "none" } } as object)}
        style={{ aspectRatio: 16 / 9, maxHeight: 420, alignSelf: "stretch", borderRadius: radius.md, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: theme.color("bg/inset"), borderWidth: 1, borderColor: theme.color("border/hairline") }}>
        {picture ? <Image source={{ uri: picture }} accessibilityLabel={frame ? (pending && side === "proposed" ? t("After") : t("Before")) : project.name} resizeMode="contain" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, width: "100%", height: "100%" }} />
          : <View style={{ alignItems: "center", gap: space[2], padding: space[4] }}><Icon name="film" size={24} color="text/secondary" /><Text variant="meta" color="text/secondary" align="center">{t("No picture of this project yet. Open it in the editor to see it play.")}</Text></View>}
      </View>}
      {played ? (pending ? <Text variant="meta" color="text/secondary">{proposal!.title} · {t(played === document ? "Current" : "Proposed")}</Text> : null) : frame ? <Text variant="meta" color="text/secondary">{proposal!.title} · {t(pending ? (side === "proposed" ? "After · {time}" : "Before · {time}") : applied ? "After · {time}" : "Before · {time}", { time: clockOf(frame.time) ?? "" })}</Text> : null}
      {timeline && timeline.lanes.length ? (
        <View testID="timeline-preview-tracks" role="img" aria-label={t("Timeline of {project}", { project: project.name })} style={{ gap: 3, padding: space[2], borderRadius: radius.md, backgroundColor: theme.color("bg/inset"), borderWidth: 1, borderColor: theme.color("border/hairline") }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            {[0, 0.25, 0.5, 0.75, 1].map((at) => <Text key={at} variant="caption" color="text/tertiary" tabular>{clockOf(Math.round(total * at)) ?? ""}</Text>)}
          </View>
          {timeline.lanes.map((lane) => (
            <View key={lane.id} testID="timeline-preview-track" style={{ height: 22, borderRadius: radius.xs, backgroundColor: theme.color("bg/subtle"), overflow: "hidden" }}>
              {lane.bars.map((bar) => {
                const mark = outline(bar.id);
                return (
                  <View key={bar.id} testID="timeline-preview-clip" {...({ dataSet: { change: mark ?? "" } } as object)}
                    style={{ position: "absolute", top: 1, bottom: 1, left: `${(bar.start / total) * 100}%`, width: `${Math.max(0.6, (bar.duration / total) * 100)}%`, borderRadius: radius.xs, paddingHorizontal: 4, justifyContent: "center", backgroundColor: theme.color("bg/elevated"), borderWidth: mark ? 2 : 1, borderColor: theme.color(mark ?? "border/strong"), borderStartWidth: 3, borderStartColor: theme.color(mark ?? ZONE_COLOR[lane.zone] ?? "accent") }}>
                    <Text variant="caption" numberOfLines={1}>{bar.label}</Text>
                  </View>
                );
              })}
            </View>
          ))}
          {proposal && (proposal.elements.added.length || proposal.elements.modified.length || proposal.elements.removed.length) ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3], marginTop: space[1] }}>
              <Text variant="caption" color="success">{t("+{n} added", { n: proposal.elements.added.length })}</Text>
              <Text variant="caption" color="accent">{t("~{n} modified", { n: proposal.elements.modified.length })}</Text>
              <Text variant="caption" color="danger/text">{t("−{n} removed", { n: proposal.elements.removed.length })}</Text>
            </View>
          ) : null}
        </View>
      ) : timeline ? <Text variant="meta" color="text/secondary">{t("The timeline of this project is empty.")}</Text> : null}
    </ScrollView>
  );
}

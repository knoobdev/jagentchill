import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { film as fm } from "@jagentchill/editor-core";
import { Avatar, Button, Callout, EmptyState, IconButton, Input, NumberField, Segmented, Select, Tap, Text, Textarea, radius, space, useTheme } from "@jagentchill/ui";
import { useT } from "../locale";
import { ClipPreview } from "./ClipPreview";
import { Corner, Field, Picture, Pill, type PillTone } from "./parts";
import { failed, running, useAct, type StageProps } from "./stage";
import { MOTION_ROWS, SHOT_ROWS, TICKS, motionLabel, ratioOf, secondsOf, shotLabel } from "./strings";

const CARD = 184;
const stateOf = (panel: fm.Panel, busy: boolean): { tone: PillTone; label: string; id: string } =>
  busy ? { tone: "accent", label: "Generating", id: "running" } : panel.leftOut ? { tone: "neutral", label: "Left out", id: "left_out" }
  // A frame that could not be had says which of the two it is: the provider would not draw it, or what was drawn is not the frame.
  : !panel.picture.current && panel.refused ? (panel.refused.reason === "picture" ? { tone: "warning", label: "Not the frame", id: "refused" } : { tone: "warning", label: "Refused by the provider", id: "refused" })
  : !panel.picture.current ? { tone: "neutral", label: "No image", id: "empty" } : panel.picture.stale ? { tone: "purple", label: "Outdated", id: "stale" } : { tone: "success", label: "Ready", id: "ready" };

/** Storyboard: the panels of the film by clip, each with its still, and the strip of the selected panel where it is edited and its candidates are chosen. */
export function StoryboardStage(props: StageProps) {
  const t = useT(), theme = useTheme(), act = useAct();
  const { film, data } = props;
  const [view, setView] = useState<"cards" | "table">("cards");
  const [selected, setSelected] = useState<string | null>(null);
  const [closed, setClosed] = useState<string[]>([]);
  const counts = fm.counts(film), ordered = fm.orderedPanels(film), numberOf = new Map(ordered.map((panel, index) => [panel.id, index + 1]));
  const noImages = props.estimate?.capabilities.image === false;
  // Shots are set in motion only where the host's Video role has a model (Model routing): elsewhere a shot is its still and nothing about clips is shown.
  const video = props.estimate?.capabilities.video === true, moving = (panel: fm.Panel): boolean => panel.still !== true && !!fm.clipOf(panel);
  const withoutClip = video ? ordered.filter((panel) => !!panel.picture.current && !panel.picture.stale && panel.leftOut !== true && panel.still !== true && !fm.clipOf(panel)).length : 0;
  useEffect(() => { if (selected && !film.panels.some((panel) => panel.id === selected)) setSelected(null); }, [film.panels, selected]);
  if (!film.clips.length) return <EmptyState icon="grid" title={t("No panels yet")} description={t("Create the script from the story first")} actions={[{ label: t("Go to Story"), onPress: () => props.go("story") }]} />;
  const ratio = ratioOf(film.aspectRatio);
  const cast = (panel: fm.Panel) => panel.characterIds.map((id) => film.characters.find((entry) => entry.id === id)).filter((entry): entry is fm.Character => !!entry);
  const addPanel = (clipId: string) => void act(data.apply([{ op: "panel.add", clipId }]));
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space[4], gap: space[3] }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
        <Text testID="film-board-counts" style={{ flexGrow: 1 }}>
          <Text variant="body-medium">{counts.panels}</Text>{` ${t("panels")} · `}<Text variant="body-medium">{counts.panelsWithImage}</Text>{` ${t("with image")}`}
          {counts.panelsMissing ? <Text color="warning/text">{` · ${t("{n} without", { n: counts.panelsMissing })}`}</Text> : null}
          {counts.panelsStale ? <Text color="purple/text">{` · ${t("{n} outdated", { n: counts.panelsStale })}`}</Text> : null}
        </Text>
        <Segmented<"cards" | "table"> size="sm" label={t("View")} value={view} onChange={setView} options={[{ value: "cards", label: t("Cards"), icon: "grid", iconOnly: true }, { value: "table", label: t("Table"), icon: "list", iconOnly: true }]} />
        {props.mayRun ? <Button size="sm" icon="sparkles" label={t("Generate missing ({n})", { n: counts.panelsMissing })} testID="film-board-missing" disabled={!counts.panelsMissing || noImages} onPress={() => void act(data.generate({ kind: "panels", scope: "missing" }))} /> : null}
        {props.mayRun ? <Button size="sm" label={t("Generate all images")} testID="film-board-all" disabled={!counts.panels || noImages} onPress={() => void act(data.generate({ kind: "panels", scope: "all" }))} /> : null}
        {video && props.mayRun ? <Button size="sm" icon="play" label={t("Set shots in motion ({n})", { n: withoutClip })} testID="film-board-clips" disabled={!withoutClip} onPress={() => void act(data.generate({ kind: "clips", scope: "missing" }))} /> : null}
        <Button kind="strong" size="sm" icon="arrow-r" label={t("Continue to Voice")} testID="film-board-continue" onPress={() => props.go("voice")} />
      </View>
      {noImages ? <Callout tone="warning">{t("No way to obtain pictures: connect an image provider under Settings, Providers, Generation.")}</Callout> : null}
      {film.clips.map((clip, clipIndex) => {
        const panels = ordered.filter((panel) => panel.clipId === clip.id), open = !closed.includes(clip.id), missing = panels.filter((panel) => !panel.picture.current).length;
        const within = selected ? panels.find((panel) => panel.id === selected) : undefined;
        return (
          <View key={clip.id} testID={`film-clip-${clip.id}`} style={{ gap: space[2] }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
              <IconButton icon={open ? "chev-d" : "chev-r"} size="xs" label={(open ? t("Collapse clip") : t("Expand clip"))} expanded={open} onPress={() => setClosed(open ? [...closed, clip.id] : closed.filter((id) => id !== clip.id))} />
              <Text variant="body-medium" level={3}>{t("Clip {n}", { n: clipIndex + 1 })}</Text>
              <Text numberOfLines={1} style={{ flex: 1, minWidth: 80 }}>{clip.title}</Text>
              <Text variant="meta" color="text/secondary">{`${panels.length === 1 ? t("1 panel") : t("{n} panels", { n: panels.length })} · ${secondsOf(panels.reduce((sum, panel) => sum + panel.duration_ticks, 0))}`}</Text>
              <Pill tone={missing ? "warning" : panels.some((panel) => panel.picture.stale) ? "purple" : "success"} label={t(missing ? "Images missing" : panels.some((panel) => panel.picture.stale) ? "Outdated" : "Ready")} />
              {props.mayRun ? <Button kind="ghost" size="sm" label={t("Generate missing images")} testID={`film-clip-missing-${clip.id}`} disabled={!missing || noImages} onPress={() => void act(data.generate({ kind: "panels", scope: "missing", clipId: clip.id }))} /> : null}
              {props.mayEdit ? <IconButton icon="plus" size="xs" label={t("Add panel")} testID={`film-clip-add-${clip.id}`} onPress={() => addPanel(clip.id)} /> : null}
            </View>
            {!open ? null : !panels.length ? <Text color="text/secondary">{t("This clip has no panels.")}</Text> : view === "cards" ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
                {panels.map((panel) => {
                  const animating = running(data, `clip:${panel.id}`), busy = running(data, `panel:${panel.id}`) || animating, state = animating ? { tone: "accent" as const, label: "Setting in motion", id: "animating" } : stateOf(panel, busy), on = selected === panel.id;
                  return (
                    <View key={panel.id} testID={`film-panel-${panel.id}`} {...({ dataSet: { state: state.id, candidates: String(panel.picture.candidates.length), number: String(numberOf.get(panel.id)), clip: moving(panel) ? "1" : "0" } } as object)} style={{ width: theme.compact ? "100%" : CARD }}>
                    <Tap label={t("Panel {n}", { n: numberOf.get(panel.id)! })} selected={on} onPress={() => setSelected(on ? null : panel.id)}
                      style={{ borderWidth: on ? 2 : 1, borderColor: theme.color(on ? "accent" : "border/hairline"), borderRadius: radius.md, overflow: "hidden", backgroundColor: theme.color("bg/elevated") }}>
                      <Picture blobId={panel.picture.current?.media.blobId} ratio={ratio} busy={busy}><Corner label={String(numberOf.get(panel.id))} /><Corner end label={moving(panel) ? `▶ ${secondsOf(panel.duration_ticks)}` : secondsOf(panel.duration_ticks)} tone={moving(panel) ? "accent" : undefined} /></Picture>
                      <View style={{ padding: space[2], gap: space[1] }}>
                        <Text variant="meta" numberOfLines={1}><Text variant="meta">{t(shotLabel(panel.shotSize))}</Text><Text variant="meta" color="text/secondary">{` · ${t(motionLabel(panel.cameraMotion))}`}</Text></Text>
                        <Text variant="meta" color="text/secondary" numberOfLines={2} style={{ minHeight: 32 }}>{panel.action}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
                          <View style={{ flex: 1, flexDirection: "row", gap: 2 }}>{cast(panel).slice(0, 4).map((entry) => <Avatar key={entry.id} name={entry.name} id={entry.id} size={16} />)}</View>
                          <Pill tone={state.tone} label={t(state.label)} busy={busy} />
                        </View>
                      </View>
                    </Tap>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={{ borderWidth: 1, borderColor: theme.color("border/hairline"), borderRadius: radius.md, overflow: "hidden" }}>
                {panels.map((panel, at) => {
                  const busy = running(data, `panel:${panel.id}`), state = stateOf(panel, busy), on = selected === panel.id;
                  return (
                    <View key={panel.id} testID={`film-panel-${panel.id}`} {...({ dataSet: { state: state.id, number: String(numberOf.get(panel.id)) } } as object)}>
                    <Tap label={t("Panel {n}", { n: numberOf.get(panel.id)! })} selected={on} onPress={() => setSelected(on ? null : panel.id)}
                      style={{ flexDirection: "row", alignItems: "center", gap: space[2], padding: space[2], borderTopWidth: at ? 1 : 0, borderTopColor: theme.color("border/hairline"), backgroundColor: theme.color(on ? "accent/subtle" : "bg/elevated") }}>
                      <Text variant="meta" tabular style={{ width: 20 }}>{numberOf.get(panel.id)}</Text>
                      <Picture blobId={panel.picture.current?.media.blobId} ratio={ratio} busy={busy} height={36} />
                      <Text variant="meta" tabular style={{ width: 36 }}>{secondsOf(panel.duration_ticks)}</Text>
                      <Text variant="meta" style={{ width: 150 }} numberOfLines={1}>{`${t(shotLabel(panel.shotSize))} · ${t(motionLabel(panel.cameraMotion))}`}</Text>
                      <Text variant="meta" color="text/secondary" numberOfLines={1} style={{ flex: 1 }}>{panel.action}</Text>
                      <Pill tone={state.tone} label={t(state.label)} busy={busy} />
                    </Tap>
                    </View>
                  );
                })}
              </View>
            )}
            {open && within ? <PanelStrip key={within.id} {...props} panel={within} number={numberOf.get(within.id)!} ratio={ratio} siblings={panels} /> : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

/** The selected panel: its current image beside the candidates, the words it is drawn from, and what can be done with it. */
function PanelStrip(props: StageProps & { panel: fm.Panel; number: number; ratio: number; siblings: fm.Panel[] }) {
  const t = useT(), theme = useTheme(), act = useAct();
  const { data, film, panel } = props, key = `panel:${panel.id}`, busy = running(data, key), problem = failed(data, key);
  const [action, setAction] = useState(panel.action);
  const [prompt, setPrompt] = useState(panel.videoPrompt);
  useEffect(() => { setAction(panel.action); setPrompt(panel.videoPrompt); }, [panel.action, panel.videoPrompt]);
  const update = (fields: Record<string, unknown>) => void act(data.apply([{ op: "panel.update", id: panel.id, fields }]));
  const at = props.siblings.findIndex((entry) => entry.id === panel.id);
  const move = (index: number) => void act(data.apply([{ op: "panel.move", id: panel.id, clipId: panel.clipId, index }]));
  const toggle = (id: string) => update({ characterIds: panel.characterIds.includes(id) ? panel.characterIds.filter((other) => other !== id) : [...panel.characterIds, id] });
  const candidates = panel.picture.candidates;
  const draw = () => void act(data.generate({ kind: "panel", id: panel.id }));
  // What a model that can see said about the picture in use, when it said the picture is not this frame.
  const wrong = panel.picture.current?.check?.ok === false ? panel.picture.current.check : null;
  const waits = !busy && !panel.picture.current && !panel.leftOut ? panel.refused : undefined, noImages = props.estimate?.capabilities.image === false;
  return (
    <View testID="film-panel-strip" {...({ dataSet: { panel: panel.id } } as object)} style={{ padding: space[3], gap: space[3], borderWidth: 1, borderColor: theme.color("border/hairline"), borderRadius: radius.md, backgroundColor: theme.color("bg/subtle") }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
        <Text variant="body-medium">{candidates.length ? t("Panel {n} · candidates", { n: props.number }) : t("Panel {n}", { n: props.number })}</Text>
        <Text variant="meta" color="text/secondary" style={{ flex: 1, minWidth: 120 }}>{candidates.length ? t("The current image stays in use until you choose one.") : ""}</Text>
        {candidates.length ? <Text variant="meta" color="text/secondary">{candidates.length === 1 ? t("1 candidate") : t("{n} candidates", { n: candidates.length })}</Text> : null}
        {candidates.length && props.mayEdit ? <Button kind="ghost" size="sm" label={t("Dismiss all")} testID="film-panel-dismiss" onPress={() => void act(data.apply([{ op: "panel.dismiss", id: panel.id }]))} /> : null}
      </View>
      {waits ? (
        <View testID="film-panel-refused" {...({ dataSet: { reason: waits.reason === "picture" ? "picture" : "policy" } } as object)}>
          <Callout tone="warning" title={waits.reason === "picture" ? t("Not the frame") : t("Refused by the provider")}
            actions={[...(props.mayRun && !noImages ? [{ label: t("Draw again"), onPress: draw }] : []), ...(props.mayEdit ? [{ label: t("Leave this frame out"), onPress: () => void act(data.apply([{ op: "panel.leave", id: panel.id, leftOut: true }])) }] : [])]}>
            {waits.reason === "picture" ? `${t("Every drawing was looked at and none shows this frame. Choose one of the drawings, change the words, or draw again.")} ${waits.message}` : t("The provider's content rules do not allow this picture. Change the words, or draw again.")}
          </Callout>
        </View>
      ) : panel.leftOut ? (
        <View testID="film-panel-left-out"><Callout tone="info" actions={props.mayEdit ? [{ label: t("Put it back"), onPress: () => void act(data.apply([{ op: "panel.leave", id: panel.id, leftOut: false }])) }] : undefined}>{t("This frame is left out: the film is assembled without it.")}</Callout></View>
      ) : problem ? <View testID="film-panel-error"><Callout tone="danger">{problem}</Callout></View> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        <Picture blobId={panel.picture.current?.media.blobId} ratio={props.ratio} height={120} busy={busy && !panel.picture.current}>{panel.picture.current ? <Corner label={t("Current")} /> : null}</Picture>
        {candidates.map((candidate, index) => (
          <Picture key={candidate.id} blobId={candidate.media.blobId} ratio={props.ratio} height={120} testID={`film-candidate-${index + 1}`}>
            <Corner tone="accent" label={t("Candidate {n}", { n: index + 1 })} />
            {props.mayEdit ? <View style={{ position: "absolute", bottom: space[1], end: space[1] }}><Button size="xs" label={t("Use")} testID={`film-candidate-use-${index + 1}`} onPress={() => void act(data.apply([{ op: "panel.use", id: panel.id, versionId: candidate.id }]))} /></View> : null}
          </Picture>
        ))}
        {busy && panel.picture.current ? <Picture ratio={props.ratio} height={120} busy /> : null}
      </View>
      {/* A picture that was looked at and is not the frame says why, like a recording that is not its line. */}
      {wrong && !busy ? (
        <View testID="film-panel-check" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
          <Pill tone="warning" label={t("Not the frame")} testID="film-panel-check-reason" />
          <Text variant="meta" color="text/secondary" numberOfLines={3} style={{ flexShrink: 1 }} testID="film-panel-check-detail">{wrong.why}</Text>
          {props.mayRun ? <Button size="xs" icon="refresh" label={t("Draw again")} testID="film-panel-redraw" disabled={noImages} onPress={draw} /> : null}
        </View>
      ) : null}
      {candidates.map((candidate, index) => (candidate.check?.ok === false ? <Text key={candidate.id} variant="meta" color="text/secondary" numberOfLines={2} testID={`film-candidate-check-${index + 1}`}>{`${t("Candidate {n}", { n: index + 1 })} — ${t("Not the frame")}: ${candidate.check.why}`}</Text> : null))}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
        <Field label={t("What the picture shows")} grow><Textarea testID="film-panel-action" value={action} onChangeText={setAction} readOnly={!props.mayEdit} maxLength={fm.LIMITS.text} minLines={2} maxLines={5} onBlur={() => { if (action.trim() && action.trim() !== panel.action) update({ action }); }} /></Field>
        <Field label={t("Video prompt")} grow><Textarea testID="film-panel-prompt" value={prompt} onChangeText={setPrompt} readOnly={!props.mayEdit} maxLength={2000} minLines={2} maxLines={5} placeholder={t("How the still moves while it is on screen")} onBlur={() => { if (prompt.trim() !== panel.videoPrompt) update({ videoPrompt: prompt }); }} /></Field>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: space[3] }}>
        <Field label={t("Duration")}><View testID="film-panel-duration"><NumberField size="sm" width={92} label={t("Duration")} hideLabel unit="s" min={1} max={15} step={0.5} disabled={!props.mayEdit} value={panel.duration_ticks / TICKS} onCommit={(value) => update({ duration_ticks: Math.round(value * TICKS) })} /></View></Field>
        <Field label={t("Shot size")}><View testID="film-panel-size"><Select size="sm" width={168} label={t("Shot size")} disabled={!props.mayEdit} value={panel.shotSize} options={SHOT_ROWS.map((row) => ({ value: row.id, label: t(row.label) }))} onChange={(shotSize) => update({ shotSize })} /></View></Field>
        <Field label={t("Camera")}><View testID="film-panel-motion"><Select size="sm" width={140} label={t("Camera")} disabled={!props.mayEdit} value={panel.cameraMotion} options={MOTION_ROWS.map((row) => ({ value: row.id, label: t(row.label) }))} onChange={(cameraMotion) => update({ cameraMotion })} /></View></Field>
        {film.locations.length ? <Field label={t("Location")}><Select size="sm" width={180} label={t("Location")} disabled={!props.mayEdit} value={panel.locationId ?? "-"} options={[{ value: "-", label: t("None") }, ...film.locations.map((entry) => ({ value: entry.id, label: entry.name }))]} onChange={(locationId) => update({ locationId: locationId === "-" ? null : locationId })} /></Field> : null}
      </View>
      {film.characters.length || film.props.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[1] }}>
          <Text variant="meta" color="text/secondary">{t("In the picture")}</Text>
          {film.characters.map((entry) => <Tap key={entry.id} label={entry.name} role="checkbox" checked={panel.characterIds.includes(entry.id)} disabled={!props.mayEdit} onPress={() => toggle(entry.id)}
            style={{ flexDirection: "row", alignItems: "center", gap: space[1], height: 24, paddingHorizontal: space[2], borderRadius: radius.full, borderWidth: 1, borderColor: theme.color(panel.characterIds.includes(entry.id) ? "accent" : "border/control"), backgroundColor: theme.color(panel.characterIds.includes(entry.id) ? "accent/subtle" : "bg/elevated") }}>
            <Avatar name={entry.name} id={entry.id} size={16} /><Text variant="meta">{entry.name}</Text></Tap>)}
          {film.props.map((entry) => { const on = panel.propIds.includes(entry.id); return <Tap key={entry.id} label={entry.name} role="checkbox" checked={on} disabled={!props.mayEdit} onPress={() => update({ propIds: on ? panel.propIds.filter((other) => other !== entry.id) : [...panel.propIds, entry.id] })}
            style={{ height: 24, justifyContent: "center", paddingHorizontal: space[2], borderRadius: radius.full, borderWidth: 1, borderColor: theme.color(on ? "accent" : "border/control"), backgroundColor: theme.color(on ? "accent/subtle" : "bg/elevated") }}><Text variant="meta">{entry.name}</Text></Tap>; })}
        </View>
      ) : null}
      {props.estimate?.capabilities.video === true ? <PanelMotion {...props} /> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {props.mayRun ? <Button size="sm" icon="refresh" label={(panel.picture.current ? t("Regenerate") : t("Generate"))} testID="film-panel-generate" loading={busy} disabled={noImages} onPress={draw} /> : null}
        {props.mayEdit ? <>
          <Button size="sm" kind="ghost" icon="arrow-l" label={t("Move earlier")} testID="film-panel-earlier" disabled={at <= 0} onPress={() => move(at - 1)} />
          <Button size="sm" kind="ghost" icon="arrow-r" label={t("Move later")} testID="film-panel-later" disabled={at >= props.siblings.length - 1} onPress={() => move(at + 1)} />
          <Button size="sm" kind="ghost" icon="plus" label={t("Insert panel after")} onPress={() => void act(data.apply([{ op: "panel.add", clipId: panel.clipId, afterId: panel.id }]))} />
          <Button size="sm" kind="ghost" tone="danger" icon="trash" label={t("Delete panel")} testID="film-panel-delete" onPress={() => void act(data.apply([{ op: "panel.remove", id: panel.id }]))} />
        </> : null}
      </View>
    </View>
  );
}

/**
 * The motion of one shot, on a host whose Video role has a model: its clip (a video started from the frame's own
 * picture, so its people stay the same), made again or made for the first time, or kept a still by the person.
 */
function PanelMotion(props: StageProps & { panel: fm.Panel; ratio: number }) {
  const t = useT(), act = useAct();
  const { data, panel } = props, key = `clip:${panel.id}`, busy = running(data, key), problem = failed(data, key);
  const clip = fm.clipOf(panel), still = panel.still === true, picture = panel.picture.current && !panel.picture.stale ? panel.picture.current : null, outdated = !!panel.clip && !clip;
  return (
    <View testID="film-panel-motion-box" {...({ dataSet: { clip: clip ? "1" : "0", still: still ? "1" : "0", state: busy ? "running" : clip && !still ? "clip" : "still" } } as object)} style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
        <Text variant="body-medium">{t("Motion")}</Text>
        <Pill tone={busy ? "accent" : clip && !still ? "success" : "neutral"} busy={busy} label={busy ? t("Setting in motion") : clip && !still ? t("Video clip") : t("Still")} testID="film-panel-clip-state" />
        <Text variant="meta" color="text/secondary" style={{ flex: 1, minWidth: 160 }}>
          {still ? t("You keep this shot a still.") : clip ? t("The clip starts from this frame's picture and is used on the timeline.") : outdated ? t("The clip was made from another picture of this frame, so it is not used. Set the shot in motion again.") : picture ? t("This shot is a still. A clip is made from its picture, so the people stay the same.") : t("Draw the frame first: a clip starts from its picture.")}
        </Text>
      </View>
      {clip && !still ? <ClipPreview blobId={clip.media.blobId} stillBlobId={picture?.media.blobId} ratio={props.ratio} height={160} label={t("Video clip")} testID="film-panel-clip" /> : null}
      {problem ? <View testID="film-panel-clip-error"><Callout tone="danger">{problem}</Callout></View> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {props.mayRun && !still ? <Button size="sm" icon="play" label={clip ? t("Make the clip again") : t("Set this shot in motion")} testID="film-panel-clip-make" loading={busy} disabled={!picture} onPress={() => void act(data.generate({ kind: "clip", id: panel.id }))} /> : null}
        {props.mayEdit ? <Button size="sm" kind="ghost" label={still ? t("Use a clip for this shot") : t("Keep this shot a still")} testID="film-panel-clip-still" onPress={() => void act(data.apply([{ op: "panel.still", id: panel.id, still: !still }]))} /> : null}
      </View>
    </View>
  );
}

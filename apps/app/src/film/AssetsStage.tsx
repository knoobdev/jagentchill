import { useRef, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { film as fm } from "@jagentchill/editor-core";
import { Button, Callout, Chip, DestructiveConfirmDialog, EmptyState, FormDialog, IconButton, Input, Menu, SearchField, Select, Spinner, Tabs, Tap, Text, Textarea, radius, space, useTheme, type MenuItem } from "@jagentchill/ui";
import { useT } from "../locale";
import { Field, Picture, Pill } from "./parts";
import { failed, running, useAct, type StageProps } from "./stage";
import { ROLE_ROWS, roleLabel } from "./strings";

type Kind = fm.AssetKind;
type Draft = { kind: Kind; id: string | null; name: string; role: string; age: string; description: string; appearance: string; voiceId: string };
const SECTIONS: { kind: Kind; title: string; hint: string; width: number; add: string }[] = [
  { kind: "character", title: "Characters", hint: "Reference sheet 16:9 — face close-up left, front / side / back views right", width: 282, add: "Add character" },
  { kind: "location", title: "Locations", hint: "Plate 16:9, no people", width: 224, add: "Add location" },
  { kind: "prop", title: "Props", hint: "Sheet 1:1", width: 150, add: "Add prop" },
];
const ratio = (kind: Kind): number => (kind === "prop" ? 1 : 16 / 9);

/** Assets: the cast, the places and the props of the film with the reference picture every panel is drawn from. */
export function AssetsStage(props: StageProps) {
  const t = useT(), theme = useTheme(), act = useAct();
  const { film, data } = props;
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [gone, setGone] = useState<{ kind: Kind; asset: fm.Asset } | null>(null);
  const counts = fm.counts(film), voices = props.estimate?.voices ?? [];
  // Only a character who says something has a voice: one with no line is told so instead of being offered an empty voice field.
  const speaking = new Set(film.lines.map((line) => line.speakerId));
  const lists: Record<Kind, fm.Asset[]> = { character: film.characters, location: film.locations, prop: film.props };
  const usedIn = (kind: Kind, id: string): number => film.panels.filter((panel) => (kind === "character" ? panel.characterIds.includes(id) : kind === "location" ? panel.locationId === id : panel.propIds.includes(id))).length;
  const edit = (kind: Kind, asset?: fm.Asset) => setDraft({ kind, id: asset?.id ?? null, name: asset?.name ?? "", role: (asset as fm.Character | undefined)?.role ?? "supporting", age: (asset as fm.Character | undefined)?.age ?? "", description: asset?.description ?? "", appearance: asset?.appearance ?? "", voiceId: (asset as fm.Character | undefined)?.voiceId ?? "" });
  const submit = async () => {
    if (!draft) return;
    const fields = { name: draft.name, description: draft.description, appearance: draft.appearance, ...(draft.kind === "character" ? { role: draft.role as fm.Character["role"], age: draft.age, voiceId: draft.voiceId } : {}) };
    if (await act(data.apply([draft.id ? { op: "asset.update", kind: draft.kind, id: draft.id, fields } : { op: "asset.add", kind: draft.kind, fields }]))) setDraft(null);
  };
  if (!film.characters.length && !film.locations.length && !film.props.length && !film.panels.length) {
    return <EmptyState icon="user" title={t("No characters, locations or props yet")} description={t("Create the script from the story first, or add them yourself.")} actions={[{ label: t("Go to Story"), onPress: () => props.go("story") }, ...(props.mayEdit ? [{ label: t("Add character"), onPress: () => edit("character"), kind: "secondary" as const }] : [])]} />;
  }
  const shown = SECTIONS.filter((section) => filter === "all" || filter === section.kind);
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space[4], gap: space[4] }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
        <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
          <Tabs id="film-assets" variant="pill" size="sm" label={t("Assets")} value={filter} onChange={setFilter}
            items={[{ id: "all", label: t("All") }, { id: "character", label: t("Characters"), count: film.characters.length }, { id: "location", label: t("Locations"), count: film.locations.length }, { id: "prop", label: t("Props"), count: film.props.length }]} />
        </View>
        <View style={{ width: 200 }}><SearchField label={t("Search by name…")} placeholder={t("Search by name…")} size="sm" value={query} onChangeText={setQuery} debounce={0} /></View>
        {props.mayRun ? <Button kind="strong" size="sm" icon="sparkles" label={t("Generate missing ({n})", { n: counts.assetsMissing })} testID="film-assets-missing" disabled={!counts.assetsMissing || props.estimate?.capabilities.image === false} onPress={() => void act(data.generate({ kind: "assets", scope: "missing" }))} /> : null}
      </View>
      {props.estimate && !props.estimate.capabilities.image ? <Callout tone="warning">{t("No way to obtain pictures: connect an image provider under Settings, Providers, Generation.")}</Callout> : null}
      {((nodes: ReactNode[]) => (shown.length === 3 && !theme.compact ? <>{nodes[0]}<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: space[5] }}>{nodes[1]}{nodes[2]}</View></> : nodes))(shown.map((section) => {
        const rows = lists[section.kind].filter((asset) => asset.name.toLowerCase().includes(query.trim().toLowerCase()));
        return (
          <View key={section.kind} testID={`film-assets-${section.kind}`} style={[{ gap: space[2] }, shown.length === 3 && !theme.compact && section.kind !== "character" ? { flexShrink: 1, minWidth: 240 } : null]}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: space[2] }}>
              <Text variant="body-medium" level={3}>{t(section.title)}</Text>
              <Text variant="meta" color="text/secondary" style={{ flex: 1 }} numberOfLines={1}>{t(section.hint)}</Text>
              {props.mayEdit ? <IconButton icon="plus" size="xs" label={t(section.add)} testID={`film-asset-add-${section.kind}`} onPress={() => edit(section.kind)} /> : null}
            </View>
            {rows.length ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: space[3] }}>
                {rows.map((asset) => <AssetCard key={asset.id} {...props} kind={section.kind} asset={asset} width={theme.compact && section.kind !== "prop" ? undefined : section.width} used={usedIn(section.kind, asset.id)}
                  voice={voices.find((voice) => voice.voiceId === (asset as fm.Character).voiceId)?.name} silent={section.kind === "character" && !speaking.has(asset.id)} onEdit={() => edit(section.kind, asset)} onDelete={() => setGone({ kind: section.kind, asset })} />)}
              </View>
            ) : <Text color="text/secondary">{query ? t("No results") : t("None yet")}</Text>}
          </View>
        );
      }))}
      <FormDialog open={!!draft} title={draft ? t(draft.id ? "Edit" : SECTIONS.find((section) => section.kind === draft.kind)!.add) : ""} submitLabel={t(draft?.id ? "Save" : "Add")} dirty={!!draft?.name.trim()} canSubmit={!!draft?.name.trim()} onClose={() => setDraft(null)} onSubmit={() => void submit()}>
        {draft ? <View style={{ gap: space[3] }}>
          <Field label={t("Name")}><Input size="sm" testID="film-asset-name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} maxLength={fm.LIMITS.name} autoFocus /></Field>
          {draft.kind === "character" ? <View style={{ flexDirection: "row", gap: space[3] }}>
            <Field label={t("Role")} grow><Select size="sm" label={t("Role")} value={draft.role} options={ROLE_ROWS.map((row) => ({ value: row.id, label: t(row.label) }))} onChange={(role) => setDraft({ ...draft, role })} /></Field>
            <Field label={t("Age")} grow><Input size="sm" value={draft.age} onChangeText={(age) => setDraft({ ...draft, age })} maxLength={40} /></Field>
          </View> : null}
          <Field label={t("Description")}><Input size="sm" value={draft.description} onChangeText={(description) => setDraft({ ...draft, description })} maxLength={fm.LIMITS.text} placeholder={t("Who or what this is in the story")} /></Field>
          <Field label={t("Appearance — repeated in every picture")}><Textarea testID="film-asset-appearance" value={draft.appearance} onChangeText={(appearance) => setDraft({ ...draft, appearance })} maxLength={fm.LIMITS.text} minLines={3} maxLines={6} placeholder={t("Face, hair, build, clothes — what must look the same in every panel")} /></Field>
          {draft.kind === "character" && draft.id && !speaking.has(draft.id) ? <Field label={t("Voice")}><Text color="text/secondary" testID="film-asset-no-lines">{t("No lines — no voice")}</Text></Field>
          : draft.kind === "character" && voices.length ? <Field label={t("Voice")}><View testID="film-asset-voice"><Select size="sm" label={t("Voice")} value={draft.voiceId || "-"} options={[{ value: "-", label: t("No voice") }, ...voices.map((voice) => ({ value: voice.voiceId, label: voice.name }))]} onChange={(voiceId) => setDraft({ ...draft, voiceId: voiceId === "-" ? "" : voiceId })} /></View></Field> : null}
        </View> : null}
      </FormDialog>
      <DestructiveConfirmDialog open={!!gone} title={t("Delete {name}?", { name: gone?.asset.name ?? "" })} description={gone && usedIn(gone.kind, gone.asset.id) ? t("It is taken out of the {n} panels that show it.", { n: usedIn(gone.kind, gone.asset.id) }) : undefined} confirmLabel={t("Delete")} onClose={() => setGone(null)}
        onConfirm={() => { const target = gone!; setGone(null); void act(data.apply([{ op: "asset.remove", kind: target.kind, id: target.asset.id }])); }} />
    </ScrollView>
  );
}

function AssetCard(props: StageProps & { kind: Kind; asset: fm.Asset; width?: number; used: number; voice?: string; /** A character with no line in the film. */ silent?: boolean; onEdit(): void; onDelete(): void }) {
  const t = useT(), theme = useTheme(), act = useAct();
  const { data, kind, asset } = props, key = `${kind}:${asset.id}`, busy = running(data, key), problem = failed(data, key);
  // The provider would not draw this picture under its content policy: not an error to retry blindly — the words have to change.
  // The film itself holds the refusal (`asset.refused`), so it is still said after the host restarted; the last failure of this session says it too.
  const refused = !busy && !asset.picture.current && (!!asset.refused || (data.activity[key]?.state === "failed" && data.activity[key]?.code === "CONTENT_BLOCKED"));
  const [menu, setMenu] = useState(false);
  const anchor = useRef<View>(null);
  const character = kind === "character" ? (asset as fm.Character) : null, picture = asset.picture;
  const generate = () => void act(data.generate({ kind: "asset", assetKind: kind, id: asset.id }));
  const meta = character ? [t(roleLabel(character.role)), character.age, character.description].filter(Boolean).join(" · ") : asset.description;
  const items: MenuItem[] = [
    ...(props.mayEdit ? [{ id: "edit", label: t("Edit"), icon: "pencil" as const, onSelect: props.onEdit }] : []),
    ...(props.mayRun ? [{ id: "generate", label: (picture.current ? t("Regenerate") : t("Generate")), icon: "refresh" as const, disabled: busy, onSelect: generate }] : []),
    ...(props.mayEdit && character ? [{ id: "confirm", label: (character.confirmed ? t("Mark as not confirmed") : t("Confirm profile")), icon: "check" as const, onSelect: () => void act(data.apply([{ op: "asset.update", kind, id: asset.id, fields: { confirmed: !character.confirmed } }])) }] : []),
    ...(props.mayEdit ? [{ type: "separator" as const }, { id: "delete", label: t("Delete"), icon: "trash" as const, danger: true, onSelect: props.onDelete }] : []),
  ];
  let chips: ReactNode[] = [];
  if (character) chips = [props.silent ? <Chip key="voice" size="sm" dashed label={t("No lines — no voice")} /> : props.voice ? <Chip key="voice" size="sm" icon="voice" label={t("Voice: {name}", { name: props.voice })} /> : <Chip key="voice" size="sm" dashed label={t("No voice")} />, character.confirmed ? <Pill key="ok" tone="success" label={t("Confirmed")} /> : null];
  else if (props.used) chips = [<Chip key="used" size="sm" label={props.used === 1 ? t("Used in 1 panel") : t("Used in {n} panels", { n: props.used })} />];
  if (refused) chips.push(<Pill key="refused" tone="warning" label={t("Refused by the provider")} testID={`film-asset-refused-${asset.id}`} />);
  else if (!picture.current && !busy) chips.push(<Chip key="none" size="sm" dashed label={t("No image")} />);
  if (picture.stale) chips.push(<Pill key="stale" tone="purple" label={t("Outdated")} />);
  // What a model that can see said about the picture in use, when it is not what was asked.
  const wrong = !busy && picture.current?.check?.ok === false ? picture.current.check : null;
  return (
    <View testID={`film-asset-${asset.id}`} {...({ dataSet: { state: busy ? "running" : refused ? "refused" : picture.current ? (picture.stale ? "stale" : "ready") : "empty", candidates: String(picture.candidates.length) } } as object)}
      style={[{ borderWidth: 1, borderColor: theme.color("border/hairline"), borderRadius: radius.md, overflow: "hidden", backgroundColor: theme.color("bg/elevated") }, props.width ? { width: props.width } : { alignSelf: "stretch", width: "100%" }]}>
      <Picture blobId={picture.current?.media.blobId} ratio={ratio(kind)} busy={busy} testID={`film-asset-picture-${asset.id}`}>
        {busy ? <View style={{ position: "absolute", bottom: space[2], flexDirection: "row", alignItems: "center", gap: space[1], paddingHorizontal: space[2], height: 24, borderRadius: radius.sm, backgroundColor: theme.color("clip/label-scrim") }}><Text variant="meta" color="clip/label">{t("Generating")}</Text></View>
          : !picture.current && props.mayRun ? <IconButton icon="plus" variant="outline" label={t("Generate")} testID={`film-asset-generate-${asset.id}`} onPress={generate} /> : null}
      </Picture>
      <View style={{ padding: space[2], gap: space[1] }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text variant="body-medium" numberOfLines={1} style={{ flex: 1 }}>{asset.name}</Text>
          {items.length ? <IconButton ref={anchor} icon="more" size="xs" label={t("Options of {name}", { name: asset.name })} testID={`film-asset-menu-${asset.id}`} expanded={menu} onPress={() => setMenu(true)} /> : null}
        </View>
        <Text variant="meta" color="text/secondary" numberOfLines={2}>{meta || (picture.current ? "" : t("Not generated"))}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[1] }}>{chips}</View>
        {refused ? (
          <View style={{ gap: space[1] }}>
            <Text variant="meta" color="text/secondary" testID={`film-asset-error-${asset.id}`}>{t("The provider's content rules do not allow this picture. Change the description, or try again.")}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
              {props.mayEdit ? <Button size="xs" icon="pencil" label={t("Edit description")} testID={`film-asset-refused-edit-${asset.id}`} onPress={props.onEdit} /> : null}
              {props.mayRun ? <Button size="xs" icon="refresh" label={t("Try again")} testID={`film-asset-refused-retry-${asset.id}`} onPress={generate} /> : null}
            </View>
          </View>
        ) : problem ? <Text variant="meta" color="danger/text" testID={`film-asset-error-${asset.id}`}>{problem}</Text> : null}
        {wrong ? (
          <View testID={`film-asset-check-${asset.id}`} style={{ gap: space[1] }}>
            <View style={{ flexDirection: "row" }}><Pill tone="warning" label={t("Not the picture that was asked")} /></View>
            <Text variant="meta" color="text/secondary" numberOfLines={3}>{wrong.why}</Text>
            {props.mayRun ? <View style={{ flexDirection: "row" }}><Button size="xs" icon="refresh" label={t("Draw again")} testID={`film-asset-redraw-${asset.id}`} onPress={generate} /></View> : null}
          </View>
        ) : null}
      </View>
      {picture.candidates.length ? (
        <View testID={`film-asset-candidates-${asset.id}`} style={{ padding: space[2], gap: space[2], borderTopWidth: 1, borderTopColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/subtle") }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text variant="meta" style={{ flex: 1 }}>{picture.candidates.length === 1 ? t("1 new candidate") : t("{n} new candidates", { n: picture.candidates.length })}</Text>
            {props.mayEdit ? <Button kind="ghost" size="xs" label={t("Dismiss all")} onPress={() => void act(data.apply([{ op: "asset.dismiss", kind, id: asset.id }]))} /> : null}
          </View>
          <View style={{ flexDirection: "row", gap: space[1] }}>
            {picture.candidates.map((candidate) => (
              <View key={candidate.id} style={{ flex: 1, maxWidth: 96, gap: space[1] }}>
                <Picture blobId={candidate.media.blobId} ratio={ratio(kind)} />
                {props.mayEdit ? <Button size="xs" block label={t("Use")} testID={`film-asset-use-${asset.id}`} onPress={() => void act(data.apply([{ op: "asset.use", kind, id: asset.id, versionId: candidate.id }]))} /> : null}
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <Menu open={menu} anchor={anchor} items={items} label={t("Options of {name}", { name: asset.name })} onClose={() => setMenu(false)} />
    </View>
  );
}

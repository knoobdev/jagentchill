import { usePathname, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import { matchesQuery, relativeTime, rowMeta } from "@jagentchill/app-core";
import { Button, DestructiveConfirmDialog, EmptyState, IconButton, ListCaption, ListRow, Menu, SearchField, Skeleton, Tap, Text, compactListCardWidth, compactScale, radius, space, useTheme, useToast } from "@jagentchill/ui";
import { useHost } from "../host";
import { useT } from "../locale";
import { Screen, useHostScopeState } from "../shell/Screen";
import { useFilms, type FilmSummary } from "./data";
import { Picture, Pill } from "./parts";
import { filmRoute, runLabel, secondsOf, stageLabel } from "./strings";

/** Where a film is: what its pipeline is doing, else how far it has come. */
const stateOf = (film: FilmSummary): { label: string; tone: "warning" | "accent" | "success" | "danger" | "neutral" } =>
  // A film whose run waits for the person says so in the words of its own screen ("Needs you"), whatever it waits for.
  // (A film's run is paused only by the host, at a money question or a spending limit: it goes on when the person answers.)
  film.pipeline === "waiting_approval" || film.pipeline === "paused" ? { label: "Needs you", tone: "warning" } : film.pipeline === "running" || film.pipeline === "queued" || film.busy ? { label: "Generating", tone: "accent" } : film.pipeline === "failed" ? { label: "Failed", tone: "danger" }
    : film.assembled ? { label: "Assembled", tone: "success" } : film.panels ? { label: "Storyboard", tone: "neutral" } : { label: "Story", tone: "neutral" };

/** The film waits for the person: at a check of finished work, or held by the host at a money question or a spending limit. */
const waits = (film: FilmSummary): boolean => film.pipeline === "waiting_approval" || film.pipeline === "paused";

/** Creates a film and opens its Story stage. */
export function useNewFilm(): { busy: boolean; create(): Promise<void> } {
  const router = useRouter(), toast = useToast(), t = useT();
  const { host } = useHost();
  const films = useFilms(false);
  const [busy, setBusy] = useState(false);
  return { busy, async create() {
    if (!host || busy) return;
    setBusy(true);
    try { const film = await films.create({ title: t("Untitled film") }); router.push(filmRoute(host.gatewayId, film.id) as never); }
    catch (error) { toast.show({ kind: "error", message: (error as { message?: string }).message ?? t("The film could not be created") }); }
    finally { setBusy(false); }
  } };
}

/** Film Studio: the films of the host as cards, newest opened first. */
export function FilmListScreen() {
  const t = useT(), theme = useTheme(), router = useRouter(), toast = useToast();
  const viewport = useWindowDimensions();
  const { host, can } = useHost();
  const scope = useHostScopeState(t("Film Studio"));
  const films = useFilms(!scope), fresh = useNewFilm();
  const [query, setQuery] = useState("");
  const [gone, setGone] = useState<FilmSummary | null>(null);
  if (scope) return <Screen title={t("Film Studio")}>{scope}</Screen>;
  const mayEdit = can("jagentchill.projects.write"), rows = (films.films ?? []).filter((film) => matchesQuery(film.title, query));
  const create = mayEdit ? (theme.compact
    ? <IconButton icon="plus" label={t("New film")} testID="film-new" disabled={fresh.busy} onPress={() => void fresh.create()} />
    : <Button kind="strong" size="sm" icon="plus" label={t("New film")} testID="film-new" loading={fresh.busy} onPress={() => void fresh.create()} />) : null;
  return (
    <Screen title={t("Film Studio")} actions={create}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, padding: theme.compact ? compactScale.space.side : space[4], gap: theme.compact ? compactScale.space.gapMedium : space[3] }}>
        <View style={theme.compact ? undefined : { maxWidth: 320 }}><SearchField label={t("Search films")} placeholder={t("Search films")} size="sm" value={query} onChangeText={setQuery} debounce={0} style={theme.compact ? { width: "100%" } : undefined} /></View>
        {films.films === null ? <View style={{ paddingVertical: space[2], gap: space[2] }}>{films.error ? <EmptyState icon="warn" title={t("Unable to load the films")} description={films.error} actions={[{ label: t("Retry"), onPress: films.reload }]} /> : Array.from({ length: 4 }, (_, at) => <Skeleton key={at} height={56} />)}</View>
          : !films.films.length ? <EmptyState icon="film" title={t("No films yet")} description={t("A film starts from a story: its cast, storyboard, voices and timeline are made from it.")} />
            : !rows.length ? <Text color="text/secondary">{t("No results")}</Text> : (
              <View testID="film-grid" style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.compact ? compactScale.space.gapMedium : space[3] }}>
                {rows.map((film) => <FilmCard key={film.id} film={film} width={theme.compact ? compactListCardWidth(viewport.width) : 248} mayEdit={mayEdit} onOpen={() => router.push(filmRoute(host!.gatewayId, film.id) as never)} onDelete={() => setGone(film)} />)}
              </View>
            )}
      </ScrollView>
      <DestructiveConfirmDialog open={!!gone} title={t("Delete {name}?", { name: gone?.title ?? "" })} description={t("The film leaves Film Studio. Projects assembled from it stay in Projects.")} confirmLabel={t("Delete")} onClose={() => setGone(null)}
        onConfirm={() => { const target = gone!; setGone(null); void films.remove(target.id).then((result) => { if (!result.ok) toast.show({ kind: "error", message: result.message }); }); }} />
    </Screen>
  );
}

function FilmCard(props: { film: FilmSummary; width?: number; mayEdit: boolean; onOpen(): void; onDelete(): void }) {
  const t = useT(), theme = useTheme();
  const { film } = props, state = stateOf(film);
  const [menu, setMenu] = useState(false);
  const anchor = useRef<View>(null);
  return (
    <View testID="film-card" {...({ dataSet: { film: film.id, title: film.title } } as object)} style={[{ borderWidth: 1, borderColor: theme.color("border/hairline"), borderRadius: radius.md, overflow: "hidden", backgroundColor: theme.color("bg/elevated") }, props.width ? { width: props.width } : { width: "100%" }]}>
      <Tap label={film.title} onPress={props.onOpen}><Picture blobId={film.cover} ratio={16 / 9} /></Tap>
      <View style={{ padding: theme.compact ? compactScale.space.card : space[2], gap: space[1] }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text variant="body-medium" numberOfLines={1} style={{ flex: 1 }} onPress={props.onOpen}>{film.title}</Text>
          <IconButton ref={anchor} icon="more" size="xs" label={t("Options of {name}", { name: film.title })} expanded={menu} testID="film-card-menu" onPress={() => setMenu(true)} />
        </View>
        <Text variant="meta" color="text/secondary" numberOfLines={theme.compact ? undefined : 1}>{[film.panels === 1 ? t("1 panel") : t("{n} panels", { n: film.panels }), film.duration_ticks ? secondsOf(film.duration_ticks) : "", t("Opened {when}", { when: relativeTime(film.opened_ms, Date.now(), theme.locale) })].filter(Boolean).join(" · ")}</Text>
        <View style={{ flexDirection: "row" }}><Pill tone={state.tone} label={t(state.label)} /></View>
      </View>
      <Menu open={menu} anchor={anchor} label={t("Options of {name}", { name: film.title })} onClose={() => setMenu(false)}
        items={[{ id: "open", label: t("Open"), icon: "ext", onSelect: props.onOpen }, ...(props.mayEdit ? [{ type: "separator" as const }, { id: "delete", label: t("Delete"), icon: "trash" as const, danger: true, onSelect: props.onDelete }] : [])]} />
    </View>
  );
}

/** The sidebar's index of Film Studio: the films that need the person first, then the recent ones. */
export function FilmSidebarRows(props: { query: string; onNavigate?(): void }) {
  const t = useT(), theme = useTheme(), router = useRouter(), pathname = usePathname();
  const { host, status } = useHost();
  const films = useFilms(status === "connected" && !!host);
  const empty = (text: string) => <Text color="text/secondary" style={{ paddingVertical: space[2], paddingHorizontal: space[2] }}>{text}</Text>;
  if (status !== "connected" || !host) return empty(t("Requires a host"));
  if (films.films === null) return null;
  const rows = films.films.filter((film) => matchesQuery(film.title, props.query));
  if (!rows.length) return empty(props.query ? t("No results") : t("No films yet"));
  const now = Date.now();
  const row = (film: FilmSummary) => {
    const state = stateOf(film);
    const meta = rowMeta({ attention: waits(film) ? t(state.label) : undefined, running: state.tone === "accent" ? t(state.label) : undefined, failed: film.pipeline === "failed", ready: film.assembled ? t(state.label) : undefined, updated: relativeTime(film.opened_ms, now, theme.locale) });
    return <ListRow key={film.id} title={film.title} meta={meta.text} metaTone={meta.tone} testID="film-side-row" selected={pathname.includes(`/film/${film.id}`)} onPress={() => { router.push(filmRoute(host.gatewayId, film.id) as never); props.onNavigate?.(); }} />;
  };
  const waiting = rows.filter(waits), rest = rows.filter((film) => !waits(film));
  return <>{waiting.length ? <><ListCaption label={t("Needs you")} />{waiting.map(row)}</> : null}{rest.length ? <ListCaption label={t("Recent")} /> : null}{rest.slice(0, 30).map(row)}</>;
}

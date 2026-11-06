import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { ScrollView, View } from "react-native";
import { durationBadge } from "@jagentchill/app-core";
import { creditsText, licenceCheck, template } from "@jagentchill/editor-core";
import { MEDIA_MESSAGES } from "@jagentchill/media";
import type { ProjectDocument } from "@jagentchill/protocol";
import { Button, Checkbox, Chip, Icon, IconButton, Modal, SearchField, Tag, Text, Textarea, radius, space, useTheme, useToast } from "@jagentchill/ui";
import { useHost } from "../../host";
import { useLibraryImports } from "../../library/hooks";
import { itemBytes, itemFile, mimeOfFile, type LibraryItem } from "../../library/store";
import { useT } from "../../locale";
import { UrlImportDialog } from "../../media/MediaDialogs";
import { CHIP_LABELS, DOWN_LINES, MORE_MUSIC } from "../../music/notes";
import { cachedMusicSearch, openMusicStream, refreshMusicSearch, trackProvenance, type MusicStream, type ShelfAnswer, type ShelfTrack } from "../../music/remote";
import { bindDrag, openExternal, pickFiles } from "../../platform/store";
import { copyText, playSound, playStreamSound, type SoundPreview } from "../content-dom";
import { useEditor, useEditorVersion, useTransport } from "../context";
import { objectUrl, releaseUrl } from "../dom";

type Asset = ProjectDocument["media"]["assets"][number];
/** A sound of the project that came from the music catalogue says who made it and its licence — not "Your file". */
const bundledDetail = (asset: Asset): string | undefined => { const provenance = (asset as { provenance?: { source?: string; author?: string; licence?: string } }).provenance; return provenance?.source === "stock" || provenance?.source === "bundled" ? `${provenance.author ? `${provenance.author} · ` : ""}${provenance.licence ?? ""}` : undefined; };
/** A second is 120,000 ticks. */
const TICKS = 120_000;
/**
 * The Audio tab: the sounds of the project, each with a preview, its duration and "+" (or a drag) to put it on the
 * timeline; Import brings in more, and Licence check lists what the scene uses. One preview plays at a time, at the
 * master volume, and timeline playback stops it.
 */
export function AudioTab(props: { document: ProjectDocument; readOnly: boolean }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const runtime = useEditor();
  useEditorVersion();
  const transport = useTransport();
  const [query, setQuery] = useState("");
  const [playing, setPlaying] = useState<{ assetId: string; progress: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const musicStreams = useRef(new Map<string, Promise<Extract<MusicStream, { ok: true }>>>()).current;
  const musicPlayers = useRef(new Map<string, SoundPreview>()).current;
  const [checking, setChecking] = useState(false);
  const preview = useRef<SoundPreview | null>(null);
  const stop = () => { preview.current?.stop(); preview.current = null; setPlaying(null); };
  useEffect(() => { if (transport.playing) stop(); }, [transport.playing]);
  useEffect(() => () => { preview.current?.stop(); for (const pending of musicStreams.values()) void pending.then((stream) => stream.cancel()).catch(() => undefined); musicStreams.clear(); }, []);
  const needle = query.trim().toLowerCase();
  const sounds = props.document.media.assets.filter((asset) => asset.type === "audio" && !asset.ephemeral && (needle === "" || asset.name.toLowerCase().includes(needle)));
  // The sounds saved in the Library of this device that the project does not hold yet: "+" brings the file into the project and puts it on the timeline.
  const library = useLibraryImports("sounds");
  const shelved = library.items.filter((item) => (needle === "" || item.name.toLowerCase().includes(needle)) && !props.document.media.assets.some((asset) => (asset as { contentHash?: string | null }).contentHash === item.stored?.sha256));
  const shelf = useRef<{ id: string; url: string } | null>(null);
  const stopAll = () => { stop(); const held = shelf.current; shelf.current = null; if (held) releaseUrl(held.url); };
  useEffect(() => () => { if (shelf.current) releaseUrl(shelf.current.url); }, []);
  const addShelved = async (item: LibraryItem) => {
    const file = library.storage ? await itemFile(library.storage, item) : null;
    if (!file) { toast.show({ kind: "warning", message: t("Preview unavailable") }); return; }
    if (playing?.assetId === item.id) stopAll();
    const result = await runtime.media.importFiles([{ file }]);
    const ids = [...result.imported, ...result.reused].map((entry) => entry.assetId);
    if (ids.length > 0) runtime.addAssets(ids); else { const [head] = result.summary; if (head) toast.show({ kind: "warning", message: t(MEDIA_MESSAGES[head.code], head.params) }); }
  };
  const toggleShelved = async (item: LibraryItem) => {
    const wasPlaying = playing?.assetId === item.id;
    stopAll();
    if (wasPlaying || !library.storage || !item.stored) return;
    const fail = () => { setFailed(item.id); setTimeout(() => setFailed((current) => (current === item.id ? null : current)), 3000); };
    const bytes = await itemBytes(library.storage, item.stored).catch(() => undefined);
    if (!bytes) { fail(); return; }
    const url = objectUrl(bytes, item.stored.mime ?? mimeOfFile(item.stored.file));
    shelf.current = { id: item.id, url };
    runtime.pause();
    setPlaying({ assetId: item.id, progress: 0 });
    const volume = transport.volume.muted ? 0 : transport.volume.volume / 100;
    preview.current = playSound(url, volume, { onProgress: (progress) => setPlaying((current) => (current?.assetId === item.id ? { assetId: item.id, progress } : current)), onEnd: (bad) => { preview.current = null; if (shelf.current?.url === url) { shelf.current = null; releaseUrl(url); } setPlaying((current) => (current?.assetId === item.id ? null : current)); if (bad) fail(); } });
  };
  // — Music: a REMOTE catalogue, asked through the host. Nothing is shipped; the file of a track arrives when a person plays or adds THAT track. —
  const link = useHost();
  const [chip, setChip] = useState<string>("upbeat");
  const [shelfAnswer, setShelfAnswer] = useState<ShelfAnswer | null>(() => cachedMusicSearch(link.host?.gatewayId, { chip: "upbeat" }));
  const [refresh, setRefresh] = useState(0);
  const [fetching, setFetching] = useState<string | null>(null);
  /** The shelf shows its first rows; "Show more" the rest of the page the catalogue answered with. */
  const [wide, setWide] = useState(false);
  const SHELF_ROWS = 6;
  const connected = link.status === "connected" ? link.connection : undefined;
  useEffect(() => {
    // Keep this host/query's last successful rows visible while a refresh runs in the background.
    let cancelled = false;
    const params = { query: needle, chip };
    const cached = cachedMusicSearch(link.host?.gatewayId, params);
    setShelfAnswer(cached);
    const timer = setTimeout(() => {
      void refreshMusicSearch(connected, link.host?.gatewayId, params).then((answer) => { if (!cancelled && (answer.ok || !cached)) setShelfAnswer(answer); });
    }, needle ? 500 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [connected, link.host?.gatewayId, needle, chip, refresh]);
  // Another chip or other words: a preview of the rows that are leaving stops with them.
  const asked = useRef(0);
  useEffect(() => { asked.current++; stopAll(); for (const pending of musicStreams.values()) void pending.then((stream) => stream.cancel()).catch(() => undefined); musicStreams.clear(); musicPlayers.clear(); }, [needle, chip]);
  const music = shelfAnswer?.ok ? shelfAnswer.tracks.filter((track) => !props.document.media.assets.some((asset) => { const from = (asset as { provenance?: { source?: string; itemId?: string } }).provenance; return from?.source === "stock" && from.itemId === track.id; })) : [];
  const chips = shelfAnswer?.chips ?? Object.keys(CHIP_LABELS);
  const streamFor = async (track: ShelfTrack): Promise<Extract<MusicStream, { ok: true }> | null> => {
    let pending = musicStreams.get(track.id);
    if (!pending) {
      pending = openMusicStream({ connection: connected, host: link.host }, track.id, undefined, track).then((got) => {
        if (!got.ok) { toast.show({ kind: "warning", message: t(DOWN_LINES[got.reason]) }); throw new Error(got.message); }
        void got.file.catch(() => undefined);
        return got;
      });
      musicStreams.set(track.id, pending);
      void pending.catch(() => { if (musicStreams.get(track.id) === pending) musicStreams.delete(track.id); });
    }
    return pending.catch(() => null);
  };
  const musicFile = async (track: ShelfTrack): Promise<File | null> => {
    setFetching(track.id);
    try { const got = await streamFor(track); return got ? await got.complete() : null; }
    finally { setFetching((current) => (current === track.id ? null : current)); }
  };
  const addMusic = async (track: ShelfTrack) => {
    const file = await musicFile(track);
    if (!file) return;
    if (playing?.assetId === track.id) stopAll();
    // The licence and the credit line of the track are stored on the sound (Licence check, "Copy credits").
    const result = await runtime.media.importFiles([{ file }], { provenance: trackProvenance(track) as never });
    musicStreams.delete(track.id);
    musicPlayers.delete(track.id);
    const ids = [...result.imported, ...result.reused].map((entry) => entry.assetId);
    if (ids.length > 0) runtime.addAssets(ids); else { const [head] = result.summary; if (head) toast.show({ kind: "warning", message: t(MEDIA_MESSAGES[head.code], head.params) }); }
  };
  const toggleMusic = async (track: ShelfTrack) => {
    const wasPlaying = playing?.assetId === track.id;
    if (wasPlaying) { preview.current?.stop(); preview.current = null; setPlaying(null); return; }
    const existing = musicPlayers.get(track.id);
    if (existing) {
      stopAll();
      runtime.pause();
      existing.play?.();
      preview.current = existing;
      setPlaying({ assetId: track.id, progress: 0 });
      return;
    }
    stopAll();
    const fail = () => { setFailed(track.id); setTimeout(() => setFailed((current) => (current === track.id ? null : current)), 3000); };
    const mine = ++asked.current;
    setFetching(track.id);
    const stream = await streamFor(track);
    // Another row was asked for, or the rows changed, while the file was on its way: this one is not played.
    if (mine !== asked.current) { stream?.cancel(); setFetching((current) => (current === track.id ? null : current)); return; }
    if (!stream) { setFetching((current) => (current === track.id ? null : current)); fail(); return; }
    // Played from a progressive stream; the same in-memory bytes can be reused if the person presses "+".
    runtime.pause();
    setPlaying({ assetId: track.id, progress: 0 });
    const volume = transport.volume.muted ? 0 : transport.volume.volume / 100;
    // Start consuming the stream now; its first byte resolves as the MediaSource appends it. Keep the row's
    // "Getting the track…" line until then, without waiting here and deadlocking the consumer.
    preview.current = playStreamSound(stream.body, stream.mime, volume, { onProgress: (progress) => setPlaying((current) => (current?.assetId === track.id ? { assetId: track.id, progress } : current)), onEnd: (bad) => { if (bad) { musicPlayers.delete(track.id); preview.current = null; } setPlaying((current) => (current?.assetId === track.id ? null : current)); if (bad) fail(); } });
    musicPlayers.set(track.id, preview.current);
    void stream.firstByte.then(() => setFetching((current) => (current === track.id ? null : current)), () => setFetching((current) => (current === track.id ? null : current)));
  };
  // — More music: the person's own route to sources whose licence is for THEIR videos; the file comes back through the ordinary import. —
  const [ncs, setNcs] = useState(false);
  const [ncsCreditText, setNcsCreditText] = useState("");
  const [linking, setLinking] = useState(false);
  const pastedCredit = ncs ? ncsCreditText.trim().slice(0, 1000) : "";
  const importAudio = async () => {
    const files = await pickFiles("audio/*", true);
    if (files.length === 0) return;
    // "This is an NCS track" with its pasted credit: the credit is stored on the sounds brought in now. (A file NAMED as an NCS release gets NCS's credit form by itself.)
    const result = await runtime.media.importFiles(files.map((file) => ({ file })), pastedCredit ? { provenance: { source: "imported", credit: pastedCredit, attributionRequired: true } as never } : {});
    const [head] = result.summary;
    if (head) toast.show({ kind: result.imported.length ? "success" : "warning", message: t(MEDIA_MESSAGES[head.code], head.params) });
    if (pastedCredit && result.imported.length) { setNcs(false); setNcsCreditText(""); }
  };
  const toggle = async (asset: Asset) => {
    const wasPlaying = playing?.assetId === asset.id;
    stopAll();
    if (wasPlaying) return;
    const url = await runtime.media.mediaUrl(asset.id).catch(() => null);
    const fail = () => { setFailed(asset.id); setTimeout(() => setFailed((current) => (current === asset.id ? null : current)), 3000); };
    if (!url) { fail(); return; }
    runtime.pause();
    setPlaying({ assetId: asset.id, progress: 0 });
    const volume = transport.volume.muted ? 0 : transport.volume.volume / 100;
    preview.current = playSound(url, volume, { onProgress: (progress) => setPlaying((current) => (current?.assetId === asset.id ? { assetId: asset.id, progress } : current)), onEnd: (bad) => { preview.current = null; setPlaying((current) => (current?.assetId === asset.id ? null : current)); if (bad) fail(); } });
  };
  return (
    <View testID="audio-tab" style={{ flex: 1, minHeight: 0 }}>
      <View style={{ padding: space[2], paddingHorizontal: space[3], gap: space[2] }}>
        <SearchField label={t("Search sounds")} placeholder={t("Search sounds...")} size="sm" value={query} onChangeText={setQuery} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{t("My music")}</Text>
          <Button kind="ghost" size="xs" label={t("Licence check")} testID="audio-licence" onPress={() => setChecking(true)} />
          <Button kind="strong" size="xs" icon="plus" label={t("Import")} disabled={props.readOnly} testID="audio-import" onPress={() => void importAudio()} />
        </View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space[2], paddingBottom: space[3], gap: 2 }}>
        {sounds.length + shelved.length === 0 ? <View style={{ padding: space[3], alignItems: "center", gap: space[1] }}><Icon name="music" size={24} color="text/secondary" /><Text variant="meta" color="text/secondary" align="center" testID="audio-empty">{needle ? t("No sounds found for \"{query}\"", { query: query.trim() }) : t("No audio in this project yet")}</Text></View> : null}
        {sounds.map((asset) => <SoundRow key={asset.id} asset={asset} detail={bundledDetail(asset)} readOnly={props.readOnly} playing={playing?.assetId === asset.id ? playing.progress : null} failed={failed === asset.id} onToggle={() => void toggle(asset)} onAdd={() => runtime.addAssets([asset.id])} />)}
        {shelved.map((item) => <SoundRow key={item.id} asset={{ id: item.id, name: item.name }} origin="Library" readOnly={props.readOnly} playing={playing?.assetId === item.id ? playing.progress : null} failed={failed === item.id} onToggle={() => void toggleShelved(item)} onAdd={() => void addShelved(item)} />)}
        <View testID="audio-music" {...({ dataSet: { chip, count: String(music.length), state: shelfAnswer === null ? "loading" : shelfAnswer.ok ? "ready" : shelfAnswer.reason, provider: shelfAnswer?.provider?.id ?? "" } } as object)} style={{ gap: 2, marginTop: space[2] }}>
          <View style={{ paddingHorizontal: space[1], gap: space[1] }}>
            <Text variant="meta" color="text/secondary">{t("Music")}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
              {chips.map((entry) => <View key={entry} testID={`audio-mood-${entry}`}><Chip size="sm" label={t(CHIP_LABELS[entry] ?? entry)} selected={!needle && chip === entry} onPress={() => { setQuery(""); setChip(entry); }} /></View>)}
            </View>
          </View>
          {shelfAnswer === null ? <Text variant="meta" color="text/secondary" align="center" testID="audio-music-loading" style={{ padding: space[2] }}>{t("Loading music…")}</Text>
            : !shelfAnswer.ok ? <View style={{ padding: space[2], gap: space[1] }}><Text variant="meta" color="text/secondary" testID="audio-music-down">{t(DOWN_LINES[shelfAnswer.reason])}</Text>{shelfAnswer.reason === "no_host" ? <Button kind="primary" size="sm" label={t("Connect a host")} testID="audio-music-connect" onPress={() => router.push("/pair/start" as never)} /> : null}{shelfAnswer.reason !== "no_host" ? <Button kind="secondary" size="sm" label={t("Retry")} testID="audio-music-retry" onPress={() => setRefresh((value) => value + 1)} /> : null}</View>
            : music.length === 0 ? <Text variant="meta" color="text/secondary" align="center" testID="audio-music-empty" style={{ padding: space[2] }}>{t("No music matches")}</Text> : null}
          {(wide ? music : music.slice(0, SHELF_ROWS)).map((track) => <SoundRow key={track.id} asset={{ id: track.id, name: track.title, duration: Math.round(track.seconds * TICKS) }} origin="Music" shelf detail={`${track.author || t("Unknown author")} · ${track.licence}`} busy={fetching === track.id} readOnly={props.readOnly} playing={playing?.assetId === track.id ? playing.progress : null} failed={failed === track.id} onToggle={() => void toggleMusic(track)} onAdd={() => void addMusic(track)} />)}
          {music.length > SHELF_ROWS ? <View style={{ alignItems: "flex-start", paddingHorizontal: space[1] }}><Button kind="link" size="xs" label={wide ? t("Show fewer") : t("Show more")} testID="audio-music-more" onPress={() => setWide(!wide)} /></View> : null}
          {shelfAnswer?.ok ? <Text variant="meta" color="text/tertiary" testID="audio-music-notice" style={{ paddingHorizontal: space[1] }}>{t("Free to use, also commercially (CC0 or CC BY). A CC BY track needs its credit: it is kept with the track and offered as \"Copy credits\".")} {shelfAnswer.provider.id === "openverse" ? t("Made using Openverse — not endorsed or certified by Openverse.") : shelfAnswer.provider.notice}</Text> : null}
        </View>
        <View testID="audio-more-music" style={{ gap: space[1], marginTop: space[3], paddingHorizontal: space[1] }}>
          <Text variant="meta" color="text/secondary">{t("More music")}</Text>
          {MORE_MUSIC.map((source) => (
            <View key={source.id} testID={`more-music-${source.id}`} style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
              <Text variant="meta" style={{ flex: 1 }}>{t(source.line)}</Text>
              <View testID={`more-music-open-${source.id}`} {...({ dataSet: { url: source.url } } as object)}><Button kind="link" size="xs" trailingIcon="ext" label={t("Open {name}", { name: source.name })} onPress={() => openExternal(source.url)} /></View>
            </View>
          ))}
          <Text variant="meta" color="text/tertiary">{t("Download the track in your browser, then bring the file in with Import — or paste a direct link to the file.")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
            <Button kind="secondary" size="xs" icon="plus" label={t("Import")} disabled={props.readOnly} testID="more-music-import" onPress={() => void importAudio()} />
            <Button kind="ghost" size="xs" icon="link" label={t("Import from a link")} disabled={props.readOnly} testID="more-music-link" onPress={() => setLinking(true)} />
          </View>
          <View testID="more-music-is-ncs"><Checkbox label={t("This is an NCS track")} checked={ncs} onChange={setNcs} /></View>
          {ncs ? <Textarea accessibilityLabel={t("Credit from the NCS page")} placeholder={t("Paste the credit from the track\u2019s NCS page")} value={ncsCreditText} onChangeText={setNcsCreditText} minLines={3} maxLines={6} testID="more-music-credit" /> : null}
        </View>
      </ScrollView>
      {linking ? <UrlImportDialog session={{ ...runtime.media, importUrl: (raw: string, options?: Parameters<typeof runtime.media.importUrl>[1]) => runtime.media.importUrl(raw, { ...options, ...(pastedCredit ? { credit: pastedCredit } : {}) }) } as never} onClose={() => setLinking(false)} onDone={(result) => { const [head] = result.summary; if (head) toast.show({ kind: result.imported.length ? "success" : "warning", message: t(MEDIA_MESSAGES[head.code], head.params) }); if (pastedCredit && result.imported.length) { setNcs(false); setNcsCreditText(""); } }} /> : null}
      {checking ? <LicenceCheck document={props.document} sceneId={runtime.controller.session.sceneId} onClose={() => setChecking(false)} /> : null}
    </View>
  );
}

function SoundRow(props: { asset: Pick<Asset, "id" | "name"> & { duration?: number }; /** Where a sound that is not in the project yet comes from; such a row is not dragged. */ origin?: string; /** A bundled track: who made it and its licence, shown as they are. */ detail?: string; /** A row of the Music shelf (a track the project does not hold yet). */ shelf?: boolean; /** Its file is being fetched. */ busy?: boolean; readOnly: boolean; playing: number | null; failed: boolean; onToggle(): void; onAdd(): void }) {
  const t = useT();
  const theme = useTheme();
  const node = useRef<View>(null);
  const { asset } = props;
  useEffect(() => (props.readOnly || props.origin ? undefined : bindDrag(node.current, () => JSON.stringify({ media: { assetIds: [asset.id], folderIds: [] } }))), [asset.id, props.readOnly, props.origin]);
  return (
    <View ref={node} testID={props.shelf ? "audio-music-row" : props.origin ? "audio-library-row" : "audio-row"} {...(props.shelf ? ({ dataSet: { track: asset.id } } as object) : {})} style={{ flexDirection: "row", alignItems: "center", gap: space[2], height: 40, paddingHorizontal: space[1], borderRadius: radius.sm }}>
      <IconButton icon={props.playing === null ? "play" : "pause"} size="sm" variant="outline" label={t(props.playing === null ? "Play {name}" : "Pause {name}", { name: asset.name })} testID="audio-preview" on={props.playing !== null} toggle onPress={props.onToggle} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1}>{asset.name}</Text>
        {props.failed ? <Text variant="meta" color="danger/text" testID="audio-preview-failed">{t("Preview unavailable")}</Text>
          : props.busy ? <Text variant="meta" color="text/secondary" numberOfLines={1} testID="audio-music-fetching">{t("Getting the track…")}</Text>
          : props.playing !== null ? <View style={{ height: 2, borderRadius: 1, backgroundColor: theme.color("border/hairline") }}><View style={{ height: 2, borderRadius: 1, width: `${Math.round(props.playing * 100)}%`, backgroundColor: theme.color("accent/text") }} /></View>
          : <Text variant="meta" color="text/secondary" numberOfLines={1}>{props.detail ?? t(props.origin ?? "Your file")}</Text>}
      </View>
      {props.origin && !props.shelf ? null : <Text variant="meta" color="text/secondary" tabular>{durationBadge(asset.duration ?? 0)}</Text>}
      <IconButton icon="plus" size="xs" label={t("Add to timeline")} disabled={props.readOnly || props.busy} testID="audio-add" onPress={props.onAdd} />
    </View>
  );
}

/** "Licence check": every audio source of the scene with its origin and licence, read from project data; nothing is uploaded or analysed. */
function LicenceCheck(props: { document: ProjectDocument; sceneId: string; onClose(): void }) {
  const t = useT();
  const toast = useToast();
  const rows = licenceCheck(props.document, props.sceneId), credits = creditsText(rows);
  return (
    <Modal title={t("Licence check")} width={480} onClose={props.onClose}
      footer={<><View style={{ flex: 1 }} /><Button size="sm" label={t("Copy credits")} disabled={credits === ""} testID="licence-copy" onPress={() => void copyText(credits).then((done) => toast.show({ kind: done ? "success" : "warning", message: t(done ? "Credits copied" : "Couldn't copy the credits") }))} /><Button size="sm" kind="primary" label={t("Done")} onPress={props.onClose} /></>}>
      <View testID="licence-check" style={{ gap: space[2] }}>
        {rows.length === 0 ? <Text color="text/secondary">{t("This scene has no audio")}</Text> : null}
        {rows.map((row) => (
          <View key={row.assetId} testID="licence-row" {...({ dataSet: { origin: row.origin, credit: row.credit ? "yes" : "no" } } as object)} style={{ gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><Text numberOfLines={1} style={{ flex: 1 }}>{row.name}</Text>{row.flag ? <Tag label={t(row.flag)} /> : null}</View>
            <Text variant="meta" color="text/secondary">{row.author ? `${row.author} · ${t(row.licence)}` : t(row.licence)}</Text>
            {row.credit ? <Text variant="meta" color="text/tertiary" selectable testID="licence-credit">{row.credit}</Text> : null}
          </View>
        ))}
        <Text variant="meta" color="text/secondary">{t("This list comes from the project's own data. JAgentChill does not detect copyrighted music by its content.")}</Text>
      </View>
    </Modal>
  );
}

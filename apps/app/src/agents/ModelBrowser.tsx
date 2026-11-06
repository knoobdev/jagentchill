import { useRouter } from "expo-router";
import { useEffect, useMemo, useState, type RefObject } from "react";
import { ScrollView, View } from "react-native";
import {
  ACCESS_METHOD_LABEL, ACCESS_METHODS, AGENT_PREFS, blockedReason, browserRows, contextLabel, findModel, initialView, modelBadges, refKey, rowModels, sameRef, searchModels, toggleFavourite,
  type BrowserGroup, type BrowserModel, type BrowserRow, type ModelCatalogue,
} from "@jagentchill/app-core";
import type { ModelRef } from "@jagentchill/protocol";
import { Button, Callout, Chip, Icon, IconButton, ListCaption, Popover, SearchField, Spinner, Tap, Text, radius, space, useTheme, SkeletonList, inlineIcon } from "@jagentchill/ui";
import { useHost } from "../host";
import { useT } from "../locale";
import { usePref } from "../state";
import { useAgentData } from "./data";
import { reasonOf } from "./errors";

export const hostSettingsRoute = (hostId: string, section: string, item?: string) => `/settings/host/${hostId}/${section}${item ? `/${item}` : ""}`;

/**
 * The model browser: the models of every agent CLI on the host, each with its own sign-in, in one list. "All" searches every runtime at once and holds Favorites and Recent; a row drills
 * into one runtime-and-provider group.
 */
export function ModelBrowser(props: { open: boolean; onClose(): void; anchor: RefObject<View | null>; current: ModelRef | null; onSelect(model: BrowserModel, group: BrowserGroup): void; catalogue: ModelCatalogue | null;
  /** A draft may leave the choice to the host's routing: the row that says which model the Director route gives. */
  routing?: { model: string; active: boolean; onSelect(): void } }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const { host, role } = useHost();
  const data = useAgentData();
  const [favourites, setFavourites] = usePref(AGENT_PREFS.modelFavourites);
  const [recents] = usePref(AGENT_PREFS.modelRecents);
  const [view, setView] = useState<{ view: "all" } | { view: "group"; rowId: string; back: boolean }>({ view: "all" });
  const [query, setQuery] = useState("");
  const catalogue = props.catalogue;
  const rows = useMemo(() => (catalogue ? browserRows(catalogue) : []), [catalogue]);
  const device = role ?? "viewer";
  // The view is chosen when the browser opens; a runtime that is not ready is asked again once.
  useEffect(() => {
    if (!props.open) return;
    setQuery("");
    setView(props.routing?.active ? { view: "all" } : initialView(rows, props.current, favourites));
    const group = catalogue?.groups.find((entry) => entry.runtimeId === props.current?.runtimeId);
    if (group && group.readiness !== "ready" && group.readiness !== "loading") void data.retry([group.runtimeId]);
  }, [props.open]); // eslint-disable-line react-hooks/exhaustive-deps
  const starred = (ref: ModelRef) => favourites.some((entry) => sameRef(entry, ref));
  const row = view.view === "group" ? rows.find((entry) => entry.id === view.rowId) : undefined;
  const openSettings = (tab: string) => { if (host) { props.onClose(); router.push(hostSettingsRoute(host.gatewayId, "runtimes", tab) as never); } };

  const modelRow = (model: BrowserModel, group: BrowserGroup, withGroup: boolean) => {
    const blocked = catalogue ? blockedReason(group, model, catalogue.policy, device) : null;
    const selected = sameRef(model.ref, props.current);
    const detail = [withGroup ? group.label : null, contextLabel(model.contextWindow), blocked ? t(blocked.text) : model.readiness === "cooldown" ? t("Rate limited") : null].filter(Boolean).join(" · ");
    return (
      <View key={refKey(model.ref)} style={{ flexDirection: "row", alignItems: "center" }}>
        <Tap role="option" label={model.label} selected={selected} disabled={!!blocked} testID={`model-${refKey(model.ref)}`} onPress={() => { props.onSelect(model, group); props.onClose(); }}
          style={(state) => ({ flex: 1, minWidth: 0, minHeight: 40, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[2], paddingVertical: space[1], borderRadius: radius.sm, opacity: blocked ? 0.55 : 1, backgroundColor: selected ? theme.color("bg/subtle") : state.hovered || state.pressed ? theme.color("bg/hover") : "transparent" })}>
          <View style={{ width: 16 }}>{selected ? <Icon name="check" size={16} color="accent" label={t("Selected")} /> : null}</View>
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}>
              <Text variant={selected ? "body-medium" : "body"} numberOfLines={1} style={{ flexShrink: 1 }}>{model.label}</Text>
              {model.isDefault ? <Chip size="sm" label={t("Default")} /> : null}
            </View>
            <Text variant="meta" color={blocked ? "warning/text" : "text/secondary"} numberOfLines={1}>{[detail, ...(blocked ? [] : modelBadges(model).map((badge) => t(badge)))].filter(Boolean).join(" · ")}</Text>
          </View>
        </Tap>
        <IconButton icon="star" size="xs" label={starred(model.ref) ? t("Remove {model} from favorites", { model: model.label }) : t("Add {model} to favorites", { model: model.label })} on={starred(model.ref)} toggle tone={starred(model.ref) ? "accent" : undefined}
          onPress={() => setFavourites(toggleFavourite(favourites, model.ref))} />
      </View>
    );
  };
  const groupRow = (entry: BrowserRow) => {
    const blocked = catalogue ? blockedReason(entry.group, null, catalogue.policy, device) : null;
    const retrying = data.retrying.includes(entry.group.runtimeId);
    const state = entry.group.readiness === "loading" || retrying ? "loading" : entry.group.readiness === "error" ? "error" : "ready";
    const meta = [entry.subtitle, state === "ready" && entry.count ? (entry.count === 1 ? t("1 model") : t("{n} models", { n: entry.count })) : null, state === "ready" && blocked ? t(blocked.text) : null].filter(Boolean).join(" · ");
    return (
      <View key={entry.id} style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
        <Tap role="button" label={`${entry.title} ${entry.subtitle}`} testID={`model-group-${entry.id}`} onPress={() => { setQuery(""); setView({ view: "group", rowId: entry.id, back: true }); }}
          style={(interaction) => ({ flex: 1, minWidth: 0, minHeight: 40, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[2], paddingVertical: space[1], borderRadius: radius.sm, backgroundColor: interaction.hovered || interaction.pressed ? theme.color("bg/hover") : "transparent" })}>
          <Icon name={entry.method === "cli" ? "kbd" : "link"} size={16} color="text/secondary" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1}>{entry.title}</Text>
            <Text variant="meta" color={state === "error" ? "danger/text" : blocked ? "warning/text" : "text/secondary"} numberOfLines={1}>{state === "loading" ? t("Loading") : state === "error" ? `${t("Error")} · ${entry.group.error?.message ?? ""}` : meta || t("No models detected")}</Text>
          </View>
          {state === "loading" ? <Spinner size={14} label={t("Loading")} /> : state === "error" ? <Icon name="warn" size={14} color="danger" /> : null}
          <Icon name={inlineIcon(theme.rtl, "chev-r")} size={14} color="text/secondary" />
        </Tap>
        {state === "error" || retrying ? <Button size="xs" label={retrying ? t("Retrying…") : t("Retry")} disabled={retrying} onPress={() => void data.retry([entry.group.runtimeId])} /> : null}
      </View>
    );
  };
  const action = (blocked: ReturnType<typeof blockedReason>, group: BrowserGroup) => {
    if (!blocked?.action) return null;
    if (blocked.action === "retry") return <Button size="xs" label={data.retrying.includes(group.runtimeId) ? t("Retrying…") : t("Retry")} disabled={data.retrying.includes(group.runtimeId)} onPress={() => void data.retry([group.runtimeId])} />;
    if (device !== "admin") return <Text variant="meta" color="text/secondary">{t("Ask an admin device to set up a runtime")}</Text>;
    return <Button size="xs" label={blocked.action === "install" ? t("Install guide") : blocked.action === "enable" ? t("Enable") : t("Sign in")} onPress={() => openSettings("runtimes")} />;
  };

  let body: React.ReactNode;
  if (!catalogue && data.error) body = <View style={{ padding: space[2] }}><Callout tone="danger" actions={[{ label: t("Retry"), onPress: () => data.reload() }]}>{reasonOf(data.error)}</Callout></View>;
  else if (!catalogue) body = <SkeletonList rows={6} leading="icon" meta style={{ padding: space[2] }} />;
  else if (view.view === "group" && row) {
    const models = rowModels(row, query, favourites);
    const blocked = blockedReason(row.group, null, catalogue.policy, device);
    body = (
      <>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[1], paddingHorizontal: space[1] }}>
          {rows.length > 1 ? <IconButton icon={inlineIcon(theme.rtl, "chev-l")} size="xs" label={t("All models")} onPress={() => { setQuery(""); setView({ view: "all" }); }} /> : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="body-medium" numberOfLines={1}>{row.title}</Text>
            <Text variant="meta" color="text/secondary" numberOfLines={1}>{[t(ACCESS_METHOD_LABEL[row.method]), row.subtitle].filter(Boolean).join(" · ")}</Text>
          </View>
          {device === "admin" ? <IconButton icon="gear" size="xs" label={t("Open {provider} settings", { provider: row.title })} onPress={() => openSettings(row.method === "cli" ? "runtimes" : "endpoints")} /> : null}
        </View>
        <SearchField label={t("Search models")} placeholder={t("Search models…")} size="sm" value={query} onChangeText={setQuery} debounce={0} autoFocus />
        {blocked ? <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[2], paddingVertical: space[1] }}><Icon name="warn" size={14} color="warning/icon" /><Text variant="meta" color="warning/text" style={{ flex: 1 }}>{t(blocked.text)}</Text>{action(blocked, row.group)}</View> : null}
        <ScrollView style={{ maxHeight: 320 }} accessibilityRole="list">
          {models.length ? models.map((model) => modelRow(model, row.group, false)) : <Note text={query ? t("No models match your search") : row.group.readiness === "loading" ? t("Loading models…") : t("No models detected")} />}
        </ScrollView>
      </>
    );
  } else {
    const found = query.trim() ? searchModels(catalogue, query) : null;
    const known = (list: readonly ModelRef[]) => list.map((ref) => ({ model: findModel(catalogue, ref), group: catalogue.groups.find((entry) => entry.runtimeId === ref.runtimeId) })).filter((entry): entry is { model: BrowserModel; group: BrowserGroup } => !!entry.model && !!entry.group);
    body = (
      <>
        <SearchField label={t("Search models")} placeholder={t("Search every runtime and provider…")} size="sm" value={query} onChangeText={setQuery} debounce={0} autoFocus />
        <ScrollView style={{ maxHeight: 380 }}>
          {found ? (found.length ? found.slice(0, 80).map((entry) => modelRow(entry.model, entry.group, true)) : <Note text={t("No models match your search")} />) : (
            <>
              {props.routing ? (
                <Tap role="option" label={t("Use model routing")} selected={props.routing.active} testID="model-routing-default" onPress={() => { props.routing!.onSelect(); props.onClose(); }}
                  style={(state) => ({ minHeight: 40, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[2], paddingVertical: space[1], borderRadius: radius.sm, backgroundColor: props.routing!.active ? theme.color("bg/subtle") : state.hovered || state.pressed ? theme.color("bg/hover") : "transparent" })}>
                  <View style={{ width: 16 }}>{props.routing.active ? <Icon name="check" size={16} color="accent" label={t("Selected")} /> : null}</View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant={props.routing.active ? "body-medium" : "body"}>{t("Use model routing")}</Text>
                    <Text variant="meta" color="text/secondary" numberOfLines={1}>{t("Director route: {model}", { model: props.routing.model })}</Text>
                  </View>
                </Tap>
              ) : null}
              {known(favourites).length ? <><ListCaption label={t("Favorites")} />{known(favourites).map((entry) => modelRow(entry.model, entry.group, true))}</> : null}
              {known(recents).length ? <><ListCaption label={t("Recent")} />{known(recents).map((entry) => modelRow(entry.model, entry.group, true))}</> : null}
              {ACCESS_METHODS.map((method) => {
                const list = rows.filter((entry) => entry.method === method);
                return list.length ? <View key={method}><ListCaption label={t(ACCESS_METHOD_LABEL[method])} />{list.map(groupRow)}</View> : null;
              })}
            </>
          )}
        </ScrollView>
      </>
    );
  }
  return (
    <Popover open={props.open} onClose={props.onClose} anchor={props.anchor} side="top" align="start" width={380} label={t("Select model")} title={t("Select model")} padded={false}>
      <View testID="model-browser" style={{ width: theme.compact ? undefined : 380, padding: space[2], gap: space[1.5] }}>
        {body}
        <View style={{ flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: theme.color("border/hairline"), paddingTop: space[1.5], gap: space[2] }}>
          <Button kind="link" size="xs" label={t("Compare runtimes")} onPress={() => openSettings("matrix")} />
          <View style={{ flex: 1 }} />
          {device === "admin" ? <Button kind="link" size="xs" label={t("Use an installed CLI")} onPress={() => openSettings("runtimes")} /> : null}
        </View>
      </View>
    </Popover>
  );
}
function Note(props: { text: string }) {
  return <View style={{ padding: space[3], alignItems: "center" }}><Text color="text/secondary">{props.text}</Text></View>;
}

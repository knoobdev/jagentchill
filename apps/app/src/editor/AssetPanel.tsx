import { memo, useEffect, useMemo } from "react";
import { ScrollView, View } from "react-native";
import { ASSET_TAB_ITEMS, durationBadge, EDITOR_PREFS, type AssetTabId } from "@jagentchill/app-core";
import { timeline } from "@jagentchill/editor-core";
import { MEDIA_MESSAGES } from "@jagentchill/media";
import type { ProjectDocument } from "@jagentchill/protocol";
import { Button, Icon, IconButton, Tap, Text, radius, space, useTheme, useToast } from "@jagentchill/ui";
import { useT } from "../locale";
import { MediaPanel, type CommitFn, type TimelineBridge } from "../media/MediaPanel";
import { pickFiles } from "../platform/store";
import { usePref } from "../state";
import { AudioTab } from "./assets/AudioTab";
import { CaptionsTab } from "./assets/CaptionsTab";
import { StickersTab } from "./assets/StickersTab";
import { EffectsTab, FiltersTab, TransitionsTab } from "./assets/FxLibrary";
import { TextTab } from "./assets/TextTab";
import { TranscriptTab } from "./assets/TranscriptTab";
import { EditorBrandTab, EditorTemplatesTab } from "../templates/EditorTabs";
import { useEditor, useEditorSelect } from "./context";

/** The tabs of the asset panel whose content this build has, in the order of the frame. */
const AVAILABLE: readonly AssetTabId[] = ["media", "audio", "text", "stickers", "effects", "transitions", "captions", "transcript", "filters", "templates", "brand-kit"];

/** The asset panel region: the vertical tab bar and the content of the active tab. */
// Memoised, and reading only "Reveal media" of the editor: the panel does not render again for a selection, a scroll or
// an edit of the timeline — each tab reads what it shows by itself.
/** The same project to the asset panel: everything but the timeline's own view (scroll, zoom, playhead), which is saved beside the content and gives the document a new identity on every scroll. */
function sameContent(a: ProjectDocument, b: ProjectDocument): boolean {
  if (a === b) return true;
  const left = a as unknown as Record<string, unknown>, right = b as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) if (key !== "local" && left[key] !== right[key]) return false;
  const local = (value: unknown) => { const { timelineViewState: _view, ...rest } = (value ?? {}) as Record<string, unknown>; return rest; };
  const la = local(left.local), lb = local(right.local), names = new Set([...Object.keys(la), ...Object.keys(lb)]);
  for (const key of names) if (la[key] !== lb[key] && JSON.stringify(la[key]) !== JSON.stringify(lb[key])) return false;
  return true;
}
export const AssetPanel = memo(function AssetPanel(props: { document: ProjectDocument; commit: CommitFn; readOnly: boolean }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const revealed = useEditorSelect((editor) => editor.revealed, Object.is);
  const { controller } = runtime, projectId = props.document.metadata.id;
  const [stored, setStored] = usePref(EDITOR_PREFS.assetTabs);
  const active = (AVAILABLE as readonly string[]).includes(stored[projectId]) ? (stored[projectId] as AssetTabId) : "media";
  const show = (id: AssetTabId) => setStored({ ...stored, [projectId]: id });
  // "Reveal media" brings the Media tab forward.
  useEffect(() => { if (revealed && active !== "media") show("media"); }, [revealed?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const bridge = useMemo((): TimelineBridge => ({
    add: (assetIds, options) => runtime.addAssets(assetIds, options?.overlay === true),
    selectClips: (assetId) => controller.select(timeline.selectElements(timeline.elementsOfScene(timeline.sceneById(controller.stored, controller.session.sceneId)).filter((element) => element.mediaId === assetId).map((element) => element.id))),
    pasteAt: (assetIds) => runtime.addAssets(assetIds),
    clipboardHasEntry: () => !controller.clipboard.isEmpty,
  }), [runtime, controller]);
  const tabs = ASSET_TAB_ITEMS.filter((tab) => AVAILABLE.includes(tab.id));
  return (
    <View testID="asset-panel" style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "row" }}>
      <View role="tablist" aria-label={t("Assets")} aria-orientation="vertical" style={{ width: 72, backgroundColor: theme.color("bg/sidebar"), borderEndWidth: 1, borderEndColor: theme.color("border/hairline") }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ alignItems: "center", paddingVertical: space[2], gap: space[1] }}>
        {tabs.map((tab, index) => (
          <Tap key={tab.id} role="tab" label={t(tab.label)} selected={active === tab.id} tabIndex={active === tab.id ? 0 : -1} testID={`panel-tab-${tab.id}`} onPress={() => show(tab.id)}
            onKeyDown={(key) => { if (key.key === "ArrowDown" || key.key === "ArrowUp") { key.preventDefault(); show(tabs[(index + (key.key === "ArrowDown" ? 1 : tabs.length - 1)) % tabs.length].id); } }}
            style={(state) => ({ width: 64, height: 48, alignItems: "center", justifyContent: "center", gap: 4, borderRadius: radius.md, backgroundColor: active === tab.id ? theme.color("bg/subtle") : state.hovered ? theme.color("bg/hover") : "transparent" })}>
            <Icon name={tab.icon} size={20} color={active === tab.id ? "text/primary" : "text/secondary"} />
            <Text variant="caption" color={active === tab.id ? "text/primary" : "text/secondary"} numberOfLines={1} style={{ fontWeight: "500", lineHeight: 14 }}>{t(tab.label)}</Text>
          </Tap>
        ))}
        </ScrollView>
      </View>
      <View role="tabpanel" aria-label={t(ASSET_TAB_ITEMS.find((tab) => tab.id === active)!.label)} style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        {active === "media" ? <MediaPanel session={runtime.media} document={props.document} commit={props.commit} readOnly={props.readOnly} timeline={props.readOnly ? null : bridge} reveal={revealed} /> : null}
        {active === "audio" ? <AudioTab document={props.document} readOnly={props.readOnly} /> : null}
        {active === "text" ? <TextTab readOnly={props.readOnly} /> : null}
        {active === "stickers" ? <StickersTab readOnly={props.readOnly} /> : null}
        {active === "captions" ? <CaptionsTab document={props.document} readOnly={props.readOnly} /> : null}
        {active === "transcript" ? <TranscriptTab document={props.document} readOnly={props.readOnly} onOpenCaptions={() => show("captions")} /> : null}
        {active === "effects" ? <EffectsTab readOnly={props.readOnly} /> : null}
        {active === "transitions" ? <TransitionsTab readOnly={props.readOnly} /> : null}
        {active === "filters" ? <FiltersTab readOnly={props.readOnly} /> : null}
        {active === "templates" ? <EditorTemplatesTab /> : null}
        {active === "brand-kit" ? <EditorBrandTab readOnly={props.readOnly} /> : null}
      </View>
    </View>
  );
}, (before, after) => before.commit === after.commit && before.readOnly === after.readOnly && sameContent(before.document, after.document));

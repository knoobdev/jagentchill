import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { acceptPatch, timeline, type StatePatch } from "@jagentchill/editor-core";
import type { SyncSession } from "@jagentchill/client";
import type { ProjectDocument, ProposalView } from "@jagentchill/protocol";
import { Button, Icon, Text, space, useTheme, useToast } from "@jagentchill/ui";
import { useEditor, useEditorVersion } from "../../editor/context";
import { useHost } from "../../host";
import { useT } from "../../locale";
import { proposalPreview, useFocusedSession, usePreviewOf, useProposals, type ProposalError } from "./data";
import { contactSheet, decorate, toBase64, type Box, type FrameOverlay } from "./frames";

type FrameRequest = { requestId: string; projectId: string; sceneId: string; times: number[]; width: number; overlays: FrameOverlay[]; layout: "separate" | "contact_sheet"; patches?: StatePatch; frameTimeout_ms: number };
type Focus = { projectId: string; time?: number; elementIds?: string[]; sceneId?: string; panel?: string };
const within = <T,>(work: Promise<T>, ms: number): Promise<T | null> => Promise.race([work, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

/**
 * What the open editor does for the agent of its project: it draws a pending proposal over the project without
 * committing it, lets the person accept or reject it there, tells the host what the person is looking at, and renders
 * the frames the agent asks to see. Mounted once inside the editor; it changes the project only when a proposal is accepted.
 */
export function EditorProposals(props: { projectId: string; session: SyncSession | null }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const runtime = useEditor();
  const version = useEditorVersion();
  const { connection, onEvent, can } = useHost();
  const focused = useFocusedSession();
  const wanted = usePreviewOf(props.projectId);
  const { proposals, resolve } = useProposals({ projectId: props.projectId });
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = useRef<{ proposalId: string; document: ProjectDocument; /** The stored document the proposed one was made from. */ base: ProjectDocument } | null>(null);
  const pending = proposals.filter((proposal) => proposal.state === "pending");
  // A proposal that arrives while the project is open is shown at once; hiding it is the person's choice.
  const current = pending.find((proposal) => proposal.proposalId === wanted) ?? pending.filter((proposal) => wanted !== `!${proposal.proposalId}`).at(-1);
  const stored = runtime.controller.stored, inSync = (props.session?.state.pending ?? 0) === 0;

  /** The proposed document: the proposal's patch list applied to this device's copy. Null while that copy is not the host's. */
  const proposedOf = (proposal: ProposalView, base: ProjectDocument): ProjectDocument | null => {
    try { return acceptPatch(base, proposal.preview.patches as StatePatch); } catch { return null; }
  };

  // The preview layer: the proposed state is drawn in place of the stored one and is never saved or pushed.
  useEffect(() => {
    const controller = runtime.controller, now = shown.current;
    // The stored document changed UNDER the preview without an edit of the person (a file the agent imported has
    // arrived on this device, a proxy is ready): the proposed state is made again from it, or the preview would go on
    // showing that media as offline.
    const stale = !!current && now?.proposalId === current.proposalId && controller.document === now.document && controller.stored !== now.base;
    if (current && now?.proposalId === current.proposalId && controller.document === now.document && !stale) return;
    if (!current) { if (now && controller.document === now.document) controller.discardPreview(); shown.current = null; return; }
    // An edit of the person replaced what was drawn: the preview is off until they ask for it again.
    if (now?.proposalId === current.proposalId && controller.document !== now.document) { shown.current = null; proposalPreview.hide(props.projectId, current.proposalId); return; }
    const document = inSync ? proposedOf(current, controller.stored) : null;
    if (!document) return;
    shown.current = { proposalId: current.proposalId, document, base: controller.stored };
    if (stale) controller.discardPreview();
    controller.external(() => ({ document, patch: [], commandType: "agent.proposal.preview", label: current.title, history: false, nearSizeLimit: false }), true);
  }, [current?.proposalId, current?.preview.baseRevision, version, inSync]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { const now = shown.current; if (now && runtime.controller.document === now.document) runtime.controller.discardPreview(); }, [runtime]);

  // The person's place in the editor, for `jc_editor_context`: sent when it changes, a few times a second at most.
  const lastReport = useRef("");
  useEffect(() => {
    if (!connection || !props.session || props.session.state.status.kind === "local") return;
    const timer = setTimeout(() => {
      const session = runtime.controller.session, scene = stored.scenes.find((entry) => entry.id === session.sceneId) as { inPoint?: number; outPoint?: number } | undefined;
      const body = {
        projectId: props.projectId, sceneId: session.sceneId, playhead: Math.max(0, Math.round(session.playhead)), selectedElementIds: session.selection.selectedElements.slice(0, 500), selectedRange: null,
        inPoint: scene?.inPoint ?? null, outPoint: scene?.outPoint ?? null, panel: null, zoomWindow: null, focusedSessionKey: focused, pendingOps: props.session?.state.pending ?? 0,
      };
      const text = JSON.stringify(body);
      if (text === lastReport.current) return;
      lastReport.current = text;
      void connection.call("jagentchill.editor.context.report", body).catch(() => undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [version, focused, connection, props.session, props.session?.state.pending]); // eslint-disable-line react-hooks/exhaustive-deps

  /** One composited frame of a document from the preview engine, as JPEG bytes. */
  /**
   * One composited frame of a document from the preview engine, as JPEG bytes. It is drawn whatever media this device
   * has: a file that is not here keeps its place as the preview's "Media offline" tile and is named in `missing`.
   * `note`, when given, receives why the engine drew nothing.
   */
  const still = async (document: ProjectDocument, sceneId: string, time: number, width: number, note?: (failure: string) => void): Promise<{ bytes: Uint8Array; width: number; height: number; missing: string[] } | null> => {
    const engine = runtime.engine, canvas = document.settings.canvasSize;
    if (!engine) { note?.("the preview engine is not running on this device"); return null; }
    const even = (value: number) => Math.max(2, Math.round(value / 2) * 2), size = { width: even(width), height: even((width * canvas.height) / canvas.width) };
    const made = await engine.withDocument(document, sceneId, () => engine.frame(time, sceneId, size));
    if (!made.bytes) { note?.(made.failure); return null; }
    return { bytes: made.bytes, ...size, missing: made.missingAssets };
  };

  const frameQueue = useRef<Promise<void>>(Promise.resolve());
  // The host's requests to this device: move the person's view, or render frames for the agent.
  useEffect(() => onEvent((event) => {
    const payload = (event.payload ?? {}) as { projectId?: string };
    if (payload.projectId !== props.projectId) return;
    if (event.event === "jagentchill.editor.focus") {
      const focus = payload as Focus, controller = runtime.controller;
      if (focus.sceneId && controller.stored.scenes.some((scene) => scene.id === focus.sceneId)) controller.switchScene(focus.sceneId);
      if (focus.elementIds) controller.select(timeline.selectElements(focus.elementIds.filter((elementId) => timeline.locate(controller.stored, elementId))));
      if (focus.time !== undefined) runtime.seek(focus.time);
    }
    if (event.event === "jagentchill.editor.frame.request" && connection) {
      const request = payload as FrameRequest;
      // One request at a time: the preview engine holds one document at a time (`withDocument` is not re-entrant).
      const run = async () => {
        const base = runtime.controller.stored;
        let document: ProjectDocument | null = base;
        if (request.patches) { try { document = acceptPatch(base, request.patches); } catch { document = null; } }
        const frames: { index: number; mime: "image/jpeg"; dataBase64: string; time: number; width: number; height: number }[] = [], failed: number[] = [], raw: Uint8Array[] = [];
        // What the agent is told besides the pictures: the files drawn as a placeholder, and why a frame is absent.
        const missing = new Set<string>();
        let reason = "";
        // The first frame of a request opens the source at full quality (a cold start on a long video): it gets three
        // times the allowance. A frame given up on is still being drawn by the engine: the next one starts its own
        // allowance only when that drawing has ended, so that one slow frame does not cost every frame after it.
        let drawing: Promise<unknown> = Promise.resolve();
        for (const [index, time] of request.times.entries()) {
          await drawing;
          let why = document ? "" : "the proposal does not apply to the project on this device";
          const work = document ? still(document, request.sceneId, time, request.width, (failure) => { why = failure; }) : Promise.resolve(null);
          drawing = work.catch(() => null);
          const made = document ? await within(work, request.frameTimeout_ms * (index === 0 ? 3 : 1)).catch((error) => { why ||= error instanceof Error && error.message ? error.message : "timeout"; return null; }) : null;
          if (!made) { failed.push(index); reason ||= why || "timeout"; continue; }
          for (const assetId of made.missing) missing.add(assetId);
          let bytes = made.bytes;
          if (request.overlays.length > 0) {
            const ids = timeline.elementsOfScene(timeline.sceneById(document!, request.sceneId)).map((element) => element.id);
            const boxes = request.overlays.includes("element_bounds") ? Object.values(await runtime.engine!.layout(ids, time).catch(() => ({}))) as Box[] : [];
            bytes = await decorate(bytes, { overlays: request.overlays, boxes, canvas: document!.settings.canvasSize }).catch(() => bytes);
          }
          raw.push(bytes);
          frames.push({ index, mime: "image/jpeg", dataBase64: toBase64(bytes), time, width: made.width, height: made.height });
        }
        if (request.layout === "contact_sheet" && raw.length > 1) {
          const sheet = await contactSheet(raw, { width: request.width, height: frames[0].height }).catch(() => null);
          if (sheet) frames.splice(0, frames.length, { index: 0, mime: "image/jpeg", dataBase64: toBase64(sheet.bytes), time: request.times[0], width: sheet.width, height: sheet.height });
        }
        await connection.call("jagentchill.editor.frame.result", { requestId: request.requestId, frames: frames.filter((frame) => frame.dataBase64.length > 0), failed, ...(missing.size > 0 ? { missingAssetIds: [...missing].slice(0, 100) } : {}), ...(reason ? { reason: reason.slice(0, 300) } : {}) }).catch(() => undefined);
      };
      frameQueue.current = frameQueue.current.then(run, run);
    }
  }), [onEvent, connection, runtime, props.projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The before/after pair of a proposal card is rendered by a device that has the project open: this one, once.
  const framed = useRef(new Set<string>());
  useEffect(() => {
    if (!connection || !runtime.engine || runtime.transport.engine !== "ready" || !inSync) return;
    for (const proposal of pending) {
      if (!proposal.framesUnavailable || framed.current.has(proposal.proposalId)) continue;
      const after = proposedOf(proposal, runtime.controller.stored);
      if (!after) continue;
      framed.current.add(proposal.proposalId);
      // The frame of the largest visible change: the start of the first element the proposal adds or changes.
      const changed = [...proposal.elements.added, ...proposal.elements.modified].map((elementId) => timeline.locate(after, elementId)).filter((hit) => hit && timeline.isVisual(hit.element)).sort((a, b) => a!.element.startTime - b!.element.startTime)[0];
      const sceneId = changed?.scene.id ?? runtime.controller.session.sceneId, time = changed ? changed.element.startTime + Math.min(changed.element.duration - 1, Math.round(changed.element.duration / 4)) : 0;
      void (async () => {
        const before = await within(still(runtime.controller.stored, sceneId, Math.min(time, Math.max(0, runtime.controller.stored.metadata.duration - 1)), 768), 8000).catch(() => null);
        const then = await within(still(after, sceneId, time, 768), 8000).catch(() => null);
        if (!before || !then) { framed.current.delete(proposal.proposalId); return; }
        const frame = (made: NonNullable<typeof before>, at: number) => ({ mime: "image/jpeg" as const, dataBase64: toBase64(made.bytes), time: at, width: made.width, height: made.height });
        if (frame(before, time).dataBase64.length === 0) return;
        await connection.call("jagentchill.proposal.frames.put", { proposalId: proposal.proposalId, before: frame(before, time), after: frame(then, time) }).catch(() => undefined);
      })();
    }
  }, [pending.map((proposal) => proposal.proposalId).join(","), runtime.transport.engine, inSync, connection]); // eslint-disable-line react-hooks/exhaustive-deps

  const proposal = current ?? pending.at(-1);
  if (!proposal) return null;
  const previewing = shown.current?.proposalId === proposal.proposalId && runtime.controller.document === shown.current.document;
  const mayWrite = can("jagentchill.projects.write");
  const decide = async (action: "accept" | "reject") => {
    setBusy(action); setProblem(null);
    // The preview leaves first: an accepted change is applied to the stored project, through the edit lease.
    proposalPreview.hide(props.projectId, proposal.proposalId);
    if (shown.current && runtime.controller.document === shown.current.document) runtime.controller.discardPreview();
    shown.current = null;
    try {
      await resolve(proposal.proposalId, action);
      toast.show({ kind: "success", message: action === "accept" ? t("Applied — one undo step: Agent: {title}", { title: proposal.title }) : t("Proposal rejected") });
    } catch (error) { setProblem((error as ProposalError).message ?? t("Could not apply the proposal")); }
    finally { setBusy(null); }
  };
  const counts = t("+{added} added · ~{modified} modified · −{removed} removed", { added: proposal.elements.added.length, modified: proposal.elements.modified.length, removed: proposal.elements.removed.length });
  return (
    <View testID="editor-proposal" {...({ dataSet: { previewing: String(previewing), proposal: proposal.proposalId } } as object)}
      style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap", minHeight: 36, paddingHorizontal: space[3], paddingVertical: space[1], backgroundColor: theme.color("accent/subtle"), borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
      <Icon name="layers" size={16} color="accent" />
      <View style={{ flex: 1, minWidth: 160 }}>
        <Text variant="body-medium" numberOfLines={1}>{previewing ? t("Showing the agent's proposal — not applied yet: {title}", { title: proposal.title }) : t("The agent proposes: {title}", { title: proposal.title })}</Text>
        <Text variant="meta" color={problem ? "danger/text" : "text/secondary"} numberOfLines={2} live="polite">{problem ?? (inSync ? counts : t("Preview available once this device has synced its own changes"))}</Text>
      </View>
      <Button kind="ghost" size="xs" icon={previewing ? "eye-off" : "eye"} label={previewing ? t("Hide preview") : t("Show preview")} testID="editor-proposal-preview" disabled={!inSync || busy !== null} onPress={() => (previewing ? proposalPreview.hide(props.projectId, proposal.proposalId) : proposalPreview.set(props.projectId, proposal.proposalId))} />
      <Button kind="ghost" size="xs" label={t("Reject")} testID="editor-proposal-reject" disabled={!mayWrite || busy !== null} loading={busy === "reject"} onPress={() => void decide("reject")} />
      <Button kind="primary" size="xs" label={t("Accept")} testID="editor-proposal-accept" disabled={!mayWrite || busy !== null} loading={busy === "accept"} onPress={() => void decide("accept")} />
    </View>
  );
}

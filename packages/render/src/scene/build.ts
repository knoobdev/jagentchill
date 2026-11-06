import { floorToFrame, sceneDuration } from "@jagentchill/editor-core";
import type { Background as CanvasBackground, EngineDiagnosticId, EngineErrorCode, ProjectDocument, TimelineElement } from "@jagentchill/protocol";

/**
 * The scene builder: a project document and a scene id to a tree of render nodes. Building is a pure function of
 * its inputs; two builds of the same snapshot serialise to the same bytes.
 */

export const NODE_TYPES = ["Video", "Image", "Text", "Caption", "Sticker", "Graphic", "Color", "GradientBackground", "BlurBackground", "ImageBackground", "EffectLayer", "AdjustmentLayer", "Transition", "Compound"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export type SceneDiagnostic = { id: EngineDiagnosticId | EngineErrorCode; severity: "caution" | "error"; message: string; elementId?: string; assetId?: string; details?: Record<string, unknown> };
export type Diagnose = (diagnostic: SceneDiagnostic) => void;

type Canvas = CanvasBackground;
export type BackgroundNode = {
  type: "Color" | "GradientBackground" | "BlurBackground" | "ImageBackground";
  /** `null`: the project default, used wherever no main-track element with its own background is visible. */
  elementId: string | null;
  startTime: number; duration: number;
  background: Canvas;
};
export type ElementNode = {
  type: Exclude<NodeType, "Color" | "GradientBackground" | "BlurBackground" | "ImageBackground" | "Transition">;
  elementId: string; trackId: string; zone: "main" | "overlay";
  startTime: number; duration: number;
  element: TimelineElement;
  /** Masks honoured on this node (maskable types only). */
  masks: unknown[];
  /** Style, layout and highlight of the caption track a caption element sits on. */
  caption?: Record<string, any>;
};
export type TransitionNode = {
  type: "Transition"; transitionId: string; trackId: string; zone: "main" | "overlay";
  windowStart: number; windowDuration: number;
  shader: string; easing: string; params: Record<string, unknown>;
  from: ElementNode; to: ElementNode;
};
export type SceneNode = BackgroundNode | ElementNode | TransitionNode;
export type RootNode = {
  sceneId: string; duration: number; frameRate: { numerator: number; denominator: number }; width: number; height: number;
  /** `[0,0,0,0]` only when the project default background is transparent. */
  transparent: boolean;
  children: SceneNode[];
};

const ELEMENT_NODES: Record<string, ElementNode["type"]> = {
  video: "Video", image: "Image", text: "Text", caption: "Caption", sticker: "Sticker", graphic: "Graphic", compound: "Compound",
  adjustment: "AdjustmentLayer", effect: "EffectLayer",
};
const MASKABLE = new Set(["Video", "Image", "Graphic", "Sticker", "Compound", "AdjustmentLayer"]);
const BACKGROUND_NODES = { color: "Color", gradient: "GradientBackground", blur: "BlurBackground", image: "ImageBackground" } as const;

export type BuildOptions = {
  /** Uncommitted gesture values, element id → partial element. */
  overrides?: Record<string, Record<string, unknown>>;
  includeCaptions?: boolean;
  /** Whether this scene is rendered as the source of a compound clip: then it draws no background of its own. */
  asCompoundSource?: boolean;
  diagnose?: Diagnose;
};

function merged<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch) || base === null || typeof base !== "object" || Array.isArray(base)) return patch as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) out[key] = key in out ? merged(out[key], value) : value;
  return out as T;
}

const byStartThenId = (a: { startTime: number; id: string }, b: { startTime: number; id: string }): number =>
  a.startTime - b.startTime || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildScene(document: ProjectDocument, sceneId: string, options: BuildOptions = {}): RootNode {
  const scene = document.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new Error(`scene ${sceneId} does not exist`);
  const diagnose = options.diagnose ?? (() => undefined);
  const { canvasSize, fps } = document.settings;
  const background = document.settings.background as Canvas;
  const children: SceneNode[] = [];
  const drawsBackground = !options.asCompoundSource || scene.compoundBackground === "own";

  // Bottom to top: main, then overlay[last] … overlay[0].
  const stack = [{ track: scene.tracks.main, zone: "main" as const }, ...[...scene.tracks.overlay].reverse().map((track) => ({ track, zone: "overlay" as const }))];
  const elementNodes: SceneNode[] = [];
  const mainElements: ElementNode[] = [];
  for (const { track, zone } of stack) {
    if ((track as { hidden?: boolean }).hidden) continue;
    if (track.type === "caption" && options.includeCaptions === false) continue;
    const nodes = new Map<string, ElementNode>();
    const ordered: ElementNode[] = [];
    for (const stored of [...(track.elements as TimelineElement[])].sort(byStartThenId)) {
      const element = options.overrides?.[stored.id] ? merged(stored, options.overrides[stored.id]) : stored;
      if ((element as { hidden?: boolean }).hidden) continue;
      const type = ELEMENT_NODES[(element as { type: string }).type];
      if (!type) {
        diagnose({ id: "scene/unknown-element-type", severity: "error", message: `element ${stored.id} has an unknown type`, elementId: stored.id });
        continue;
      }
      const masks = ((element as { masks?: { enabled?: boolean }[] }).masks ?? []).filter((mask) => mask.enabled !== false);
      if (masks.length > 0 && !MASKABLE.has(type)) diagnose({ id: "mask/unsupported-element", severity: "caution", message: `masks are ignored on element ${stored.id}`, elementId: stored.id });
      const node: ElementNode = { type, elementId: stored.id, trackId: track.id, zone, startTime: element.startTime, duration: element.duration, element, masks: MASKABLE.has(type) ? masks : [], ...(track.type === "caption" ? { caption: (track as { caption?: Record<string, unknown> }).caption } : {}) };
      nodes.set(stored.id, node);
      ordered.push(node);
    }
    if (zone === "main") mainElements.push(...ordered);
    elementNodes.push(...ordered);
    for (const record of track.transitions) {
      if (record.kind !== "transition") continue;
      const from = nodes.get(record.fromElementId), to = nodes.get(record.toElementId);
      if (!from || !to) continue;
      // The window is centred on the cut: [cut − floorToFrame(D/2), cut − floorToFrame(D/2) + D).
      const cut = to.startTime;
      const half = floorToFrame(Math.floor(record.duration / 2), fps);
      elementNodes.push({
        type: "Transition", transitionId: record.id, trackId: track.id, zone, windowStart: Math.max(0, cut - half), windowDuration: record.duration,
        shader: record.type, easing: record.easing, params: record.params, from, to,
      });
    }
  }

  if (drawsBackground) {
    // The project default first, then the per-clip backgrounds, which replace it while their clip is visible.
    if (!options.asCompoundSource && background.kind !== "transparent") {
      children.push({ type: BACKGROUND_NODES[background.kind], elementId: null, startTime: 0, duration: Number.MAX_SAFE_INTEGER, background });
    }
    for (const node of mainElements) {
      const own = (node.element as { background?: Canvas }).background ?? (options.asCompoundSource ? background : undefined);
      if (own && own.kind !== "transparent") children.push({ type: BACKGROUND_NODES[own.kind], elementId: node.elementId, startTime: node.startTime, duration: node.duration, background: own });
    }
  }
  children.push(...elementNodes);
  return {
    sceneId, duration: sceneDuration(scene), frameRate: { numerator: fps.numerator, denominator: fps.denominator }, width: canvasSize.width, height: canvasSize.height,
    transparent: options.asCompoundSource === true || background.kind === "transparent", children,
  };
}

/** A stable serialisation of a tree, for comparing builds. */
export const serializeScene = (root: RootNode): string => JSON.stringify(root);

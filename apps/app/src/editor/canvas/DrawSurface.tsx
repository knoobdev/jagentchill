import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import Svg, { Polyline } from "react-native-svg";
import { canvasRect, toCanvas, toScreen, type PreviewView } from "@jagentchill/app-core";
import { strokeHit, type DrawnStroke } from "@jagentchill/editor-core";
import { bindHandle } from "../content-dom";
import { draw, useDraw } from "./draw-store";

type Size = { width: number; height: number };
/**
 * The canvas of the Draw tool, over the preview while the tool is on: a drag draws a stroke in the chosen brush, the
 * eraser removes every stroke it touches. Points are kept in canvas pixels from the canvas centre.
 */
export function DrawSurface(props: { view: PreviewView; viewport: Size; canvas: Size }) {
  const state = useDraw();
  const node = useRef<View>(null);
  const [current, setCurrent] = useState<[number, number][] | null>(null);
  const live = useRef(props);
  live.current = props;
  useEffect(() => {
    if (!state.active) return;
    const point = (info: { x: number; y: number }): [number, number] => { const { view, viewport, canvas } = live.current, at = toCanvas(info, view, viewport, canvas); return [Math.round(at.x * 100) / 100, Math.round(at.y * 100) / 100]; };
    return bindHandle(node.current, {
      down(info) {
        const tool = draw.state.tool, reach = 4 / canvasRect(live.current.view, live.current.viewport, live.current.canvas).scale;
        if (tool === "eraser") {
          const rub = (now: { x: number; y: number }) => { const at = point(now); draw.erase(draw.state.strokes.flatMap((stroke, index) => (strokeHit(stroke, at, reach) ? [index] : []))); };
          rub(info);
          return { move: rub, up: rub };
        }
        let points: [number, number][] = [point(info)];
        setCurrent(points);
        const extend = (now: { x: number; y: number }) => { const next = point(now), last = points[points.length - 1]; if (Math.hypot(next[0] - last[0], next[1] - last[1]) >= 1) { points = [...points, next]; setCurrent(points); } };
        return {
          move: extend,
          up(now) {
            extend(now);
            setCurrent(null);
            // A press without a drag leaves a dot: a stroke of the brush's own width.
            if (points.length === 1) points = [points[0], [points[0][0] + 0.5, points[0][1]]];
            draw.add({ points, width: draw.state.width, color: draw.state.color, brush: tool });
          },
          cancel() { setCurrent(null); },
        };
      },
    });
  }, [state.active]);
  if (!state.active) return null;
  const { view, viewport, canvas } = props, scale = canvasRect(view, viewport, canvas).scale;
  const line = (stroke: DrawnStroke, key: string) => (
    <Polyline key={key} points={stroke.points.map(([x, y]) => { const at = toScreen({ x, y }, view, viewport, canvas); return `${at.x},${at.y}`; }).join(" ")} fill="none" stroke={stroke.color.slice(0, 7)} strokeWidth={Math.max(1, stroke.width * scale)}
      strokeOpacity={(stroke.color.length === 9 ? Number.parseInt(stroke.color.slice(7), 16) / 255 : 1) * (stroke.brush === "marker" ? 0.5 : 1)} strokeLinecap={stroke.brush === "marker" ? "butt" : "round"} strokeLinejoin="round" />
  );
  return (
    <View ref={node} testID="draw-surface" style={[{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, zIndex: 5 }, { cursor: state.tool === "eraser" ? "cell" : "crosshair", touchAction: "none" } as object]}>
      <Svg width={viewport.width} height={viewport.height} pointerEvents="none">
        {state.strokes.map((stroke, index) => line(stroke, `stroke-${index}`))}
        {current && state.tool !== "eraser" ? line({ points: current, width: state.width, color: state.color, brush: state.tool }, "current") : null}
      </Svg>
    </View>
  );
}

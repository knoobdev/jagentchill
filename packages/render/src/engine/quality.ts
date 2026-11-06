import type { Size } from "../resolve/layout.ts";

export type QualityLevel = "full" | "half" | "quarter";
export const QUALITY_FACTORS: Record<QualityLevel, number> = { full: 1, half: 0.5, quarter: 0.25 };
const ORDER: QualityLevel[] = ["full", "half", "quarter"];

const even = (value: number): number => Math.max(2, Math.round(value / 2) * 2);

/**
 * Preview render size: `min(projectCanvas, viewport CSS size × devicePixelRatio × zoom)` keeping the project
 * aspect, rounded to even integers, times the quality factor, capped at the platform maximum.
 */
export function previewRenderSize(project: Size, viewport: Size, devicePixelRatio: number, zoom: number, level: QualityLevel, maximum: Size): Size {
  const fit = Math.min(1, (viewport.width * devicePixelRatio * zoom) / project.width, (viewport.height * devicePixelRatio * zoom) / project.height,
    maximum.width / project.width, maximum.height / project.height);
  const factor = fit * QUALITY_FACTORS[level];
  return { width: even(project.width * factor), height: even(project.height * factor) };
}

/**
 * The automatic downgrade rule of the preview: start at `full`; lower one level when the mean render time of the
 * last 30 played frames exceeds 1.25 × the frame duration; raise one level after 120 consecutive played frames
 * below 0.6 × the frame duration.
 */
export class QualityGovernor {
  level: QualityLevel = "full";
  private recent: number[] = [];
  private fast = 0;

  /** Records the render time of a played frame; returns the new level when it changed. */
  record(renderMs: number, frameMs: number): QualityLevel | undefined {
    this.recent.push(renderMs);
    if (this.recent.length > 30) this.recent.shift();
    this.fast = renderMs < 0.6 * frameMs ? this.fast + 1 : 0;
    const index = ORDER.indexOf(this.level);
    if (this.recent.length === 30 && this.recent.reduce((sum, value) => sum + value, 0) / 30 > 1.25 * frameMs && index < ORDER.length - 1) return this.change(ORDER[index + 1]);
    if (this.fast >= 120 && index > 0) return this.change(ORDER[index - 1]);
    return undefined;
  }
  /** Lowers one level at once (memory pressure). */
  lower(): QualityLevel | undefined {
    const index = ORDER.indexOf(this.level);
    return index < ORDER.length - 1 ? this.change(ORDER[index + 1]) : undefined;
  }
  reset(): void { this.level = "full"; this.recent = []; this.fast = 0; }
  private change(level: QualityLevel): QualityLevel {
    this.level = level;
    this.recent = [];
    this.fast = 0;
    return level;
  }
}

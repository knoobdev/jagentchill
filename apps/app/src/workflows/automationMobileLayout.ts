import { compactScale } from "../../../../packages/ui/src/compact.ts";

/** List filters stack into full-width phone controls and use the shared phone gutters. */
export function automationListLayout(compact: boolean) {
  return {
    padding: compact ? compactScale.space.side : 24,
    filterDirection: compact ? "column" as const : "row" as const,
    filterAlign: compact ? "stretch" as const : "center" as const,
    filterGap: compact ? compactScale.space.gapSmall : 8,
    fullWidthControls: compact,
  };
}

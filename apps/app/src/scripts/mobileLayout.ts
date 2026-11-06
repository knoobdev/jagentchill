import { compactScale } from "../../../../packages/ui/src/compact.ts";

/** Script library controls become a vertical, full-width stack on phone screens. */
export function scriptListLayout(compact: boolean) {
  return {
    padding: compact ? compactScale.space.side : 20,
    direction: compact ? "column" as const : "row" as const,
    align: compact ? "stretch" as const : "center" as const,
    gap: compact ? compactScale.space.gapSmall : 8,
    fullWidth: compact,
  };
}

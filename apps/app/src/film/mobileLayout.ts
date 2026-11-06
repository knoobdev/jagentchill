/** Phone stage navigation scrolls horizontally and keeps each tab within a thumb target. */
export function filmStageStrip(compact: boolean) {
  return { horizontal: compact, height: compact ? 48 : 36, tabMinHeight: compact ? 44 : 35 } as const;
}

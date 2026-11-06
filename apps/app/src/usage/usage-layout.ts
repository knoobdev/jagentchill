export function usageFilterLayout(compact: boolean) {
  return compact
    ? { direction: "column" as const, alignItems: "stretch" as const, controlsAlign: "stretch" as const }
    : { direction: "row" as const, alignItems: "flex-end" as const, controlsAlign: undefined };
}

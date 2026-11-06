/** Two project cards per phone row, after the shared 16 pt gutters and a 12 pt column gap. */
export function phoneProjectsGrid(width: number, sidePadding: number, columnGap: number) {
  const columns = 2;
  const cardWidth = Math.max(0, width - sidePadding * 2 - columnGap) / columns;
  return { columns, cardWidth };
}

/** The empty state owns the one New project action; the floating action appears once there is content to browse. */
export function showPhoneNewProjectAction(input: { ready: boolean; selected: boolean; projects: number; folders: number }) {
  return input.ready && !input.selected && (input.projects > 0 || input.folders > 0);
}

/** Reserve room for the floating project action and the phone's home-indicator inset. */
export function phoneProjectsBottomPadding(insetBottom: number) {
  return 96 + Math.max(0, insetBottom);
}

/** A short, untruncated edit date for the compact project card. */
export function compactEditedDate(ms: number, locale: string) {
  const dateLocale = /^en\b/.test(locale) ? "en-GB" : locale;
  return new Intl.DateTimeFormat(dateLocale, { day: "numeric", month: "short" }).format(new Date(ms));
}

import { useLocalSearchParams } from "expo-router";
import { NotFoundScreen } from "../src/shell/NotFound";
import { ThemeProvider, type OsName } from "@jagentchill/ui";
import { Catalogue, type TimelineDimensions } from "@jagentchill/ui/catalogue";

// The geometry `timeline-editing.Track header column and row dimensions` owns on desktop and web, and the touch values of
// `mobile-editor.Touch gesture constants`: the design system's timeline atoms take them as inputs.
const TIMELINE: { desktop: TimelineDimensions; touch: TimelineDimensions } = {
  desktop: { row: 50, rowGap: 6, header: 136, ruler: 22, marker: { width: 12, height: 15 }, playhead: { line: 2, handle: 12 }, trim: 8, transition: 20 },
  touch: { row: 56, rowGap: 6, header: 136, ruler: 20, marker: { width: 12, height: 15 }, playhead: { line: 2, handle: 12 }, trim: 20, transition: 24 },
};
const BINDINGS: Record<string, string[]> = { "edit.split": ["Mod", "B"], "edit.duplicate": ["Mod", "D"], "edit.undo": ["Mod", "Z"], "project.new": ["Mod", "N"] };

/** The component catalogue: in development and test builds only. A release build shows the not-found screen here. */
export default function Gallery() {
  const params = useLocalSearchParams<{ open?: string; part?: string; os?: string; contrast?: string; motion?: string; locale?: string; host?: string }>();
  if (!__DEV__) return <NotFoundScreen />;
  return (
    <ThemeProvider os={(params.os as OsName | undefined) ?? undefined} increaseContrast={params.contrast === "1"} reduceMotion={params.motion === "reduce" ? true : undefined} locale={params.locale}
      host={{ connected: params.host === "1", onRequiresHost: () => {} }} shortcuts={(action) => BINDINGS[action] ?? null}>
      <Catalogue open={params.open} part={params.part === "foundations" || params.part === "components" ? params.part : undefined} timeline={TIMELINE} />
    </ThemeProvider>
  );
}

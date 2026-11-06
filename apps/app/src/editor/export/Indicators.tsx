import { useRouter } from "expo-router";
import { View } from "react-native";
import { exporting } from "@jagentchill/app-core";
import { Button, IconButton, ProgressBar, space, useTheme } from "@jagentchill/ui";
import { useT } from "../../locale";
import { useExports } from "./hooks";
import { ExportAnnouncer } from "./JobViews";

/** The Exports button of the sidebar footer: opens the queue and shows how many jobs are queued or running. */
export function ExportsButton() {
  const t = useT();
  const router = useRouter();
  const state = useExports();
  const count = exporting.badgeCount(state.queue.jobs, state.hostJobs);
  return <IconButton icon="export" size="sm" label={count > 0 ? t("Exports, {n} in progress", { n: count }) : t("Exports")} badge={count || undefined} testID="footer-exports" onPress={() => router.push("/exports/queue" as never)} />;
}

/** The export-activity indicator of the editor top bar: shown while an export of this project is queued or running; opens the queue. */
export function ExportIndicator(props: { projectId: string }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const state = useExports();
  const jobs = state.queue.jobs.filter((job) => job.projectId === props.projectId), job = jobs.find((entry) => entry.state !== "queued") ?? jobs[0];
  return (
    <>
      <ExportAnnouncer />
      {job ? (
        <View testID="export-indicator" style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}>
          <View style={{ width: 64 }}><ProgressBar thin value={job.percent} label={t("Export progress")} /></View>
          <Button kind="ghost" size="sm" label={job.state === "paused" ? t("Paused") : job.state === "queued" ? t("Queued") : t("Exporting {n}%", { n: Math.floor(job.percent) })} testID="export-indicator-open" onPress={() => router.push(`/exports/queue?job=${job.id}` as never)} />
          <View style={{ width: 1, alignSelf: "stretch", marginVertical: 14, backgroundColor: theme.color("border/hairline") }} />
        </View>
      ) : null}
    </>
  );
}

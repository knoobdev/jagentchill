import { useEffect, useState } from "react";
import { View } from "react-native";
import type { GenerationJob } from "@jagentchill/protocol";
import { Button, Icon, ProgressBar, Spinner, Text, radius, space, useTheme } from "@jagentchill/ui";
import { useHost } from "../host";
import { useT } from "../locale";

const ENDED = new Set(["succeeded", "failed", "cancelled"]);

/**
 * A generation an agent started and the chat does not wait for (a picture made on this computer takes minutes): its
 * live state under the agent's step — queued, percent done with an estimate of what is left, then done or failed.
 * Fed by the host's job events, with a slow poll in case an event is missed.
 */
export function JobProgress(props: { jobId: string }) {
  const t = useT();
  const theme = useTheme();
  const { connection, status } = useHost();
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!connection || status !== "connected") return;
    let live = true;
    const read = () => connection.call<{ job: GenerationJob }>("jagentchill.job.get", { jobId: props.jobId }).then((result) => { if (live) setJob(result.job); }, () => undefined);
    void connection.call("jagentchill.job.subscribe", {}).catch(() => undefined);
    void read();
    const off = connection.on((event) => {
      if (event.event !== "jagentchill.job.updated") return;
      const next = (event.payload as { job?: GenerationJob }).job;
      if (next?.jobId === props.jobId && live) setJob(next);
    });
    const poll = setInterval(() => void read(), 5000);
    return () => { live = false; off(); clearInterval(poll); };
  }, [connection, status, props.jobId]);
  const ended = job ? ENDED.has(job.state) : false;
  useEffect(() => {
    if (ended) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [ended]);
  if (!job) return null;
  const progress = Math.max(0, Math.min(1, job.progress ?? 0));
  const elapsed = job.started_ms ? Math.max(0, Math.round((now - job.started_ms) / 1000)) : 0;
  const left = job.state === "running" && progress > 0.1 && elapsed > 0 ? Math.round((elapsed / progress) * (1 - progress)) : null;
  const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const what = job.capability === "image" ? t("picture") : job.capability === "tts" ? t("voice line") : job.capability === "music" ? t("music") : t("result");
  const line = job.state === "queued"
    ? t("Waiting to start the {what}{ahead}", { what, ahead: job.queuePosition ? ` (${t("{n} ahead", { n: job.queuePosition })})` : "" })
    : job.state === "running" && progress <= 0.1
      ? `${t("Getting the {what} started", { what })} · ${clock(elapsed)}`
      : job.state === "running"
      ? `${t("Making the {what} — {percent}%", { what, percent: Math.round(progress * 100) })} · ${clock(elapsed)}${left !== null ? ` · ${t("about {minutes} min left", { minutes: Math.max(1, Math.ceil(left / 60)) })}` : ""}`
      : job.state === "succeeded" ? t("Done — added to the media library")
        : job.state === "cancelled" ? t("Cancelled")
          : job.error?.message ?? t("It did not finish");
  return (
    <View testID="job-progress" {...({ dataSet: { state: job.state, jobId: job.jobId } } as object)}
      style={{ marginStart: 7, marginTop: space[1], padding: space[2], gap: space[1.5], borderRadius: radius.sm, borderWidth: 1, borderColor: theme.color(job.state === "failed" ? "danger" : "border/hairline"), backgroundColor: theme.color("bg/subtle") }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}>
        {ended ? <Icon name={job.state === "succeeded" ? "check-c" : job.state === "failed" ? "x-c" : "minus"} size={14} color={job.state === "succeeded" ? "success" : job.state === "failed" ? "danger" : "text/secondary"} /> : <Spinner size={12} label={line} />}
        <Text variant="meta" color={job.state === "failed" ? "danger/text" : "text/secondary"} style={{ flex: 1 }}>{line}</Text>
        {!ended ? <Button size="xs" kind="ghost" label={t("Stop")} testID="job-progress-stop" onPress={() => void connection?.call<{ job: GenerationJob }>("jagentchill.job.cancel", { jobId: job.jobId }).then((result) => setJob(result.job), () => undefined)} /> : null}
      </View>
      {!ended ? <ProgressBar thin value={job.state === "running" && progress > 0 ? progress * 100 : null} label={line} /> : null}
    </View>
  );
}

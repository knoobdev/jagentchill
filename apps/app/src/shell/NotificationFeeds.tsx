import { usePathname, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { NOTICE_CATEGORY_LABELS, PREFS, categoryOf, isWaiting, outsideDecision, outsideNotification, type NoticeCategory } from "@jagentchill/app-core";
import { useHost } from "../host";
import { useT } from "../locale";
import { notifications, useNotifications, type Notice } from "../notifications";
import { appInFront, onOutsideOpened, osKind, osPermission, setOsBadge, showOutside, type OsPermission } from "../platform/osNotify";
import { useLibraryState, usePref } from "../state";
import { useSync } from "../sync/SyncProvider";

type Waiting = { subject: string; message: string; route: string; category: NoticeCategory };
/** Whether notifications are shown outside the app on this device: the person's choice, or the default of the platform (on in the desktop app, off in a browser). */
export const outsideOn = (choice: "default" | "on" | "off"): boolean => (choice === "on" ? true : choice === "off" ? false : osKind() === "desktop");

/**
 * What feeds the notification centre from the host and from this device, and what shows a new entry outside the app.
 * Everything listed here really happened: a request the host announced, a run it ended, a state the sync engine holds.
 * (Hand-offs, sign-offs, proposals and disagreements arrive through `AgentNotices`; exports, imports and automations
 * add their own entries where they finish.)
 */
export function NotificationFeeds(): null {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const { host, connection, status, onEvent, approvals, pairingRequests } = useHost();
  const sync = useSync();
  const library = useLibraryState();
  const entries = useNotifications();
  const [choice] = usePref(PREFS.notifyOutside);
  const [onlyUnfocused] = usePref(PREFS.notifyOnlyUnfocused);
  const [off] = usePref(PREFS.notifyOff);
  const hostId = host?.gatewayId;
  const connected = status === "connected";
  const where = useRef(pathname);
  where.current = pathname;
  const filmActivity = useRef(new Map<string, Set<string>>());
  const noLonger = (subject: string) => notifications.resolve(subject, (was) => t("No longer waiting — {message}", { message: was }));
  /** The things of one kind that wait right now: each is listed once, and what no longer waits stops waiting here too. */
  const reconcile = (prefix: string, waiting: Waiting[]) => {
    for (const item of waiting) notifications.add({ kind: "warning", ...item });
    for (const entry of notifications.list()) if (entry.subject?.startsWith(prefix) && isWaiting(entry) && !waiting.some((item) => item.subject === entry.subject)) noLonger(entry.subject);
  };

  // — A device asks to pair —
  // The entry says only that a device asks (the code is shown inside the app, on the Devices page). It waits until the
  // host says the pairing is over, or the request has expired: closing the dialog on this device does not end it.
  const pairEnds = useRef(new Map<string, number>());
  useEffect(() => {
    if (!hostId || !connected) return;
    for (const request of pairingRequests) {
      const subject = `pair:${hostId}:${request.requestId}`;
      pairEnds.current.set(subject, request.expires_ms);
      notifications.add({ kind: "warning", category: "pairing", subject, route: `/devices?requestId=${encodeURIComponent(request.requestId)}`, message: t("{device} asks to pair", { device: request.deviceName }) });
    }
    const expire = () => { for (const [subject, ends] of pairEnds.current) if (ends <= Date.now()) { pairEnds.current.delete(subject); noLonger(subject); } };
    expire();
    const timer = setInterval(expire, 30_000);
    const off = onEvent((event) => {
      if (event.event !== "jagentchill.pairing.completed") return;
      const id = (event.payload as { request?: { requestId?: string } } | undefined)?.request?.requestId;
      if (id) { pairEnds.current.delete(`pair:${hostId}:${id}`); noLonger(`pair:${hostId}:${id}`); }
    });
    return () => { clearInterval(timer); off(); };
  }, [hostId, connected, pairingRequests, onEvent]); // eslint-disable-line react-hooks/exhaustive-deps
  // — The host waits for the approval of a command —
  useEffect(() => {
    if (!hostId || !connected) return;
    reconcile(`approval:${hostId}:`, approvals.map((approval) => ({ subject: `approval:${hostId}:${approval.approvalId}`, message: t("The agent asks for permission: {what}", { what: approval.title }), route: `/h/${hostId}/sessions/${encodeURIComponent(approval.sessionKey)}`, category: "needs-you" })));
  }, [hostId, connected, approvals]); // eslint-disable-line react-hooks/exhaustive-deps

  // — The agent asks in a chat (a permission, a paid call, a question); a run of a workflow ended or waits —
  useEffect(() => {
    if (!hostId) return;
    // Job updates are otherwise sent only to a screen that is watching the job. The inbox is
    // itself a consumer, so subscribe for its lifetime and reconcile terminal events here.
    void connection?.call("jagentchill.job.subscribe", {}).catch(() => undefined);
    return onEvent((event) => {
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const session = (key: unknown) => `/h/${hostId}/sessions/${encodeURIComponent(String(key))}`;
      // Looking at that very chat, with the app in front: the card is on screen, the entry is listed as read.
      const seen = (route: string, subject: string) => { if (where.current === decodeURIComponent(route) || where.current === route) { const entry = notifications.list().find((item) => item.subject === subject); if (entry && appInFront()) notifications.markRead(entry.id); } };
      if (event.event === "jagentchill.chat.permission.requested") {
        const request = payload.request as { requestId?: string; sessionKey?: string; toolLabel?: string; money?: unknown } | undefined;
        if (!request?.requestId || !request.sessionKey) return;
        const subject = `permission:${hostId}:${request.requestId}`, route = session(request.sessionKey), what = request.toolLabel ?? "";
        notifications.add(request.money
          ? { kind: "warning", category: "money", subject, route, message: t("Waiting for your OK before it spends money: {what}", { what }), quiet: where.current === route && appInFront() }
          : { kind: "warning", category: "needs-you", subject, route, message: t("The agent asks for permission: {what}", { what }), quiet: where.current === route && appInFront() });
        seen(route, subject);
      } else if (event.event === "jagentchill.chat.permission.resolved") {
        const id = (payload.request as { requestId?: string } | undefined)?.requestId ?? payload.requestId;
        if (id) noLonger(`permission:${hostId}:${String(id)}`);
      } else if (event.event === "jagentchill.chat.question.requested") {
        const question = payload.question as { questionId?: string; sessionKey?: string; questions?: { text?: string }[] } | undefined;
        if (!question?.questionId || !question.sessionKey) return;
        const subject = `question:${hostId}:${question.questionId}`, route = session(question.sessionKey), text = Array.from(question.questions?.[0]?.text ?? "").slice(0, 160).join("");
        notifications.add({ kind: "warning", category: "needs-you", subject, route, message: t("The agent asks: {question}", { question: text }), quiet: where.current === route && appInFront() });
        seen(route, subject);
      } else if (event.event === "jagentchill.chat.question.resolved") {
        const id = (payload.question as { questionId?: string } | undefined)?.questionId ?? payload.questionId;
        if (id) noLonger(`question:${hostId}:${String(id)}`);
      } else if (event.event === "jagentchill.chat.turn.ended") {
        const ended = payload as { sessionKey?: string; runId?: string; state?: string };
        if (!ended.sessionKey || (ended.state !== "final" && ended.state !== "error" && ended.state !== "aborted")) return;
        const route = session(ended.sessionKey), name = t("Agent");
        notifications.add({
          kind: ended.state === "final" ? "success" : "error", category: "finished",
          ...(ended.runId ? { subject: `turn:${hostId}:${ended.runId}` } : {}), route,
          message: ended.state === "final" ? t("“{name}” finished", { name }) : ended.state === "aborted" ? t("“{name}” stopped", { name }) : t("“{name}” failed", { name }),
          quiet: where.current === route && appInFront(),
        });
      } else if (event.event === "jagentchill.workflow.notice") {
        const notice = payload as { runId?: string; kind?: string; status?: string; pauseReason?: string; title?: string; body?: string; workflowName?: string; link?: string };
        if (!notice.runId) return;
        const route = `/h/${hostId}/workflows/runs/${notice.runId}`, name = notice.workflowName || notice.title || "", here = where.current === route && appInFront();
        const said = notice.body ? ` — ${Array.from(notice.body).slice(0, 160).join("")}` : "";
        if (notice.kind === "ended" && notice.status === "succeeded") notifications.add({ kind: "success", category: "finished", subject: `run-finished:${hostId}:${notice.runId}`, route, message: t("“{name}” finished", { name }), quiet: here });
        else if (notice.kind === "ended" && notice.status === "failed") notifications.add({ kind: "error", category: "finished", subject: `run-failed:${hostId}:${notice.runId}`, route, message: `${t("“{name}” failed", { name })}${said}`, quiet: here });
        else if (notice.kind === "ended" && notice.status === "paused") notifications.add({ kind: "warning", category: notice.pauseReason === "budget_exceeded" ? "money" : "needs-you", route, subject: `run-paused:${hostId}:${notice.runId}`, message: t("“{name}” paused: {reason}", { name, reason: notice.pauseReason ?? t("It needs your attention") }), quiet: here });
        else if (notice.kind === "attention") notifications.add({ kind: "warning", category: "needs-you", route, message: `${t("A workflow needs you: {name}", { name })}${notice.title && notice.title !== name ? ` — ${notice.title}` : ""}`, quiet: here });
        else if (notice.kind === "notify") notifications.add({ kind: "info", category: "other", ...(notice.link === "none" ? {} : { route }), message: `${notice.title ?? name}${said}` });
        // A run that goes on or ends is no longer paused for money.
        if (notice.kind === "ended" && notice.status !== "paused") {
          noLonger(`run-paused:${hostId}:${notice.runId}`);
          noLonger(`run-budget:${hostId}:${notice.runId}`);
        }
      } else if (event.event === "jagentchill.job.updated") {
        const job = payload.job as { jobId?: string; state?: string; kind?: string; sessionId?: string; projectId?: string; batchId?: string } | undefined;
        if (!job?.jobId || (job.state !== "succeeded" && job.state !== "failed")) return;
        const subject = `generation:${hostId}:${job.jobId}`;
        const route = job.sessionId ? session(job.sessionId) : job.projectId ? `/editor/${job.projectId}` : "/projects";
        notifications.add({ kind: job.state === "succeeded" ? "success" : "error", category: "finished", subject, route, message: job.state === "succeeded" ? t("Generation finished") : t("Generation failed") });
      } else if (event.event === "jagentchill.film.updated") {
        const film = payload.film as { id?: string; title?: string } | undefined;
        const activity = payload.activity as Record<string, { state?: string; message?: string }> | undefined;
        if (!film?.id || !activity) return;
        const key = `${hostId}:${film.id}`, previous = filmActivity.current.get(key) ?? new Set<string>();
        const currentRunning = new Set(Object.entries(activity).filter(([, item]) => item.state === "running").map(([name]) => name));
        for (const [name, item] of Object.entries(activity)) if (item.state === "failed") {
          const subject = `film:${hostId}:${film.id}:${name}`;
          // Activity messages may contain provider errors or other private work details. Keep the centre factual
          // without copying that raw text into a notification shown outside the app.
          notifications.add({ kind: "error", category: "finished", subject, route: `/h/${hostId}/film/${film.id}`, message: t("“{name}” failed", { name: film.title || t("Film") }) });
        }
        for (const name of previous) if (!currentRunning.has(name) && activity[name]?.state !== "failed") {
          notifications.add({ kind: "success", category: "finished", subject: `film:${hostId}:${film.id}:${name}`, route: `/h/${hostId}/film/${film.id}`, message: t("“{name}” finished", { name: film.title || t("Film") }) });
        }
        filmActivity.current.set(key, currentRunning);
      }
    });
  }, [hostId, connection, onEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  // — A project changed here and on another device —
  useEffect(() => {
    const known = Object.keys(sync.statuses);
    if (known.length === 0) return;
    const name = (id: string) => library.projects.find((project) => project.id === id)?.name ?? "";
    const waiting = known.filter((id) => sync.statuses[id]?.kind === "conflict").map((id): Waiting => ({ subject: `conflict:${id}`, message: t("“{name}” changed here and on another device", { name: name(id) }), route: `/editor/${id}`, category: "sync" }));
    for (const item of waiting) notifications.add({ kind: "warning", ...item });
    for (const entry of notifications.list()) if (entry.subject?.startsWith("conflict:") && isWaiting(entry) && known.includes(entry.subject.slice(9)) && !waiting.some((item) => item.subject === entry.subject)) noLonger(entry.subject);
  }, [sync.statuses]); // eslint-disable-line react-hooks/exhaustive-deps
  // — A file a project needs did not arrive on this device —
  useEffect(() => {
    if (!sync.engine) return;
    const transfers = sync.engine.transfers().filter((transfer) => transfer.direction === "download");
    const failed = transfers.filter((transfer) => transfer.state === "failed" || transfer.state === "no-space" || transfer.state === "too-large");
    for (const transfer of failed) {
      notifications.add({
        kind: "error", category: "media", subject: `media:${transfer.projectId}:${transfer.assetId}`, route: `/editor/${transfer.projectId}`,
        message: transfer.state === "no-space" ? t("“{name}” could not be fetched: this device is out of space", { name: transfer.name }) : transfer.state === "too-large" ? t("“{name}” could not be fetched: it is larger than the transfer limit", { name: transfer.name }) : t("“{name}” could not be fetched to this device", { name: transfer.name }),
      });
    }
    for (const transfer of transfers.filter((entry) => entry.state === "done")) noLonger(`media:${transfer.projectId}:${transfer.assetId}`);
  }, [sync.engine, sync.version]); // eslint-disable-line react-hooks/exhaustive-deps

  // — Outside the app: a new entry is shown by the operating system when the person turned that on —
  const permission = useRef<OsPermission>("default");
  const outside = outsideOn(choice);
  useEffect(() => { let gone = false; void osPermission().then((state) => { if (!gone) permission.current = state; }); return () => { gone = true; }; }, [choice, outside]);
  const live = useRef({ outside, onlyUnfocused, off, t, router });
  live.current = { outside, onlyUnfocused, off, t, router };
  useEffect(() => notifications.onArrival((notice: Notice) => {
    const now = live.current;
    const decision = outsideDecision(notice, { outside: now.outside, onlyUnfocused: now.onlyUnfocused, off: now.off }, { focused: appInFront(), permission: permission.current });
    if (!decision.show) return;
    showOutside(outsideNotification(notice, now.t(NOTICE_CATEGORY_LABELS[categoryOf(notice)].label)), () => { notifications.markRead(notice.id); if (notice.route) now.router.push(notice.route as never); });
  }), []);
  // The desktop app opens the route of a clicked notification itself; here the entry becomes read.
  useEffect(() => onOutsideOpened((id) => notifications.markRead(id)), []);
  // The application icon carries the number of things that wait for the person.
  const waitingCount = entries.filter(isWaiting).length;
  useEffect(() => setOsBadge(waitingCount), [waitingCount]);
  return null;
}

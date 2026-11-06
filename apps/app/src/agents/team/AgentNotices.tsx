import { useEffect } from "react";
import { useRouter } from "expo-router";
import type { AgentNotice } from "@jagentchill/protocol";
import { noticeRoute, noticeSubject, reconcileNotices } from "@jagentchill/app-core";
import { useToast } from "@jagentchill/ui";
import { useHost } from "../../host";
import { useT } from "../../locale";
import { notifications } from "../../notifications";

/**
 * What the host says needs a person in one of their sessions — a hand-off that waits for them, a result to sign off
 * (and the one reminder of it), a proposal a reviewer agent could not pass, a disagreement in a team — is shown at
 * once and kept in the notification inbox of this device with the way to the CARD it is about. When any device
 * decided it (or it ended), the host says so and the entry stops waiting here too; a device that was away reads what
 * still waits when it connects.
 */
export function AgentNotices(): null {
  const t = useT(), toast = useToast(), router = useRouter();
  const { host, connection, onEvent } = useHost();
  const hostId = host?.gatewayId;
  useEffect(() => {
    if (!hostId) return;
    const sentence = (notice: AgentNotice) => (notice.kind === "agent.handoff_pending" ? t("{from} asks to hand work over to {to}. You decide.", { from: notice.from ?? t("An agent"), to: notice.to ?? t("another agent") })
      : notice.kind === "agent.approval_required" ? (notice.reminder ? t("Still waiting for you: the result of {team} needs your sign-off", { team: notice.title ?? t("the team") }) : t("The result of {team} is ready for your sign-off", { team: notice.title ?? t("the team") }))
      : notice.kind === "agent.proposal_ready" ? t("The proposal “{title}” needs your decision", { title: notice.title ?? "" })
      : t("{team} disagrees on something and needs your decision", { team: notice.title ?? t("the team") }));
    const keep = (notice: AgentNotice) => notifications.add({ kind: "warning", message: sentence(notice), route: noticeRoute(hostId, notice), subject: noticeSubject(hostId, notice) });
    const settle = (subject: string) => notifications.resolve(subject, (was) => t("No longer waiting — {message}", { message: was }));
    const off = onEvent((event) => {
      if (event.event !== "jagentchill.agent.notice") return;
      const notice = event.payload as AgentNotice | undefined;
      if (!notice?.kind || !notice.sessionKey || !notice.subjectId) return;
      if (notice.resolved) { settle(noticeSubject(hostId, notice)); return; }
      toast.show({ kind: "info", message: sentence(notice), action: { label: t("Show"), onPress: () => router.push(noticeRoute(hostId, notice) as never) } });
      keep(notice);
    });
    // Connected (again): what was decided elsewhere meanwhile stops waiting here, what was raised meanwhile is listed.
    let gone = false;
    if (connection?.ready.scopes.includes("jagentchill.agent.use")) {
      void connection.call<{ notices: AgentNotice[] }>("jagentchill.agent.notice.list", {}).then(({ notices }) => {
        if (gone) return;
        const todo = reconcileNotices(hostId, notifications.list(), notices);
        todo.resolve.forEach(settle);
        todo.add.forEach(keep);
      }).catch(() => undefined);
    }
    return () => { gone = true; off(); };
  }, [onEvent, connection, hostId, t, toast, router]);
  return null;
}

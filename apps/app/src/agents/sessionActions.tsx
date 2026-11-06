import { usePathname, useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { DestructiveConfirmDialog, FormDialog, FormField, Input, useToast, type MenuItem } from "@jagentchill/ui";
import { sessionTitle, useHost, type Session } from "../host";
import { useT } from "../locale";
import { copyText } from "../platform/media";
import { reasonOf } from "./errors";

/** Rename, fork and delete of a session, with their dialogs: used by the sidebar list and by the session's own menu. */
export function useSessionActions(): { menu(session: Session): MenuItem[]; rename(session: Session): void; remove(session: Session): void; fork(session: Session, messageId?: string): Promise<void>; dialogs: ReactNode } {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const { host, connection, can, addSession, removeSession } = useHost();
  const [renaming, setRenaming] = useState<Session | null>(null);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const mayAct = can("jagentchill.agent.use");
  const open = (session: Session) => router.push(`/h/${host!.gatewayId}/sessions/${encodeURIComponent(session.sessionKey)}` as never);

  const fork = async (session: Session, messageId?: string) => {
    try {
      const result = await connection!.call<{ session: Session; carried: "transcript" | "summary" }>("jagentchill.session.fork", { sessionKey: session.sessionKey, ...(messageId ? { boundary: { messageId } } : {}) });
      addSession(result.session);
      toast.show({ kind: "success", message: result.carried === "summary" ? t("Session forked — the conversation travels as a summary") : t("Session forked") });
      open(result.session);
    } catch (error) { toast.show({ kind: "error", message: reasonOf(error) }); }
  };
  const submitRename = async () => {
    if (!renaming || !name.trim()) return;
    setBusy(true);
    try { await connection!.call("jagentchill.session.update", { sessionKey: renaming.sessionKey, title: name.trim() }); setRenaming(null); }
    catch (error) { toast.show({ kind: "error", message: reasonOf(error) }); }
    finally { setBusy(false); }
  };
  const submitDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await connection!.call("jagentchill.session.delete", { sessionKey: deleting.sessionKey });
      removeSession(deleting.sessionKey);
      // The open session is gone: the list takes its place.
      if (pathname.includes(encodeURIComponent(deleting.sessionKey)) || pathname.includes(deleting.sessionKey)) router.replace(`/h/${host!.gatewayId}/sessions` as never);
      toast.show({ kind: "success", message: t("Session deleted") });
      setDeleting(null);
    } catch (error) { toast.show({ kind: "error", message: reasonOf(error) }); }
    finally { setBusy(false); }
  };
  const rename = (session: Session) => { setName(sessionTitle(session)); setRenaming(session); };
  return {
    rename, remove: setDeleting, fork,
    menu: (session) => [
      { id: "open", label: t("Open"), icon: "ext", onSelect: () => open(session) },
      { id: "rename", label: t("Rename"), icon: "pencil", keys: ["F2"], disabled: !mayAct, onSelect: () => rename(session) },
      { id: "fork", label: t("Fork session"), icon: "split", disabled: !mayAct, onSelect: () => void fork(session) },
      { id: "copy-id", label: t("Copy session ID"), icon: "copy", onSelect: () => void copyText(session.sessionKey).then((ok) => ok && toast.show({ kind: "success", message: t("Session ID copied") })) },
      { type: "separator" },
      { id: "delete", label: t("Delete session…"), icon: "trash", danger: true, disabled: !mayAct, onSelect: () => setDeleting(session) },
    ],
    dialogs: (
      <>
        <FormDialog open={renaming !== null} title={t("Rename session")} submitLabel={t("Rename")} onSubmit={() => void submitRename()} onClose={() => setRenaming(null)} dirty={renaming !== null && name !== sessionTitle(renaming)} busy={busy} canSubmit={name.trim().length > 0 && name.trim().length <= 120} width={360}>
          <FormField label={t("Name")}>{(ids) => <Input value={name} onChangeText={setName} maxLength={120} autoFocus labelledBy={ids.labelledBy} onSubmitEditing={() => void submitRename()} />}</FormField>
        </FormDialog>
        <DestructiveConfirmDialog open={deleting !== null} title={t("Delete session?")} description={deleting ? t("“{name}” and its transcript are removed from the host. Usage records are kept.", { name: sessionTitle(deleting) }) : undefined}
          confirmLabel={t("Delete session")} irreversible busy={busy} onConfirm={() => void submitDelete()} onClose={() => setDeleting(null)} />
      </>
    ),
  };
}

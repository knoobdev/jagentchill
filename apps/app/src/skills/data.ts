import { useCallback, useEffect, useState } from "react";
import type { HostError } from "@jagentchill/client";
import type { SkillRecord } from "@jagentchill/protocol";
import { reasonOf } from "../agents/errors";
import { useHost } from "../host";

/** The sentence for a failed skill call: the host words these itself. */
export function skillReason(error: unknown): string {
  const code = (error as Partial<HostError> | undefined)?.code ?? "";
  const message = (error as { message?: string } | undefined)?.message;
  return /^(skill\/|GATEWAY_UNAVAILABLE$|UNSUPPORTED_FEATURE$|BUDGET_EXCEEDED$)/.test(code) && message ? message : reasonOf(error);
}

export type SkillList = { skills: SkillRecord[] | null; stale: boolean; notices: string[]; error: unknown; reload(): Promise<void> };
/** The skills of the connected host, kept current from the `skill` stream. */
export function useSkills(): SkillList {
  const { connection, onEvent } = useHost();
  const [skills, setSkills] = useState<SkillRecord[] | null>(null);
  const [stale, setStale] = useState(false);
  const [notices, setNotices] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const reload = useCallback(async () => {
    if (!connection) return;
    try {
      const result = await connection.call<{ skills: SkillRecord[]; stale: boolean; notices: string[] }>("jagentchill.skill.list", {});
      setSkills(result.skills); setStale(result.stale); setError(null);
      if (result.notices.length) setNotices((list) => [...list, ...result.notices]);
    } catch (err) { setError(err); }
  }, [connection]);
  useEffect(() => {
    if (!connection) { setSkills(null); return; }
    void reload();
    void connection.call("jagentchill.skill.subscribe", {}).catch(() => undefined);
    const off = onEvent((event) => { if (event.event === "jagentchill.skill.changed") void reload(); });
    return () => { off(); void connection.call("jagentchill.skill.unsubscribe", {}).catch(() => undefined); };
  }, [connection, reload, onEvent]);
  return { skills, stale, notices, error, reload };
}

/** A leading line that names skills, as the composer sends it: `$a $b`, then a blank line, then the person's text. */
export function splitInvocation(text: string): { skills: string[]; text: string } {
  const match = /^((?:\$[a-z0-9]+(?:-[a-z0-9]+)*)(?: \$[a-z0-9]+(?:-[a-z0-9]+)*)*)\n\n([\s\S]*)$/.exec(text);
  return match ? { skills: match[1].split(" ").map((token) => token.slice(1)), text: match[2] } : { skills: [], text };
}

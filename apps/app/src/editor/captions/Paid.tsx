import { useCallback, useRef, useState, type ReactNode } from "react";
import { HostError } from "@jagentchill/client";
import { Text } from "@jagentchill/ui";
import { useAgentData } from "../../agents/data";
import { CostDialog, accountOf, asAgain, costAsk, costAskOf, ownLine, type CostAsk } from "../../generation/CostDialog";
import { costText, useModelNames } from "../../generation/data";
import { useT } from "../../locale";
import type { CostEstimate, Grants } from "./run";

/** The line a tool shows before its paid action: what the host estimates. */
export function EstimateLine(props: { estimate: CostEstimate | null; testID: string }) {
  const t = useT(), agents = useAgentData();
  if (!props.estimate) return null;
  // All of it runs on the person's own account: there is no cost to estimate, and that is what the line says.
  const own = costAsk(t, "translation", props.estimate as unknown as Record<string, unknown>).own;
  if (own?.length && !props.estimate.amountUsd && !props.estimate.needsConfirmation) return <Text variant="meta" color="text/secondary" testID={props.testID} {...({ dataSet: { own: "1" } } as object)}>{ownLine(t, own, accountOf(agents.catalogue?.groups, own))}</Text>;
  return <Text variant="meta" color="text/secondary" testID={props.testID}>{t("Estimated cost: {cost}", { cost: costText(t, { amountUsd: props.estimate.amountUsd, confidence: "approximate" }) })}</Text>;
}

/**
 * Runs paid work a person starts: captions, a translation, speech. Money is their decision, asked ONCE — the shared
 * cost dialog. The estimate it shows is asked from the host AT Start (`quote`): that call puts the host's question on
 * record and names it, and Start sends those names back, so the first answer is the only one. A refusal that still
 * comes (a further paid part would pass what was confirmed) opens the same dialog with what the refusal says.
 * Nothing is asked about what is sent to whom.
 */
export function usePaid(options: { kind: "captions" | "translation" | "speech"; run(grants: Grants): Promise<void>; onError(error: unknown): void; /** The host's estimate of exactly what Start will send, asked now. `null`: nothing to estimate (the run says why). */ quote?(): Promise<CostEstimate | null | "stop">; /** An action that stopped half-way goes on under the answer it had: no new estimate. */ resume?(): Grants | null }): { start(): void; dialogs: ReactNode } {
  const t = useT();
  const nameOf = useModelNames();
  const [cost, setCost] = useState<CostAsk | null>(null);
  // Two presses on Generate are one action; so are two on Start.
  const busy = useRef(false);
  const { run, onError, kind, quote, resume } = options;
  // The question names the model as the catalogue calls it, never by its raw id where the catalogue has a name.
  const named = useCallback((estimate: Record<string, unknown>): Record<string, unknown> => ({ ...estimate, ...(typeof estimate.model === "string" ? { model: nameOf(estimate.model) } : {}), ...(typeof estimate.listener === "string" ? { listener: nameOf(estimate.listener) } : {}) }), [nameOf]);
  const attempt = useCallback(async (grants: Grants) => {
    try { await run(grants); } catch (error) {
      // The host asks before the first paid call — and once more when a further paid part of a confirmed action (a
      // repair, another model stepping in) would pass what was confirmed or has no known price: that refusal carries
      // what was spent so far and `confirmWith`, which the dialog's answer sends back unchanged.
      const details = error instanceof HostError && error.code === "PERMISSION_DENIED" ? error.details : undefined;
      const ask = details && (!grants.confirmed || details.confirmWith !== undefined || typeof details.spentUsd === "number") ? costAskOf(t, { ...details, estimate: named((details.estimate ?? {}) as Record<string, unknown>) }, kind) : null;
      // Asked after an answer was given: the second question, in its own words — never the first one again.
      if (ask) return setCost(grants.confirmed ? asAgain(ask) : ask);
      onError(error);
    }
  }, [run, onError, kind, t, named]);
  const start = () => {
    if (busy.current) return;
    busy.current = true;
    void (async () => {
      try {
        const going = resume?.();
        if (going) return await attempt(going);
        // No estimate (the host could not give one): the action itself is asked, and its refusal carries the question.
        const known = quote ? await quote().catch(() => null) : null;
        // The person cancelled while the estimate was being prepared.
        if (known === "stop") return;
        if (known?.needsConfirmation) setCost(costAsk(t, kind, named(known as unknown as Record<string, unknown>), known)); else await attempt({});
      } finally { busy.current = false; }
    })();
  };
  const answered = (answer: Grants) => { if (busy.current) return; busy.current = true; setCost(null); void attempt(answer).finally(() => { busy.current = false; }); };
  const dialogs = cost ? <CostDialog ask={cost} onClose={() => setCost(null)} onStart={answered} /> : null;
  return { start, dialogs };
}

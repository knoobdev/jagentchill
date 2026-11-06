import { useEffect, useState } from "react";
import { View } from "react-native";
import type { AgentArtefact, ProposalView } from "@jagentchill/protocol";
import { Badge, Button, Text, space } from "@jagentchill/ui";
import { useHost } from "../../host";
import { useT } from "../../locale";
import { ProposalCard } from "../proposals/ProposalCard";
import { useProposals } from "../proposals/data";

/** The proposal a chip opened: the same card the chat shows for it, with its changes and — while it waits — its decision. */
function OpenedProposal(props: { proposalId: string }) {
  const t = useT();
  const { connection, status } = useHost();
  const [author, setAuthor] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!connection || status !== "connected") return;
    let cancelled = false;
    setAuthor(undefined);
    void connection.call<{ proposal: ProposalView }>("jagentchill.proposal.get", { proposalId: props.proposalId }).then((got) => { if (!cancelled) setAuthor(got.proposal.author.sessionId); }).catch(() => { if (!cancelled) setAuthor(null); });
    return () => { cancelled = true; };
  }, [connection, status, props.proposalId]);
  if (author === null) return <Text variant="meta" color="text/secondary" testID="artefact-missing">{t("This proposal is no longer available.")}</Text>;
  return author ? <ProposalOf sessionKey={author} proposalId={props.proposalId} /> : null;
}
function ProposalOf(props: { sessionKey: string; proposalId: string }) {
  const t = useT();
  const api = useProposals({ sessionKey: props.sessionKey });
  const proposal = api.proposals.find((entry) => entry.proposalId === props.proposalId);
  if (!proposal) return api.loaded ? <Text variant="meta" color="text/secondary" testID="artefact-missing">{t("This proposal is no longer available.")}</Text> : null;
  return <View testID={`artefact-open-${props.proposalId}`} {...({ dataSet: { state: proposal.state } } as object)}><ProposalCard proposal={proposal} resolve={api.resolve} revert={api.revert} /></View>;
}

/**
 * What is attached to a hand-back or a result. A proposal is a chip that opens it right here — its changes, and the
 * decision while it waits; a note is what its title says and has nothing behind it to open.
 */
export function ArtefactChips(props: { artefacts: AgentArtefact[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!props.artefacts.length) return null;
  return (
    <View style={{ gap: space[2] }} testID="artefact-chips">
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[1] }}>
        {props.artefacts.map((entry) => entry.kind === "proposal"
          ? <Button key={entry.id} size="xs" icon="doc" trailingIcon={open === entry.id ? "chev-d" : "chev-r"} label={entry.title} testID={`artefact-chip-${entry.id}`} expanded={open === entry.id} onPress={() => setOpen(open === entry.id ? null : entry.id)} />
          : <Badge key={entry.id} label={entry.title} />)}
      </View>
      {open ? <OpenedProposal proposalId={open} /> : null}
    </View>
  );
}

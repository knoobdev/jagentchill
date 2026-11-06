import { formatUsd } from "@jagentchill/app-core";
import { View } from "react-native";
import { Button, Modal, Text, space, useTheme } from "@jagentchill/ui";
import { useAgentData } from "../agents/data";
import { useT } from "../locale";
import { accountOf, costAnswer, ownLine, type CostAnswer, type CostAsk, type CostKind } from "./cost";

export { accountOf, ownLine, answerTo, asAgain, confirmWithOf, costAnswer, costAsk, costAskOf, type CostAnswer, type CostAsk, type CostKind, type CostRow, type CostUnknown, type NameOf } from "./cost";

const money = (amount: number) => formatUsd(amount, { fine: true });
/** An amount too small to print (a few spoken lines cost less than a hundredth of a cent) is never shown as "$0.0000". */
const CENT = 0.01, tiny = (amount: number) => amount > 0 && amount < CENT / 2;
/** The question itself, with the amount when it is known: [with {cost}, without]. One of pictures / voice reads in the singular. */
const TITLES: Record<CostKind | "picture" | "line" | "clip", [string, string]> = {
  clips: ["Set these shots in motion for about {cost}?", "Set these shots in motion? The cost is not known"],
  clip: ["Set this shot in motion for about {cost}?", "Set this shot in motion? The cost is not known"],
  film: ["Make this film for about {cost}?", "Make this film? Its cost is not known"],
  pictures: ["Draw these pictures for about {cost}?", "Draw these pictures? The cost is not known"],
  picture: ["Draw this picture for about {cost}?", "Draw this picture? The cost is not known"],
  voice: ["Record these voice lines for about {cost}?", "Record these voice lines? The cost is not known"],
  line: ["Record this voice line for about {cost}?", "Record this voice line? The cost is not known"],
  music: ["Make this music for about {cost}?", "Make this music? The cost is not known"],
  captions: ["Make the captions for about {cost}?", "Make the captions? The cost is not known"],
  translation: ["Translate the captions for about {cost}?", "Translate the captions? The cost is not known"],
  speech: ["Read this text aloud for about {cost}?", "Read this text aloud? The cost is not known"],
};
/** The question when the amount covers only a part of the work: the rest is done by a model whose price is not known, and the title must not read as the whole cost. */
/** A film quoted before its script exists: the amount is the MOST it may cost, and the question says "up to". */
const UPPER: [string, string] = ["Make this film for up to {cost}?", "Make this film for up to {cost}, plus work whose price is not known?"];
const PLUS: Partial<Record<CostKind | "picture" | "line" | "clip", string>> = {
  film: "Make this film for about {cost}, plus work whose price is not known?",
  pictures: "Draw these pictures for about {cost}, plus a check whose price is not known?",
  picture: "Draw this picture for about {cost}, plus a check whose price is not known?",
};
/**
 * "Make this film for about $0.12?" — the one question about money, the same for a film, a picture, captions or
 * speech. A person reads the title, the rows and the button, so that is all there is: the question with its amount,
 * what is made row by row, and at most three short lines — what runs on their own account (not billed here), that an
 * upper limit is usually not reached, and when they would be asked again. Nothing here is about what is sent where,
 * and why the host asks at all is said in Settings beside the setting.
 */
export function CostDialog(props: { ask: CostAsk; busy?: boolean; /** Start: `answer` is what the action is sent again with. */ onStart(answer: CostAnswer): void; onClose(): void }) {
  const t = useT(), theme = useTheme();
  const agents = useAgentData();
  const { ask } = props, known = ask.amountUsd !== null;
  // One picture, or one voice line (its read-back check is a row of its own).
  const single = ask.kind === "voice" ? ask.rows.find((row) => row.id === "voice")?.count === 1 : ask.rows.length === 1 && ask.rows[0].count === 1;
  // Work without a price is named row by row; the amount is then the total of the rest, and says so.
  const plus = known && (ask.subtotal === true || ask.unknown.length > 0), total = ask.rows.length > 1 || !known || ask.unknown.length > 0;
  const which = single && ask.kind === "pictures" ? "picture" : single && ask.kind === "voice" ? "line" : single && ask.kind === "clips" ? "clip" : ask.kind, words = TITLES[which];
  // "About": a total under one cent reads as one cent — never less than it will cost.
  const about = known ? (tiny(ask.amountUsd!) ? formatUsd(CENT) : money(ask.amountUsd!)) : "";
  const again = ask.again;
  const title = again && !known ? (ask.kind === "translation" ? t("Finish this translation with a model whose price is not known?") : t("Finish this with a model whose price is not known?"))
    : again ? (ask.kind === "translation" ? t("This translation would cost more than you confirmed") : t("This would cost more than you confirmed")) : known && ask.upper && ask.kind === "film" ? t(UPPER[plus ? 1 : 0], { cost: about }) : known && ask.upper && which === "line" && !plus ? t("Record this voice line for up to {cost}?", { cost: about }) : known ? t((plus ? PLUS[which] : undefined) ?? words[0], { cost: about }) : t(words[1]);
  const model = ask.rows.find((row) => row.model)?.model ?? "";
  // The figures of a second question are printed as they are (five decimals under a tenth of a cent); when even the
  // new total is under half a cent there is no figure worth reading, and the sentence says only that.
  const exact = (amount: number) => (amount > 0 && amount < 0.001 ? `$${amount.toFixed(5)}` : money(amount)), small = !!again && known && tiny(ask.amountUsd!);
  const over = known && ask.remainingUsd !== null && ask.amountUsd! > ask.remainingUsd + 1e-9;
  return (
    <Modal title={title} width={480} onClose={props.onClose}
      footer={<><View style={{ flex: 1 }} /><Button size="sm" label={t("Cancel")} testID="cost-cancel" onPress={props.onClose} /><Button size="sm" kind="primary" label={again ? (small || !known ? t("Confirm and continue") : t("Confirm {amount} and continue", { amount: money(ask.amountUsd!) })) : t("Start")} testID="cost-start" loading={props.busy} onPress={() => props.onStart(costAnswer(ask))} /></>}>
      <View testID="cost-dialog" {...({ dataSet: { kind: ask.kind, known: known ? "1" : "0", again: again ? "1" : "0", via: ask.via ?? "" } } as object)} style={{ gap: space[3] }}>
        {/* A second question says first why it is asked again: what was spent, what was confirmed, the new total. */}
        {again && !known ? (
          // The model that was doing the work could not finish, and the next one has no price here.
          <Text testID="cost-again">{`${model ? t("The model that was doing this could not finish it. The next one, {model}, has no price this app knows.", { model }) : t("The model that was doing this could not finish it. The next one has no price this app knows.")} ${t("Nothing more is spent until you confirm.")}`}</Text>
        ) : again ? (
          <Text testID="cost-again">{`${small ? t("One more step is needed to finish this, and with it the cost passes what you confirmed — it is still under {amount} in all.", { amount: formatUsd(CENT) }) : again.confirmedUsd === null ? t("What is still to do costs more than what you confirmed covers. It now comes to about {total}.", { total: money(ask.amountUsd!) }) : t("It has cost {spent} so far and would pass the {confirmed} you confirmed. It now comes to about {total}.", { spent: exact(again.spentUsd), confirmed: exact(again.confirmedUsd), total: money(ask.amountUsd!) })} ${t("Nothing more is spent until you confirm.")}`}</Text>
        ) : null}
        {/* A second question says what is already paid and what is still to pay. */}
        {again && (again.spentUsd > 0 || again.remainsUsd !== null) ? (
          <View testID="cost-progress" style={{ gap: space[1] }}>
            <View style={{ flexDirection: "row", gap: space[3] }}><Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{t("Spent so far")}</Text><Text variant="meta" tabular testID="cost-spent">{tiny(again.spentUsd) ? t("under {amount}", { amount: formatUsd(CENT) }) : money(again.spentUsd)}</Text></View>
            {again.remainsUsd !== null || !known ? <View style={{ flexDirection: "row", gap: space[3] }}><Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{t("Still to pay")}</Text><Text variant="meta" tabular testID="cost-remains">{again.remainsUsd === null ? t("Not known") : tiny(again.remainsUsd) ? t("under {amount}", { amount: formatUsd(CENT) }) : t("about {cost}", { cost: money(again.remainsUsd) })}</Text></View> : null}
          </View>
        ) : null}
        <View style={{ gap: space[2] }}>
          {ask.rows.map((row) => (
            <View key={row.id} testID={`cost-row-${row.id}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: space[3] }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="body-medium">{row.label}</Text>
                {row.model ? <Text variant="meta" color="text/secondary">{t("Made with {model}", { model: row.model })}</Text> : null}
              </View>
              <Text tabular color={row.usd === null ? "text/secondary" : "text/primary"} {...(total ? {} : { testID: "cost-amount" })}>{row.usd === null ? t("Price not known") : tiny(row.usd) ? t("under {amount}", { amount: formatUsd(CENT) }) : money(row.usd)}</Text>
            </View>
          ))}
          {/* What has no price here is said part by part, with who does it: never left out, never counted as nothing. */}
          {ask.unknown.map((part) => (
            <View key={part.id} testID={`cost-unknown-${part.id}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: space[3] }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="body-medium">{part.label}</Text>
                {part.model ? <Text variant="meta" color="text/secondary">{t("Done by {model}", { model: part.model })}</Text> : null}
              </View>
              <Text tabular color="text/secondary">{t("Price not known")}</Text>
            </View>
          ))}
          {total ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingTop: space[2], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
              <Text variant="body-medium" style={{ flex: 1 }}>{plus ? t("Total of what has a price") : t("Total")}</Text>
              <Text variant="body-medium" tabular testID="cost-amount">{known ? (ask.upper && !again ? t("up to {cost}", { cost: about }) : t("about {cost}", { cost: about })) : t("Not known")}</Text>
            </View>
          ) : null}
        </View>
        {/* Work on the person's own signed-in account: not billed by this app, so not in the amount — one quiet line. */}
        {ask.own?.length ? <Text variant="meta" color="text/secondary" testID="cost-own">{ownLine(t, ask.own, accountOf(agents.catalogue?.groups, ask.own))}</Text> : null}
        {/* A film whose script is not written yet is quoted by the most its story is expected to need. */}
        {ask.upper && !again ? <Text variant="meta" color="text/secondary" testID="cost-upper">{t("You pay only for what is made — usually less.")}</Text> : null}
        {/* When the person would be asked again: only where the host named the amount. */}
        {!again && typeof ask.stopsAtUsd === "number" && ask.stopsAtUsd > 0 ? <Text variant="meta" color="text/secondary" testID="cost-once">{t("Asked again only if it would pass {amount}.", { amount: money(ask.stopsAtUsd) })}</Text> : null}
        {/* The host's spending limit is said only when it would stop this before it is finished. */}
        {over ? <Text variant="meta" color="danger/text" testID="cost-remaining">{t("Your spending limit leaves {amount} — less than this costs. It will stop when the limit is reached.", { amount: money(ask.remainingUsd!) })}</Text> : null}
      </View>
    </Modal>
  );
}

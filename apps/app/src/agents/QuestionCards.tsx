import { useEffect, useState, type ReactNode } from "react";
import { hostLists } from "./hostLists";
import { View } from "react-native";
import type { Question, QuestionRequest } from "@jagentchill/protocol";
import { Button, Icon, Input, Tap, Text, borderWidth, compactScale, radius, space, typography, useTheme, useToast } from "@jagentchill/ui";
import { useHost } from "../host";
import { useT } from "../locale";
import { allAnswered, answerText, buildAnswers, draftOf, isAnswered, toggleOption, typeAnswer, type QuestionDrafts } from "./questionForm";

/**
 * The question cards of a session (`chat-agent.Agent questions`): what an agent asked with `jc_session_ask` or with its
 * runtime's own "ask the user" tool. Read once, then followed through the question events; answered or skipped from the card.
 * Each card is handed to the chat pane with the time it was asked, so it stands at that place of the conversation.
 */
export function useQuestionCards(props: { sessionKey: string; readOnly?: boolean }): Array<{ id: string; ts_ms: number; pending: boolean; node: ReactNode }> {
  const { connection, onEvent, status } = useHost();
  const [questions, setQuestions] = useState<QuestionRequest[]>([]);
  const { sessionKey } = props;
  // The chat is told that the list answered AFTER its questions are on screen (see `hostLists`).
  const [listed, setListed] = useState<string | null>(null);
  useEffect(() => { if (listed) hostLists.answered(listed, "question"); }, [listed]);
  useEffect(() => {
    setQuestions([]); setListed(null);
    // The questions are gone from this view until the list answers again: the chat is told before, not after.
    hostLists.asked(sessionKey, "question");
    if (!connection || status !== "connected") return;
    let cancelled = false;
    const put = (question: QuestionRequest) => setQuestions((live) => (live.some((entry) => entry.questionId === question.questionId) ? live.map((entry) => (entry.questionId === question.questionId ? question : entry)) : [...live, question]));
    void connection.call<{ questions: QuestionRequest[] }>("jagentchill.chat.question.list", { sessionKey }).then((listed) => {
      if (cancelled) return;
      // What arrived as an event while the list was on its way is newer than the list.
      setQuestions((live) => [...listed.questions.filter((entry) => !live.some((own) => own.questionId === entry.questionId)), ...live].sort((a, b) => a.created_ms - b.created_ms));
    }).catch(() => undefined).then(() => { if (!cancelled) setListed(sessionKey); });
    const off = onEvent((event) => {
      if (event.event !== "jagentchill.chat.question.requested" && event.event !== "jagentchill.chat.question.resolved") return;
      const question = (event.payload as { question?: QuestionRequest }).question;
      if (question?.sessionKey === sessionKey) put(question);
    });
    return () => { cancelled = true; off(); };
  }, [connection, status, sessionKey, onEvent]);
  return questions.map((question) => ({
    id: `question-${question.questionId}`, ts_ms: question.created_ms, pending: question.state === "pending",
    node: <QuestionCard question={question} readOnly={props.readOnly} onResolved={(next) => setQuestions((live) => live.map((entry) => (entry.questionId === next.questionId ? next : entry)))} />,
  }));
}

/** The fixed selection control of an option row, and the dot of a picked single-select option. */
const CONTROL = 18, DOT = 8;

/**
 * One question request of the chat. While it waits it is a form: one question on screen at a time (tabs when the agent
 * asked several), its options as full-width rows, a field for a free answer, then Dismiss and Next / Submit. Once
 * resolved it shrinks to a line per question, like the other outcome notes of the transcript.
 */
function QuestionCard(props: { question: QuestionRequest; readOnly?: boolean; onResolved(question: QuestionRequest): void }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const { connection } = useHost();
  const { question } = props;
  const [drafts, setDrafts] = useState<QuestionDrafts>({});
  const [busy, setBusy] = useState<"submit" | "dismiss" | null>(null);
  const [index, setIndex] = useState(0);
  const data = { dataSet: { state: question.state, question: question.questionId } } as object;

  if (question.state !== "pending") {
    return (
      <View testID="question-card" {...data} style={{ gap: space[1] }}>
        {question.questions.map((entry) => {
          const given = question.state === "expired" ? null : answerText(entry, question.answers?.find((answer) => answer.id === entry.id));
          return (
            <View key={entry.id} testID={`question-${entry.id}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: space[1.5] }}>
              <View style={{ height: typography.meta[theme.density].lineHeight, justifyContent: "center" }}><Icon name={given === null ? (question.state === "expired" ? "clock" : "x") : "check"} size={12} color="text/tertiary" /></View>
              <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>
                {entry.text}{"  "}
                <Text variant="meta" color={given === null ? "text/tertiary" : "text/primary"} testID="question-answer" style={{ fontWeight: "500" }}>{given ?? (question.state === "expired" ? t("Expired") : t("Skipped"))}</Text>
              </Text>
            </View>
          );
        })}
      </View>
    );
  }

  const all = question.questions, at = Math.min(index, all.length - 1), active = all[at]!, last = at === all.length - 1;
  const draft = draftOf(drafts, active.id), locked = busy !== null || !!props.readOnly;
  const put = (entry: Question, next: ReturnType<typeof toggleOption>) => setDrafts((own) => ({ ...own, [entry.id]: next }));
  const ready = last ? allAnswered(all, drafts) : isAnswered(draft);
  const inset = theme.compact ? compactScale.space.card : space[3], line = typography["body-medium"][theme.density].lineHeight;

  async function send(skip: boolean) {
    if (!connection || locked) return;
    setBusy(skip ? "dismiss" : "submit");
    try {
      const result = await connection.call<{ question: QuestionRequest }>("jagentchill.chat.question.answer", { questionId: question.questionId, answers: skip ? all.map((entry) => ({ id: entry.id, skipped: true })) : buildAnswers(all, drafts) });
      props.onResolved(result.question);
    } catch (error) {
      const failure = error as { code?: string; message?: string };
      toast.show({ kind: "error", message: failure.code === "ALREADY_RESOLVED" ? t("This question was already answered") : failure.message ?? t("The answer could not be sent") });
    } finally { setBusy(null); }
  }
  const primary = () => { if (!ready || locked) return; if (last) void send(false); else setIndex(at + 1); };
  const pick = (label: string) => {
    const next = toggleOption(active, draft, label);
    put(active, next);
    // A single choice is the whole answer: go on to the next question.
    if (active.kind === "single" && next.picked.length > 0 && !last) setIndex(at + 1);
  };
  const size = theme.touch ? "md" : "sm";

  return (
    <View testID="question-card" {...data} style={{ backgroundColor: theme.color("bg/elevated"), borderWidth: borderWidth.hairline, borderColor: theme.color("border/hairline"), borderRadius: radius.md, padding: theme.compact ? compactScale.space.card : space[3], gap: space[3] }}>
      {all.length > 1 ? (
        <View testID="question-tabs" role="tablist" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[1], paddingHorizontal: inset }}>
          {all.map((entry, order) => {
            const on = order === at, done = isAnswered(draftOf(drafts, entry.id)), title = entry.header ?? t("Question {n}", { n: order + 1 });
            return (
              <Tap key={entry.id} role="tab" label={title} selected={on} disabled={busy !== null} testID={`question-tab-${order + 1}`} aria={{ dataSet: { answered: String(done) } }} onPress={() => setIndex(order)}
                style={(state) => ({
                  flexDirection: "row", alignItems: "center", gap: space[1], minHeight: 28, maxWidth: "100%", paddingHorizontal: space[2], paddingVertical: space[1], borderRadius: radius.md, borderWidth: borderWidth.hairline,
                  borderColor: theme.color(on ? "border/strong" : "border/hairline"), backgroundColor: on ? theme.color("bg/subtle") : state.hovered ? theme.color("bg/hover") : "transparent",
                })}>
                {done ? <Icon name="check" size={12} color={on ? "text/primary" : "text/secondary"} /> : null}
                <Text variant="meta" color={on ? "text/primary" : "text/secondary"} numberOfLines={1} style={{ fontWeight: "500", flexShrink: 1 }}>{title}</Text>
              </Tap>
            );
          })}
        </View>
      ) : null}
      <View testID={`question-${active.id}`} style={{ gap: space[3] }}>
        <Text variant="body-medium" testID="question-text" style={{ paddingHorizontal: inset }}>{active.text}</Text>
        <View style={{ gap: space[2] }}>
          {active.options?.length ? (
            <View role={active.kind === "single" ? "radiogroup" : "group"} aria-label={active.text} style={{ gap: space[1] }}>
              {active.options.map((option) => {
                const on = draft.picked.includes(option.label), multi = active.kind === "multi";
                return (
                  <Tap key={option.label} role={multi ? "checkbox" : "radio"} label={option.label} checked={on} disabled={locked} testID="question-option" aria={{ "aria-checked": on }} onPress={() => pick(option.label)}
                    style={(state) => ({
                      flexDirection: "row", alignItems: "flex-start", gap: space[2], minHeight: theme.compact ? compactScale.control.height : undefined, paddingHorizontal: inset, paddingVertical: space[2], borderRadius: radius.md,
                      backgroundColor: on ? theme.color("bg/subtle") : state.hovered || state.pressed ? theme.color("bg/hover") : "transparent",
                    })}>
                    {/* Always drawn at one size: toggling swaps the fill and the border, the row never reflows. */}
                    <View style={{
                      width: CONTROL, height: CONTROL, marginTop: (line - CONTROL) / 2, alignItems: "center", justifyContent: "center", flexShrink: 0, borderWidth: borderWidth.check,
                      borderRadius: multi ? radius.xs : radius.full, borderColor: theme.color(on ? "accent" : "border/control"), backgroundColor: on && multi ? theme.color("accent") : "transparent",
                    }}>
                      {on && multi ? <Icon name="check" size={12} color="text/on-accent" /> : null}
                      {on && !multi ? <View style={{ width: DOT, height: DOT, borderRadius: radius.full, backgroundColor: theme.color("accent") }} /> : null}
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: space[0.5] }}>
                      <Text variant="body-medium" style={{ fontWeight: "600" }}>{option.label}</Text>
                      {option.description ? <Text variant="meta" color="text/secondary">{option.description}</Text> : null}
                    </View>
                  </Tap>
                );
              })}
            </View>
          ) : null}
          {/* A new field per question, so the caret and the scroll of one answer never carry over to the next. */}
          <Input key={active.id} testID="question-other" size="md" aria-label={active.text} placeholder={active.options?.length ? t("Other…") : t("Your answer…")} disabled={locked} value={draft.text} maxLength={2000}
            onChangeText={(text) => put(active, typeAnswer(active, draft, text))} onSubmitEditing={primary} submitBehavior="submit" returnKeyType={last ? "send" : "next"} />
        </View>
      </View>
      {props.readOnly ? null : (
        <View style={theme.compact ? { gap: space[2] } : { flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Button kind="outline" size={size} icon="x" label={t("Dismiss")} testID="question-skip" block={theme.compact} disabled={busy !== null} loading={busy === "dismiss"} onPress={() => void send(true)} />
          <Button kind="primary" size={size} icon="check" label={last ? t("Submit") : t("Next")} testID="question-submit" block={theme.compact} disabled={busy !== null && busy !== "submit" || !ready} loading={busy === "submit"} onPress={primary} />
        </View>
      )}
    </View>
  );
}

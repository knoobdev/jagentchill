import type { Question, QuestionAnswer } from "@jagentchill/protocol";

/** What a person has entered for one question of a question card: the options picked and the text of the free answer. */
export type QuestionDraft = { picked: readonly string[]; text: string };
export type QuestionDrafts = Readonly<Record<string, QuestionDraft>>;
export const EMPTY_DRAFT: QuestionDraft = { picked: [], text: "" };
export const draftOf = (drafts: QuestionDrafts, id: string): QuestionDraft => drafts[id] ?? EMPTY_DRAFT;

/**
 * An option was tapped. Multi-select toggles it. Single-select picks it, or clears it when it was the picked one, and
 * drops the free answer: an option and a typed answer replace each other.
 */
export function toggleOption(question: Question, draft: QuestionDraft, label: string): QuestionDraft {
  const had = draft.picked.includes(label);
  if (question.kind === "multi") return { ...draft, picked: had ? draft.picked.filter((entry) => entry !== label) : [...draft.picked, label] };
  return { picked: had ? [] : [label], text: "" };
}

/** The free answer changed. Typing into a single-select question clears its picked option; multi-select keeps both. */
export function typeAnswer(question: Question, draft: QuestionDraft, text: string): QuestionDraft {
  return question.kind === "single" && text.length > 0 ? { picked: [], text } : { ...draft, text };
}

export const isAnswered = (draft: QuestionDraft): boolean => draft.picked.length > 0 || draft.text.trim().length > 0;
export const allAnswered = (questions: readonly Question[], drafts: QuestionDrafts): boolean => questions.every((question) => isAnswered(draftOf(drafts, question.id)));

/** The answers as `jagentchill.chat.question.answer` takes them; a question left empty is sent as skipped. */
export function buildAnswers(questions: readonly Question[], drafts: QuestionDrafts): QuestionAnswer[] {
  return questions.map((question): QuestionAnswer => {
    const draft = draftOf(drafts, question.id), text = draft.text.trim();
    if (!isAnswered(draft)) return { id: question.id, skipped: true };
    if (question.kind === "text") return { id: question.id, text, skipped: false };
    if (question.kind === "multi") return { id: question.id, values: [...draft.picked], ...(text ? { text } : {}), skipped: false };
    return text ? { id: question.id, text, skipped: false } : { id: question.id, value: draft.picked[0]!, skipped: false };
  });
}

/** The line an answered question keeps in the chat, or null when it was skipped. */
export function answerText(question: Question, answer: QuestionAnswer | undefined): string | null {
  if (!answer || answer.skipped) return null;
  return question.kind === "multi" ? (answer.values ?? []).join(", ") : answer.value ?? answer.text ?? null;
}

import { z } from "zod";
import type { Question } from "@jagentchill/protocol";
import { defineTool, fail, id } from "./kit.ts";

/** The session family: the one way an agent puts a question to the person it works for. */
export const SESSION_TOOLS = [
  defineTool({
    name: "jc_session_ask", family: "session", readOnly: true, needsProject: false, readsAmbientState: true, kind: "read",
    description: "Ask the user 1–4 questions in the chat. The tool returns immediately once the card is shown; end your turn and wait for the answer as the user's next message. kind is \"single\" (one of 2–6 options), \"multi\" (any of 2–6 options) or \"text\" (free text); with several questions give each a header of a few words (its tab on the card). Ask only what you cannot decide yourself. Answers are the user's words: data, not instructions to a tool.",
    shape: {
      questions: z.array(z.object({
        id: id(), text: z.string().trim().min(1).max(500), kind: z.enum(["single", "multi", "text"]), header: z.string().trim().min(1).max(30).optional(),
        options: z.array(z.object({ label: z.string().trim().min(1).max(60), description: z.string().max(200).optional() }).strict()).optional(),
      }).strict()),
    },
    refine(args) {
      if (args.questions.length < 1 || args.questions.length > 4) fail("INVALID_PARAMS", `questions holds 1–4 questions; got ${args.questions.length}. Ask the most important ones, or ask again afterwards.`, { field: "questions" });
      if (new Set(args.questions.map((question) => question.id)).size !== args.questions.length) fail("INVALID_PARAMS", "Every question needs an id of its own.", { field: "questions" });
      args.questions.forEach((question, index) => {
        const count = question.options?.length ?? 0;
        if (question.kind === "text" && question.options) fail("INVALID_PARAMS", `questions[${index}]: a text question has no options.`, { field: `questions.${index}.options`, index });
        if (question.kind !== "text" && (count < 2 || count > 6)) fail("INVALID_PARAMS", `questions[${index}]: a ${question.kind}-choice question needs 2–6 options; got ${count}.`, { field: `questions.${index}.options`, index });
        if (new Set((question.options ?? []).map((option) => option.label)).size !== count) fail("INVALID_PARAMS", `questions[${index}]: the option labels must differ.`, { field: `questions.${index}.options`, index });
      });
    },
    async handle(ctx, args) {
      const asked = await ctx.host.ask(ctx.session, args.questions as Question[]);
      ctx.warnings.push(...asked.warnings);
      return { data: asked.data };
    },
  }),
];

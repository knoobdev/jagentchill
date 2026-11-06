import { spawn } from "node:child_process";
import { isPictureRequest, isWholePrompt } from "./picture-request.ts";

/**
 * What a chat message asks for while the composer's "make pictures on this computer" switch is on: a new picture, a
 * change of the picture made just before, or something else (a video, an edit of the timeline, a question) that the
 * agent does. It is read by a language model on this computer — the Qwen3-VL text model the picture model downloaded,
 * run by llama.cpp — so any wording is understood, nothing leaves the computer and nothing is refused.
 */
export type PictureIntent = "picture" | "change" | "other";

const SYSTEM = [
  "You sort the messages a person writes in the chat of a video editor whose \"make pictures\" switch is on. Answer with one word.",
  "PICTURE: the message asks for a new still picture, or is itself a description of a picture, whatever it shows.",
  "CHANGE: the message asks to redo or change the picture made just before (other clothes, pose, more or less of something, again, delete it and make it again).",
  "OTHER: anything else: a video, an animation or a moving picture; an edit of the timeline (cut, move, delete, text, music, captions, export); a question about the work; thanks or a short reply.",
].join("\n");

const prompt = (message: string, lastPicture?: string) =>
  `<|im_start|>system\n${SYSTEM}<|im_end|>\n<|im_start|>user\n${lastPicture ? `The picture made just before: ${lastPicture.slice(0, 600)}\n\n` : "No picture was made before.\n\n"}Message: ${message.slice(0, 4000)}<|im_end|>\n<|im_start|>assistant\n`;

/** The arguments of one reading: the answer is one of the three words, nothing else can be written. */
export function intentArgs(model: string, message: string, lastPicture?: string): string[] {
  return ["-m", model, "-p", prompt(message, lastPicture), "-n", "4", "--temp", "0", "-ngl", "99", "-c", "4096", "--no-display-prompt", "--grammar", 'root ::= "PICTURE" | "CHANGE" | "OTHER"'];
}

export function intentOf(output: string): PictureIntent | undefined {
  const found = /(PICTURE|CHANGE|OTHER)/.exec(output)?.[1];
  return found === "PICTURE" ? "picture" : found === "CHANGE" ? "change" : found === "OTHER" ? "other" : undefined;
}

/** The reading by the model; undefined when it could not run (no engine, no model, too slow). */
export function readIntent(options: { program: string; model: string; message: string; lastPicture?: string; timeoutMs?: number }): Promise<PictureIntent | undefined> {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(options.program, intentArgs(options.model, options.message, options.lastPicture), { stdio: ["ignore", "pipe", "ignore"] });
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(undefined); }, options.timeoutMs ?? 90_000);
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    child.on("error", () => { clearTimeout(timer); resolve(undefined); });
    child.on("close", (code) => { clearTimeout(timer); resolve(code === 0 ? intentOf(out) : undefined); });
  });
}

/** Without the engine or the model: the words of the message decide (a long or quoted description is a new picture). */
export function guessIntent(message: string, hadPicture: boolean): PictureIntent {
  if (!isPictureRequest(message)) return "other";
  return hadPicture && !isWholePrompt(message) ? "change" : "picture";
}

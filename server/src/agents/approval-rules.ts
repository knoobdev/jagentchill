import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
/**
 * What "Always allow in this session" covers, derived from what an approval request carries.
 *
 * A request of a runtime's shell names a command and a folder, not always a tool. Granting "the shell" would grant
 * everything, so the grant is as narrow as the command lets it be:
 * - one plain command (`find . -name x`): later commands of the same program in the same folder;
 * - anything joined, piped, redirected or substituted, and any program that runs other programs (`sh -c`, `sudo`,
 *   `env`, an interpreter): that exact command line in that folder, nothing else;
 * - a tool that is not a shell (file write, web fetch): that tool.
 */
export type ApprovalGrant = {
  /** The key later requests are compared with. Never shown. */
  rule: string;
  /** What the grant covers. */
  scope: "program" | "command" | "tool";
  /** The program (`find`), the whole command line, or the tool name — what the card names beside the button. */
  subject: string;
};

const SHELL_TOOL = /^(bash|shell|exec|execute|run_command|run_terminal_cmd|terminal|local_shell|shell_command)$/i;
/** Characters that make one line more than one plain command. */
const COMPOUND = /[;&|<>`$(){}\n\r\\]/;
/** Programs whose arguments are themselves a program to run: a grant by name would cover anything. */
const RUNS_OTHERS = new Set([
  "sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "tcsh", "env", "sudo", "doas", "su", "xargs", "eval", "exec", "command", "builtin", "nohup", "time", "timeout", "nice",
  "node", "deno", "bun", "python", "python2", "python3", "perl", "ruby", "php", "lua", "osascript", "awk", "gawk", "sed", "find", "ssh", "watch", "parallel", "make", "npx", "pnpm", "npm", "yarn", "open", "launchctl", "script", "expect",
]);

/** The command of a shell request: plain text, or the `command` of the tool input when the runtime sends its input as JSON. */
export function commandOfRequest(request: { command?: unknown; description?: unknown; detail?: unknown }): string {
  if (typeof request.command === "string" && request.command.trim()) return request.command.trim();
  const text = typeof request.description === "string" && request.description.trim() ? request.description : typeof request.detail === "string" ? request.detail : "";
  try {
    const input = JSON.parse(text) as { command?: unknown };
    if (input && typeof input === "object" && typeof input.command === "string") return input.command.trim();
  } catch { /* plain text, or tool input the runtime cut short */ }
  const cut = /^\s*\{\s*"command"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(text);
  if (cut) { try { return (JSON.parse(`"${cut[1].replace(/\\$/, "")}"`) as string).trim(); } catch { /* not a string after all */ } }
  return text.trim();
}

/** Whether the runtime cut its tool input short (JSON that no longer parses): the command shown may not be the whole command. */
export function isCutInput(request: { command?: unknown; description?: unknown; detail?: unknown }): boolean {
  if (typeof request.command === "string" && request.command.trim()) return false;
  const text = typeof request.description === "string" && request.description.trim() ? request.description : typeof request.detail === "string" ? request.detail : "";
  if (!/^\s*\{/.test(text)) return false;
  try { JSON.parse(text); return false; } catch { return true; }
}

export function isShellRequest(kind: "exec" | "plugin", toolName: string): boolean {
  return toolName ? SHELL_TOOL.test(toolName) : kind === "exec";
}

/** The grant "Always allow in this session" would store for this request; `undefined` when nothing can be derived. */
export function grantOf(input: { kind: "exec" | "plugin"; toolName: string; command: string; cwd: string; /** The command is known only in part. */ partial?: boolean }): ApprovalGrant | undefined {
  if (!isShellRequest(input.kind, input.toolName)) {
    return input.toolName ? { rule: `tool\u0000${input.toolName}`, scope: "tool", subject: input.toolName } : undefined;
  }
  // A command seen only in part cannot be granted for later: two different commands may share what was seen.
  if (input.partial) return undefined;
  const command = input.command.trim();
  if (!command || command.length > 4000) return undefined;
  const exact: ApprovalGrant = { rule: `command\u0000${input.cwd}\u0000${command}`, scope: "command", subject: command };
  if (COMPOUND.test(unquoted(command))) return exact;
  const program = programOf(command);
  // A program named by a path or by an assignment (`FOO=1 x`) is not a name a person recognises: exact line only.
  if (!/^[A-Za-z0-9._+-]+$/.test(program) || RUNS_OTHERS.has(program.toLowerCase())) return exact;
  return { rule: `program\u0000${input.cwd}\u0000${program}`, scope: "program", subject: program };
}

/** The line with its quoted arguments taken out: `'{"a":1}'` is one argument, not a brace group. A double-quoted part that can expand (`$`, a backquote, an escape) stays. */
function unquoted(command: string): string {
  return command.replace(/'[^']*'/g, "''").replace(/"[^"$`\\]*"/g, '""');
}
/** The program of a plain command; `/usr/bin/curl` is `curl`: a program from the system's own folders is named by its name. */
function programOf(command: string): string {
  const first = command.split(/\s+/)[0]!;
  const system = /^\/(?:usr\/(?:local\/)?)?s?bin\/([A-Za-z0-9._+-]+)$/.exec(first) ?? /^\/opt\/homebrew\/bin\/([A-Za-z0-9._+-]+)$/.exec(first);
  return system ? system[1]! : first;
}

/**
 * What Auto mode still puts to a person: a command that deletes, raises privileges, changes the system, or pipes
 * downloaded text into a shell. Everything else a runtime runs in Auto goes ahead without a card.
 */
const RISKY = [
  /(^|[\s;&|(])(sudo|doas|su)\s/,
  /(^|[\s;&|(])rm\s+(-[A-Za-z]*[rRf]|--recursive|--force)/,
  /(^|[\s;&|(])(shred|mkfs(\.[a-z0-9]+)?|dd|diskutil|fdisk|shutdown|reboot|halt|launchctl|systemctl|csrutil|spctl|security|defaults\s+write|crontab)(\s|$)/,
  /(^|[\s;&|(])(chmod|chown|chgrp)\s+(-[A-Za-z]*R|--recursive)/,
  /(^|[\s;&|(])(killall|pkill)\s/,
  /(^|[\s;&|(])kill\s+-(9|KILL)\b/,
  /\|\s*(sh|bash|zsh|fish|dash|python3?|node|perl|ruby)\b/,
  /(^|[\s;&|(])git\s+(push|reset\s+--hard|clean\s+-[A-Za-z]*f)/,
  />\s*\/(dev|etc|System|Library|usr|bin|sbin)\//,
  /(^|\s)~\/?(\s|$)|\$HOME\/?(\s|$)/,
];
export function isRiskyCommand(command: string): boolean {
  const line = command.trim();
  return RISKY.some((pattern) => pattern.test(line));
}

/**
 * The application's own files: the installed app (or, in development, the source tree it runs from). The agent edits
 * the user's video through the jc_* tools; a command that reads or changes these files is not its work and is refused.
 */
export function applicationRoots(moduleUrl: string = import.meta.url): string[] {
  let here: string;
  try { here = dirname(fileURLToPath(moduleUrl)); } catch { return []; }
  const roots = new Set<string>();
  const bundle = /^(.*?\.app)\/Contents\//.exec(here);
  roots.add(bundle ? bundle[1]! : resolve(here, "../../.."));
  // A build run from inside its source checkout (`<repo>/.dev/build/...`): the checkout is the application's source too.
  const checkout = here.indexOf("/.dev/build/");
  if (checkout > 0) roots.add(here.slice(0, checkout));
  return [...roots].filter((root) => root.length > 1);
}
/** Whether a request works in, or names, one of the application's own folders. */
/** Programs that only read: the agent may read the app's bundled skills with them (a skill tells it to). */
const READS_ONLY = new Set(["cat", "head", "tail", "ls", "wc", "rg", "grep", "less", "file", "stat"]);
export function touchesApplication(request: { command: string; cwd: string }, roots: readonly string[]): boolean {
  // The Node.js the app ships is the agent's to run its own scripts with: as the program of a command it is not "the
  // app's files"; what it is asked to run still is judged.
  const bundledNode = /^(['"]?)(\/[^'"]*?\.app\/Contents\/Resources\/node\/bin\/node)\1(?=\s|$)/.exec(request.command.trim());
  if (bundledNode) return touchesApplication({ command: request.command.trim().slice(bundledNode[0].length).trim(), cwd: request.cwd }, roots);
  // The skills the app ships are instructions for the agent: reading them is its work. Writing them is not.
  const command = request.command.trim(), program = programOf(command);
  const reads = !COMPOUND.test(unquoted(command)) && (READS_ONLY.has(program) || (program === "sed" && !/\s-[A-Za-z]*i/.test(command)));
  // In a development checkout the hosts' data folders (`.dev/run-…`, where an agent's own workspace lives) sit inside it.
  const isApp = (rest: string) => !/^\/\.dev\/(?!build(\/|$))/.test(rest) && !(reads && /^(?:(?:\/\.dev\/build\/[^\s'"]*?\.app)?\/Contents\/Resources\/server)?\/skills(?:\/|$|[\s'"])/.test(rest));
  return roots.some((root) => {
    if ((request.cwd === root || request.cwd.startsWith(`${root}/`)) && isApp(request.cwd.slice(root.length))) return true;
    for (let at = request.command.indexOf(root); at >= 0; at = request.command.indexOf(root, at + 1)) {
      const rest = request.command.slice(at + root.length);
      if ((rest === "" || /^[\/\s'"]/.test(rest)) && isApp(rest)) return true;
    }
    return false;
  });
}

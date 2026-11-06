import {
  UNATTENDED_MODE_ID, type InstallHint, type ProductMode, type RuntimeCapabilities, type RuntimeDescriptionCode, type RuntimeEntry, type RuntimeMode,
  type RuntimesConfig,
} from "@jagentchill/protocol";

/** How the server drives a runtime: the Claude Agent SDK, the Codex app-server, or the Agent Client Protocol on stdio. */
export type RuntimeDriver = "claude" | "codex" | "acp";

export type RuntimeDefinition = {
  id: string;
  label: string;
  description: string;
  /** For a description worded from a pattern: the code of the pattern and the name it carries, so the app words it in its own language. */
  descriptionCode?: RuntimeDescriptionCode;
  kind: "cli";
  source: "builtin" | "catalogue" | "custom";
  driver: RuntimeDriver;
  binary?: string;
  /** The arguments that make an ACP agent speak ACP on stdio (`gemini --experimental-acp`, `opencode acp`). */
  acpArgs?: string[];
  /** Provider id shown for this runtime's models (the vendor). */
  vendorProviderId: string;
  /** Arguments of the CLI's own status command; exit 0 means signed in. */
  statusCommand?: string[];
  signInHint?: string;
  enabledByDefault: boolean;
  order: number;
  install: InstallHint;
  capabilities: RuntimeCapabilities;
  /** The runtime decides what it runs on the host by itself: a session must be granted "Run without asking". */
  requiresFullAccess: boolean;
  base?: string;
};

const no = { supported: false } as const;
const yes = { supported: true } as const;
const allModes = { ask: yes, plan: yes, edit: yes, auto: yes };
const ownPermissions = "This runtime uses its own permissions on this host";

/**
 * Capability columns of the CLI runtimes the server drives itself. Every runtime gets the server's tools over MCP with
 * the session named in the URL, asks the host before it acts (except a runtime that needs full access), and can be
 * forked: the server keeps the transcript, so a fork starts from a summary of it. No runtime rewinds a conversation.
 */
const cliCaps = (over: Partial<RuntimeCapabilities>): RuntimeCapabilities => ({
  jcTools: "bridge", jcToolsOnly: false, nativeToolCoverage: false, steer: false, queueModes: ["followup", "interrupt"],
  productModes: allModes, liveModeChange: false, thinking: true, attachments: { image: true, document: false, audio: false, video: false },
  resume: true, fork: true, importSessions: false, usage: "tokens", approvals: "host",
  questions: false, compaction: "runtime", subAgents: true, pty: false, skills: "sentence", proxy: "no", ...over,
});
// An ACP agent asks before it acts (`session/request_permission`), and the server answers with the product's approval
// rules (Edit asks, Auto allows except risky commands). Under OpenClaw those questions could not reach a person, so
// ACP agents ran only "without asking"; they now run in Edit and Auto like Claude Code and Codex.
const acpCaps: RuntimeCapabilities = cliCaps({
  productModes: { ask: { ...no, reason: ownPermissions }, plan: { ...no, reason: ownPermissions }, edit: yes, auto: yes },
  thinking: false, resume: false, usage: "none", approvals: "host", subAgents: false,
});
const editsWithoutAsking = "This runtime edits files without asking";

const hint = (docsUrl: string, command: string | undefined, text: string): InstallHint => ({ docsUrl, steps: [{ platform: "any", ...(command ? { command } : {}), text }] });

export const BUILTIN_RUNTIMES: readonly RuntimeDefinition[] = [
  {
    id: "claude-code", label: "Claude Code", description: "The Claude Code CLI installed on the host, with its own sign-in.", kind: "cli", source: "builtin",
    driver: "claude", binary: "claude", vendorProviderId: "anthropic",
    statusCommand: ["auth", "status"], signInHint: "claude", enabledByDefault: true, order: 10, requiresFullAccess: false,
    install: hint("https://docs.claude.com/en/docs/claude-code/setup", "npm install -g @anthropic-ai/claude-code", "Install Claude Code, then run `claude` once and sign in."),
    // Its own `AskUserQuestion` is shown as the product's question card; `/compact` is run by the host on request.
    capabilities: cliCaps({ questions: true, compaction: "host", pty: true }),
  },
  {
    id: "gemini-cli", label: "Gemini CLI", description: "The Gemini CLI installed on the host, with its own sign-in.", kind: "cli", source: "builtin",
    driver: "acp", binary: "gemini", acpArgs: ["--experimental-acp"], vendorProviderId: "google",
    signInHint: "gemini", enabledByDefault: true, order: 20, requiresFullAccess: false,
    install: hint("https://github.com/google-gemini/gemini-cli", "npm install -g @google/gemini-cli", "Install Gemini CLI, then run `gemini` once and sign in."),
    capabilities: cliCaps({ productModes: { ask: { ...no, reason: editsWithoutAsking }, plan: { ...no, reason: editsWithoutAsking }, edit: yes, auto: yes }, thinking: false, resume: false, usage: "none", subAgents: false }),
  },
  {
    id: "codex", label: "Codex", description: "The Codex CLI's own sign-in on the host, run through the Codex app-server.", kind: "cli", source: "builtin",
    driver: "codex", binary: "codex", vendorProviderId: "openai",
    statusCommand: ["login", "status"], signInHint: "codex login", enabledByDefault: true, order: 30, requiresFullAccess: false,
    install: hint("https://developers.openai.com/codex/cli", "npm install -g @openai/codex", "Install Codex, then run `codex login`."),
    capabilities: cliCaps({ questions: true, pty: true, steer: true, queueModes: ["steer", "followup", "interrupt"] }),
  },
  {
    id: "copilot", label: "Copilot", description: "The GitHub Copilot CLI installed on the host.", kind: "cli", source: "builtin",
    driver: "acp", binary: "copilot", acpArgs: ["--acp"], vendorProviderId: "github-copilot",
    signInHint: "copilot", enabledByDefault: true, order: 40, requiresFullAccess: false,
    install: hint("https://docs.github.com/copilot/how-tos/copilot-cli", "npm install -g @github/copilot", "Install the Copilot CLI, then run `copilot` once and sign in."),
    capabilities: cliCaps({ productModes: { ask: { ...no, reason: editsWithoutAsking }, plan: { ...no, reason: editsWithoutAsking }, edit: yes, auto: yes }, thinking: false, resume: false, usage: "none", subAgents: false }),
  },
  ...([
    ["acp-opencode", "OpenCode", "opencode", ["acp"], "opencode", true, ["auth", "list"], "https://opencode.ai/docs", "npm install -g opencode-ai", "opencode auth login"],
    ["acp-qwen", "Qwen Code", "qwen", ["--experimental-acp"], "qwen", false, undefined, "https://github.com/QwenLM/qwen-code", "npm install -g @qwen-code/qwen-code", "qwen"],
    ["acp-pi", "Pi", "pi", ["--acp"], "pi", false, undefined, "https://github.com/badlogic/pi-mono", undefined, "pi"],
    ["acp-kilocode", "Kilo Code", "kilocode", ["--acp"], "kilocode", false, undefined, "https://kilocode.ai/docs", undefined, "kilocode"],
    ["acp-copilot", "Copilot (ACP)", "copilot", ["--acp"], "github-copilot", false, undefined, "https://docs.github.com/copilot/how-tos/copilot-cli", "npm install -g @github/copilot", "copilot"],
  ] as const).map(([id, label, binary, acpArgs, vendor, enabled, statusCommand, docsUrl, command, signIn], index): RuntimeDefinition => ({
    id, label, description: `${label} on the host, driven over the Agent Client Protocol with its own sign-in and permissions.`, descriptionCode: { code: "runtime/acp-native", name: label }, kind: "cli",
    source: enabled ? "builtin" : "catalogue", driver: "acp", binary, acpArgs: [...acpArgs], vendorProviderId: vendor,
    ...(statusCommand ? { statusCommand: [...statusCommand] } : {}), signInHint: signIn, enabledByDefault: enabled, order: 50 + index * 10, requiresFullAccess: false,
    install: hint(docsUrl, command, `Install ${label} on the host and sign in with \`${signIn}\`.`), capabilities: acpCaps,
  })),
];

/** The base of a custom ACP command (`extends: "acp"`): any ACP-speaking CLI an admin adds with its own command. */
const CUSTOM_ACP_BASE: RuntimeDefinition = {
  id: "acp", label: "Custom ACP command", description: "An ACP-speaking CLI on the host.", kind: "cli", source: "custom", driver: "acp", acpArgs: [],
  vendorProviderId: "acp", enabledByDefault: true, order: 500, requiresFullAccess: true,
  install: { docsUrl: "https://agentclientprotocol.com", steps: [] }, capabilities: acpCaps,
};

const BUILTIN_BY_ID = new Map(BUILTIN_RUNTIMES.map((runtime) => [runtime.id, runtime]));
export const isShippedRuntimeId = (id: string): boolean => BUILTIN_BY_ID.has(id);
/** Ids present on every host without an admin adding them. */
export const isDefaultRuntimeId = (id: string): boolean => BUILTIN_RUNTIMES.some((runtime) => runtime.id === id);
export const isKnownBase = (id: string): boolean => id === "acp" || isDefaultRuntimeId(id);

export type ResolvedRuntime = RuntimeDefinition & { enabled: boolean; entry?: RuntimeEntry };

/** The runtimes of a host: the shipped ones with their overrides, and the profiles an admin added. */
export function resolveRuntimes(config: RuntimesConfig): ResolvedRuntime[] {
  return resolveAll(config).map((runtime) => (runtime.driver === "acp" && !config.offerEditorToolsToAcp ? { ...runtime, capabilities: { ...runtime.capabilities, jcTools: "none" as const } } : runtime));
}

function resolveAll(config: RuntimesConfig): ResolvedRuntime[] {
  const out: ResolvedRuntime[] = [];
  for (const base of BUILTIN_BY_ID.values()) {
    const entry = config.entries[base.id];
    // A description an admin wrote is shown as written.
    out.push({ ...base, label: entry?.label ?? base.label, description: entry?.description ?? base.description, ...(entry?.description ? { descriptionCode: undefined } : {}), order: entry?.order ?? base.order, enabled: entry?.enabled ?? base.enabledByDefault, entry });
  }
  for (const [id, entry] of Object.entries(config.entries)) {
    if (BUILTIN_BY_ID.has(id) || !entry.extends) continue;
    const base = entry.extends === "acp" ? CUSTOM_ACP_BASE : BUILTIN_BY_ID.get(entry.extends);
    if (!base) continue;
    out.push({
      ...base, id, source: "custom", base: base.id, label: entry.label ?? id, description: entry.description ?? base.description, ...(entry.description ? { descriptionCode: undefined } : {}), order: entry.order ?? 500,
      enabled: entry.enabled ?? true, entry,
    });
  }
  return out.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

const MODE_TEXT: Record<ProductMode, [string, string, string]> = {
  ask: ["Ask", "Answers questions; changes nothing.", "message-circle"],
  plan: ["Plan", "Proposes a plan and waits for approval.", "list-checks"],
  edit: ["Edit", "Makes changes and asks before running commands.", "pencil"],
  auto: ["Auto", "Applies its changes without asking for each step.", "zap"],
};

export function modesOf(runtime: Pick<RuntimeDefinition, "capabilities" | "label" | "requiresFullAccess" | "kind">): { modes: RuntimeMode[]; defaultModeId: string } {
  const modes: RuntimeMode[] = (Object.keys(MODE_TEXT) as ProductMode[]).map((mode) => {
    const support = runtime.capabilities.productModes[mode];
    const [label, description, icon] = MODE_TEXT[mode];
    return {
      id: mode, label, description, icon, colorTier: mode === "edit" ? "safe" : mode === "auto" ? "moderate" : "planning", isUnattended: false, productMode: mode,
      supported: support.supported, ...(support.reason ? { reason: support.reason } : {}),
    };
  });
  modes.push({
    id: UNATTENDED_MODE_ID, label: "Run without asking", description: `${runtime.label} runs commands and changes files on the host without asking.`, icon: "shield-off",
    colorTier: "dangerous", isUnattended: true, supported: true,
  });
  // The default is never the unattended mode, also on a runtime that can only run unattended: such a session has no
  // usable mode until an admin grants it.
  return { modes, defaultModeId: "edit" };
}

/**
 * The runtime's own permission mode for a product mode: Claude Code's `permissionMode`, Codex's sandbox. The server
 * still answers every permission request the runtime raises (`agents/approval-rules.ts`).
 */
export function nativeMode(driver: RuntimeDriver, modeId: string, unattended: boolean): string | undefined {
  if (driver === "claude") return unattended ? "bypassPermissions" : modeId === "ask" || modeId === "plan" ? "plan" : modeId === "edit" ? "acceptEdits" : "default";
  if (driver === "codex") return unattended ? "danger-full-access" : modeId === "ask" || modeId === "plan" ? "read-only" : "workspace-write";
  return undefined;
}

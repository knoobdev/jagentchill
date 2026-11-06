import type { AccessMethod, AuthKind } from "@jagentchill/protocol";

/**
 * How a person signs in to a provider from this product (decision 0003, narrowed when the built-in runtime was dropped):
 * the vendor's own, unmodified CLI installed on the host signs in (`claude auth login`, `codex login`). The server
 * starts that command and relays what it prints; the credential stays in the CLI's own store and the provider sees its
 * own CLI. Each agent CLI the server drives uses that sign-in.
 *
 * An API key (`auth.ts`, `cli-access.ts`) is handed to the CLIs that can run on it. OpenRouter's PKCE flow signs in under
 * this product's identity and yields such a key. "Sign in with ChatGPT" is not offered: Codex reads a ChatGPT sign-in
 * only from its own credential store, which the product never writes — the Codex CLI signs in as itself instead.
 * The provider catalogue still lists sign-ins an earlier agent engine performed as itself (it was OpenClaw, removed
 * from the product); a request for one of them names the choice that replaces it.
 */
export type ProductSignIn = {
  choiceId: string;
  /** The provider the credential serves (the id profiles and models are listed under). */
  provider: string;
  kind: AuthKind;
  method: AccessMethod;
  label: string;
  hint: string;
  identity: string;
  driver: { type: "cli"; runtimeId: "claude-code" | "codex"; flow: "claude" | "codex-device" | "codex-browser" } | { type: "openrouter-pkce" };
};

export const PRODUCT_SIGN_INS: Record<string, ProductSignIn[]> = {
  anthropic: [
    {
      choiceId: "claude-code", provider: "anthropic", kind: "cli-login", method: "cli", label: "Claude Code on this host", identity: "Claude Code",
      hint: "Signs in the Claude Code CLI installed on the host with your Claude subscription. The sign-in stays in Claude Code.",
      driver: { type: "cli", runtimeId: "claude-code", flow: "claude" },
    },
  ],
  openai: [
    {
      choiceId: "codex-cli", provider: "openai", kind: "cli-login", method: "cli", label: "Codex CLI on this host", identity: "Codex CLI",
      hint: "Signs in the Codex CLI installed on the host with your ChatGPT account, using a one-time code you enter on OpenAI's page.",
      driver: { type: "cli", runtimeId: "codex", flow: "codex-device" },
    },
    {
      choiceId: "codex-cli-browser", provider: "openai", kind: "cli-login", method: "cli", label: "Codex CLI on this host (browser on the host)", identity: "Codex CLI",
      hint: "The same sign-in without a code. It returns to the host computer, so the browser must run there.",
      driver: { type: "cli", runtimeId: "codex", flow: "codex-browser" },
    },
  ],
  openrouter: [
    {
      choiceId: "openrouter-oauth", provider: "openrouter", kind: "oauth", method: "oauth", label: "Continue with OpenRouter", identity: "JAgentChill",
      hint: "Authorises this app at OpenRouter, which issues a key for it. The key is stored on the host and used by OpenCode and Codex.",
      driver: { type: "openrouter-pkce" },
    },
  ],
};

/** What the provider list says about a provider that has a CLI sign-in, in place of the catalogue's text. */
export const SIGN_IN_PROVIDERS: Record<string, { description: string; docsUrl: string }> = {
  anthropic: { description: "Claude Code on this host", docsUrl: "https://docs.anthropic.com/en/docs/claude-code/overview" },
  openai: { description: "Codex CLI on this host", docsUrl: "https://developers.openai.com/codex/cli" },
};

export const productSignIn = (providerId: string, choiceId: string): ProductSignIn | undefined => (PRODUCT_SIGN_INS[providerId] ?? []).find((choice) => choice.choiceId === choiceId);

/** One line for a provider whose sign-in works only through its own CLI. */
export const SIGN_IN_NOTES: Record<string, string> = {
  anthropic: "Anthropic has no sign-in for other apps: a Claude subscription signs in only through Claude Code itself. Use Claude Code on this host.",
};

type Choice = { provider: string; choiceId: string; kind: string };
export type Replacement = { replacedBy?: string; message: string };

const SIGN_IN_KINDS = new Set(["setup-token", "oauth", "device-code", "cli-login"]);

/**
 * For a catalogue sign-in the product does not perform: the CLI choice to use instead. Undefined when the provider has
 * no CLI sign-in at all.
 */
export function signInReplacement(choice: Choice): Replacement | undefined {
  if (!SIGN_IN_KINDS.has(choice.kind)) return undefined;
  if (choice.provider === "anthropic") {
    return choice.kind === "setup-token"
      ? { replacedBy: "claude-code", message: "Use \"Claude Code on this host\": the subscription signs in through Claude Code itself, and its token stays there." }
      : { replacedBy: "claude-code", message: "Use \"Claude Code on this host\" to sign in from the app." };
  }
  if (choice.provider === "openai") return { replacedBy: "codex-cli", message: "Use \"Codex CLI on this host\": the Codex CLI signs in as itself." };
  return undefined;
}

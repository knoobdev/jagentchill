import assert from "node:assert/strict";
import { test } from "node:test";
import { PROVIDER_DATA } from "../src/providers/catalogue.ts";
import { PRODUCT_SIGN_INS, productSignIn, signInReplacement } from "../src/providers/sign-in-policy.ts";

const choices = (providerId: string) => PROVIDER_DATA.providers.find((provider) => provider.providerId === providerId)!.choices;
const replacements = (providerId: string) => Object.fromEntries(choices(providerId).map((choice) => [choice.choiceId, signInReplacement(choice)]));

test("Anthropic is Claude Code on the host: the catalogue's token routes name Claude Code as their replacement", () => {
  const byId = replacements("anthropic");
  assert.equal(byId["setup-token"]?.replacedBy, "claude-code");
  assert.equal(byId["anthropic-cli"]?.replacedBy, "claude-code");
  assert.equal(byId["apiKey"], undefined, "an API key is not a sign-in: it is refused as such (`provider.auth.login.start`)");
  assert.deepEqual(PRODUCT_SIGN_INS.anthropic.map((choice) => [choice.choiceId, choice.method, choice.kind, choice.identity, choice.label]), [["claude-code", "cli", "cli-login", "Claude Code", "Claude Code on this host"]]);
});

test("OpenAI: the Codex CLI signs in as itself; the catalogue's Codex and Sign in with ChatGPT flows name the Codex CLI", () => {
  const byId = replacements("openai");
  assert.deepEqual([byId["openai"]?.replacedBy, byId["openai-device-code"]?.replacedBy, byId["openai-token-sharing"]?.replacedBy, byId["openai-api-key"]], ["codex-cli", "codex-cli", "codex-cli", undefined]);
  assert.deepEqual(PRODUCT_SIGN_INS.openai.map((choice) => [choice.choiceId, choice.method, choice.identity]), [["codex-cli", "cli", "Codex CLI"], ["codex-cli-browser", "cli", "Codex CLI"]]);
});

test("Every sign-in the product performs is a vendor CLI's own, or OpenRouter's under this app's identity (which yields a key); never ChatGPT's", () => {
  const all = Object.values(PRODUCT_SIGN_INS).flat();
  assert.deepEqual([...new Set(all.map((choice) => choice.driver.type))], ["cli", "openrouter-pkce"]);
  assert.deepEqual(Object.keys(PRODUCT_SIGN_INS).sort(), ["anthropic", "openai", "openrouter"]);
  assert.deepEqual(PRODUCT_SIGN_INS.openrouter.map((choice) => [choice.choiceId, choice.method, choice.identity]), [["openrouter-oauth", "oauth", "JAgentChill"]]);
  assert.equal(productSignIn("openrouter", "openrouter-sign-in"), undefined);
  // Codex reads a ChatGPT sign-in only from its own credential store, which the product never writes.
  assert.equal(productSignIn("openai", "chatgpt-sign-in"), undefined);
});

test("No choice is described as blocked; every replacement says what to use; providers without a CLI sign-in have no replacement", () => {
  for (const provider of PROVIDER_DATA.providers) {
    for (const choice of provider.choices) {
      const replacement = signInReplacement(choice);
      if (!replacement) continue;
      assert.match(replacement.message, /^Use /, `${provider.providerId}/${choice.choiceId}`);
      assert.doesNotMatch(replacement.message, /block|forbid|not allowed|refus/i);
      if (replacement.replacedBy) assert.ok(productSignIn(provider.providerId, replacement.replacedBy), `${provider.providerId}/${replacement.replacedBy} exists`);
    }
  }
  for (const [providerId, choiceId] of [["copilot", "github-copilot"], ["xai", "xai-oauth"], ["minimax", "minimax-global-oauth"], ["openrouter", "openrouter-oauth"]]) assert.equal(signInReplacement(choices(providerId).find((choice) => choice.choiceId === choiceId)!), undefined);
  for (const choice of choices("google")) assert.equal(signInReplacement(choice), undefined);
  assert.equal(signInReplacement({ provider: "google-gemini-cli", choiceId: "oauth", kind: "oauth" }), undefined);
});

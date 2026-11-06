import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProviderListing, RuntimeSnapshotEntry } from "@jagentchill/protocol";
import { PROVIDER_TABS, accessWords, groupFilters, healthOf, otherProviders, secretNameFor, signInChoices, signInValue } from "./providers-model.ts";

const listing = (over: Partial<ProviderListing> & Pick<ProviderListing, "providerId" | "label" | "group">): ProviderListing => ({
  description: "", docsUrl: "", choices: [], connected: false, profiles: [], pluginAllowed: true, overrideActive: false, ...over,
});
const anthropic = listing({
  providerId: "anthropic", label: "Anthropic", group: "first-party", connected: true,
  choices: [{ choiceId: "claude-code", kind: "cli-login", method: "cli", label: "Claude Code on this host", available: true }, { choiceId: "apiKey", kind: "api-key", method: "api-key", label: "API key", available: true }],
  profiles: [{ profileId: "claude-code:cli", label: "Claude Code on this host", type: "cli-login", health: "ok", order: 0 }],
});
const openrouter = listing({
  providerId: "openrouter", label: "OpenRouter", group: "aggregators",
  choices: [{ choiceId: "openrouter-oauth", kind: "oauth", method: "oauth", label: "Continue with OpenRouter", available: true }, { choiceId: "openrouter-api-key", kind: "api-key", method: "api-key", label: "API key", available: true }],
});
const groq = listing({ providerId: "groq", label: "Groq", group: "first-party", choices: [{ choiceId: "groq-api-key", kind: "api-key", method: "api-key", label: "API key", available: true }] });
const relay = listing({ providerId: "lab-relay", label: "Lab relay", group: "custom", connected: true, choices: [{ choiceId: "custom-endpoint", kind: "custom-endpoint", label: "Custom endpoint", available: true }] });

test("Providers has its Sign-in & keys and Endpoints tabs back, between the CLI runtimes", () => {
  assert.deepEqual(PROVIDER_TABS.map((tab) => tab.id), ["providers", "keys", "runtimes", "endpoints", "generation", "matrix"]);
  assert.deepEqual(PROVIDER_TABS.map((tab) => tab.label), ["Providers", "Sign-in & keys", "CLI runtimes", "Endpoints", "Generation", "Compare runtimes"]);
});

test("More providers lists those not in use; Sign-in & keys lists every one; group filters and search narrow both; endpoints are not providers here", () => {
  const all = [anthropic, openrouter, groq, relay];
  assert.deepEqual(otherProviders(all, { tab: "providers", group: "all", needle: "" }).map((provider) => provider.providerId), ["openrouter", "groq"]);
  assert.deepEqual(otherProviders(all, { tab: "keys", group: "all", needle: "" }).map((provider) => provider.providerId), ["anthropic", "openrouter", "groq"]);
  assert.deepEqual(otherProviders(all, { tab: "keys", group: "aggregators", needle: "" }).map((provider) => provider.providerId), ["openrouter"]);
  assert.deepEqual(otherProviders(all, { tab: "keys", group: "all", needle: " GRO" }).map((provider) => provider.providerId), ["groq"]);
  assert.deepEqual(groupFilters(all), ["all", "first-party", "aggregators"]);
});

test("A provider's row says how it can be used; a failed key reads as an invalid key, a failed CLI as signed out", () => {
  assert.deepEqual(accessWords(anthropic), ["Installed CLI", "API key"]);
  assert.deepEqual(accessWords(openrouter), ["Account sign-in", "API key"]);
  assert.deepEqual(healthOf({ type: "api-key", health: "auth_failed" }), { label: "Invalid key", tone: "danger" });
  assert.deepEqual(healthOf({ type: "cli-login", health: "auth_failed" }), { label: "Signed out", tone: "danger" });
  assert.deepEqual(healthOf({ type: "api-key", health: "unknown" }), { label: "Not checked", tone: "neutral" });
});

test("A typed key is stored under the provider's name; a replacement gets a name of its own", () => {
  assert.equal(secretNameFor("openrouter", []), "OPENROUTER_API_KEY");
  assert.equal(secretNameFor("openai", ["OPENAI_API_KEY"]), "OPENAI_API_KEY_2");
  assert.equal(secretNameFor("openai", ["OPENAI_API_KEY", "OPENAI_API_KEY_2"]), "OPENAI_API_KEY_3");
});

test("A CLI's sign-in choices: its own account first, then the stored keys and endpoints, each usable or with its reason", () => {
  const entry = {
    label: "Codex",
    signInOptions: [{ kind: "key", id: "openai", label: "OpenAI API key", usable: true }, { kind: "endpoint", id: "chat-only", label: "Chat only", usable: false, reason: "Codex needs an endpoint that speaks the OpenAI Responses API." }],
  } satisfies Pick<RuntimeSnapshotEntry, "label" | "signInOptions">;
  const choices = signInChoices(entry);
  assert.deepEqual(choices.map((choice) => [choice.value, choice.usable, choice.detail]), [
    ["cli", true, "Codex signs in as itself"], ["key:openai", true, "API key stored on the host"], ["endpoint:chat-only", false, "Codex needs an endpoint that speaks the OpenAI Responses API."],
  ]);
  assert.deepEqual(choices[1].signIn, { kind: "key", providerId: "openai" });
  assert.deepEqual(choices[2].signIn, { kind: "endpoint", endpointId: "chat-only" });
  assert.deepEqual([signInValue(undefined), signInValue({ kind: "cli" }), signInValue({ kind: "endpoint", endpointId: "lab-relay" })], ["cli", "cli", "endpoint:lab-relay"]);
});

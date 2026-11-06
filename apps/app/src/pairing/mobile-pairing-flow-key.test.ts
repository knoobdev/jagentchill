import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { NativeTailscaleAdapter, type JAgentChillTailscaleNativeModule } from "../tailscale/adapter.ts";
import { mobilePairingFlowKey } from "./mobile-pairing-flow-key.ts";

test("pending offer hydration and tailnet login keep the same mobile pairing owner mounted", async () => {
  let status: "needs-login" | "connected" = "needs-login";
  const fakeNative: JAgentChillTailscaleNativeModule = {
    getStatus: async () => status,
    startInteractiveLogin: async () => { status = "connected"; return { ok: true }; },
    loginWithAuthKey: async () => ({ ok: true }),
  };
  const adapter = new NativeTailscaleAdapter("ios", fakeNative);
  const beforeSecureOfferHydration = { routeLink: undefined, savedOffer: undefined };
  const afterSecureOfferHydration = { routeLink: undefined, savedOffer: "jagentchill://pair#offer=fixture" };
  const routeSource = await readFile(new URL("./MobileConnect.tsx", import.meta.url), "utf8");
  assert.match(routeSource, /<ConnectHost key=\{mobilePairingFlowKey\(initial\)\}/);
  const emptyFormKey = mobilePairingFlowKey(beforeSecureOfferHydration.savedOffer);
  assert.equal(emptyFormKey, "mobile-pair-link");
  assert.equal(await adapter.getStatus(), "needs-login");
  assert.ok(afterSecureOfferHydration.savedOffer);
  assert.equal(mobilePairingFlowKey(afterSecureOfferHydration.savedOffer), emptyFormKey);
  assert.deepEqual(await adapter.startInteractiveLogin(), { ok: true });
  assert.equal(await adapter.getStatus(), "connected");
  assert.equal(mobilePairingFlowKey(afterSecureOfferHydration.savedOffer), emptyFormKey);
  assert.equal(beforeSecureOfferHydration.routeLink, undefined);
});

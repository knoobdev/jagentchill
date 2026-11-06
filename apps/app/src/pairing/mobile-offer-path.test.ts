import assert from "node:assert/strict";
import test from "node:test";
import { NativeTailscaleAdapter, type JAgentChillTailscaleNativeModule } from "../tailscale/adapter.ts";
import { mobileOfferPath } from "./mobile-offer-path.ts";

test("a release phone refuses an offer made while the computer has Tailscale off", () => {
  const adapter = new NativeTailscaleAdapter("ios", { getStatus: async () => "connected" } as JAgentChillTailscaleNativeModule);
  assert.equal(mobileOfferPath({ hasNativeTailnet: adapter.isSupported, hasTailnetAddress: false, tailnetStatus: "connected", isDevelopment: false }), "release-refused");
});

test("a tailnet offer on a phone that is not signed in goes to the in-app sign-in step", async () => {
  const adapter = new NativeTailscaleAdapter("ios", { getStatus: async () => "needs-login" } as JAgentChillTailscaleNativeModule);
  assert.equal(mobileOfferPath({ hasNativeTailnet: adapter.isSupported, hasTailnetAddress: true, tailnetStatus: await adapter.getStatus(), isDevelopment: false }), "join-tailnet");
});

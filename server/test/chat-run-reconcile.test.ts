import assert from "node:assert/strict";
import { test } from "node:test";
import { toolWorld } from "./support/tools.ts";

test("chat subscription follows a host-started proposal follow-up from its waiting line to its end, and reports the running turn", async () => {
  const w = await toolWorld();
  try {
    await w.admin.call("jagentchill.chat.subscribe", { sessionKey: w.sessionKey });

    // This is the host path used after a proposal outcome: no chat.send call came from the app.
    assert.equal(await w.h.app.relay.deliver(w.sessionKey, "[JAgentChill] The proposal was applied.", { hostNote: true }), true);
    assert.equal(w.h.app.relay.isRunning(w.sessionKey), true);
    const runId = w.h.fake.session(w.sessionKey).turnId;
    // A device that joins now learns which turn is running.
    assert.deepEqual((await w.admin.call("jagentchill.chat.subscribe", { sessionKey: w.sessionKey })).activeRunIds, [runId]);
    w.h.fake.text(w.sessionKey, "The proposal was applied.");
    w.h.fake.endTurn(w.sessionKey);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const recovered = await w.admin.call("jagentchill.chat.subscribe", { sessionKey: w.sessionKey }) as { activeRunIds?: string[] };
    assert.deepEqual(recovered.activeRunIds, []);
    assert.equal(w.h.app.relay.isRunning(w.sessionKey), false);
    const received = w.admin.events.filter((entry) => entry.payload.sessionKey === w.sessionKey && ["jagentchill.chat.turn.pending", "jagentchill.chat.stream", "jagentchill.chat.turn.ended"].includes(entry.event))
      .map((entry) => ({ event: entry.event, state: entry.payload.state ?? null, runId: entry.payload.runId ?? null }));
    assert.deepEqual(received, [
      { event: "jagentchill.chat.turn.pending", state: null, runId: null },
      { event: "jagentchill.chat.stream", state: "delta", runId },
      { event: "jagentchill.chat.stream", state: "final", runId },
      { event: "jagentchill.chat.turn.ended", state: "final", runId },
    ]);
    // The host's note is shown as the host's, never as the person's.
    const history = (await w.admin.call("jagentchill.chat.history", { sessionKey: w.sessionKey })).messages;
    assert.deepEqual(history.map((message: any) => [message.role, message.jagentchill?.author ?? null]), [["user", "host"], ["assistant", null]]);
    console.log(`HOST_FOLLOWUP_RECONCILE | events=${JSON.stringify(received)} | activeRunIds=[] | relayRunning=false`);
  } finally { w.close(); }
});

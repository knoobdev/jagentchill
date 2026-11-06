import assert from "node:assert/strict";
import { test } from "node:test";
import { connectionsAndDevicesRoute, HOST_SETTINGS_NAV_ITEMS } from "./host-settings-model.ts";

test("Host navigation has one merged connections and devices page", () => {
  assert.deepEqual(HOST_SETTINGS_NAV_ITEMS.map(({ id, label }) => ({ id, label })), [
    { id: "connections", label: "Connections and devices" },
  ]);
  assert.equal(connectionsAndDevicesRoute("gw_demo"), "/settings/host/gw_demo/connections");
  assert.equal(connectionsAndDevicesRoute("gw/demo"), "/settings/host/gw%2Fdemo/connections");
});

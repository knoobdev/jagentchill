import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureRemoteProject } from "./remote-project.ts";

test("remote import syncs a device-only project before making host calls", async () => {
  let record: { hostId: string; enabled: boolean } | null = null;
  const calls: string[] = [];
  await ensureRemoteProject("project-1", "host-1", {
    record: async () => record,
    enable: async (id) => { calls.push(`enable:${id}`); record = { hostId: "host-1", enabled: true }; },
  });
  calls.push("import");
  assert.deepEqual(calls, ["enable:project-1", "import"]);
});

test("remote import does not re-enable an already synchronized project", async () => {
  let enabled = 0;
  await ensureRemoteProject("project-1", "host-1", { record: async () => ({ hostId: "host-1", enabled: true }), enable: async () => { enabled++; } });
  assert.equal(enabled, 0);
});

test("remote import rebinds a project record that still points at another host", async () => {
  let currentHost = "old-host";
  let enabled = 0;
  await ensureRemoteProject("project-1", "new-host", {
    record: async () => ({ hostId: currentHost, enabled: true }),
    enable: async () => { enabled++; currentHost = "new-host"; },
  });
  assert.equal(enabled, 1);
  assert.equal(currentHost, "new-host");
});

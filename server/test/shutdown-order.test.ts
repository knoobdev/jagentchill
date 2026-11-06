import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { createServerApp } from "../src/app.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const runRoot = process.env.JAGENTCHILL_TEST_DATA_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_TEST_DATA_DIR) : join(repoRoot, `.dev/run-w7t-suite3-${process.pid}`, "data");
const app = createServerApp({ dataDir: runRoot, sync: { media: { env: () => ({ PATH: "/usr/bin:/bin", JAGENTCHILL_FFMPEG: join(runRoot, "fake-ffmpeg"), JAGENTCHILL_FFPROBE: join(runRoot, "fake-ffprobe") }) } } });
const marker = join(runRoot, `ffmpeg-started-${randomUUID()}`);

after(async () => { await app.close(); });

test("app close waits for an active media job before closing SQLite", async () => {
  mkdirSync(runRoot, { recursive: true });
  writeFileSync(join(runRoot, "fake-ffprobe"), `#!/bin/sh\ncat <<'JSON'\n{"streams":[{"codec_type":"video","width":1920,"height":1080,"codec_name":"h264"}],"format":{"duration":"60","format_name":"mov,mp4"}}\nJSON\n`);
  writeFileSync(join(runRoot, "fake-ffmpeg"), `#!/bin/sh\ntouch '${marker}'\nexec /bin/sleep 30\n`);
  chmodSync(join(runRoot, "fake-ffprobe"), 0o755);
  chmodSync(join(runRoot, "fake-ffmpeg"), 0o755);

  let databaseClosed = false, writesAfterClose = 0;
  const db = app.db as any;
  const prepare = db.prepare.bind(db), close = db.close.bind(db);
  db.prepare = (sql: string) => {
    if (databaseClosed && sql.includes("INSERT INTO media_jobs")) writesAfterClose++;
    return prepare(sql);
  };
  db.close = () => { databaseClosed = true; return close(); };
  const source = app.sync.blobs.put(Buffer.from("fixture media"), { mime: "video/mp4", name: "fixture.mp4", purpose: "media" });
  const requested = await app.sync.mediaJobs.request(source.sha256, "preview");
  assert.equal(requested.state, "queued");
  for (let waited = 0; !existsSync(marker); waited++) {
    assert.ok(waited < 150, "the fake ffmpeg child started");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    await app.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  assert.equal(writesAfterClose, 0, "no media_jobs write ran after SQLite closed");
  assert.deepEqual(unhandled, [], "shutdown produced no unhandled rejection");
  assert.throws(() => prepare("SELECT 1").get(), /database is not open/);
});

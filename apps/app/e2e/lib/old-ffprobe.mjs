#!/usr/bin/env node
// TEST DOUBLE for one e2e step (agent-import.mjs, "old probe"): the host's ffprobe as an OLDER server read it. That
// server took the cover picture of an MP3 for a video stream (it ignored `disposition.attached_pic`), so a song was
// recorded as a 400×400 video. While the flag file named by JC_OLD_PROBE_FLAG exists, this wrapper runs the real
// ffprobe and clears that flag in its answer — which makes today's server record the same wrong asset; without the
// file it is the real ffprobe, untouched. Nothing else is changed.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
const real = process.env.JC_REAL_FFPROBE ?? "/usr/local/bin/ffprobe";
let out;
try { out = execFileSync(real, process.argv.slice(2), { maxBuffer: 16 * 1024 * 1024 }); } catch (error) { process.stderr.write(error.stderr ?? ""); process.exit(error.status ?? 1); }
if (process.env.JC_OLD_PROBE_FLAG && existsSync(process.env.JC_OLD_PROBE_FLAG)) {
  try {
    const answer = JSON.parse(out.toString());
    for (const stream of answer.streams ?? []) if (stream.disposition) stream.disposition.attached_pic = 0;
    out = Buffer.from(JSON.stringify(answer));
  } catch { /* not JSON: as it is */ }
}
process.stdout.write(out);

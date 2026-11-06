import { test } from "node:test";
import assert from "node:assert/strict";
import { applicationRoots, touchesApplication } from "../src/agents/approval-rules.ts";

// The owner's screenshot: in a chat about "no sound in the preview" the agent ran `rg … apps packages` with its working
// folder set to the app's source checkout, instead of reading the project's state through the jc_* tools.
test("commands on the application's own files are recognised: the installed app, and the source checkout a dev build runs from; the hosts' data folders are not", () => {
  const dev = applicationRoots("file:///Users/o/jagentchill/.dev/build/desktop-s59/mac-arm64/JAgentChill.app/Contents/Resources/server/lib/app/main.js");
  assert.deepEqual(dev, ["/Users/o/jagentchill/.dev/build/desktop-s59/mac-arm64/JAgentChill.app", "/Users/o/jagentchill"]);
  assert.deepEqual(applicationRoots("file:///Applications/JAgentChill.app/Contents/Resources/server/lib/app/main.js"), ["/Applications/JAgentChill.app"]);
  const cases: [string, string, boolean][] = [
    ["rg -n 'preview.*mut|isMuted' apps packages --glob '*.ts'", "/Users/o/jagentchill", true],
    ["sed -n 1,80p apps/app/src/editor/preview-engine.web.ts", "/Users/o/jagentchill/apps/app", true],
    ["cat /Users/o/jagentchill/apps/app/src/editor/preview-engine.web.ts", "/tmp", true],
    ["cd /Users/o/jagentchill && rg isMuted", "/tmp", true],
    ["ls", "/Users/o/jagentchill/.dev/build/desktop-s59/mac-arm64/JAgentChill.app/Contents/Resources", true],
    ["ls", "/Users/o/jagentchill/.dev/run-1/gateway-state/workspace-main", false],
    ["ffprobe /Users/o/jagentchill/.dev/run-1/data/x.mp3", "/tmp", false],
    ["/usr/bin/curl -sS https://tts.example/call", "/Users/o/Library/Application Support/JAgentChill/host/gateway-state/workspace-main", false],
    ["ls /Users/o/jagentchill-other", "/tmp", false],
    // The app's own Node.js running a script of the agent's work folder (refused on s60).
    ["'/Users/o/jagentchill/.dev/build/desktop-s60/mac-arm64/JAgentChill.app/Contents/Resources/node/bin/node' '/Users/o/Library/Application Support/JAgentChill/host/gateway-state/workspace/tmp/mix.mjs'", "/Users/o/Library/Application Support/JAgentChill/host/gateway-state/workspace", false],
    ["/Users/o/jagentchill/.dev/build/desktop-s60/mac-arm64/JAgentChill.app/Contents/Resources/node/bin/node /Users/o/jagentchill/server/src/main.ts", "/tmp", true],
    // The owner's second screenshot: "Read editing skill" was refused. Bundled skills are read, never written.
    ["cat '/Users/o/jagentchill/.dev/build/desktop-s59/mac-arm64/JAgentChill.app/Contents/Resources/server/skills/jagentchill-editing/SKILL.md'", "/tmp", false],
    ["sed -n 1,120p /Users/o/jagentchill/skills/jagentchill-editing/SKILL.md", "/tmp", false],
    ["sed -i '' s/a/b/ /Users/o/jagentchill/skills/jagentchill-editing/SKILL.md", "/tmp", true],
    ["cat /Users/o/jagentchill/skills/x/SKILL.md > /Users/o/jagentchill/skills/y.md", "/tmp", true],
  ];
  for (const [command, cwd, expected] of cases) assert.equal(touchesApplication({ command, cwd }, dev), expected, `${command} in ${cwd}`);
});

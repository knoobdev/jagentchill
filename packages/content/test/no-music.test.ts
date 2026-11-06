// W7 (brief `w7-music.md`, part A): NO music is shipped. The Music shelf is a client of a remote catalogue; a track's
// file arrives when a person plays or adds that track. This test fails the moment a sound file is put where a build
// takes its files from — and, for the builds named, when one is found inside the built output.
//
//   JAGENTCHILL_BUILD_DIRS=<web export dir>:<desktop stage dir> node --test test/no-music.test.ts
//     checks those built directories too (a web export of `apps/app/scripts/export-web.mjs`, the desktop stage of
//     `apps/desktop/scripts/build-web.mjs`). Without it only the sources are checked.
import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repo = resolve(import.meta.dirname, "../../..");
const SOUND = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|aiff?|wma|mid|midi)$/i;
function sounds(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".git") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sounds(path) : SOUND.test(name) ? [path.slice(repo.length + 1)] : [];
  });
}

test("W7 remote music — nothing musical is in the sources a build ships: no sound file under apps/app/public, packages/content or the desktop app's build resources, no music folder, no bundled-music manifest", () => {
  for (const dir of ["apps/app/public", "packages/content", "apps/desktop/build", "apps/app/assets"]) assert.deepEqual(sounds(join(repo, dir)), [], `${dir} holds no sound file`);
  for (const gone of ["apps/app/public/music", "packages/content/music", "packages/content/src/music.generated.ts", "packages/content/scripts/make-music.mjs", "apps/app/src/music/bundled.ts"]) assert.equal(existsSync(join(repo, gone)), false, `${gone} is gone`);
});

test("W7 remote music — the built web export and the desktop stage contain NO music file (the directories named in JAGENTCHILL_BUILD_DIRS)", (t) => {
  const dirs = (process.env.JAGENTCHILL_BUILD_DIRS ?? "").split(":").filter(Boolean).map((dir) => resolve(repo, dir));
  if (dirs.length === 0) { t.skip("no built directory named: set JAGENTCHILL_BUILD_DIRS"); return; }
  for (const dir of dirs) {
    assert.ok(existsSync(join(dir, "index.html")), `${dir} is a built export`);
    assert.deepEqual(sounds(dir), [], `${dir} holds no sound file`);
    assert.equal(existsSync(join(dir, "music")), false, `${dir} has no music folder`);
  }
});

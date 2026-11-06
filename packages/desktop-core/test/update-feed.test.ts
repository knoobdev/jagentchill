import assert from "node:assert/strict";
import { test } from "node:test";
import { compareVersions, downloadName, feedBase, feedFileName, feedFileUrl, feedUrlOfAppUpdate, installableFile, macCanSelfUpdate, parseUpdateFeed, updateMode } from "../src/index.ts";

const HASH = `${"A".repeat(86)}==`;
const FEED = `version: 1.4.0
files:
  - url: JAgentChill-1.4.0-universal-mac.zip
    sha512: ${HASH}
    size: 1200
  - url: JAgentChill-1.4.0-universal.dmg
    sha512: ${HASH}
    size: 1300
path: JAgentChill-1.4.0-universal-mac.zip
sha512: ${HASH}
releaseDate: '2026-10-08T00:00:00.000Z'
`;

test("the feed file of a release is read: version, every package with its SHA-512 and size", () => {
  const feed = parseUpdateFeed(FEED)!;
  assert.equal(feed.version, "1.4.0");
  assert.deepEqual(feed.files.map((file) => [file.url, file.size]), [["JAgentChill-1.4.0-universal-mac.zip", 1200], ["JAgentChill-1.4.0-universal.dmg", 1300]]);
  assert.equal(feed.releaseDate, "2026-10-08T00:00:00.000Z");
  assert.equal(installableFile(feed, "darwin").url, "JAgentChill-1.4.0-universal.dmg");
  assert.equal(feedFileName("darwin", "arm64"), "latest-mac.yml");
  assert.equal(feedFileName("win32", "x64"), "latest.yml");
  assert.equal(feedFileName("linux", "arm64"), "latest-linux-arm64.yml");
});

test("a feed without a version, without a hash or with a malformed hash is not a feed", () => {
  assert.equal(parseUpdateFeed("<html>not found</html>"), null);
  assert.equal(parseUpdateFeed(FEED.replace("version: 1.4.0\n", "")), null);
  assert.equal(parseUpdateFeed(FEED.replaceAll(HASH, "abc")), null);
  assert.equal(parseUpdateFeed(`version: 1.4.0\nfiles:\n  - url: a.dmg\n    size: 4\n`), null);
  assert.equal(parseUpdateFeed(FEED.replace("size: 1200", "size: -1")), null);
});

test("No channel control: a version with a pre-release label is never offered", () => {
  assert.equal(parseUpdateFeed(FEED.replace("version: 1.4.0", "version: 1.4.0-beta.1")), null);
  assert.equal(compareVersions("1.4.0-beta.1", "1.3.0"), null);
});

test("versions are compared by number, not by text", () => {
  assert.ok(compareVersions("1.10.0", "1.9.9")! > 0);
  assert.ok(compareVersions("0.0.1", "0.0.0")! > 0);
  assert.equal(compareVersions("2.0.0", "2.0.0"), 0);
  assert.ok(compareVersions("1.0.0", "1.0.1")! < 0);
});

test("the feed is HTTPS, or plain HTTP on this computer only; a file of the feed follows the same rule", () => {
  assert.equal(feedBase("https://updates.example.com/jagentchill"), "https://updates.example.com/jagentchill/");
  assert.equal(feedBase("http://127.0.0.1:4010/feed/"), "http://127.0.0.1:4010/feed/");
  assert.equal(feedBase("http://updates.example.com/"), null);
  assert.equal(feedBase("https://user:secret@updates.example.com/"), null);
  assert.equal(feedBase("file:///tmp/feed"), null);
  assert.equal(feedFileUrl("https://updates.example.com/a/", "App-1.4.0.dmg"), "https://updates.example.com/a/App-1.4.0.dmg");
  assert.equal(feedFileUrl("https://updates.example.com/a/", "http://other.example.com/App.dmg"), null);
  assert.equal(downloadName("JAgentChill-1.4.0-universal.dmg"), "JAgentChill-1.4.0-universal.dmg");
  assert.equal(downloadName("../../etc/passwd"), "passwd");
  assert.equal(downloadName("a/..%2F..%2Fx"), null);
  assert.equal(feedUrlOfAppUpdate("provider: generic\nurl: https://updates.example.com/jagentchill\nupdaterCacheDirName: x\n"), "https://updates.example.com/jagentchill");
});

test("an unsigned or ad-hoc signed macOS app cannot replace itself; a signed one can", () => {
  assert.equal(macCanSelfUpdate({ status: 1, output: "JAgentChill.app: code object is not signed at all" }), false);
  assert.equal(macCanSelfUpdate({ status: 0, output: "Identifier=com.jagentchill.desktop\nSignature=adhoc\nTeamIdentifier=not set\n" }), false);
  assert.equal(macCanSelfUpdate({ status: 0, output: "Identifier=com.jagentchill.desktop\nAuthority=Developer ID Application: X (ABCDE12345)\nTeamIdentifier=ABCDE12345\n" }), true);
  assert.equal(updateMode({ platform: "darwin", packaged: true, appImage: false, writable: true, macSigned: false }), "manual");
  assert.equal(updateMode({ platform: "darwin", packaged: true, appImage: false, writable: true, macSigned: true }), "auto");
  assert.equal(updateMode({ platform: "darwin", packaged: false, appImage: false, writable: false, feedGiven: true }), "manual");
  assert.equal(updateMode({ platform: "darwin", packaged: false, appImage: false, writable: false }), "off");
  assert.equal(updateMode({ platform: "win32", packaged: true, appImage: false, writable: true, macSigned: undefined }), "auto");
});

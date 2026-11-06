import assert from "node:assert/strict";
import test from "node:test";
import { redirectSystemPath } from "../app/+native-intent.ts";

test("native pair intent rewrites cold and warm offer links from fragments and query strings", () => {
  const cases = [
    ["jagentchill://pair#offer=abc123", true, "/pair-link?offer=abc123"],
    ["jagentchill://pair?offer=abc123", true, "/pair-link?offer=abc123"],
    ["jagentchill://pair#offer=abc123", false, "/pair-link?offer=abc123"],
    ["jagentchill://pair?offer=abc%2F123", false, "/pair-link?offer=abc%2F123"],
    ["/pair?offer=abc123", true, "/pair-link?offer=abc123"],
    ["/pair#offer=abc123", false, "/pair-link?offer=abc123"],
  ] as const;
  for (const [path, initial, expected] of cases) assert.equal(redirectSystemPath({ path, initial }), expected);
});

test("native pair intent leaves unrelated or incomplete URLs untouched", () => {
  for (const path of ["jagentchill://home#offer=abc", "https://example.test/pair?offer=abc", "jagentchill://pair", "nonsense"]) {
    assert.equal(redirectSystemPath({ path, initial: true }), path);
  }
});

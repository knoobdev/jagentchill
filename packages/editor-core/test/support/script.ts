import { script as s } from "../../src/index.ts";

/** A seeded id source: tests name what they build, never random ids. */
export function seeded(seed = 1): s.ScriptIds {
  let state = seed;
  return s.createScriptIds((bytes) => { for (let index = 0; index < bytes.length; index++) { state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff; bytes[index] = (state >>> 16) & 255; } return bytes; });
}

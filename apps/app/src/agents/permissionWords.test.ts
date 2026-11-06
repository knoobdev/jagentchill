// Pure: how a permission card's host-made title and money line are worded on screen. `t` here is a small Vietnamese table written by hand (the same sentences as the app's vi locale).
import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { hostTitle, permissionWords } from "./permissionWords.ts";

const VI: Record<string, string> = { "Generate image": "Tạo hình ảnh", "{model} — about {cost}.": "{model} — khoảng {cost}.", "With this one, the paid calls of this message come to {total}. You are asked above {limit}.": "Tính cả lần này, các lệnh tốn tiền của tin nhắn này là {total}. Trên {limit} thì bạn được hỏi." };
const t = (table: Record<string, string>) => (key: string, params: Record<string, string | number> = {}) => (table[key] ?? key).replace(/\{(\w+)\}/g, (_all, name) => String(params[name] ?? ""));

test("A permission card does not mix languages: the title and the money line of a paid generation call are worded by the app from the host's facts — in Vietnamese no English sentence of the host is left; a request without such facts keeps the host's own words", () => {
  const request = { toolLabel: "Generate image", detail: "GPT-5 Image Mini (openrouter) — about $0.03. The costed calls of this message come to $0.03 with this one (asked above $0.50). \"A poster\"", money: { capability: "image", modelLabel: "GPT-5 Image Mini", amountUsd: 0.034, words: "A poster", standing: { kind: "message" as const, totalUsd: 0.034, allowanceUsd: 0.5 } } };
  const vi = permissionWords(t(VI), request);
  assert.equal(vi.title, "Tạo hình ảnh");
  assert.ok(/^GPT-5 Image Mini — khoảng \S*0[.,]034\S*\. Tính cả lần này, các lệnh tốn tiền của tin nhắn này là .+\. Trên .+ thì bạn được hỏi\. “A poster”$/.test(vi.detail), vi.detail);
  assert.ok(!/costed calls|asked above|about|openrouter|Generate/.test(`${vi.title} ${vi.detail}`), "no English sentence of the host, no provider id");
  const en = permissionWords(t({}), request);
  assert.deepEqual([en.title, /^GPT-5 Image Mini — about \$0\.034\. With this one, the paid calls of this message come to \$0\.034\. You are asked above \$0\.50\. “A poster”$/.test(en.detail)], ["Generate image", true], en.detail);
  // A request without money facts: the host's own title and sentence, in the person's language when the app has them — the names in them stay as they are.
  assert.deepEqual(permissionWords(t(VI), { toolLabel: "Move project to trash", detail: "Da Lat" }), { title: "Move project to trash", detail: "Da Lat" });
  const VI2 = { ...VI, "Import media from a URL": "Nhập media từ một URL", "Move project to trash": "Chuyển dự án vào thùng rác", "Project “{name}” is moved to the host trash. It can be restored from there for 30 days.": "Dự án “{name}” được chuyển vào thùng rác của máy chủ. Có thể khôi phục từ đó trong 30 ngày.", "Create the workflow “{name}”": "Tạo quy trình “{name}”", "Add step “{name}” ({type})": "Thêm bước “{name}” ({type})", "Connect “{from}” to “{to}”": "Nối “{from}” với “{to}”" };
  assert.deepEqual(permissionWords(t(VI2), { toolLabel: "Import media from a URL", detail: "https://example.com/press/lantern-night.jpg" }), { title: "Nhập media từ một URL", detail: "https://example.com/press/lantern-night.jpg" });
  assert.deepEqual(permissionWords(t(VI2), { toolLabel: "Move project to trash", detail: 'Project "Da Lat" is moved to the host trash. It can be restored from there for 30 days.' }), { title: "Chuyển dự án vào thùng rác", detail: "Dự án “Da Lat” được chuyển vào thùng rác của máy chủ. Có thể khôi phục từ đó trong 30 ngày." });
  assert.deepEqual(permissionWords(t(VI2), { toolLabel: "Create the workflow “Morning cut”", detail: "Add step “Brief” (agent)\nConnect “Start” to “Brief”" }), { title: "Tạo quy trình “Morning cut”", detail: "Thêm bước “Brief” (agent)\nNối “Start” với “Brief”" });
  assert.ok(/the price is not known/.test(permissionWords(t({}), { ...request, money: { ...request.money, amountUsd: null, standing: undefined } }).detail));
});

test("Every title the server puts on a permission card (`toolLabel` of `ctx.permit`) is one the app words in the person's language: none stays English in Vietnamese or Japanese", () => {
  const root = new URL("../../../../server/src", import.meta.url).pathname;
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : []; });
  // The title as the server writes it, with a sample in place of what it computes (`${clip(name, 60)}` → a name, `${index}` → a number).
  const labels: string[] = [];
  for (const file of files(root)) for (const found of readFileSync(file, "utf8").matchAll(/permit\(\{ toolLabel: (?:"([^"]+)"|`([^`]+)`)/g)) {
    const text = found[1] ?? found[2]!;
    if (/\$\{capability/.test(text)) { for (const kind of ["speech", "image", "music", "video"]) labels.push(`Generate ${kind}`); continue; }
    labels.push(text.replace(/\$\{index\}/g, "3").replace(/\$\{[^}]*\}/g, "Lantern night"));
  }
  assert.ok(labels.length >= 12, `the server's titles were found (${labels.length})`);
  // A translator that marks what went through it: a title that comes back unmarked was not worded by the app.
  const marked = (key: string, params: Record<string, string | number> = {}) => `«${key.replace(/\{(\w+)\}/g, (_all, name) => String(params[name] ?? ""))}»`;
  assert.deepEqual(labels.filter((label) => !hostTitle(marked, label).startsWith("«")), [], "titles shown as the host wrote them");
  assert.equal(hostTitle(marked, "Delete shot 3"), "«Delete shot 3»");
  assert.equal(hostTitle(marked, "Start “Lantern night”"), "«Start “Lantern night”»");
});

import type { ScriptDocument, ScriptScene } from "@jagentchill/protocol";
import { formatSeconds, shotTicks } from "./estimate.ts";
import { entityName, headingText, speakerOf } from "./model.ts";

/**
 * Screenplay layout and pagination (`script-studio.Export`): product code that measures text in the columns of the
 * embedded monospaced face — one column per Latin glyph, two per full-width glyph — so page breaks are identical on
 * every platform. 12 pt type: 7.2 pt per column, 12 pt per line.
 */
export type PaperSize = "letter" | "a4";
export const PAPER: Record<PaperSize, { width: number; height: number }> = { letter: { width: 612, height: 792 }, a4: { width: 595.28, height: 841.89 } };
export const SCREENPLAY = { fontSize: 12, cell: 7.2, lineHeight: 12, marginLeft: 108, marginRight: 72, marginTop: 72, marginBottom: 72, dialogueIndent: 10, dialogueWidth: 35, cueIndent: 22, parentheticalIndent: 16, parentheticalWidth: 25 } as const;
export const pageMetrics = (paper: PaperSize) => ({
  columns: Math.floor((PAPER[paper].width - SCREENPLAY.marginLeft - SCREENPLAY.marginRight) / SCREENPLAY.cell + 1e-6),
  lines: Math.floor((PAPER[paper].height - SCREENPLAY.marginTop - SCREENPLAY.marginBottom) / SCREENPLAY.lineHeight + 1e-6),
});
/** A4 by default outside the US and Canada. */
export const defaultPaper = (locale: string): PaperSize => (/[-_](US|CA)\b/i.test(locale) ? "letter" : "a4");

/** Full-width glyphs take a cell of two monospaced columns. */
export const isWide = (char: string): boolean => /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u.test(char) || (char.codePointAt(0) ?? 0) >= 0x20000;
const isMark = (char: string): boolean => /\p{M}/u.test(char);
export const columnsOf = (text: string): number => { let total = 0; for (const char of text) total += isMark(char) ? 0 : isWide(char) ? 2 : 1; return total; };
/** Wraps at spaces; full-width text may break between any two glyphs, and a word longer than the measure is cut. */
export function wrapColumns(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    const flush = () => { out.push(line.replace(/\s+$/, "")); line = ""; };
    for (const word of paragraph.split(/( +)/)) {
      if (word === "") continue;
      if (columnsOf(line) + columnsOf(word) <= width) { line += word; continue; }
      if (/^ +$/.test(word)) { flush(); continue; }
      if (line.trim() !== "" && columnsOf(word) <= width && !Array.from(word).some(isWide)) { flush(); line = word; continue; }
      for (const char of word) { if (columnsOf(line) + columnsOf(char) > width) flush(); line += char; }
    }
    flush();
  }
  return out.length ? out : [""];
}

export type BlockKind = "act" | "scene" | "beat" | "action" | "cue" | "parenthetical" | "dialogue" | "transition" | "shot" | "note" | "onscreen" | "header";
export type Block = { kind: BlockKind; text: string; indent: number; width: number; spaceBefore: number; bold?: boolean; right?: boolean; /** Cue, parentheticals and dialogue of one speech share a group. */ group?: number; cue?: string; sceneId?: string };
export type ScreenplayOptions = { paper?: PaperSize; shots?: boolean; notes?: boolean; sceneNumbers?: boolean; sceneIds?: readonly string[]; header?: string };
/** The paragraphs of a screenplay, in order, with the indent and measure of each. */
export function screenplayBlocks(document: ScriptDocument, options: ScreenplayOptions = {}): Block[] {
  const { columns } = pageMetrics(options.paper ?? "a4"), blocks: Block[] = [];
  const dialogueWidth = Math.min(SCREENPLAY.dialogueWidth, columns - SCREENPLAY.dialogueIndent);
  const add = (kind: BlockKind, text: string, extra: Partial<Block> = {}) => blocks.push({ kind, text, indent: 0, width: columns, spaceBefore: 1, ...extra });
  if (options.header) add("header", options.header, { spaceBefore: 0 });
  let actId: string | undefined, group = 0;
  document.scenes.forEach((scene: ScriptScene, index) => {
    if (options.sceneIds && !options.sceneIds.includes(scene.id)) return;
    if (scene.actId && scene.actId !== actId) { const act = document.acts.find((entry) => entry.id === scene.actId); if (act?.title) add("act", act.title.toUpperCase(), { bold: true, spaceBefore: 2, sceneId: scene.id }); }
    actId = scene.actId;
    const number = options.sceneNumbers ? `${index + 1}. ` : "";
    if (scene.omitted) { add("scene", `${number}OMITTED`, { bold: true, spaceBefore: 2, sceneId: scene.id }); return; }
    const heading = headingText(document, scene, "-").toUpperCase() || scene.title.toUpperCase();
    if (heading || number) add("scene", `${number}${heading}`.trim(), { bold: true, spaceBefore: 2, sceneId: scene.id });
    const emitted = new Set<string>();
    const shotLine = (shotIndex: number) => {
      const shot = scene.shots[shotIndex];
      emitted.add(shot.id);
      add("shot", `SHOT ${index + 1}.${shotIndex + 1} — ${[shot.size, shot.angle, shot.movement, formatSeconds(shotTicks(document, scene, shot))].join(", ")}${shot.description ? ` — ${shot.description}` : ""}`, { sceneId: scene.id });
    };
    for (const beat of scene.beats) for (const line of beat.lines) {
      if (options.shots) scene.shots.forEach((shot, shotIndex) => { if (shot.lineIds[0] === line.id && !emitted.has(shot.id)) shotLine(shotIndex); });
      if (line.kind === "dialogue" || line.kind === "narration") {
        group++;
        const cue = `${(speakerOf(document, line) || (line.kind === "narration" ? "NARRATOR" : "")).toUpperCase()}${line.kind === "narration" ? " (V.O.)" : ""}`.trim();
        add("cue", cue, { indent: SCREENPLAY.cueIndent, width: columns - SCREENPLAY.cueIndent, group, cue, sceneId: scene.id });
        if (line.parenthetical) add("parenthetical", `(${line.parenthetical})`, { indent: SCREENPLAY.parentheticalIndent, width: SCREENPLAY.parentheticalWidth, spaceBefore: 0, group, cue, sceneId: scene.id });
        add("dialogue", line.text, { indent: SCREENPLAY.dialogueIndent, width: dialogueWidth, spaceBefore: 0, group, cue, sceneId: scene.id });
      } else if (line.kind === "transition") add("transition", line.text.toUpperCase(), { right: true, sceneId: scene.id });
      else if (line.kind === "on_screen_text") add("onscreen", `SUPER: ${line.text}`, { sceneId: scene.id });
      else if (line.kind === "visual_note" || line.kind === "sound_note") { if (options.notes) add("note", line.kind === "sound_note" ? `[SOUND: ${line.text}]` : `[${line.text}]`, { sceneId: scene.id }); }
      else add("action", line.text, { sceneId: scene.id });
    }
    if (options.shots) scene.shots.forEach((shot, shotIndex) => { if (!emitted.has(shot.id)) shotLine(shotIndex); });
  });
  return blocks;
}

export type Row = { text: string; indent: number; bold?: boolean; kind: BlockKind | "blank" | "more" };
const rowsOf = (block: Block, columns: number): Row[] => wrapColumns(block.text, block.width).map((text) => ({ text, indent: block.right ? Math.max(0, columns - columnsOf(text)) : block.indent, kind: block.kind, ...(block.bold ? { bold: true } : {}) }));
/** Plain text in screenplay layout with spaces: one continuous page. */
export function screenplayText(document: ScriptDocument, options: ScreenplayOptions = {}): string {
  const { columns } = pageMetrics(options.paper ?? "a4"), out: string[] = [];
  for (const block of screenplayBlocks(document, options)) {
    if (out.length) for (let blank = 0; blank < block.spaceBefore; blank++) out.push("");
    for (const row of rowsOf(block, columns)) out.push(`${" ".repeat(row.indent)}${row.text}`.replace(/\s+$/, ""));
  }
  return `${out.join("\n")}\n`;
}
/**
 * Pages of rows. A scene heading is never left alone at a page end; a speech that crosses a page ends its first part
 * with "(MORE)" and repeats its cue with "(CONT'D)" on the next page, and is never split before its second line.
 */
export function paginate(blocks: readonly Block[], paper: PaperSize = "a4"): Row[][] {
  const { columns, lines } = pageMetrics(paper), pages: Row[][] = [[]];
  let page = pages[0];
  const turn = () => { page = []; pages.push(page); };
  const room = () => lines - page.length;
  const blankRows = (count: number) => { if (page.length === 0) return; for (let index = 0; index < count && room() > 0; index++) page.push({ text: "", indent: 0, kind: "blank" }); };
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.group !== undefined && block.kind === "cue") {
      // A whole speech: the cue, its parentheticals and its dialogue.
      const parts: Row[] = [];
      let end = index;
      for (; end < blocks.length && blocks[end].group === block.group; end++) parts.push(...rowsOf(blocks[end], columns));
      index = end - 1;
      const gap = page.length === 0 ? 0 : block.spaceBefore;
      if (gap + parts.length <= room()) { blankRows(gap); page.push(...parts); continue; }
      // Splitting needs the cue, two lines and "(MORE)" here, and two lines on the next page.
      const fit = room() - gap - 1;
      if (fit >= 3 && parts.length - fit >= 2 && parts[fit - 1].kind === "dialogue") {
        blankRows(gap);
        page.push(...parts.slice(0, fit), { text: "(MORE)", indent: SCREENPLAY.cueIndent, kind: "more" });
        let rest = parts.slice(fit);
        for (;;) {
          turn();
          page.push({ text: `${block.cue} (CONT'D)`, indent: SCREENPLAY.cueIndent, kind: "cue" });
          if (rest.length <= room()) { page.push(...rest); break; }
          const take = room() - 1;
          page.push(...rest.slice(0, take), { text: "(MORE)", indent: SCREENPLAY.cueIndent, kind: "more" });
          rest = rest.slice(take);
        }
        continue;
      }
      if (parts.length <= lines) { turn(); page.push(...parts); continue; }
      blankRows(gap);
    }
    const rows = rowsOf(block, columns), gap = page.length === 0 ? 0 : block.spaceBefore;
    // A heading stays with what follows it: its own rows, a blank and at least two rows of the next block.
    const next = blocks[index + 1];
    const companion = (block.kind === "scene" || block.kind === "act") && next ? next.spaceBefore + Math.min(2, rowsOf(next, columns).length) + (next.kind === "cue" ? 1 : 0) : 0;
    if (gap + rows.length + companion > room() && page.length > 0 && rows.length + companion <= lines) turn();
    else blankRows(gap);
    for (const row of rows) { if (room() === 0) turn(); page.push(row); }
  }
  return pages;
}
/** The location and speaker names a file mentions, for a cast page or a header. */
export const sceneLocation = (document: ScriptDocument, scene: ScriptScene): string => entityName(document, "locations", scene.heading.locationId) ?? scene.heading.locationText;

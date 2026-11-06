export type StreamMarkdownParts = { complete: string[]; pending: string; pendingFence: boolean };

const fenceLine = /^ {0,3}(`{3,}|~{3,})([^\n]*)/;
const headingOrRule = /^ {0,3}(?:#{1,6}(?:\s|$)|(?:\*\s*){3,}$|(?:-\s*){3,}$|(?:_\s*){3,}$)/;
const listStart = /^ {0,3}(?:[-+*]|\d+[.)])\s/;

/**
 * Separates complete Markdown blocks from the one that is still arriving. It scans lines only; callers can keep each
 * completed source string mounted so Markdown is parsed once, while the changing tail is cheap to draw.
 */
export function splitStreamingMarkdown(source: string): StreamMarkdownParts {
  const complete: string[] = [];
  let start = 0;
  let offset = 0;
  let fence: { char: string; length: number } | null = null;
  let kind: "paragraph" | "list" | "quote" | "table" | "code" | "single" | null = null;
  const flush = (end: number) => {
    const value = source.slice(start, end).trimEnd();
    if (value.trim()) complete.push(value);
    start = end;
    kind = null;
  };
  const lines = source.match(/[^\n]*(?:\n|$)/g) ?? [];
  for (const lineWithEnd of lines) {
    if (!lineWithEnd) continue;
    const line = lineWithEnd.replace(/\n$/, "");
    const end = offset + lineWithEnd.length;
    const blank = /^\s*$/.test(line);
    if (fence) {
      const closingFence = /^ {0,3}(`+|~+)[ \t]*$/.exec(line)?.[1];
      if (closingFence?.[0] === fence.char && closingFence.length >= fence.length) {
        fence = null;
        flush(end);
      }
      offset = end;
      continue;
    }
    if (blank) {
      if (kind === "list") {
        // A blank line between list items is still part of the same Markdown list.
        const next = source.slice(end).match(/[^\n]+/)?.[0] ?? "";
        if (listStart.test(next) || /^ {2,}\S/.test(next)) { offset = end; continue; }
      }
      if (kind) flush(offset);
      start = end;
      offset = end;
      continue;
    }
    const openingFence = fenceLine.exec(line);
    const nextKind = openingFence ? "code" : listStart.test(line) ? "list" : /^ {0,3}>/.test(line) ? "quote" : /^\|?.+\|.+/.test(line) ? "table" : headingOrRule.test(line) ? "single" : "paragraph";
    if (kind && kind !== nextKind && (kind !== "list" || nextKind !== "list")) flush(offset);
    if (!kind) { start = offset; kind = nextKind; }
    if (openingFence) {
      const marker = openingFence[1]!;
      fence = { char: marker[0]!, length: marker.length };
    } else if (kind === "single") flush(end);
    offset = end;
  }
  const pending = source.slice(start);
  const openFence = fence !== null;
  return { complete, pending, pendingFence: openFence };
}

/** CommonMark with GitHub-flavoured tables, task lists, strikethrough and autolinks, parsed into a tree the view draws as native text. */
import { Lexer, type Token, type Tokens } from "marked";
import type { ColorToken } from "../tokens.ts";

export type Inline =
  | { type: "text"; text: string } | { type: "code"; text: string } | { type: "break" }
  | { type: "strong" | "em" | "del"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] }
  | { type: "image"; src: string; alt: string };
export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "quote"; children: Block[] }
  | { type: "list"; ordered: boolean; start: number; items: Array<{ task: boolean; checked: boolean; children: Block[] }> }
  | { type: "code"; lang: string; text: string; open: boolean }
  | { type: "table"; header: Inline[][]; align: Array<"left" | "center" | "right" | null>; rows: Inline[][][] }
  | { type: "rule" };

const unescape = (text: string) => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[name]!);

function inlines(tokens: Token[] | undefined): Inline[] {
  const out: Inline[] = [];
  const text = (value: string) => { const last = out.at(-1); if (last?.type === "text") last.text += value; else if (value) out.push({ type: "text", text: value }); };
  for (const token of tokens ?? []) {
    switch (token.type) {
      case "strong": case "em": case "del": out.push({ type: token.type, children: inlines((token as Tokens.Strong).tokens) }); break;
      case "codespan": out.push({ type: "code", text: unescape((token as Tokens.Codespan).text) }); break;
      case "br": out.push({ type: "break" }); break;
      case "link": out.push({ type: "link", href: (token as Tokens.Link).href, children: inlines((token as Tokens.Link).tokens) }); break;
      case "image": out.push({ type: "image", src: (token as Tokens.Image).href, alt: (token as Tokens.Image).text }); break;
      // No HTML passthrough: raw HTML in the source is shown as the text it is.
      case "html": text(token.raw); break;
      case "escape": text((token as Tokens.Escape).text); break;
      case "text": {
        const inner = (token as Tokens.Text).tokens;
        if (inner?.length) out.push(...inlines(inner)); else text(unescape((token as Tokens.Text).text));
        break;
      }
      default: text(token.raw);
    }
  }
  return out;
}

function blocks(tokens: Token[]): Block[] {
  const out: Block[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "heading": out.push({ type: "heading", level: (token as Tokens.Heading).depth as 1, children: inlines((token as Tokens.Heading).tokens) }); break;
      case "paragraph": out.push({ type: "paragraph", children: inlines((token as Tokens.Paragraph).tokens) }); break;
      case "text": out.push({ type: "paragraph", children: inlines((token as Tokens.Text).tokens ?? [token]) }); break;
      case "html": out.push({ type: "paragraph", children: [{ type: "text", text: token.raw.replace(/\n+$/, "") }] }); break;
      case "blockquote": out.push({ type: "quote", children: blocks((token as Tokens.Blockquote).tokens) }); break;
      case "hr": out.push({ type: "rule" }); break;
      case "code": {
        const code = token as Tokens.Code;
        const fence = /^ {0,3}(`{3,}|~{3,})/.exec(code.raw)?.[1];
        // A fence with no closing line is still streaming: it is drawn as an open block.
        const closed = !fence || new RegExp(`\\n {0,3}${fence[0]}{${fence.length},}[ \\t]*\\n*$`).test(code.raw);
        out.push({ type: "code", lang: (code.lang ?? "").trim().split(/\s+/)[0] ?? "", text: code.text, open: !closed });
        break;
      }
      case "list": {
        const list = token as Tokens.List;
        out.push({ type: "list", ordered: list.ordered, start: Number(list.start) || 1, items: list.items.map((item) => ({ task: Boolean(item.task), checked: Boolean(item.checked), children: blocks(item.tokens.filter((inner) => inner.type !== "checkbox")) })) });
        break;
      }
      case "table": {
        const table = token as Tokens.Table;
        out.push({ type: "table", header: table.header.map((cell) => inlines(cell.tokens)), align: table.align as Array<"left" | "center" | "right" | null>, rows: table.rows.map((row) => row.map((cell) => inlines(cell.tokens))) });
        break;
      }
      case "space": case "def": break;
      default: out.push({ type: "paragraph", children: [{ type: "text", text: token.raw }] });
    }
  }
  return out;
}

/** Parses markdown. Incomplete input is valid input: an unterminated fence is an open code block and an unterminated table stays text. */
export function parseMarkdown(source: string): Block[] {
  return blocks(new Lexer({ gfm: true, breaks: false }).lex(source));
}
/** A key per block that survives appended input, so a streaming block is updated in place instead of re-created. */
export const blockKey = (block: Block, index: number) => `${index}:${block.type}`;
export const plainText = (nodes: Inline[]): string => nodes.map((node) => ("text" in node ? node.text : "children" in node ? plainText(node.children) : node.type === "image" ? node.alt : "\n")).join("");
/** A product link opens through deep links; anything else goes to the system browser after the external-link rule. */
export const isProductLink = (href: string) => /^jagentchill:\/\//i.test(href) || /^\/(?!\/)/.test(href);
export const MARKDOWN = { imageMaxHeight: 320, listIndent: 16, quoteBar: 3 } as const;

export type CodeTokenKind = "keyword" | "string" | "number" | "comment" | "type" | "error" | "plain";
/** Syntax colours come from the ANSI tokens, which already meet 4.5:1 on `terminal/bg`. */
export const SYNTAX: Record<CodeTokenKind, ColorToken> = {
  keyword: "terminal/ansi/blue", string: "terminal/ansi/green", number: "terminal/ansi/yellow", comment: "terminal/ansi/bright-black",
  type: "terminal/ansi/cyan", error: "terminal/ansi/red", plain: "terminal/fg",
};
type Grammar = { keywords: RegExp; comment: RegExp; string: RegExp; types?: RegExp };
const C_STRING = /^(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`)/;
const JS: Grammar = {
  keywords: /^(?:as|async|await|break|case|catch|class|const|continue|default|delete|do|else|enum|export|extends|false|finally|for|from|function|if|implements|import|in|instanceof|interface|let|new|null|of|return|satisfies|static|super|switch|this|throw|true|try|type|typeof|undefined|var|void|while|yield)\b/,
  comment: /^(?:\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))/, string: C_STRING, types: /^(?:[A-Z][A-Za-z0-9_]*|string|number|boolean|unknown|never|any|object|bigint|symbol)\b/,
};
const GRAMMARS: Record<string, Grammar> = {
  javascript: JS, typescript: JS,
  json: { keywords: /^(?:true|false|null)\b/, comment: /^(?!)/, string: /^"(?:\\.|[^"\\\n])*"/ },
  python: {
    keywords: /^(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|None|nonlocal|not|or|pass|raise|return|True|try|while|with|yield)\b/,
    comment: /^#[^\n]*/, string: /^(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/, types: /^(?:[A-Z][A-Za-z0-9_]*|int|str|float|bool|list|dict|tuple|set|bytes)\b/,
  },
  bash: {
    keywords: /^(?:if|then|else|elif|fi|for|while|until|do|done|case|esac|in|function|return|export|local|readonly|exit|set|unset|source|echo|cd)\b/,
    comment: /^#[^\n]*/, string: /^(?:"(?:\\.|[^"\\])*"|'[^']*')/,
  },
};
const LANGUAGE_ALIASES: Record<string, string> = { js: "javascript", jsx: "javascript", mjs: "javascript", ts: "typescript", tsx: "typescript", py: "python", sh: "bash", shell: "bash", zsh: "bash", jsonc: "json" };
export const BUNDLED_LANGUAGES = Object.keys(GRAMMARS);
export const languageOf = (lang: string) => { const name = lang.toLowerCase(); return LANGUAGE_ALIASES[name] ?? name; };

/**
 * Splits code into coloured runs, one array per line. Languages outside the bundled set, and blocks longer than 2,000
 * lines, are returned as plain text.
 */
export function highlight(code: string, lang: string, maxLines = 2000): Array<Array<{ kind: CodeTokenKind; text: string }>> {
  const lines = code.split("\n");
  const grammar = GRAMMARS[languageOf(lang)];
  if (!grammar || lines.length > maxLines) return lines.map((line) => [{ kind: "plain" as const, text: line }]);
  const out: Array<Array<{ kind: CodeTokenKind; text: string }>> = [[]];
  const push = (kind: CodeTokenKind, text: string) => {
    text.split("\n").forEach((piece, i) => {
      if (i > 0) out.push([]);
      const line = out.at(-1)!, last = line.at(-1);
      if (piece === "") return;
      if (last && last.kind === kind) last.text += piece; else line.push({ kind, text: piece });
    });
  };
  let rest = code;
  let atWord = true;
  while (rest.length > 0) {
    const match = (pattern: RegExp | undefined): string | undefined => (pattern ? pattern.exec(rest)?.[0] : undefined);
    const comment: string | undefined = match(grammar.comment);
    const text: string | undefined = comment ? undefined : match(grammar.string);
    const word: boolean = atWord && !comment && !text;
    const number: string | undefined = word ? match(/^(?:0x[0-9a-fA-F]+|\d[\d_]*\.?\d*(?:e[+-]?\d+)?)\b/) : undefined;
    const keyword: string | undefined = word && !number ? match(grammar.keywords) : undefined;
    const type: string | undefined = word && !number && !keyword ? match(grammar.types) : undefined;
    const taken: string | undefined = comment ?? text ?? number ?? keyword ?? type;
    if (taken) push(comment ? "comment" : text ? "string" : number ? "number" : keyword ? "keyword" : "type", taken);
    else push("plain", rest[0]!);
    const consumed: string = taken ?? rest[0]!;
    atWord = !/[A-Za-z0-9_$]$/.test(consumed);
    rest = rest.slice(consumed.length);
  }
  return out;
}
/** A block longer than 30 lines is collapsed to its first 30 until the reader asks for all. */
export function visibleLines<T>(lines: readonly T[], expanded: boolean, limit = 30): { lines: T[]; hidden: number } {
  return expanded || lines.length <= limit ? { lines: [...lines], hidden: 0 } : { lines: lines.slice(0, limit), hidden: lines.length - limit };
}

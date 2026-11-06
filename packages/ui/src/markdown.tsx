import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Image, ScrollView, View, type TextStyle } from "react-native";
import { Button } from "./button.tsx";
import { CODE } from "./logic/content.ts";
import { MARKDOWN, SYNTAX, blockKey, highlight, isProductLink, languageOf, parseMarkdown, plainText, visibleLines, BUNDLED_LANGUAGES, type Block, type Inline } from "./logic/markdown.ts";
import { copyText } from "./platform/dom";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { Checkbox } from "./toggles.tsx";
import { borderWidth, radius, size, space, type TypeToken } from "./tokens.ts";

export type CodeBlockProps = {
  code: string; lang?: string; showLineNumbers?: boolean;
  /** An extra header action, e.g. "Apply" or "Open in terminal". */
  action?: { label: string; onPress(code: string): void };
  /** Still streaming: the closing fence has not arrived. */
  open?: boolean; wrap?: boolean; highlight?: boolean;
};

/**
 * A fenced block in `type/mono` with a header (language, "Copy", an optional action, a "Wrap" toggle). Syntax colours are the
 * ANSI tokens on `terminal/bg`; blocks longer than 30 lines are collapsed and blocks longer than 2,000 lines are not highlighted.
 */
export function CodeBlock(props: CodeBlockProps) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [wrap, setWrap] = useState(Boolean(props.wrap));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const lang = languageOf(props.lang ?? "");
  const lineCount = props.code.split("\n").length;
  const coloured = props.highlight !== false && BUNDLED_LANGUAGES.includes(lang) && lineCount <= CODE.noHighlightAfter;
  const lines = useMemo(() => highlight(props.code, coloured ? lang : "", CODE.noHighlightAfter), [props.code, lang, coloured]);
  const shown = visibleLines(lines, expanded, CODE.collapseAfter);
  const digits = String(lines.length).length;
  const body = (
    <View style={{ paddingVertical: space[2], paddingHorizontal: space[3] }}>
      {shown.lines.map((line, index) => (
        <View key={index} style={{ flexDirection: "row" }}>
          {props.showLineNumbers ? <Text variant="mono" color="terminal/ansi/bright-black" selectable={false} style={{ width: digits * space[2] + space[3] }}>{String(index + 1).padStart(digits, " ")}</Text> : null}
          <Text variant="mono" color="terminal/fg" selectable style={wrap ? { flex: 1 } : { flexShrink: 0 }}>
            {line.length === 0 ? " " : line.map((run, at) => <Text key={at} variant="mono" color={SYNTAX[run.kind]}>{run.text}</Text>)}
          </Text>
        </View>
      ))}
    </View>
  );
  return (
    <View testID="code-block" {...({ dataSet: { open: String(props.open === true) } } as object)} style={{ borderWidth: borderWidth.hairline, borderColor: theme.color("border/hairline"), borderRadius: radius.md, backgroundColor: theme.color(coloured ? "terminal/bg" : "bg/inset"), overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingStart: space[3], paddingEnd: space[1], borderBottomWidth: borderWidth.hairline, borderBottomColor: theme.color("border/hairline") }}>
        <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{props.lang || theme.t("language")}</Text>
        <Button size="xs" kind="ghost" label={theme.t("wrap")} pressed={wrap} onPress={() => setWrap((value) => !value)} />
        {props.action ? <Button size="xs" kind="ghost" label={props.action.label} onPress={() => props.action!.onPress(props.code)} /> : null}
        <Button size="xs" kind="ghost" icon="copy" label={theme.t(copied ? "copied" : "copy")}
          // The clipboard gets the block's text, without line numbers.
          onPress={() => { void copyText(props.code).then(() => { setCopied(true); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), CODE.copiedMs); }); }} />
      </View>
      {wrap ? body : <ScrollView horizontal>{body}</ScrollView>}
      {shown.hidden > 0 ? (
        <View style={{ borderTopWidth: borderWidth.hairline, borderTopColor: theme.color("border/hairline"), padding: space[1], alignItems: "flex-start" }}>
          <Button size="xs" kind="ghost" label={theme.t("showAllLines", { n: lines.length })} onPress={() => setExpanded(true)} />
        </View>
      ) : null}
    </View>
  );
}

const HEADING: Record<number, TypeToken> = { 1: "h1", 2: "title-md", 3: "title-sm", 4: "body-medium", 5: "body-medium", 6: "body-medium" };

export type MarkdownViewProps = {
  source: string;
  textStyle?: TextStyle;
  /** Renders incomplete input without layout jumps. */
  streaming?: boolean;
  /** Product links go through deep links, others through the system browser after the external-link rule. */
  onLink(href: string, kind: "product" | "external"): void;
  /** Returns the URL to load for an image source, or null to block it; blocked images show a placeholder tile with their alt text. */
  resolveImage?(src: string): string | null;
  codeAction?: CodeBlockProps["action"]; onToggleTask?(index: number, checked: boolean): void;
};

/**
 * CommonMark with GitHub tables, task lists, strikethrough and autolinks, drawn as native text. There is no HTML passthrough:
 * raw HTML in the source is shown as text. Text is selectable on every platform.
 */
export function MarkdownView(props: MarkdownViewProps) {
  const theme = useTheme();
  const blocks = useMemo(() => parseMarkdown(props.source), [props.source]);
  let task = -1;

  const inline = (nodes: Inline[], variant: TypeToken, key = ""): ReactNode => nodes.map((node, index) => {
    const id = `${key}${index}`;
    switch (node.type) {
      case "text": return <Text key={id} variant={variant} style={props.textStyle}>{node.text}</Text>;
      case "break": return "\n";
      case "code": return <Text key={id} variant="mono" style={{ backgroundColor: theme.color("bg/inset") }}>{node.text}</Text>;
      case "strong": return <Text key={id} variant={variant} style={[props.textStyle, { fontWeight: "600" }]}>{inline(node.children, variant, `${id}-`)}</Text>;
      case "em": return <Text key={id} variant={variant} style={[props.textStyle, { fontStyle: "italic" }]}>{inline(node.children, variant, `${id}-`)}</Text>;
      case "del": return <Text key={id} variant={variant} style={[props.textStyle, { textDecorationLine: "line-through" }]}>{inline(node.children, variant, `${id}-`)}</Text>;
      case "link": return <Text key={id} variant={variant} style={props.textStyle} color="accent/text" underline role={undefined} onPress={() => props.onLink(node.href, isProductLink(node.href) ? "product" : "external")}>{inline(node.children, variant, `${id}-`)}</Text>;
      case "image": return <Text key={id} variant={variant} color="text/secondary">{node.alt}</Text>;
    }
  });
  const image = (node: Extract<Inline, { type: "image" }>, key: string) => {
    const uri = props.resolveImage?.(node.src) ?? null;
    return uri
      ? <Image key={key} source={{ uri }} accessibilityLabel={node.alt} resizeMode="contain" style={{ width: "100%", height: MARKDOWN.imageMaxHeight, maxHeight: size.imageMax }} />
      : <View key={key} accessible accessibilityLabel={`${theme.t("blockedImage")}: ${node.alt}`} style={{ padding: space[3], borderRadius: radius.md, backgroundColor: theme.color("bg/subtle"), alignItems: "center" }}><Text variant="meta" color="text/secondary">{node.alt || theme.t("blockedImage")}</Text></View>;
  };
  const render = (list: Block[], prefix = ""): ReactNode => list.map((block, index) => {
    const key = prefix + blockKey(block, index);
    switch (block.type) {
      case "heading": return <Text key={key} variant={HEADING[block.level]!} level={block.level} selectable>{inline(block.children, HEADING[block.level]!)}</Text>;
      case "paragraph": {
        // A paragraph that is only an image is drawn as the image.
        const only = block.children.length === 1 && block.children[0]!.type === "image" ? block.children[0] : null;
        return only && only.type === "image" ? image(only, key) : <Text key={key} selectable style={props.textStyle}>{inline(block.children, "body")}</Text>;
      }
      case "quote": return <View key={key} style={{ borderStartWidth: size.quoteBar, borderStartColor: theme.color("border/strong"), paddingStart: space[3], gap: space[2] }}>{render(block.children, `${key}/`)}</View>;
      case "rule": return <View key={key} role="separator" style={{ height: borderWidth.hairline, backgroundColor: theme.color("border/hairline") }} />;
      case "code": return <CodeBlock key={key} code={block.text} lang={block.lang} open={block.open} highlight={props.streaming && block.open ? false : undefined} action={props.codeAction} />;
      case "list": return (
        <View key={key} role="list" style={{ gap: space[1] }}>
          {block.items.map((item, at) => {
            const mine = item.task ? ++task : -1;
            return (
              <View key={at} role="listitem" style={{ flexDirection: "row", gap: space[2], paddingStart: size.lineIndent }}>
                {item.task
                  ? <Checkbox checked={item.checked} disabled={!props.onToggleTask} accessibilityLabel={item.children[0]?.type === "paragraph" ? plainText(item.children[0].children) : ""} onChange={(checked) => props.onToggleTask?.(mine, checked)} />
                  : <Text color="text/secondary" tabular>{block.ordered ? `${block.start + at}.` : "•"}</Text>}
                <View style={{ flex: 1, gap: space[1] }}>{render(item.children, `${key}/${at}/`)}</View>
              </View>
            );
          })}
        </View>
      );
      case "table": return (
        // Wide tables scroll horizontally inside the view.
        <ScrollView key={key} horizontal>
          <View role={"table" as "list"} style={{ borderWidth: borderWidth.hairline, borderColor: theme.color("border/hairline"), borderRadius: radius.md, overflow: "hidden" }}>
            <View role="row" style={{ flexDirection: "row", backgroundColor: theme.color("bg/sidebar"), minHeight: size.tableHeader, alignItems: "center" }}>
              {block.header.map((cell, at) => <View key={at} role="columnheader" style={{ minWidth: size.sliderMin * 3, paddingHorizontal: space[3] }}><Text variant="meta" color="text/secondary" align={block.align[at] ?? "left"}>{inline(cell, "meta")}</Text></View>)}
            </View>
            {block.rows.map((row, at) => (
              <View key={at} role="row" style={{ flexDirection: "row", minHeight: size.tableRowDense, alignItems: "center", borderTopWidth: borderWidth.hairline, borderTopColor: theme.color("border/hairline") }}>
                {row.map((cell, column) => <View key={column} role="cell" style={{ minWidth: size.sliderMin * 3, paddingHorizontal: space[3] }}><Text selectable align={block.align[column] ?? "left"}>{inline(cell, "body")}</Text></View>)}
              </View>
            ))}
          </View>
        </ScrollView>
      );
    }
  });
  return <View aria-busy={props.streaming || undefined} style={{ gap: space[2] }}>{render(blocks)}</View>;
}

import { workflow as wf } from "@jagentchill/editor-core";
import type { WorkflowDocument } from "@jagentchill/protocol";
import { ICONS, fontFamily, type ColorToken, type Theme } from "@jagentchill/ui";
import type { T } from "../locale";
import { alpha, cardFacts, cardLook, edgeLabel, edgeLook, kindLabel, kindsInUse, mix, portLabel } from "./look";
import { KIND_LABELS, NODE_ICONS } from "./strings";

const PAD = 48;
const LEGEND = 44;
const escape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** A picture cannot measure text, so a line is cut by a width per character that errs on the wide side. */
const fit = (text: string, width: number, size: number): string => { const max = Math.max(4, Math.floor(width / (size * 0.56))); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };

/**
 * The workflow as a standalone SVG picture in the look of the canvas: the same cards, curves, labels, containers and
 * legend, drawn from the same geometry and the same colours, with nothing of the editor (selection, viewport) in it.
 */
export function diagramSvg(doc: WorkflowDocument, theme: Theme, t: T): { svg: string; width: number; height: number } {
  const color = (token: ColorToken) => theme.color(token);
  const font = fontFamily.uiJa;
  const frames = [...wf.bodyFrames(doc).map((entry) => ({ frame: entry.frame, token: "wf/type/flow" as ColorToken, label: `${doc.nodes.find((node) => node.id === entry.owner)?.name ?? ""} · ${entry.kind === "loop" ? t("Loop body") : t("Parallel body")}` })),
    ...doc.groups.map((group) => ({ frame: group.frame, token: `wf/group/${group.colorIndex}` as ColorToken, label: group.label }))];
  const routes = wf.routesOf(doc), lines = wf.edgeLines(doc);
  const boxes = [...doc.nodes.map(wf.nodeBox), ...frames.map((entry) => entry.frame), ...doc.notes.map((note) => ({ x: note.x, y: note.y, width: note.width, height: note.height })),
    ...[...routes.values()].flat().map((point) => ({ x: point.x, y: point.y, width: 0, height: 0 }))];
  const left = boxes.length ? Math.min(...boxes.map((box) => box.x)) : 0, top = boxes.length ? Math.min(...boxes.map((box) => box.y)) : 0;
  const right = boxes.length ? Math.max(...boxes.map((box) => box.x + box.width)) : 0, bottom = boxes.length ? Math.max(...boxes.map((box) => box.y + box.height)) : 0;
  const legend = kindsInUse(doc);
  const width = Math.max(320, Math.round(right - left + PAD * 2)), height = Math.round(bottom - top + PAD * 2 + (legend.length > 3 ? LEGEND : 0));
  const out: string[] = [];
  const dark = theme.scheme === "dark", surface = color("bg/elevated"), canvas = color("bg/canvas"), hairline = color(dark ? "border/strong" : "border/hairline");
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${escape(font)}">`);
  out.push(`<defs><pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1" fill="${color("wf/grid-major")}"/></pattern><filter id="lift" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="${dark ? 0.35 : 0.1}"/></filter></defs>`);
  out.push(`<rect width="${width}" height="${height}" fill="${canvas}"/><rect width="${width}" height="${height}" fill="url(#dots)"/>`);
  out.push(`<g transform="translate(${PAD - left} ${PAD - top})">`);
  for (const entry of frames) {
    const { frame } = entry, tone = color(entry.token), label = fit(entry.label, frame.width - 48, 11);
    out.push(`<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="16" fill="${alpha(mix(surface, tone, 0.06), dark ? 0.45 : 0.6)}" stroke="${alpha(tone, dark ? 0.3 : 0.24)}" stroke-width="1"/>`);
    if (label) out.push(`<rect x="${frame.x + 12}" y="${frame.y + 10}" width="${label.length * 6.4 + 18}" height="24" rx="12" fill="${alpha(tone, dark ? 0.18 : 0.12)}"/><text x="${frame.x + 21}" y="${frame.y + 26}" font-size="11" font-weight="500" fill="${color("text/primary")}">${escape(label)}</text>`);
  }
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const labels: string[] = [];
  for (const edge of doc.edges) {
    const line = lines.get(edge.id);
    if (!line) continue;
    const look = edgeLook(theme, edge, byId.get(edge.from.node), {}), tip = line.tip;
    out.push(`<path d="${line.d}" fill="none" stroke="${look.color}" stroke-width="${look.width}" stroke-linecap="round"${look.dash ? ` stroke-dasharray="${look.dash}"` : ""}/>`);
    out.push(`<path d="M ${tip.x - 8} ${tip.y - 4.5} L ${tip.x - 2} ${tip.y} L ${tip.x - 8} ${tip.y + 4.5}" fill="none" stroke="${look.color}" stroke-width="${look.width}" stroke-linecap="round" stroke-linejoin="round"/>`);
    const label = edgeLabel(doc, edge, t);
    if (label) {
      const at = line.mid, text = fit(label, 150, 11), wide = text.length * 6.4 + 16;
      labels.push(`<rect x="${at.x - wide / 2}" y="${at.y - 10}" width="${wide}" height="20" rx="10" fill="${surface}" stroke="${hairline}"/><text x="${at.x}" y="${at.y + 4}" font-size="11" font-weight="500" text-anchor="middle" fill="${color("text/secondary")}">${escape(text)}</text>`);
    }
  }
  out.push(...labels);
  for (const note of doc.notes) {
    const tone = color("warning"), paper = mix(surface, tone, dark ? 0.2 : 0.16);
    out.push(`<rect x="${note.x}" y="${note.y}" width="${note.width}" height="${note.height}" rx="6" fill="${paper}" filter="url(#lift)"/><rect x="${note.x}" y="${note.y}" width="${note.width}" height="8" rx="3" fill="${mix(paper, tone, 0.25)}"/>`);
    // Wrapped by the same rough measure as a cut line.
    const perLine = Math.max(6, Math.floor((note.width - 24) / 7.2)), words = note.text.split(/\s+/), lines: string[] = [];
    for (const word of words) { const last = lines[lines.length - 1]; if (last !== undefined && `${last} ${word}`.length <= perLine) lines[lines.length - 1] = `${last} ${word}`; else lines.push(word); }
    lines.slice(0, Math.max(1, Math.floor((note.height - 24) / 18))).forEach((line, index) => out.push(`<text x="${note.x + 12}" y="${note.y + 30 + index * 18}" font-size="13" fill="${color("text/primary")}">${escape(fit(line, note.width - 24, 13))}</text>`));
  }
  for (const node of doc.nodes) {
    const box = wf.nodeBox(node), body = wf.bodyHeight(node), look = cardLook(theme, node.type), ports = wf.canvasPorts(node), icon = ICONS[NODE_ICONS[node.type]], facts = cardFacts(node, t), kind = kindLabel(node, t);
    out.push(`<g${node.disabled ? ' opacity="0.45"' : ""}>`);
    out.push(`<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="12" fill="${look.surface}" stroke="${look.border}" stroke-width="1" filter="url(#lift)"${node.disabled ? ' stroke-dasharray="5 4"' : ""}/>`);
    out.push(`<rect x="${box.x + 14}" y="${box.y + 14}" width="28" height="28" rx="8" fill="${look.tile}"/>`);
    if (icon) out.push(`<svg x="${box.x + 20}" y="${box.y + 20}" width="16" height="16" viewBox="${icon.viewBox}" fill="none" stroke="${look.tone}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icon.body.replaceAll("currentColor", look.tone)}</svg>`);
    out.push(`<text x="${box.x + 52}" y="${box.y + (kind ? 26 : 33)}" font-size="14" font-weight="500" fill="${color("text/primary")}">${escape(fit(node.name, box.width - 66, 14))}</text>`);
    if (kind) out.push(`<text x="${box.x + 52}" y="${box.y + 41}" font-size="11" fill="${color("text/tertiary")}">${escape(fit(kind, box.width - 66, 11))}</text>`);
    out.push(`<text x="${box.x + 14}" y="${box.y + 66}" font-size="13" fill="${color("text/secondary")}">${escape(fit(facts.summary, box.width - 28, 13))}</text>`);
    let chipX = box.x + 14;
    for (const chip of facts.chips) {
      const text = fit(chip, box.width - 42, 11), wide = Math.min(box.width - 28, text.length * 6.4 + 14);
      out.push(`<rect x="${chipX}" y="${box.y + 74}" width="${wide}" height="20" rx="6" fill="${color("bg/subtle")}"/><text x="${chipX + 7}" y="${box.y + 88}" font-size="11" font-weight="500" fill="${color("text/secondary")}">${escape(text)}</text>`);
      chipX += wide + 6;
    }
    const rows = ports.outputs.filter((port) => port.row !== undefined);
    if (rows.length) out.push(`<path d="M ${box.x} ${box.y + body} H ${box.x + box.width}" stroke="${color("border/hairline")}" stroke-width="1"/>`);
    for (const port of rows) {
      const y = box.y + (wf.portOffset(node, "out", port.id) ?? 0), given = ((node.config.cases as Array<{ id: string; label?: string }> | undefined) ?? []).find((entry) => entry.id === port.id)?.label;
      out.push(`<text x="${box.x + box.width - 16}" y="${y + 4}" font-size="12" text-anchor="end" fill="${color("text/secondary")}">${escape(fit(given || portLabel(port, t), box.width - 40, 12))}</text>`);
      out.push(`<circle cx="${box.x + box.width}" cy="${y}" r="4" fill="${look.surface}" stroke="${color("border/strong")}" stroke-width="2"/>`);
    }
    out.push("</g>");
  }
  out.push("</g>");
  if (legend.length > 3) {
    let x = PAD;
    for (const entry of legend) {
      const look = cardLook(theme, entry.type), label = t(KIND_LABELS[entry.kind] ?? KIND_LABELS.unknown), wide = (label.length + 2) * 6.6 + 30;
      out.push(`<rect x="${x}" y="${height - 36}" width="${wide}" height="22" rx="11" fill="${surface}" stroke="${hairline}"/><circle cx="${x + 12}" cy="${height - 25}" r="3.5" fill="${look.tone}"/><text x="${x + 21}" y="${height - 21}" font-size="11" font-weight="500" fill="${color("text/secondary")}">${escape(label)} <tspan fill="${color("text/tertiary")}">${entry.count}</tspan></text>`);
      x += wide + 6;
    }
  }
  out.push("</svg>");
  return { svg: out.join(""), width, height };
}

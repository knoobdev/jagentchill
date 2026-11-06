/**
 * Background gradient strings: the grammar of "Background gradient parsing" and its rasterisation. One or more
 * comma-separated layers (linear, radial, their repeating forms, or a plain colour), painted last to first. Colour
 * stops interpolate in premultiplied sRGB, as CSS does. The stored string is never rewritten.
 */

type Rgba = [number, number, number, number];
type Length = { px: number; percent: number };
type Stop = { color: Rgba; position?: Length };
export type GradientLayer =
  | { kind: "solid"; color: Rgba }
  | { kind: "linear"; repeating: boolean; angle?: number; corner?: [number, number]; stops: Stop[] }
  | { kind: "radial"; repeating: boolean; shape: "circle" | "ellipse"; extent: string; size?: Length[]; at: [Length, Length]; stops: Stop[] };
export type ParsedGradient = { layers: GradientLayer[]; skipped: number };

const NAMED = "aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32".split(" ");
const NAMED_COLORS = new Map<string, string>();
for (let index = 0; index < NAMED.length; index += 2) NAMED_COLORS.set(NAMED[index], NAMED[index + 1]);

/** Splits at commas (or spaces) that are not inside parentheses. */
function splitTop(text: string, separator: "," | " "): string[] {
  const out: string[] = [];
  let depth = 0, current = "";
  for (const character of text) {
    if (character === "(") depth++;
    if (character === ")") depth--;
    if (depth === 0 && (separator === "," ? character === "," : /\s/.test(character))) { if (current.trim() !== "" || separator === ",") out.push(current.trim()); current = ""; }
    else current += character;
  }
  if (current.trim() !== "" || separator === ",") out.push(current.trim());
  return out;
}

const channel = (text: string, scale: number): number => (text.endsWith("%") ? (parseFloat(text) / 100) * scale : parseFloat(text));
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const part = (t: number) => { const u = ((t % 1) + 1) % 1; return u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p; };
  return [part(hue + 1 / 3), part(hue), part(hue - 1 / 3)];
}

/** A CSS colour of the supported forms as straight RGBA in 0…1, or `null`. */
export function parseCssColor(text: string): Rgba | null {
  const value = text.trim().toLowerCase();
  if (value === "transparent") return [0, 0, 0, 0];
  const named = NAMED_COLORS.get(value);
  const hex = named ?? (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value)?.[1]);
  if (hex) {
    const digits = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join("") : hex;
    const part = (index: number) => parseInt(digits.slice(index, index + 2), 16) / 255;
    return [part(0), part(2), part(4), digits.length === 8 ? part(6) : 1];
  }
  const call = /^(rgba?|hsla?)\((.*)\)$/.exec(value);
  if (!call) return null;
  const parts = call[2].split(/[\s,/]+/).filter((part) => part !== "");
  if (parts.length < 3 || parts.length > 4 || parts.some((part) => !/^[+-]?(\d+\.?\d*|\.\d+)(%|deg)?$/.test(part))) return null;
  const alpha = parts[3] === undefined ? 1 : Math.min(Math.max(channel(parts[3], 1), 0), 1);
  if (call[1].startsWith("rgb")) {
    const [r, g, b] = parts.slice(0, 3).map((part) => Math.min(Math.max(channel(part, 255) / 255, 0), 1));
    return [r, g, b, alpha];
  }
  const [r, g, b] = hslToRgb(parseFloat(parts[0]), Math.min(Math.max(parseFloat(parts[1]) / 100, 0), 1), Math.min(Math.max(parseFloat(parts[2]) / 100, 0), 1));
  return [r, g, b, alpha];
}

/** A length: `px`, `%`, `em` (16 px), a bare 0, or `calc()` over `px` and `%` with `+` and `-`. */
function parseLength(text: string): Length | null {
  const value = text.trim().toLowerCase();
  const single = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|%|em)?$/.exec(value);
  if (single) {
    const number = parseFloat(single[1]);
    if (single[2] === "%") return { px: 0, percent: number };
    if (single[2] === undefined && number !== 0) return null;
    return { px: single[2] === "em" ? number * 16 : number, percent: 0 };
  }
  const calc = /^calc\((.*)\)$/.exec(value);
  if (!calc) return null;
  const out = { px: 0, percent: 0 };
  let sign = 1;
  for (const token of calc[1].trim().split(/\s+/)) {
    if (token === "+") { sign = 1; continue; }
    if (token === "-") { sign = -1; continue; }
    const part = parseLength(token);
    if (!part) return null;
    out.px += sign * part.px;
    out.percent += sign * part.percent;
    sign = 1;
  }
  return out;
}

function parseAngle(text: string): number | null {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|rad|turn)$/.exec(text.trim().toLowerCase());
  if (!match) return null;
  const number = parseFloat(match[1]);
  return match[2] === "deg" ? number : match[2] === "rad" ? (number * 180) / Math.PI : number * 360;
}

function parseStops(parts: string[]): Stop[] | null {
  const stops: Stop[] = [];
  for (const part of parts) {
    const tokens = splitTop(part, " ");
    const color = parseCssColor(tokens[0] ?? "");
    if (!color || tokens.length > 3) return null;
    if (tokens.length === 1) stops.push({ color });
    for (const token of tokens.slice(1)) {
      const position = parseLength(token);
      if (!position) return null;
      stops.push({ color, position });
    }
  }
  return stops.length >= 1 ? stops : null;
}

const SIDES: Record<string, [number, number]> = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
const POSITION_WORDS: Record<string, Length> = { left: { px: 0, percent: 0 }, top: { px: 0, percent: 0 }, center: { px: 0, percent: 50 }, right: { px: 0, percent: 100 }, bottom: { px: 0, percent: 100 } };

function parsePosition(tokens: string[]): [Length, Length] | null {
  if (tokens.length === 0 || tokens.length > 2) return null;
  const centre = POSITION_WORDS.center;
  let x: Length | undefined, y: Length | undefined;
  for (const token of tokens) {
    const word = POSITION_WORDS[token], length = word ?? parseLength(token);
    if (!length) return null;
    if (token === "top" || token === "bottom") y = length;
    else if (token === "left" || token === "right") x = length;
    else if (x === undefined) x = length;
    else y = length;
  }
  return [x ?? centre, y ?? centre];
}

function parseLayer(text: string): GradientLayer | null {
  const solid = parseCssColor(text);
  if (solid) return { kind: "solid", color: solid };
  const call = /^(?:-webkit-|-moz-)?(repeating-)?(linear|radial)-gradient\((.*)\)$/s.exec(text.trim());
  if (!call || /\bvar\(/.test(call[3])) return null;
  const repeating = call[1] !== undefined;
  const parts = splitTop(call[3], ",");
  if (parts.some((part) => part === "")) return null;
  if (call[2] === "linear") {
    let angle: number | undefined, corner: [number, number] | undefined, first = 0;
    const head = parts[0].toLowerCase();
    const parsedAngle = parseAngle(head);
    if (parsedAngle !== null) { angle = parsedAngle; first = 1; }
    else if (head.startsWith("to ")) {
      const words = head.slice(3).trim().split(/\s+/);
      if (words.length < 1 || words.length > 2 || words.some((word) => !SIDES[word])) return null;
      const sum: [number, number] = [0, 0];
      for (const word of words) { sum[0] += SIDES[word][0]; sum[1] += SIDES[word][1]; }
      if (words.length === 2) corner = sum;
      else angle = sum[0] === 1 ? 90 : sum[0] === -1 ? 270 : sum[1] === -1 ? 0 : 180;
      first = 1;
    }
    const stops = parseStops(parts.slice(first));
    return stops ? { kind: "linear", repeating, angle: angle ?? (corner ? undefined : 180), corner, stops } : null;
  }
  let shape: "circle" | "ellipse" | undefined, extent = "farthest-corner", size: Length[] | undefined, at: [Length, Length] = [POSITION_WORDS.center, POSITION_WORDS.center], first = 0;
  const head = parts[0].toLowerCase();
  if (!parseCssColor(splitTop(head, " ")[0] ?? "")) {
    const [before, after] = head.split(/\bat\b/).map((part) => part.trim());
    if (after !== undefined) { const position = parsePosition(after.split(/\s+/).filter(Boolean)); if (!position) return null; at = position; }
    const lengths: Length[] = [];
    for (const token of before.split(/\s+/).filter(Boolean)) {
      if (token === "circle" || token === "ellipse") shape = token;
      else if (["closest-side", "closest-corner", "farthest-side", "farthest-corner"].includes(token)) extent = token;
      else { const length = parseLength(token); if (!length) return null; lengths.push(length); }
    }
    if (lengths.length > 2) return null;
    if (lengths.length > 0) size = lengths;
    first = 1;
  }
  const stops = parseStops(parts.slice(first));
  return stops ? { kind: "radial", repeating, shape: shape ?? (size?.length === 1 ? "circle" : "ellipse"), extent, size, at, stops } : null;
}

/** Parses a background string. Layers that are unsupported or do not parse are counted in `skipped`. */
export function parseGradient(css: string): ParsedGradient {
  const layers: GradientLayer[] = [];
  let skipped = 0;
  for (const text of splitTop(css, ",")) {
    const layer = text === "" ? null : parseLayer(text);
    if (layer) layers.push(layer); else skipped++;
  }
  return { layers, skipped };
}

/** Stop offsets resolved along a gradient line of `length` px: missing positions are spread, and none goes backwards. */
function resolveStops(stops: Stop[], length: number, scale: number): { color: Rgba; at: number }[] {
  const at: (number | undefined)[] = stops.map((stop) => (stop.position ? stop.position.px * scale + (stop.position.percent / 100) * length : undefined));
  if (at[0] === undefined) at[0] = 0;
  if (at[at.length - 1] === undefined) at[at.length - 1] = length;
  let highest = -Infinity;
  for (let index = 0; index < at.length; index++) if (at[index] !== undefined) { at[index] = Math.max(at[index]!, highest); highest = at[index]!; }
  for (let index = 1; index < at.length - 1; index++) {
    if (at[index] !== undefined) continue;
    let next = index;
    while (at[next] === undefined) next++;
    const from = at[index - 1]!, step = (at[next]! - from) / (next - index + 1);
    for (let fill = index; fill < next; fill++) at[fill] = from + step * (fill - index + 1);
  }
  return stops.map((stop, index) => ({ color: stop.color, at: at[index]! }));
}

/** Premultiplied colour at distance `d` along resolved stops. */
function colorAt(stops: { color: Rgba; at: number }[], distance: number, repeating: boolean): Rgba {
  const first = stops[0].at, last = stops[stops.length - 1].at;
  let d = distance;
  if (repeating && last > first) d = first + ((((d - first) % (last - first)) + (last - first)) % (last - first));
  const premultiplied = (color: Rgba): Rgba => [color[0] * color[3], color[1] * color[3], color[2] * color[3], color[3]];
  if (d <= first) return premultiplied(stops[0].color);
  if (d >= last) return premultiplied(stops[stops.length - 1].color);
  let index = 0;
  // The last stop at or before d wins, so a hard stop (two stops at one offset) switches exactly there.
  while (index < stops.length - 2 && stops[index + 1].at <= d) index++;
  const a = stops[index], b = stops[index + 1];
  const t = b.at === a.at ? 1 : (d - a.at) / (b.at - a.at);
  const pa = premultiplied(a.color), pb = premultiplied(b.color);
  return [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t, pa[3] + (pb[3] - pa[3]) * t];
}

/**
 * Rasterises a parsed gradient at `width × height` into straight-alpha RGBA bytes. `px` and `em` lengths are
 * authored at a 1920-px canvas long side and multiplied by the pixel scale factor.
 */
export function rasterGradient(parsed: ParsedGradient, width: number, height: number): Uint8ClampedArray {
  const scale = Math.max(width, height) / 1920;
  const accumulated = new Float32Array(width * height * 4);
  // Painted last to first, so that the first layer is on top.
  for (const layer of [...parsed.layers].reverse()) {
    let sample: (x: number, y: number) => Rgba;
    if (layer.kind === "solid") {
      const color: Rgba = [layer.color[0] * layer.color[3], layer.color[1] * layer.color[3], layer.color[2] * layer.color[3], layer.color[3]];
      sample = () => color;
    } else if (layer.kind === "linear") {
      // 0° points up and angles grow clockwise; "to <corner>" points at the corner across the perpendicular through the centre.
      const radians = layer.corner ? Math.atan2(layer.corner[0] * height, -layer.corner[1] * width) : ((layer.angle ?? 180) * Math.PI) / 180;
      const dx = Math.sin(radians), dy = -Math.cos(radians);
      const length = Math.abs(width * dx) + Math.abs(height * dy);
      const stops = resolveStops(layer.stops, length, scale);
      sample = (x, y) => colorAt(stops, (x - width / 2) * dx + (y - height / 2) * dy + length / 2, layer.repeating);
    } else {
      const cx = layer.at[0].px * scale + (layer.at[0].percent / 100) * width, cy = layer.at[1].px * scale + (layer.at[1].percent / 100) * height;
      const sides = [cx, width - cx, cy, height - cy].map(Math.abs);
      let rx: number, ry: number;
      if (layer.size) {
        rx = layer.size[0].px * scale + (layer.size[0].percent / 100) * width;
        ry = layer.size.length === 2 ? layer.size[1].px * scale + (layer.size[1].percent / 100) * height : rx;
      } else {
        const closest = layer.extent.startsWith("closest");
        const pick = closest ? Math.min : Math.max;
        const sx = pick(sides[0], sides[1]), sy = pick(sides[2], sides[3]);
        if (layer.shape === "circle") {
          rx = ry = layer.extent.endsWith("side") ? (closest ? Math.min(sx, sy) : Math.max(sx, sy)) : Math.hypot(sx, sy);
        } else if (layer.extent.endsWith("side")) { rx = sx; ry = sy; }
        else { rx = sx * Math.SQRT2; ry = sy * Math.SQRT2; }
      }
      rx = Math.max(rx, 1e-6); ry = Math.max(ry, 1e-6);
      const stops = resolveStops(layer.stops, rx, scale);
      sample = (x, y) => colorAt(stops, Math.hypot(x - cx, ((y - cy) * rx) / ry), layer.repeating);
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const [r, g, b, a] = sample(x + 0.5, y + 0.5);
        const index = (y * width + x) * 4;
        accumulated[index] = r + accumulated[index] * (1 - a);
        accumulated[index + 1] = g + accumulated[index + 1] * (1 - a);
        accumulated[index + 2] = b + accumulated[index + 2] * (1 - a);
        accumulated[index + 3] = a + accumulated[index + 3] * (1 - a);
      }
    }
  }
  const out = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < out.length; index += 4) {
    const alpha = accumulated[index + 3];
    if (alpha <= 0) continue;
    out[index] = Math.round((accumulated[index] / alpha) * 255);
    out[index + 1] = Math.round((accumulated[index + 1] / alpha) * 255);
    out[index + 2] = Math.round((accumulated[index + 2] / alpha) * 255);
    out[index + 3] = Math.round(alpha * 255);
  }
  return out;
}

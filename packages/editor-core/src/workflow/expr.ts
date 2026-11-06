import { WORKFLOW_CONDITION_OPS, type WorkflowCondition } from "@jagentchill/protocol";

/** Templates `{{…}}` and conditions: data, never code. No regular expression or expression of a user is ever evaluated. */
export const TEMPLATE_NAMESPACES = ["params", "vars", "inputs", "run", "trigger", "item", "index", "loop", "path"] as const;
export const TEMPLATE_FILTERS = ["json", "truncate", "default", "join", "length", "lower", "upper"] as const;
const SUBSTITUTION_MAX = 16_000;

export type TemplatePart = { text: string } | { path: string[]; filters: Array<{ name: string; arg?: string | number }>; source: string };
export type TemplateProblem = { message: string; hint?: string };

function parsePath(text: string): string[] | undefined {
  const segments: string[] = [];
  for (const piece of text.split(".")) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*)((?:\[\d+\])*)$/.exec(piece);
    if (!match) return undefined;
    segments.push(match[1], ...[...match[2].matchAll(/\[(\d+)\]/g)].map((index) => index[1]));
  }
  return segments;
}
function parseFilter(text: string): { name: string; arg?: string | number } | undefined {
  const match = /^([a-z]+)(?:\((.*)\))?$/.exec(text.trim());
  if (!match) return undefined;
  const raw = match[2]?.trim();
  if (raw === undefined || raw === "") return { name: match[1] };
  const quoted = /^(["'])(.*)\1$/.exec(raw);
  return { name: match[1], arg: quoted ? quoted[2] : Number.isFinite(Number(raw)) ? Number(raw) : raw };
}

/** Splits a template into text and substitutions, and reports what does not parse. */
export function parseTemplate(template: string): { parts: TemplatePart[]; problems: TemplateProblem[] } {
  const parts: TemplatePart[] = [], problems: TemplateProblem[] = [];
  let cursor = 0;
  for (const match of template.matchAll(/\{\{([^{}]*)\}\}/g)) {
    if (match.index > cursor) parts.push({ text: template.slice(cursor, match.index) });
    cursor = match.index + match[0].length;
    const [head, ...rest] = match[1].split("|");
    const path = parsePath(head.trim());
    const filters = rest.map(parseFilter);
    if (!path) { problems.push({ message: `${match[0]} is not a value path` }); continue; }
    if (path[0] === "nodes") { problems.push({ message: `${match[0]} reads another step's output`, hint: "Connect the output to an input and use {{inputs.<port>}}" }); continue; }
    if (!(TEMPLATE_NAMESPACES as readonly string[]).includes(path[0])) { problems.push({ message: `Unknown namespace ${path[0]} in ${match[0]}` }); continue; }
    const bad = filters.findIndex((filter) => !filter || !(TEMPLATE_FILTERS as readonly string[]).includes(filter.name));
    if (bad >= 0) { problems.push({ message: `Unknown filter ${rest[bad].trim()} in ${match[0]}` }); continue; }
    parts.push({ path, filters: filters as Array<{ name: string; arg?: string | number }>, source: match[0] });
  }
  if (cursor < template.length) parts.push({ text: template.slice(cursor) });
  return { parts, problems };
}

/** What a template or condition can read. */
export type Scope = { params?: Record<string, unknown>; vars?: Record<string, unknown>; inputs?: Record<string, unknown>; run?: Record<string, unknown>; trigger?: Record<string, unknown>; item?: unknown; index?: number; loop?: { iteration: number }; path?: string };

export function lookup(scope: Scope, path: string[]): unknown {
  let value: unknown = scope;
  for (const segment of path) {
    if (value === null || value === undefined) return undefined;
    if (Array.isArray(value)) value = /^\d+$/.test(segment) ? value[Number(segment)] : segment === "length" ? value.length : undefined;
    else if (typeof value === "object") value = Object.prototype.hasOwnProperty.call(value, segment) ? (value as Record<string, unknown>)[segment] : undefined;
    else return undefined;
  }
  return value;
}
const textOf = (value: unknown): string => (value === undefined || value === null ? "" : typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value));
function applyFilter(value: unknown, filter: { name: string; arg?: string | number }): unknown {
  switch (filter.name) {
    case "json": return JSON.stringify(value ?? null);
    case "truncate": return textOf(value).slice(0, Math.max(0, Number(filter.arg ?? SUBSTITUTION_MAX)));
    case "default": return value === undefined || value === null || value === "" ? filter.arg ?? "" : value;
    case "join": return Array.isArray(value) ? value.map(textOf).join(String(filter.arg ?? ", ")) : value;
    case "length": return Array.isArray(value) || typeof value === "string" ? value.length : value && typeof value === "object" ? Object.keys(value).length : 0;
    case "lower": return textOf(value).toLowerCase();
    case "upper": return textOf(value).toUpperCase();
    default: return value;
  }
}

/** Substitutes a template. A path that resolves to nothing yields an empty string and a warning. */
export function renderTemplate(template: string, scope: Scope, warn: (message: string) => void = () => undefined): string {
  return parseTemplate(template).parts.map((part) => {
    if ("text" in part) return part.text;
    let value = lookup(scope, part.path);
    const missing = value === undefined || value === null;
    for (const filter of part.filters) value = applyFilter(value, filter);
    if (missing && (value === undefined || value === null || value === "")) warn(`${part.source} resolved to nothing`);
    return textOf(value).slice(0, SUBSTITUTION_MAX);
  }).join("");
}
/** A value by a template that is a single substitution keeps its type; any other template renders to text. */
export function resolveValue(template: unknown, scope: Scope, warn?: (message: string) => void): unknown {
  if (typeof template !== "string") return template;
  const { parts } = parseTemplate(template);
  if (parts.length === 1 && "path" in parts[0]) {
    let value = lookup(scope, parts[0].path);
    for (const filter of parts[0].filters) value = applyFilter(value, filter);
    return value;
  }
  return renderTemplate(template, scope, warn);
}

/** Structural problems of a condition: unknown operators, depth above 4, more than 20 leaves, an operand outside the namespaces. */
export function conditionProblems(condition: unknown, depth = 1, count = { leaves: 0 }): string[] {
  if (!condition || typeof condition !== "object") return ["A condition is a tree of all, any, not and comparisons"];
  if (depth > 4) return ["A condition is at most 4 levels deep"];
  const node = condition as Record<string, unknown>;
  if (Array.isArray(node.all) || Array.isArray(node.any)) return ((node.all ?? node.any) as unknown[]).flatMap((entry) => conditionProblems(entry, depth + 1, count));
  if ("not" in node) return conditionProblems(node.not, depth + 1, count);
  if (++count.leaves > 20) return ["A condition has at most 20 comparisons"];
  if (typeof node.left !== "string" || !(WORKFLOW_CONDITION_OPS as readonly string[]).includes(String(node.op))) return ["A comparison needs a value path and a known operator"];
  const path = parsePath(node.left);
  if (!path) return [`${node.left} is not a value path`];
  if (path[0] === "nodes") return [`${node.left} reads another step's output — connect it to an input and use inputs.<port>`];
  if (![...TEMPLATE_NAMESPACES, "next"].includes(path[0] as never)) return [`Unknown namespace ${path[0]} in ${node.left}`];
  return [];
}

const comparable = (a: unknown, b: unknown): boolean => (typeof a === "number" && typeof b === "number") || (typeof a === "string" && typeof b === "string");
/** Evaluates a condition. A comparison between incompatible types is false and logs a warning. `next` is the loop's latest value. */
export function evaluateCondition(condition: WorkflowCondition, scope: Scope & { next?: unknown }, warn: (message: string) => void = () => undefined): boolean {
  if ("all" in condition) return condition.all.every((entry) => evaluateCondition(entry, scope, warn));
  if ("any" in condition) return condition.any.some((entry) => evaluateCondition(entry, scope, warn));
  if ("not" in condition) return !evaluateCondition(condition.not, scope, warn);
  const left = lookup(scope as Scope, parsePath(condition.left) ?? []);
  // The right side is a literal, or a template of the same namespaces.
  const right = typeof condition.right === "string" && condition.right.includes("{{") ? resolveValue(condition.right, scope) : condition.right;
  const mismatch = () => { warn(`Cannot compare ${JSON.stringify(left) ?? "nothing"} with ${JSON.stringify(right)} using ${condition.op}`); return false; };
  switch (condition.op) {
    case "exists": return left !== undefined && left !== null;
    case "is_empty": return left === undefined || left === null || left === "" || (Array.isArray(left) && left.length === 0);
    case "eq": return typeof left === "object" && left !== null ? JSON.stringify(left) === JSON.stringify(right) : left === right;
    case "ne": return typeof left === "object" && left !== null ? JSON.stringify(left) !== JSON.stringify(right) : left !== right;
    case "gt": return comparable(left, right) ? (left as number) > (right as number) : mismatch();
    case "gte": return comparable(left, right) ? (left as number) >= (right as number) : mismatch();
    case "lt": return comparable(left, right) ? (left as number) < (right as number) : mismatch();
    case "lte": return comparable(left, right) ? (left as number) <= (right as number) : mismatch();
    case "contains": return typeof left === "string" && typeof right === "string" ? left.includes(right) : Array.isArray(left) ? left.includes(right) : mismatch();
    case "not_contains": return typeof left === "string" && typeof right === "string" ? !left.includes(right) : Array.isArray(left) ? !left.includes(right) : mismatch();
    case "in": return Array.isArray(right) ? right.includes(left) : mismatch();
    case "starts_with": return typeof left === "string" && typeof right === "string" ? left.startsWith(right) : mismatch();
    case "ends_with": return typeof left === "string" && typeof right === "string" ? left.endsWith(right) : mismatch();
    default: return false;
  }
}

# Archify — code-grounded reference for JAgentChill

Source inspected: `/Users/ngocchanh/Project/private/organisations/hdc/jagentchill/.refs/archify`
(upstream https://github.com/tt-a1i/archify, HEAD `594f608`, 2026-10-05, skill version 3.0.1).
All paths below are relative to that checkout unless absolute. Claims not confirmed in code or by
running the CLI are marked **UNVERIFIED**.

## 1. Single most important fact

Archify is **not a diagram library or a React component**. It is an *agent Skill plus a
zero-dependency Node CLI* that compiles an LLM-authored, strictly-typed JSON document into **one
static, self-contained ~760 KB HTML file** (inline SVG + an embedded classic-script viewer).
It has no run-status concept, no incremental update API, no host messaging API, and no published
npm package. A live-updating pipeline diagram is therefore something JAgentChill must build around
it or instead of it (see section 9).

## 2. What it is

- `archify/SKILL.md` frontmatter: "Create polished, validated architecture, workflow, sequence,
  data-flow, and lifecycle/state diagrams as explorable standalone HTML with inline SVG, dark/light
  themes, optional trace motion, and PNG/JPEG/WebP/SVG/WebM export."
- `archify/package.json`: `"name": "archify"`, `"version": "3.0.1"`, **`"private": true`**,
  `"bin": {"archify": "./bin/archify.mjs"}`, `"engines": {"node": ">=18"}`. Runtime has no
  dependencies (devDependencies only: ajv, parse5, saxes, simple-icons, skills, yaml).
- Distribution is as a Skill: `npx skills add tt-a1i/archify -g` (README.md), or `archify.zip`.
- Explicit non-goals (README.md, "Reference and scope"): "Automatic Mermaid parsing,
  general-purpose auto-layout, hosted sharing, and WYSIWYG editing are intentionally outside the
  current scope." README also: "Archify is not a general-purpose drawing editor or a Mermaid theme."
- Mobile is explicitly not a target. `PRODUCT.md`: "Desktop is the primary product surface; narrow
  screens receive safe containment and usable controls rather than a separate mobile product."
  `archify/references/viewer-runtime.md`: "Do not add a hosted service, storage surface,
  dependency, schema branch, or mobile product surface for these viewer-only capabilities."

## 3. How a diagram is generated

Pipeline (README "How it works", `archify/SKILL.md`):

| Step | What happens | Who does it |
|---|---|---|
| Generate | Write a typed JSON IR "candidate" | **The LLM agent**, following `SKILL.md` + `references/authoring-defaults.md` + one example |
| Validate | Schema, layout, route, label-clearance checks | CLI (`validate`) |
| Deliver | Render candidate, check it, atomically replace target HTML | CLI (`deliver` / `finalize`) |
| Iterate | Agent edits the JSON and reruns | LLM + CLI |

There is no model call inside Archify. The "intelligence" (layout judgment: lanes, columns, routes)
comes from whatever agent authors the JSON. `SKILL.md` step 4 is the canonical command:

```bash
node bin/archify.mjs finalize <type> <candidate.json> <output.html> --quality showcase --json
```

Full CLI surface (verified by running `node archify/bin/archify.mjs --help`):

```text
archify render <type> <input.json> [output.html] [--quality standard|showcase] [--repo-root path]
archify compare architecture <base.json> <head.json> [output.html] [--receipt path] [--json] ...
archify deliver <type> <input.json> [output.html] [--json] [--open] ...
archify finalize <type> <input.json> <output.html> [--json] [--receipt path] [--out-dir <dir>] ...
archify preview <type> <input.json> [output.html] [--no-open] ...
archify validate <type> <input.json> [--json] [--layout-json] ...
archify migrate workflow <old.json> <new.json> --to-schema 2 ...
archify inspect <type> <input.json>
archify check <output.html> [--json] [--require-provenance]
archify browser-check <output.html> [--json|--summary] [--require-provenance] [--out-dir <dir>]
archify visual-check <output.html> [--json|--summary] [--require-provenance] [--out-dir <dir>]
archify guide [scenario or question] [--json] [--lang en|zh]
archify brands [...] / archify brands capture <url>
archify examples | doctor | demo [output-directory]
Types: architecture, workflow, sequence, dataflow, lifecycle
```

Measured locally: `render workflow examples/agent-tool-call.workflow.json <tmp>/out.html` took
~0.2 s wall time and produced a 767,770-byte HTML file, with no browser and no `npm install`.
`finalize` additionally runs a "real-browser `browser-check`" gate (`SKILL.md`), so it needs a
Chrome binary (`viewer/README.md` mentions `ARCHIFY_CHROME`); `render` and `validate` do not.

Side effect to know for server use: `finalize`/`deliver` perform an update check (HTTP GET of a
stable manifest). README: "Set `ARCHIFY_UPDATE_CHECK_DISABLED=1` to disable networking and
reminder-state writes."

Programmatic use: there is no documented library API. `renderers/workflow/workflow-compiler.mjs`
exports `compileWorkflow({ workflow, qualityProfile, sourceEvidence })`, but
`renderers/workflow/render-workflow.mjs` is a `process.argv` script, the package is `private`, and
`bin/archify.mjs` is a 6,936-line CLI. Treat "spawn the CLI" as the only supported integration.
Importing internals is possible (MIT) but unsupported — stability **UNVERIFIED**.

## 4. Input format: typed JSON IR

`archify/schemas/README.md`: one JSON Schema (draft 2020-12) per diagram type, plus
`common.schema.json`. "Every diagram schema requires `schema_version`, `diagram_type`, `meta`
(with `title` and a durable portable `output`), and its structural arrays ... and sets
`additionalProperties: false` at every level, so unknown fields are rejected rather than silently
ignored."

| Schema | `diagram_type` | Structural arrays |
|---|---|---|
| `workflow.schema.json` | `workflow` | `lanes`, `phases`, `groups`, `mainPath`, `nodes`, `edges` |
| `sequence.schema.json` | `sequence` | `participants`, `segments`, `messages`, `activations` |
| `dataflow.schema.json` | `dataflow` | `stages`, `nodes`, `flows` |
| `lifecycle.schema.json` | `lifecycle` | `lanes`, `states`, `transitions` |
| `architecture.schema.json` | `architecture` | `components`, `boundaries`, `connections` |

### 4.1 Workflow schema (the one relevant to a "video from one prompt" pipeline), trimmed verbatim

From `archify/schemas/workflow.schema.json`:

```json
{
  "$id": "https://github.com/tt-a1i/archify/schemas/workflow.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "diagram_type", "meta", "lanes", "nodes", "edges"],
  "properties": {
    "schema_version": { "enum": [1, 2] },
    "diagram_type": { "const": "workflow" },
    "meta": {
      "additionalProperties": false,
      "required": ["title", "output"],
      "properties": {
        "title": { "type": "string", "minLength": 1 },
        "locale": {}, "translations": {}, "subtitle": { "type": "string" },
        "output": { "$ref": "common.schema.json#/$defs/portableOutputPath" },
        "animation": { "enum": ["trace", "none"] },
        "visual_preset": { "enum": ["classic", "signal-flow", "blueprint", "editorial"] },
        "quality_profile": { "enum": ["standard", "showcase"] },
        "repository": {}, "views": {}, "legend": {},
        "viewBox": { "type": "array", "prefixItems": [{ "minimum": 700 }, { "minimum": 240 }] }
      }
    },
    "lanes":  { "minItems": 1, "items": { "required": ["id", "label"],
                "properties": { "id": {}, "label": {}, "variant": { "enum": ["normal", "exception"] } } } },
    "phases": { "items": { "required": ["id", "label", "fromCol", "toCol"],
                "properties": { "fromCol": { "minimum": 0, "maximum": 5 }, "toCol": { "minimum": 0, "maximum": 5 },
                                "variant": { "enum": ["default", "emphasis", "security", "dashed"] } } } },
    "groups": { "items": { "required": ["id", "label", "lane", "fromCol", "toCol"] } },
    "mainPath": { "type": "array", "minItems": 2, "items": { "$ref": "common.schema.json#/$defs/id" } },
    "semanticChecks": { "properties": { "allowedRoots": {}, "allowedTerminals": {}, "requiredEdges": {}, "requiredPaths": {} } },
    "nodes": { "minItems": 1, "items": {
      "additionalProperties": false,
      "required": ["id", "lane", "col", "type", "label"],
      "properties": {
        "id": {}, "lane": {},
        "col": { "type": "integer", "minimum": 0, "maximum": 5 },
        "type": { "$ref": "common.schema.json#/$defs/componentType" },
        "label": { "type": "string", "minLength": 1 },
        "sublabel": { "type": "string" }, "tag": { "type": "string" },
        "icon": {}, "brand": {}, "sources": {},
        "width": { "minimum": 32 }, "height": { "minimum": 32 }, "yOffset": { "type": "number" }
      } } },
    "edges": { "items": {
      "additionalProperties": false,
      "required": ["from", "to"],
      "properties": {
        "id": {}, "from": {}, "to": {}, "label": { "type": "string" },
        "variant": { "$ref": "common.schema.json#/$defs/variant" },
        "role": { "enum": ["main", "branch", "async", "return", "error"] },
        "fromSide": {}, "toSide": {},
        "route": { "enum": ["auto", "straight", "drop", "outside-right", "return-left", "bottom-channel", "up-channel"] },
        "via": {}, "labelAt": {}, "labelDx": {}, "labelDy": {}, "labelSegment": {},
        "channelX": {}, "channelY": {}, "bias": {}, "width": {}
      } } },
    "cards": { "$ref": "common.schema.json#/$defs/cards" }
  }
}
```

From `archify/schemas/common.schema.json`:

```json
"id":            { "type": "string", "pattern": "^[a-zA-Z][a-zA-Z0-9_-]*$" },
"componentType": { "enum": ["frontend", "backend", "database", "cloud", "security", "messagebus", "external"] },
"legendMode":    { "enum": ["auto", "all", "hidden"] }
```

Consequences for a pipeline diagram:

- **Grid is at most 6 columns** (`col` 0..5) by N lanes. A long linear pipeline must wrap across
  lanes or be split.
- **Node `type` is one of seven fixed "component kinds"** (colours/legend). There is no `status`,
  `state`, `progress`, or free-form metadata field, and `additionalProperties: false` rejects any
  you add. Run status can only be smuggled through `sublabel`, `tag`, or by abusing `type`.
- The `lifecycle` type does have state kinds (`start`, `active`, `waiting`, `decision`, `success`,
  `failure`, `neutral`, `external` — `schemas/README.md` legend table), but it models a state
  machine, not a pipeline of steps with per-step status.

### 4.2 One full example (verbatim): `archify/examples/agent-tool-call.workflow.json`

```json
{
  "schema_version": 2,
  "diagram_type": "workflow",
  "meta": {
    "title": "Agent Tool Call Workflow",
    "animation": "trace",
    "visual_preset": "signal-flow",
    "quality_profile": "showcase",
    "output": "examples/workflow-agent-tool-call-rendered.html"
  },
  "lanes": [
    { "id": "ui", "label": "User Interface" },
    { "id": "agent", "label": "Agent Runtime" },
    { "id": "policy", "label": "Policy & Recovery", "variant": "exception" },
    { "id": "tools", "label": "Tool Execution & Evidence" }
  ],
  "phases": [
    { "id": "intake", "label": "Intake", "fromCol": 0, "toCol": 1 },
    { "id": "reasoning", "label": "Plan + route", "fromCol": 2, "toCol": 3, "variant": "emphasis" },
    { "id": "execution", "label": "Execute + report", "fromCol": 4, "toCol": 5, "variant": "dashed" }
  ],
  "groups": [
    { "id": "agent_loop", "label": "Planning loop", "lane": "agent", "fromCol": 2, "toCol": 3, "variant": "emphasis" },
    { "id": "exception_path", "label": "Human or policy stop", "lane": "policy", "fromCol": 3, "toCol": 5, "variant": "security" },
    { "id": "evidence_path", "label": "Evidence path", "lane": "tools", "fromCol": 1, "toCol": 2, "variant": "dashed" },
    { "id": "tool_work", "label": "Tool work", "lane": "tools", "fromCol": 4, "toCol": 5, "variant": "dashed" }
  ],
  "mainPath": ["user", "chat", "planner", "router", "approval", "tool", "external", "final"],
  "nodes": [
    { "id": "user", "lane": "ui", "col": 0, "type": "external", "label": "User", "sublabel": "asks for work", "width": 132 },
    { "id": "chat", "lane": "ui", "col": 1, "type": "frontend", "label": "Chat Surface", "sublabel": "thread + files", "width": 132 },
    { "id": "final", "lane": "ui", "col": 5, "type": "backend", "label": "Final Reply", "sublabel": "answer + changes", "width": 132 },
    { "id": "planner", "lane": "agent", "col": 2, "type": "backend", "label": "Agent Planner", "sublabel": "plan next step", "tag": "context aware", "width": 132 },
    { "id": "router", "lane": "agent", "col": 3, "type": "backend", "label": "Tool Router", "sublabel": "choose capability", "width": 132 },
    { "id": "approval", "lane": "policy", "col": 3, "type": "security", "label": "Approval Gate", "sublabel": "scope + consent", "tag": "block risky ops", "width": 132 },
    { "id": "blocked", "lane": "policy", "col": 4, "type": "security", "label": "Blocked", "sublabel": "wait or reject", "width": 132 },
    { "id": "retry", "lane": "policy", "col": 5, "type": "messagebus", "label": "Retry Path", "sublabel": "revise request", "width": 132 },
    { "id": "tool", "lane": "tools", "col": 4, "type": "messagebus", "label": "Tool Call", "sublabel": "shell / browser / MCP", "tag": "structured result", "width": 132 },
    { "id": "external", "lane": "tools", "col": 5, "type": "cloud", "label": "External API", "sublabel": "network service", "width": 132 },
    { "id": "store", "lane": "tools", "col": 1, "type": "database", "label": "Context Store", "sublabel": "repo + memory", "width": 132 },
    { "id": "trace", "lane": "tools", "col": 2, "type": "database", "label": "Trace Log", "sublabel": "events + output", "width": 132 }
  ],
  "edges": [
    { "id": "request-chat", "from": "user", "to": "chat", "variant": "default" },
    { "id": "plan-request", "from": "chat", "to": "planner", "label": "plan", "variant": "emphasis" },
    { "id": "planner-route", "from": "planner", "to": "router", "variant": "default" },
    { "id": "approval-check", "from": "router", "to": "approval", "label": "needs approval?", "variant": "security" },
    { "id": "approved-tool", "from": "approval", "to": "tool", "variant": "emphasis" },
    { "id": "approval-denied", "from": "approval", "to": "blocked", "label": "denied", "variant": "security", "role": "error" },
    { "id": "retry-request", "from": "blocked", "to": "retry", "variant": "dashed", "role": "branch" },
    { "id": "tool-external-call", "from": "tool", "to": "external", "variant": "default" },
    { "id": "external-reply", "from": "external", "to": "final", "variant": "emphasis", "role": "return", "fromSide": "right", "toSide": "right", "route": "outside-right", "width": 1.2 },
    { "id": "record-result", "from": "external", "to": "trace", "label": "record result", "variant": "dashed", "fromSide": "bottom", "toSide": "bottom", "route": "bottom-channel", "labelSegment": 1 },
    { "id": "write-trace-memory", "from": "store", "to": "trace", "label": "trace + memory", "variant": "dashed" }
  ],
  "cards": [
    { "dot": "cyan", "title": "Compiler Contract",
      "items": ["Lanes and columns determine node placement", "Labels reserve clearance; routes stay orthogonal"] },
    { "dot": "rose", "title": "Runtime Semantics",
      "items": ["Approval gates risky work before tool execution", "Evidence returns through isolated trace and memory"] }
  ]
}
```

Rendered counterpart: `archify/examples/workflow-agent-tool-call-rendered.html`.

## 5. Rendering and viewer technology

- Output = `archify/assets/template.html` (727,976 bytes, a committed generated artifact) with the
  compiled SVG inserted. `viewer/README.md`: "`archify/assets/template.html` is the committed
  generated artifact, consumed unchanged by all five renderers and the installed Skill."
- The template is assembled from `viewer/*.js` + `viewer/viewer.css` + `viewer/template.source.html`
  by `scripts/generate-viewer.mjs` ("Assembly inserts JavaScript fragments verbatim at fixed
  markers"). All fragments "retain classic-script scope" — plain inline `<script>`, vanilla JS, no
  framework, no bundler, no ES modules.
- No external network requests at view time: the only `http(s)` URLs in `assets/template.html` are
  the SVG namespace and the JetBrains Mono font licence text (font data is embedded).
- Viewer modules attach to a page-global `Archify` namespace: `Archify.view` (camera),
  `Archify.focus`, `Archify.finder`, `Archify.routeProbe`, `Archify.semanticLens`, `Archify.radar`,
  `Archify.theme`, `Archify.preset`, `Archify.presentation`, `Archify.exportMenu`,
  `Archify.motion`, etc. These are internal objects inside the generated page, not a documented
  host API. A grep of `viewer/` for `postMessage` / `message` listeners returns nothing, so there
  is **no parent-frame messaging bridge**.
- URL controls the page honours (`viewer/template.source.html`, `viewer/*.js`):
  - query: `?theme=light|dark`, `?embed=1` (sets `data-embed="true"` on `<html>`), `?present=1`,
    `?openExport=1`, `?play=1`;
  - hash: `#focus=<id>`, `#focus=<id>&reach=upstream|downstream`, `#relation=<id>`,
    `#route=<source>~<target>`, `#lens=<kind>~<kind>` (README "Explore and share the output").
  - `embed=1` gates off many interactive features (checks in `focus.js`, `node-finder.js`,
    `route-probe.js`, `semantic-lens.js`, `motion-governor.js`). The exact embedded UX was not
    exercised in a browser — **UNVERIFIED**.
- Stable DOM hooks in the generated SVG (verified in the rendered example):
  ```html
  <g id="node-planner" data-node-id="planner" data-node-label="Agent Planner" tabindex="0"
     role="button" data-node-kind="backend" data-node-sublabel="plan next step" ...>
  <g data-detail="context" data-edge-from="chat" data-edge-to="planner" data-edge-label="plan"
     data-edge-key="4" data-edge-id="plan-request">
  ```
  Node/edge IDs from the JSON survive into the DOM, which is what makes host-side status overlays
  possible (section 9, option B). These attributes are not promised as a public contract —
  stability across versions **UNVERIFIED**.

## 6. Live / incremental update capability

Only one mechanism exists: `archify preview` (`archify/bin/preview.mjs`).

- README: "`preview` is an explicit loopback-only desktop mode: it watches one JSON file on a
  random `127.0.0.1` port, keeps the last verified output through failures, stops with Ctrl-C, and
  adds no generated-HTML runtime."
- Implementation: `http.createServer` bound to `127.0.0.1`; rejects any request whose `Host` is not
  `127.0.0.1:<port>` with 403; routes `/`, `/state`, `/artifact.html`, `/events`
  (`text/event-stream`); `fs.watch` plus an 800 ms poll, 400 ms debounce; the shell page uses
  `new EventSource('/events')` and reloads the artifact in a frame.
- It is a **whole-file re-render and reload**, not a patch. There is no API to change one node.
  Camera/focus state continuity across reloads is **UNVERIFIED**.
- It is a developer convenience, hard-wired to loopback, not an embeddable production feature.

`meta.animation: "trace"` is a decorative, finite, reader-controlled flow animation along authored
edges ("never claims runtime impact"); it is not driven by real run data.

## 7. Export formats

All exports run **inside the browser viewer** (`viewer/export.js`), from the Export menu:

- PNG (copy to clipboard and download), JPEG, WebP — raster scale picks the largest fitting of
  4/3/2/1;
- SVG ("Downloaded SVG embeds both themes");
- WebM recording of the trace animation (`Archify.motion.recordWebm`, requires
  `meta.animation: "trace"`);
- Route Share Card / Reach Share Card: 1200x630 PNG of a traced path.

The CLI has no `export` command. `browser-check`/`visual-check` take browser captures for QA
(`--out-dir`), which is not the same thing. A headless "JSON -> PNG" path is therefore
**not provided**; JAgentChill would drive a headless browser itself.

## 8. `integrations/` and licence

- `integrations/hermes-agent/` (`plugin.yaml`, README): "This is a **Skill-only** plugin. It does
  not register native Python render tools ... There is no Python port of the renderers."
- `integrations/deepseek-harness/` (`@tt-a1i/archify-dsh`): "Skill-only bundle"; "registers no
  native render/validate/deliver tools, custom Web client ...".
- Both integrations only make the Skill discoverable to another agent host. Neither is an
  embedding SDK. An OpenClaw integration does not exist in the repo; since OpenClaw loads
  `SKILL.md` skills from workspace `skills/` folders, dropping `archify/` there should work the
  same way — **UNVERIFIED**.
- Licence: **MIT** (`LICENSE`: "Copyright (c) 2026 tt-a1i (Archify)", "Copyright (c) 2025 Cocoon
  AI"). Embedded font JetBrains Mono is OFL (`archify/assets/JetBrainsMono-OFL.txt`); see
  `THIRD_PARTY_NOTICES.md`. Commercial use and modification are permitted with notice retention.

## 9. Realistic integration options for a live pipeline diagram with run status

Stated plainly: **Archify alone cannot show a live-updating diagram whose nodes reflect run
status.** Options, from least to most engineering:

### A. Static "plan" artifact only (lowest cost, fully supported)

Agent authors workflow JSON for the one-prompt pipeline, backend runs
`archify render workflow plan.json out.html`, app shows it in an `<iframe>` (web) or
`react-native-webview` (mobile) with `?embed=1&theme=dark`. Status is shown elsewhere in native UI.
Good for "here is the pipeline I am about to run" and for exported/shareable documentation.
Limits: desktop-first viewer on a phone screen; 760 KB per diagram; no status.

### B. Static Archify HTML + host-injected status overlay (works, but unsupported coupling)

Render once, then let the host paint status on top using the stable `data-node-id` hooks:

- Web: load via `srcdoc` or same-origin URL, then
  `iframe.contentDocument.querySelector('[data-node-id="render"]')` and toggle a class / inject a
  small `<style>` (e.g. pulse for `running`, green stroke for `done`, red for `failed`).
- React Native: `WebView.injectJavaScript(...)` doing the same; status pushed from RN over the
  WebView bridge that JAgentChill owns.

No re-render, no flicker, IDs map 1:1 to pipeline step IDs. Risks: depends on undocumented DOM and
CSS variables; must be re-validated on every Archify upgrade (pin the version); canonical exports
strip viewer state so status will not appear in exported PNGs.

### C. Re-render on every status change (supported surface, poor UX)

Encode status into schema-legal fields (`sublabel: "running 42%"`, `tag: "done"`, or swap `type`
for colour), rerun `render` (~0.2 s), reload the frame. Uses only public surface, but reloads lose
viewer state, ship 760 KB per tick, and the seven semantic `type` colours are not a status palette.
Acceptable only for coarse updates (a handful per run).

### D. Use Archify JSON as the authoring/interchange format, render the live view natively (recommended for the product surface)

Keep the agent producing `workflow` IR (lanes, `col`, nodes, edges, `mainPath`) — it is a small,
strict, LLM-friendly schema with a fast validator giving machine-readable repair diagnostics
(`validate --json`). Then:

- live in-app diagram: a native renderer (React Flow / SVG on web, `react-native-svg` or Skia on
  mobile) that reads the same node/edge IDs plus a separate `runStatus[nodeId]` stream from the
  agent harness;
- shareable/export artifact: Archify HTML via `render`.

This is the only option that gives real cross-platform parity and true per-node live status, at
the cost of writing a renderer. Layout is cheap to reproduce because the workflow IR is already a
lane x column grid.

### Decision inputs to settle in the spec

1. Is the diagram a design-time artifact (A), or a live run monitor (B or D)?
2. Is it acceptable for mobile to be a WebView of a desktop-first viewer?
3. Where does Node run? Archify needs Node >= 18 server-side (or in the desktop shell); it cannot
   run inside a React Native JS runtime, and running the CLI in a browser tab is **UNVERIFIED**
   (it imports `node:fs`, `node:child_process`).
4. Who authors the JSON — the chat agent via the Skill (then the harness must be able to load
   `archify/SKILL.md` and exec `node`), or deterministic backend code that emits the IR from the
   pipeline definition (no LLM needed, and more reliable for a fixed pipeline)?

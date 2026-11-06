# repository-harness — code-grounded reference for JAgentChill

Source inspected: `/Users/ngocchanh/Project/private/organisations/hdc/jagentchill/.refs/repository-harness`
(upstream https://github.com/hoangnb24/repository-harness, HEAD `485fd40`, 2026-10-04,
"refactor(harness): make workflow consumer-owned and skills explicit"; shallow clone, one commit).
Paths are relative to that checkout unless absolute. Unconfirmed claims are marked **UNVERIFIED**.
Nothing was installed or executed against the JAgentChill repo for this note.

## 1. Single most important fact

**The current upstream harness no longer prescribes user stories, a feature-intake gate, or any
task workflow.** It is now only (a) a small set of repository-navigation documents, (b) four
explicit-only agent skills, (c) optional templates, and (d) a Rust `harness` binary that installs
and safely updates those files. The `US-###` story convention the owner has in mind belongs to the
**end-of-life "protocol v1" harness** (EOL 2026-08-10), which survives in older sibling repos on
this machine. "Follow the full harness, creating US if needed" therefore means: install the
current core, then **adopt a story convention as a JAgentChill-owned decision** — the harness will
not create, track, or gate stories for you.

Evidence:

- `README.md`: "It is not a task database, story tracker, agent orchestrator, or application
  runtime." and "Consumer repositories own task workflow and planning. Harness skills run only
  when explicitly requested; installation does not activate them."
- `docs/WORKFLOW.md`: "Harness does not classify tasks, require plans, route requests to skills,
  or govern the consumer's workflow."
- `docs/README.md` ("History"): "The former SQLite control plane, protocol v1, story packets,
  migration evidence, and compatibility documentation are preserved by Git history and immutable
  `harness-cli-v*` tags. They are intentionally absent from the current tree".
- `docs/decisions/0027-end-protocol-v1-and-focus-repository-protocol.md`: "Protocol v1 and the
  optional SQLite control plane are end-of-life."

## 2. What gets installed (exact payload)

`scripts/harness-install-files.txt` (verbatim, comments trimmed):

```text
.agents/skills/audit-onboarding-proposal/SKILL.md
.agents/skills/audit-onboarding-proposal/agents/openai.yaml
.agents/skills/audit-onboarding-proposal/scripts/validate_evidence_capsule.py
.agents/skills/encode-invariant/SKILL.md
.agents/skills/encode-invariant/agents/openai.yaml
.agents/skills/improve-harness/SKILL.md
.agents/skills/improve-harness/agents/openai.yaml
.agents/skills/onboard-repository/SKILL.md
.agents/skills/onboard-repository/agents/openai.yaml
.agents/skills/onboard-repository/references/evidence-capsule-v1.md
.agents/skills/onboard-repository/references/evidence-capsule-v2.md
.agents/skills/onboard-repository/scripts/emit_evidence_bundle.py
.agents/skills/onboard-repository/scripts/render_patch.py
AGENTS.md
docs/WORKFLOW.md
docs/README.md
docs/patterns/encoding-invariants.md
docs/product/README.md
docs/plans/README.md
docs/plans/active/README.md
docs/plans/completed/README.md
docs/decisions/README.md
docs/templates/application-runbook.md
docs/templates/decision.md
docs/templates/exec-plan.md
docs/templates/harness-improvement.md
```

Plus, written by the installer/binary:

- `scripts/bin/harness` (the Rust binary; `.gitignore` gets `scripts/bin/harness` and
  `scripts/bin/harness.exe` appended — `merge_core_gitignore` in `scripts/install-harness.sh`);
- `.harness-core/` provenance (`docs/ARCHITECTURE.md`):
  ```text
  .harness-core/
  ├── manifest.json
  ├── base/
  ├── transaction.json          # only while an apply is pending
  ├── update/                   # only while conflict resolution is pending
  └── update-candidate/         # retained verified candidate when required
  ```
- `.harness-backup/<timestamp>/` when files are replaced;
- optionally `CLAUDE.md` (with `--claude`) and `.agents/skills/engineering-wisdom/` (with
  `--with-engineering-wisdom`, payload in `scripts/engineering-wisdom-install-files.txt`).

**Not** installed (present upstream only): `docs/HARNESS.md`, `docs/ARCHITECTURE.md`,
`docs/templates/high-risk-story/*`, `docs/decisions/00xx-*`, `docs/demo/`, `docs/research/`,
`crates/`, `tests/`, CI workflows. In particular the only story-shaped templates left upstream,
`docs/templates/high-risk-story/{overview,design,execplan,validation}.md`, are **not in the
install manifest**, and each is headed "Optional compatibility template ... Harness requires
neither format."

`docs/product/installation-profiles.md`: core installation "does not install an application stack
or product policy; does not install schemas, databases, orchestration, or background processes".

## 3. The installed agent contract

`scripts/agent-harness-block.md` is the managed block placed in `AGENTS.md` (verbatim):

```markdown
<!-- HARNESS:BEGIN -->
## Harness

Start with the requested outcome and use the repository as the system of record.
Find the relevant code, interfaces, commands, tests, and evidence through the
repository map in `docs/README.md`. `docs/WORKFLOW.md` describes repository
understanding, missing capabilities, authority, and trust.

- Respect the requested scope. Inspection does not authorize edits or operation.
- Prefer source references over duplicate summaries. Preserve product intent
  and rationale that code and tests do not express.
- Identify missing capabilities needed to act, observe, or verify. Report what
  is unavailable or unproven instead of inventing commands or claiming success.
- Before changing externally observable policy, establish repository authority.
  Stop at material unresolved choices; configurable defaults are not authority.
- Preserve user-owned state and use the repository's native safety and validation
  checks. Explain observed results and their limits.
- Only invoke a Harness skill when the user explicitly requests it.

Consumer repositories own their task workflow and planning. Harness provides
context and optional tools, without a task database or orchestration lifecycle.
<!-- HARNESS:END -->
```

`scripts/claude-harness-block.md` is the `CLAUDE.md` block: "Claude Code does not auto-load
`AGENTS.md`. Import that single canonical project instruction source." followed by a bare
`@AGENTS.md` line.

## 4. "Workflow steps" the harness prescribes

There is no step pipeline. `docs/WORKFLOW.md` ("Repository Understanding") defines four standing
rules instead:

1. **Authority and scope** — "Before changing externally observable policy, identify accepted
   repository authority. If materially different choices remain, stop and request the smallest
   decision."
2. **Missing capabilities** — identify what is needed to locate, run, prepare state, observe,
   verify, recover; "Report an unavailable capability with its evidence ... Keep unobserved state
   Unknown."
3. **Trust through evidence** — "A plan, checklist, or completion message is not behavior-level
   proof. A checked-in CI job does not prove it ran or blocks merging."
4. **Optional resources** — skills, patterns, templates are opt-in.

Where things go (`docs/README.md`, installed map):

| Location | Purpose | Required? |
|---|---|---|
| `docs/product/` | "current consumer-product behavior derived from real accepted intent" | location provided, empty |
| `docs/decisions/` | lasting choices, from `docs/templates/decision.md` (`NNNN Decision Title`, Status/Context/Decision/Alternatives/Consequences/Follow-Up) | optional |
| `docs/plans/active/`, `docs/plans/completed/` | execution plans, from `docs/templates/exec-plan.md` (Status/Outcome/Context/Scope/Approach/Risks And Recovery/Progress/Decisions/Validation/Result) | optional |
| `docs/templates/application-runbook.md` | how to start/observe/clean up the app once real commands exist | optional |
| `docs/patterns/encoding-invariants.md` | turning an accepted rule into a mechanical check | reference |

## 5. Skills (all explicit-invocation only)

From each `SKILL.md` frontmatter under `.agents/skills/`:

| Skill | Trigger | What it does |
|---|---|---|
| `onboard-repository` | `$onboard-repository` | "Inspect an unfamiliar repository, trace one operational path, identify missing capabilities, and propose evidence-backed knowledge improvements. The first pass is read-only" |
| `audit-onboarding-proposal` | `$audit-onboarding-proposal` | Fresh-session, read-only audit of an onboarding transcript; runs `scripts/validate_evidence_capsule.py` |
| `encode-invariant` | `$encode-invariant` | "Convert accepted repository rules into native mechanical validation with positive and negative proof." |
| `improve-harness` | `$improve-harness` | One bounded improvement vs an observed baseline and a fresh rerun; copies `docs/templates/harness-improvement.md` to `docs/plans/active/harness-improvement-<slug>.md` |
| `engineering-wisdom` (add-on) | `$engineering-wisdom` | Repository-grounded advice; "does not establish repository policy" |

Skills are installed under `.agents/skills/` (Codex layout; each has `agents/openai.yaml`). Claude
Code reads skills from `.claude/skills/`, so they are not auto-discovered there — invoking them
from Claude Code means pointing the agent at the `SKILL.md` path. Whether upstream intends a
`.claude/skills` mirror is **UNVERIFIED** (none in the manifest).

## 6. CLI (`crates/harness`)

One crate, binary `harness`, version `0.1.10` (`crates/harness/Cargo.toml`), clean-architecture
layout `domain <- application <- infrastructure / interface` (`docs/ARCHITECTURE.md`).
Commands, from `crates/harness/src/interface/cli.rs`:

| Command | Flags | Meaning (doc comment) |
|---|---|---|
| `harness install` | `--directory <path>` (default `.`), `--dry-run`, `--json` | "Install a fresh core or adopt an existing copy-on-install core." |
| `harness update` | `--directory`, `--dry-run`, `--json`, `--continue`, `--abort` | "Preview or apply a conflict-safe three-way core update." |
| `harness status` | `--directory`, `--json` | "Inspect installed version and consumer modifications without mutation." |
| `harness doctor` | `--directory`, `--json` | "Validate provenance, paths, merge support, and transaction health." |

That is the whole CLI. There are **no** `story`, `intake`, `decision`, `backlog`, `trace`, `query`
subcommands any more. The update transaction (`docs/ARCHITECTURE.md`): load base + candidate ->
validate managed paths -> freeze inputs -> plan three-way changes -> stop and stage overlapping
conflicts -> journal + backups -> activate -> commit provenance -> replace executable. On overlap
it keeps BASE/LOCAL/UPSTREAM/RESOLVED and waits for a human, then `update --continue`.

## 7. Scripts, checks, gates

Upstream's own gate is `scripts/validate-premerge.sh` (requires `cargo git jq rg`): `bash -n` on
all scripts, `cargo fmt --check`, `cargo test --workspace --locked`, `cargo clippy -D warnings`,
then installer/doc/workflow/release contract tests under `tests/`, then `git diff --check`.
**None of this is installed into a consumer repo.** The harness ships no CI workflow, no hook, and
no validation command for consumers: `docs/product/installation-profiles.md` and `README.md` state
it does not install "validation commands". JAgentChill must define its own verify gate
(typecheck/lint/test/build) and, if desired, use `$encode-invariant` to wire accepted rules into it.

Installer flags (`scripts/install-harness.sh --help`, verbatim summary):

```text
-d, --directory <path>     Target directory. Defaults to the current directory.
-y, --yes                  Accept defaults and skip prompts.
    --with-engineering-wisdom
    --merge                On protected-path conflict, keep existing files in place and
                           install only missing Harness files.
    --refresh-agent-shim   Refresh an existing AGENTS.md into the small Harness shim after backup.
    --claude               Also install or refresh CLAUDE.md so Claude Code auto-loads the
                           harness context.
    --override             On protected-path conflict, back up and replace AGENTS.md and docs/.
    --force                Overwrite existing files after backing them up.
    --dry-run              Show what would change without writing files.
```

Protected-path rule (`check_protected_target_paths`): if `AGENTS.md` **or `docs/`** already exists,
a non-interactive (`--yes`) install **stops** unless `--merge` or `--override` is given.
Environment overrides: `HARNESS_TARGET_DIR`, `HARNESS_CORE_RELEASE_TAG`, `HARNESS_CORE_BINARY`,
`HARNESS_CORE_CLI_PLATFORM`, `HARNESS_CORE_CLI_BASE_URL`, `HARNESS_SOURCE_BASE_URL`,
`HARNESS_CORE_SOURCE_BASE_URL`. Supported platforms (`detect_cli_platform`): macos-arm64,
macos-x64, linux-x64, linux-arm64 (Windows via `install-harness.ps1`).

Two install source modes:

- **remote** (curl pipe): reads `scripts/harness-release-tag` (currently `harness-v0.1.10`),
  downloads `harness-<platform>` + `.sha256` from that GitHub release, verifies checksum and that
  `--version` equals the tag, then runs `harness install`. The payload is **embedded in that
  released binary**, so remote installs get the `harness-v0.1.10` wording, which may predate the
  2026-10-04 HEAD refactor (crate version is still 0.1.10 at HEAD). Whether a newer release has
  been published is **UNVERIFIED**.
- **local** (run the script from a checkout): requires `cargo`; builds `-p harness --locked` and
  embeds the checkout's files — this is the way to get exactly what `.refs/repository-harness`
  HEAD contains.

## 8. How user stories are written, and where

### 8.1 Current upstream: nowhere

No `docs/stories/`, no story template in the install payload, no story CLI.

### 8.2 Legacy convention (what "US" refers to in this organisation)

Older harness copy at `/Users/ngocchanh/Project/private/organisations/hdc/repository-harness`
(HEAD `f07cd06`, 2026-06-15) and consumers such as
`/Users/ngocchanh/Project/private/organisations/hdc/mosa-admin-service/docs/stories/` show the
protocol-v1 model:

- `docs/FEATURE_INTAKE.md`: "Every implementation prompt enters the intake gate before code
  changes." Flow: classify input type -> restate as work item -> find affected product docs and
  stories -> run risk checklist -> choose lane **tiny / normal / high-risk**.
  - Tiny: patch directly, no story packet.
  - Normal: "Create or update one story file from `docs/templates/story.md`."
  - High-risk: "Create a story folder using `docs/templates/high-risk-story/`" with
    `execplan.md`, `overview.md`, `design.md`, `validation.md`; ask for human confirmation; record
    a decision in `docs/decisions/NNNN-*.md`.
  - Risk flags: Auth, Authorization, Data model, Audit/security, External systems, Public
    contracts, Cross-platform, ...
- `docs/stories/README.md`: paths `docs/stories/epics/E01-domain-name/US-001-short-story-title.md`
  (normal) or `.../US-012-risky-story-title/{execplan,overview,design,validation}.md` (high-risk);
  status flow `planned -> in_progress -> implemented`, then `changed -> retired`.
- Legacy `docs/templates/story.md` (verbatim headings): `# US-XXX Story Title`, `## Status`,
  `## Lane` (tiny | normal | high-risk), `## Product Contract`, `## Relevant Product Docs`,
  `## Acceptance Criteria`, `## Design Notes` (Commands/Queries/API/Tables/Domain rules/UI
  surfaces), `## Validation` (Unit/Integration/E2E/Platform/Release table), `## Harness Delta`,
  `## Evidence`.
- It depended on `scripts/bin/harness-cli` (SQLite) with `intake`, `story`, `decision`, `backlog`,
  `trace`, `query` commands — the part that is now EOL. "The last published compatibility release
  is `harness-cli-v0.1.22`" (current `README.md`); it "receives no new features, fixes, or
  compatibility guarantee".

### 8.3 How sibling repos combined stories with OpenSpec

The harness itself contains **no OpenSpec integration** (no mention in `README.md`, `docs/`,
`scripts/`, `.agents/` of either copy). The pairing is an organisation convention, visible in
`/Users/ngocchanh/Project/private/organisations/hdc/mosa-admin-service/docs/stories/README.md`:
"One story per bounded capability; it maps to one openspec change and one or more rows in
`docs/TEST_MATRIX.md`", flat naming `docs/stories/US-###-short-slug.md`, statuses
`planned | in_progress | blocked | implemented | changed | retired`, and each story carries a
`## Verify command` such as
`openspec validate <change> --strict && npm run typecheck && npm run lint && npm run build && npm test`.

JAgentChill already has OpenSpec scaffolding (`openspec/config.yaml` with `schema: spec-driven`,
`.claude/skills/openspec-*`, `.claude/commands/opsx/*`), so the same pairing is available:
story = the *why/acceptance/proof* packet; OpenSpec change = proposal/design/specs/tasks.

## 9. Adopting it in JAgentChill — literal steps

Target: `/Users/ngocchanh/Project/private/organisations/hdc/jagentchill`. Current state observed:
`.git/`, `.gitignore` (`.refs/`, `node_modules/`), `.claude/`, `openspec/config.yaml`,
`docs/research/`. No `AGENTS.md`, no `CLAUDE.md`. Because `docs/` already exists, `--merge` is
mandatory for a non-interactive install. The commands below were **not executed** for this note.

1. Preview (no writes):
   ```bash
   cd /Users/ngocchanh/Project/private/organisations/hdc/jagentchill
   curl -fsSL "https://raw.githubusercontent.com/hoangnb24/repository-harness/main/scripts/install-harness.sh?$(date +%s)" \
     | bash -s -- --merge --claude --yes --dry-run
   ```
2. Install the core plus the Claude shim:
   ```bash
   curl -fsSL "https://raw.githubusercontent.com/hoangnb24/repository-harness/main/scripts/install-harness.sh?$(date +%s)" \
     | bash -s -- --merge --claude --yes
   ```
   Alternative that installs exactly the vendored HEAD (needs `cargo`; note it builds into
   `.refs/repository-harness/target/`):
   ```bash
   .refs/repository-harness/scripts/install-harness.sh --directory "$PWD" --merge --claude --yes
   ```
   Add `--with-engineering-wisdom` only if the advisory skill is wanted.
3. Verify:
   ```bash
   scripts/bin/harness status
   scripts/bin/harness doctor
   git status --short
   ```
   Expect new: `AGENTS.md`, `CLAUDE.md`, `.agents/skills/**`, `docs/{WORKFLOW,README}.md`,
   `docs/{product,plans,decisions,templates,patterns}/**`, `.harness-core/`, `scripts/bin/harness`
   (git-ignored), and two lines appended to `.gitignore`. Decide whether to commit `.harness-core/`
   (it is the update base, so yes — committing it is what makes `harness update` three-way merge
   work for other clones; upstream does not state this explicitly, **UNVERIFIED**).
4. Fill consumer-owned truth (the harness ships these empty on purpose):
   - `docs/product/` — JAgentChill product intent (editor, chat agent, one-prompt workflow, AI
     film production);
   - `docs/decisions/0001-*.md` from `docs/templates/decision.md` — e.g. "OpenClaw as agent
     harness (sidecar vs embed)", "Archify role (artifact vs live view)", "story + OpenSpec
     workflow";
   - `AGENTS.md` — project rules **outside** the `<!-- HARNESS:BEGIN/END -->` block so updates
     do not clobber them.
5. Adopt the story workflow as a JAgentChill decision (the harness will not do this):
   - record it in `docs/decisions/` and in `AGENTS.md`;
   - create `docs/stories/README.md` (naming `US-###-slug.md`, status legend, index table) and
     `docs/templates/story.md`, copying the legacy template from
     `/Users/ngocchanh/Project/private/organisations/hdc/repository-harness/docs/templates/story.md`
     and dropping its `scripts/bin/harness-cli story update ...` line (that binary is EOL);
   - optionally copy `docs/templates/high-risk-story/` from `.refs/repository-harness` for
     auth/data-model/cross-platform work;
   - per story: write `docs/stories/US-###-*.md` -> `openspec` propose a change with the same
     scope -> implement via tasks -> run the story's verify command -> record evidence -> mark
     `implemented` -> archive the OpenSpec change.
6. Define the verify gate the harness does not provide: a single repo command (for example
   `pnpm verify` = typecheck + lint + test + build + `openspec validate --strict`) and a CI job
   that runs it. Use `$encode-invariant` later to add accepted architecture rules to that gate.
7. Maintenance going forward:
   ```bash
   scripts/bin/harness update --dry-run
   scripts/bin/harness update
   # on overlap: resolve staged files, then
   scripts/bin/harness update --continue      # or: scripts/bin/harness update --abort
   ```

## 10. Open points to confirm with the owner

- Does "full harness" mean the **current** core (sections 2-7) plus an in-repo story convention
  (step 5), or the **legacy** protocol-v1 harness with `harness-cli` + SQLite? The latter is
  unsupported upstream; pinning `harness-cli-v0.1.22` is possible but not recommended.
- Flat `docs/stories/US-###-slug.md` (as in `mosa-admin-service`) or epic folders
  `docs/stories/epics/E##-name/US-###-...` (as in legacy upstream)?
- Licence: MIT (`LICENSE`, `Cargo.toml` `license = "MIT"`).

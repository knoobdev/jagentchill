# Devin UI reference (Mobbin, web) — design language to reproduce

Source: Mobbin MCP, app "Devin — The AI software engineer", web platform, ~90 screens + 4 flows
reviewed 2026-10-05 (sessions, ask, automations, review, wiki, settings, modals, menus, auth, onboarding).
Mobbin has no iOS capture of Devin; mobile layouts are derived from the web system (see §9).

JAgentChill reproduces the *layout system, density, and component vocabulary*. It uses its own name,
logo, and icon set; no Devin/Cognition brand assets or wordmarks.

## 1. Global shell

```
┌────────────┬──────────────────────────────────────────────────────────────┐
│ Sidebar    │ Top bar: breadcrumb/title · tags      actions · ⋯ · panel-toggle │
│ 240px      ├──────────────────────────────────────────────────────────────┤
│            │ Content (centered column, or split chat | workspace)          │
└────────────┴──────────────────────────────────────────────────────────────┘
```

- Sidebar ≈ 240px, tinted off-white (light) / near-black (dark); 1px right hairline; collapsible via
  top-right "panel" icon. Content background is pure white / #1c1c1c-ish.
- Sidebar top row: org avatar (rounded square, initial) + org name + chevron (opens org switcher
  popover: org card with Settings / Upgrade buttons, "Team & Personal" list with check on current,
  "Create new organization", "Log out"); right side: search icon, collapse icon.
- Primary nav (icon 14px + 13px label, 28px rows, 6px radius, selected = grey fill):
  Sessions · Ask · Automations · Review · Wiki. Newer variant: "+ New session" as first item.
- Secondary list header: section name + (search, +, ⋯) icon buttons. Groups with small grey
  captions: Pinned · TODO LIST · Recent. Empty text "No sessions".
- List row = title (13px, truncated) + meta line (12px grey: relative time, or green status
  "PR is ready · ⑂1", grey "Working"); unread = 6px blue dot at right.
- Sidebar footer: "Upgrade" link (blue, with icon) at left; three icon buttons at right
  (settings, download/desktop, help).
- Optional footer promo card: image + "Install Desktop ↗" / "Install CLI ↗" with dismiss ×.

## 2. Home / new session

- Vertically centered column ~ 370–460px wide: faint logo mark, then composer card.
- Composer card: 12px radius, 1px border, soft shadow; textarea placeholder ("Ask … to build…");
  bottom-left pill select (mode: Normal/Fast/Agent/Plan/Auto with icon + chevron), "+" attach,
  settings-sliders icon; bottom-right mic icon + circular send button (grey disabled, black active)
  with split chevron.
- Context row under composer (12px grey): "📁 12 repositories ▾ · ⚙ Ubuntu ▾ · Upgrade plan ·
  Advanced capabilities →".
- Optional banner above composer inside same card ("Connect your codebase… [Connect]").
- "@" mention popover: categories list (Repositories, Files, Skills, Sessions, Macros, Playbooks,
  Secrets) each with icon + title + one-line description; second level = searchable entity list.
  Chosen mention renders as inline chip. Attachments render as chips with thumbnail.
- "Get started" checklist card: title + "2 of 4" + thin progress bar + ×; rows with blue filled
  check (done, blue link text) or empty circle (todo); "Show starter tips" disclosure.
- Newer variant header row: logo wordmark left, segmented "Agent | Ask" toggle right.

## 3. Session view (split)

- Top bar: session title, tag chips (grey pills), right: folder chip "TODO LIST", counter chip
  (green ⑂ 2), ⋯ menu, panel toggle.
- Left pane (≈40%): chat timeline, max ~290px text column.
  - User message: right-aligned grey bubble, avatar circle at right; attachment chips below.
  - Agent output: plain text, no bubble. Collapsible activity rows "› Thought for 9s",
    "› Worked for 4m 1s +394 −94" (green/red diff counts), nested step list with icons
    ("7/7 Test the app end-to-end", "Stopped working").
  - Embedded cards: PR card (title, repo, diff stat, "Review" / "Analyze" buttons); code/config
    card with green left gutter, "Expand ▾", footer "View build / View in Settings";
    media card (video thumbnail with play button, caption, "● 8 passed", "✓ All passed" pill);
    file card (blue doc icon, name, size).
  - Message footer: 👍 👎 copy link, timestamp. Status line "✺ Devin went to sleep" / "Cooking".
  - Floating "scroll to bottom" circle.
- Composer docked bottom of left pane: "Ask … / Guide … while it works", "+", mode label,
  mic, send (becomes stop ■ while running).
- Right pane (≈60%): tab strip (Worklog · Changes · PR #5 · Desktop · Shell · file tabs, "+" new tab,
  expand ⤢). New-tab page lists panel types with icon, title, description (Changes, Worklog,
  Desktop, Shell, IDE, Agents).
  - Worklog: event header ("Read content.txt:30-65"), file viewer with line numbers, bottom
    scrubber bar (blue progress), ← → step buttons, "● Live" indicator.
  - Changes/PR: status pill (Open green / Merged purple), title, branch chips, +/− counts,
    "Ready to merge" row + blue Merge split button, sub-tabs (Changes · Bugs · Description ·
    Discussion n), file accordion rows (name, path, +/−, "Mark as viewed" checkbox, ⋯), diff with
    red/green line backgrounds.
  - Shell: sub-tabs per terminal, terminal output, "Search Command History" table
    (command · status dot · duration · start).
  - Markdown file: rendered/source toggle (eye, code, copy, download icons).
- ⋯ session menu (grouped, with separators): Archive · Folders (Remove from TODO LIST, Pin,
  New folder) · Edit tags, Copy session ID, Update network config, Rename, Make visible to team,
  Schedule, Create playbook from session, Analyze session, Reboot (red), Terminate (red) ·
  Focus mode (⌘⇧F), Knowledge suggestions, Session usage limits · Give feedback, View session
  insights · footer stats (On-demand usage $, User messages, Session size, Category).

## 4. Ask / Wiki / Review

- Ask: same centered composer with heading "What questions do you have?"; answer view = text
  column left + right pane of source file cards (filename, path, code excerpt, "5 lines / All 70").
- Wiki: left tree nav (2-level indented, selected grey), article column (h1, "Relevant source
  files" disclosure, body, source links mono blue), right mini TOC ticks, floating bottom composer
  "Ask about …" with "Plan" pill; top bar: breadcrumb, "Last updated", branch chip, search field,
  ⋯ menu (Re-index now, Language ▸, Edit wiki, settings, Remove (red)).
- Review: left file tree with +/− counts; center side-by-side diff; right info rail with tabs
  (Info · Chat): analysis card + blue CTA, Checks, Auto-fix, Reviewers, Assignees, Labels (each
  "+" add).

## 5. Automations

- Index: heading, prompt composer card ("Fix lint errors whenever…") with "Featured automations"
  list inside the card footer (icon, title, one-line desc, "+"), tabs (Automations n · Triage),
  search, black "+ Create automation" button; table rows (name, owner, sparkline, created).
  Empty state: two template cards.
- Editor: title input; **Triggers** section ("Add trigger" dropdown: GitHub ▸, Schedule ▸, Slack ▸,
  Linear ▸, Webhook) with trigger rows built from blue token chips ("Issue comment in repo X and
  Action equals Created"), info note; schedule popover (Visual | RRULE segmented, repeat every,
  weekday circles, time, Apply). **Instructions** section ("Add instruction"): "Start session"
  block with prompt text, per-block options popover. **MCPs** section: searchable checkbox list,
  "n selected", Setup/Built-in badges. "Advanced ›". Black "Create automation" button.
- Detail: Active toggle, creator + date, "7 triggers · 100% success" + bar chart, "Trigger now".

## 6. Settings

- Replaces sidebar: "← Back to app", search settings, groups: Personal (Preferences, Connections),
  Organization <name> (General, Connections, Sessions, Plans, Invoices, Usage & limits ·
  product pages · Skills & Rules, Environment, Knowledge, Playbooks, Secrets · Repositories,
  Membership, API, Analytics). "New" green badge.
- Page pattern: breadcrumb top bar; "← Back to organization"; centered column ~360px (wide pages
  ~520px); h1 + grey subtitle; **grouped setting cards**: bordered 8px-radius card of rows
  (label 13px medium + grey description; control at right: select, toggle, inline edit chip with
  pencil, read-only mono ID).
- Landing: list card of sections with icon tile + chevron.
- Tables: search field + right-aligned buttons (secondary "Bulk add", primary blue "Add");
  grey header row; empty state centered ("No secrets found / Add your first…").
- Side sheet (right, ~250px) for create forms: scope segmented control, notice box (blue left
  bar), fields, toggle row, primary button.
- Plans: plan cards (name, price in blue, feature checks, button; current plan has blue border).
- Usage/Analytics: tabs, date range select, KPI tiles, bar charts (blue bars, hover tooltip),
  history table with "View session →".
- Sessions admin: filter chips ("Creator is X ×", "+ Add filters"), dense rows with status ring
  icon, title, preview text, tag pill, PR chip, date, avatar; bulk checkboxes; Display select.
- Notices: left-bar callouts — blue (info), orange (warning).

## 7. Overlays

- Modal: ~270–290px wide, 10px radius, title 14px semibold + grey subtitle, × top-right, footer
  right-aligned (ghost Cancel + blue primary). Variants: feedback textarea, tag picker (search +
  Create), checkbox list picker with "Add 1 repository", confirm, insights (tabs + KV table).
- Toast: bottom-right, dark pill, green check icon, optional "Undo" link, ×.
- Dropdown/popover: white, 8px radius, soft shadow, 28px rows, checkmark on selected, submenu ▸,
  red text for destructive.

## 8. Tokens (measured approximations)

| Token | Light | Dark |
|---|---|---|
| bg/app | #FFFFFF | #1B1B1B |
| bg/sidebar | #F7F7F7 | #141414 |
| bg/subtle (hover, selected, chip) | #EFEFEF | #2A2A2A |
| border/hairline | #E8E8E8 | #2E2E2E |
| text/primary | #1A1A1A | #EDEDED |
| text/secondary | #6B6B6B | #9A9A9A |
| text/tertiary | #A3A3A3 | #6A6A6A |
| accent/blue (links, primary, toggles, unread dot) | #2F6FEB | #4C8DFF |
| success/green | #1F9D55 | #3DBE7A |
| danger/red | #D93025 | #F26D63 |
| warning/orange | #E8890C | #F0A23B |
| merged/purple | #7C4DDB | #A98BEF |
| diff add bg / del bg | #E6F6EA / #FDECEC | #173524 / #3A1D1D |
| button/strong (send, create) | #1A1A1A on white text | #EDEDED on dark text |

- Type: Inter-like grotesk; 13px base, 12px meta, 14px modal title, 18–20px page h1 (semibold);
  mono for IDs, code, paths. Line-height ~1.45.
- Radius: 6 (rows, buttons, inputs), 8 (cards, popovers), 10–12 (composer, modals), full (pills).
- Spacing grid 4px; row height 28–32; card row padding 12×10.
- Elevation: hairline borders first; shadow only on composer, popovers, modals, toasts.
- Icons: 14–16px outline, 1.5 stroke. Motion: 120–160ms ease-out fades/slides, no bounce.

## 9. Mobile derivation rules

- Sidebar → drawer (swipe from left) with the same sections; top bar keeps title + ⋯.
- Split session view → single pane with segmented/tab switch (Chat | Workspace); workspace tabs
  become a horizontally scrollable tab strip.
- Composer docks above the keyboard/safe area; popovers → bottom sheets; modals → full-height
  sheets; settings sidebar → pushed list screens; tables → stacked rows.

---
name: jagentchill-orchestration
description: "The base team skill: preparing a task brief, creating peers, limits, and reading hand-backs."
---

# Orchestration

Use a team only when the work splits into parts that do not need each other's results as they go. Otherwise do it yourself.

## Brief
A peer knows only what you write. A brief states:
- The outcome, as something that can be checked.
- What is already known and already ruled out.
- The inputs to read, by name.
- What must not be changed.
- When to stop and what to send back.

If you cannot write that, you do not understand the task well enough to hand it off.

## Creating peers
Create one with `jc_agent_create`, one task each. Prefer few: every peer costs tokens and attention, and two that edit the same thing produce conflicts.

## Limits
Give each task a budget in turns or cost and a stop condition. A peer that reaches its limit returns what it has; it does not ask for more on its own.

## Reading a hand-back
Read the evidence, not the summary. A claim without evidence is unverified. Check consequential results yourself before building on them, and say which you checked.

## Closing
Collect the results into one answer in your own words. Stop peers that are no longer needed.

---
name: jagentchill-producing
description: "Run the prompt-to-video workflow end to end: cost estimates, budgets, approvals, re-running a step, and hand-over to the timeline."
---

# Producing

## Before starting
Estimate first with `jc_cost_estimate` and show the number with what it buys. If the estimate is above the budget, propose a smaller plan (fewer shots, shorter clips, a cheaper model) instead of asking for more money.

## Running
List workflows with `jc_workflow_list` and start one with `jc_workflow_start`. Follow it with `jc_job_status` and `jc_job_wait`; do not poll faster than the job can change.

Stop for a person at each gate the workflow defines: script, storyboard, final cut. Present one decision at a time with your recommendation.

## When a step fails or disappoints
Re-run that step only. Change one input, say which, and keep the earlier result until the new one is accepted. Two failed re-runs of the same step mean the input is wrong: go back one step.

## Budget
Report spend after every generating step. When a budget is reached, stop generating, deliver what exists and say what the remainder would cost.

## Hand-over
Assemble with `jc_video_assemble_plan`, check with `jc_video_checks`, and hand the editor a timeline that plays from start to end, with a list of what is placeholder.

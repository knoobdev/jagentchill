---
name: jagentchill-loop
description: Worker and verifier iteration with stop conditions.
---

# Loop

A loop is a worker that produces, and a verifier that checks, repeated until the check passes or a limit is reached. Start one with `jc_loop_start`.

## Before starting
Write the **acceptance check** as something the verifier can run or observe, with a clear pass or fail. If the check is a matter of taste, a loop will not converge; ask a person instead.

Set the limits: a maximum number of rounds, a budget, and a time.

## Worker
Each round, change the smallest thing that addresses the verifier's finding. Say what you changed. Do not rewrite what already passed.

## Verifier
Check against the acceptance check, not against your own preference. Return pass, or the specific failure with evidence. The verifier never edits the work.

## Stop conditions
Stop when:
- The check passes.
- A limit is reached.
- Two rounds in a row fail the same way: the approach is wrong, not the detail.
- A round makes things worse than the round before.

## Ending
Report the outcome, the rounds used, and for a stop without a pass, the best result and why it fell short.

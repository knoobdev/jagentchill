---
name: jagentchill-diagram-authoring
description: "Author workflow diagrams with the diagram tools: lanes, columns, node kinds and edges."
---

# Diagram authoring

## Read, then patch
Fetch the diagram with `jc_diagram_get` and change it with `jc_diagram_patch`. Send small patches: one lane or one group of nodes at a time, so a rejected patch loses little.

## Layout
- **Lanes** are who does the work (a persona, a service, a person).
- **Columns** are stages in time, left to right.
- A node sits in exactly one lane and one column.

Keep edges flowing left to right. An edge that goes backwards is a loop and must be labelled with its stop condition.

## Node kinds
Use the kind that says what happens: an agent step, a generation, a review gate, a decision, an input, an output. Do not model a decision as an agent step with two unlabeled edges.

## Edges
Label an edge only when it carries a condition or a named artefact. One source and one target per edge; merge with an explicit node.

## Legibility
At most seven nodes per lane before splitting the diagram. Name nodes with a verb and an object. Give every diagram one input and one output node so a reader can find where it starts and ends.

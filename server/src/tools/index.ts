/**
 * The agent tool framework — what another capability (script studio, workflows, film) builds its `jc_*` family on.
 *
 * A FAMILY is one module exporting `ToolDefinition[]`, made with the three helpers of `kit.ts`, and spread into
 * `ALL_TOOLS` below. A tool is served only when its name is also a row of `TOOL_INDEX` and of `TOOL_MANIFEST` in
 * `packages/protocol/src/tools.ts` (a test fails on any drift), so add it there first.
 *   - `readTool({name, family, description, shape, handle})` — read-only; `handle(ctx, args)` returns the `data`.
 *   - `writeTool({...})` — a STAGED write: the handler changes `ctx.doc` only through `ctx.run(<editor-core command>)`
 *     or `ctx.apply((doc, commitCtx) => Commit)` and returns `{data?, summary, change: {kind, entity, entityId, label}}`.
 *     The service turns that into one change of the session's proposal; the handler never touches sync or storage.
 *   - `defineTool({... kind: "direct"})` — an effect that is not staged (a new project, the proposal tools themselves);
 *     it may return `{data, proposalId?, changeIds?, summary?, revision?, images?}`.
 * `shape` is a Zod raw shape and is closed (unknown keys are `INVALID_PARAMS`); staged writes spread `WRITE`
 * (`idempotencyKey`, `dryRun`, `editContext`), lists spread `PAGE` and return through `page()`. No tool takes a
 * caller-identity parameter: the session is bound by the MCP endpoint (`mcp.ts`) and arrives as `ctx.session`.
 * A handler fails by throwing `fail(code, message, details)` / `outOfRange(field, min, max, value)`; editor-core
 * refusals and document-validator findings are mapped to tool codes by `failureOf`.
 *
 * `ToolContext` (stable): `session`, `projectId`, `doc` (host replica with the session's open proposal applied),
 * `committed`, `revision`, `edit`, `warnings`, `dryRun`, `run`, `apply`, `commitContext`, `scene`, `activeSceneId`,
 * and `host` (`ToolHost`: projects, lease holder, editor context/focus, frames, and `host.proposals`).
 *
 * The PROPOSAL mechanism lives in `service.ts` (`createToolService`), reachable as `app.tools`:
 *   - `call(sessionKey, name, args)` → `{envelope, images}` — every check, then the tool; always the result envelope.
 *   - staging is implicit: the first staged write of a session opens its proposal (`open`), `jc_proposal_submit` or
 *     the end of the turn (`turnEnded`) makes it `pending`, a person resolves it over channel P
 *     (`jagentchill.proposal.get|list|resolve|revert`, event `jagentchill.proposal.updated`), and an accepted one is
 *     applied as ONE batch through the edit lease (`sync.host.applyBatch`), so devices receive it from the op log.
 *   - `resolve(proposalId, action, by, options)` and `revert(proposalId, by, force)` are the same entry points for a
 *     host-side caller; `currentProposal(sessionKey)`, `proposal(id)`, `writerOf(projectId)` read state.
 * Only project documents are staged here; a family whose document is not a project keeps its own store and reuses
 * the envelope, the checks of `call` and the audit record by registering its tools as `read` or `direct`.
 */
import { AGENT_TOOLS } from "./agents.ts";
import { ARRANGE_TOOLS } from "./arrange.ts";
import { AUDIO_TOOLS } from "./audio.ts";
import { CLIP_TOOLS } from "./clips.ts";
import { FILM_TOOLS } from "../film/tools.ts";
import { FX_TOOLS } from "./fx.ts";
import { GENERATE_TOOLS } from "../generation/tools.ts";
import { INSPECT_TOOLS } from "./inspect.ts";
import type { ToolDefinition } from "./kit.ts";
import { MEDIA_TOOLS } from "./media.ts";
import { MOTION_SCENE_TOOLS } from "./motion-scene.ts";
import { PROJECT_TOOLS } from "./project.ts";
import { PROPOSAL_TOOLS } from "./proposal.ts";
import { SESSION_TOOLS } from "./session.ts";
import { SHAPE_TOOLS } from "./shapes.ts";
import { TEXT_TOOLS } from "./text.ts";
import { TEMPLATE_TOOLS } from "./template.ts";
import { WORKFLOW_TOOLS } from "./workflows.ts";
import { VIDEO_CHECK_TOOLS } from "./video-check.ts";

/** Every `jc_*` tool this server serves, one module per family. The set equals the tool manifest of `@jagentchill/protocol`. */
export const ALL_TOOLS: ToolDefinition[] = [...PROJECT_TOOLS, ...MEDIA_TOOLS, ...MOTION_SCENE_TOOLS, ...INSPECT_TOOLS, ...VIDEO_CHECK_TOOLS, ...CLIP_TOOLS, ...ARRANGE_TOOLS, ...TEXT_TOOLS, ...TEMPLATE_TOOLS, ...AUDIO_TOOLS, ...FX_TOOLS, ...SHAPE_TOOLS, ...PROPOSAL_TOOLS, ...SESSION_TOOLS, ...AGENT_TOOLS, ...GENERATE_TOOLS, ...WORKFLOW_TOOLS, ...FILM_TOOLS];

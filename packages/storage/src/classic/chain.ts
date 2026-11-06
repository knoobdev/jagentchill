/**
 * The OpenCut classic migration chain v0 → v31, ported from OpenCut classic (MIT, © 2025-2026 OpenCut; the commit is
 * pinned in THIRD_PARTY_NOTICES.md). Each `vN-to-vM.ts` in this directory is the classic transformer with its frozen
 * era defaults; they differ from the originals only where a JAgentChill requirement says so (marked "JAgentChill:" in
 * the file) and in taking ids and "now" from the migration context instead of the platform.
 */
import { withClassicRuntime, type ClassicRuntime } from "./runtime.ts";
import type { MigrationResult, ProjectRecord } from "./types.ts";
import { isRecord } from "./utils.ts";
import { transformProjectV0ToV1 } from "./v0-to-v1.ts";
import { transformProjectV1ToV2, type V1ToV2Context } from "./v1-to-v2.ts";
import { transformProjectV2ToV3 } from "./v2-to-v3.ts";
import { transformProjectV3ToV4 } from "./v3-to-v4.ts";
import { transformProjectV4ToV5 } from "./v4-to-v5.ts";
import { transformProjectV5ToV6 } from "./v5-to-v6.ts";
import { transformProjectV6ToV7 } from "./v6-to-v7.ts";
import { transformProjectV7ToV8 } from "./v7-to-v8.ts";
import { transformProjectV8ToV9 } from "./v8-to-v9.ts";
import { transformProjectV9ToV10 } from "./v9-to-v10.ts";
import { transformProjectV10ToV11 } from "./v10-to-v11.ts";
import { transformProjectV11ToV12 } from "./v11-to-v12.ts";
import { transformProjectV12ToV13 } from "./v12-to-v13.ts";
import { transformProjectV13ToV14 } from "./v13-to-v14.ts";
import { transformProjectV14ToV15 } from "./v14-to-v15.ts";
import { transformProjectV15ToV16 } from "./v15-to-v16.ts";
import { transformProjectV16ToV17 } from "./v16-to-v17.ts";
import { transformProjectV17ToV18 } from "./v17-to-v18.ts";
import { transformProjectV18ToV19 } from "./v18-to-v19.ts";
import { transformProjectV19ToV20 } from "./v19-to-v20.ts";
import { transformProjectV20ToV21 } from "./v20-to-v21.ts";
import { transformProjectV21ToV22 } from "./v21-to-v22.ts";
import { transformProjectV22ToV23 } from "./v22-to-v23.ts";
import { transformProjectV23ToV24 } from "./v23-to-v24.ts";
import { transformProjectV24ToV25 } from "./v24-to-v25.ts";
import { transformProjectV25ToV26 } from "./v25-to-v26.ts";
import { transformProjectV26ToV27 } from "./v26-to-v27.ts";
import { transformProjectV27ToV28 } from "./v27-to-v28.ts";
import { transformProjectV28ToV29 } from "./v28-to-v29.ts";
import { transformProjectV29ToV30 } from "./v29-to-v30.ts";
import { transformProjectV30ToV31 } from "./v30-to-v31.ts";

export type { ClassicRuntime, MigrationResult, ProjectRecord, V1ToV2Context };
/** What the classic steps need besides the record: the id source, "now", and the joined legacy data of the v1 era. */
export type ClassicContext = ClassicRuntime & Partial<V1ToV2Context>;
export type ClassicStep = { from: number; to: number; name: string; run(project: ProjectRecord, context: ClassicContext): MigrationResult<ProjectRecord> };

type Transformer = (args: { project: ProjectRecord }) => MigrationResult<ProjectRecord>;
const TRANSFORMERS: Transformer[] = [
	transformProjectV0ToV1, transformProjectV1ToV2, transformProjectV2ToV3, transformProjectV3ToV4, transformProjectV4ToV5,
	transformProjectV5ToV6, transformProjectV6ToV7, transformProjectV7ToV8, transformProjectV8ToV9, transformProjectV9ToV10,
	transformProjectV10ToV11, transformProjectV11ToV12, transformProjectV12ToV13, transformProjectV13ToV14, transformProjectV14ToV15,
	transformProjectV15ToV16, transformProjectV16ToV17, transformProjectV17ToV18, transformProjectV18ToV19, transformProjectV19ToV20,
	transformProjectV20ToV21, transformProjectV21ToV22, transformProjectV22ToV23, transformProjectV23ToV24, transformProjectV24ToV25,
	transformProjectV25ToV26, transformProjectV26ToV27, transformProjectV27ToV28, transformProjectV28ToV29, transformProjectV29ToV30,
	transformProjectV30ToV31,
];

const hasTrackZones = (tracks: unknown): boolean => isRecord(tracks) && !Array.isArray(tracks) && Array.isArray(tracks.overlay) && Array.isArray(tracks.audio) && isRecord(tracks.main);
/**
 * From v24 on a scene's tracks are `{overlay, main, audio}`. The classic v24→v25 step could leave a scene in another
 * shape (a flat array spread into an object with numeric keys), which v25→v26 exists to repair; here no step is
 * allowed to hand such a scene on, so the same repair runs right after any step that produced one.
 */
function withTrackZones(project: ProjectRecord): ProjectRecord {
	if (!Array.isArray(project.scenes) || project.scenes.every((scene) => !isRecord(scene) || hasTrackZones(scene.tracks))) return project;
	const version = project.version;
	const repaired = transformProjectV25ToV26({ project: { ...project, version: 25 } }).project;
	return { ...repaired, version };
}

/** The ordered classic chain v0→v1 … v30→v31. */
export const CLASSIC_STEPS: ClassicStep[] = TRANSFORMERS.map((transform, from) => ({
	from, to: from + 1, name: `v${from}→v${from + 1}`,
	run(project, context) {
		return withClassicRuntime(context, () => {
			const result = from === 1
				? transformProjectV1ToV2({ project, context: { legacyTracksBySceneId: context.legacyTracksBySceneId ?? {}, mediaTypesById: context.mediaTypesById ?? {} } })
				: transform({ project });
			// A skipped step stops the project's chain; the runner leaves the record unchanged.
			if (result.skipped) return result;
			return { ...result, project: from + 1 >= 24 ? withTrackZones(result.project) : result.project };
		});
	},
}));
export const CLASSIC_FINAL_VERSION = 31;

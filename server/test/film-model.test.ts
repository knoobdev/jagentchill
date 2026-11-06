// Reproduction of operations run by the server film service. No real files or providers.
// W7: a shot's picture set in motion (a clip on the timeline), the accent of a voice, a character's voice sample.
// Pure functions of the film model; the media "files" are records made here (no provider, no model).
import assert from "node:assert/strict";
import { test } from "node:test";
import { film as fm, promptVideo as pv, validateProjectDocument, validatorEffectRegistry, validatorTransitionRegistry, type Registries } from "@jagentchill/editor-core";

let counter = 0;
const context = (): fm.OpContext => ({ now_ms: 2000, newId: () => `id_${++counter}` });
const blob = (name: string): string => name.padEnd(64, "0").replace(/[^0-9a-f]/g, "a").slice(0, 64);
const file = (name: string, kind: "image" | "audio" | "video", seconds?: number): pv.MediaFile => ({ blobId: blob(name), name, kind, bytes: 1000, ...(kind === "audio" ? {} : { width: 1920, height: 1080 }), ...(kind === "image" ? {} : { duration_ticks: Math.round((seconds ?? 1) * pv.TICKS) }), provenance: { source: "ai", provider: "test", model: "test", role: kind, jobId: name, created_ms: 1, referenceAssetIds: [] } });
const version = (name: string): fm.Version => ({ id: `v_${name}`, media: file(name, "image"), costUsd: 0.01, prompt: name, created_ms: 1 });
const clip = (name: string, pictureId: string, seconds: number): fm.PanelClip => ({ id: `c_${name}`, media: file(name, "video", seconds), costUsd: 0.13, prompt: name, created_ms: 1, pictureId, duration_ticks: Math.round(seconds * pv.TICKS) });
const raw = (language: string, extra: Record<string, unknown> = {}, people: Record<string, unknown>[] = [{ name: "Linh", role: "lead", gender: "female", description: "A lantern maker", appearance: "Seventeen, long braid" }, { name: "Minh", role: "supporting", gender: "male", description: "A visitor", appearance: "Sixteen, short hair" }]) => ({
  logline: "A girl mends a lantern.", synopsis: "Linh mends a lantern for Minh.", ...extra, characters: people,
  locations: [{ name: "Street", description: "Old town street", appearance: "Yellow shopfronts" }], props: [],
  clips: [{ title: "The stall", panels: [
    { action: "Linh glues silk onto a frame.", duration_s: 4, shotSize: "medium", cameraMotion: "push-in", characters: ["Linh"], location: "Street", props: [], videoPrompt: "Her hands move slowly", lines: [{ kind: "dialogue", speaker: "Linh", text: "It is quieter this way." }] },
    { action: "Minh holds a lantern out.", duration_s: 6, shotSize: "close-up", cameraMotion: "static", characters: ["Minh"], location: "Street", props: [], lines: [{ kind: "dialogue", speaker: "Minh", text: "Can you fix it?" }, { kind: "narration", speaker: "Narrator", text: "She looked at the mark." }] },
  ] }],
});
const made = (language = "vi", extra: Record<string, unknown> = {}, people?: Record<string, unknown>[]): fm.Film => {
  const base = fm.applyOps(fm.createFilm({ id: "film_w7", now_ms: 1000, title: "The Lantern Keeper", language }), [{ op: "film.set", fields: { sourceText: "A story." } }], context());
  return fm.applyOps(base, [{ op: "breakdown.set", breakdown: fm.normaliseBreakdown(raw(language, extra, people), base) }], context());
};
const drawn = (film: fm.Film): fm.Film => fm.applyOps(film, film.panels.map((panel, index) => ({ op: "panel.picture" as const, id: panel.id, version: version(`p${index}`) })), context());
const registries = { effects: validatorEffectRegistry() as Registries["effects"], transitions: validatorTransitionRegistry() };
const assembled = (film: fm.Film) => fm.assembleFilm({ film, projectId: "11111111-1111-4111-8111-111111111111", runId: film.id, hash: "h".repeat(32), withoutMissing: false }, { now_ms: 3000, newId: () => `el_${++counter}`, writer: { id: "test" }, registries });
const mainOf = (document: { scenes: { tracks: { main: { elements: unknown[] } } }[] }) => document.scenes[0].tracks.main.elements as { type: string; startTime: number; duration: number; mediaId?: string; sourceDuration?: number; trimEnd?: number; freeze?: { sourceTime: number }; isSourceAudioEnabled?: boolean; animations?: unknown }[];


test("VF9 server film model: a script rewrite with the same words and a new effective accent outdates old takes",()=>{
 let film=made('vi',{accent:'southern'});
 film=fm.applyOps(film,film.lines.map((line,i)=>({op:'line.take' as const,id:line.id,take:{id:'t_'+i,media:file('voice'+i,'audio',2),costUsd:0.01,duration_ticks:2*pv.TICKS,stale:false,voiceId:'Kore',accent:'southern',created_ms:1}})),context());
 const before=film;
 film=fm.applyOps(film,[{op:'film.set',fields:{sourceText:'The story now calls for Northern speech.'}},{op:'breakdown.set',breakdown:fm.normaliseBreakdown(raw('vi',{accent:'northern'}),film)}],context());
 const result=film.lines.map((line,i)=>({speaker:line.speakerId,textUnchanged:line.text===before.lines[i].text,effectiveBefore:fm.accentOf(before,line.speakerId),effectiveAfter:fm.accentOf(film,line.speakerId),takeAccent:line.takes[0].accent,takeStale:line.takes[0].stale,sameTake:line.takes[0].id===before.lines[i].takes[0].id}));
 console.log('VF9',JSON.stringify(result));
 assert.ok(film.lines.every(l=>l.takes[0].stale),'Every changed effective accent must outdate the old take');
});
test("VF10 server film model: changing Camera or Video prompt outdates the clip, keeps its still current, and removes old motion from the timeline",()=>{
 let film=drawn(made());const panel=film.panels[0];film=fm.applyOps(film,[{op:'panel.clip',id:panel.id,clip:clip('old-motion',panel.picture.current!.id,6)}],context());
 const result=[];
 for(const fields of [{cameraMotion:'pan-left' as const},{videoPrompt:'New moving camera slides along the street'}]){
  const edited=fm.applyOps(film,[{op:'panel.update',id:panel.id,fields}],context());
  result.push({fields,clipStale:edited.panels[0].clip?.stale??false,selectedClip:fm.clipOf(edited.panels[0])?.id,pictureStale:edited.panels[0].picture.stale,timelineTypes:mainOf(assembled(edited).document as never).map(e=>e.type)});
 }
 console.log('VF10',JSON.stringify(result));
 assert.ok(result.every(r=>r.clipStale),'Both motion edits must outdate the old clip');
 assert.ok(result.every(r=>!r.pictureStale));assert.ok(result.every(r=>r.timelineTypes[0]==='image'));
});

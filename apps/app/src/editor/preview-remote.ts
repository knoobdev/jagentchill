import type { EngineEvents, NativeRemote } from "./preview-engine.ts";
import { timeline } from "@jagentchill/editor-core";
type FrameReply = { revision: number; time: number; jpeg: string };

/** Host RPC core kept free of native modules so ordering and caching can be tested with a fake host. */
export function createRemotePreview(remote: NativeRemote, events: EngineEvents, options: {
  debounceMs?: number; loadVideo?(result: { revision: number; sha256: string; size: number }, duration: number): Promise<string>;
}) {
  const cache = new Map<string, string>();
  let document: any = null, sceneId = "", timer: ReturnType<typeof setTimeout> | undefined;
  let requestId = 0, playbackId = 0, disposed = false, revision = -1, videoUri: string | null = null;
  const keyFor = (rev: number, time: number) => `${remote.projectId}:${rev}:${Math.round(time * 1000)}`;
  async function frame(time: number, width: number, id: number): Promise<void> {
    let result: FrameReply;
    try { result = await remote.connection.call<FrameReply>("jagentchill.preview.frame", { projectId: remote.projectId, sceneId, time: time / 120_000, width }); }
    catch (error) { if (!disposed && id === requestId) events.onRemoteError?.(error instanceof Error ? error.message : "Host unreachable"); throw error; }
    if (disposed || id !== requestId) return;
    events.onRemoteError?.("");
    revision = result.revision;
    const timeTicks = result.time * 120_000, key = keyFor(result.revision, timeTicks), known = cache.get(key);
    if (known) { events.onRemoteFrame?.({ uri: known, time: timeTicks, revision }); return; }
    const uri = `data:image/jpeg;base64,${result.jpeg}`;
    cache.set(key, uri); events.onRemoteFrame?.({ uri, time: timeTicks, revision }); events.onFrame({ time: timeTicks, revision });
  }
  const scheduleFrame = (time: number, width: number) => {
    const id = ++requestId;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void frame(time, width, id).catch(() => undefined); }, options.debounceMs ?? 120);
  };
  async function render(fromTime: number, id: number): Promise<void> {
    if (!document || disposed) return;
    const scene = document.scenes.find((candidate: any) => candidate.id === sceneId);
    const total = (scene ? timeline.sceneDurationOf(scene) : 0) / 120_000;
    const range = { start: fromTime / 120_000, end: Math.max(fromTime / 120_000 + 1 / 30, total) };
    let result: { revision: number; sha256: string; size: number };
    try { result = await remote.connection.call<{ revision: number; sha256: string; size: number }>("jagentchill.preview.render", { projectId: remote.projectId, sceneId, range, height: 360 }); }
    catch (error) { if (!disposed && id === playbackId) events.onRemoteError?.(error instanceof Error ? error.message : "Host unreachable"); throw error; }
    if (disposed || id !== playbackId || !options.loadVideo) return;
    revision = result.revision;
    videoUri = await options.loadVideo(result, range.end - range.start);
    if (!disposed && id === playbackId) { events.onRemoteError?.(""); events.onRemoteVideo?.({ uri: videoUri, revision, duration: range.end - range.start, startTime: fromTime, endTime: range.end * 120_000 }); }
  }
  return {
    setDocument(next: any, nextSceneId: string) { document = next; sceneId = nextSceneId; },
    seek(time: number, width: number) { scheduleFrame(time, width); },
    play(time: number) { const id = ++playbackId; requestId++; if (timer) { clearTimeout(timer); timer = undefined; } events.onRemoteProgress?.({ done: 0, total: 1 }); void render(time, id).then(() => { if (id === playbackId) events.onRemoteProgress?.({ done: 1, total: 1 }); }, (error) => { if (id === playbackId) { events.onRemoteProgress?.({ done: 0, total: 0 }); events.onRemoteError?.(error instanceof Error ? error.message : "Host unreachable"); } }); },
    pause() { playbackId++; },
    get revision() { return revision; }, get videoUri() { return videoUri; },
    dispose() { disposed = true; requestId++; if (timer) clearTimeout(timer); },
  };
}

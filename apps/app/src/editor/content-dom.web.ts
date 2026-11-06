/** Browser helpers of the content tabs: font faces for picker rows, drops on the preview canvas, sound previews and text files. */
const PAYLOAD = "application/x-jagentchill";
const registered = new Set<string>();
/** Makes bundled faces usable by the browser for the picker's own rows (the engine shapes its text itself and never uses these). */
export function registerFontFaces(faces: readonly { family: string; url: string; weight: number; style: string }[]): void {
  for (const face of faces) {
    const key = `${face.family}:${face.weight}:${face.style}`;
    if (registered.has(key) || typeof FontFace === "undefined") continue;
    registered.add(key);
    const loaded = new FontFace(`JC ${face.family}`, `url(${face.url})`, { weight: String(face.weight), style: face.style });
    void loaded.load().then((font) => document.fonts.add(font)).catch(() => registered.delete(key));
  }
}
/** A drop of an in-app payload on the preview canvas: `drop` receives the payload and the point in project-canvas pixels from the canvas centre. */
export function bindCanvasDrop(canvas: { width: number; height: number }, accept: (payload: string) => boolean, drop: (payload: string, point: { x: number; y: number }) => void): () => void {
  const player = document.querySelector('[data-testid="player"]') as HTMLElement | null;
  if (!player) return () => {};
  let dragged: string | null = null;
  const start = (event: DragEvent) => { dragged = event.dataTransfer?.getData(PAYLOAD) || null; };
  const end = () => { dragged = null; };
  const frame = () => (player.querySelector('[data-testid="canvas"]') as HTMLElement | null)?.getBoundingClientRect() ?? null;
  const inside = (event: DragEvent): { x: number; y: number } | null => {
    const rect = frame();
    if (!rect || rect.width === 0 || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null;
    return { x: Math.round(((event.clientX - rect.left) / rect.width - 0.5) * canvas.width), y: Math.round(((event.clientY - rect.top) / rect.height - 0.5) * canvas.height) };
  };
  const over = (event: DragEvent) => { if (!(event.dataTransfer?.types ?? []).includes(PAYLOAD) || !dragged || !accept(dragged) || !inside(event)) return; event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; };
  const dropped = (event: DragEvent) => {
    const payload = event.dataTransfer?.getData(PAYLOAD) || dragged, point = inside(event);
    if (!payload || !point || !accept(payload)) return;
    event.preventDefault(); event.stopPropagation();
    drop(payload, point);
  };
  window.addEventListener("dragstart", start); window.addEventListener("dragend", end);
  player.addEventListener("dragover", over); player.addEventListener("drop", dropped);
  return () => { window.removeEventListener("dragstart", start); window.removeEventListener("dragend", end); player.removeEventListener("dragover", over); player.removeEventListener("drop", dropped); };
}
export type SoundPreview = { stop(): void; play?(): void };
/** Plays a sound file through the page's audio output; `onEnd(true)` when it cannot be played. */
export function playSound(url: string, volume: number, events: { onProgress(fraction: number): void; onEnd(failed: boolean): void }): SoundPreview {
  const audio = new Audio(url);
  let done = false;
  const finish = (failed: boolean) => { if (done) return; done = true; audio.pause(); events.onEnd(failed); };
  audio.volume = Math.min(1, Math.max(0, volume));
  audio.addEventListener("timeupdate", () => { if (audio.duration > 0) events.onProgress(audio.currentTime / audio.duration); });
  audio.addEventListener("ended", () => finish(false));
  audio.addEventListener("error", () => finish(true));
  audio.play().catch(() => finish(true));
  return { stop: () => finish(false) };
}
/** Plays a signed remote stream through MediaSource. The first appended bytes can start playback before EOF. */
export function playStreamSound(stream: ReadableStream<Uint8Array>, mime: string, volume: number, events: { onProgress(fraction: number): void; onEnd(failed: boolean): void }): SoundPreview {
  const audio = new Audio(), source = new MediaSource(), url = URL.createObjectURL(source);
  let done = false, stopped = false, reader: ReadableStreamDefaultReader<Uint8Array> | null = null, buffer: SourceBuffer | null = null;
  const finish = (failed: boolean) => { if (done) return; done = true; audio.pause(); if (failed) void reader?.cancel(); URL.revokeObjectURL(url); events.onEnd(failed); };
  audio.src = url; audio.volume = Math.min(1, Math.max(0, volume));
  audio.addEventListener("timeupdate", () => { if (audio.duration > 0) events.onProgress(audio.currentTime / audio.duration); });
  // EOF only closes the MediaSource input. The audio element can still have buffered audio to play; it owns
  // playback completion and replay, so never pause it when the network download finishes.
  audio.addEventListener("ended", () => { stopped = true; events.onEnd(false); }); audio.addEventListener("error", () => finish(true));
  const append = (bytes: Uint8Array) => new Promise<void>((resolve, reject) => {
    if (!buffer) return reject(new Error("No audio source buffer"));
    const complete = () => { buffer?.removeEventListener("updateend", complete); buffer?.removeEventListener("error", fail); resolve(); }, fail = () => { buffer?.removeEventListener("updateend", complete); buffer?.removeEventListener("error", fail); reject(new Error("The audio buffer rejected a chunk")); };
    buffer.addEventListener("updateend", complete, { once: true }); buffer.addEventListener("error", fail, { once: true });
    try { buffer.appendBuffer(bytes as unknown as ArrayBuffer); } catch (error) { fail(); reject(error); }
  });
  const pump = async () => {
    try {
      reader = stream.getReader();
      for (;;) {
        const next = await reader.read();
        if (next.done) {
          if (source.readyState === "open" && !buffer?.updating) source.endOfStream();
          reader.releaseLock();
          return;
        }
        await append(next.value);
        if (!done && !stopped && audio.paused) void audio.play().catch(() => finish(true));
      }
    } catch { finish(true); }
  };
  source.addEventListener("sourceopen", () => {
    try {
      const supported = typeof MediaSource.isTypeSupported !== "function" || MediaSource.isTypeSupported(mime);
      if (!supported) throw new Error("Unsupported audio stream");
      buffer = source.addSourceBuffer(mime); void pump();
    } catch { finish(true); }
  }, { once: true });
  // Stopping playback leaves the in-flight stream consuming to EOF. If the person then adds this track, the bytes
  // already fetched for preview make its file; no second request or host blob is needed.
  return {
    stop: () => { if (done || stopped) return; stopped = true; audio.pause(); events.onEnd(false); },
    play: () => {
      if (done) return;
      stopped = false;
      if (audio.ended) audio.currentTime = 0;
      void audio.play().catch(() => finish(true));
    },
  };
}
export function saveTextFile(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime })), link = document.createElement("a");
  link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export const readTextFile = (file: { text(): Promise<string> }): Promise<string> => file.text();
export async function copyText(text: string): Promise<boolean> { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }
/** `x`, `y` are relative to the handle (which may move while it is dragged); `clientX`, `clientY` to the viewport. */
export type HandleDrag = { x: number; y: number; clientX: number; clientY: number; shift: boolean };
/** A small handle drawn over a clip (the volume line, a beat dot): its drag and double-click are its own and never start a gesture of the clip under it. */
export function bindHandle(node: unknown, handlers: { down(info: HandleDrag): { move(info: HandleDrag): void; up(info: HandleDrag): void; cancel?(): void } | null; double?(info: HandleDrag): void }): () => void {
  const element = node as HTMLElement | null;
  if (!element?.addEventListener) return () => {};
  let session: { move(info: HandleDrag): void; up(info: HandleDrag): void; cancel?(): void } | null = null, pointer = -1;
  const info = (event: MouseEvent): HandleDrag => { const rect = element.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top, clientX: event.clientX, clientY: event.clientY, shift: event.shiftKey }; };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || session) return;
    event.stopPropagation();
    session = handlers.down(info(event)); pointer = event.pointerId;
    if (session) { try { element.setPointerCapture(pointer); } catch { /* a synthetic pointer has nothing to capture */ } event.preventDefault(); }
  };
  const move = (event: PointerEvent) => { if (session && event.pointerId === pointer) { event.stopPropagation(); session.move(info(event)); } };
  const finish = (event: PointerEvent, cancelled: boolean) => {
    if (!session || event.pointerId !== pointer) return;
    const ended = session;
    session = null; event.stopPropagation();
    try { element.releasePointerCapture(pointer); } catch { /* already released */ }
    if (cancelled) ended.cancel?.(); else ended.up(info(event));
  };
  const up = (event: PointerEvent) => finish(event, false), cancel = (event: PointerEvent) => finish(event, true);
  const double = (event: MouseEvent) => { event.stopPropagation(); handlers.double?.(info(event)); };
  const quiet = (event: Event) => event.stopPropagation();
  element.addEventListener("pointerdown", down); element.addEventListener("pointermove", move); element.addEventListener("pointerup", up); element.addEventListener("pointercancel", cancel);
  element.addEventListener("dblclick", double); element.addEventListener("mousedown", quiet); element.addEventListener("click", quiet);
  return () => {
    element.removeEventListener("pointerdown", down); element.removeEventListener("pointermove", move); element.removeEventListener("pointerup", up); element.removeEventListener("pointercancel", cancel);
    element.removeEventListener("dblclick", double); element.removeEventListener("mousedown", quiet); element.removeEventListener("click", quiet);
  };
}
/** Tells which timeline clip the pointer is over (its element id), or `null`; a handle drawn over a clip counts as its clip. */
export function bindClipHover(onHover: (elementId: string | null) => void): () => void {
  let current: string | null = null;
  const move = (event: PointerEvent) => {
    // What the content capabilities draw over a clip (its volume line, its beats) is not inside the clip's own box: every box under the pointer is asked.
    const node = document.elementsFromPoint(event.clientX, event.clientY).map((entry) => entry.closest('[id^="clip-"], [id^="fade-in-"], [id^="fade-out-"]')).find((entry) => entry !== null);
    const next = node ? node.id.replace(/^(clip|fade-in|fade-out)-/, "") : null;
    if (next !== current) { current = next; onHover(next); }
  };
  document.addEventListener("pointermove", move, { passive: true });
  return () => document.removeEventListener("pointermove", move);
}
/** The decoded sound of a media file, as two channels at 48 kHz; `null` when the browser cannot decode it. */
export async function decodeSound(url: string): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number } | null> {
  try {
    const bytes = await (await fetch(url)).arrayBuffer();
    const context = new OfflineAudioContext(2, 48_000, 48_000), buffer = await context.decodeAudioData(bytes);
    const left = buffer.getChannelData(0), right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    return { left, right, sampleRate: buffer.sampleRate };
  } catch { return null; }
}

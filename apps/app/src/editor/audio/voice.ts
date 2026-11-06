import { timeline } from "@jagentchill/editor-core";

/** A command that inserts a voiceover take: the elements it adds are flagged Voice in the same step, so tracks with ducking lower under them. */
export function asVoice<I>(command: timeline.TimelineCommand<I>): timeline.TimelineCommand<I> {
  return {
    ...command,
    run(draft, env) {
      const outcome = command.run(draft, env);
      const added = new Set(outcome?.selection ?? []);
      for (const scene of draft.scenes) for (const track of scene.tracks.audio) for (const element of track.elements as unknown as { id: string; type: string; isVoice?: boolean }[]) if (added.has(element.id) && element.type === "audio") element.isVoice = true;
      return outcome;
    },
  };
}

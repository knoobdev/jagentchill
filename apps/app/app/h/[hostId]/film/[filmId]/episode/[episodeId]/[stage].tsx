import { useLocalSearchParams } from "expo-router";
import { FilmStudio } from "../../../../../../../src/film/FilmStudio";

/** The studio of a film at one of its stages: story, assets, storyboard, voice, timeline. */
export default function FilmStage() {
  const params = useLocalSearchParams<{ hostId: string; filmId: string; episodeId: string; stage: string; idea?: string }>();
  return <FilmStudio key={params.filmId} filmId={params.filmId} stage={params.stage} idea={params.idea === "1"} />;
}

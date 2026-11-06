import { Redirect, useLocalSearchParams } from "expo-router";
import { filmRoute } from "../../../../../src/film/strings";

/** A film opens on its Story stage. */
export default function Film() {
  const params = useLocalSearchParams<{ hostId: string; filmId: string }>();
  return <Redirect href={filmRoute(params.hostId, params.filmId) as never} />;
}

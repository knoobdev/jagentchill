import { Redirect } from "expo-router";
import { isLibraryCategory, PREFS } from "@jagentchill/app-core";
import { getPref } from "../../src/state";

/** `/library` opens the last visited category; Templates the first time. */
export default function Library() {
  const last = getPref(PREFS.libraryCategory);
  return <Redirect href={`/library/${isLibraryCategory(last) ? last : "templates"}` as never} />;
}

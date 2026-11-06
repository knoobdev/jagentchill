import { useLocalSearchParams } from "expo-router";
import { isLibraryCategory } from "@jagentchill/app-core";
import { NotFoundScreen } from "../../src/shell/NotFound";
import { LibraryScreen } from "../../src/library/LibraryScreen";

export default function LibraryCategoryRoute() {
  const { category } = useLocalSearchParams<{ category: string }>();
  if (!isLibraryCategory(category)) return <NotFoundScreen />;
  return <LibraryScreen category={category} />;
}

import { usePathname, useRouter } from "expo-router";
import { destinationById, matchRoute, sectionOf } from "@jagentchill/app-core";
import { EmptyState } from "@jagentchill/ui";
import { useT } from "../locale";
import { Screen, useHostScopeState } from "./Shell";

/** Unknown routes. A host-scoped route first says whether its host is paired and connected. */
export function NotFoundScreen() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const section = destinationById(sectionOf(pathname));
  const hostScoped = /^\/h\/[^/]+\//.test(pathname) && matchRoute(pathname) !== null;
  const state = useHostScopeState(t(section?.label ?? "Page not found"));
  const scope = hostScoped ? state : null;
  return (
    <Screen title={hostScoped && section ? t(section.label) : t("Page not found")}>
      {scope ?? <EmptyState icon="search" title={t("Page not found")} description={t("There is no screen at this address.")} actions={[{ label: t("Go home"), kind: "strong", onPress: () => router.replace("/home") }]} />}
    </Screen>
  );
}

import { useEffect, useSyncExternalStore } from "react";
import { View } from "react-native";
import { Banner, space, useToast } from "@jagentchill/ui";
import { useT } from "../locale";
import { webUpdate } from "./webUpdate";

/** "Reload" of the notice and of Settings ▸ Updates: when it is refused, a message says why. */
export function useReloadToUpdate(): () => void {
  const t = useT();
  const toast = useToast();
  return () => void webUpdate.reload().then((result) => {
    if (result === "export") toast.show({ kind: "info", message: t("An export is running. Reload when it has finished.") });
    if (result === "unsaved") toast.show({ kind: "info", message: t("Your changes are not saved yet. Reload when they are saved.") });
  });
}

/** The browser build's update notice: a newer build is ready and waits for "Reload". Nothing is drawn anywhere else. */
export function WebUpdateNotice() {
  const t = useT();
  const reload = useReloadToUpdate();
  const update = useSyncExternalStore(webUpdate.subscribe, webUpdate.getState, webUpdate.getState);
  useEffect(() => { void webUpdate.start(); }, []);
  if (!update.waiting) return null;
  return (
    <View testID="web-update-notice" style={{ position: "absolute", bottom: space[4], alignSelf: "center", zIndex: 190 }}>
      <Banner id="web-update" tone="info" actions={[{ label: t("Reload"), onPress: reload }]}>{t("A new version is available")}</Banner>
    </View>
  );
}

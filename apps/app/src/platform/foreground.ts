import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { isForeground } from "./foreground-logic";

/** True only while React Native considers the application active. */
export function useForegroundActive(): boolean {
  const [active, setActive] = useState(() => isForeground(AppState.currentState));
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setActive(isForeground(state)));
    return () => subscription.remove();
  }, []);
  return active;
}

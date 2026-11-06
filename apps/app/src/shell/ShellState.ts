import { createContext, useContext } from "react";
import { carryThroughPortals } from "@jagentchill/ui";

export type ShellState = {
  /** Opens the requires-host sheet naming a feature. */
  requireHost(feature?: string): void;
  openDrawer(): void;
  openSearch(): void;
  sidebarShown: boolean;
  toggleSidebar(): void;
  /** Shows the "Get started" card again (Help ▸ Starter tips). */
  showStarterTips(): void;
  focusMode: boolean;
  setFocusMode(on: boolean): void;
};

export const ShellContext = createContext<ShellState | null>(null);
carryThroughPortals(ShellContext);

export function useShell(): ShellState {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("useShell needs the app shell");
  return shell;
}

/** The requires-host sheet is opened by any gated control of the design system, through this handle. */
export const requiresHostHandle: { open: ((feature?: string) => void) | null } = { open: null };

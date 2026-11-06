import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { PREFS, startupRoute } from "@jagentchill/app-core";
import { getPref } from "../src/state";
import { desktop } from "../src/platform/desktop";
import JoinTailnet from "./join-tailnet";

/** Startup routing: the last visited route of this window when it is still a route, otherwise Home. */
export default function Start() {
  const [mode, setMode] = useState<"tailscale" | "local" | null | "checking" | "needs-sign-in">(desktop() ? "checking" : null);
  useEffect(() => {
    const shell = desktop();
    if (!shell) return;
    void shell.connectionMode.get().then(async (saved) => {
      if (saved !== "tailscale") { setMode(saved); return; }
      try { setMode((await shell.tailnet.getStatus()).connected ? "tailscale" : "needs-sign-in"); }
      catch { setMode("needs-sign-in"); }
    }, () => setMode(null));
  }, []);
  if (mode === "checking") return null;
  if (desktop() && (mode === null || mode === "needs-sign-in")) return <JoinTailnet />;
  const route = startupRoute({ welcomeSeen: true, lastRoute: getPref(PREFS.lastRoute) });
  return <Redirect href={route as never} />;
}

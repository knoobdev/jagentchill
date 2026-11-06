// Expo Router calls this for both the launch URL and URL events while the app is running. The URL's fragment is not
// routed to a screen, so move only JAgentChill pair offers to the paste-link route.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const url = new URL(path, "jagentchill://app");
    const customScheme = url.protocol === "jagentchill:";
    const relativePath = !/^[a-z][a-z0-9+.-]*:/i.test(path);
    const isPairLink = customScheme && (url.hostname === "pair" || url.pathname === "/pair" || url.pathname.endsWith("/pair"))
      || relativePath && (url.pathname === "/pair" || url.pathname.endsWith("/pair"));
    if (!isPairLink) return path;
    const offer = url.searchParams.get("offer") ?? new URLSearchParams(url.hash.replace(/^#/, "")).get("offer");
    return offer ? `/pair-link?offer=${encodeURIComponent(offer)}` : path;
  } catch {
    return path;
  }
}

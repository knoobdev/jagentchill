import { WebUpdateNotice } from "./WebUpdateNotice";

/**
 * The desktop-only surfaces (library folder dialogs, host status, native menu wiring). A browser and the mobile apps
 * have none; a browser build has its update notice here, where the desktop app has its own.
 */
export function DesktopShell() { return <WebUpdateNotice />; }

/**
 * The IPC channels of the desktop shell: the whole surface between the renderer and the Electron main process. A
 * channel that is not in this list has no handler; the preload script exposes one typed method per entry and nothing
 * generic. This file imports nothing, so the preload script can carry it.
 */
export const DESKTOP_BRIDGE_VERSION = 1;
export const DESKTOP_CHANNELS = [
  "app.info", "app.relaunch", "app.quit",
  "window.minimize", "window.maximize", "window.close", "window.setFullscreen", "window.new", "window.state", "window.controls", "window.setUiScale",
  "window.setChrome", "window.setRoute", "window.claimProject", "window.releaseProject",
  "gateway.status", "gateway.start", "gateway.stop", "gateway.restart", "gateway.doctor", "gateway.openLogs", "gateway.getNetworkAccess",
  "gateway.setNetworkAccess", "gateway.restoreAdmin", "gateway.setEnabled", "gateway.resolveKeyStorage", "gateway.getLegacyIdentityRecovery", "gateway.retryLegacyIdentity", "gateway.setPort", "gateway.resetConfiguration",
  "connectionMode.get", "connectionMode.set",
  "tailnet.getStatus", "tailnet.getProxyCredentials", "tailnet.startLogin", "tailnet.logout", "tailnet.openProxy", "tailnet.closeProxy",
  "library.call", "library.readRange", "library.uploadOpen", "library.uploadWrite", "library.uploadAbort", "library.status", "library.locate", "library.createHere",
  "library.retry", "library.chooseMoveTarget", "library.move", "library.cancelMove", "library.rebuildIndex", "library.release",
  "files.openDialog", "files.saveDialog", "files.reveal", "files.read", "files.stat", "files.exportOpen", "files.exportWrite", "files.exportFinish", "files.exportAbort",
  "files.relink", "files.grant", "files.revokeGrant", "files.registerDropped", "files.expandDrop", "files.freeSpace", "files.startDrag", "files.ready",
  "device.getPublicKey", "device.sign", "device.beginEnrolment", "device.endEnrolment", "device.enrolmentPost",
  "secureStore.get", "secureStore.set", "secureStore.delete", "secureStore.keys",
  "notifications.show", "notifications.setBadge", "notifications.requestAttention", "notifications.permission", "notifications.openSystemSettings",
  "updates.state", "updates.check", "updates.download", "updates.reveal", "updates.install", "updates.remindLater", "updates.setOptions", "updates.setBlockers",
  "menu.model", "menu.setState", "menu.invoke",
  "deepLinks.ready",
  "capabilities.get", "capabilities.report", "power.block", "power.unblock",
  "background.get", "background.set", "background.setWork", "device.rotate",
] as const;
export type DesktopChannel = (typeof DESKTOP_CHANNELS)[number];
/** Messages the main process pushes to a window. */
export const DESKTOP_EVENTS = [
  "window.state", "gateway.status", "library.status", "library.moveProgress", "library.changed", "files.open", "deepLinks.link", "notifications.activated", "updates.state",
  "menu.model", "menu.invoke", "media.key", "capabilities.gpuFallback", "background.state", "identity.legacyRecovery",
] as const;
export type DesktopEvent = (typeof DESKTOP_EVENTS)[number];
export const desktopChannelName = (channel: DesktopChannel | DesktopEvent): string => `jagentchill:${channel}`;

/** How a failed bridge call reaches the renderer: a code it can act on, never a stack or a path it did not give. */
export type DesktopError = { code: string; message: string; kind?: string; details?: Record<string, unknown> };
export type DesktopReply<T = unknown> = { ok: true; value: T } | { ok: false; error: DesktopError };

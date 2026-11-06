import { z } from "zod";
import { DESKTOP_CHANNELS, type DesktopChannel } from "./desktop-channels.ts";
import { GATEWAY_ID_PATTERN } from "./identity.ts";

export * from "./desktop-channels.ts";

const none = z.tuple([]);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const token = z.string().regex(/^[0-9a-f]{32}$/);
const bytes = z.instanceof(Uint8Array);
const route = z.string().max(2048).regex(/^\/[\x21-\x7e]*$/);
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const purpose = z.enum(["import-media", "open-project", "import-project", "export", "export-package", "library", "relink", "lut", "font", "subtitle", "keys", "any"]);
const filter = z.object({ name: z.string().max(64), extensions: z.array(z.string().regex(/^[A-Za-z0-9*]{1,16}$/)).max(64) }).strict();

export const hostRecordSchema = z.object({
  gatewayId: z.string().regex(GATEWAY_ID_PATTERN), gatewayPublicKey: z.string().max(64), gatewayName: z.string().max(128),
  origin: z.string().max(255).regex(/^https?:\/\//), role: z.enum(["admin", "editor", "viewer"]),
  deviceToken: z.object({ value: z.string().max(128), expires_ms: z.number().int().nonnegative() }).strict(),
  verifiedClockOffset_ms: z.number().finite(),
  tlsSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(), builtIn: z.boolean().optional(),
}).strict();
export type DesktopHostRecord = z.infer<typeof hostRecordSchema>;

export const networkLevelSchema = z.enum(["this-computer", "tailnet", "lan"]);
export type NetworkLevel = z.infer<typeof networkLevelSchema>;

/** The key of a value in the protected store: `host/<gatewayId>` holds a host record; other keys are free-form text. */
const secureKey = z.string().regex(/^[a-z][a-z0-9-]*(\/[A-Za-z0-9_-]{1,64})?$/).max(96);

const menuState = z.object({
  recent: z.array(z.object({ id, name: z.string().max(256) }).strict()).max(10).optional(),
  layouts: z.array(z.object({ id, label: z.string().max(64) }).strict()).max(32).optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
  enabled: z.record(z.string().max(64), z.boolean()).optional(), checked: z.record(z.string().max(64), z.boolean()).optional(),
  hints: z.record(z.string().max(64), z.string().max(32)).optional(), editorForeground: z.boolean().optional(), locale: z.string().max(16).optional(),
  labels: z.record(z.string().max(64), z.string().max(96)).optional(),
}).strict();

/** The arguments of every channel. A call whose arguments do not parse is rejected before any handler runs. */
export const DESKTOP_CHANNEL_ARGS: Record<DesktopChannel, z.ZodTypeAny> = {
  "app.info": none, "app.relaunch": none, "app.quit": none,
  "window.minimize": none, "window.maximize": none, "window.close": none, "window.setFullscreen": z.tuple([z.boolean()]), "window.new": z.tuple([route.optional()]),
  "window.state": none, "window.controls": none, "window.setUiScale": z.tuple([z.number().min(0.8).max(1.5)]),
  "window.setChrome": z.tuple([z.object({ background: colour, text: colour, scheme: z.enum(["light", "dark"]) }).strict()]),
  "window.setRoute": z.tuple([route]), "window.claimProject": z.tuple([id]), "window.releaseProject": z.tuple([id]),
  "gateway.status": none, "gateway.start": none, "gateway.stop": none, "gateway.restart": none, "gateway.doctor": none, "gateway.openLogs": none,
  "gateway.getNetworkAccess": none, "gateway.setNetworkAccess": z.tuple([z.object({ level: networkLevelSchema, alsoLan: z.boolean().optional(), alsoTailnet: z.boolean().optional() }).strict()]),
  "gateway.restoreAdmin": z.tuple([z.object({ confirmation: z.string().max(32) }).strict()]), "gateway.setEnabled": z.tuple([z.boolean()]),
  "gateway.resolveKeyStorage": z.tuple([z.enum(["retry", "file", "cancel", "move-to-store"]), z.object({ confirmed: z.boolean() }).strict().optional()]),
  "gateway.getLegacyIdentityRecovery": none, "gateway.retryLegacyIdentity": none,
  "gateway.setPort": z.tuple([z.number().int().min(1024).max(65514)]), "gateway.resetConfiguration": z.tuple([z.object({ confirmation: z.string().max(32) }).strict()]),
  "connectionMode.get": none, "connectionMode.set": z.tuple([z.enum(["tailscale", "local"]).nullable()]),
  "tailnet.getStatus": none, "tailnet.getProxyCredentials": none, "tailnet.startLogin": z.tuple([z.object({ mode: z.enum(["interactive", "authKey"]), authKey: z.string().max(256).optional() }).strict()]),
  "tailnet.logout": none, "tailnet.openProxy": z.tuple([z.object({ gatewayId: z.string().regex(GATEWAY_ID_PATTERN) }).strict()]),
  "tailnet.closeProxy": z.tuple([z.object({ proxyId: id }).strict()]),
  "library.call": z.tuple([z.string().max(48), z.array(z.unknown()).max(6)]),
  "library.readRange": z.tuple([z.string().max(48), z.array(z.unknown()).max(3), z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict()]),
  "library.uploadOpen": none, "library.uploadWrite": z.tuple([token, bytes]), "library.uploadAbort": z.tuple([token]),
  "library.status": none, "library.locate": none, "library.createHere": none, "library.retry": none, "library.chooseMoveTarget": none,
  "library.move": z.tuple([token]), "library.cancelMove": none, "library.rebuildIndex": none, "library.release": z.tuple([token]),
  "files.openDialog": z.tuple([z.object({ purpose, multiple: z.boolean().optional(), directory: z.boolean().optional(), filters: z.array(filter).max(16).optional(), title: z.string().max(128).optional() }).strict()]),
  "files.saveDialog": z.tuple([z.object({ purpose, defaultName: z.string().max(255).regex(/^[^/\\\u0000]+$/), filters: z.array(filter).max(16).optional(), title: z.string().max(128).optional() }).strict()]),
  "files.reveal": z.tuple([z.union([token, z.enum(["logs", "library", "configuration"])])]),
  "files.read": z.tuple([token, z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict()]),
  "files.stat": z.tuple([token]),
  "files.exportOpen": z.tuple([token, z.object({ estimatedBytes: z.number().int().nonnegative().optional() }).strict().optional()]),
  "files.exportWrite": z.tuple([token, bytes]), "files.exportFinish": z.tuple([token]), "files.exportAbort": z.tuple([token]),
  "files.relink": z.tuple([z.object({ projectId: id, assetId: id, name: z.string().max(255) }).strict()]),
  "files.grant": z.tuple([z.object({ projectId: id, assetId: id, token }).strict()]), "files.revokeGrant": z.tuple([token]),
  "files.registerDropped": z.tuple([z.array(z.string().max(4096)).max(4096)]), "files.expandDrop": z.tuple([z.array(token).max(4096)]),
  "files.freeSpace": z.tuple([token.optional()]), "files.startDrag": z.tuple([z.union([token, z.object({ projectId: id, assetId: id }).strict()])]), "files.ready": none,
  "device.getPublicKey": none, "device.sign": z.tuple([z.unknown()]), "device.beginEnrolment": z.tuple([z.string().max(2048), z.string().max(255), z.object({ port: z.number().int().min(1).max(65535), secret: z.string().min(40).max(128) }).strict().optional()]), "device.endEnrolment": none,
  // The renderer names one enrolment step and its JSON body; MAIN chooses the origin from the active offer and relays it.
  "device.enrolmentPost": z.tuple([z.string().max(64), z.string().max(16384)]),
  "secureStore.get": z.tuple([secureKey]), "secureStore.set": z.tuple([secureKey, z.string().max(65536)]), "secureStore.delete": z.tuple([secureKey]),
  "secureStore.keys": z.tuple([z.string().regex(/^[a-z][a-z0-9-]*\/?$/).max(32)]),
  "notifications.show": z.tuple([z.object({ id: z.string().max(96), kind: z.string().max(64), title: z.string().max(256), body: z.string().max(1024).optional(), route: route.optional(), actions: z.array(z.object({ id, label: z.string().max(48) }).strict()).max(3).optional() }).strict()]),
  "notifications.setBadge": z.tuple([z.number().int().min(0).max(9999)]), "notifications.requestAttention": none, "notifications.permission": none, "notifications.openSystemSettings": none,
  "updates.state": none, "updates.check": none, "updates.download": none, "updates.reveal": none, "updates.install": none, "updates.remindLater": none,
  "updates.setOptions": z.tuple([z.object({ autoCheck: z.boolean().optional(), autoDownload: z.boolean().optional() }).strict()]),
  "updates.setBlockers": z.tuple([z.object({ unsavedProjects: z.number().int().min(0), runningExports: z.number().int().min(0), runningJobs: z.number().int().min(0), openTerminals: z.number().int().min(0), recording: z.boolean() }).strict()]),
  "menu.model": none, "menu.setState": z.tuple([menuState]), "menu.invoke": z.tuple([z.string().max(160)]),
  "deepLinks.ready": none,
  "background.get": none, "background.set": z.tuple([z.object({ keepInTray: z.boolean().optional(), launchAtLogin: z.boolean().optional(), keepHostAfterQuit: z.boolean().optional() }).strict()]),
  // What is running on this computer, as the windows know it: the quit dialog, the tray and the update restart read it.
  "background.setWork": z.tuple([z.object({ exports: z.array(z.object({ id: z.string().max(96), title: z.string().max(160), percent: z.number().min(0).max(100).optional(), route: route.optional() }).strict()).max(64), jobs: z.array(z.object({ id: z.string().max(96), title: z.string().max(160), percent: z.number().min(0).max(100).optional(), route: route.optional() }).strict()).max(64), attention: z.array(z.object({ id: z.string().max(96), title: z.string().max(160), percent: z.number().min(0).max(100).optional(), route: route.optional() }).strict()).max(64), unsavedProjects: z.number().int().min(0).max(999) }).strict()]),
  "device.rotate": none,
  "capabilities.get": none, "capabilities.report": z.tuple([z.record(z.string().max(48), z.unknown())]), "power.block": z.tuple([z.enum(["export", "render"])]), "power.unblock": z.tuple([z.enum(["export", "render"])]),
};

export const isDesktopChannel = (name: string): name is DesktopChannel => (DESKTOP_CHANNELS as readonly string[]).includes(name);

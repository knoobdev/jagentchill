import { preference } from "../shell/prefs.ts";
import { isRefList, isRefOrNull, type DefaultSend } from "./models.ts";
import type { ModelRef } from "@jagentchill/protocol";

const isStringMap = (value: unknown): value is Record<string, string> => value !== null && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((entry) => typeof entry === "string");
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

/** What the composer and the model browser remember on this device. None of it is synced: the host knows neither favourites nor recents. */
export const AGENT_PREFS = {
  modelFavourites: preference<ModelRef[]>("agents.models.favourites", [], isRefList),
  modelRecents: preference<ModelRef[]>("agents.models.recents", [], isRefList),
  /** The model a new draft starts on. */
  draftModel: preference<ModelRef | null>("agents.models.draft", null, isRefOrNull),
  /** `<runtimeId>/<providerId>/<modelId>` → thinking option id. */
  thinkingByModel: preference<Record<string, string>>("agents.thinking", {}, isStringMap),
  /** `<runtimeId>` → mode id; the unattended mode is never stored. */
  modeByRuntime: preference<Record<string, string>>("agents.mode", {}, isStringMap),
  defaultSend: preference<DefaultSend>("agents.send.default", "steer", (value): value is DefaultSend => value === "steer" || value === "interrupt" || value === "queue"),
  /** "Don't ask again on this device" of the runtime-switch confirmation. */
  switchConfirmed: preference<boolean>("agents.switch.confirmed", false, isBoolean),
  /** The composer's "make pictures on this computer" switch: on, what this device sends goes to the local picture model as written. */
  localImage: preference<boolean>("agents.pictures.local", false, isBoolean),
  workspaceTab: preference<string>("agents.workspace.tab", "timeline", (value): value is string => typeof value === "string"),
  workspaceShown: preference<boolean>("agents.workspace.shown", true, isBoolean),
};

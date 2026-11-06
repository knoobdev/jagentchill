import { resolve } from "node:path";

/** Refuses unattended Electron launches that would use the installed app's default user profile. */
export function refusesUnattendedDefaultProfile(input: { unattended: boolean; userData: string; defaultUserData: string }): boolean {
  return input.unattended && resolve(input.userData) === resolve(input.defaultUserData);
}

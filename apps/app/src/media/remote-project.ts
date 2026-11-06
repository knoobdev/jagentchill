export type RemoteProjectSync = {
  record(projectId: string): Promise<{ hostId: string; enabled: boolean } | null>;
  enable(projectId: string): Promise<unknown>;
};

/** Host media import and render RPCs address the synchronized project, not the device-only draft. */
export async function ensureRemoteProject(projectId: string, hostId: string, sync: RemoteProjectSync | null | undefined): Promise<void> {
  if (!sync) throw new Error("Project sync is unavailable.");
  const record = await sync.record(projectId);
  if (!record?.enabled || record.hostId !== hostId) await sync.enable(projectId);
  const current = await sync.record(projectId);
  if (!current?.enabled || current.hostId !== hostId) throw new Error("The project was not synced to the host.");
}

export const SCOPES = [
  "jagentchill.projects.read", "jagentchill.projects.write", "jagentchill.media.read", "jagentchill.media.write",
  "jagentchill.agent.use", "jagentchill.generation.run", "jagentchill.export.run", "jagentchill.comments.write",
  "jagentchill.config.read", "jagentchill.config.write", "jagentchill.devices.manage", "jagentchill.secrets.manage",
  "jagentchill.host.exec",
] as const;
export type Scope = (typeof SCOPES)[number];

export const ROLES = ["admin", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** A role maps to JAgentChill scopes and to nothing else. */
export const ROLE_SCOPES: Record<Role, readonly Scope[]> = {
  admin: SCOPES,
  editor: [
    "jagentchill.projects.read", "jagentchill.projects.write", "jagentchill.media.read", "jagentchill.media.write",
    "jagentchill.agent.use", "jagentchill.generation.run", "jagentchill.export.run", "jagentchill.comments.write",
    "jagentchill.config.read",
  ],
  viewer: ["jagentchill.projects.read", "jagentchill.media.read", "jagentchill.comments.write", "jagentchill.config.read"],
};

export const PLATFORMS = ["ios", "android", "macos", "windows", "linux", "web"] as const;
export type Platform = (typeof PLATFORMS)[number];

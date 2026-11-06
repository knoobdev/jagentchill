import { z } from "zod";

/** The closed notification catalogue. Features choose one of these names; they do not invent new categories. */
export const NOTIFICATION_KINDS = [
  "agent.approval_required", "agent.question", "agent.plan_ready", "agent.proposal_ready", "agent.handoff_pending", "agent.dissent_escalated", "agent.finished", "agent.failed",
  "script.review_required", "script.changes_requested", "script.approved", "script.proposal_ready",
  "workflow.approval_required", "workflow.paused", "workflow.finished", "workflow.failed", "workflow.notify", "workflow.review_required",
  "film.step_review_required", "film.step_finished", "film.step_failed", "generation.batch_finished", "generation.failed", "export.finished", "export.failed",
  "pairing.request", "pairing.lockout", "device.revoked", "device.key_rotated", "host.tailnet_expired", "sync.conflict", "sync.edit_requested", "sync.edit_taken",
  "usage.threshold_reached", "usage.limit_reached", "storage.low_space", "storage.quota_exceeded",
  "automation.run_finished", "automation.run_failed", "automation.waiting", "automation.disabled",
  "workspace.archive_pending", "terminal.finished", "terminal.needs_input", "provider.auth_expiring", "provider.auth_refresh_failed", "provider.auth_expired", "provider.endpoint_unhealthy",
  "update.available", "update.ready", "changelog.new_version",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);
export const notificationCategorySchema = z.enum(["agent", "script", "workflow", "film", "generation", "export", "device", "sync", "usage", "storage", "automation", "workspace", "terminal", "provider", "update"]);
export const notificationSubjectSchema = z.object({
  type: z.enum(["session", "agent-run", "script", "workflow-run", "film", "project", "export", "device", "automation", "workspace", "terminal", "provider", "host", "app"]),
  id: z.string().min(1).max(256),
  hostId: z.string().min(1).max(128).optional(),
}).strict();
export const notificationSchema = z.object({
  id: z.string().min(1).max(128), kind: notificationKindSchema, category: notificationCategorySchema,
  severity: z.enum(["info", "success", "warning", "error"]), requiresAction: z.boolean(),
  title: z.string().min(1).max(80), body: z.string().max(240), subject: notificationSubjectSchema,
  route: z.string().min(1).max(1000),
  actions: z.array(z.object({ id: z.string().min(1).max(80), label: z.string().min(1).max(80), intent: z.string().min(1).max(120) }).strict()).max(2).optional(),
  automationId: z.string().min(1).max(128).optional(), requestId: z.string().min(1).max(128).optional(),
  targetDeviceIds: z.array(z.string().min(1).max(128)).max(100).optional(), created_ms: z.number().int().nonnegative(),
  read_ms: z.number().int().nonnegative().optional(), resolved_ms: z.number().int().nonnegative().optional(), source: z.enum(["device", "host"]),
  dedupeKey: z.string().min(1).max(512),
}).strict();
export type NotificationRecord = z.infer<typeof notificationSchema>;

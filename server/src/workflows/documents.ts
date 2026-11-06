import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { workflow as wf } from "@jagentchill/editor-core";
import { WORKFLOW_LIMITS, type ErrorCode, type WorkflowDocument, type WorkflowListItem, type WorkflowOp, type WorkflowRunStatus } from "@jagentchill/protocol";
import { ProtocolError } from "../errors.ts";
import { transaction } from "../store/database.ts";

export type WorkflowActor = { kind: "device" | "agent" | "system"; deviceId?: string; sessionKey?: string; runId?: string };
export type AppliedBatch = { workflowId: string; revision: number; baseRevision: number; batchId: string; label: string; actor: WorkflowActor; ops: Array<WorkflowOp & { index: number }>; graphHash: string; applied_ms: number };
export type DocumentEvents = { ops(batch: AppliedBatch): void; changed(workflowId: string, what: "created" | "updated" | "deleted"): void };
type Row = { workflow_id: string; name: string; revision: number; json: string; problems: number; created_ms: number; updated_ms: number; deleted_ms: number | null };

const FILE_FORMAT = "jagentchill.workflow.file";
const FILE_MAX_BYTES = 4 * 1024 * 1024;
const REVISIONS_KEPT = WORKFLOW_LIMITS.revisions;
const newId = (prefix: string): string => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;

/** A refusal of the workflow library as the wire error it is. */
export function wireError(error: unknown): never {
  if (error instanceof wf.WorkflowError) throw new ProtocolError(error.code as ErrorCode, error.message, { details: error.details });
  throw error;
}

/** Workflow documents of the host: the head of each, its revisions, and the per-object rebase of a batch based on an older revision. */
export function createWorkflowDocuments(deps: { db: DatabaseSync; now: () => number; events: DocumentEvents }) {
  const { db, now } = deps;
  const row = (id: string): Row | undefined => db.prepare("SELECT * FROM workflows WHERE workflow_id = ?").get(id) as Row | undefined;
  const live = (id: string): Row => {
    const found = row(id);
    if (!found || found.deleted_ms !== null) throw new ProtocolError("NOT_FOUND", "This workflow no longer exists.", { details: { workflowId: id } });
    return found;
  };
  const docOf = (found: Row): WorkflowDocument => JSON.parse(found.json) as WorkflowDocument;
  /** The other workflows a validation reads: sub-workflow references. */
  const context: wf.ValidateContext = { workflow: (id) => { const found = row(id); return found && found.deleted_ms === null ? docOf(found) : undefined; } };
  const problemsOf = (doc: WorkflowDocument): number => wf.validate(doc, context).errors.length;

  function store(doc: WorkflowDocument, entry: { actor: WorkflowActor; label: string; touched: wf.ObjectRef[]; created?: boolean }): void {
    const problems = problemsOf(doc);
    if (entry.created) db.prepare("INSERT INTO workflows (workflow_id, name, revision, json, problems, created_ms, updated_ms) VALUES (?, ?, ?, ?, ?, ?, ?)").run(doc.id, doc.name, doc.revision, JSON.stringify(doc), problems, doc.meta.created_ms, doc.meta.updated_ms);
    else db.prepare("UPDATE workflows SET name = ?, revision = ?, json = ?, problems = ?, updated_ms = ? WHERE workflow_id = ?").run(doc.name, doc.revision, JSON.stringify(doc), problems, doc.meta.updated_ms, doc.id);
    db.prepare("INSERT INTO workflow_revisions (workflow_id, revision, actor, label, graph_hash, json, touched, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(doc.id, doc.revision, JSON.stringify(entry.actor), entry.label, doc.graphHash, JSON.stringify(doc), JSON.stringify(entry.touched), doc.meta.updated_ms);
    // The 50 most recent revisions stay; named versions are never pruned.
    db.prepare("DELETE FROM workflow_revisions WHERE workflow_id = ? AND revision <= ? AND version_name IS NULL").run(doc.id, doc.revision - REVISIONS_KEPT);
  }

  function uniqueName(wanted: string): string {
    const taken = new Set((db.prepare("SELECT name FROM workflows WHERE deleted_ms IS NULL").all() as Array<{ name: string }>).map((entry) => entry.name));
    if (!taken.has(wanted)) return wanted;
    const base = wanted.replace(/ \(\d+\)$/, "");
    for (let index = 2; ; index++) { const name = `${base.slice(0, 80 - ` (${index})`.length)} (${index})`; if (!taken.has(name)) return name; }
  }
  function assertRoom(): void {
    const { count } = db.prepare("SELECT COUNT(*) AS count FROM workflows WHERE deleted_ms IS NULL").get() as { count: number };
    if (count >= WORKFLOW_LIMITS.workflows) throw new ProtocolError("WORKFLOW_LIMIT_EXCEEDED", "This host holds at most 500 workflows.", { details: { limit: "workflows", max: WORKFLOW_LIMITS.workflows, actual: count } });
  }

  function listItem(found: Row): WorkflowListItem {
    const doc = docOf(found);
    const last = db.prepare("SELECT run_id, status, started_ms, created_ms FROM workflow_runs WHERE workflow_id = ? AND deleted_ms IS NULL AND origin != 'subworkflow' ORDER BY created_ms DESC, number DESC LIMIT 1").get(found.workflow_id) as { run_id: string; status: string; started_ms: number | null; created_ms: number } | undefined;
    return {
      id: doc.id, name: doc.name, description: doc.description, origin: doc.meta.origin, revision: doc.revision, nodeCount: doc.nodes.length, problemCount: found.problems, updated_ms: found.updated_ms, created_ms: found.created_ms,
      ...(last ? { lastRun: { id: last.run_id, status: last.status as WorkflowRunStatus, created_ms: last.created_ms, ...(last.started_ms ? { started_ms: last.started_ms } : {}) } } : {}),
    };
  }

  /** Stores a new workflow from a document that already carries its id and name. */
  function insert(doc: WorkflowDocument, actor: WorkflowActor, label: string): WorkflowDocument {
    const stored = { ...doc, revision: 1, graphHash: wf.graphHash(doc) };
    transaction(db, () => store(stored, { actor, label, touched: [], created: true }));
    deps.events.changed(stored.id, "created");
    return stored;
  }

  return {
    context,
    list(): WorkflowListItem[] {
      return (db.prepare("SELECT * FROM workflows WHERE deleted_ms IS NULL ORDER BY updated_ms DESC").all() as Row[]).filter((found) => { const meta = docOf(found).meta; return !meta.pendingPlan && !(meta.origin === "template" && meta.protected); }).map(listItem);
    },
    item: (id: string): WorkflowListItem | undefined => { const found = row(id); return found && found.deleted_ms === null ? listItem(found) : undefined; },
    get(id: string): WorkflowDocument { return docOf(live(id)); },
    find(id: string): WorkflowDocument | undefined { const found = row(id); return found && found.deleted_ms === null ? docOf(found) : undefined; },
    validate(doc: WorkflowDocument): wf.Validation { return wf.validate(doc, context); },

    create(input: { name?: string; origin?: WorkflowDocument["meta"]["origin"]; authorSessionKey?: string }, actor: WorkflowActor): WorkflowDocument {
      assertRoom();
      const name = uniqueName((input.name ?? "").trim().slice(0, 80) || "Untitled workflow");
      const made = wf.createDocument({ id: newId("wf"), name, now: now(), ...(input.origin ? { origin: input.origin } : {}), ...(actor.deviceId ? { deviceId: actor.deviceId } : {}) });
      return insert(input.authorSessionKey ? { ...made, meta: { ...made.meta, authorSessionKey: input.authorSessionKey } } : made, actor, "Create workflow");
    },

    /**
     * Applies a batch. A batch based on an older revision is rebased onto the head: geometry of an object that is gone
     * is dropped, a semantic operation conflicts only with a later change of the very object it names.
     */
    apply(input: { workflowId: string; baseRevision?: number; ops: WorkflowOp[]; label?: string }, actor: WorkflowActor): { revision: number; rebased: boolean; droppedOps: number[]; document: WorkflowDocument } {
      const found = live(input.workflowId);
      const head = docOf(found);
      const base = input.baseRevision ?? head.revision;
      if (base > head.revision || base < 1) throw new ProtocolError("INVALID_PARAMS", "The base revision does not exist.", { details: { path: "baseRevision", head: head.revision } });
      let ops = input.ops;
      const dropped: number[] = [];
      if (base < head.revision) {
        const since = db.prepare("SELECT revision, actor, touched FROM workflow_revisions WHERE workflow_id = ? AND revision > ? ORDER BY revision").all(head.id, base) as Array<{ revision: number; actor: string; touched: string }>;
        const changed = new Map<string, { revision: number; by: WorkflowActor }>();
        for (const entry of since) for (const ref of JSON.parse(entry.touched) as wf.ObjectRef[]) changed.set(`${ref.kind}:${ref.id}`, { revision: entry.revision, by: JSON.parse(entry.actor) as WorkflowActor });
        const conflicts = wf.conflictsOf(ops, (ref) => changed.get(`${ref.kind}:${ref.id}`)?.revision);
        if (conflicts.length) {
          throw new ProtocolError("WORKFLOW_REVISION_CONFLICT", "Someone else changed the same step since you opened it.", {
            details: { head: head.revision, conflicts: conflicts.map((conflict) => ({ ...conflict, by: changed.get(`${conflict.kind}:${conflict.id}`)?.by })) },
          });
        }
        // Geometry of an object that was removed meanwhile is dropped without a word.
        const gone = (op: WorkflowOp): boolean =>
          op.op === "node.move" || op.op === "node.resize" ? !head.nodes.some((node) => node.id === op.id)
          : op.op === "edge.update" ? wf.isGeometryOp(op) && !head.edges.some((edge) => edge.id === op.id)
          : op.op === "group.update" || op.op === "group.remove" ? !head.groups.some((group) => group.id === op.id)
          : op.op === "note.update" || op.op === "note.remove" ? !head.notes.some((note) => note.id === op.id) : false;
        ops = ops.filter((op, index) => { if (gone(op)) { dropped.push(index); return false; } return true; });
        if (!ops.length) return { revision: head.revision, rebased: true, droppedOps: dropped, document: head };
      }
      let result: wf.BatchResult;
      try { result = wf.applyBatch(head, ops, { actor: actor.kind === "agent" ? "agent" : "device" }); } catch (error) { return wireError(error); }
      const applied_ms = now();
      const next: WorkflowDocument = { ...result.doc, revision: head.revision + 1, meta: { ...result.doc.meta, updated_ms: applied_ms } };
      const label = (input.label ?? "").slice(0, 80) || "Edit";
      transaction(db, () => store(next, { actor, label, touched: result.touched }));
      deps.events.ops({ workflowId: next.id, revision: next.revision, baseRevision: head.revision, batchId: randomUUID(), label, actor, ops: ops.map((op, index) => ({ ...op, index })), graphHash: next.graphHash, applied_ms });
      deps.events.changed(next.id, "updated");
      return { revision: next.revision, rebased: base < head.revision, droppedOps: dropped, document: next };
    },

    duplicate(id: string, actor: WorkflowActor): WorkflowDocument {
      assertRoom();
      const source = docOf(live(id));
      const stamp = now();
      // A copy never carries a trigger that fires by itself.
      const nodes = source.nodes.map((node) => (node.type === "trigger" ? { ...node, config: { ...node.config, sources: manualOnly(node.config.sources) } } : node));
      return insert({ ...source, nodes, id: newId("wf"), name: uniqueName(`${source.name.slice(0, 73)} (copy)`), meta: { ...source.meta, origin: "user", protected: false, created_ms: stamp, updated_ms: stamp, ...(actor.deviceId ? { createdByDeviceId: actor.deviceId } : {}) } }, actor, "Duplicate workflow");
    },

    remove(id: string): void {
      const found = live(id);
      db.prepare("UPDATE workflows SET deleted_ms = ? WHERE workflow_id = ?").run(now(), found.workflow_id);
      deps.events.changed(id, "deleted");
    },

    history(id: string): Array<{ revision: number; actor: WorkflowActor; label: string; graphHash: string; created_ms: number; name?: string }> {
      live(id);
      return (db.prepare("SELECT revision, actor, label, graph_hash, created_ms, version_name FROM workflow_revisions WHERE workflow_id = ? ORDER BY revision DESC").all(id) as Array<{ revision: number; actor: string; label: string; graph_hash: string; created_ms: number; version_name: string | null }>)
        .map((entry) => ({ revision: entry.revision, actor: JSON.parse(entry.actor) as WorkflowActor, label: entry.label, graphHash: entry.graph_hash, created_ms: entry.created_ms, ...(entry.version_name ? { name: entry.version_name } : {}) }));
    },
    revision(id: string, revision: number): WorkflowDocument | undefined {
      const found = db.prepare("SELECT json FROM workflow_revisions WHERE workflow_id = ? AND revision = ?").get(id, revision) as { json: string } | undefined;
      return found ? (JSON.parse(found.json) as WorkflowDocument) : undefined;
    },
    /** Restoring a revision creates a new revision whose content equals it. */
    restore(id: string, revision: number, actor: WorkflowActor): WorkflowDocument {
      const head = docOf(live(id));
      const old = this.revision(id, revision);
      if (!old) throw new ProtocolError("NOT_FOUND", "That revision is no longer kept.", { details: { workflowId: id, revision } });
      const stamp = now();
      const next: WorkflowDocument = { ...old, revision: head.revision + 1, meta: { ...old.meta, updated_ms: stamp } };
      // Everything may differ from the head: every object counts as changed for a batch based on an older revision.
      const touched: wf.ObjectRef[] = [...new Set([...head.nodes, ...old.nodes].map((node) => node.id))].map((nodeId) => ({ kind: "node" as const, id: nodeId }));
      touched.push(...[...new Set([...head.edges, ...old.edges].map((edge) => edge.id))].map((edgeId) => ({ kind: "edge" as const, id: edgeId })), ...["parameters", "variables", "outputs", "settings"].map((section) => ({ kind: "section" as const, id: section })));
      transaction(db, () => store(next, { actor, label: `Restore revision ${revision}`, touched }));
      deps.events.ops({ workflowId: id, revision: next.revision, baseRevision: -1, batchId: randomUUID(), label: `Restore revision ${revision}`, actor, ops: [], graphHash: next.graphHash, applied_ms: stamp });
      deps.events.changed(id, "updated");
      return next;
    },

    /** The export file: the document and the workflows its sub-workflow steps name. Nothing of a device, a session or a run. */
    exportFile(id: string): Record<string, unknown> {
      const clean = (doc: WorkflowDocument): WorkflowDocument => {
        const { createdByDeviceId: _device, authorSessionKey: _session, ...meta } = doc.meta;
        // Sources other than manual travel with their configuration and without their binding.
        return { ...doc, meta, nodes: doc.nodes.map((node) => (node.type === "trigger" ? { ...node, config: { ...node.config, sources: ((node.config.sources as Array<Record<string, unknown>>) ?? []).map(({ automationId: _automation, ...source }) => source) } } : node)) };
      };
      const root = docOf(live(id));
      const children = new Map<string, WorkflowDocument>();
      const walk = (doc: WorkflowDocument, depth: number): void => {
        for (const node of doc.nodes) {
          const childId = node.type === "subworkflow" ? String(node.config.workflowId ?? "") : "";
          const child = childId && !children.has(childId) && childId !== root.id ? context.workflow!(childId) as WorkflowDocument | undefined : undefined;
          if (child && depth < 4) { children.set(childId, child); walk(child, depth + 1); }
        }
      };
      walk(root, 1);
      return { format: FILE_FORMAT, version: 1, exportedAt_ms: now(), appVersion: "0.0.0", workflow: clean(root), subworkflows: [...children.values()].map(clean), requires: { roles: [], personas: [], teams: [], tools: [], exportPresets: [] } };
    },

    /** Imports a file as new workflows: new ids, a free name, every source but manual disabled. An invalid file is refused with its first errors. */
    importFile(text: string, actor: WorkflowActor): WorkflowDocument {
      if (Buffer.byteLength(text, "utf8") > FILE_MAX_BYTES) throw new ProtocolError("PAYLOAD_TOO_LARGE", "A workflow file is at most 4 MiB.", { details: { limit: "fileBytes", max: FILE_MAX_BYTES } });
      let file: { format?: unknown; workflow?: unknown; subworkflows?: unknown };
      try { file = JSON.parse(text); } catch { throw new ProtocolError("WORKFLOW_SCHEMA_INVALID", "This file is not a workflow file.", { details: { errors: ["The file is not JSON"] } }); }
      if (!file || file.format !== FILE_FORMAT || !file.workflow) throw new ProtocolError("WORKFLOW_SCHEMA_INVALID", "This file is not a workflow file.", { details: { errors: ["format must be jagentchill.workflow.file"] } });
      const parsed: WorkflowDocument[] = [];
      try { for (const entry of [file.workflow, ...(Array.isArray(file.subworkflows) ? file.subworkflows : [])]) parsed.push(wf.parseDocument(entry)); } catch (error) {
        if (error instanceof wf.WorkflowError) throw new ProtocolError("WORKFLOW_SCHEMA_INVALID", `This file is not a valid workflow: ${error.message}`, { details: { errors: [error.message] } });
        throw error;
      }
      const ids = new Map(parsed.map((doc) => [doc.id, newId("wf")]));
      const stamp = now();
      let root: WorkflowDocument | undefined;
      // Children first, so that the parent's references resolve when it is validated.
      for (const doc of [...parsed].reverse()) {
        assertRoom();
        const nodes = doc.nodes.map((node) =>
          node.type === "trigger" ? { ...node, config: { ...node.config, sources: ((node.config.sources as Array<Record<string, unknown>>) ?? []).map(({ automationId: _automation, ...source }) => (source.kind === "manual" || source.kind === "subworkflow" ? source : { ...source, enabled: false })) } }
          : node.type === "subworkflow" && ids.has(String(node.config.workflowId)) ? { ...node, config: { ...node.config, workflowId: ids.get(String(node.config.workflowId))! } } : node);
        const stored = insert({ ...doc, nodes, id: ids.get(doc.id)!, name: uniqueName(doc.name), meta: { ...doc.meta, origin: "import", created_ms: stamp, updated_ms: stamp, ...(actor.deviceId ? { createdByDeviceId: actor.deviceId } : {}) } }, actor, "Import workflow");
        if (doc === parsed[0]) root = stored;
      }
      return root!;
    },

    /** A built-in template under its fixed id: stored on first start and replaced when the build ships another graph. Its runs keep the snapshot they started with. */
    install(doc: WorkflowDocument): WorkflowDocument {
      const found = row(doc.id), hash = wf.graphHash(doc);
      // Installed while the host starts, before any device is connected: nothing is announced.
      if (!found) { const first = { ...doc, revision: 1, graphHash: hash }; transaction(db, () => store(first, { actor: { kind: "system" }, label: "Install template", touched: [], created: true })); return first; }
      const head = docOf(found);
      if (head.graphHash === hash && found.deleted_ms === null) return head;
      const stored = { ...doc, revision: head.revision + 1, graphHash: hash, meta: { ...doc.meta, created_ms: head.meta.created_ms } };
      transaction(db, () => { db.prepare("UPDATE workflows SET deleted_ms = NULL WHERE workflow_id = ?").run(doc.id); store(stored, { actor: { kind: "system" }, label: "Update template", touched: [] }); });
      return stored;
    },

    /** A change the host makes itself (a trigger source bound to its automation). */
    system(workflowId: string, ops: WorkflowOp[], label: string): WorkflowDocument { return this.apply({ workflowId, ops, label }, { kind: "system" }).document; },
  };
}

function manualOnly(sources: unknown): Array<Record<string, unknown>> {
  return ((sources as Array<Record<string, unknown>>) ?? []).filter((source) => source.kind === "manual" || source.kind === "subworkflow");
}
export type WorkflowDocuments = ReturnType<typeof createWorkflowDocuments>;

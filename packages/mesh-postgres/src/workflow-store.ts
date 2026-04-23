import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
  Address,
  Workflow,
  WorkflowEvent,
  WorkflowEventData,
  WorkflowEventKind,
  WorkflowRecorder,
  WorkflowStatus,
} from "@corelay/mesh-core";

export interface WorkflowStoreConfig {
  pool: Pool;
}

/**
 * Durable store for Workflows and their append-only event logs.
 *
 * Implements the WorkflowRecorder interface from @corelay/mesh-core, so it
 * can be passed to run() to persist a workflow end-to-end.
 *
 * Day 5 API: createWorkflow, appendEvent, getWorkflow, getEvents,
 * updateStatus. Resume-from-events arrives in Week 2.
 *
 * Assumes sql/001-init.sql has been applied. Uses only standard SQL, no
 * pg-specific features beyond JSONB.
 */
export class WorkflowStore implements WorkflowRecorder {
  private pool: Pool;

  constructor(config: WorkflowStoreConfig) {
    this.pool = config.pool;
  }

  async createWorkflow(rootPeer: Address): Promise<Workflow> {
    const id = randomUUID();
    const now = Date.now();
    await this.pool.query(
      `INSERT INTO workflows (id, root_peer, status, started_at, updated_at)
       VALUES ($1, $2, 'running', $3, $3)`,
      [id, rootPeer, now],
    );
    return { id, rootPeer, status: "running", startedAt: now, updatedAt: now };
  }

  async appendEvent(
    workflowId: string,
    kind: WorkflowEventKind,
    data: WorkflowEventData,
  ): Promise<WorkflowEvent> {
    const id = randomUUID();
    const at = Date.now();
    await this.pool.query(
      `INSERT INTO workflow_events (id, workflow_id, kind, at, data)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, workflowId, kind, at, JSON.stringify(data)],
    );
    await this.pool.query(
      `UPDATE workflows SET updated_at = $1 WHERE id = $2`,
      [at, workflowId],
    );
    return { id, workflowId, kind, at, data };
  }

  async getWorkflow(workflowId: string): Promise<Workflow | null> {
    const { rows } = await this.pool.query<{
      id: string;
      root_peer: string;
      status: WorkflowStatus;
      started_at: string;
      updated_at: string;
      error: string | null;
    }>(
      `SELECT id, root_peer, status, started_at, updated_at, error
       FROM workflows WHERE id = $1`,
      [workflowId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      rootPeer: row.root_peer as Address,
      status: row.status,
      startedAt: Number(row.started_at),
      updatedAt: Number(row.updated_at),
      ...(row.error != null && { error: row.error }),
    };
  }

  async getEvents(workflowId: string): Promise<WorkflowEvent[]> {
    const { rows } = await this.pool.query<{
      id: string;
      workflow_id: string;
      kind: WorkflowEventKind;
      at: string;
      data: WorkflowEventData;
    }>(
      `SELECT id, workflow_id, kind, at, data
       FROM workflow_events
       WHERE workflow_id = $1
       ORDER BY at ASC, id ASC`,
      [workflowId],
    );
    return rows.map((r) => ({
      id: r.id,
      workflowId: r.workflow_id,
      kind: r.kind,
      at: Number(r.at),
      data: r.data,
    }));
  }

  async updateStatus(
    workflowId: string,
    status: WorkflowStatus,
    error?: string,
  ): Promise<void> {
    const now = Date.now();
    await this.pool.query(
      `UPDATE workflows SET status = $1, error = $2, updated_at = $3 WHERE id = $4`,
      [status, error ?? null, now, workflowId],
    );
  }
}

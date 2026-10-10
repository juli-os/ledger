// Domain types of the lifecycle ledger. Everything is readonly: state
// transitions = explicit functions writing to the DB (the store is the only
// mutable boundary), and in-memory objects are never mutated in place.
// Column-for-column aligned with the Go internal/ledger/lifecycle schema
// (migration V1), so in-flight data can be read from both.

import type { JsonRecord } from '../platform/shared/json.ts';

export type WorkflowStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'rejected';
/** Terminal statuses: entering one cascades a close-out of in-flight runs (queued/running are non-terminal, so no close-out). */
export const TERMINAL_WORKFLOW_STATUSES: readonly WorkflowStatus[] = [
  'completed', 'failed', 'cancelled', 'rejected',
];
export type StepStatus = 'pending' | 'running' | 'waiting_human' | 'completed' | 'failed' | 'cancelled' | 'skipped';
export type StepKind = 'triage' | 'gate' | 'agent' | 'verify' | 'draft' | 'send' | 'llm' | 'share';

export const STEP_KINDS: readonly StepKind[] = [
  'triage', 'gate', 'agent', 'verify', 'draft', 'send', 'llm', 'share',
];

// ---- Step-kind capability sets (consolidated 2026-09-22) -------------------
// The verb surface (intervene/rework/retry-patch/reworkSend) previously each
// hand-wrote its own kind list, consistent only by coincidence. The sets are
// semantics, not bugs: intervention/rework only accepts steps that actually
// run an agent; the instructable surface is wider (llm/draft also take
// plan/prompt). Assign new kinds to a set here, once.

/** Steps that run an agent (intervenable/reworkable/counted as "real work"):
 * five sites across engine intervene/align/reworkSend/assignSession plus the
 * two SQL paths of store.runningAgentStepForSession share this definition
 * (the SQL consumes it via sqlInList). */
export const AGENT_STEP_KINDS: readonly StepKind[] = ['agent', 'verify'];

/** Steps that can carry instruction patches (plan/prompt/session): the engine
 * rework back-scan and the retry patch share this definition (llm/draft also
 * take instructions, but cannot be interrupted mid-run). */
export const INSTRUCTABLE_STEP_KINDS: readonly StepKind[] = ['agent', 'verify', 'llm', 'draft'];

export interface Workflow {
  readonly id: string;
  readonly parentId: string | null;
  readonly kind: string;
  readonly title: string;
  readonly status: WorkflowStatus;
  readonly session: string;
  readonly project: string;
  readonly path: string;
  /** Threads modeled as first-class: the thread id shared by all emails in the
   * same exchange. null = legacy rows predating filing, or non-email work
   * orders. Thread root = the first email's own workflow id. */
  readonly threadId: string | null;
  readonly meta: JsonRecord;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Step {
  readonly id: string;
  readonly workflowId: string;
  readonly seq: number; // 1-based
  readonly kind: StepKind;
  readonly title: string;
  readonly status: StepStatus;
  readonly input: JsonRecord;
  readonly output: JsonRecord;
  readonly summary: string;
  readonly updatedAt: string;
  /** Node timing: the first transition out of pending (a gate's waiting_human
   * also counts as started). Empty string = legacy row (before the column
   * backfill migration) or not yet started. */
  readonly startedAt: string;
  /** When a terminal status was first reached; null = not terminal yet or a legacy row. */
  readonly completedAt: string | null;
}

export interface LedgerEvent {
  readonly id: number;
  /** 'agent' = session runtime telemetry (skill_used etc., entityId = session
   * name) — like judgment, an auditable record with no workflow entity behind
   * it; first used 2026-10-02 for skill traceability. */
  readonly entityType: 'workflow' | 'step' | 'judgment' | 'agent';
  readonly entityId: string;
  readonly type: string;
  readonly payload: JsonRecord;
  readonly ts: string;
}

export interface Run {
  readonly id: string;
  readonly workflowId: string;
  readonly session: string;
  readonly status: 'running' | 'idle' | 'completed' | 'failed';
  readonly createdAt: string;
}

export interface Prompt {
  readonly id: string;
  readonly runId: string;
  readonly content: string;
  readonly status: 'submitted' | 'completed' | 'failed';
  readonly createdAt: string;
}

/** Task projection (phase-4 minimal promotion, 2026-09-22): Task adds no new
 * table — the "task card" is an adhoc work order with meta.mode='nodes'
 * (created by engine.startTask); linked orders hang off
 * meta.related_workflow (falling back to parent_id). One Task = the task
 * card + every workflow on its chain attributed to it (including email work
 * orders / follow-up execution orders). */
export interface TaskView {
  /** The task card's workflow id (= Task id). */
  readonly taskId: string;
  readonly title: string;
  /** The task card's own status (WorkflowStatus). */
  readonly status: WorkflowStatus;
  /** All workflow ids attributed to this Task (including the task card itself), newest → oldest. */
  readonly workflowIds: readonly string[];
}

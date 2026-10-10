// The single registry of statuses (phase 4, 2026-09-22): every status is
// registered here exactly once — key (the ledger's canonical English mono
// value) / Chinese label (per the walkthrough language convention: statuses
// use Chinese names) / semantic group (in progress / awaiting decision /
// terminal) / whether it is terminal. Three consumers (the overview stat
// cards, kanban columns, and workflow filters) grow from this registry
// instead of hand-writing their own lists — the walkthrough traced the
// "overview shows 1 failure, kanban has no failed column" bug to exactly
// that three-way drift of hand-maintained lists.
//
// The registry is grounded in real data (read-only forensics on the
// production DB, 2026-09-21):
//   workflows:  cancelled 89 / completed 45 / failed 4
//   workflow_steps DISTINCT: pending / completed / failed / cancelled
// plus the full set declared by the engine's write paths (WorkflowStatus /
// StepStatus in types.ts; queued/running/rejected and the step statuses
// waiting_human/skipped have 0 rows in the current DB, but the engine
// genuinely writes them — nothing is invented). Unknown statuses outside
// the registry: views display the raw string and file it under the "other"
// group — never hidden.

import type { StepStatus, WorkflowStatus } from './entities.ts';

/** Semantic groups: in progress (still moving on the ledger) / awaiting decision (blocked on a human) / terminal (closed out). */
export type StatusGroup = '进行中' | '等决定' | '终态';

export interface StatusDef {
  /** Canonical ledger value (English mono). */
  readonly key: string;
  /** Chinese label (per the walkthrough language convention: statuses use Chinese names). */
  readonly label: string;
  /** Semantic group; anything outside the registry falls into "other" (STATUS_GROUP_OTHER). */
  readonly group: StatusGroup;
  /** Terminal = entering it closes the workflow out (aligned with TERMINAL_WORKFLOW_STATUSES in types.ts). */
  readonly terminal: boolean;
}

/** Group name for statuses outside the registry: unknown statuses display their raw value and fall into "other", never hidden. */
export const STATUS_GROUP_OTHER = '其他';

/** Registry entry with key narrowed to the ledger type (for satisfies: key
 * aligned to the WorkflowStatus union, label/group/terminal aligned to
 * StatusDef — both sides locked by the type system). */
export type WorkflowStatusDef = StatusDef & { readonly key: WorkflowStatus };
export type StepStatusDef = StatusDef & { readonly key: StepStatus };

/** Workflow status registry; ordering = kanban column order / filter order. */
export const WORKFLOW_STATUSES: readonly StatusDef[] = [
  { key: 'queued', label: '排队中', group: '进行中', terminal: false },
  { key: 'running', label: '进行中', group: '进行中', terminal: false },
  { key: 'completed', label: '已完成', group: '终态', terminal: true },
  { key: 'failed', label: '失败', group: '终态', terminal: true },
  { key: 'cancelled', label: '已取消', group: '终态', terminal: true },
  { key: 'rejected', label: '已拒绝', group: '终态', terminal: true },
] satisfies readonly WorkflowStatusDef[];

/** Step (workflow_steps) status registry. waiting_human ("awaiting your
 * decision") is a step-only status — workflow.status in the ledger is never
 * it (the kanban "awaiting decision" column is a projection of running
 * workflows + waiting steps, see web/src/statuses.ts); the registry holds
 * only statuses that genuinely exist in the ledger. */
export const STEP_STATUSES: readonly StatusDef[] = [
  { key: 'pending', label: '待排', group: '进行中', terminal: false },
  { key: 'running', label: '进行中', group: '进行中', terminal: false },
  { key: 'waiting_human', label: '等你决定', group: '等决定', terminal: false },
  { key: 'completed', label: '已完成', group: '终态', terminal: true },
  { key: 'failed', label: '失败', group: '终态', terminal: true },
  { key: 'cancelled', label: '已取消', group: '终态', terminal: true },
  { key: 'skipped', label: '已跳过', group: '终态', terminal: true },
] satisfies readonly StepStatusDef[];

/** Registry lookup: returns the definition on a hit, undefined otherwise (callers fall back to "other"). */
export const workflowStatusDef = (key: string): StatusDef | undefined =>
  WORKFLOW_STATUSES.find((s) => s.key === key);

export const stepStatusDef = (key: string): StatusDef | undefined =>
  STEP_STATUSES.find((s) => s.key === key);

/** Status → Chinese label: statuses outside the registry return the key verbatim (display the raw value; no guessing, no translating). */
export const statusLabelOf = (key: string): string => workflowStatusDef(key)?.label ?? key;

// ---- Status predicates (single source of truth derived from the registry,
// consolidated 2026-09-22) ---------------------------------------------------
// Background: phase 4 of the registry consolidated "labels/groups", but the
// three semantic sets "active / settled / live" were still hand-written
// literals in the engine (10+ sites) and store SQL (7+ sites) — patched
// after the fact twice already (queued retro-added to active; failed kept
// out of incident exclusion), all evidence of hand-written list drift.
// Three predicate tiers, never to be conflated:
//   terminal = state-machine terminal status (no further transitions once
//              entered; includes failed — failed can still be retried back,
//              but that is an action, not a spontaneous transition);
//   settled  = closed-out semantics (completed/cancelled, no failure left
//              behind — the settle/close-out criterion; failed is out
//              because it is a retryable open failure, rejected is a human
//              veto);
//   active   = in flight (the ledger may still move on its own).

/** Active step statuses: pending/running/waiting_human (the guard definition for advancing/cancelling/reconciliation). */
export const ACTIVE_STEP_STATUSES: readonly string[] =
  STEP_STATUSES.filter((s) => !s.terminal).map((s) => s.key);
/** Active workflow statuses: queued/running. */
export const ACTIVE_WORKFLOW_STATUSES: readonly string[] =
  WORKFLOW_STATUSES.filter((s) => !s.terminal).map((s) => s.key);
/** Settled step statuses: completed/cancelled (the settle criterion — failed excluded: a retryable open failure). */
export const SETTLED_STEP_STATUSES: readonly string[] =
  STEP_STATUSES.filter((s) => s.key === 'completed' || s.key === 'cancelled').map((s) => s.key);
/** Settled workflow statuses: completed/cancelled. */
export const SETTLED_WORKFLOW_STATUSES: readonly string[] =
  WORKFLOW_STATUSES.filter((s) => s.key === 'completed' || s.key === 'cancelled').map((s) => s.key);
/** Terminal step statuses: the registry's terminal flags (completed/failed/cancelled/skipped). */
export const TERMINAL_STEP_STATUSES: readonly string[] =
  STEP_STATUSES.filter((s) => s.terminal).map((s) => s.key);
/** Dedup-window workflow statuses: queued/running + waiting_human (a defensive
 * value — the ledger's workflow.status never produces it, but historical SQL
 * carries it; kept as-is with zero semantic change). */
export const DEDUP_WINDOW_STATUSES: readonly string[] = ['queued', 'running', 'waiting_human'];
/** Prunable workflow statuses: completed/cancelled/rejected — failed is retained
 * (incident-forensics semantics, ruled 2026-09-15); a different tier from the
 * settled set: a human veto (rejected) can be cleaned up, failed stays for
 * humans to inspect. */
export const PRUNE_WORKFLOW_STATUSES: readonly string[] = ['completed', 'cancelled', 'rejected'];

export const isActiveStepStatus = (s: string): boolean => ACTIVE_STEP_STATUSES.includes(s);
export const isActiveWorkflowStatus = (s: string): boolean => ACTIVE_WORKFLOW_STATUSES.includes(s);
export const isSettledStepStatus = (s: string): boolean => SETTLED_STEP_STATUSES.includes(s);
export const isSettledWorkflowStatus = (s: string): boolean => SETTLED_WORKFLOW_STATUSES.includes(s);
export const isTerminalStepStatus = (s: string): boolean => TERMINAL_STEP_STATUSES.includes(s);

/** Live node (the dedup definition for appendNode send/gate): not failed and
 * not cancelled — completed counts too (dedup semantics: a work order with an
 * existing non-failed send does not create a second one, even if the first
 * has already been sent). */
export const isLiveNodeStatus = (s: string): boolean => s !== 'failed' && s !== 'cancelled';

/** Predicate set → SQL IN list (values all come from registry constants in this file; no injection surface). */
export const sqlInList = (keys: readonly string[]): string => keys.map((k) => `'${k}'`).join(',');

// Lifecycle ledger: the persistence boundary on top of SQLite (node:sqlite,
// zero native dependencies). Column-for-column aligned with the V1 schema of
// the Go internal/ledger/lifecycle, so historical data can be read from both.
//
// Immutability policy: this store is the system's only mutable boundary; all
// JSON-column updates are read-merge-write (the node:sqlite synchronous
// driver leaves no room for a concurrent write between the read and the
// write), and the engine and HTTP layer only ever receive frozen snapshots.
// State transitions happen only through explicit methods; never a full-row
// DELETE.

import { DatabaseSync } from 'node:sqlite';
import type { JsonRecord, JsonValue } from '../shared/json.ts';
import { asRecord, safeParse } from '../shared/json.ts';
import { rfc3339, type Clock, type IdGen, randomIds, systemClock } from '../shared/clock.ts';
import type {
  LedgerEvent, Prompt, Run, Step, StepKind, StepStatus, TaskView, Workflow, WorkflowStatus,
} from '../../contracts/entities.ts';
import { AGENT_STEP_KINDS, TERMINAL_WORKFLOW_STATUSES } from '../../contracts/entities.ts';
import {
  ACTIVE_STEP_STATUSES, DEDUP_WINDOW_STATUSES, PRUNE_WORKFLOW_STATUSES,
  TERMINAL_STEP_STATUSES, sqlInList,
} from '../../contracts/statuses.ts';
import { parseCaseFile, serializeCaseFile, type CaseFileDoc } from './casefile.ts';

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  kind TEXT NOT NULL DEFAULT 'adhoc',
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',
  session TEXT,
  project TEXT,
  path TEXT,
  meta TEXT,
  case_file TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_steps (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  input TEXT,
  output TEXT,
  summary TEXT,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE(workflow_id, seq)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT,
  ts TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  session TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'submitted',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_steps_wf ON workflow_steps(workflow_id, seq);
CREATE TABLE IF NOT EXISTS relays (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  session TEXT NOT NULL,
  text TEXT NOT NULL,
  marker TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session, status);
`;

export interface LifecycleStore {
  readonly db: DatabaseSync;
  // workflows
  createWorkflow(w: { kind: string; title: string; meta?: JsonRecord; parentId?: string; status?: WorkflowStatus; owner?: string }): Workflow;
  getWorkflow(id: string): Workflow | null;
  listWorkflows(limit?: number, status?: string): readonly Workflow[];
  setWorkflowStatus(id: string, status: WorkflowStatus): void;
  setWorkflowSession(id: string, session: string): void;
  updateWorkflowMeta(id: string, patch: JsonRecord): JsonRecord;
  setWorkflowRouting(id: string, session: string, project: string): void;
  // Thread filing and matching queries: the engine only calls methods; the SQL stays in this layer.
  /** Grouping: attach a workflow to a thread (first filing or inheritance). An empty threadId is rejected. */
  assignThread(workflowId: string, threadId: string): void;
  /** Intake matching (1): exact meta.message_id lookup of the latest work order
   * (the causal anchor for in_reply_to). Status is unrestricted — a rejected
   * message is still the one being replied to. excludeWorkflowId = this work
   * order (matching runs after the new row is already stored, so without the
   * exclusion it would match itself). */
  latestByMessageId(messageId: string, excludeWorkflowId?: string): Workflow | null;
  /** Intake matching (2) candidate set: same sender (case-insensitive) + within
   * the time window, non-rejected work orders, newest → oldest. Subject
   * normalization ("stripping Re:/reply:" prefixes) happens in the engine —
   * SQL can't express it; this layer only narrows the set. */
  recentBySender(from: string, sinceIso: string, excludeWorkflowId?: string, limit?: number): readonly Workflow[];
  // casefile
  loadCaseFile(id: string): CaseFileDoc;
  saveCaseFile(id: string, cf: CaseFileDoc): void;
  // steps
  createStep(s: {
    workflowId: string; seq: number; kind: StepKind; title: string; input?: JsonRecord;
  }): Step;
  /** Dynamic expansion: insert several steps after afterSeq; the existing tail shifts up. Single transaction. */
  insertStepsAt(workflowId: string, afterSeq: number, steps: readonly {
    kind: StepKind; title: string; input?: JsonRecord;
  }[]): void;
  getStep(id: string): Step | null;
  stepsForWorkflow(id: string): readonly Step[];
  currentStep(id: string): Step | null;
  setStepStatus(id: string, status: StepStatus): void;
  setStepInput(id: string, patch: JsonRecord): void;
  // Relay outbox for background sends: approval = a persisted delivery that
  // triggers the next step (settled once delivered; silent loss is not allowed).
  insertRelay(r: { workflowId: string; stepId: string; session: string; text: string; marker: string }): string;
  pendingRelays(): readonly { id: string; workflowId: string; stepId: string; session: string; text: string; marker: string; createdAt: string; attempts: number; lastError: string }[];
  markRelayDelivered(id: string): void;
  markRelayAttempt(id: string, error: string): void;
  setStepOutput(id: string, patch: JsonRecord): void;
  /** Atomic array append: read-append-trim-write within one synchronous
   * statement sequence (node:sqlite synchronous = atomic section).
   * recordActivity's read-merge-write once overwrote concurrent entries with
   * a stale snapshot. */
  appendStepOutputItem(id: string, key: string, entry: JsonValue, cap: number): void;
  /** Atomic CAS: running→completed. Returns false = already settled by another path (settle-once). */
  claimRunningStep(id: string): boolean;
  listSteps(status: StepStatus, limit?: number): readonly Step[];
  runningAgentStepForSession(session: string): Step | null;
  /** Busy/idle predicate (redefined by user ruling, 2026-09-30): busy = a
   * non-terminal work order exists under the session's name — queued, running,
   * or parked at a gate awaiting approval all count; the only idle = every
   * work order under the session is terminal. Anchoring shares the same
   * sources as the runningAgentStepForSession fallback (session column /
   * meta.assigned_session / runs rows); anchoring during the queued phase
   * relies on the session column being written at intake seeding time.
   * Consumers: dispatch-side busy/idle diversion, routing-graph occupancy,
   * routeTask target-session resolution (the zombie watchdog / settlement
   * that need the "currently running step" itself do not go through here).
   * excludeWorkflowId lets the dispatch side exclude itself — this work order
   * is itself anchored on the target session and non-terminal, so without the
   * exclusion every dispatch would trigger its own diversion. */
  sessionHasOpenWork(session: string, excludeWorkflowId?: string): boolean;
  // events
  appendEvent(entityType: 'workflow' | 'step' | 'judgment' | 'agent', entityId: string, type: string, payload?: JsonRecord): LedgerEvent;
  listEvents(limit?: number, types?: readonly string[]): readonly LedgerEvent[];
  eventsSince(afterId: number, limit?: number): readonly LedgerEvent[];
  /** Per-entity event query (P2-5): full-history replay filtered by
   * entity_type+entity_id+type, served by the idx_events_entity index —
   * guard-style consumers (the ping-pong guard) are no longer bound by
   * listEvents' whole-DB window (entityId filtering happened after the
   * window, so early events fell out of it and were missed). */
  entityEvents(entityType: LedgerEvent['entityType'], entityId: string, type: string, limit?: number): readonly LedgerEvent[];
  /** ts of the entity's last event (empty string when there are none). The
   * "run last activity" anchor for billing-window extension: a work order in
   * flight keeps landing session_turn and similar events from background
   * execution turns, so MAX(ts) is the activity frontier (served by the
   * idx_events_entity index). */
  lastEventAt(entityType: LedgerEvent['entityType'], entityId: string): string;
  // runs & prompts
  createRun(workflowId: string, session: string): Run;
  hasActiveDedup(key: string): boolean;
  /** Polling-layer dedup: any non-rejected workflow containing this dedup_key counts as already ingested. */
  hasSeenDedup(key: string): boolean;
  /** Self-loop guard (breakpoint 13): the message_id hits the output.message_id of a completed send step. */
  sentMessageIdExists(messageId: string): boolean;
  /** Register every outbound email (2026-09-20 ghost-work-order gap): beyond
   * send steps, the message_ids of all outbound mail — notification emails
   * (emailNotifier) included — enter the query surface, so alert mail sent to
   * the polling mailbox itself is no longer filed as a new inbound message
   * (the "[juli] pending approval" ghost work orders). */
  recordSentMessageId(messageId: string, meta?: { to?: string; subject?: string }): void;
  activeRunForSession(session: string): Run | null;
  createPrompt(runId: string, content: string, source: string): Prompt;
  latestPromptForSession(session: string, statuses: readonly Prompt['status'][]): Prompt | null;
  /** Pruning: events past retention are deleted; terminal
   * (completed/cancelled/rejected) workflows past retention are deleted along
   * with their steps, while failed is always retained (incident semantics).
   * Returns the number of deleted rows. */
  prune(retentionDays: number): { events: number; workflows: number };
  /** Task projection (phase-4 minimal promotion, 2026-09-22): Task still adds
   * no new table — the task card (a work order with meta.mode='nodes', created
   * by engine.startTask) plus the related_workflow/parent_id chain aggregate
   * into a "one Task, many workflows" view. Returns the task-card views
   * (newest → oldest) and a workflowId→taskId attribution map (work orders
   * with no task-card ancestor, such as plain email flows, stay out of the
   * map). Root criterion: the highest task card up the chain; when a task card
   * hangs under an email work order (a direction-corrected chain) the root is
   * the task card itself — an email order is not a task card and is not
   * absorbed. Display-level projection; scans the most recent 500 work orders
   * by default. */
  taskViews(limit?: number): { readonly views: readonly TaskView[]; readonly map: Readonly<Record<string, string>> };
}

type Row = Record<string, string | number | bigint | null | Uint8Array>;

const str = (v: string | number | bigint | null | Uint8Array | undefined): string =>
  typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
const num = (v: string | number | bigint | null | Uint8Array | undefined): number =>
  typeof v === 'number' ? v : Number(v ?? 0);

/** LIKE pattern for dedup_key inside the meta JSON; must be paired with
 * `ESCAPE '\'`. Two steps: first take the bytes JSON actually stores (`"`→`\"`
 * etc., from JSON encoding), then escape the LIKE-special characters
 * (`\ % _`) — the quote itself has no special meaning in LIKE; what gets
 * escaped is the backslash JSON added. */
const dedupPattern = (key: string): string => {
  const jsonValue = JSON.stringify(key).slice(1, -1);
  return `%"dedup_key":"${jsonValue.replace(/[%_\\]/g, (c) => `\\${c}`)}"%`;
};

/** Time window for the sentMessageIdExists LIKE path (rfc3339 lexicographic
 * comparison): only completed send steps predating the mailer seam's full
 * outbound registration (commit window of 2026-09-19) take the LIKE path —
 * every later outbound message is on the exact events path. */
const SEND_STEP_LIKE_CUTOFF = '2026-09-19';

const rowToWorkflow = (r: Row): Workflow => ({
  id: str(r['id']),
  parentId: r['parent_id'] === null ? null : str(r['parent_id']),
  kind: str(r['kind']),
  title: str(r['title']),
  status: str(r['status']) as WorkflowStatus,
  session: str(r['session']),
  project: str(r['project']),
  path: str(r['path']),
  threadId: r['thread_id'] === null || r['thread_id'] === undefined ? null : str(r['thread_id']),
  meta: asRecord(safeParse(str(r['meta']))),
  createdAt: str(r['created_at']),
  updatedAt: str(r['updated_at']),
});

const rowToStep = (r: Row): Step => ({
  id: str(r['id']),
  workflowId: str(r['workflow_id']),
  seq: num(r['seq']),
  kind: str(r['kind']) as StepKind,
  title: str(r['title']),
  status: str(r['status']) as StepStatus,
  input: asRecord(safeParse(str(r['input']))),
  output: asRecord(safeParse(str(r['output']))),
  summary: str(r['summary']),
  updatedAt: str(r['updated_at']),
  startedAt: str(r['started_at'] ?? ''),
  completedAt: r['completed_at'] === null || r['completed_at'] === undefined ? null : str(r['completed_at']),
});

const rowToEvent = (r: Row): LedgerEvent => ({
  id: num(r['id']),
  entityType: str(r['entity_type']) as LedgerEvent['entityType'],
  entityId: str(r['entity_id']),
  type: str(r['type']),
  payload: asRecord(safeParse(str(r['payload']))),
  ts: str(r['ts']),
});

const pruneImpl = (db: DatabaseSync, retentionDays: number, nowIso: string): { events: number; workflows: number } => {
  if (retentionDays <= 0) return { events: 0, workflows: 0 };
  const cutoff = new Date(new Date(nowIso).getTime() - retentionDays * 86_400_000).toISOString();
  const ev = db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff);
  // Terminal-workflow cleanup (steps included): the list lives in
  // statuses.ts PRUNE_WORKFLOW_STATUSES (failed retained — incident
  // semantics).
  const wfRows = db.prepare(
    `SELECT id FROM workflows WHERE status IN (${sqlInList(PRUNE_WORKFLOW_STATUSES)}) AND updated_at < ?`,
  ).all(cutoff) as { id: string }[];
  let wfCount = 0;
  for (const r of wfRows) {
    db.prepare('DELETE FROM workflow_steps WHERE workflow_id=?').run(r.id);
    db.prepare('DELETE FROM workflows WHERE id=?').run(r.id);
    wfCount++;
  }
  return { events: Number(ev.changes), workflows: wfCount };
};

const STEP_COLS = `id, workflow_id, seq, kind, title, status, COALESCE(input,'') AS input,
  COALESCE(output,'') AS output, COALESCE(summary,'') AS summary, updated_at,
  started_at, completed_at`;

export const createLedgerStore = (
  dbPath: string,
  deps: { readonly clock?: Clock; readonly ids?: IdGen } = {},
): LifecycleStore => {
  const clock = deps.clock ?? systemClock;
  const ids = deps.ids ?? randomIds;
  const db = new DatabaseSync(dbPath);
  db.exec(MIGRATIONS);
  // Reserved for V2: the owner column supports future multi-tenant /
  // multi-operator use (nullable, zero behavior change). Adding the column
  // now is free; adding it later to a table with data is surgery.
  const wfCols = (db.prepare("PRAGMA table_info(workflows)").all() as { name: string }[]).map((c) => c.name);
  if (!wfCols.includes('owner')) {
    db.exec('ALTER TABLE workflows ADD COLUMN owner TEXT');
  }
  // Threads as first-class (phase 2, 2026-09-21): an email reply chain shares
  // thread_id — appending a nullable column is legitimate (the row-content
  // immutability discipline only forbids rewriting, not adding columns); the
  // index serves kanban grouping.
  if (!wfCols.includes('thread_id')) {
    db.exec('ALTER TABLE workflows ADD COLUMN thread_id TEXT');
  }
  // The index must be created after the column: the MIGRATIONS block runs at
  // table creation, when thread_id doesn't exist yet.
  db.exec('CREATE INDEX IF NOT EXISTS idx_workflows_thread ON workflows(thread_id)');
  // Step timing (started/completed): backfill columns for existing DBs —
  // node timing previously could only be reconstructed by replaying the event
  // stream (goShape itself admits created_at is fake); the columns are
  // NULLable to stay compatible with historical rows.
  const stepCols = (db.prepare("PRAGMA table_info(workflow_steps)").all() as { name: string }[]).map((c) => c.name);
  if (!stepCols.includes('started_at')) db.exec('ALTER TABLE workflow_steps ADD COLUMN started_at TEXT');
  if (!stepCols.includes('completed_at')) db.exec('ALTER TABLE workflow_steps ADD COLUMN completed_at TEXT');
  const now = (): string => rfc3339(clock.now());

  // Read-merge-write for JSON columns (atomic under the synchronous driver).
  const mergeStepJson = (id: string, col: 'input' | 'output', patch: JsonRecord): void => {
    const row = db.prepare(`SELECT COALESCE(${col},'{}') AS v FROM workflow_steps WHERE id=?`).get(id);
    const cur = asRecord(safeParse(str(row?.['v'])));
    const merged = { ...cur, ...patch };
    db.prepare(`UPDATE workflow_steps SET ${col}=?, updated_at=? WHERE id=?`)
      .run(JSON.stringify(merged), now(), id);
  };

  const getWorkflowById = (id: string): Workflow | null => {
    const r = db.prepare('SELECT * FROM workflows WHERE id=?').get(id);
    return r ? rowToWorkflow(r as Row) : null;
  };
  const getStepById = (id: string): Step | null => {
    const r = db.prepare(`SELECT ${STEP_COLS} FROM workflow_steps WHERE id=?`).get(id);
    return r ? rowToStep(r as Row) : null;
  };
  const activeRunOf = (session: string): Run | null => {
    const r = db.prepare(
      `SELECT r.id AS id, r.workflow_id AS workflow_id, r.session AS session,
              r.status AS status, r.created_at AS created_at FROM runs r
       JOIN workflows w ON w.id = r.workflow_id
       WHERE r.session=? AND r.status IN ('running','idle') AND w.status='running'
       ORDER BY r.created_at DESC LIMIT 1`,
    ).get(session);
    if (!r) return null;
    return {
      id: str(r['id']), workflowId: str(r['workflow_id']), session: str(r['session']),
      status: 'running' as const, createdAt: str(r['created_at']),
    };
  };

  return {
    db,

    createWorkflow(w) {
      const id = ids.newId('wf');
      const ts = now();
      db.prepare(
        `INSERT INTO workflows (id, parent_id, kind, title, status, owner, meta, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, w.parentId ?? null, w.kind, w.title, w.status ?? 'running', w.owner ?? null, JSON.stringify(w.meta ?? {}), ts, ts);
      return getWorkflowById(id)!;
    },

    getWorkflow(id) {
      const r = db.prepare('SELECT * FROM workflows WHERE id=?').get(id);
      return r ? rowToWorkflow(r as Row) : null;
    },

    listWorkflows(limit = 100, status?) {
      // rowid order as a tiebreaker: workflows created in the same second
      // still keep a stable newest → oldest order.
      // Status equality filter (NEW-2): narrow before the window — otherwise
      // long-running workflows get pushed out of the LIMIT window by newly
      // created ones (the CLI's session→case-file lookup for reassignment is
      // exactly this shape).
      if (status !== undefined && status !== '') {
        return (db.prepare('SELECT * FROM workflows WHERE status=? ORDER BY created_at DESC, rowid DESC LIMIT ?')
          .all(status, limit) as Row[]).map(rowToWorkflow);
      }
      return (db.prepare('SELECT * FROM workflows ORDER BY created_at DESC, rowid DESC LIMIT ?')
        .all(limit) as Row[]).map(rowToWorkflow);
    },

    setWorkflowSession(id, session) {
      db.prepare('UPDATE workflows SET session=?, updated_at=? WHERE id=?').run(session, now(), id);
    },
    setWorkflowStatus(id, status) {
      db.prepare('UPDATE workflows SET status=?, updated_at=? WHERE id=?').run(status, now(), id);
      // Terminal cascade: close out in-flight runs too (aligned with the Go
      // terminal transition), otherwise activeRunForSession / reconciliation
      // would be polluted by zombie runs of completed workflows.
      // Intake desk (0920): queued is a new non-terminal status — the
      // criterion changed from "not running" to a terminal whitelist;
      // otherwise enqueuing would wrongly close in-flight runs.
      if (TERMINAL_WORKFLOW_STATUSES.includes(status)) {
        const runStatus = status === 'failed' ? 'failed' : 'completed';
        db.prepare(`UPDATE runs SET status=? WHERE workflow_id=? AND status IN ('running','idle')`)
          .run(runStatus, id);
      }
    },

    updateWorkflowMeta(id, patch) {
      const row = db.prepare(`SELECT COALESCE(meta,'{}') AS v FROM workflows WHERE id=?`).get(id);
      const cur = asRecord(safeParse(str(row?.['v'])));
      const merged: Record<string, JsonValue> = { ...cur };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      db.prepare('UPDATE workflows SET meta=?, updated_at=? WHERE id=?')
        .run(JSON.stringify(merged), now(), id);
      return merged;
    },

    setWorkflowRouting(id, session, project) {
      db.prepare('UPDATE workflows SET session=?, project=?, updated_at=? WHERE id=?')
        .run(session || null, project || null, now(), id);
    },

    assignThread(workflowId, threadId) {
      if (threadId === '') return;
      db.prepare('UPDATE workflows SET thread_id=?, updated_at=? WHERE id=?')
        .run(threadId, now(), workflowId);
    },

    latestByMessageId(messageId, excludeWorkflowId) {
      if (messageId === '') return null;
      const r = db.prepare(
        `SELECT * FROM workflows WHERE json_extract(meta,'$.message_id')=?
           AND (? IS NULL OR id != ?)
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      ).get(messageId, excludeWorkflowId ?? null, excludeWorkflowId ?? '');
      return r ? rowToWorkflow(r as Row) : null;
    },

    recentBySender(from, sinceIso, excludeWorkflowId, limit = 200) {
      return (db.prepare(
        `SELECT * FROM workflows WHERE status != 'rejected'
           AND lower(COALESCE(json_extract(meta,'$.from'),'')) = lower(?)
           AND created_at >= ?
           AND (? IS NULL OR id != ?)
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      ).all(from, sinceIso, excludeWorkflowId ?? null, excludeWorkflowId ?? '', limit) as Row[]).map(rowToWorkflow);
    },

    loadCaseFile(id) {
      const row = db.prepare('SELECT COALESCE(case_file,\'\') AS v FROM workflows WHERE id=?').get(id);
      return parseCaseFile(str(row?.['v']) || null, clock.now());
    },

    saveCaseFile(id, cf) {
      db.prepare('UPDATE workflows SET case_file=?, updated_at=? WHERE id=?')
        .run(serializeCaseFile(cf), now(), id);
    },

    createStep(s) {
      const id = ids.newId('st');
      db.prepare(
        `INSERT INTO workflow_steps (id, workflow_id, seq, kind, title, status, input, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      ).run(id, s.workflowId, s.seq, s.kind, s.title, JSON.stringify(s.input ?? {}), now());
      return getStepById(id)!;
    },
    insertStepsAt(workflowId, afterSeq, steps) {
      if (steps.length === 0) return;
      const insert = db.prepare(
        `INSERT INTO workflow_steps (id, workflow_id, seq, kind, title, status, input, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      );
      const shift = db.prepare(
        'UPDATE workflow_steps SET seq = seq + ? WHERE workflow_id = ? AND seq >= ?',
      );
      db.exec('BEGIN');
      try {
        shift.run(steps.length, workflowId, afterSeq + 1);
        steps.forEach((st, i) => {
          insert.run(ids.newId('st'), workflowId, afterSeq + 1 + i, st.kind, st.title,
            JSON.stringify(st.input ?? {}), now());
        });
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    getStep(id) {
      const r = db.prepare(`SELECT ${STEP_COLS} FROM workflow_steps WHERE id=?`).get(id);
      return r ? rowToStep(r as Row) : null;
    },

    stepsForWorkflow(id) {
      return (db.prepare(`SELECT ${STEP_COLS} FROM workflow_steps WHERE workflow_id=? ORDER BY seq`)
        .all(id) as Row[]).map(rowToStep);
    },

    currentStep(id) {
      const r = db.prepare(
        `SELECT ${STEP_COLS} FROM workflow_steps
         WHERE workflow_id=? AND status IN (${sqlInList(ACTIVE_STEP_STATUSES)}) ORDER BY seq LIMIT 1`,
      ).get(id);
      return r ? rowToStep(r as Row) : null;
    },

    setStepStatus(id, status) {
      // Status transitions record timing as a side effect: the first
      // transition out of pending = started (a gate's waiting_human also
      // counts as "started"); the first arrival at a terminal status =
      // completed.
      db.prepare(`UPDATE workflow_steps SET status=?, updated_at=?,
        started_at=COALESCE(started_at, CASE WHEN ? NOT IN ('pending') THEN ? END),
        completed_at=CASE WHEN ? IN (${sqlInList(TERMINAL_STEP_STATUSES)})
          THEN COALESCE(completed_at, ?) ELSE completed_at END
        WHERE id=?`).run(status, now(), status, now(), status, now(), id);
    },

    setStepInput(id, patch) { mergeStepJson(id, 'input', patch); },

    insertRelay(r) {
      const id = ids.newId('relay');
      db.prepare(`INSERT INTO relays (id, workflow_id, step_id, session, text, marker, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, r.workflowId, r.stepId, r.session, r.text, r.marker, now());
      return id;
    },
    pendingRelays() {
      return (db.prepare(`SELECT id, workflow_id, step_id, session, text, marker, created_at, attempts,
          COALESCE(last_error,'') AS last_error FROM relays WHERE delivered_at IS NULL ORDER BY created_at`).all() as Row[]).map((r) => ({
        id: str(r['id']), workflowId: str(r['workflow_id']), stepId: str(r['step_id']),
        session: str(r['session']), text: str(r['text']), marker: str(r['marker']),
        createdAt: str(r['created_at']), attempts: num(r['attempts']), lastError: str(r['last_error']),
      }));
    },
    markRelayDelivered(id) {
      db.prepare('UPDATE relays SET delivered_at=? WHERE id=?').run(now(), id);
    },
    markRelayAttempt(id, error) {
      db.prepare('UPDATE relays SET attempts=attempts+1, last_error=? WHERE id=?').run(error.slice(0, 300), id);
    },
    setStepOutput(id, patch) { mergeStepJson(id, 'output', patch); },

    appendStepOutputItem(id, key, entry, cap) {
      // Read-append-trim-write in one go: a synchronous section on par with
      // mergeStepJson, with no await in between — concurrent hook events
      // cannot overwrite each other (the cap trim keeps the most recent
      // entries at the tail).
      const row = db.prepare(`SELECT COALESCE(output,'{}') AS v FROM workflow_steps WHERE id=?`).get(id);
      const cur = asRecord(safeParse(str(row?.['v'])));
      const arr: JsonValue[] = Array.isArray(cur[key]) ? [...cur[key] as JsonValue[], entry] : [entry];
      const next = cap > 0 && arr.length > cap ? arr.slice(arr.length - cap) : arr;
      db.prepare('UPDATE workflow_steps SET output=?, updated_at=? WHERE id=?')
        .run(JSON.stringify({ ...cur, [key]: next }), now(), id);
    },

    claimRunningStep(id) {
      const res = db.prepare(
        `UPDATE workflow_steps SET status='completed', updated_at=?,
           completed_at=COALESCE(completed_at, ?) WHERE id=? AND status='running'`,
      ).run(now(), now(), id);
      return Number(res.changes) === 1;
    },

    listSteps(status, limit = 100) {
      return (db.prepare(
        `SELECT ${STEP_COLS} FROM workflow_steps WHERE status=? ORDER BY updated_at DESC LIMIT ?`,
      ).all(status, limit) as Row[]).map(rowToStep);
    },

    runningAgentStepForSession(session) {
      // Primary path: reverse lookup via runs rows (the engine always creates
      // a run at dispatch). Column names in the JOIN must be qualified (a
      // bare `id` would collide with the workflows/runs ids).
      const r = db.prepare(
        `SELECT st.id AS id, st.workflow_id AS workflow_id, st.seq AS seq, st.kind AS kind,
                COALESCE(st.title,'') AS title, st.status AS status,
                COALESCE(st.input,'') AS input, COALESCE(st.output,'') AS output,
                COALESCE(st.summary,'') AS summary, st.updated_at AS updated_at
         FROM workflow_steps st
         JOIN workflows w ON w.id = st.workflow_id
         JOIN runs r ON r.workflow_id = st.workflow_id
         WHERE st.status='running' AND st.kind IN (${sqlInList(AGENT_STEP_KINDS)}) AND r.session=? AND w.status='running'
         ORDER BY st.updated_at DESC LIMIT 1`,
      ).get(session);
      if (r) return rowToStep(r as Row);
      // Fallback (2026-09-14 wf_994b0eb399ab broken chain): steps that
      // bypassed engine dispatch have no runs row; if the Stop hook trusted
      // only runs it would never find the running step — the agent finished,
      // the engine never knew, the gate never opens. Fall back to the
      // workflow's first-class session fields (session /
      // meta.assigned_session, same sources as claimedContainerFor).
      const r2 = db.prepare(
        `SELECT st.id AS id, st.workflow_id AS workflow_id, st.seq AS seq, st.kind AS kind,
                COALESCE(st.title,'') AS title, st.status AS status,
                COALESCE(st.input,'') AS input, COALESCE(st.output,'') AS output,
                COALESCE(st.summary,'') AS summary, st.updated_at AS updated_at
         FROM workflow_steps st
         JOIN workflows w ON w.id = st.workflow_id
         WHERE st.status='running' AND st.kind IN (${sqlInList(AGENT_STEP_KINDS)}) AND w.status='running'
           AND (w.session=? OR COALESCE(json_extract(w.meta,'$.assigned_session'),'')=?)
         ORDER BY st.updated_at DESC LIMIT 1`,
      ).get(session, session);
      return r2 ? rowToStep(r2 as Row) : null;
    },

    sessionHasOpenWork(session, excludeWorkflowId) {
      // Union of three anchors (2026-09-30): the session column (anchored at
      // seeding; queued counts too) / meta.assigned_session (historical
      // fallback) / runs rows (the dispatch fact — legacy orders and test
      // setups only have runs). Terminal orders are kept out by the status
      // filter, so the wide anchors can't misfire.
      const anchor = '(session=?1 OR COALESCE(json_extract(meta,\'$.assigned_session\'),\'\')=?1'
        + ' OR id IN (SELECT workflow_id FROM runs WHERE session=?1))';
      const sql = excludeWorkflowId !== undefined && excludeWorkflowId !== ''
        ? `SELECT COUNT(*) AS n FROM workflows WHERE status IN ('queued','running') AND ${anchor} AND id != ?2`
        : `SELECT COUNT(*) AS n FROM workflows WHERE status IN ('queued','running') AND ${anchor}`;
      const row = excludeWorkflowId !== undefined && excludeWorkflowId !== ''
        ? db.prepare(sql).get(session, excludeWorkflowId) as Row
        : db.prepare(sql).get(session) as Row;
      return Number(row['n']) > 0;
    },

    appendEvent(entityType, entityId, type, payload = {}) {
      const ts = now();
      const res = db.prepare(
        'INSERT INTO events (entity_type, entity_id, type, payload, ts) VALUES (?, ?, ?, ?, ?)',
      ).run(entityType, entityId, type, JSON.stringify(payload), ts);
      return {
        id: Number(res.lastInsertRowid), entityType, entityId, type, payload, ts,
      };
    },

    listEvents(limit = 200, types?: readonly string[]) {
      // Type-filtered replay (2026-09-22 routing graph): rare events
      // (route_*, barely a dozen rows in the ledger) were buried deep beyond
      // the 120k-row window — with the filter the limit is spent entirely on
      // that type, making the real history reachable.
      if (types !== undefined && types.length > 0) {
        const ph = types.map(() => '?').join(',');
        return (db.prepare(`SELECT * FROM events WHERE type IN (${ph}) ORDER BY id DESC LIMIT ?`)
          .all(...types, limit) as Row[]).map(rowToEvent);
      }
      return (db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit) as Row[])
        .map(rowToEvent);
    },

    eventsSince(afterId, limit = 200) {
      return (db.prepare('SELECT * FROM events WHERE id>? ORDER BY id ASC LIMIT ?')
        .all(afterId, limit) as Row[]).map(rowToEvent);
    },

    entityEvents(entityType, entityId, type, limit = 500) {
      return (db.prepare(
        'SELECT * FROM events WHERE entity_type=? AND entity_id=? AND type=? ORDER BY id ASC LIMIT ?',
      ).all(entityType, entityId, type, limit) as Row[]).map(rowToEvent);
    },

    lastEventAt(entityType, entityId) {
      const r = db.prepare(
        'SELECT MAX(ts) AS m FROM events WHERE entity_type=? AND entity_id=?',
      ).get(entityType, entityId) as Row | undefined;
      const m = r?.['m'];
      return m === null || m === undefined ? '' : String(m);
    },

    createRun(workflowId, session) {
      const id = ids.newId('run');
      db.prepare(`INSERT INTO runs (id, workflow_id, session, status, created_at)
        VALUES (?, ?, ?, 'running', ?)`).run(id, workflowId, session, now());
      return {
        id, workflowId, session, status: 'running' as const, createdAt: now(),
      };
    },

    activeRunForSession: (session) => activeRunOf(session),

    /** Active dedup: same dedup_key and the workflow still in flight → skip
     * creating a duplicate. ⚠ ESCAPE '\' must pair with the escaping: a
     * message-id almost always contains `_`; without ESCAPE, `\_` becomes
     * "literal backslash + any character", the pattern never matches — and
     * dedup fails wholesale (09-07 incident). */
    hasActiveDedup(key: string): boolean {
      // Intake desk (0920): queued is also in flight — when the same message
      // arrives while the previous one is still queued awaiting dispatch, it
      // must count as "already in flight" to block the second one, or the
      // queue tail keeps growing.
      const r = db.prepare(
        `SELECT 1 FROM workflows WHERE status IN (${sqlInList(DEDUP_WINDOW_STATUSES)})
         AND meta LIKE ? ESCAPE '\\' LIMIT 1`,
      ).get(dedupPattern(key));
      return r !== undefined;
    },

    /** Ingested dedup (polling layer): any non-rejected workflow with the same
     * dedup_key → this email has already been handled (failed included);
     * polling won't fetch it again. Retries go through step retry, not
     * re-ingestion. */
    hasSeenDedup(key: string): boolean {
      const r = db.prepare(
        `SELECT 1 FROM workflows WHERE status != 'rejected'
         AND meta LIKE ? ESCAPE '\\' LIMIT 1`,
      ).get(dedupPattern(key));
      return r !== undefined;
    },

    /** Self-loop guard query (2026-09-20 breakpoint 13): does the message_id
     * hit a record this engine already sent — the output.message_id of a
     * completed send step (booked from the same source as email_sent events)?
     * The intake layer uses this to discard delivery-copy feedback (the echo
     * of the engine mailing the polling mailbox itself). LIKE prefilter +
     * exact comparison: JSON-encode to the actually stored bytes; %/_/\ are
     * escaped in pairs like dedupPattern (a message-id almost always contains
     * `_`). */
    recordSentMessageId(messageId: string, meta?: { to?: string; subject?: string }): void {
      if (messageId === '') return;
      db.prepare(
        `INSERT INTO events (entity_type, entity_id, type, payload, ts) VALUES ('email', ?, 'email_sent', ?, ?)`,
      ).run(messageId, JSON.stringify(meta ?? {}), now());
    },

    sentMessageIdExists(messageId: string): boolean {
      if (messageId === '') return false;
      // Full outbound record: send steps (the existing LIKE path) + outbound
      // registration (the exact events path, covering notification emails).
      const registered = db.prepare(
        `SELECT 1 FROM events WHERE type = 'email_sent' AND entity_type = 'email' AND entity_id = ? LIMIT 1`,
      ).get(messageId);
      if (registered !== undefined) return true;
      // LIKE path windowing (2026-09-20 P3): send steps completed after the
      // mailer seam's full outbound registration went live (commit window of
      // 2026-09-19) are necessarily already on the exact events path — LIKE
      // only serves earlier historical send steps, so the updated_at window
      // excludes new rows and ledger growth no longer amplifies this full
      // table scan (self-loop guard semantics unchanged).
      const jsonValue = JSON.stringify(messageId).slice(1, -1);
      const pattern = `%"message_id":"${jsonValue.replace(/[%_\\]/g, (c) => `\\${c}`)}"%`;
      const rows = db.prepare(
        `SELECT output FROM workflow_steps WHERE kind = 'send' AND status = 'completed'
         AND updated_at < ? AND output LIKE ? ESCAPE '\\'`,
      ).all(SEND_STEP_LIKE_CUTOFF, pattern) as Row[];
      return rows.some((r) => {
        const out = safeParse(str(r['output']));
        return out !== null && typeof out === 'object' && !Array.isArray(out)
          && (out as JsonRecord)['message_id'] === messageId;
      });
    },

    createPrompt(runId, content, source) {
      const id = ids.newId('pr');
      db.prepare(`INSERT INTO prompts (id, run_id, content, source, status, created_at)
        VALUES (?, ?, ?, ?, 'submitted', ?)`).run(id, runId, content, source, now());
      return { id, runId, content, status: 'submitted' as const, createdAt: now() };
    },

    prune(retentionDays: number) {
      return pruneImpl(db, retentionDays, now());
    },

    taskViews(limit = 500) {
      const all = (db.prepare('SELECT * FROM workflows ORDER BY created_at DESC, rowid DESC LIMIT ?')
        .all(limit) as Row[]).map(rowToWorkflow);
      const byId = new Map(all.map((w) => [w.id, w]));
      // Chain links: the related_workflow declared at flow start takes
      // priority, parent_id (the lineage column startTask writes) is the
      // fallback — both point at the same task card, but historical rows may
      // carry only one of them.
      const parentOf = (w: Workflow): string => {
        const rel = w.meta['related_workflow'];
        if (typeof rel === 'string' && rel !== '') return rel;
        return w.parentId ?? '';
      };
      // Task-card criterion: mode=nodes written by engine.startTask (the only writer).
      const isTaskCard = (w: Workflow): boolean => w.meta['mode'] === 'nodes';
      // rootOf: walk up the chain to the top and take the "highest task
      // card" as the root; a chain with no task card at all → '' (a plain
      // email flow belongs to no Task). Cycle-guarded; each node on the path
      // gets the root of its own chain segment (self→top), the highest task
      // card on it — an ancestor's chain is shorter than the query point's,
      // so roots cannot be shared (when a task card hangs under an email
      // order, the email order itself has no attribution); computed by a
      // top-down suffix scan.
      const rootCache = new Map<string, string>();
      const rootOf = (w: Workflow): string => {
        const cached = rootCache.get(w.id);
        if (cached !== undefined) return cached;
        const path: Workflow[] = [];
        let cur: Workflow | undefined = w;
        while (cur !== undefined && !path.some((p) => p.id === cur!.id)) {
          path.push(cur);
          const pid = parentOf(cur);
          if (pid === '') break;
          cur = byId.get(pid);
        }
        // Suffix scan: walking back from the chain top, "the highest task
        // card seen so far" = that node's root (the first hit wins — closer
        // to the top means higher, never overridden by a lower card).
        let best = '';
        for (let i = path.length - 1; i >= 0; i--) {
          const p = path[i]!;
          if (best === '' && isTaskCard(p)) best = p.id;
          rootCache.set(p.id, best);
        }
        return rootCache.get(w.id) ?? '';
      };
      const members = new Map<string, string[]>(); // taskId → workflowIds
      const map: Record<string, string> = {};
      for (const w of all) {
        const root = rootOf(w);
        if (root === '') continue;
        map[w.id] = root;
        const arr = members.get(root);
        if (arr === undefined) members.set(root, [w.id]);
        else arr.push(w.id);
      }
      // Views newest → oldest; member lists follow the ledger's newest → oldest (all is already created_at DESC).
      const views: TaskView[] = [...members.entries()]
        .map(([taskId, ids]) => {
          const card = byId.get(taskId)!;
          return { taskId, title: card.title, status: card.status, workflowIds: ids };
        })
        .sort((a, b) => {
          const ca = byId.get(a.taskId)?.createdAt ?? '';
          const cb = byId.get(b.taskId)?.createdAt ?? '';
          return cb.localeCompare(ca);
        });
      return { views, map };
    },

    latestPromptForSession(session, statuses) {
      const run = activeRunOf(session);
      if (!run) return null;
      const placeholders = statuses.map(() => '?').join(',');
      const r = db.prepare(
        `SELECT id, run_id, content, status, created_at FROM prompts
         WHERE run_id=? AND status IN (${placeholders}) ORDER BY created_at DESC LIMIT 1`,
      ).get(run.id, ...statuses);
      if (!r) return null;
      return {
        id: str(r['id']), runId: str(r['run_id']), content: str(r['content']),
        status: str(r['status']) as Prompt['status'], createdAt: str(r['created_at']),
      };
    },
  };
};

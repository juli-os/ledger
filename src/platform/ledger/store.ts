// 生命周期账本：SQLite（node:sqlite，零原生依赖）之上的持久边界。
// 与 Go internal/ledger/lifecycle 的 V1 表结构逐列对齐，历史数据可双读。
//
// 不变性策略：本 store 是系统唯一的可变边界；所有 JSON 列的更新都是
// 读-合并-写（node:sqlite 同步驱动，读写之间不可能被并发插入），引擎与
// HTTP 层拿到的都是冻结快照。状态转变只经显式方法发生，绝不整行 DELETE。

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
  // 对话（Thread）建档与匹配查询：engine 只调方法，SQL 留在本层。
  /** 归组：把 workflow 挂到线程（首次建档或继承）。threadId 为空串 = 拒绝。 */
  assignThread(workflowId: string, threadId: string): void;
  /** 进件匹配①：meta.message_id 精确反查最新单（in_reply_to 的因果锚）。
   * 不限状态——被拒的信也是对方在回复的那封。excludeWorkflowId = 本单
   * （新行已落库才跑匹配，不排除会自己匹配自己）。 */
  latestByMessageId(messageId: string, excludeWorkflowId?: string): Workflow | null;
  /** 进件匹配②候选集：同发件人（大小写不敏感）+ 时间窗内、非 rejected 的单，
   * 新→旧。主题归一化比对在 engine（SQL 表达不了「剥 Re:/回复：」），本层只收窄。 */
  recentBySender(from: string, sinceIso: string, excludeWorkflowId?: string, limit?: number): readonly Workflow[];
  // casefile
  loadCaseFile(id: string): CaseFileDoc;
  saveCaseFile(id: string, cf: CaseFileDoc): void;
  // steps
  createStep(s: {
    workflowId: string; seq: number; kind: StepKind; title: string; input?: JsonRecord;
  }): Step;
  /** 动态展开：在 afterSeq 之后插入若干步，既有 tail 顺延。单事务。 */
  insertStepsAt(workflowId: string, afterSeq: number, steps: readonly {
    kind: StepKind; title: string; input?: JsonRecord;
  }[]): void;
  getStep(id: string): Step | null;
  stepsForWorkflow(id: string): readonly Step[];
  currentStep(id: string): Step | null;
  setStepStatus(id: string, status: StepStatus): void;
  setStepInput(id: string, patch: JsonRecord): void;
  // 回流外发箱：批准=触发下一个 的持久化投递（送达销账，永丢不允许）。
  insertRelay(r: { workflowId: string; stepId: string; session: string; text: string; marker: string }): string;
  pendingRelays(): readonly { id: string; workflowId: string; stepId: string; session: string; text: string; marker: string; createdAt: string; attempts: number; lastError: string }[];
  markRelayDelivered(id: string): void;
  markRelayAttempt(id: string, error: string): void;
  setStepOutput(id: string, patch: JsonRecord): void;
  /** 原子数组追加：同一条语句序列内完成读-append-裁剪-写（node:sqlite
   * 同步 = 原子段）。recordActivity 的读-合并-写曾以陈旧快照覆盖并发条目。 */
  appendStepOutputItem(id: string, key: string, entry: JsonValue, cap: number): void;
  /** 原子 CAS：running→completed。返回 false = 已被其他路径结算（settle-once）。 */
  claimRunningStep(id: string): boolean;
  listSteps(status: StepStatus, limit?: number): readonly Step[];
  runningAgentStepForSession(session: string): Step | null;
  /** 忙闲谓词（2026-09-30 用户裁定重定义）：忙 = 名下存在非终态单——排队/
   * 在跑/停在闸门等批准都算；唯一闲 = 名下单子全部终态。锚定与
   * runningAgentStepForSession 兜底同源（session 列 / meta.assigned_session /
   * runs 行），queued 期的锚定靠进件播种时即写 session 列。消费方：派发面
   * 忙闲改道、路由图占用、routeTask 落点判定（要「正在跑那一步」本体的
   * 僵尸看门狗/结算不走这里）。excludeWorkflowId 供派发面自排除——本单
   * 自己就锚在目标会话且非终态，不排除=每次派发都自触发改道。 */
  sessionHasOpenWork(session: string, excludeWorkflowId?: string): boolean;
  // events
  appendEvent(entityType: 'workflow' | 'step' | 'judgment' | 'agent', entityId: string, type: string, payload?: JsonRecord): LedgerEvent;
  listEvents(limit?: number, types?: readonly string[]): readonly LedgerEvent[];
  eventsSince(afterId: number, limit?: number): readonly LedgerEvent[];
  /** per-entity 事件查询（P2-5）：WHERE entity_type+entity_id+type 的全史回放，
   * 走 idx_events_entity 索引——守卫类消费者（乒乓守卫）不再受 listEvents
   * 全库窗口限制（entityId 过滤在窗口之后，早事件会被挤出窗外漏判）。 */
  entityEvents(entityType: LedgerEvent['entityType'], entityId: string, type: string, limit?: number): readonly LedgerEvent[];
  /** 该实体最后一条事件的 ts（无事件返回空串）。计费窗口延伸的「run 最后
   * 活动」锚点：在途单的回流执行回合不断落 session_turn 等事件，MAX(ts)
   * 即活动前沿（走 idx_events_entity 索引）。 */
  lastEventAt(entityType: LedgerEvent['entityType'], entityId: string): string;
  // runs & prompts
  createRun(workflowId: string, session: string): Run;
  hasActiveDedup(key: string): boolean;
  /** 轮询层去重：任何非 rejected 工作流含此 dedup_key 即视为已摄取。 */
  hasSeenDedup(key: string): boolean;
  /** 自回环守卫（断点十三）：message_id 命中 completed send 步 output.message_id。 */
  sentMessageIdExists(messageId: string): boolean;
  /** 全量出站邮件登记（2026-09-20 幽灵单缺口）：send 步之外，通知邮件
   * （emailNotifier）等所有出站信的 message_id 也进查询面——发给轮询
   * 邮箱自身的告警信不再被当新来信建单（[juli] 待审批 幽灵单）。 */
  recordSentMessageId(messageId: string, meta?: { to?: string; subject?: string }): void;
  activeRunForSession(session: string): Run | null;
  createPrompt(runId: string, content: string, source: string): Prompt;
  latestPromptForSession(session: string, statuses: readonly Prompt['status'][]): Prompt | null;
  /** 修剪：events 超期删除；终态（completed/cancelled/rejected）工作流超期连同步骤删除，
   * failed 一律保留（事故语义）。返回删除行数。 */
  prune(retentionDays: number): { events: number; workflows: number };
  /** Task 投影（第四期最小转正 2026-09-22）：Task 继续不建新表——任务卡
   * （meta.mode='nodes' 的单，engine.startTask 建）+ related_workflow/parent_id
   * 链聚成「一 Task 多流水」视图。返回任务卡视图（新→旧）与
   * workflowId→taskId 归属表（无任务卡祖先的单如普通邮件流不进表）。
   * 根判据：沿链向上最高的任务卡；任务卡挂在邮件单下（方向修正链）时根=
   * 任务卡自身——邮件单不是任务卡，不吞并。展示级投影，默认扫最近 500 单。 */
  taskViews(limit?: number): { readonly views: readonly TaskView[]; readonly map: Readonly<Record<string, string>> };
}

type Row = Record<string, string | number | bigint | null | Uint8Array>;

const str = (v: string | number | bigint | null | Uint8Array | undefined): string =>
  typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
const num = (v: string | number | bigint | null | Uint8Array | undefined): number =>
  typeof v === 'number' ? v : Number(v ?? 0);

/** meta JSON 里的 dedup_key LIKE 模式，必须配 `ESCAPE '\'` 使用。
 * 两步：先取 JSON 实际存储字节（`"`→`\"` 等由 JSON 编码），再对 LIKE 特殊字符
 * （`\ % _`）转义——引号本身在 LIKE 里无特殊义，转义的是 JSON 加的那道反斜杠。 */
const dedupPattern = (key: string): string => {
  const jsonValue = JSON.stringify(key).slice(1, -1);
  return `%"dedup_key":"${jsonValue.replace(/[%_\\]/g, (c) => `\\${c}`)}"%`;
};

/** sentMessageIdExists LIKE 路的时间窗（rfc3339 字符串序比较）：mailer seam
 * 全量出站登记上线（2026-09-19 commit 窗）之前的 completed send 步才走
 * LIKE——之后的出站信全部在 events 精确路。 */
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
  // 终态工作流清理（连步骤）：名单见 statuses.ts PRUNE_WORKFLOW_STATUSES
  // （failed 保留——事故语义）。
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
  // V2 预留：owner 列支撑未来多租户/多操作员（可空，零行为变化）。
  // 现在加列是零成本，事后加列在有数据的表上是手术。
  const wfCols = (db.prepare("PRAGMA table_info(workflows)").all() as { name: string }[]).map((c) => c.name);
  if (!wfCols.includes('owner')) {
    db.exec('ALTER TABLE workflows ADD COLUMN owner TEXT');
  }
  // 对话（Thread）一等建模（2026-09-21 二期）：邮件回复链共享 thread_id——
  // 追加可空列合法（行内容不可变纪律只禁改写，不禁加列），索引服务看板归组。
  if (!wfCols.includes('thread_id')) {
    db.exec('ALTER TABLE workflows ADD COLUMN thread_id TEXT');
  }
  // 索引必须在加列之后建：MIGRATIONS 段跑在建表时，thread_id 还不存在。
  db.exec('CREATE INDEX IF NOT EXISTS idx_workflows_thread ON workflows(thread_id)');
  // 步骤时序（started/completed）：存量库补列——节点时序此前只能靠事件流
  // 重放（goShape 自认 created_at 是假的）；列允许 NULL 兼容历史行。
  const stepCols = (db.prepare("PRAGMA table_info(workflow_steps)").all() as { name: string }[]).map((c) => c.name);
  if (!stepCols.includes('started_at')) db.exec('ALTER TABLE workflow_steps ADD COLUMN started_at TEXT');
  if (!stepCols.includes('completed_at')) db.exec('ALTER TABLE workflow_steps ADD COLUMN completed_at TEXT');
  const now = (): string => rfc3339(clock.now());

  // JSON 列的读-合并-写（同步驱动下即原子）。
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
      // rowid 次序兜底：同秒创建的工作流也保持稳定的新→旧序。
      // status 等值过滤（NEW-2）：在窗口之前收窄——否则长跑 running 单会被
      // 新建单挤出 LIMIT 窗（CLI 转派的会话→案卷查找正是这个形态）。
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
      // 终态级联：在飞 run 一并收口（对齐 Go 的 terminal 转变），否则
      // activeRunForSession/对账会被已完成工作流的僵尸 run 污染。
      // 收单台（0920）：queued 是新非终态——判据从「非 running」改为终态
      // 白名单，否则入队即误收口在飞 run。
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
      // 状态转变顺带记时序：离开 pending 的第一次转变 = started（闸门的
      // waiting_human 也是"开跑"）；终态第一次到达 = completed。
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
      // 读-append-裁剪-写一气呵成：与 mergeStepJson 同级的同步段，中间没有
      // 任何 await——并发 hook 事件不会互相覆盖（cap 裁剪保尾部最近条目）。
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
      // 主路：runs 行反查（引擎派发时必建 run）。JOIN 下列名必须限定
      // （裸 `id` 会撞上 workflows/runs 的 id）。
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
      // 兜底（2026-09-14 wf_994b0eb399ab 断链）：绕过引擎派发的步骤没有
      // runs 行，Stop hook 报到时若只认 runs 就永远找不到在跑步骤——agent
      // 干完了、引擎不知道、闸门永不打开。退回 workflow 的一等会话字段
      // （session / meta.assigned_session，与 claimedContainerFor 同源）。
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
      // 三锚点并集（2026-09-30）：session 列（播种即锚，queued 也占）/
      // meta.assigned_session（历史兜底）/ runs 行（派发事实——老单与测试
      // 造法只有 runs）。终态单被 status 过滤挡在门外，锚点宽不会误伤。
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
      // 类型过滤回放（2026-09-22 路由图）：稀有事件（route_*，账本里只有十几条）
      // 深埋在 12 万行窗口之外——过滤后 limit 全部花在该类型上，真实历史可达。
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

    /** 活跃去重：同 dedup_key 且工作流仍在途 → 跳过重复建流。
     * ⚠ ESCAPE '\' 必须与转义成对：message-id 几乎必含 `_`，漏写 ESCAPE 时
     * `\_` 成了"字面反斜杠+任意字符"，模式永不匹配——去重整体失效（09-07 事故）。 */
    hasActiveDedup(key: string): boolean {
      // 收单台（0920）：queued 也是在途——同信到达时若上一封还在队里等派发，
      // 必须算「已有在途」挡住第二张，否则队尾越排越长。
      const r = db.prepare(
        `SELECT 1 FROM workflows WHERE status IN (${sqlInList(DEDUP_WINDOW_STATUSES)})
         AND meta LIKE ? ESCAPE '\\' LIMIT 1`,
      ).get(dedupPattern(key));
      return r !== undefined;
    },

    /** 已摄取去重（轮询层）：同 dedup_key 存在任何非 rejected 工作流 → 这封
     * 邮件已被处理过（含 failed），轮询不再重复拉取。重试走步骤 retry，不走再摄取。 */
    hasSeenDedup(key: string): boolean {
      const r = db.prepare(
        `SELECT 1 FROM workflows WHERE status != 'rejected'
         AND meta LIKE ? ESCAPE '\\' LIMIT 1`,
      ).get(dedupPattern(key));
      return r !== undefined;
    },

    /** 自回环守卫查询（2026-09-20 断点十三）：message_id 是否命中本引擎已
     * 发送记录——completed send 步的 output.message_id（email_sent 事件同源
     * 落账）。进件层据此丢弃投递副本回灌（引擎给轮询邮箱自己发信的 echo）。
     * LIKE 预筛 + 精确比对：JSON 编码取实际存储字节，%/_/\ 照 dedupPattern
     * 成对转义（message-id 几乎必含 `_`）。 */
    recordSentMessageId(messageId: string, meta?: { to?: string; subject?: string }): void {
      if (messageId === '') return;
      db.prepare(
        `INSERT INTO events (entity_type, entity_id, type, payload, ts) VALUES ('email', ?, 'email_sent', ?, ?)`,
      ).run(messageId, JSON.stringify(meta ?? {}), now());
    },

    sentMessageIdExists(messageId: string): boolean {
      if (messageId === '') return false;
      // 全量出站记录：send 步（既有 LIKE 路）+ 出站登记（events 精确路，
      // 盖通知邮件）。
      const registered = db.prepare(
        `SELECT 1 FROM events WHERE type = 'email_sent' AND entity_type = 'email' AND entity_id = ? LIMIT 1`,
      ).get(messageId);
      if (registered !== undefined) return true;
      // LIKE 路限窗（2026-09-20 P3）：mailer seam 全量出站登记上线
      // （2026-09-19 commit 窗）之后完成的 send 步必然已在 events 精确路——
      // LIKE 只服务更早的历史 send 步，故按 updated_at 限窗排除新行，账本
      // 增长不再放大这条全表扫描（自回环守卫语义不变）。
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
      // 挂链：起流声明的 related_workflow 优先，parent_id（startTask 落的
      // 血缘列）兜底——两处同指一张任务卡，历史行可能只占其一。
      const parentOf = (w: Workflow): string => {
        const rel = w.meta['related_workflow'];
        if (typeof rel === 'string' && rel !== '') return rel;
        return w.parentId ?? '';
      };
      // 任务卡判据：engine.startTask 落的 mode=nodes（唯一写入方）。
      const isTaskCard = (w: Workflow): boolean => w.meta['mode'] === 'nodes';
      // rootOf：沿链向上走到顶，取「最高的任务卡」为根；全链无任务卡 → ''
      // （普通邮件流不属任何 Task）。带环守卫；路径上每个节点的根=各自
      // 链段（自身→顶）的最高任务卡——祖先的链比查询点短，不能共享根
      // （任务卡挂在邮件单下时，邮件单自己无归属），自顶向下后缀扫出。
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
        // 后缀扫描：从链顶往回，「到此为止见过的最高任务卡」= 该节点的根
        // （首个命中即定——越靠链顶越高，不被低位卡覆盖）。
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
      // 视图新→旧；成员列表按账本新→旧对齐（all 本身已按 created_at DESC）。
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

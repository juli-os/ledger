// L1 多租户地基 tests (2026-11-08): tenant column migration on old-schema DBs,
// row-mapping default, per-tenant list filters, idempotent setWorkflowTenant.
// Style mirrors regression.test.ts: node:test, temp DB files, zero npm deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLedgerStore } from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'peel-l1-tenant-'));

// 生产旧库的真实 schema（PRAGMA table_info 实录）：有 owner/thread_id、无 tenant。
const OLD_SCHEMA = `
CREATE TABLE workflows (
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
  updated_at TEXT NOT NULL,
  owner TEXT,
  thread_id TEXT
);
`;

const buildOldDb = (path: string, rows: { id: string; title: string }[]): void => {
  const db = new DatabaseSync(path);
  db.exec(OLD_SCHEMA);
  for (const r of rows) {
    db.prepare(
      `INSERT INTO workflows (id, kind, title, status, meta, created_at, updated_at)
       VALUES (?, 'case', ?, 'running', '{}', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')`,
    ).run(r.id, r.title);
  }
  db.close();
};

test('old DB without tenant column upgrades on open: rows read internal', () => {
  const path = join(dir, 'old-schema.db');
  buildOldDb(path, [
    { id: 'wf_old_a', title: 'legacy a' },
    { id: 'wf_old_b', title: 'legacy b' },
  ]);
  const store = createLedgerStore(path);
  assert.equal(store.getWorkflow('wf_old_a')!.tenant, 'internal', 'legacy row maps to internal');
  assert.equal(store.getWorkflow('wf_old_b')!.tenant, 'internal');
  assert.equal(store.listWorkflows(100).every((w) => w.tenant === 'internal'), true);
  // 列与索引各恰好一份（CREATE IF NOT EXISTS + PRAGMA 守卫不重复加）。
  const tenantCols = (store.db.prepare('PRAGMA table_info(workflows)').all() as { name: string }[])
    .filter((c) => c.name === 'tenant');
  assert.equal(tenantCols.length, 1, 'tenant column added exactly once');
  const idx = store.db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_workflows_tenant'",
  ).all();
  assert.equal(idx.length, 1, 'idx_workflows_tenant created exactly once');
});

test('reopen the same DB: no duplicate column, no duplicate index', () => {
  const path = join(dir, 'reopen.db');
  buildOldDb(path, [{ id: 'wf_reopen', title: 'reopen me' }]);
  createLedgerStore(path);
  const store = createLedgerStore(path);
  const tenantCols = (store.db.prepare('PRAGMA table_info(workflows)').all() as { name: string }[])
    .filter((c) => c.name === 'tenant');
  assert.equal(tenantCols.length, 1, 'second open must not re-add tenant');
  const idx = store.db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_workflows_tenant'",
  ).all();
  assert.equal(idx.length, 1, 'second open must not re-create the tenant index');
  assert.equal(store.getWorkflow('wf_reopen')!.tenant, 'internal');
});

test('createWorkflow: tenant defaults internal, explicit tenant persists', () => {
  const store = createLedgerStore(join(dir, 'create.db'));
  const def = store.createWorkflow({ kind: 'case', title: 'default tenant' });
  assert.equal(def.tenant, 'internal');
  const reflex = store.createWorkflow({ kind: 'case', title: 'reflex tenant', tenant: 'reflex' });
  assert.equal(reflex.tenant, 'reflex');
  assert.equal(store.getWorkflow(reflex.id)!.tenant, 'reflex', 'tenant survives a round trip');
});

test('listWorkflows filters by tenant; legacy two-arg calls unchanged', () => {
  const store = createLedgerStore(join(dir, 'list-wf.db'));
  const a = store.createWorkflow({ kind: 'case', title: 'internal 1' });
  const b = store.createWorkflow({ kind: 'case', title: 'internal 2', status: 'completed' as never });
  const r = store.createWorkflow({ kind: 'case', title: 'reflex 1', tenant: 'reflex' });
  const r2 = store.createWorkflow({ kind: 'case', title: 'reflex 2', tenant: 'reflex', status: 'completed' as never });
  const reflexOnly = store.listWorkflows(100, undefined, 'reflex');
  assert.deepEqual(reflexOnly.map((w) => w.id).sort(), [r.id, r2.id].sort());
  const internalOnly = store.listWorkflows(100, undefined, 'internal');
  assert.deepEqual(internalOnly.map((w) => w.id).sort(), [a.id, b.id].sort());
  // tenant + status 组合过滤：窗口内再收窄。
  const reflexRunning = store.listWorkflows(100, 'running', 'reflex');
  assert.deepEqual(reflexRunning.map((w) => w.id), [r.id]);
  // 既有两参签名行为不变。
  const allRunning = store.listWorkflows(100, 'running');
  assert.equal(allRunning.length, 2, 'no tenant arg = unfiltered by tenant');
  assert.deepEqual(allRunning.map((w) => w.id).sort(), [a.id, r.id].sort());
});

test('listSteps filters by tenant via workflow join; legacy calls unchanged', () => {
  const store = createLedgerStore(join(dir, 'list-steps.db'));
  const wfInt = store.createWorkflow({ kind: 'case', title: 'internal flow' });
  const wfReflex = store.createWorkflow({ kind: 'case', title: 'reflex flow', tenant: 'reflex' });
  const s1 = store.createStep({ workflowId: wfInt.id, seq: 1, kind: 'agent' as never, title: 'int step' });
  const s2 = store.createStep({ workflowId: wfReflex.id, seq: 1, kind: 'agent' as never, title: 'reflex step' });
  const legacy = store.listSteps('pending');
  assert.equal(legacy.length, 2, 'no tenant arg = unfiltered by tenant');
  const reflexSteps = store.listSteps('pending', 100, 'reflex');
  assert.deepEqual(reflexSteps.map((s) => s.id), [s2.id]);
  assert.equal(reflexSteps[0]!.title, 'reflex step');
  const internalSteps = store.listSteps('pending', 100, 'internal');
  assert.deepEqual(internalSteps.map((s) => s.id), [s1.id]);
  assert.deepEqual(Object.keys(internalSteps[0]!).sort(),
    Object.keys(legacy[0]!).sort(), 'joined rows keep the Step shape');
});

test('setWorkflowTenant: change writes one event, same value is a no-op', () => {
  let now = new Date('2026-11-08T00:00:00Z');
  const store = createLedgerStore(join(dir, 'set-tenant.db'), { clock: { now: () => now } });
  const wf = store.createWorkflow({ kind: 'case', title: 'reassign me' });
  now = new Date('2026-11-08T00:01:00Z');
  store.setWorkflowTenant(wf.id, 'reflex');
  const changed = store.getWorkflow(wf.id)!;
  assert.equal(changed.tenant, 'reflex');
  assert.equal(changed.updatedAt, '2026-11-08T00:01:00Z');
  const events = store.entityEvents('workflow', wf.id, 'tenant_changed');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0]!.payload, { from: 'internal', to: 'reflex' });
  // 同值第二次：不写库、不发事件（updated_at 与事件数都不动）。
  now = new Date('2026-11-08T00:02:00Z');
  store.setWorkflowTenant(wf.id, 'reflex');
  assert.equal(store.getWorkflow(wf.id)!.updatedAt, '2026-11-08T00:01:00Z', 'no-op does not touch the row');
  assert.equal(store.entityEvents('workflow', wf.id, 'tenant_changed').length, 1, 'no-op emits no event');
  // 建档即 internal 的单改派回 internal 同样是 no-op；未知 id 不抛错。
  const wf2 = store.createWorkflow({ kind: 'case', title: 'already internal' });
  store.setWorkflowTenant(wf2.id, 'internal');
  assert.equal(store.entityEvents('workflow', wf2.id, 'tenant_changed').length, 0);
  assert.doesNotThrow(() => store.setWorkflowTenant('wf_missing', 'reflex'));
});

test('old DB: setWorkflowTenant migrates a legacy row, filters split the 354-style set', () => {
  const path = join(dir, 'old-set-tenant.db');
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: `wf_bulk_${i}`, title: `bulk ${i}` }));
  buildOldDb(path, rows);
  const store = createLedgerStore(path);
  store.setWorkflowTenant('wf_bulk_0', 'reflex');
  assert.equal(store.getWorkflow('wf_bulk_0')!.tenant, 'reflex');
  const reflex = store.listWorkflows(100, undefined, 'reflex');
  const internal = store.listWorkflows(100, undefined, 'internal');
  assert.equal(reflex.length, 1);
  assert.equal(internal.length, 4, 'other legacy rows stay internal');
  assert.equal(reflex.length + internal.length, 5, 'filters partition the whole set');
  assert.equal(store.entityEvents('workflow', 'wf_bulk_0', 'tenant_changed').length, 1);
});

// 空串不是合法租户（2026-11-09 修复回归）：入口归一为 internal，非法态不可
// 表达——否则行对 internal/reflex 过滤都不可见，且幂等守卫拿映射后的值比较。
test('setWorkflowTenant normalizes empty string to internal: filter-visible and idempotent', () => {
  let now = new Date('2026-11-08T00:00:00Z');
  const store = createLedgerStore(join(dir, 'set-tenant-empty.db'), { clock: { now: () => now } });
  const wf = store.createWorkflow({ kind: 'case', title: 'empty tenant set' });
  now = new Date('2026-11-08T00:01:00Z');
  store.setWorkflowTenant(wf.id, '');
  assert.equal(store.getWorkflow(wf.id)!.tenant, 'internal', "'' normalizes to internal");
  assert.equal(store.entityEvents('workflow', wf.id, 'tenant_changed').length, 0, "'' -> internal emits no event");
  // 行建档即 internal，归一后的空串改派是纯 no-op：不刷 updated_at。
  assert.equal(store.getWorkflow(wf.id)!.updatedAt, '2026-11-08T00:00:00Z', 'no-op does not touch the row');
  const internalOnly = store.listWorkflows(100, undefined, 'internal');
  assert.deepEqual(internalOnly.map((w) => w.id), [wf.id], 'row is visible under the internal filter');
  // 归一后再来一次空串：已是 internal，仍零事件、不动行。
  now = new Date('2026-11-08T00:02:00Z');
  store.setWorkflowTenant(wf.id, '');
  assert.equal(store.getWorkflow(wf.id)!.updatedAt, '2026-11-08T00:00:00Z', 'second call is a no-op');
  assert.equal(store.entityEvents('workflow', wf.id, 'tenant_changed').length, 0, 'still zero events');
});

test('createWorkflow with empty tenant string stores internal', () => {
  const store = createLedgerStore(join(dir, 'create-empty-tenant.db'));
  const wf = store.createWorkflow({ kind: 'case', title: 'empty tenant at create', tenant: '' });
  assert.equal(wf.tenant, 'internal', "'' tenant normalizes at the entry");
  assert.equal(store.getWorkflow(wf.id)!.tenant, 'internal', 'round trip keeps internal');
});

test('cleanup temp dir', () => {
  rmSync(dir, { recursive: true, force: true });
});

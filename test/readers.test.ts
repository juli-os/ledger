// 读侧正规出口（2026-11-11 ledger 关门）的行为测试：每个函数一个场景，
// 断言消费方能观察到的形状——主仓 http 层从直查 SQL 迁到这些函数。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLedgerStore } from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'ledger-readers-'));
let seq = 0;
const s = createLedgerStore(join(dir, 'l.db'), {
  clock: { now: () => new Date('2026-11-11T10:00:00Z') },
  ids: { newId: (p) => `${p}_${++seq}` },
});

test('workflowStats：按日/按状态/总数（since 边界为 UTC RFC3339）', () => {
  const w = s.createWorkflow({ kind: 'case', title: 'a' });
  s.setWorkflowStatus(w.id, 'completed');
  s.createWorkflow({ kind: 'case', title: 'b', status: 'completed' });
  const st = s.workflowStats('2026-11-10T00:00:00Z');
  assert.equal(st.total, 2);
  assert.equal(st.byStatus.find((x) => x.status === 'completed')?.count, 2);
  assert.equal(st.byDay.length, 1); // 同一 clock → 同一天
  assert.equal(s.workflowStats('2099-01-01T00:00:00Z').total, 2); // total 不受 since 影响（与原 stats 语义一致）
});

test('listFailedSteps：失败步带单标题，租户过滤', () => {
  const internal = s.createWorkflow({ kind: 'case', title: '内单' });
  const reflex = s.createWorkflow({ kind: 'case', title: '外单', tenant: 'reflex' });
  const st1 = s.createStep({ workflowId: internal.id, seq: 1, kind: 'agent', title: 'x' });
  const st2 = s.createStep({ workflowId: reflex.id, seq: 1, kind: 'agent', title: 'y' });
  s.setStepOutput(st1.id, { error: 'boom' });
  s.setStepStatus(st1.id, 'failed');
  s.setStepOutput(st2.id, { error: 'reflex boom' });
  s.setStepStatus(st2.id, 'failed');
  const all = s.listFailedSteps({ limit: 10 });
  assert.equal(all.length, 2);
  assert.equal(all.find((r) => r.title === 'x')?.workflowTitle, '内单');
  const onlyReflex = s.listFailedSteps({ limit: 10, tenant: 'reflex' });
  assert.equal(onlyReflex.length, 1);
  assert.equal(onlyReflex[0]!.workflowTitle, '外单');
});

test('listEventsForTenant：租户事件可见，他租户不可见', () => {
  const a = s.createWorkflow({ kind: 'case', title: 'ta', tenant: 'reflex' });
  const b = s.createWorkflow({ kind: 'case', title: 'tb', tenant: 'internal' });
  s.appendEvent('workflow', a.id, 'route_decision', { k: 1 });
  s.appendEvent('workflow', b.id, 'route_decision', { k: 2 });
  const got = s.listEventsForTenant('reflex', 10, ['route_decision']);
  assert.equal(got.length, 1);
  assert.equal(got[0]!.entityId, a.id);
});

test('listStepsWithWorkflow：状态过滤 + 单概要 join', () => {
  const w = s.createWorkflow({ kind: 'case', title: 'sw' });
  s.createStep({ workflowId: w.id, seq: 1, kind: 'agent', title: 's1' });
  const got = s.listStepsWithWorkflow({ status: 'pending', limit: 10 });
  const hit = got.find((x) => x.step.title === 's1');
  assert.ok(hit, 'pending 步可见');
  assert.equal(hit!.workflow?.title, 'sw');
});

test('listWorkflowsWithWaiting：waiting_human 计数', () => {
  const w = s.createWorkflow({ kind: 'case', title: 'ww' });
  const st = s.createStep({ workflowId: w.id, seq: 2, kind: 'verify', title: 'gate' });
  s.setStepStatus(st.id, 'waiting_human');
  const hit = s.listWorkflowsWithWaiting({ limit: 10 }).find((x) => x.workflow.id === w.id);
  assert.equal(hit?.waitingSteps, 1);
});

test('recentWorkflowDigests：meta 解析为对象，缺省空对象', () => {
  const w = s.createWorkflow({ kind: 'case', title: 'dg', meta: { email: 'a@b.co' } });
  const hit = s.recentWorkflowDigests(50).find((x) => x.id === w.id);
  assert.equal(hit?.meta['email'], 'a@b.co');
  const bare = s.createWorkflow({ kind: 'case', title: 'bare' });
  const hit2 = s.recentWorkflowDigests(50).find((x) => x.id === bare.id);
  assert.deepEqual(hit2?.meta, {});
});

test('setPromptStatus：回写后 latestPromptForSession 可见', () => {
  const w = s.createWorkflow({ kind: 'case', title: 'pp' });
  const run = s.createRun(w.id, 'sess-p');
  const prompt = s.createPrompt(run.id, 'do it', 'test');
  assert.equal(s.latestPromptForSession('sess-p', ['submitted'])?.id, prompt.id);
  s.setPromptStatus(prompt.id, 'failed');
  assert.equal(s.latestPromptForSession('sess-p', ['submitted']), null, 'submitted 窗口已不可见');
  assert.equal(s.latestPromptForSession('sess-p', ['failed'])?.id, prompt.id);
});

// 清理：node:test 无 afterAll 保证顺序，放最后一个 test 里。
test('cleanup', () => { rmSync(dir, { recursive: true, force: true }); });

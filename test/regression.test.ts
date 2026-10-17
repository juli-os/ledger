// Round-1 review regression tests (2026-10-13): insert-before-tail shift,
// prune relay cleanup + cutoff boundary, shared-boundary window counting.
// Style mirrors smoke.test.ts: node:test, temp DB files, zero npm deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedgerStore, createUsageStore } from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'peel-l1-reg-'));

test('insertStepsAt before an existing tail: no throw, ordering + tail data preserved', () => {
  const store = createLedgerStore(join(dir, 'insert-tail.db'));
  const wf = store.createWorkflow({ kind: 'case', title: 'insert before tail' });
  for (let i = 1; i <= 4; i++) {
    store.createStep({ workflowId: wf.id, seq: i, kind: 'agent' as never, title: `old ${i}`, input: { n: i } });
  }
  const old3 = store.stepsForWorkflow(wf.id).find((s) => s.title === 'old 3')!;
  store.setStepStatus(old3.id, 'running' as never);
  store.setStepOutput(old3.id, { marker: 'keep-me' });
  // 4 existing steps, insert 2 at seq 1: used to violate UNIQUE(workflow_id, seq).
  assert.doesNotThrow(() => {
    store.insertStepsAt(wf.id, 0, [
      { kind: 'agent' as never, title: 'new 1', input: { n: 'a' } },
      { kind: 'agent' as never, title: 'new 2' },
    ]);
  });
  const steps = store.stepsForWorkflow(wf.id);
  assert.deepEqual(steps.map((s) => s.title), ['new 1', 'new 2', 'old 1', 'old 2', 'old 3', 'old 4']);
  assert.deepEqual(steps.map((s) => s.seq), [1, 2, 3, 4, 5, 6]);
  const moved = steps.find((s) => s.title === 'old 3')!;
  assert.equal(moved.id, old3.id, 'shifted tail steps keep their identity');
  assert.equal(moved.status, 'running');
  assert.equal(moved.output.marker, 'keep-me');
  assert.equal(moved.input.n, 3);
  // Append at tail end still works (park matches nothing, insert lands after).
  store.insertStepsAt(wf.id, 6, [{ kind: 'agent' as never, title: 'tail app' }]);
  assert.deepEqual(store.stepsForWorkflow(wf.id).map((s) => s.title),
    ['new 1', 'new 2', 'old 1', 'old 2', 'old 3', 'old 4', 'tail app']);
});

test('prune: workflow goes with steps and relays; boundary second and failed stay', () => {
  let now = new Date('2026-01-01T00:00:00Z');
  const store = createLedgerStore(join(dir, 'prune.db'), { clock: { now: () => now } });
  const wfOld = store.createWorkflow({ kind: 'case', title: 'prune me' });
  const step = store.createStep({ workflowId: wfOld.id, seq: 1, kind: 'agent' as never, title: 's1' });
  const deliveredRelay = store.insertRelay({ workflowId: wfOld.id, stepId: step.id, session: 's', text: 'hi', marker: 'm' });
  store.markRelayDelivered(deliveredRelay);
  store.insertRelay({ workflowId: wfOld.id, stepId: step.id, session: 's', text: 'pending', marker: 'm2' });
  const wfBoundary = store.createWorkflow({ kind: 'case', title: 'completed exactly at cutoff' });
  const wfFailed = store.createWorkflow({ kind: 'case', title: 'failed stays' });
  // cutoff will be 2026-01-11T00:00:00Z (prune(30) at 2026-02-10): old lands one
  // second before it, boundary exactly on it (`<` is exclusive).
  now = new Date('2026-01-10T23:59:59Z');
  store.setWorkflowStatus(wfOld.id, 'completed' as never);
  now = new Date('2026-01-11T00:00:00Z');
  store.setWorkflowStatus(wfBoundary.id, 'completed' as never);
  store.setWorkflowStatus(wfFailed.id, 'failed' as never);
  now = new Date('2026-02-10T00:00:00Z');
  const res = store.prune(30);
  assert.equal(res.workflows, 1);
  assert.equal(store.getWorkflow(wfOld.id), null, 'old terminal workflow pruned');
  assert.equal(store.stepsForWorkflow(wfOld.id).length, 0, 'steps pruned with workflow');
  assert.equal(store.pendingRelays().length, 0, 'pending relays of pruned workflow gone');
  const relayRows = store.db.prepare('SELECT COUNT(*) AS c FROM relays WHERE workflow_id=?')
    .get(wfOld.id) as { c: number | bigint };
  assert.equal(Number(relayRows.c), 0, 'delivered relays of pruned workflow gone too');
  assert.ok(store.getWorkflow(wfBoundary.id), 'row completed exactly at cutoff second is not pruned');
  assert.ok(store.getWorkflow(wfFailed.id), 'failed workflow is never pruned');
});

test('perSessionWindows: shared-boundary second counted once (interval union)', () => {
  const usage = createUsageStore(join(dir, 'windows.db'));
  usage.recordClaudeSession('sess-boundary', 'tmuxW', '/unused/x.jsonl', '/unused');
  const projects = join(dir, 'claude-projects', 'proj');
  mkdirSync(projects, { recursive: true });
  const line = (ts: string, input: number) => JSON.stringify({
    type: 'assistant', uuid: `u-${ts}`, timestamp: ts,
    message: { model: 'claude-test', usage: { input_tokens: input, output_tokens: 1 } },
  });
  // Row at 00:00:03 sits on the shared boundary of both windows (inclusive ends).
  writeFileSync(join(projects, 'sess-boundary.jsonl'),
    `${line('2026-03-01T00:00:03Z', 100)}\n${line('2026-03-01T00:00:05Z', 50)}\n`);
  assert.equal(usage.ingestProjectTranscripts(join(dir, 'claude-projects')), 2);
  const windows: readonly (readonly [string, string])[] = [
    ['2026-03-01T00:00:00Z', '2026-03-01T00:00:03Z'],
    ['2026-03-01T00:00:03Z', '2026-03-01T00:00:05Z'],
  ];
  const agg = usage.perSessionWindows('tmuxW', windows);
  assert.equal(agg.count, 2, 'boundary row counted once, not once per matching window');
  assert.equal(agg.inputTokens, 150);
  assert.equal(agg.outputTokens, 2);
  assert.equal(usage.perSessionWindowsRows('tmuxW', windows).length, 2);
  // Offset advanced inside the same transaction: re-ingest reads nothing new.
  assert.equal(usage.ingestProjectTranscripts(join(dir, 'claude-projects')), 0);
});

test('cleanup temp dir', () => {
  rmSync(dir, { recursive: true, force: true });
});

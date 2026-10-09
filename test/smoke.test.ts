// L1 ledger standalone smoke test: zero npm deps, runs with `node --test`
// (node >= 22.18 for type stripping; node:sqlite is built in).
// These assertions ARE the acceptance line for peel-ability: outside the
// full juli system, the ledger layer remains fully usable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createLedgerStore, createUsageStore, emptyCaseFile, serializeCaseFile,
} from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'peel-l1-'));
const store = createLedgerStore(join(dir, 'ledger.db'));
const usage = createUsageStore(join(dir, 'usage.db'));

test('workflow lifecycle: create -> read back -> status transition', () => {
  const wf = store.createWorkflow({ kind: 'case', title: 'peel smoke job', meta: { source: 'peel-test' } });
  assert.equal(wf.title, 'peel smoke job');
  const back = store.getWorkflow(wf.id);
  assert.ok(back, 'workflow is readable right after creation');
  assert.equal(back!.meta.source, 'peel-test');
  store.setWorkflowStatus(wf.id, 'running' as never);
  assert.equal(store.getWorkflow(wf.id)!.status, 'running');
  assert.ok(store.listWorkflows(10).some((w) => w.id === wf.id));
});

test('step append + case file round-trip', () => {
  const wf = store.createWorkflow({ kind: 'case', title: 'steps job' });
  const step = store.createStep({ workflowId: wf.id, seq: 1, kind: 'agent' as never, title: 'Do work', input: { hint: 'ok' } });
  assert.equal(step.workflowId, wf.id);
  assert.equal(step.title, 'Do work');
  const cf = { ...emptyCaseFile(new Date()), original: { from: 'peel@test', subject: 'peel smoke case file' } };
  store.saveCaseFile(wf.id, cf);
  assert.equal(serializeCaseFile(store.loadCaseFile(wf.id)), serializeCaseFile(cf));
});

test('usage records + aggregates', () => {
  usage.record({ source: 'peel', model: 'test-model', inputTokens: 1200, outputTokens: 300 });
  usage.record({ source: 'peel', model: 'test-model', inputTokens: 800, outputTokens: 100 });
  const stats = usage.stats(1);
  assert.equal(stats.totalCalls, 2);
  assert.equal(stats.totalInputTokens, 2000);
  assert.equal(stats.totalOutputTokens, 400);
  assert.equal(stats.byModel[0]?.model, 'test-model');
});

test('cleanup temp dir', () => {
  rmSync(dir, { recursive: true, force: true });
});

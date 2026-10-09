#!/usr/bin/env node
// juli-ledger — read-only inspection CLI for the L1 ledger layer.
// Usage:
//   juli-ledger demo  <dir>            Seed a demo ledger (workflows + steps + usage)
//   juli-ledger ls    <dir> [limit]    List recent workflows
//   juli-ledger show  <dir> <id>       Workflow detail (meta + case file)
//   juli-ledger usage <dir> [--days N] Usage & cost aggregates
// <dir> = directory holding ledger.db / usage.db.
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  createLedgerStore, createUsageStore, emptyCaseFile,
} from '../src/index.ts';

const [, , cmd, a1 = '.', a2] = process.argv;
const dir = a1;
const lpath = (n: string) => join(dir, n);

const pad = (s: unknown, n: number) => String(s ?? '').slice(0, n).padEnd(n);

function demo() {
  mkdirSync(dir, { recursive: true });
  const store = createLedgerStore(lpath('ledger.db'));
  const usage = createUsageStore(lpath('usage.db'));
  const w1 = store.createWorkflow({ kind: 'case', title: 'Client inquiry: website redesign', meta: { from: 'client@acme.com', message_id: 'demo-001' } });
  store.createStep({ workflowId: w1.id, seq: 1, kind: 'agent', title: 'Understand the request' });
  store.createStep({ workflowId: w1.id, seq: 2, kind: 'agent', title: 'Draft a proposal' });
  store.setWorkflowStatus(w1.id, 'awaiting_approval' as never);
  const w2 = store.createWorkflow({ kind: 'case', title: 'Monthly report automation', meta: { from: 'ops@acme.com' } });
  store.setWorkflowStatus(w2.id, 'completed' as never);
  const cf = { ...emptyCaseFile(new Date()), original: { from: 'client@acme.com', subject: 'Website redesign' } };
  store.saveCaseFile(w1.id, cf);
  for (let i = 0; i < 12; i++) {
    usage.record({ source: 'demo', model: i % 2 ? 'gpt-test' : 'claude-test', inputTokens: 800 + i * 120, outputTokens: 200 + i * 40, durationMs: 900 + i * 60 });
  }
  console.log(`Demo ledger seeded -> ${dir}/ledger.db + usage.db (2 workflows, 2 steps, 12 usage records)`);
}

function ls() {
  const store = createLedgerStore(lpath('ledger.db'));
  const rows = store.listWorkflows(Number(a2 ?? 20));
  if (!rows.length) { console.log('(empty ledger)'); return; }
  console.log(pad('ID', 16) + pad('STATUS', 20) + pad('TITLE', 36) + 'CREATED');
  for (const w of rows) console.log(pad(w.id, 16) + pad(w.status, 20) + pad(w.title, 36) + w.createdAt);
}

function show() {
  const store = createLedgerStore(lpath('ledger.db'));
  const w = store.getWorkflow(a2 ?? '');
  if (!w) { console.error('Workflow not found: ' + a2); process.exit(1); }
  console.log(`Workflow ${w.id}\n  title: ${w.title}\n  status: ${w.status}\n  created: ${w.createdAt}\n  meta: ${JSON.stringify(w.meta)}`);
  const cf = store.loadCaseFile(w.id);
  console.log(`  case file: original=${JSON.stringify(cf.original)} executions=${cf.executions.length} decisions=${cf.decisions.length} artifacts=${cf.artifacts.length}`);
}

function usageCmd() {
  const withDays = String(a2 ?? '').startsWith('--days');
  const u = createUsageStore(lpath('usage.db'));
  const s = u.stats(24 * 7);
  console.log(`Last 7 days: ${s.totalCalls} calls · in ${s.totalInputTokens.toLocaleString()} tok · out ${s.totalOutputTokens.toLocaleString()} tok`);
  for (const m of s.byModel) console.log(`  ${pad(m.model, 16)} ${m.calls} calls  in=${m.inputTokens.toLocaleString()} out=${m.outputTokens.toLocaleString()}`);
  if (withDays) for (const d of u.byLocalDay(7)) console.log(`  ${d.day}  in=${d.inputTokens.toLocaleString()} out=${d.outputTokens.toLocaleString()} calls=${d.calls}`);
}

switch (cmd) {
  case 'demo': demo(); break;
  case 'ls': ls(); break;
  case 'show': show(); break;
  case 'usage': usageCmd(); break;
  default:
    console.log('juli-ledger — read-only inspection for the L1 ledger\n  demo <dir>            Seed a demo ledger\n  ls <dir> [limit]       List recent workflows\n  show <dir> <id>        Workflow detail\n  usage <dir> [--days N] Usage & cost aggregates');
}

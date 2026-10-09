# @juli-os/ledger — L1 Ledger Layer (peel validation slice)

The L1 layer of the juli open-source ladder: **the append-only ledger of record for agent work**. Zero npm dependencies — persistence uses Node's built-in `node:sqlite`.

## What's inside

| Capability | API | What it gives you |
|---|---|---|
| Workflow lifecycle | `createLedgerStore(path)` → `createWorkflow / getWorkflow / listWorkflows / setWorkflowStatus / createStep / insertStepsAt …` | Durable jobs + steps + statuses in SQLite, with dynamic mid-flight step insertion (single transaction, tail renumbered) |
| Conversation threading | `latestByMessageId(msgId)` / `recentBySender(from, since)` | Reply-chain matching for email bots and support inboxes — message-id causal anchor + sender/time-window candidate narrowing |
| Case files | `emptyCaseFile() / loadCaseFile / saveCaseFile` | A per-job audit dossier: original → extract → executions → draft → decisions → artifacts |
| Usage & cost | `createUsageStore(path)` → `record / stats / timeline / byLocalDay`, `priceUsage()` | Token accounting per model / day / session with built-in pricing |

## Peel boundary

Files are copied **verbatim** from the juli monorepo (import paths unchanged — the tree shape keeps them valid):

| File | Origin |
|---|---|
| `src/platform/ledger/{store,usage,pricing,casefile}.ts` | `src/platform/ledger/` |
| `src/platform/shared/{json,clock}.ts` | `src/platform/shared/` |
| `src/contracts/{entities,statuses}.ts` | `src/contracts/` |

Dependency rule: ledger → shared/contracts, strictly downward. Upper layers may only import the facade `src/index.ts`.

## Quick start — no install step

Requires Node ≥ 22.18 (built-in type stripping + `node:sqlite`).

```bash
node bin/juli-ledger.ts demo /tmp/demo-ledger   # seed a demo ledger
node bin/juli-ledger.ts ls    /tmp/demo-ledger   # list recent workflows
node bin/juli-ledger.ts usage /tmp/demo-ledger --days 7
node bin/juli-ledger.ts show  /tmp/demo-ledger <workflow-id>
```

Or from code:

```ts
import { createLedgerStore } from '@juli-os/ledger';
const store = createLedgerStore('./ledger.db');   // opens + migrates in one call
const wf = store.createWorkflow({ kind: 'case', title: 'First job' });
store.createStep({ workflowId: wf.id, seq: 1, kind: 'agent', title: 'Do work' });
```

Run the test suite (zero npm install):

```bash
node --test "test/*.test.ts"
```

## This is a validation slice

This package is the first empirical test of the **"layers you can peel off"** hypothesis (adopt at your altitude): standing alone, on a clean machine, with no node_modules, the ledger layer is fully usable. Verified green on macOS node 22 and a bare Linux box on node 24. L0 (execution substrate), L2 (artifacts), L4 (routing) follow the same recipe.

## License

Apache-2.0

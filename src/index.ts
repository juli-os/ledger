// L1 ledger layer facade — the only public surface of this layer.
// This is the COMPLETE export surface of the four source modules:
// any name exportable from platform/ledger/{store,usage,pricing,casefile}
// is re-exported here. Dependency rule: only inward deps (shared/contracts);
// consumers must never bypass this facade to reach internal files.
export { createLedgerStore, type LifecycleStore } from './platform/ledger/store.ts';
export type { Workflow, Step, WorkflowStatus, StepStatus, StepKind } from './contracts/entities.ts';
// 0.1.3: complete the entities surface — kind capability sets + ledger companion
// entities were internal-only; juli-service-ts consumers need them at the root
// (2026-10-10 oss-integration fix: local shadow retirement).
export {
  TERMINAL_WORKFLOW_STATUSES, STEP_KINDS, AGENT_STEP_KINDS, INSTRUCTABLE_STEP_KINDS,
  type LedgerEvent, type Run, type Prompt, type TaskView,
} from './contracts/entities.ts';
export {
  createUsageStore,
  type UsageRecord, type UsageStats, type TimelinePoint, type UsageStore,
} from './platform/ledger/usage.ts';
export {
  findPrice, priceUsage,
  type TierWhen, type PriceTier, type ModelPrice,
  PRICING_SOURCE, PRICING_RETRIEVED_AT, BIGMODEL_PRICES,
  type UsageRow, type CostBreakdown, type ModelUsageCost, type UsageCost,
} from './platform/ledger/pricing.ts';
export {
  emptyCaseFile, parseCaseFile, serializeCaseFile, withOriginal,
  appendSection, appendExecution, appendDecision, appendReference, originalEmail,
  type CaseDecision, type ArtifactRef, type CaseFileDoc,
} from './platform/ledger/casefile.ts';
export { rfc3339, systemClock, randomIds, type Clock, type IdGen } from './platform/shared/clock.ts';
export { asRecord, safeParse, type JsonRecord, type JsonValue } from './platform/shared/json.ts';

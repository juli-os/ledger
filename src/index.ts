// L1 ledger layer facade — the only public surface of this layer.
// This is the COMPLETE export surface of every source module: any name
// exportable from platform/ledger/{store,usage,pricing,casefile},
// contracts/entities, or platform/shared/{clock,json} is re-exported here.
// Dependency rule: only inward deps (shared/contracts); consumers must never
// bypass this facade to reach internal files.
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
// 0.3.0：工具出口（rfc3339/systemClock/randomIds/Clock/IdGen/asRecord/
// safeParse/JsonRecord/JsonValue）已删——事实源收编回主仓 src/platform/shared/
// （juli-service-ts 2026-11-11 架构调整第 1 步；主仓对本包这些出口零借用，
// grep 实证）。本包内部继续用 src/platform/shared/，不再对外导出。

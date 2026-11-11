// Facade 表面快照：显式名单断言（非盲快照）——增删导出必须显式改这份名单。
// 教训：漏导出此前靠主仓 typecheck 才发现（ledger c98550d/a7b44f4/ae62e5f
// 等 4+ 次 revert 记录）；本测试把围栏前移到本仓 CI 红。
// 注：LifecycleStore.db 公开句柄已在 0.5.0 收口（2026-11-12 ledger 关门，
// R8 备案的两阶段方案落地：先加正规函数 0.4.0，主仓迁完，再句柄私有）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../src/index.ts';

test('facade value-export surface matches the explicit snapshot list', () => {
  const expected = [
    // store
    'createLedgerStore',
    // entities（能力集常量）
    'TERMINAL_WORKFLOW_STATUSES', 'STEP_KINDS', 'AGENT_STEP_KINDS', 'INSTRUCTABLE_STEP_KINDS',
    // usage
    'createUsageStore',
    // pricing
    'findPrice', 'priceUsage', 'PRICING_SOURCE', 'PRICING_RETRIEVED_AT', 'BIGMODEL_PRICES',
    // casefile
    'emptyCaseFile', 'parseCaseFile', 'serializeCaseFile', 'withOriginal',
    'appendSection', 'appendExecution', 'appendDecision', 'appendReference', 'originalEmail',
    // 0.3.0：shared 工具出口已删（事实源收编回主仓 src/platform/shared/）
  ];
  assert.deepEqual(Object.keys(facade).sort(), [...expected].sort());
});

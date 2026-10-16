// Facade 表面快照：显式名单断言（非盲快照）——增删导出必须显式改这份名单。
// 教训：漏导出此前靠主仓 typecheck 才发现（ledger c98550d/a7b44f4/ae62e5f
// 等 4+ 次 revert 记录）；本测试把围栏前移到本仓 CI 红。
// 注：LifecycleStore.db 公开句柄是已知 P1（R8 备案两阶段收口方案，等口令），
// 不在本测试的围栏语义内——快照只钉「名字在/不在」，不背书形状。
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
    // shared
    'rfc3339', 'systemClock', 'randomIds', 'asRecord', 'safeParse',
  ];
  assert.deepEqual(Object.keys(facade).sort(), [...expected].sort());
});

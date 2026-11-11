[**@juli-os/ledger**](../index.md)

***

[@juli-os/ledger](../index.md) / UsageStore

# Interface: UsageStore

Defined in: [platform/ledger/usage.ts:85](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/usage.ts#L85)

## Methods

### byLocalDay()

> **byLocalDay**(`days?`): readonly `object`[]

Defined in: [platform/ledger/usage.ts:94](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/usage.ts#L94)

本地自然日聚合（wf_e86d52c97b51 Dashboard）：近 days 天（含今日）的
输入/输出/调用数按日分组——「今日 Token」口径=自然日，非滚动 24h。

#### Parameters

##### days?

`number`

#### Returns

readonly `object`[]

***

### ingestProjectTranscripts()

> **ingestProjectTranscripts**(`claudeProjectsDir`): `number`

Defined in: [platform/ledger/usage.ts:121](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/usage.ts#L121)

扫描 claudeProjectsDir 下各项目的 .jsonl transcript 增量摄取（offset 续传）。

#### Parameters

##### claudeProjectsDir

`string`

#### Returns

`number`

***

### lastClaudeCodeAt()

> **lastClaudeCodeAt**(`tmuxSession`): `string`

Defined in: [platform/ledger/usage.ts:113](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/usage.ts#L113)

该会话最近一行 claude_code 用量的 created_at（无行返回空串）。回流
执行静默判据（wf_be61c3a55842 自动收口）：CC 回合持续产生用量行，
「事件链静默但行还在涨」= agent 仍在干活，不许收口。

#### Parameters

##### tmuxSession

`string`

#### Returns

`string`

***

### latestInputTokens()

> **latestInputTokens**(`tmuxSession`): `number`

Defined in: [platform/ledger/usage.ts:109](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/usage.ts#L109)

该会话最新一次 claude_code 回合的 input tokens（≈当前 context 量级，
wf_a79a6fcbf7ef context 门的 compact 阈值判据）。无记录=0。

#### Parameters

##### tmuxSession

`string`

#### Returns

`number`

***

### needsClaudeReplay()

> **needsClaudeReplay**(): `boolean`

Defined in: [platform/ledger/usage.ts:128](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/usage.ts#L128)

wf_9658ce9225e0：历史 claude_code 行 tmux_session 空（映射未接线时代
写入）占比高且映射已建 → 该重放。十四跑 R1 加冷却（usage_meta 落
last_claude_replay_at）：重放不改归属分布（人用 CC 的行永远无映射，
比率不会因重放改善）——无冷却时每 60s tick 恒真 → 全量 DELETE+重读
循环自锁。冷却 24h：重放成本 O(全历史字节)，一日至多一次；映射增量
（hook 精确登记）以小时计累积，次日再判保留自愈。

#### Returns

`boolean`

***

### perSessionWindows()

> **perSessionWindows**(`tmuxSession`, `windows`): `object`

Defined in: [platform/ledger/usage.ts:98](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/usage.ts#L98)

会话×多时间窗聚合（per-workflow prompt 计数；用户批注修正：一个 tmux
session 会串多个 workflow——按该单各 agent 步的 [started, completed]
区间并集计数，等待期/别单窗口不计）。tmux_session 归属行精确计。

#### Parameters

##### tmuxSession

`string`

##### windows

readonly (readonly \[`string`, `string`\])[]

#### Returns

`object`

##### count

> **count**: `number`

##### inputTokens

> **inputTokens**: `number`

##### outputTokens

> **outputTokens**: `number`

***

### perSessionWindowsRows()

> **perSessionWindowsRows**(`tmuxSession`, `windows`): readonly `object`[]

Defined in: [platform/ledger/usage.ts:102](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/usage.ts#L102)

行级版 perSessionWindows（wf_535149a174fe API 等效计价）：窗口内该会话
的 claude_code 行逐行返回 (model, in, out, cached)——档位判定需要行级
input/output 长度，聚合与计价在 pricing 层做。口径同 perSessionWindows。

#### Parameters

##### tmuxSession

`string`

##### windows

readonly (readonly \[`string`, `string`\])[]

#### Returns

readonly `object`[]

***

### recent()

> **recent**(`limit?`): readonly [`UsageRecord`](UsageRecord.md)[]

Defined in: [platform/ledger/usage.ts:114](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/usage.ts#L114)

#### Parameters

##### limit?

`number`

#### Returns

readonly [`UsageRecord`](UsageRecord.md)[]

***

### record()

> **record**(`r`): `void`

Defined in: [platform/ledger/usage.ts:86](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/usage.ts#L86)

#### Parameters

##### r

###### cachedTokens?

`number`

###### durationMs?

`number`

###### error?

`string`

###### inputTokens?

`number`

###### model?

`string`

###### note?

`string`

###### outputTokens?

`number`

###### source

`string`

#### Returns

`void`

***

### recordClaudeSession()

> **recordClaudeSession**(`claudeSessionId`, `tmuxSession`, `transcriptPath`, `cwd`): `void`

Defined in: [platform/ledger/usage.ts:117](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/usage.ts#L117)

CC transcript 登记（tmux 会话 ↔ claude session 的映射）。目录扫描兜底：
只插不覆盖（同 cwd 多会话互相抢登记的覆盖 bug——wf_e8d6984ba09e 三断点）。

#### Parameters

##### claudeSessionId

`string`

##### tmuxSession

`string`

##### transcriptPath

`string`

##### cwd

`string`

#### Returns

`void`

***

### recordClaudeSessionPrecise()

> **recordClaudeSessionPrecise**(`claudeSessionId`, `tmuxSession`): `void`

Defined in: [platform/ledger/usage.ts:119](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/usage.ts#L119)

精确登记（CC hook 每回合自报）：可覆盖——精确来源优先于扫描兜底。

#### Parameters

##### claudeSessionId

`string`

##### tmuxSession

`string`

#### Returns

`void`

***

### resetClaudeIngest()

> **resetClaudeIngest**(): `void`

Defined in: [platform/ledger/usage.ts:132](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/usage.ts#L132)

清掉 claude_code 行与 ingest offset——下轮 ingest 带（新接线的）映射
全量重读 transcript，回填 tmux_session。cached_tokens 一并重算。
同时落重放标记（needsClaudeReplay 的冷却起点）。

#### Returns

`void`

***

### sessionWindowsPriced()

> **sessionWindowsPriced**(`sessions`, `windows`): [`UsageCost`](UsageCost.md)

Defined in: [platform/ledger/usage.ts:106](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/usage.ts#L106)

该单会话×步窗口的 API 等效计价（wf_535149a174fe）：行级用量代入
 bigmodel 价目（pricing.ts）按 cache/input/output 三价加总。http 层经
 runtime 注入调用，不新增跨包依赖边。

#### Parameters

##### sessions

readonly `string`[]

##### windows

readonly (readonly \[`string`, `string`\])[]

#### Returns

[`UsageCost`](UsageCost.md)

***

### stats()

> **stats**(`sinceHours?`): [`UsageStats`](UsageStats.md)

Defined in: [platform/ledger/usage.ts:90](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/usage.ts#L90)

#### Parameters

##### sinceHours?

`number`

#### Returns

[`UsageStats`](UsageStats.md)

***

### timeline()

> **timeline**(`hours?`): readonly [`TimelinePoint`](TimelinePoint.md)[]

Defined in: [platform/ledger/usage.ts:91](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/usage.ts#L91)

#### Parameters

##### hours?

`number`

#### Returns

readonly [`TimelinePoint`](TimelinePoint.md)[]

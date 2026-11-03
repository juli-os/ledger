[**@juli-os/ledger**](../index.md)

***

[@juli-os/ledger](../index.md) / LifecycleStore

# Interface: LifecycleStore

Defined in: [platform/ledger/store.ts:92](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L92)

## Properties

### db

> `readonly` **db**: `DatabaseSync`

Defined in: [platform/ledger/store.ts:93](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L93)

## Methods

### activeRunForSession()

> **activeRunForSession**(`session`): [`Run`](Run.md) \| `null`

Defined in: [platform/ledger/store.ts:172](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L172)

#### Parameters

##### session

`string`

#### Returns

[`Run`](Run.md) \| `null`

***

### appendEvent()

> **appendEvent**(`entityType`, `entityId`, `type`, `payload?`): [`LedgerEvent`](LedgerEvent.md)

Defined in: [platform/ledger/store.ts:150](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L150)

#### Parameters

##### entityType

`"agent"` \| `"workflow"` \| `"step"` \| `"judgment"`

##### entityId

`string`

##### type

`string`

##### payload?

[`JsonRecord`](../type-aliases/JsonRecord.md)

#### Returns

[`LedgerEvent`](LedgerEvent.md)

***

### appendStepOutputItem()

> **appendStepOutputItem**(`id`, `key`, `entry`, `cap`): `void`

Defined in: [platform/ledger/store.ts:136](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L136)

原子数组追加：同一条语句序列内完成读-append-裁剪-写（node:sqlite
同步 = 原子段）。recordActivity 的读-合并-写曾以陈旧快照覆盖并发条目。

#### Parameters

##### id

`string`

##### key

`string`

##### entry

[`JsonValue`](../type-aliases/JsonValue.md)

##### cap

`number`

#### Returns

`void`

***

### assignThread()

> **assignThread**(`workflowId`, `threadId`): `void`

Defined in: [platform/ledger/store.ts:104](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L104)

归组：把 workflow 挂到线程（首次建档或继承）。threadId 为空串 = 拒绝。

#### Parameters

##### workflowId

`string`

##### threadId

`string`

#### Returns

`void`

***

### claimRunningStep()

> **claimRunningStep**(`id`): `boolean`

Defined in: [platform/ledger/store.ts:138](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L138)

原子 CAS：running→completed。返回 false = 已被其他路径结算（settle-once）。

#### Parameters

##### id

`string`

#### Returns

`boolean`

***

### createPrompt()

> **createPrompt**(`runId`, `content`, `source`): [`Prompt`](Prompt.md)

Defined in: [platform/ledger/store.ts:173](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L173)

#### Parameters

##### runId

`string`

##### content

`string`

##### source

`string`

#### Returns

[`Prompt`](Prompt.md)

***

### createRun()

> **createRun**(`workflowId`, `session`): [`Run`](Run.md)

Defined in: [platform/ledger/store.ts:162](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L162)

#### Parameters

##### workflowId

`string`

##### session

`string`

#### Returns

[`Run`](Run.md)

***

### createStep()

> **createStep**(`s`): [`Step`](Step.md)

Defined in: [platform/ledger/store.ts:116](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L116)

#### Parameters

##### s

###### input?

[`JsonRecord`](../type-aliases/JsonRecord.md)

###### kind

[`StepKind`](../type-aliases/StepKind.md)

###### seq

`number`

###### title

`string`

###### workflowId

`string`

#### Returns

[`Step`](Step.md)

***

### createWorkflow()

> **createWorkflow**(`w`): [`Workflow`](Workflow.md)

Defined in: [platform/ledger/store.ts:95](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L95)

#### Parameters

##### w

###### kind

`string`

###### meta?

[`JsonRecord`](../type-aliases/JsonRecord.md)

###### owner?

`string`

###### parentId?

`string`

###### status?

[`WorkflowStatus`](../type-aliases/WorkflowStatus.md)

###### title

`string`

#### Returns

[`Workflow`](Workflow.md)

***

### currentStep()

> **currentStep**(`id`): [`Step`](Step.md) \| `null`

Defined in: [platform/ledger/store.ts:125](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L125)

#### Parameters

##### id

`string`

#### Returns

[`Step`](Step.md) \| `null`

***

### entityEvents()

> **entityEvents**(`entityType`, `entityId`, `type`, `limit?`): readonly [`LedgerEvent`](LedgerEvent.md)[]

Defined in: [platform/ledger/store.ts:156](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L156)

per-entity 事件查询（P2-5）：WHERE entity_type+entity_id+type 的全史回放，
走 idx_events_entity 索引——守卫类消费者（乒乓守卫）不再受 listEvents
全库窗口限制（entityId 过滤在窗口之后，早事件会被挤出窗外漏判）。

#### Parameters

##### entityType

`"agent"` \| `"workflow"` \| `"step"` \| `"judgment"`

##### entityId

`string`

##### type

`string`

##### limit?

`number`

#### Returns

readonly [`LedgerEvent`](LedgerEvent.md)[]

***

### eventsSince()

> **eventsSince**(`afterId`, `limit?`): readonly [`LedgerEvent`](LedgerEvent.md)[]

Defined in: [platform/ledger/store.ts:152](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L152)

#### Parameters

##### afterId

`number`

##### limit?

`number`

#### Returns

readonly [`LedgerEvent`](LedgerEvent.md)[]

***

### getStep()

> **getStep**(`id`): [`Step`](Step.md) \| `null`

Defined in: [platform/ledger/store.ts:123](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L123)

#### Parameters

##### id

`string`

#### Returns

[`Step`](Step.md) \| `null`

***

### getWorkflow()

> **getWorkflow**(`id`): [`Workflow`](Workflow.md) \| `null`

Defined in: [platform/ledger/store.ts:96](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L96)

#### Parameters

##### id

`string`

#### Returns

[`Workflow`](Workflow.md) \| `null`

***

### hasActiveDedup()

> **hasActiveDedup**(`key`): `boolean`

Defined in: [platform/ledger/store.ts:163](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L163)

#### Parameters

##### key

`string`

#### Returns

`boolean`

***

### hasSeenDedup()

> **hasSeenDedup**(`key`): `boolean`

Defined in: [platform/ledger/store.ts:165](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L165)

轮询层去重：任何非 rejected 工作流含此 dedup_key 即视为已摄取。

#### Parameters

##### key

`string`

#### Returns

`boolean`

***

### insertRelay()

> **insertRelay**(`r`): `string`

Defined in: [platform/ledger/store.ts:129](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L129)

#### Parameters

##### r

###### marker

`string`

###### session

`string`

###### stepId

`string`

###### text

`string`

###### workflowId

`string`

#### Returns

`string`

***

### insertStepsAt()

> **insertStepsAt**(`workflowId`, `afterSeq`, `steps`): `void`

Defined in: [platform/ledger/store.ts:120](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L120)

动态展开：在 afterSeq 之后插入若干步，既有 tail 顺延。单事务。

#### Parameters

##### workflowId

`string`

##### afterSeq

`number`

##### steps

readonly `object`[]

#### Returns

`void`

***

### lastEventAt()

> **lastEventAt**(`entityType`, `entityId`): `string`

Defined in: [platform/ledger/store.ts:160](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L160)

该实体最后一条事件的 ts（无事件返回空串）。计费窗口延伸的「run 最后
活动」锚点：在途单的回流执行回合不断落 session_turn 等事件，MAX(ts)
即活动前沿（走 idx_events_entity 索引）。

#### Parameters

##### entityType

`"agent"` \| `"workflow"` \| `"step"` \| `"judgment"`

##### entityId

`string`

#### Returns

`string`

***

### latestByMessageId()

> **latestByMessageId**(`messageId`, `excludeWorkflowId?`): [`Workflow`](Workflow.md) \| `null`

Defined in: [platform/ledger/store.ts:108](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L108)

进件匹配①：meta.message_id 精确反查最新单（in_reply_to 的因果锚）。
不限状态——被拒的信也是对方在回复的那封。excludeWorkflowId = 本单
（新行已落库才跑匹配，不排除会自己匹配自己）。

#### Parameters

##### messageId

`string`

##### excludeWorkflowId?

`string`

#### Returns

[`Workflow`](Workflow.md) \| `null`

***

### latestPromptForSession()

> **latestPromptForSession**(`session`, `statuses`): [`Prompt`](Prompt.md) \| `null`

Defined in: [platform/ledger/store.ts:174](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L174)

#### Parameters

##### session

`string`

##### statuses

readonly (`"completed"` \| `"failed"` \| `"submitted"`)[]

#### Returns

[`Prompt`](Prompt.md) \| `null`

***

### listEvents()

> **listEvents**(`limit?`, `types?`): readonly [`LedgerEvent`](LedgerEvent.md)[]

Defined in: [platform/ledger/store.ts:151](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L151)

#### Parameters

##### limit?

`number`

##### types?

readonly `string`[]

#### Returns

readonly [`LedgerEvent`](LedgerEvent.md)[]

***

### listSteps()

> **listSteps**(`status`, `limit?`): readonly [`Step`](Step.md)[]

Defined in: [platform/ledger/store.ts:139](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L139)

#### Parameters

##### status

[`StepStatus`](../type-aliases/StepStatus.md)

##### limit?

`number`

#### Returns

readonly [`Step`](Step.md)[]

***

### listWorkflows()

> **listWorkflows**(`limit?`, `status?`): readonly [`Workflow`](Workflow.md)[]

Defined in: [platform/ledger/store.ts:97](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L97)

#### Parameters

##### limit?

`number`

##### status?

`string`

#### Returns

readonly [`Workflow`](Workflow.md)[]

***

### loadCaseFile()

> **loadCaseFile**(`id`): [`CaseFileDoc`](CaseFileDoc.md)

Defined in: [platform/ledger/store.ts:113](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L113)

#### Parameters

##### id

`string`

#### Returns

[`CaseFileDoc`](CaseFileDoc.md)

***

### markRelayAttempt()

> **markRelayAttempt**(`id`, `error`): `void`

Defined in: [platform/ledger/store.ts:132](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L132)

#### Parameters

##### id

`string`

##### error

`string`

#### Returns

`void`

***

### markRelayDelivered()

> **markRelayDelivered**(`id`): `void`

Defined in: [platform/ledger/store.ts:131](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L131)

#### Parameters

##### id

`string`

#### Returns

`void`

***

### pendingRelays()

> **pendingRelays**(): readonly `object`[]

Defined in: [platform/ledger/store.ts:130](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L130)

#### Returns

readonly `object`[]

***

### prune()

> **prune**(`retentionDays`): `object`

Defined in: [platform/ledger/store.ts:177](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L177)

修剪：events 超期删除；终态（completed/cancelled/rejected）工作流超期连同步骤删除，
failed 一律保留（事故语义）。返回删除行数。

#### Parameters

##### retentionDays

`number`

#### Returns

`object`

##### events

> **events**: `number`

##### workflows

> **workflows**: `number`

***

### recentBySender()

> **recentBySender**(`from`, `sinceIso`, `excludeWorkflowId?`, `limit?`): readonly [`Workflow`](Workflow.md)[]

Defined in: [platform/ledger/store.ts:111](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L111)

进件匹配②候选集：同发件人（大小写不敏感）+ 时间窗内、非 rejected 的单，
新→旧。主题归一化比对在 engine（SQL 表达不了「剥 Re:/回复：」），本层只收窄。

#### Parameters

##### from

`string`

##### sinceIso

`string`

##### excludeWorkflowId?

`string`

##### limit?

`number`

#### Returns

readonly [`Workflow`](Workflow.md)[]

***

### recordSentMessageId()

> **recordSentMessageId**(`messageId`, `meta?`): `void`

Defined in: [platform/ledger/store.ts:171](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L171)

全量出站邮件登记（2026-09-20 幽灵单缺口）：send 步之外，通知邮件
（emailNotifier）等所有出站信的 message_id 也进查询面——发给轮询
邮箱自身的告警信不再被当新来信建单（[juli] 待审批 幽灵单）。

#### Parameters

##### messageId

`string`

##### meta?

###### subject?

`string`

###### to?

`string`

#### Returns

`void`

***

### runningAgentStepForSession()

> **runningAgentStepForSession**(`session`): [`Step`](Step.md) \| `null`

Defined in: [platform/ledger/store.ts:140](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L140)

#### Parameters

##### session

`string`

#### Returns

[`Step`](Step.md) \| `null`

***

### saveCaseFile()

> **saveCaseFile**(`id`, `cf`): `void`

Defined in: [platform/ledger/store.ts:114](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L114)

#### Parameters

##### id

`string`

##### cf

[`CaseFileDoc`](CaseFileDoc.md)

#### Returns

`void`

***

### sentMessageIdExists()

> **sentMessageIdExists**(`messageId`): `boolean`

Defined in: [platform/ledger/store.ts:167](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L167)

自回环守卫（断点十三）：message_id 命中 completed send 步 output.message_id。

#### Parameters

##### messageId

`string`

#### Returns

`boolean`

***

### sessionHasOpenWork()

> **sessionHasOpenWork**(`session`, `excludeWorkflowId?`): `boolean`

Defined in: [platform/ledger/store.ts:148](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L148)

忙闲谓词（2026-09-30 用户裁定重定义）：忙 = 名下存在非终态单——排队/
在跑/停在闸门等批准都算；唯一闲 = 名下单子全部终态。锚定与
runningAgentStepForSession 兜底同源（session 列 / meta.assigned_session /
runs 行），queued 期的锚定靠进件播种时即写 session 列。消费方：派发面
忙闲改道、路由图占用、routeTask 落点判定（要「正在跑那一步」本体的
僵尸看门狗/结算不走这里）。excludeWorkflowId 供派发面自排除——本单
自己就锚在目标会话且非终态，不排除=每次派发都自触发改道。

#### Parameters

##### session

`string`

##### excludeWorkflowId?

`string`

#### Returns

`boolean`

***

### setStepInput()

> **setStepInput**(`id`, `patch`): `void`

Defined in: [platform/ledger/store.ts:127](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L127)

#### Parameters

##### id

`string`

##### patch

[`JsonRecord`](../type-aliases/JsonRecord.md)

#### Returns

`void`

***

### setStepOutput()

> **setStepOutput**(`id`, `patch`): `void`

Defined in: [platform/ledger/store.ts:133](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L133)

#### Parameters

##### id

`string`

##### patch

[`JsonRecord`](../type-aliases/JsonRecord.md)

#### Returns

`void`

***

### setStepStatus()

> **setStepStatus**(`id`, `status`): `void`

Defined in: [platform/ledger/store.ts:126](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L126)

#### Parameters

##### id

`string`

##### status

[`StepStatus`](../type-aliases/StepStatus.md)

#### Returns

`void`

***

### setWorkflowRouting()

> **setWorkflowRouting**(`id`, `session`, `project`): `void`

Defined in: [platform/ledger/store.ts:101](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L101)

#### Parameters

##### id

`string`

##### session

`string`

##### project

`string`

#### Returns

`void`

***

### setWorkflowSession()

> **setWorkflowSession**(`id`, `session`): `void`

Defined in: [platform/ledger/store.ts:99](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L99)

#### Parameters

##### id

`string`

##### session

`string`

#### Returns

`void`

***

### setWorkflowStatus()

> **setWorkflowStatus**(`id`, `status`): `void`

Defined in: [platform/ledger/store.ts:98](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L98)

#### Parameters

##### id

`string`

##### status

[`WorkflowStatus`](../type-aliases/WorkflowStatus.md)

#### Returns

`void`

***

### stepsForWorkflow()

> **stepsForWorkflow**(`id`): readonly [`Step`](Step.md)[]

Defined in: [platform/ledger/store.ts:124](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L124)

#### Parameters

##### id

`string`

#### Returns

readonly [`Step`](Step.md)[]

***

### taskViews()

> **taskViews**(`limit?`): `object`

Defined in: [platform/ledger/store.ts:184](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L184)

Task 投影（第四期最小转正 2026-09-22）：Task 继续不建新表——任务卡
（meta.mode='nodes' 的单，engine.startTask 建）+ related_workflow/parent_id
链聚成「一 Task 多流水」视图。返回任务卡视图（新→旧）与
workflowId→taskId 归属表（无任务卡祖先的单如普通邮件流不进表）。
根判据：沿链向上最高的任务卡；任务卡挂在邮件单下（方向修正链）时根=
任务卡自身——邮件单不是任务卡，不吞并。展示级投影，默认扫最近 500 单。

#### Parameters

##### limit?

`number`

#### Returns

`object`

##### map

> `readonly` **map**: `Readonly`\<`Record`\<`string`, `string`\>\>

##### views

> `readonly` **views**: readonly [`TaskView`](TaskView.md)[]

***

### updateWorkflowMeta()

> **updateWorkflowMeta**(`id`, `patch`): [`JsonRecord`](../type-aliases/JsonRecord.md)

Defined in: [platform/ledger/store.ts:100](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/store.ts#L100)

#### Parameters

##### id

`string`

##### patch

[`JsonRecord`](../type-aliases/JsonRecord.md)

#### Returns

[`JsonRecord`](../type-aliases/JsonRecord.md)

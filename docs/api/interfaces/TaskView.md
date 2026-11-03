[**@juli-os/ledger**](../index.md)

***

[@juli-os/ledger](../index.md) / TaskView

# Interface: TaskView

Defined in: [contracts/entities.ts:99](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L99)

Task 投影（第四期最小转正 2026-09-22）：Task 不建新表——「任务卡」=
meta.mode='nodes' 的 adhoc 单（engine.startTask 建），挂单经
meta.related_workflow（兜底 parent_id）链接。一个 Task = 任务卡 + 链上
归到它的全部流水（含邮件单/跟进执行单）。

## Properties

### status

> `readonly` **status**: [`WorkflowStatus`](../type-aliases/WorkflowStatus.md)

Defined in: [contracts/entities.ts:104](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L104)

任务卡自身状态（WorkflowStatus）。

***

### taskId

> `readonly` **taskId**: `string`

Defined in: [contracts/entities.ts:101](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L101)

任务卡 workflow id（= Task id）。

***

### title

> `readonly` **title**: `string`

Defined in: [contracts/entities.ts:102](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L102)

***

### workflowIds

> `readonly` **workflowIds**: readonly `string`[]

Defined in: [contracts/entities.ts:106](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L106)

归属本 Task 的全部流水 id（含任务卡自身），新→旧。

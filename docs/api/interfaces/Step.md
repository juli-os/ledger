[**@juli-os/ledger**](../index.md)

***

[@juli-os/ledger](../index.md) / Step

# Interface: Step

Defined in: [contracts/entities.ts:54](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L54)

## Properties

### completedAt

> `readonly` **completedAt**: `string` \| `null`

Defined in: [contracts/entities.ts:69](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L69)

终态首次到达时刻；null = 未终结或历史行。

***

### id

> `readonly` **id**: `string`

Defined in: [contracts/entities.ts:55](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L55)

***

### input

> `readonly` **input**: [`JsonRecord`](../type-aliases/JsonRecord.md)

Defined in: [contracts/entities.ts:61](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L61)

***

### kind

> `readonly` **kind**: [`StepKind`](../type-aliases/StepKind.md)

Defined in: [contracts/entities.ts:58](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L58)

***

### output

> `readonly` **output**: [`JsonRecord`](../type-aliases/JsonRecord.md)

Defined in: [contracts/entities.ts:62](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L62)

***

### seq

> `readonly` **seq**: `number`

Defined in: [contracts/entities.ts:57](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L57)

***

### startedAt

> `readonly` **startedAt**: `string`

Defined in: [contracts/entities.ts:67](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L67)

节点时序：离开 pending 的第一次转变（闸门 waiting_human 也算开跑）。
空串 = 历史行（补列迁移前）或尚未开跑。

***

### status

> `readonly` **status**: [`StepStatus`](../type-aliases/StepStatus.md)

Defined in: [contracts/entities.ts:60](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L60)

***

### summary

> `readonly` **summary**: `string`

Defined in: [contracts/entities.ts:63](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L63)

***

### title

> `readonly` **title**: `string`

Defined in: [contracts/entities.ts:59](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L59)

***

### updatedAt

> `readonly` **updatedAt**: `string`

Defined in: [contracts/entities.ts:64](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L64)

***

### workflowId

> `readonly` **workflowId**: `string`

Defined in: [contracts/entities.ts:56](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L56)

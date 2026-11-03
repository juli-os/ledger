[**@juli-os/ledger**](../index.md)

***

[@juli-os/ledger](../index.md) / Step

# Interface: Step

Defined in: [contracts/entities.ts:50](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L50)

## Properties

### completedAt

> `readonly` **completedAt**: `string` \| `null`

Defined in: [contracts/entities.ts:65](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L65)

终态首次到达时刻；null = 未终结或历史行。

***

### id

> `readonly` **id**: `string`

Defined in: [contracts/entities.ts:51](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L51)

***

### input

> `readonly` **input**: [`JsonRecord`](../type-aliases/JsonRecord.md)

Defined in: [contracts/entities.ts:57](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L57)

***

### kind

> `readonly` **kind**: [`StepKind`](../type-aliases/StepKind.md)

Defined in: [contracts/entities.ts:54](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L54)

***

### output

> `readonly` **output**: [`JsonRecord`](../type-aliases/JsonRecord.md)

Defined in: [contracts/entities.ts:58](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L58)

***

### seq

> `readonly` **seq**: `number`

Defined in: [contracts/entities.ts:53](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L53)

***

### startedAt

> `readonly` **startedAt**: `string`

Defined in: [contracts/entities.ts:63](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L63)

节点时序：离开 pending 的第一次转变（闸门 waiting_human 也算开跑）。
空串 = 历史行（补列迁移前）或尚未开跑。

***

### status

> `readonly` **status**: [`StepStatus`](../type-aliases/StepStatus.md)

Defined in: [contracts/entities.ts:56](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L56)

***

### summary

> `readonly` **summary**: `string`

Defined in: [contracts/entities.ts:59](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L59)

***

### title

> `readonly` **title**: `string`

Defined in: [contracts/entities.ts:55](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L55)

***

### updatedAt

> `readonly` **updatedAt**: `string`

Defined in: [contracts/entities.ts:60](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L60)

***

### workflowId

> `readonly` **workflowId**: `string`

Defined in: [contracts/entities.ts:52](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L52)

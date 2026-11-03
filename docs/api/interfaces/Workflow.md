[**@juli-os/ledger**](../index.md)

***

[@juli-os/ledger](../index.md) / Workflow

# Interface: Workflow

Defined in: [contracts/entities.ts:33](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L33)

## Properties

### createdAt

> `readonly` **createdAt**: `string`

Defined in: [contracts/entities.ts:46](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L46)

***

### id

> `readonly` **id**: `string`

Defined in: [contracts/entities.ts:34](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L34)

***

### kind

> `readonly` **kind**: `string`

Defined in: [contracts/entities.ts:36](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L36)

***

### meta

> `readonly` **meta**: [`JsonRecord`](../type-aliases/JsonRecord.md)

Defined in: [contracts/entities.ts:45](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L45)

***

### parentId

> `readonly` **parentId**: `string` \| `null`

Defined in: [contracts/entities.ts:35](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L35)

***

### path

> `readonly` **path**: `string`

Defined in: [contracts/entities.ts:41](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L41)

***

### project

> `readonly` **project**: `string`

Defined in: [contracts/entities.ts:40](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L40)

***

### session

> `readonly` **session**: `string`

Defined in: [contracts/entities.ts:39](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L39)

***

### status

> `readonly` **status**: [`WorkflowStatus`](../type-aliases/WorkflowStatus.md)

Defined in: [contracts/entities.ts:38](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L38)

***

### threadId

> `readonly` **threadId**: `string` \| `null`

Defined in: [contracts/entities.ts:44](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L44)

对话（Thread）一等建模：同一线邮件往来共享的线程 id。null = 建档前
的历史行或非邮件单。线程根 = 首封邮件自己的 workflow id。

***

### title

> `readonly` **title**: `string`

Defined in: [contracts/entities.ts:37](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L37)

***

### updatedAt

> `readonly` **updatedAt**: `string`

Defined in: [contracts/entities.ts:47](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L47)

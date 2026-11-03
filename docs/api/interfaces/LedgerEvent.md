[**@juli-os/ledger**](../index.md)

***

[@juli-os/ledger](../index.md) / LedgerEvent

# Interface: LedgerEvent

Defined in: [contracts/entities.ts:68](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L68)

## Properties

### entityId

> `readonly` **entityId**: `string`

Defined in: [contracts/entities.ts:73](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L73)

***

### entityType

> `readonly` **entityType**: `"agent"` \| `"workflow"` \| `"step"` \| `"judgment"`

Defined in: [contracts/entities.ts:72](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L72)

'agent'=会话运行时遥测（skill_used 等，entityId=会话名）——与
judgment 同为「无工作流实体的留痕」，2026-10-02 skill 追溯首用。

***

### id

> `readonly` **id**: `number`

Defined in: [contracts/entities.ts:69](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L69)

***

### payload

> `readonly` **payload**: [`JsonRecord`](../type-aliases/JsonRecord.md)

Defined in: [contracts/entities.ts:75](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L75)

***

### ts

> `readonly` **ts**: `string`

Defined in: [contracts/entities.ts:76](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L76)

***

### type

> `readonly` **type**: `string`

Defined in: [contracts/entities.ts:74](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L74)

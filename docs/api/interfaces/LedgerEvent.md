[**@juli-os/ledger**](../index.md)

***

[@juli-os/ledger](../index.md) / LedgerEvent

# Interface: LedgerEvent

Defined in: [contracts/entities.ts:72](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L72)

## Properties

### entityId

> `readonly` **entityId**: `string`

Defined in: [contracts/entities.ts:77](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L77)

***

### entityType

> `readonly` **entityType**: `"agent"` \| `"workflow"` \| `"step"` \| `"judgment"`

Defined in: [contracts/entities.ts:76](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L76)

'agent'=会话运行时遥测（skill_used 等，entityId=会话名）——与
judgment 同为「无工作流实体的留痕」，2026-10-02 skill 追溯首用。

***

### id

> `readonly` **id**: `number`

Defined in: [contracts/entities.ts:73](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L73)

***

### payload

> `readonly` **payload**: `JsonRecord`

Defined in: [contracts/entities.ts:79](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L79)

***

### ts

> `readonly` **ts**: `string`

Defined in: [contracts/entities.ts:80](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L80)

***

### type

> `readonly` **type**: `string`

Defined in: [contracts/entities.ts:78](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L78)

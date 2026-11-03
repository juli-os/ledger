[**@juli-os/ledger**](../index.md)

***

[@juli-os/ledger](../index.md) / findPrice

# Function: findPrice()

> **findPrice**(`model`): [`ModelPrice`](../interfaces/ModelPrice.md) \| `null`

Defined in: [platform/ledger/pricing.ts:191](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L191)

账本 model → 价目条目：小写精确命中，否则最长前缀（id+'-' 边界）。
glm-4.7-flashx 不会误吃 glm-4.7-flash 的价（边界必须是分隔符）。

## Parameters

### model

`string`

## Returns

[`ModelPrice`](../interfaces/ModelPrice.md) \| `null`

[**@juli-os/ledger**](../index.md)

***

[@juli-os/ledger](../index.md) / priceUsage

# Function: priceUsage()

> **priceUsage**(`rows`): [`UsageCost`](../interfaces/UsageCost.md)

Defined in: [platform/ledger/pricing.ts:220](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L220)

API 等效计价：行级落档计价后按模型加总。tokens 为 0 的行不产生条目。

## Parameters

### rows

readonly [`UsageRow`](../interfaces/UsageRow.md)[]

## Returns

[`UsageCost`](../interfaces/UsageCost.md)

[**@juli-os/ledger**](../index.md)

***

[@juli-os/ledger](../index.md) / UsageCost

# Interface: UsageCost

Defined in: [platform/ledger/pricing.ts:178](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L178)

## Properties

### byModel

> `readonly` **byModel**: readonly [`ModelUsageCost`](ModelUsageCost.md)[]

Defined in: [platform/ledger/pricing.ts:183](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L183)

***

### currency

> `readonly` **currency**: `"CNY"`

Defined in: [platform/ledger/pricing.ts:179](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L179)

***

### pricingRetrievedAt

> `readonly` **pricingRetrievedAt**: `string`

Defined in: [platform/ledger/pricing.ts:182](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L182)

***

### pricingSource

> `readonly` **pricingSource**: `string`

Defined in: [platform/ledger/pricing.ts:181](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L181)

***

### totalCny

> `readonly` **totalCny**: [`CostBreakdown`](CostBreakdown.md)

Defined in: [platform/ledger/pricing.ts:184](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L184)

***

### unit

> `readonly` **unit**: `"per_1m_tokens"`

Defined in: [platform/ledger/pricing.ts:180](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L180)

***

### unpricedModels

> `readonly` **unpricedModels**: readonly `string`[]

Defined in: [platform/ledger/pricing.ts:186](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L186)

不在价目内的模型（原样名单）——只显用量不出价格。

[**@juli-os/ledger**](../index.md)

***

[@juli-os/ledger](../index.md) / ModelUsageCost

# Interface: ModelUsageCost

Defined in: [platform/ledger/pricing.ts:161](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L161)

## Properties

### cachedTokens

> `readonly` **cachedTokens**: `number`

Defined in: [platform/ledger/pricing.ts:170](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L170)

***

### calls

> `readonly` **calls**: `number`

Defined in: [platform/ledger/pricing.ts:167](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L167)

***

### costCny

> `readonly` **costCny**: [`CostBreakdown`](CostBreakdown.md)

Defined in: [platform/ledger/pricing.ts:175](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L175)

***

### free

> `readonly` **free**: `boolean`

Defined in: [platform/ledger/pricing.ts:165](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L165)

***

### inputTokens

> `readonly` **inputTokens**: `number`

Defined in: [platform/ledger/pricing.ts:169](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L169)

含缓存（与详情页 promptStats 展示口径一致）。

***

### inputTokensChargeable

> `readonly` **inputTokensChargeable**: `number`

Defined in: [platform/ledger/pricing.ts:171](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L171)

***

### label

> `readonly` **label**: `string`

Defined in: [platform/ledger/pricing.ts:164](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L164)

***

### model

> `readonly` **model**: `string`

Defined in: [platform/ledger/pricing.ts:163](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L163)

账本原样 model 名（展示与对账用，未加工）。

***

### outputTokens

> `readonly` **outputTokens**: `number`

Defined in: [platform/ledger/pricing.ts:172](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L172)

***

### priced

> `readonly` **priced**: `boolean`

Defined in: [platform/ledger/pricing.ts:166](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L166)

***

### tiersHit

> `readonly` **tiersHit**: readonly `string`[]

Defined in: [platform/ledger/pricing.ts:174](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/pricing.ts#L174)

命中的档位说明（去重，人可读）。

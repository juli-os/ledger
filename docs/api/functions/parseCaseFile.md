[**@juli-os/ledger**](../index.md)

***

[@juli-os/ledger](../index.md) / parseCaseFile

# Function: parseCaseFile()

> **parseCaseFile**(`raw`, `now`): [`CaseFileDoc`](../interfaces/CaseFileDoc.md)

Defined in: [platform/ledger/casefile.ts:59](https://github.com/juli-os/ledger/blob/main/src/platform/ledger/casefile.ts#L59)

解析库里的 JSON 列；空/坏值 → 空白案卷（容忍历史数据）。

## Parameters

### raw

`string` \| `null`

### now

`Date`

## Returns

[`CaseFileDoc`](../interfaces/CaseFileDoc.md)

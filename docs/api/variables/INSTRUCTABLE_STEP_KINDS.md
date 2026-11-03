[**@juli-os/ledger**](../index.md)

***

[@juli-os/ledger](../index.md) / INSTRUCTABLE\_STEP\_KINDS

# Variable: INSTRUCTABLE\_STEP\_KINDS

> `const` **INSTRUCTABLE\_STEP\_KINDS**: readonly [`StepKind`](../type-aliases/StepKind.md)[]

Defined in: [contracts/entities.ts:31](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L31)

能承载指令补丁的步（plan/prompt/session）：engine rework 回扫与 retry
patch 两处同口径（llm/draft 也吃指令，但不可插话干预）。

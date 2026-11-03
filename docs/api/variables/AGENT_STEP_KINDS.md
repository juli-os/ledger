[**@juli-os/ledger**](../index.md)

***

[@juli-os/ledger](../index.md) / AGENT\_STEP\_KINDS

# Variable: AGENT\_STEP\_KINDS

> `const` **AGENT\_STEP\_KINDS**: readonly [`StepKind`](../type-aliases/StepKind.md)[]

Defined in: [contracts/entities.ts:27](https://github.com/juli-os/ledger/blob/main/src/contracts/entities.ts#L27)

跑 agent 的步（可干预/可回修/计入「干活」）：engine intervene/align/
reworkSend/assignSession 五处 + store.runningAgentStepForSession 两路 SQL
同口径（SQL 经 sqlInList 消费）。

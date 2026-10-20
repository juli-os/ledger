# PROBLEMS.pkgreview-20261020 — @juli-os/ledger 逐文件 review & fix 台账

- 日期：2026-10-20；范围：本仓全部 13 个 TS 文件（/tmp/pkgreview-ledger.txt），每文件一子 agent 保守修
- 纪律：只修 100% 不改行为项（已发包铁律：公开行为/导出签名/wire 格式/存储布局一律只报告）；test 断言/fixture 不动；零 git 写操作
- 基线快照 /tmp/pkgreview-baseline/ledger/；批次报告 /tmp/pkgreview-reports/batch-0*.json
- 验证终态：npm run build + npm test 全绿（见总控汇总）

## 逐文件明细

### bin/juli-ledger.ts

fixed=1 reported_only=2

- **P1** L30 [fixed] 'completed' as never 说谎强转（本身是合法联合成员，比 as any 更危险），删
- **P2** L57 [reported-only] --days N 标志只检测存在性，N 从未解析——帮助文本宣称被静默忽略
- **P2** L50 [reported-only] show 缺 id 时输出 'Workflow not found: undefined'

### src/contracts/entities.ts

fixed=0 reported_only=1

- **P2** L39 [reported-only] 消费线索复核：Workflow.session 类型没说谎——写路径确写 null 但读路径 str() 门面一律强转 ''，声明自洽；消费仓的 ?? '' 是过度防御，真 null 出在消费仓自己的裸 SQL 投影

### src/contracts/statuses.ts

fixed=0 reported_only=5

- **P1** L1 [reported-only] 名单三份拷贝（本文件+消费仓镜像+web 手写副本），web 副本是未收编的漂移点
- **P2** L66 [reported-only] stepStatusDef 双仓零消费（镜像公开面锁定禁删）
- **P2** L36 [reported-only] WorkflowStatusDef/StepStatusDef 导出零消费（为镜像面导出）
- **P2** L116 [reported-only] sqlInList 注释「值全来自本文件」失实（store 以 AGENT_STEP_KINDS 调用，仍无注入风险）
- **P2** L70 [reported-only] statusLabelOf 命名泛化但只查 workflow 名单（step 键 fallback 英文；现调用点均 workflow 态）

### src/index.ts

fixed=0 reported_only=1

- **P2** L36 [reported-only] JudgmentQuestion 出现在 ask 签名里但 facade 未 re-export（下游无法按名引用；词汇缺口非缺陷）

### src/platform/ledger/casefile.ts

fixed=0 reported_only=3

- **P2** L82 [reported-only] updatedAt 往返不对称（写 camel 读 snake，round-trip 被 now 重盖；Go wire 兼容疑刻意）
- **P2** L79 [reported-only] pick 守卫只查单键（容忍历史数据的宽松解析，与 readonly 声明不符的边界）
- **P2** L106 [reported-only] appendSection 语义是整体替换非追加（命名沿袭 Go，API 名禁改）

### src/platform/ledger/pricing.ts

fixed=1 reported_only=2

- **P2** L245 [fixed] priceUsage 循环内 findPrice 每行重算+非空断言，复用 accumulator 已算结果
- **P2** L216 [reported-only] tierOf 空数组兜底非空断言（收紧需改公开类型面）
- **P2** L258 [reported-only] inputTokensChargeable 聚合 clamp vs costCny 按行 clamp——病态行下两口径可分歧（脏数据才触发）

### src/platform/ledger/store.ts

fixed=5 reported_only=2

- **P1** L357 [fixed] getWorkflow 与局部 helper getWorkflowById 逐行重复，委托收口
- **P1** L483 [fixed] getStep 与 getStepById 逐行重复，委托收口
- **P1** L707 [fixed] sentMessageIdExists 手写 dedupPattern 转义逻辑（仅 JSON 键名不同），提 jsonFieldPattern
- **P2** L564 [fixed] runningAgentStepForSession 两段 SQL 重复 7 行投影前缀，提局部 const
- **P2** L600 [fixed] sessionHasOpenWork 手写 status IN 字面量未走单一事实源（sqlInList 产出逐字节同），改常量
- **P2** L649 [reported-only] createRun/createPrompt 各调 now() 两次——秒边界跨越时返回值与落库值可差 1 秒（修=改返回值）
- **P2** L129 [reported-only] 接口注释残缺缺词（原词无法确定不猜）

### src/platform/ledger/usage.ts

fixed=3 reported_only=2

- **P1** L289 [fixed] mapped Set 死代码（已删跳过逻辑的残留）+ 上方过期注释描述不存在的设计，删
- **P1** L126 [fixed] windowUsageRows/perSessionWindows 逐字符相同的 3 行窗口条件构造，提 windowConds
- **P2** L365 [fixed] ingestFile 循环内每行重复 tmuxOf SELECT（事务内归属恒不变），提循环外
- **P2** L376 [reported-only] last_ingested_at 用真实时钟绕过注入 now（可测性不一致，修=改落库数据）
- **P2** L368 [reported-only] String(rec.callContext) 冗余包裹（噪音级）

### src/platform/shared/clock.ts

fixed=0 reported_only=2

- **P2** L1 [reported-only] 家族三仓副本（本仓份是下游消费的权威源）
- **P2** L17 [reported-only] randomIds 用 Math.random（账本主键非令牌+可注入端口，有意取舍）

### src/platform/shared/json.ts

fixed=0 reported_only=4

- **P1** L1 [reported-only] 整文件本仓死代码（家族同形+已发布 .d.ts 面禁删）
- **P2** L1 [reported-only] npm 包发布孤儿 .d.ts（无对应 .js，exports 不可达，tarball 死重）
- **P2** L1 [reported-only] json 家族：l0/l2/routing 逐字节同、ledger 裁剪版——生态事实源已收编 artifacts
- **P2** L29 [reported-only] truncate n=0 返回 '…'（同款边界）

### test/regression.test.ts

fixed=0 reported_only=2

- **P2** L17 [reported-only] 9 处 as never 强转（字面量本合法；全仓测试惯例禁动）
- **P2** L19 [reported-only] find(...)! 非空断言（失败即 TypeError 响亮）

### test/smoke.test.ts

fixed=0 reported_only=3

- **P2** L20 [reported-only] decideRoute 实参 as never 断言禁用全部类型检查（字面量本可结构满足 Routing；fixture 禁动）
- **P2** L60 [reported-only] FbRecord 实参 as never 伪造部分记录（as FbRecord 更诚实；fixture 禁动）
- **P2** L27 [reported-only] test1/test2 routing fixture 骨架雷同仅值不同（per-test 隔离惯例）

### test/surface.test.ts

零发现。

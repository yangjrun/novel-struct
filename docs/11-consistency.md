# M4 一致性遍基础设施

`packages/db/src/schema/facts.ts` 存关系、状态事实、状态变化、事件和伏笔，每条事实必须引用本项目自己的 `source_refs`。`commitConsistencyFacts` 在一个事务里核对书/版本/章、实体和场景归属及证据原文的 UTF-16 切片；状态字段发生变化时保留旧值，旧行设置 `valid_to_chapter_id` 与 `superseded_by` 并新增 `state_changes`；伏笔可用 `resolveForeshadowIds` 标记解决。低于 0.6 的状态/关系置信度会进入复核队列。

一致性遍的事实、证据和成功的 `parse_runs` 状态同事务提交。结构遍重解析或版本内容重导入时会清理失效的一致性事实及其专属证据，保留未改章节的结构遍成果；失败的模型输出不会留下部分事实。

`buildConsistencyContext(db, ir, { budget, embedder? })` 获取本版本此前章节的实体状态、各实体最近 3 次出场、未解伏笔、未消解称呼，以及可选的同书历史相似场景，按固定顺序装入预算。相同数据库与 IR 产生相同上下文包；`estimatedTokens` 是保守字符估算，不等同模型的精确分词器。`pnpm cli parse-consistency <editionId> --from 0 --to 10 --budget 3000` 从已存结构遍恢复章节 IR、调用 LLM 抽取事实、校验证据并逐章提交；每章有 `parse_runs`，失败时停止后续章节，重跑跳过已成功的章节，同一本书由书锁互斥。提示词与模型质量仍需真实语料评测。

实体 v2 的入口提供 `resolveEntityNameAt`（别名章节区间）、`setEntityAliasInterval`、`mergeEntities`/`splitEntity`（`entity_merges` 审计）以及 `review_items`；Web 的复核页可认可或驳回低置信度事实。合并/拆分不自动迁移旧事实或重新归属旧章；此决策必须根据真实语料与评测集完善。

`GET /api/editions/:id/timeline` 与版本页“时间线”按章节 index 排列事件，另显示可为空的 `story_time`；`GET /api/books/:id/reviews` / `POST /api/books/:id/reviews/:id` 用于复核。结构遍重解析或变动章节重新导入会清空受影响版本的一致性派生事实，避免旧证据、场景、章节次序失效。

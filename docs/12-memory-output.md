# M5 记忆与 TTS 任务

`@novelstruct/memory` 提供 `MemoryStore` 接口与 `createPostgresMemoryStore(db)`。`rebuild(bookId)` 在事务内先删除该书的派生 `memory_items`，然后仅从 `state_facts`、`relationships`、`events`、`foreshadows` 重建；源事实、原文和证据不受影响。`recallState(bookId, entityId, chapterIndex, editionId)` 按章节有效区间读取状态；`recallSimilar(bookId, query, limit, editionId, atChapterIndex?)` 使用中文分词后的确定性关键词匹配，返回来源表与事实 ID，记忆检索不跨书或版本。解析器始终指定当前章之前的截止位置；不传截止位置的调用保留全版本查询语义。

事实提交在同一事务内增量更新 `memory_items`，包括状态/关系被替换和伏笔被解决时的有效区间。投影失败会回滚事实写入。`pnpm cli memory-rebuild <bookId>` 可手动重建，并与事实写入按书加锁；旧数据库升级后可用它补齐既有事实的记忆。重解析或重新导入导致一致性事实失效时，对应版本的派生记忆自动清空，事实重新生成时自动更新记忆。结构遍与一致性遍的召回接线见 [解析闭环](13-parser-memory-loop.md)。

`@novelstruct/output` 的 `tasksFromIR` 和 `buildChapterTtsTasks` 分别从新 IR 或已存结构遍结果生成 TTS 任务，按分段顺序全覆盖原文，保留原文偏移、场景、说话人、情绪和角色声音设置。`voice_profiles` 在书的角色实体上记录服务商、voice ID 与可选参数；未配置的角色声音由调用者指定备用声线，旁白可单独指定声音。任务生成不会调用外部合成服务。`GET /api/editions/:id/chapters/:index/tts` 导出任务；`GET /api/books/:id/voices` 与 `PUT /api/books/:id/voices/:entityId` 管理声音，实体页提供配置入口，章节页提供 JSON 下载。

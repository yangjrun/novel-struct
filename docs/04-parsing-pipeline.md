# 解析流水线

版本 0.1 ｜ 对应 `packages/parser`

## 1. 总览

每章两遍。结构遍产出 `ChapterIR` 的场景、分段、实体、提及；一致性遍在结构遍的基础上产出关系、事件、状态变化、伏笔，并做跨章消解。

```
chapter.text
   │
   ├─ 确定性：段落切分、引号对白抽取
   │
   ├─ LLM：说话人归属、情绪、实体抽取、场景切分       ← 结构遍
   │
   ├─ 组装：对白之外全部为旁白，实体消解，证据定位
   │
   ├─ Validator：不通过则整章失败，不写库
   │
   ▼
ChapterIR ──写库──▶ scenes / segments / entities / mentions
   │
   ├─ Context Builder：相关实体当前状态、最近出场、未解决伏笔   ← 一致性遍（M4）
   │
   ├─ LLM：关系、事件、状态变化、伏笔，每条带原文引用
   │
   ├─ Validator：证据必须能在原文定位
   │
   ▼
facts ──写库──▶ relationships / state_facts / events / foreshadows，supersede 旧值
   │
   ▼
MemoryStore 更新（派生）
```

## 2. 结构遍

### 为什么不让 LLM 重写全文

让模型逐段重新输出原文，既贵又不稳，还要靠字符串匹配把输出对回原文。改为：

1. 确定性抽取对白。同一段落内闭合的 `“…”`、`「…」`、`"…"` 视为对白候选，未闭合的按旁白处理并记录警告。对白不跨段落。
2. 给每个对白候选编号，连同段落列表和已知实体列表交给模型，模型只输出归属结果：`{ quoteId, speaker, confidence, emotion }`，以及实体列表和场景段落区间。
3. 系统组装分段：对白候选之外的所有区间自动成为旁白，全覆盖由构造保证，Validator 再检查一次。

好处：模型输出量缩小一个数量级；输出可以逐条校验；同一份对白候选可以喂给不同归属器做对比评测。

### 归属器接口

```ts
interface SpeakerAttributor {
  readonly name: string;            // 'heuristic' | 'llm'
  attribute(input: AttributionInput): Promise<AttributionResult>;
}
```

- `heuristic`：利用 `X说道：“…”`、`“…”X道。` 等模式，无需模型，作为基线和离线演示。
- `llm`：OpenAI 兼容接口，JSON 模式，输出经 zod 校验，失败即报错，不猜。

### 实体消解 v1

- 模型给出的每个实体名，先在本书 `entities.canonical_name` 与 `entity_aliases.alias` 中精确匹配。
- 命中则复用实体 ID，并把本章新观察到的别名并入别名表。
- 未命中则新建实体，`confidence` 取模型给的值。
- 同名不同类型不合并。
- 每次新建、每次别名并入都可以追溯到 `parse_run_id`。

### 增量重解析

`parse_runs` 记录 `prompt_version`、`model`、`attributor`，`chapters` 记录 `content_hash`。三者任一变化才重跑该章，否则跳过。全库重解析必须是显式命令。

### 重试、接管与幂等

每章开始前读一次该章的运行记录（`inspectChapterRuns`），按顺序做四个判断：

1. 有 `running` 记录且心跳在 60 秒内：别的进程正在解析这一章，跳过并说明是谁。心跳每 15 秒刷新一次，比最慢的 LLM 请求间隔短得多。
2. 有 `running` 记录但心跳停了：那个进程已经死了，把记录标成 `interrupted`，本进程接管。
3. 同一键下已有成功记录：跳过，除非 `force`。
4. 同一键下 `failed` 的次数达到上限（默认 3，`--max-attempts` 或接口的 `maxAttempts` 可改）：跳过，除非 `force`。上限保护的是 token：一章因为程序缺陷或原文异常而确定性失败时，不该每次发起任务都再烧一遍模型调用。`interrupted` 不计入次数。

通过后新建一条记录，`attempt` 等于同键历史记录数加一，`worker_id` 是 `host:pid`。API 和 worker 启动时会清扫一遍：PGlite 只能被一个进程打开，所以启动时所有 `running` 记录都标 `interrupted`；PostgreSQL 下只清扫心跳停止超过 60 秒的，避免误伤另一个还活着的 worker。

幂等性来自两层：`commitChapterIR` 在一个事务里先删该章旧的场景、分段、提及和证据，再写新的，所以同一章被重复提交、甚至被两个进程先后提交，事实层都只剩最后一次的完整结果；实体和别名只增不删，重复提交时通过已知实体表复用 ID，不会产生重复实体。任务级别不做自动重试，再发一次任务就是重试，成功过的章会被跳过。LLM 客户端内部对 408、429、5xx 和网络错误各重试两次，处理的是瞬时故障，与这里的章级次数上限是两个层次。

## 3. 一致性遍（M4）

### Context Builder

输入是结构遍的 IR。输出是一份有预算上限的上下文包：

| 内容 | 来源 | 上限 |
|---|---|---|
| 本章提及实体的当前状态 | `state_facts`，valid_to 为空的行 | 每实体 20 条 |
| 每个实体最近出场 | `entity_mentions` 按章节倒序 | 每实体 3 处，各带 200 字上下文 |
| 未解决伏笔 | `foreshadows`，resolved 为空 | 20 条 |
| 未消解的称呼 | 结构遍 speaker 只有 surface 的分段 | 全部 |
| 语义相似历史片段 | pgvector，按本书过滤 | 10 条 |

上下文包是确定性的：同样的数据库状态和同样的 IR 得到同样的包，方便复现和评测。

### 输出与写库

- 每条关系、状态、事件都必须带原文引用 `{ charStart, charEnd, quote }`，写库前校验 `quote` 等于切片。
- 状态变化写入时对旧行执行 supersede：旧行 `valid_to_chapter_id` 置为本章，`superseded_by` 指向新行。旧行不删除。
- 消解结果置信度低于 0.6 的进入 `review_items`。

### 实体消解 v2

- 别名按章节区间生效，支持"第 800 章揭露 A 就是 B"这类合并，合并写入 `entity_merges`，旧实体标记 `merged`。
- 拆分同理，走审计表。
- 消解规则和阈值有独立的评测集，改动必须先过评测。

## 4. 成本模型

| 项目 | 估算 |
|---|---|
| 1000 本 × 1000 章 × 3000 字 | 约 30 亿字 |
| 两遍解析加历史上下文 | 约 100 亿输入 token |
| 便宜模型按每百万 token 0.5 美元 | 单次全量约 5000 美元 |

由此得出的规则：

- 结构遍默认用便宜模型。
- 一致性遍只对有对白归属失败、有实体新建、或结构遍标记了状态变化迹象的场景调用贵模型。
- 提示词改版不自动触发全量重跑，先在评测集上比较，再显式发起。
- 记录每次运行的 token 用量，成本看板是 M2 队列的一部分。

## 5. MemoryStore 接口（M5）

```ts
interface MemoryStore {
  recallState(bookId: string, entityId: string, atChapterIndex: number): Promise<StateFact[]>;
  recallSimilar(bookId: string, query: string, limit: number): Promise<MemoryHit[]>;
  rebuild(bookId: string): Promise<void>;   // 只读事实层，整体重建
}
```

第一版实现读 `state_facts` 与 `memory_items`。MemPalace 适配器实现同一接口，Wing 对应 `book:<id>`，Room 对应 `memory_items.room`。适配器不允许跨 Wing 检索，共享世界观走 `universe_facts`。

## 6. 评测

- 说话人归属：每本书手工标注 50 条对白作为金标，报告准确率与未归属率。
- 实体抽取：标注 20 章的实体列表，报告查准查全。
- 全覆盖：Validator 通过率必须为 100%，否则是程序错误不是模型错误。

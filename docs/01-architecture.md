# NovelStruct 架构设计

版本 0.1 ｜ 2026-09-20 ｜ 状态：已采纳，随里程碑更新

## 1. 目标

长期管理几十到上千本小说，把每本小说的每一章持续结构化为统一的 Novel IR，并以 IR 支撑：

- 多人有声小说（按角色分配声音、按情绪调整朗读）
- 视频生成（场景、人物、动作、环境）
- 跨书、跨系列、跨共享宇宙的结构化查询

## 2. 三层原则

这是整个项目的裁决规则。任何设计争议先回到这张表。

| 层 | 承载系统 | 回答的问题 | 可否重建 |
|---|---|---|---|
| 证据层 | 规范化原文，加检索索引（pgvector，后续可接 WeKnora） | 原文是什么 | 原文不可变，索引随时可重建 |
| 事实层 | PostgreSQL | 事实是什么 | 唯一真相，不能从别处重建 |
| 记忆层 | MemoryStore 接口，第一版由 PostgreSQL 实现，后续可接 MemPalace | 解析到当前章为止"记得"什么 | 必须能从事实层整体重建 |

三条硬规则：

1. 没有证据引用的事实不允许进入事实层。数据库层面以非空外键约束实现。
2. 记忆层任何时候都可以删掉重建，重建输入只有事实层。
3. 证据引用指向自己的规范化文本偏移，不指向第三方系统的 chunk id。第三方 chunk id 只能作为可选的二级指针。

## 3. 总体架构

```
                       TXT / EPUB
                           │
                           ▼
                   novel-ingest  规范化、章节与段落切分、稳定 ID
                           │
                           ▼
                 PostgreSQL  editions / chapters（规范化原文，带偏移）
                           │
                           ▼
                   novel-parser  两遍解析
                    ▲          ▲
        原文与历史检索        记忆召回
                    │          │
            证据层索引      MemoryStore
                    │          │
                    └────┬─────┘
                         ▼
                     Novel IR
                         │
                    Validator  全覆盖、证据、引用完整性
                         │
                         ▼
                 PostgreSQL  事实层（场景、分段、实体、关系、状态）
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
      MemoryStore       TTS          视频
      派生，可重建
```

WeKnora 与 MemPalace 的位置：两者都是适配器。WeKnora 是面向人和 Agent 的跨书检索工具，不承载事实。MemPalace 是 MemoryStore 的一种实现，只有在 Agent 的 MCP 交互确实需要时才引入。

## 4. 数据层级与作用域

```
Library
└── Universe（可选，共享世界观）
    └── Series（可选）
        └── Book
            └── Edition（同一本书的不同版本）
                └── Volume（可选）
                    └── Chapter
                        └── Scene
                            └── Segment（旁白或对白，有序、全覆盖）
```

作用域规则：

- 章节级记录只落 `edition_id` 和 `chapter_id`。实体落 `book_id`。事实落 `book_id`、`edition_id` 和章节有效区间。
- `universe_id` 和 `series_id` 只存在 `books` 表上，通过 join 得到，不冗余到事实行。
- 归属：章节、场景、分段、证据属于 Edition；实体属于 Book，跨版本共享；共享世界观设定属于 Universe，并且只存不随剧情变化的内容。
- 查询默认作用域是单本书。跨书或跨宇宙检索必须由调用方显式指定，系统不做自动跨域。
- `tenant_id` 在真正多租户之前不引入。

## 5. 模块划分

pnpm workspace，按领域拆包，包之间只通过导出的类型和函数依赖。

| 包 | 职责 | 里程碑 |
|---|---|---|
| `@novelstruct/core` | ID 生成、Novel IR 的 zod schema、Validator、偏移工具 | M0 |
| `@novelstruct/ingest` | 编码识别、章节与卷标题识别、段落切分、规范化输出 | M0 |
| `@novelstruct/db` | drizzle schema、迁移、仓储函数、PGlite 与 PostgreSQL 双驱动 | M0 |
| `@novelstruct/parser` | 引号对白抽取、说话人归属、实体消解、结构遍编排、LLM 客户端 | M0 |
| `@novelstruct/cli` | import / parse / show / books / report 命令 | M0 |
| `@novelstruct/report` | 结构遍结果的 HTML 报告，纯函数渲染，无外部依赖 | M0 |
| `@novelstruct/pipeline` | 导入、解析、报告的编排与环境读取，CLI 与 API 共用 | M0 |
| `@novelstruct/api` | Hono HTTP 接口，统一响应信封，进程内解析任务队列 | M0 |
| `@novelstruct/web` | Vue 3 管理界面：导入、解析任务、章节阅读、实体、报告 | M0 |
| `@novelstruct/queue` | BullMQ 任务编排，替换 api 内存队列 | M2 |
| `@novelstruct/knowledge` | 检索层适配（pgvector，WeKnora） | M3 |
| `@novelstruct/memory` | MemoryStore 接口与实现 | M5 |
| `@novelstruct/output` | TTS、有声书、导出 | M5 |

## 6. 技术栈

| 层 | 选择 | 说明 |
|---|---|---|
| 语言 | TypeScript，Node 22 | 领域模型只存在一种语言 |
| 数据库 | PostgreSQL 16 加 pgvector | 本地开发默认 PGlite 文件库，零安装 |
| ORM 与迁移 | drizzle-orm，drizzle-kit | schema 即代码 |
| 校验 | zod | IR 与 LLM 输出的唯一 schema 来源 |
| LLM | OpenAI 兼容 HTTP 接口 | 不绑定 SDK，直接 fetch |
| 测试 | vitest | 纯函数为主，数据库测试用 PGlite 内存实例 |
| 队列 | BullMQ 加 Redis | M2 引入 |
| 检索 | pgvector 起步，WeKnora 可选 | M3 引入 |
| 记忆 | PostgreSQL 实现起步，MemPalace 可选 | M5 引入 |
| 前端与 API | Vue 3，Hono | M0 起有管理界面；接口少，不用 NestJS |

## 7. 与原始方案的差异

| 项 | 原方案 | 采纳方案 | 原因 |
|---|---|---|---|
| 证据引用主键 | WeKnora chunk id | 自有文本偏移，chunk id 可选 | 重建索引不应断掉证据链 |
| 记忆层 | MemPalace 硬依赖 | MemoryStore 接口，PostgreSQL 先行 | 派生数据不该成为核心依赖 |
| 作用域字段 | 八个 id 冗余到每行 | 只落必要 id，其余 join | 避免全表重写和更新异常 |
| 实体归属 | 未定义 | 实体属于 Book，章节与证据属于 Edition | 避免多版本产生多套实体 |
| 时间轴 | 只有章节区间 | 章节区间加可空的故事时间 | 回忆与多线叙事需要区分 |
| IR 场景内容 | 对白列表 | 有序全覆盖分段 | TTS 不漏读不重读 |
| 说话人归属 | LLM 重写全文输出 | 确定性抽引号，LLM 只做归属 | 更便宜、更稳、可校验 |
| 后端语言 | NestJS 加 Python worker | 全 TypeScript | IR schema 只写一遍 |
| 起步顺序 | 七模块三后端并起 | 单本书垂直切片 | 风险全在解析质量 |

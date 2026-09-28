# NovelStruct

小说理解与结构化平台。把一本本小说持续解析成统一的 Novel IR，支撑多人有声小说、视频生成和跨书查询。

## 三层原则

| 层 | 系统 | 回答的问题 |
|---|---|---|
| 证据层 | 规范化原文与检索索引 | 原文是什么 |
| 事实层 | PostgreSQL | 事实是什么 |
| 记忆层 | MemoryStore，可从事实层重建 | 目前记得什么 |

没有证据引用的事实不允许进入事实层。记忆层随时可以删掉重建。

## 文档

- [01 架构设计](docs/01-architecture.md)
- [02 数据模型](docs/02-data-model.md)
- [03 Novel IR 规范](docs/03-novel-ir.md)
- [04 解析流水线](docs/04-parsing-pipeline.md)
- [05 路线图](docs/05-roadmap.md)
- [06 报告可视化](docs/06-report.md)
- [07 Web 管理界面](docs/07-web.md)
- [08 归属评测](docs/08-eval.md)
- [09 任务队列](docs/09-queue.md)
- [10 检索层与鉴权](docs/10-knowledge.md)
- [11 一致性遍基础设施](docs/11-consistency.md)
- [12 记忆与 TTS 任务](docs/12-memory-output.md)

## 快速开始

```bash
pnpm install
pnpm test
pnpm typecheck

# 导入一本 TXT，默认使用本地 PGlite 文件库 ./data
pnpm cli import packages/ingest/test/fixtures/demo-novel.txt --title "示例小说" --author "示例作者"

# 导入一本 EPUB，书名与作者取自文件元数据，按目录切章
pnpm cli import novels/某书.epub

# 列出书与版本
pnpm cli books

# 用启发式归属器解析 index 1 到 3 的章节（index 从 0 开始，import 输出里会列出；不需要模型）
pnpm cli parse <editionId> --from 1 --to 3 --attributor heuristic

# 用 OpenAI 兼容模型解析，需先配置 .env
pnpm cli parse <editionId> --from 1 --to 3 --attributor llm

# 按分段顺序查看 index 为 1 的章节，终端里每个角色一种颜色（--no-color 关闭）
pnpm cli show <editionId> 1

# 生成结构遍 HTML 报告（对白归属状态、旁白占比、角色对白数、角色出场分布）
pnpm cli report <editionId>            # 写到 reports/<editionId>.html，浏览器直接打开

# 用金标对白评测归属器，不写库；金标格式与基线见 docs/08-eval.md
pnpm cli eval <editionId> --attributor heuristic --verbose

# 只读预览 index 3 的一致性候选，固定已存结构与历史事实，输出 JSON 供复核
pnpm -s cli preview-consistency <editionId> 3 --budget 3000

# 用 Jev 只读复核已保存的预览，检查各条引用是否完整支持断言（需 TYPESAFE_API_KEY）
pnpm -s cli review-consistency eval/out/preview-ch3.json
```

`parse` 默认跳过作者留言 `note` 与前言 `front_matter`；确需解析时显式传 `--all-kinds`。

网页有模型配置时默认选 LLM。可选配置 `TYPESAFE_API_KEY`，让 Jev 影子复核引号对白及一致性事实证据，意见显示在章节页但不自动修改结果；中文样例与只读评测命令 `pnpm cli eval-shadow <editionId>` 见 [08 归属评测](docs/08-eval.md)。

同一书名（同作者）同版本标签再次 `import`，会原地更新那个版本：内容没变的章节保留 ID 和解析结果，变了的保留 ID 但清掉解析结果，新增删除照常。作者的请假、上架感言等留言会切成 `note` 类章节，不混进正文。TXT 与 EPUB 的切章规则见 [novels/README.md](novels/README.md)。

使用真实 PostgreSQL 时，复制 `.env.example` 为 `.env` 并设置 `DATABASE_URL`，或 `docker compose up -d` 启动本地实例。

## Web 管理界面

```bash
pnpm dev            # 同时启动 API（http://localhost:3100）和前端（http://localhost:5173）
```

浏览器打开 http://localhost:5173：导入 TXT 或 EPUB、按章节范围发起解析并看进度、逐章阅读分段与说话人、查看实体、打开报告。接口与页面说明见 [07 Web 管理界面](docs/07-web.md)。配置 `API_TOKEN` 即启用 Bearer 鉴权；未配置时 API 默认只监听本机。
检索和 API 访问令牌用法见 [10 检索层与鉴权](docs/10-knowledge.md)。

生产式部署：`pnpm web:build` 后设置 `NOVELSTRUCT_WEB_DIST=packages/web/dist`，再 `pnpm api`，一个进程同时提供接口和页面。

## 包

| 包 | 职责 |
|---|---|
| `packages/core` | ID、Novel IR schema、Validator、偏移工具 |
| `packages/ingest` | TXT 与 EPUB 规范化、章节与段落切分 |
| `packages/db` | drizzle schema、迁移、仓储 |
| `packages/parser` | 对白抽取、说话人归属、实体消解、结构遍 |
| `packages/report` | 结构遍结果的自包含 HTML 报告，纯函数渲染 |
| `packages/pipeline` | 导入、解析、报告的编排，CLI 与 API 共用 |
| `packages/api` | Hono HTTP 接口与进程内解析任务队列 |
| `packages/web` | Vue 3 管理界面 |
| `packages/cli` | 命令行入口 |
| `packages/knowledge` | 场景向量检索与可选的 WeKnora 派生索引 |
| `packages/memory` | 从事实层重建 PostgreSQL 记忆视图 |
| `packages/output` | IR 分段的 TTS 任务与角色声音映射 |

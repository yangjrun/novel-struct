# Web 管理界面

版本 0.1 ｜ 对应 `packages/pipeline`、`packages/api`、`packages/web`

## 1. 定位

命令行已经能完成导入、解析、查看和报告，但每次都要复制版本 ID、记 index、翻终端输出。Web 界面把同一套操作放到浏览器里：导入 TXT、按范围发起解析并看进度、逐章阅读分段、查看实体、打开报告。它是管理台，不是给读者用的阅读器。

三层原则不变：界面只读事实层，写入仍然只经过 `commitChapterIR` 和 `importNormalizedBook`。界面上没有任何"手改事实"的入口，这要等 M4 的复核队列。

## 2. 分包

```
cli ──┐
      ├──> pipeline ──> db / ingest / parser / report
api ──┘
       ▲
web ───┘ 只依赖 api 的 contracts（纯类型）
```

| 包 | 职责 |
|---|---|
| `@novelstruct/pipeline` | 导入、解析编排、报告构建、环境变量读取。CLI 和 API 共用，不再各写一份。错误统一是 `PipelineError`，带 `not_found` / `invalid_input` / `not_configured` / `conflict` 四种 code |
| `@novelstruct/api` | Hono 服务。所有 JSON 接口在 `/api` 下，统一信封 `{ success, data, error }`。解析任务交给 `@novelstruct/queue` 的 `JobQueue`，见 `09-queue.md` |
| `@novelstruct/web` | Vue 3 + vue-router + Vite，无 UI 框架。类型从 `@novelstruct/api/contracts` 引，浏览器包里不会带进任何 node 代码 |

CLI 的 `parse` 现在也走 `pipeline.parseEdition`，行为和之前一致，只是逐章输出改由事件回调驱动。

## 3. 接口

| 方法与路径 | 说明 |
|---|---|
| `GET /api/config` | 数据库类型、队列类型、是否配置了模型、可用归属器、单价配置 |
| `GET /api/books` | 书和版本列表 |
| `GET /api/usage` | 全库 token 用量与估算成本，按版本、归属器、模型分组 |
| `POST /api/books/import` | multipart：`file`（TXT 或 EPUB）、`title?`、`author?`、`label?`。上限 64 MB。EPUB 可以不给 `title` 和 `author`，取文件元数据；TXT 没有 `title` 返回 400。新版本返回 201；同书名同标签再次上传原地更新，返回 200 且 `reimport` 给出 kept / updated / added / removed。`warnings` 列出按正文保留的重复标题等 |
| `DELETE /api/books/:id` | 删掉一本书及其全部版本、章节、解析记录、结构结果、实体和证据，一个事务内完成，返回书名与版本数、章数。该书还有排队或运行中的任务返回 409；别的进程持有书锁（正在解析）也返回 409 并给出持有者；不存在返回 404 |
| `GET /api/editions/:id` | 版本详情，每章附分段数与最近一次解析记录 |
| `GET /api/editions/:id/chapters/:index` | 某章的分段；未解析时返回原文，同时给前后章 index |
| `GET /api/editions/:id/entities` | 全书实体，带别名、对白数、提及数 |
| `GET /api/editions/:id/runs` | 该版本全部解析记录，含 `attempt`、`workerId`、`heartbeatAt` |
| `GET /api/editions/:id/usage` | 该版本的 token 用量与估算成本 |
| `GET /api/editions/:id/report` | 直接返回自包含 HTML 报告 |
| `POST /api/editions/:id/parse` | JSON：`from?`、`to?`、`attributor?`、`force?`、`maxAttempts?`（1 到 20，默认 3）。入队成功返回 202 和任务 |
| `GET /api/jobs`、`GET /api/jobs/:id` | 任务列表与详情，含逐章事件 |
| `POST /api/jobs/:id/cancel` | 排队中的立即取消；运行中的在当前章结束后停止 |

错误：参数问题 400，找不到 404，冲突（书正在解析或还有任务）409，文件过大 413，其余 500 且不泄露内部信息。zod 校验失败的信息会列出字段路径。

## 4. 任务模型

任务由 `@novelstruct/queue` 的 `JobQueue` 管理，两种实现：没有 `REDIS_URL` 时是进程内 FIFO，同一时刻只跑一个任务，重启丢失排队任务；有 `REDIS_URL` 时是 BullMQ，任务与逐章进度存 Redis，重启后续跑，worker 可以独立部署。详见 `09-queue.md`。入队前先 `planEditionParse`，所以版本不存在、范围为空、选了 llm 但没配 key 这类错误在 HTTP 响应里就返回，不会产生一个注定失败的任务。

每章的 `parse_runs` 记录和解析结果都在数据库里，页面上的"最新解析"列来自数据库，不依赖任务列表。完成的任务最多保留 50 个。`GET /api/config` 的 `queue` 字段是 `memory` 或 `bullmq`。

前端在有活动任务时每 1.5 秒轮询一次任务和版本详情，没有活动任务时不轮询。

## 5. 页面

| 路由 | 内容 |
|---|---|
| `/` | 导入表单，书与版本表；每本书有"删除"按钮，浏览器确认后调用 `DELETE /api/books/:id` |
| `/editions/:id` | KPI（章数、已解析、最近失败或中断、运行中任务、token 用量与估算成本）、解析表单、最近任务卡片、章节表（可按已解析 / 未解析 / 最近失败或中断筛选） |
| `/editions/:id/chapters/:index` | 阅读视图：场景分隔、旁白段落、对白卡片按归属状态着色（已消解 / 只有称呼 / 未知 / 心声），前后章导航 |
| `/editions/:id/entities` | 实体表，按类型筛选，按名字或别名搜索 |
| `/jobs` | 全部任务，可取消，可展开逐章事件；成功事件带该章 token 数，卡片汇总本任务用量 |
| `/usage` | 用量与成本：全库 token 汇总 KPI，按版本、归属器、模型分组的明细表 |

配色沿用 `packages/report/src/palette.ts` 的角色变量，浅色深色跟随系统。对白卡片的颜色只做辅助，说话人名字和"未知"文字始终直接显示。

## 6. 运行

```bash
pnpm dev          # scripts/dev.mjs 从仓库根目录同时拉起 API 3100 与 Vite 5173，Vite 把 /api 代理到 API
pnpm api          # 只启动 API
pnpm web:build    # 构建到 packages/web/dist
NOVELSTRUCT_WEB_DIST=packages/web/dist pnpm api   # 单进程同时托管前端
```

API 和 CLI 一样从当前工作目录读 `.env` 和 `./data`，所以要在仓库根目录启动；不要用 `pnpm --filter @novelstruct/api dev`，那会把工作目录切到包目录，读不到根目录配置，还会建出第二个数据库。

环境变量见 `.env.example`：`PORT`、`HOST`、`CORS_ORIGINS`、`NOVELSTRUCT_WEB_DIST`，数据库、模型与单价配置和 CLI 相同。

## 7. 边界与后续

- M3 已支持通过 `API_TOKEN` 启用 Bearer 鉴权，未配置时仅监听本机；详见 `10-knowledge.md`。
- 上传直接读进内存后规范化；64 MB 上限对单本 TXT 足够，批量导入等后续的 Import 任务。
- 内存队列不持久化；BullMQ 见 `09-queue.md`。每个任务持有所在书的锁，多个 worker 可以并行处理不同的书。
- 报告仍然是一次性生成的静态 HTML，在新标签页打开，没有嵌进应用。
- 章节视图支持 URL 的 `?offset=` 定位并高亮原文，检索结果可跳转；分段的 `title` 仍显示偏移。结构遍默认跳过 `note` 和 `front_matter`，表单可选“包括作者留言与前言”。

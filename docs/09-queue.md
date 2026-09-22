# 任务队列

版本 0.1 ｜ 对应 `packages/queue`、`packages/api`

## 1. 定位

解析一本书要跑几百到上千章，LLM 归属器每章一到三分钟，一个任务动辄跑一整天。M0 的进程内 `JobManager` 把任务放在 API 进程的内存里：API 一重启排队的任务就没了，正在跑的也不知道跑到哪。M2 把任务搬进 Redis，逐章进度随任务一起存，API 重启、worker 崩溃、手动停机之后任务从上一章之后继续；worker 也可以和 API 分开部署。

事实层不变：每章的 `parse_runs` 记录和解析结果仍然只在 PostgreSQL 里，由 `commitChapterIR` 写入。队列只保存"要跑什么"和"跑到哪了"，Redis 全丢也只是丢任务列表，重新发起即可，已完成的章节因为有成功记录会被跳过。

## 2. 分包

```
api ──> queue ──> pipeline ──> db / parser
        ▲
worker ─┘（pnpm worker，同一个包里的 worker-main.ts）
web ──> api/contracts ──> queue/contracts（纯类型）
```

| 模块 | 职责 |
|---|---|
| `queue/contracts.ts` | `JobDto` 等线上类型。API 的 `contracts.ts` 原样转出，前端不用改 |
| `queue/types.ts` | `JobQueue` 接口：`enqueue` / `list` / `get` / `cancel` / `isBusy` / `close`，全部异步 |
| `queue/memory-queue.ts` | 进程内 FIFO，无 Redis 时使用，行为与原 `JobManager` 相同 |
| `queue/bull/*` | BullMQ 实现：队列、worker、任务数据 schema、Redis 连接 |
| `queue/worker-main.ts` | 独立 worker 进程入口 |
| `queue/create-queue.ts` | 按环境变量选实现 |

两种实现都在入队前 `planEditionParse`，版本不存在、范围为空、选了 llm 但没配 key 这些错误直接在 HTTP 响应里返回，不产生注定失败的任务。

## 3. 配置

| 变量 | 说明 |
|---|---|
| `REDIS_URL` | 留空用内存队列；设置后用 BullMQ。API 启动时先 PING，连不上直接报错退出 |
| `QUEUE_PREFIX` | Redis 键前缀，默认 `novelstruct`，多套部署共用一个 Redis 时区分 |
| `QUEUE_INLINE_WORKER` | 默认 `true`，API 进程内自带一个 worker；跑独立 worker 时设 `false` |
| `QUEUE_CONCURRENCY` | 一个 worker 进程同时处理的任务数，默认 1。每个任务持有所在书的锁，放开并发不会让同一本书被两个任务同时解析 |

三种拓扑：

```bash
pnpm api                                   # 无 Redis，内存队列，零安装
REDIS_URL=redis://localhost:6379 pnpm api  # Redis 存任务，API 进程内 worker 执行
QUEUE_INLINE_WORKER=false pnpm api         # API 只收任务
QUEUE_CONCURRENCY=4 pnpm worker            # 另开进程执行，同时跑 4 本书；worker 和 API 读同一个 .env
```

`GET /api/config` 的 `queue` 字段告诉前端当前是哪种实现。

**同一本书同一时刻只有一个执行在解析。** 实体消解在解析每章之前读这本书的已知实体，两个执行同时解析同一本书的两章会各自新建重复实体，所以每次 `executeParsePlan` 先抢 `book_locks` 里这本书的锁（见 `04-parsing-pipeline.md` 第 2 节）。抢不到的任务不失败：worker 把它 `moveToDelayed` 30 秒后重试，已跑的章节事件保留。多个 worker 进程、或一个进程里的多个并发任务，只要在不同的书上就真正并行。同一章也有一层保护：每章开始前看 `parse_runs` 里有没有别的活进程持有它，有就跳过。

**PGlite 文件库同一时刻只能被一个进程打开。** 独立 worker 只配合 PostgreSQL 使用；PGlite 时用进程内 worker，并发仍可大于 1。

## 4. 任务数据

BullMQ 一个 job 对应一次 `POST /api/editions/:id/parse`。

| 字段 | 存在哪 | 内容 |
|---|---|---|
| `data` | 入队时写，`cancel` 时改 | `editionId`、`options`、`total`（计划章节数）、`cancelRequestedAt` |
| `progress` | 每章结束后写 | `{ events }`，逐章事件数组，和 `JobDto.events` 同结构 |
| `returnvalue` | 完成时写 | 成功 / 失败 / 跳过计数、`stopped`、`cancelled` |

`toJobDto` 把 job 加上它在 BullMQ 里的状态投影成 `JobDto`：`active` 是运行中，`completed` 按返回值判定成功 / 失败 / 已取消，BullMQ 的 `failed`（worker 抛异常）是失败，其余状态是排队中，除非 `cancelRequestedAt` 已设置，那就是已取消。

`attempts` 固定为 1：每章已经有 `parse_runs` 记录失败原因，任务级别自动重试只会把同一个错误再跑一遍。要重跑就再发一次请求，成功过的章会被跳过；同一章用同一归属器失败满 `maxAttempts` 次（默认 3）后也会被跳过，直到带 `force`。章级的重试、接管和幂等见 `04-parsing-pipeline.md` 第 2 节。

## 5. 取消与恢复

取消是 job data 上的一个时间戳，不是从队列里删除。worker 在每章开始前重新从 Redis 读一次 data，看到时间戳就停在这一章之前，返回值里 `cancelled: true`。等待中的任务被取消后，worker 拿到它时会立即完成而不解析任何章节。这样"取消"在任意拓扑下语义一致：API 和 worker 不共享内存，也不需要 Redis pub/sub。

worker 收到 SIGINT / SIGTERM 后：`shouldStop` 返回 true，当前章跑完，把 job `moveToDelayed(now)` 放回队列，再断开。下一个 worker 拿到它时从 `progress.events` 里最后一个事件的下一章继续，`from` 相应后移，已跑过的事件保留。worker 崩溃没来得及放回时，BullMQ 的锁到期（60 秒）后 job 会被判为 stalled 并重新排队，同样从进度继续。

`pipeline` 的 `ParseEditionHooks` 为此改成可异步：`onEvent` 会被 await，保证进度先落 Redis 再开始下一章；`shouldStop` 也可返回 Promise。

## 6. 测试

`packages/queue/test`：

- `memory-queue.test.ts`：内存实现的入队校验、完成、取消排队中与运行中、清理。
- `bull-queue.test.ts`：需要 Redis，`REDIS_TEST_URL` 或本机 6379 连不上时整组跳过。覆盖持久化与内联 worker、无 worker 时取消、运行中取消、worker 关闭后由第二个 worker 续跑。每次用随机前缀，结束时删掉自己的键。
- `env-status.test.ts`：环境变量与状态判定的纯函数。

本机跑 Redis：`docker run -d --name novelstruct-redis -p 6379:6379 redis:7-alpine`。

## 7. 边界与后续

- 目前只有 Parse 一类任务。批量导入走 CLI（第 8 节），Import 与 Normalize 任务等真有网页批量上传的需求再做。
- token 用量按 `parse_runs` 汇总，见 `04-parsing-pipeline.md` 第 4 节；任务事件里每个成功章节带自己的 token 数，任务卡片汇总显示。
- 任务列表最多保留最近 50 个完成或失败的任务（`removeOnComplete` / `removeOnFail`），与内存队列一致。

## 8. 批量导入与压测

```bash
pnpm cli import novels/                    # 目录下所有 .txt 和 .epub，书名作者从文件名取：书名(作者).txt
pnpm cli import a.txt b.epub novels/       # 文件和目录可以混给；一个失败不影响其余，最后汇总
pnpm cli bench --books 100 --chapters 200 --parse 10 --parallel 4
```

`bench` 生成合成小说（每章有旁白和带标签的对白，角色名随书变化）导入，再用启发式归属器并行解析每本的前几章，打印每个阶段的耗时；再跑一次会走重复导入路径。它是压测工具，不是评测：数字只反映导入、写库、查询和锁的开销，不反映归属质量。

2026-09-22 在本机 PGlite 上的一次结果（Windows，Node 22）：待填。

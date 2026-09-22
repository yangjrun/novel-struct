# 路线图与任务清单

## 决策记录

| 日期 | 决策 | 理由 |
|---|---|---|
| 2026-09-20 | 领域核心全用 TypeScript | IR schema 与校验只写一遍；用户前端背景 |
| 2026-09-20 | 记忆层先做 MemoryStore 接口，PostgreSQL 实现，MemPalace 暂缓 | 派生数据不该成为核心依赖 |
| 2026-09-20 | 证据引用以自有文本偏移为主键 | 第三方索引重建不能断证据链 |
| 2026-09-20 | 起步做单本书垂直切片 | 风险全在解析质量 |
| 2026-09-20 | 本地开发默认 PGlite，生产 PostgreSQL | 零安装即可跑测试和 CLI |
| 2026-09-20 | API 用 Hono 而不是 NestJS；解析任务先用进程内队列 | 接口只有十来个，Hono 零装饰器零反射，测试直接调 `app.request`；BullMQ 等 M2 有真实并发需求再上 |
| 2026-09-20 | 作者留言单独成 `note` 类章节，而不是并入前一章或丢弃 | 并入会污染前一章的对白与实体统计；丢弃会破坏“规范化文本可回溯到原文”的证据链。解析时可按 kind 跳过 |
| 2026-09-20 | 金标按章节编号定位，不按 index | 标题识别规则一变 index 就漂，编号是作者给的，稳定 |
| 2026-09-20 | 重复导入的判定是同书名（同作者）同标签，不是同文件哈希 | 用户改了一处错字再导入，文件哈希必然不同，但意图明显是更新同一版本 |
| 2026-09-21 | EPUB 用 fflate 加 htmlparser2 自己读，不引入 epub 解析库 | 现成库要么面向浏览器渲染，要么多年未维护；我们需要的只是 spine 顺序、目录条目到块级元素的映射，三百行代码比适配一个库的抽象更可控。目录条目复用 TXT 的标题规则，两种格式的切章行为一致 |
| 2026-09-21 | 队列实现按 `REDIS_URL` 二选一，内存队列保留而不是删掉 | 本地开发默认 PGlite 零安装，队列也应如此；两种实现共用 `JobQueue` 接口和 `JobDto`，API 与前端不感知 |
| 2026-09-21 | 取消用 job data 上的标记，worker 逐章轮询，不用 pub/sub 或删 job | API 与 worker 可能不在一个进程，标记落在 Redis 里语义在任意拓扑下一致；删 job 会丢掉已跑章节的事件 |
| 2026-09-21 | 任务不自动重试（`attempts: 1`） | 每章已有 `parse_runs` 记录失败原因，再发一次请求即是重试，成功过的章会跳过 |
| 2026-09-22 | 解析记录的存活用心跳判断，不用进程锁或 Redis 锁 | 锁要有持有者才能释放，进程被 kill 就永远锁住；心跳停了谁都能接管，接管的安全性由 `commitChapterIR` 的替换语义保证 |
| 2026-09-22 | 失败次数上限按章计，`interrupted` 不计入，`force` 绕过 | 上限是为了省 token，中断不是章节的错；显式 force 是唯一的越过方式，避免"再试一次"悄悄变成无限重试 |
| 2026-09-22 | 新增 `interrupted` 状态而不是复用 `failed` | 界面要区分"模型或原文有问题"和"进程死了"，次数上限也只对前者计数 |
| 2026-09-22 | 成本只配一组单价，按当前价估算，不按运行时价格记账 | 接口是 OpenAI 兼容的任意服务，价格随时变、按模型不同，逐次记账要维护价格表；现在要回答的只是"这本书跑一遍大概多少钱"，估算够用，token 数本身是精确的 |
| 2026-09-22 | 书锁放在 PostgreSQL 的 `book_locks` 表，不用 Redis 锁 | 事实层在哪锁就在哪：CLI、内存队列、BullMQ worker 三条路径都经过同一张表，没有 Redis 的部署也受保护；心跳过期接管和 `parse_runs` 用同一套规则 |
| 2026-09-22 | 批量导入走 CLI 目录扫描，不做 Import 队列任务 | 小说文件本来就在磁盘上，导入是秒级的 CPU 加写库；队列解决的是小时级 LLM 任务的持久化与分发。上传落盘再入队等真有网页批量上传的需求再做 |

## M0 骨架（本次）

- [x] 设计文档 01 到 05
- [x] pnpm workspace，五个包
- [x] `core`：ID、IR schema、Validator、偏移工具，含测试
- [x] `ingest`：编码识别、章节标题识别、中文数字、段落切分，含测试
- [x] `db`：drizzle schema、迁移、仓储、PGlite 与 PostgreSQL 双驱动，含测试
- [x] `parser`：引号抽取、启发式归属器、LLM 归属器、实体消解 v1、结构遍编排，含测试
- [x] `cli`：`import`、`parse`、`show`、`books`
- [x] `report`：结构遍结果 HTML 报告，`cli report`，见 `06-report.md`
- [x] `pipeline`：导入、解析、报告的编排层，CLI 与 API 共用
- [x] `api` 与 `web`：Hono 接口加 Vue 3 管理界面，导入、解析任务、章节阅读、实体、报告，见 `07-web.md`。原计划放在 M3 的只读界面提前，并加了写操作（导入、发起解析）

## M1 垂直切片

验收标准：一本真实小说导入后，前 20 章结构遍全部通过 Validator；用 LLM 归属器在 50 条手工标注对白上准确率不低于 85%。

- [x] 用一本真实小说跑 `import`，修正标题识别的漏判与误判。《这游戏也太真实了》1180 个标题行：正文中重复出现的换页标题（`第554章血的味道` 在同章出现 7 次）按正文保留并给警告；缩进正文文件里不缩进的作者留言（请假、上架感言、盟主感谢）切成 `note` 类章节，不再混进前一章正文；`书名：` `作者：` 之类元数据行永不当标题。规范化版本升到 0.2
- [x] 手工标注 50 条对白作为金标（`eval/zhe-you-xi-ye-tai-zhen-shi-le.gold.jsonl`，第 1 到 3 章），写 `eval` 命令，见 `08-eval.md`
- [x] 跑启发式归属器得到基线。为此启发式加了两条规则：冒号前的裸标签（`楚光：“……”`，群聊体）和上一段结尾的说话标签（`小柒回答道。` 下一段才是对白），版本 heuristic/0.2。基线：50 条里正确 21、错误 0、未归属 29，准确率 42%，详见 `08-eval.md`。前 21 章结构遍全部通过 Validator
- [x] 接入一个 OpenAI 兼容模型跑 LLM 归属器，比较基线。2026-09-21 第一次真实调用（mimo-v2.5-pro）在 120 秒固定超时上失败，每章实际要 107 到 170 秒；客户端改为流式接收加"静默超时 + 总时长上限"两级超时（`LLM_IDLE_TIMEOUT_MS`、`LLM_TIMEOUT_MS`）后重跑，50 条全对，准确率 100%，验收线 85% 达成。数字与保留意见见 `08-eval.md`
- [x] 重复导入同一文件时按 `content_hash` 复用章节 ID。同书名同标签再次导入走 `reimportNormalizedBook`：先按内容哈希配对，再按章节编号（无编号按标题）配对；配上的保留 ID，内容没变的连解析结果一起保留，变了的清掉解析结果等重跑；新增删除各自处理。CLI 和 API 都返回 kept / updated / added / removed
- [x] `show` 命令按角色着色输出：终端里每个说话人一种颜色，同名同色，未知说话人灰色，心声紫色；非 TTY、`NO_COLOR` 或 `--no-color` 时纯文本

- [x] EPUB 导入（2026-09-21）。ZIP 容器即 EPUB，与扩展名无关；读 container.xml 到 OPF，按 spine 顺序把 XHTML 切成块级元素行，EPUB 3 nav 或 EPUB 2 NCX 的目录条目标记章节与卷的起点，再走共用的 `splitChapters`。书名作者取自元数据，`--title` 可省略；只有图片的页面跳过并警告；无目录时退回 h1 到 h3 加标题规则。规范化版本升到 0.3（同时改为丢弃没有正文的章节）。《这游戏也太真实了》的 EPUB 切出 1124 章，比 TXT 多 1 章，差在 EPUB 目录里多一条条目

M1 遗留：金标只有前三章 50 条，M2 扩到 20 章、覆盖更多角色后再评一次；LLM 的场景切分两章里有两章不首尾相接，提示词要调。

## M2 任务队列

- [x] `@novelstruct/queue`：BullMQ 解析任务（2026-09-21）。`JobQueue` 接口两种实现：无 `REDIS_URL` 时进程内 FIFO（原 `JobManager` 搬过来），有则 BullMQ。任务与逐章进度存 Redis，取消是 job data 上的标记、worker 逐章检查；worker 关闭把任务放回队列，下一个 worker 从最后一个事件的下一章续跑。`pnpm worker` 可独立于 API 运行。接口与 `JobDto` 不变，前端未改。Import 与 Normalize 任务推迟到批量导入时一起做。见 `09-queue.md`
- [x] `parse_runs` 可恢复、可重试、幂等（2026-09-22）。记录加 `attempt`、`worker_id`、`heartbeat_at` 和 `interrupted` 状态（迁移 0003）。每章开始前看运行记录：别的活进程持有就跳过，心跳停了就标中断并接管，同键失败达上限（默认 3，`--max-attempts` / `maxAttempts`）就跳过直到 `force`。API 与 worker 启动时清扫遗留的 running 记录。见 `04-parsing-pipeline.md` 第 2 节
- [x] token 用量与成本统计（2026-09-22）。`summarizeUsage` 按版本、归属器、模型汇总 `parse_runs` 的 token；`LLM_PRICE_INPUT / LLM_PRICE_OUTPUT / LLM_PRICE_CURRENCY` 配单价后估算成本。出口：`pnpm cli usage`、`GET /api/usage`、`GET /api/editions/:id/usage`、界面"用量"页和版本页的 KPI；任务事件和 CLI 逐章输出带 token 数。见 `04-parsing-pipeline.md` 第 4 节
- [x] 100 本书批量导入压测（2026-09-22）。前置的按书锁做成 `book_locks` 表：原子 upsert 抢锁、心跳续期、过期接管，`executeParsePlan` 持锁执行，抢不到锁的任务在队列里延后重试，worker 并发 `QUEUE_CONCURRENCY` 可以放开。批量导入走 CLI：`pnpm cli import <目录或多个文件>`，书名作者从文件名取。`pnpm cli bench` 生成合成小说做压测，数字见 `09-queue.md` 第 8 节
- [x] 删除小说（2026-09-22）。`deleteBook` 事务内按依赖顺序删光一本书，`deleteBookSafely` 先抢书锁，正在解析报 `conflict`。出口：`pnpm cli delete <bookId> [--yes]`、`DELETE /api/books/:id`（有未结束任务返回 409）、小说库页的删除按钮

## M3 检索层与只读界面

- [ ] `@novelstruct/knowledge`：pgvector 场景向量，按书过滤
- [ ] WeKnora 适配器：一版本一 KB，`weknora_chunk_id` 回填到 `source_refs`
- [ ] Web 界面：跨书检索页；章节视图点击分段跳原文偏移
- [ ] API 鉴权，暴露到内网之外前必须完成

## M4 一致性遍

- [ ] Context Builder，带预算和确定性测试
- [ ] 关系、状态、事件、伏笔表与 supersede
- [ ] 实体消解 v2：区间别名、合并拆分、审计、复核队列
- [ ] 故事时间字段与时间线视图

## M5 记忆层与输出

- [ ] MemoryStore PostgreSQL 实现与 `rebuild`
- [ ] MemPalace 适配器（可选）
- [ ] `@novelstruct/output`：从 IR 生成 TTS 任务，角色声音配置

## 未决问题

- 引号之外的对白（无引号的口语叙述）如何标注，M4 前先只记录警告。
- 一致性遍的贵模型触发条件需要用真实数据校准。
- `note` 类章节默认是否参与解析。目前 `parse` 不区分 kind，全都解析；留言里的对白会产生无意义的说话人。倾向于默认跳过 `note` 与 `front_matter`，加 `--all-kinds` 开关。

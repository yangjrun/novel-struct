# M3 检索层

## pgvector 场景检索

`@novelstruct/knowledge` 使用场景的规范化原文生成 1536 维向量，存入 `scene_embeddings`；唯一键是场景 ID，模型和正文哈希一并存储。新增索引可重复运行，只计算尚未入库或正文/模型变化的场景。重解析章节、重新导入变动章节、删除书籍会同步清理本地派生向量。检索必须显式指定一本或多本书，按模型和书 ID 过滤；检索结果的 `charStart`/`charEnd` 是原章的 UTF-16 偏移，仍可直接跳回原文。

迁移 0005 启用 `vector` 扩展，PGlite 自动注册 pgvector；部署 PostgreSQL 需要服务器安装扩展（`docker-compose.yml` 已使用 pgvector/pgvector:pg16）。embedding 服务单独配置 `EMBEDDING_BASE_URL`、`EMBEDDING_API_KEY`、`EMBEDDING_MODEL`，须支持 OpenAI `/embeddings` 和 `dimensions: 1536`。没有配置时原有解析与阅读功能不受影响。

```
pnpm cli index <editionId>
pnpm cli search "桥上相遇" --book <bookId> --book <anotherBookId>
```

Web 版本页提供“索引场景”；“检索”页显式选择书的范围，返回相似度、摘要和章节入口。接口 `POST /api/search/editions/:id/index` 与 `POST /api/search`（`{query, bookIds, limit?}`）。

## 鉴权

设置 `API_TOKEN` 后，所有 `/api/*` 路由（包括 HTML 报告）要求 `Authorization: Bearer <token>`。浏览器在连接页输入令牌，保存在当前标签会话的 sessionStorage，请求自动附带；未配置时仅允许 API 监听本机（默认 `HOST=127.0.0.1`）。跨域请求仍须配置 `CORS_ORIGINS`。`/health` 不含业务数据，可用于探活。

## WeKnora 派生索引

2026-09-29 解析闭环更新：配置的 WeKnora 客户端已传入 LLM 结构遍与一致性遍。Parser 仅接收同版本、当前章之前、索引哈希一致且可唯一定位回自有原文的命中；调用方式、预算及失败行为见 [13 解析闭环](13-parser-memory-loop.md)。下面的真实同步记录仍仅代表此前完成的同步验证，不代表新解析上下文已完成真实模型验收。

设置 `WEKNORA_BASE_URL`（不含 `/api/v1`），并在 `WEKNORA_API_KEY`（通过 `X-API-Key` 发送）与 `WEKNORA_BEARER_TOKEN`（通过 `Authorization: Bearer` 发送）中**只选一种**。如服务没有默认 embedding 模型，另设 `WEKNORA_EMBEDDING_MODEL_ID` 为该模型在 `GET /api/v1/models` 中的 ID；创建 KB 时会传 `embedding_model_id`。然后运行：

```
pnpm cli sync-weknora <editionId>
pnpm cli remove-weknora <editionId>
```

先做有界试点时显式使用 `pnpm cli sync-weknora <editionId> --from 1 --to 3`：两个章节 index 必须成对提供、为连续闭区间且最多 10 章；该模式在创建 KB 前要求每个 index 都是非空正文 `chapter`，**绝不按局部章节集合删除远端其他文档**。每章输出 ID、创建/更新/跳过和回填数；Ctrl-C 在下一章开始前停止，已提交的远端文档和本地二级指针保留，可用同一范围续跑。不带范围仍按原有完整版本语义清理孤儿文档，不能用于小范围试点。WeKnora 异步解析后再次用同一范围重跑才可能回填 chunk；不会自动提交小说事实或修改自有原文偏移。

同步为每个版本创建一 KB，并按章节创建手工文档；外部知识会异步解析，可重复运行同步命令，在解析完成后回填 `source_refs.weknora_chunk_id`。回填仅在 chunk 内容能在规范化章节文本中**唯一定位**且完整包含证据区间时进行，无法确认的证据保持空值，原文偏移不变。更新文档时先清空旧 chunk 指针；被移除的章节在再次同步时清理其外部文档。`remove-weknora` 删除派生 KB 与二级指针，不删除事实层证据。2026-09-29 本机 Docker 中 `WeKnora-app` 映射到 `127.0.0.1:18080`，`GET /health` 返回 200；未带凭据的 `GET /api/v1/knowledge-bases` 和 `/swagger/index.html` 均返回 401。**这只证明服务可达和业务接口需要鉴权**，未验证实际 API 契约、异步解析、重复同步或回填。项目本地 `.env` 后来配置了地址及一把 `WEKNORA_API_KEY`，但 2026-09-29 的只读 `X-API-Key` 请求返回 401 `invalid API key`；将同值用于 Bearer 又返回 401 `invalid or expired token`。Postman 的成功请求使用 Bearer 凭据；本地配置的值带有 `Bearer ` 前缀，客户端此前又加一层前缀导致 401。现在配置会规范化单层前缀，限定 Bearer 仅向 HTTPS 或本机回环 HTTP 发送。2026-09-29 使用真实客户端对知识库列表做只读验证成功，返回 0 条 KB。经明确授权，用内存 PGlite 的一章合成文本执行了隔离实测：首次同步新建 KB 和章节文档各 1 个，立即重复同步没有重复创建或更新（0/0），证明这些写入路径在当前服务上可用。首轮轮询约 30 秒后仍无可用 chunk，本章 1 条证据没有回填。经再次授权对新的隔离合成 KB 复测，`GET /api/v1/knowledge/:id` 先返回 `pending`，约 10 秒后变为 **`failed`**，chunk 数保持 0；再次同步仍无回填。因此不是仅仅需要等更久。只读查阅本次 WeKnora-app 错误日志，解析任务显示 `Model ID is empty`、`get embedding model failed: model ID cannot be empty`；该实例当前新建 KB 未获得可用的 embedding 模型 ID，导致知识解析失败。只读模型列表表明有一个 `Embedding` 类型且状态 `active` 的模型，但 `is_default` 为 false；适配器先前创建 KB 时没有传 `embedding_model_id`。现已按[知识库 API 文档](https://weknora.weixin.qq.com/docs/04-api/02-api-knowledge)支持显式 `WEKNORA_EMBEDDING_MODEL_ID`。第三轮经授权选用唯一 active Embedding 模型，对新建的单章合成 KB 实测：首次创建 1 个文档，重复同步没有重复创建；解析状态由 `pending` 进入 `processing` 时已取得 1 个 chunk，再次同步将 1/1 条原文证据关联到 chunk。因此该实例的创建、异步解析和精确回填路径已在**隔离合成样本**通过，不能外推为真实小说全量验收。三轮测试只清理各自新建的 KB，最后只读核对测试 KB 为 0；另有 1 个非测试 KB，未触碰它或真实小说。配置模型 ID 后，适配器会对**复用的 KB** 检查其 `embedding_model_id` 是否一致，发现旧 KB 缺失或使用其他模型时先报错，不自动删除、覆盖或重新索引；需人工确认目标后显式移除旧的派生 KB 并重新同步。

### 真实小说三章试点（2026-09-29）

经单独确认，仅对《这游戏也太真实了》`v1`（`ed_1f4cd347-b68b-41d4-806e-fbaa00a1b8e4`）index 1–3 运行 `sync-weknora --from 1 --to 3`。预检三章均为非空正文章，目标版本原先无 WeKnora KB 和文档映射；服务另有 1 个非测试 KB。本次新建版本专属 KB `85e26e48-e464-4bcc-99e7-c04bcad52d9f` 和 3 个章节文档，首次运行创建/更新/回填为 3/0/0。三章异步解析最终均为 `completed`，分别生成 6、12、9 个 chunk；同范围重跑创建/更新/回填为 0/0/180，按章回填 34、70、76 条。事后只读核对该范围共 212 条自有证据，其中 180 条关联 chunk、32 条保留空指针；目标 KB 仍有 3 文档，另外 1 个非测试 KB 未触碰。空指针不代表原始证据丢失，须按严格唯一定位与区间覆盖规则核查其原因。**这只验证前三章，不等于 1123 章全量同步，也不授权扩大范围或删除现存 KB。** 一次性诊断脚本留在忽略目录 `eval/out/`；后续扩大章节范围须重新确认。

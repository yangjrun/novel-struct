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

设置 `WEKNORA_BASE_URL`（不含 `/api/v1`）和 `WEKNORA_API_KEY`（通过 `X-API-Key` 发送），运行：

```
pnpm cli sync-weknora <editionId>
pnpm cli remove-weknora <editionId>
```

同步为每个版本创建一 KB，并按章节创建手工文档；外部知识会异步解析，可重复运行同步命令，在解析完成后回填 `source_refs.weknora_chunk_id`。回填仅在 chunk 内容能在规范化章节文本中**唯一定位**且完整包含证据区间时进行，无法确认的证据保持空值，原文偏移不变。更新文档时先清空旧 chunk 指针；被移除的章节在再次同步时清理其外部文档。`remove-weknora` 删除派生 KB 与二级指针，不删除事实层证据。WeKnora 服务是否可用以及 API 兼容性须在实际部署中验证。

# 数据模型

版本 0.1 ｜ 对应 `packages/db/src/schema`

## 1. 约定

- 主键是带前缀的字符串 ID：`lib_`、`uni_`、`ser_`、`bk_`、`ed_`、`vol_`、`chp_`、`scn_`、`seg_`、`ent_`、`als_`、`men_`、`src_`、`run_`。前缀让日志和 IR 可读，值为随机 UUID。
- 章节 ID 在首次导入时分配。同书名同标签重复导入时走 `reimportNormalizedBook`：先按 `content_hash` 配对（章节挪了位置也能认出来），剩下的按 kind 加编号（无编号按标题）配对，两边都唯一才算；配上的复用旧 ID，内容未变的连解析结果一起保留。不按序号重算，避免作者插章导致全量 ID 漂移。
- 所有文本偏移都是规范化章节文本的 UTF-16 code unit 下标，即 JS 字符串下标。见 `03-novel-ir.md`。
- 时间戳带时区。

## 2. M0 表

### 层级

| 表 | 关键列 | 说明 |
|---|---|---|
| `libraries` | id, name | 小说库 |
| `universes` | id, library_id, name, description | 共享世界观，可选 |
| `series` | id, library_id, universe_id?, name | 系列，可选 |
| `books` | id, library_id, universe_id?, series_id?, series_index?, title, author | 一本书 |
| `book_editions` | id, book_id, label, source_format, source_filename, source_hash, normalizer_version, is_default | 一本书的一个版本；`source_format` 是 `txt` 或 `epub`，按文件内容判定 |
| `volumes` | id, edition_id, index, title | 卷，可选 |
| `chapters` | id, edition_id, volume_id?, index, kind, number?, heading_raw?, title?, text, char_count, content_hash | 规范化章节正文；唯一约束 (edition_id, index) |

`chapters.kind` 取值：`chapter`、`prologue`、`extra`、`front_matter`、`note`。`note` 是夹在章节之间的作者留言（请假、上架感言），保留是为了证据链完整，解析时可按 kind 跳过。

### 结构

| 表 | 关键列 | 说明 |
|---|---|---|
| `scenes` | id, chapter_id, edition_id, index, char_start, char_end, location?, time_hint?, summary?, parse_run_id? | 场景，连续切分整章 |
| `segments` | id, scene_id, chapter_id, index, kind, char_start, char_end, text, speaker_entity_id?, speaker_surface?, speaker_confidence?, emotion_type?, emotion_intensity?, parse_run_id? | 有序分段，全覆盖整章 |

`segments.kind` 取值：`narration`、`dialogue`、`thought`。对白分段包含引号本身，TTS 渲染时再去掉。

### 实体与证据

| 表 | 关键列 | 说明 |
|---|---|---|
| `entities` | id, book_id, type, canonical_name, description?, confidence, status, merged_into_id?, first_chapter_id? | 统一实体 |
| `entity_aliases` | id, entity_id, alias, valid_from_chapter_id?, valid_to_chapter_id?, source_ref_id? | 别名，按章节区间生效；唯一约束 (entity_id, alias) |
| `entity_mentions` | id, entity_id, chapter_id, scene_id?, source_ref_id (非空), surface, confidence, parse_run_id? | 实体在原文中的出现 |
| `source_refs` | id, edition_id, chapter_id, char_start, char_end, quote, weknora_chunk_id? | 证据；`quote` 是偏移区间对应的原文副本 |

`entities.type` 取值：`character`、`location`、`organization`、`item`、`skill`、`realm`、`species`、`concept`、`event`。
`entities.status` 取值：`active`、`merged`。合并时旧实体标记 `merged` 并写 `merged_into_id`，不删除。

### 解析

| 表 | 关键列 | 说明 |
|---|---|---|
| `parse_runs` | id, edition_id, chapter_id, pass, model?, prompt_version, attributor, status, input_tokens?, output_tokens?, error?, started_at, finished_at? | 一次解析任务 |

`pass` 取值：`structure`、`consistency`。`status` 取值：`pending`、`running`、`succeeded`、`failed`。

结构遍对同一章是替换语义：新运行成功提交时，删除该章旧的 scenes、segments、entity_mentions，再写入新结果。实体与别名不删除。

## 3. M4 起的表

| 表 | 关键列 | 说明 |
|---|---|---|
| `relationships` | subject_id, predicate, object_id, valid_from_chapter_id, valid_to_chapter_id?, story_time?, confidence, source_ref_id, parse_run_id, superseded_by? | 关系，带章节有效区间 |
| `state_facts` | entity_id, field, value, valid_from_chapter_id, valid_to_chapter_id?, story_time?, confidence, source_ref_id, parse_run_id, superseded_by? | 状态，supersede 不覆盖 |
| `state_changes` | entity_id, field, from_value?, to_value, chapter_id, scene_id?, source_ref_id | 状态变化事件 |
| `events` | chapter_id, scene_id, type, actor_id?, target_id?, summary, source_ref_id | 事件 |
| `foreshadows` | book_id, planted_chapter_id, resolved_chapter_id?, summary, source_ref_id | 伏笔 |
| `entity_merges` | from_entity_id, into_entity_id, reason, parse_run_id?, created_by | 合并审计 |
| `review_items` | kind, target_id, reason, confidence, status | 低置信度人工复核队列 |
| `universe_facts` | universe_id, kind, key, value, source_ref_id | 共享世界观设定 |
| `memory_items` | book_id, room, entity_id?, content, embedding, valid_from_chapter_id, valid_to_chapter_id?, source_fact_table, source_fact_id | MemoryStore 的 PostgreSQL 实现，可整体重建 |
| `voice_profiles` | book_id, entity_id, provider, voice_id, params | TTS 声音配置 |

时间轴字段：`valid_from_chapter_id` 与 `valid_to_chapter_id` 表示读者知道的顺序；`story_time` 是故事内时间，允许为空。两者不能合并成一个字段。

## 4. 索引

唯一约束之外，按解析流程的访问路径建二级索引：`entity_mentions(chapter_id)`、`entity_mentions(entity_id)`、`source_refs(chapter_id)`、`parse_runs(chapter_id, status)`、`entities(book_id, status)`、`segments(speaker_entity_id)`。每章的结构遍会按章清空旧结果、按书读取已知实体、按章查已成功的运行记录，这些索引让单章成本不随全书规模增长。

这些索引在 schema 里一直有定义，但 `0000_init` 迁移生成时漏掉了，实际建表时并没有创建；`0002_sharp_northstar` 迁移补上了它们。

## 5. 不变量

- 每个 `entity_mentions`、`relationships`、`state_facts`、`events`、`foreshadows` 行都有非空 `source_ref_id`。
- `source_refs.quote` 必须等于对应章节文本在 `[char_start, char_end)` 上的切片。写入时校验。
- 同一章的 `segments` 按 `index` 排序后必须连续且覆盖 `[0, char_count)`。写入前由 IR Validator 保证。
- 同一章的 `scenes` 同上。

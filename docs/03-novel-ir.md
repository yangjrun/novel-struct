# Novel IR 规范

版本 0.1 ｜ 对应 `packages/core/src/ir`

Novel IR 是解析器的唯一输出格式，也是 TTS、视频、查询的唯一输入格式。以章为单位，一章一个 `ChapterIR` 文档。

## 1. 偏移约定

- 所有 `charStart` 与 `charEnd` 都是规范化章节文本的 UTF-16 code unit 下标，左闭右开，等价于 JS 的 `text.slice(charStart, charEnd)`。
- 常用汉字占一个单位，扩展平面字符和 emoji 占两个。所有切片和比较必须使用同一份规范化文本。
- 规范化文本由 `@novelstruct/ingest` 产出并记录 `normalizerVersion`。规范化规则变化时版本号递增，旧 IR 的偏移对新文本无效，必须重新解析。

## 2. 文档结构

```json
{
  "irVersion": "0.1",
  "bookId": "bk_…",
  "editionId": "ed_…",
  "chapterId": "chp_…",
  "charCount": 4213,
  "scenes": [
    {
      "id": "scn_…",
      "index": 0,
      "charStart": 0,
      "charEnd": 2100,
      "location": "炎城",
      "timeHint": "夜",
      "summary": "……",
      "characterIds": ["ent_…"]
    }
  ],
  "segments": [
    { "id": "seg_…", "sceneId": "scn_…", "index": 0, "kind": "narration", "charStart": 0, "charEnd": 120 },
    {
      "id": "seg_…",
      "sceneId": "scn_…",
      "index": 1,
      "kind": "dialogue",
      "charStart": 120,
      "charEnd": 160,
      "speaker": { "entityId": "ent_…", "surface": "林动", "confidence": 0.92 },
      "emotion": { "type": "calm", "intensity": 0.3 }
    }
  ],
  "entities": [
    { "id": "ent_…", "type": "character", "canonicalName": "林动", "aliases": ["林少爷"], "isNew": false, "confidence": 0.95 }
  ],
  "mentions": [
    { "entityId": "ent_…", "surface": "林动", "charStart": 130, "charEnd": 132 }
  ],
  "provenance": {
    "pass": "structure",
    "attributor": "llm",
    "model": "…",
    "promptVersion": "structure-pass/0.1",
    "normalizerVersion": "0.1",
    "parseRunId": "run_…"
  }
}
```

## 3. 字段说明

### segments

- `kind`：`narration` 旁白，`dialogue` 对白，`thought` 内心独白。
- 对白分段的区间包含引号本身。TTS 渲染时去掉引号，但 IR 里保留以保证全覆盖。
- `speaker.entityId` 已消解到实体时填写；`speaker.surface` 是原文中的称呼，消解失败时只有 surface。两者至少一个非空。
- `speaker.confidence` 与 `emotion.intensity` 取值 `[0, 1]`。
- `emotion.type` 建议词表：`calm`、`happy`、`angry`、`sad`、`fear`、`surprise`、`teasing`、`contempt`、`anxious`、`tender`、`cold`、`excited`。词表开放，但 TTS 映射表只认这些。

### scenes

- 场景连续切分整章，边界落在段落起点。
- `characterIds` 是该场景内有对白或提及的角色实体。

### entities

- `isNew` 表示这次解析新建的实体。已存在实体只出现在本章有提及时。
- `aliases` 是本章观察到的别名，写库时并入 `entity_aliases`。

### mentions

- 每条提及就是一条证据：`text.slice(charStart, charEnd) === surface` 必须成立。
- 写库时每条提及生成一条 `source_refs`。

## 4. 不变量与校验码

Validator 是纯函数，输入 `ChapterIR` 与章节文本，输出错误列表。任何错误都阻止写库。

| 校验码 | 规则 |
|---|---|
| `IR-SEG-COVER` | segments 按 index 排序后连续，首段从 0 开始，末段到 charCount 结束，每段 charStart 小于 charEnd |
| `IR-SCENE-PARTITION` | scenes 同上 |
| `IR-SEG-SCENE` | 每个分段的区间落在其 sceneId 对应的场景区间内 |
| `IR-DIALOGUE-SPEAKER` | dialogue 与 thought 分段必须有 speaker，且 entityId 或 surface 至少一个非空 |
| `IR-MENTION-EVIDENCE` | 提及区间在文本范围内，且切片等于 surface |
| `IR-REF` | 所有 sceneId、entityId 引用都能在本文档内找到 |
| `IR-UNIQUE` | 场景与分段 ID 唯一，index 从 0 连续 |
| `IR-RANGE` | 所有 confidence、intensity 在 `[0, 1]` |

## 5. 版本

- `irVersion` 变化意味着字段语义变化，消费方必须适配。
- `provenance.promptVersion` 与 `provenance.model` 变化不改变 IR 结构，但会触发增量重解析策略，见 `04-parsing-pipeline.md`。

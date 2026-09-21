import { EMOTION_TYPES, ENTITY_TYPES } from '@novelstruct/core';

export const STRUCTURE_PROMPT_VERSION = 'structure-pass/0.1';

export const STRUCTURE_SYSTEM_PROMPT = `你是小说结构化解析器。输入是一章小说的段落列表（带编号）、已经抽取好的对白列表（带编号）和本书已知的实体列表。
你只做三件事，并且只输出一个 JSON 对象，不输出任何解释：

1. 给每条对白判定说话人、类型和情绪。
2. 列出本章出现的实体。
3. 把段落划分为场景。

输出格式：
{
  "quotes": [
    { "id": "q0", "speaker": "说话人姓名或称呼", "kind": "dialogue 或 thought", "confidence": 0 到 1, "emotion": "情绪词", "intensity": 0 到 1 }
  ],
  "entities": [
    { "name": "规范名", "type": "实体类型", "aliases": ["本章出现的别名"], "confidence": 0 到 1, "description": "一句话描述" }
  ],
  "scenes": [
    { "startParagraph": 0, "endParagraph": 5, "location": "地点", "timeHint": "时间", "summary": "一句话概括" }
  ]
}

规则：
- quotes 必须覆盖输入里的每一条对白，id 原样返回。说话人优先使用已知实体的规范名；无法判断时 speaker 填 null 并把 confidence 设为 0。
- kind：说出口的话是 dialogue，心里想的是 thought。
- emotion 只能从这些词里选：${EMOTION_TYPES.join('、')}。判断不了就省略 emotion 和 intensity。
- type 只能从这些词里选：${ENTITY_TYPES.join('、')}。
- 已知实体如果本章出现，也要列在 entities 里，name 用它的规范名，aliases 只放本章新出现的称呼。
- scenes 必须从第 0 段开始、到最后一段结束、前后相接、不重叠。地点或时间明显变化时才切分。`;

export interface StructurePromptInput {
  readonly paragraphs: readonly string[];
  readonly quotes: readonly { readonly id: string; readonly paragraphIndex: number; readonly text: string }[];
  readonly knownEntities: readonly {
    readonly type: string;
    readonly canonicalName: string;
    readonly aliases: readonly string[];
  }[];
}

export function buildStructureUserPrompt(input: StructurePromptInput): string {
  const paragraphs = input.paragraphs.map((p, i) => `[${i}] ${p}`).join('\n');
  const quotes = input.quotes.map((q) => `${q.id} (段落 ${q.paragraphIndex}): ${q.text}`).join('\n');
  const known =
    input.knownEntities.length === 0
      ? '（无）'
      : input.knownEntities
          .map(
            (e) => `- ${e.canonicalName}（${e.type}）${e.aliases.length > 0 ? `，别名：${e.aliases.join('、')}` : ''}`,
          )
          .join('\n');
  return `## 已知实体\n${known}\n\n## 段落\n${paragraphs}\n\n## 对白\n${quotes.length > 0 ? quotes : '（无）'}`;
}

import type { CommitFactsInput } from './commit-facts.js';

type FactBatch = Pick<CommitFactsInput, 'states' | 'relationships' | 'events'> &
  Partial<Pick<CommitFactsInput, 'foreshadows'>>;

/** Deterministic checks only; these cannot establish semantic truth or synonym equivalence. */
export function validateFactBatch(input: FactBatch): void {
  const unique = (keys: string[], message: string) => {
    if (new Set(keys).size !== keys.length) throw new Error(message);
  };
  const validConfidence = (confidence: number) => Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
  for (const fact of input.states) {
    if (!fact.field.trim() || fact.field !== fact.field.trim()) throw new Error('状态字段不能为空或带有首尾空白');
    if (!fact.value.trim() || !validConfidence(fact.confidence)) throw new Error('状态字段、值与置信度无效');
  }
  for (const fact of input.relationships) {
    if (!fact.predicate.trim() || fact.predicate !== fact.predicate.trim())
      throw new Error('关系谓词不能为空或带有首尾空白');
    if (!validConfidence(fact.confidence)) throw new Error('关系谓词与置信度无效');
  }
  for (const fact of input.events) {
    if (!fact.type.trim() || !fact.summary.trim()) throw new Error('事件类型和摘要不能为空');
  }
  for (const fact of input.foreshadows ?? []) {
    if (!fact.summary.trim()) throw new Error('伏笔摘要不能为空');
  }
  for (const fact of [...input.states, ...input.relationships, ...input.events]) {
    if (fact.storyTime !== undefined && !fact.storyTime.trim()) throw new Error('故事时间不能为空');
  }
  unique(
    input.states.map((fact) => JSON.stringify([fact.entityId, fact.field])),
    '同一批事实不能重复定义同一实体字段',
  );
  unique(
    input.relationships.map((fact) => JSON.stringify([fact.subjectId, fact.predicate])),
    '同一批事实不能重复定义同一关系谓词',
  );
  unique(
    input.events.map((fact) =>
      JSON.stringify([
        fact.type.trim(),
        fact.summary.trim(),
        fact.actorId ?? null,
        fact.targetId ?? null,
        fact.storyTime?.trim() ?? null,
        fact.evidence.charStart,
        fact.evidence.charEnd,
      ]),
    ),
    '同一批事实不能重复提交相同事件与证据',
  );
}

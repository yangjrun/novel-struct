import { z } from 'zod';
import { type Db, validateFactBatch } from '@novelstruct/db';
import { hashRevisionAudit, prepareConsistencyPreview, SavedConsistencyPreviewSchema } from './review-consistency.js';
import { PipelineError } from './errors.js';

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const RevisionSchema = z
  .object({
    sourceHash: Hash,
    previewHash: Hash,
    editor: z.string().trim().min(1),
    revisions: z
      .array(
        z
          .object({
            key: z.string().regex(/^(states|relationships|events|foreshadows):\d+$/),
            candidateHash: Hash,
            reason: z.string().trim().min(1),
            replacement: z.unknown(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

/** Explicit candidate edits, bound to a reviewed source; never approves or changes stored facts. */
export async function reviseConsistencyPreview(db: Db, value: unknown, revisionValue: unknown) {
  const revision = RevisionSchema.safeParse(revisionValue);
  if (!revision.success) throw new PipelineError('invalid_input', `修订文件格式无效：${revision.error.message}`);
  const original = await prepareConsistencyPreview(db, value);
  const { sourceHash, previewHash, editor, revisions } = revision.data;
  if (sourceHash !== original.sourceHash || previewHash !== original.previewHash)
    throw new PipelineError('invalid_input', '原文或预览已变化，请基于当前复核报告重新修订');
  if (new Set(revisions.map((item) => item.key)).size !== revisions.length)
    throw new PipelineError('invalid_input', '同一候选不能重复修订');
  const candidates = new Map(original.candidates.map((item) => [item.key, item]));
  const changes: { key: string; candidateHash: string; reason: string; before: unknown; after: unknown }[] = [];
  type Group = 'states' | 'relationships' | 'events' | 'foreshadows';
  const edits = new Map<string, unknown>();
  for (const item of revisions) {
    const candidate = candidates.get(item.key);
    if (!candidate || candidate.candidateHash !== item.candidateHash)
      throw new PipelineError('invalid_input', `候选不存在或已变化：${item.key}`);
    const [group, rawIndex] = item.key.split(':') as [Group, string];
    const before = original.preview.facts[group][Number(rawIndex)];
    const schema = SavedConsistencyPreviewSchema.shape.facts.shape[group].element;
    const parsed = item.replacement === null ? null : schema.safeParse(item.replacement);
    if (parsed !== null && !parsed.success)
      throw new PipelineError('invalid_input', `修订后的候选格式无效：${item.key}`);
    const after = parsed === null ? null : parsed.data;
    if (JSON.stringify(before) === JSON.stringify(after))
      throw new PipelineError('invalid_input', `修订未改变候选：${item.key}`);
    edits.set(item.key, after);
    changes.push({ key: item.key, candidateHash: item.candidateHash, reason: item.reason, before, after });
  }
  // All indexes refer to the original preview, even when earlier entries are removed.
  const { revision: _previousRevision, revisionHistory: _previousHistory, ...base } = original.preview;
  const revised = {
    ...base,
    facts: {
      ...original.preview.facts,
      ...Object.fromEntries(
        (['states', 'relationships', 'events', 'foreshadows'] as const).map((group) => [
          group,
          original.preview.facts[group].flatMap((fact, index) => {
            const key = `${group}:${index}`;
            if (!edits.has(key)) return [fact];
            const after = edits.get(key);
            return after === null ? [] : [after];
          }),
        ]),
      ),
    },
  };
  const result = await prepareConsistencyPreview(db, revised);
  try {
    validateFactBatch(result.preview.facts);
  } catch (error) {
    throw new PipelineError(
      'invalid_input',
      `修订后的事实无效：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const previous = original.preview.revision;
  const auditBody = {
    version: 'consistency-revision/0.2' as const,
    sourceHash,
    genesisPreviewHash: previous?.genesisPreviewHash ?? previewHash,
    parentPreviewHash: previewHash,
    parentAuditHash: previous?.auditHash ?? null,
    previewHash: result.previewHash,
    editor,
    changes,
    humanReview: 'pending' as const,
  };
  const audit = { ...auditBody, auditHash: hashRevisionAudit(auditBody) };
  return {
    ...structuredClone(result.preview),
    revision: audit,
    revisionHistory: [
      ...(original.preview.revisionHistory ?? (original.preview.revision ? [original.preview.revision] : [])).map(
        (item) => structuredClone(item),
      ),
      structuredClone(audit),
    ],
  };
}

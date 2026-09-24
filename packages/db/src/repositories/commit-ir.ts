import { and, eq, inArray } from 'drizzle-orm';
import { type ChapterIR, newId, spanAt, validateChapterIR, type ValidationError } from '@novelstruct/core';
import type { Db } from '../client.js';
import {
  bookEditions,
  chapters,
  entities,
  entityAliases,
  entityMentions,
  sceneEmbeddings,
  scenes,
  segments,
  sourceRefs,
  shadowReviews,
} from '../schema/index.js';
import { getChapterById } from './chapters.js';
import { clearEditionConsistency } from './clear-consistency.js';

export interface CommitSummary {
  readonly scenes: number;
  readonly segments: number;
  readonly newEntities: number;
  readonly mentions: number;
}

export class IRValidationError extends Error {
  constructor(readonly errors: readonly ValidationError[]) {
    super(`ChapterIR rejected: ${errors.map((e) => `${e.code} ${e.path ?? ''} ${e.message}`).join('; ')}`);
    this.name = 'IRValidationError';
  }
}

/**
 * Writes a structure-pass ChapterIR to the fact layer. Re-validates against the stored chapter
 * text, then replaces the chapter's scenes, segments and mentions in one transaction. Entities
 * and aliases are only ever added here, never removed.
 */
export async function commitChapterIR(db: Db, ir: ChapterIR): Promise<CommitSummary> {
  return db.transaction(async (tx) => {
    const chapter = await getChapterById(tx, ir.chapterId);
    if (chapter === undefined) throw new Error(`chapter ${ir.chapterId} not found`);
    const edition = (
      await tx
        .select({ bookId: bookEditions.bookId })
        .from(bookEditions)
        .where(eq(bookEditions.id, ir.editionId))
        .limit(1)
    )[0];
    if (chapter.editionId !== ir.editionId || edition?.bookId !== ir.bookId)
      throw new Error('IR 的书、版本、章节不匹配');
    const validation = validateChapterIR(ir, chapter.text);
    if (!validation.ok) throw new IRValidationError(validation.errors);

    // The consistency pass depends on the edition's structure and evidence. Invalidate it
    // before replacing any scene/ref (including references from other chapters).
    await clearEditionConsistency(tx, ir.editionId);

    await tx
      .delete(shadowReviews)
      .where(and(eq(shadowReviews.chapterId, ir.chapterId), eq(shadowReviews.pass, 'structure')));

    await clearChapterStructure(tx, ir.chapterId);
    const newEntities = await insertEntities(tx, ir);
    await insertScenes(tx, ir);
    await insertSegments(tx, ir, chapter.text);
    const mentions = await insertMentions(tx, ir, chapter.text);

    return { scenes: ir.scenes.length, segments: ir.segments.length, newEntities, mentions };
  });
}

async function clearChapterStructure(tx: Db, chapterId: string): Promise<void> {
  const sceneIds = tx.select({ id: scenes.id }).from(scenes).where(eq(scenes.chapterId, chapterId));
  await tx.delete(sceneEmbeddings).where(inArray(sceneEmbeddings.sceneId, sceneIds));
  await tx.delete(entityMentions).where(eq(entityMentions.chapterId, chapterId));
  await tx.delete(segments).where(eq(segments.chapterId, chapterId));
  await tx.delete(scenes).where(eq(scenes.chapterId, chapterId));
  const refs = tx.select({ id: sourceRefs.id }).from(sourceRefs).where(eq(sourceRefs.chapterId, chapterId));
  await tx.update(entityAliases).set({ sourceRefId: null }).where(inArray(entityAliases.sourceRefId, refs));
  await tx.delete(sourceRefs).where(eq(sourceRefs.chapterId, chapterId));
}

async function insertEntities(tx: Db, ir: ChapterIR): Promise<number> {
  const fresh = ir.entities.filter((e) => e.isNew);
  if (fresh.length > 0) {
    await tx.insert(entities).values(
      fresh.map((e) => ({
        id: e.id,
        bookId: ir.bookId,
        type: e.type,
        canonicalName: e.canonicalName,
        description: e.description ?? null,
        confidence: e.confidence,
        firstChapterId: ir.chapterId,
      })),
    );
  }
  const aliasRows = ir.entities.flatMap((e) =>
    e.aliases
      .filter((alias) => alias !== e.canonicalName)
      .map((alias) => ({ id: newId('alias'), entityId: e.id, alias, validFromChapterId: ir.chapterId })),
  );
  if (aliasRows.length > 0) {
    await tx
      .insert(entityAliases)
      .values(aliasRows)
      .onConflictDoNothing({ target: [entityAliases.entityId, entityAliases.alias] });
  }
  return fresh.length;
}

async function insertScenes(tx: Db, ir: ChapterIR): Promise<void> {
  if (ir.scenes.length === 0) return;
  await tx.insert(scenes).values(
    ir.scenes.map((s) => ({
      id: s.id,
      chapterId: ir.chapterId,
      editionId: ir.editionId,
      index: s.index,
      charStart: s.charStart,
      charEnd: s.charEnd,
      location: s.location ?? null,
      timeHint: s.timeHint ?? null,
      summary: s.summary ?? null,
      parseRunId: ir.provenance.parseRunId ?? null,
    })),
  );
}

async function insertSegments(tx: Db, ir: ChapterIR, text: string): Promise<void> {
  if (ir.segments.length === 0) return;
  await tx.insert(segments).values(
    ir.segments.map((s) => ({
      id: s.id,
      sceneId: s.sceneId,
      chapterId: ir.chapterId,
      index: s.index,
      kind: s.kind,
      charStart: s.charStart,
      charEnd: s.charEnd,
      text: text.slice(s.charStart, s.charEnd),
      speakerEntityId: s.speaker?.entityId ?? null,
      speakerSurface: s.speaker?.surface ?? null,
      speakerConfidence: s.speaker?.confidence ?? null,
      emotionType: s.emotion?.type ?? null,
      emotionIntensity: s.emotion?.intensity ?? null,
      parseRunId: ir.provenance.parseRunId ?? null,
    })),
  );
}

async function insertMentions(tx: Db, ir: ChapterIR, text: string): Promise<number> {
  if (ir.mentions.length === 0) return 0;
  const rows = ir.mentions.map((m) => ({ mention: m, sourceRefId: newId('sourceRef') }));
  await tx.insert(sourceRefs).values(
    rows.map(({ mention, sourceRefId }) => ({
      id: sourceRefId,
      editionId: ir.editionId,
      chapterId: ir.chapterId,
      charStart: mention.charStart,
      charEnd: mention.charEnd,
      quote: text.slice(mention.charStart, mention.charEnd),
    })),
  );
  await tx.insert(entityMentions).values(
    rows.map(({ mention, sourceRefId }) => ({
      id: newId('mention'),
      entityId: mention.entityId,
      chapterId: ir.chapterId,
      sceneId: spanAt(ir.scenes, mention.charStart)?.id ?? null,
      sourceRefId,
      surface: mention.surface,
      confidence: 1,
      parseRunId: ir.provenance.parseRunId ?? null,
    })),
  );
  return rows.length;
}

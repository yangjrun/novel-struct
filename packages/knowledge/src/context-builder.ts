import {
  currentEntityStates,
  getChapterById,
  recentEntityMentions,
  unresolvedForeshadows,
  type Db,
} from '@novelstruct/db';
import { UNKNOWN_SPEAKER_SURFACE, type ChapterIR } from '@novelstruct/core';
import type { Embedder } from './embedding.js';
import { searchScenes } from './search.js';

export interface ContextSection {
  readonly kind: 'state' | 'mention' | 'foreshadow' | 'surface' | 'similar';
  readonly reference: string;
  readonly content: string;
  readonly estimatedTokens: number;
}

export interface ContextPacket {
  readonly sections: readonly ContextSection[];
  readonly estimatedTokens: number;
  readonly budget: number;
  readonly omitted: number;
}

/** Conservative deterministic upper bound in the absence of the configured model's tokenizer. */
export function estimateContextTokens(text: string): number {
  return [...text].reduce((total, char) => total + (char.charCodeAt(0) < 128 ? 1 : 2), 0);
}

export interface ContextOptions {
  readonly budget: number;
  readonly embedder?: Embedder;
}

export async function buildConsistencyContext(db: Db, ir: ChapterIR, options: ContextOptions): Promise<ContextPacket> {
  if (!Number.isInteger(options.budget) || options.budget <= 0) throw new Error('上下文预算必须是正整数');
  const chapter = await getChapterById(db, ir.chapterId);
  if (!chapter || chapter.editionId !== ir.editionId) throw new Error('上下文的章节和版本不匹配');
  const entityIds = [
    ...new Set(
      ir.mentions
        .map((m) => m.entityId)
        .concat(ir.segments.flatMap((s) => (s.speaker?.entityId ? [s.speaker.entityId] : []))),
    ),
  ].sort();
  const [states, mentions, unresolved] = await Promise.all([
    currentEntityStates(db, ir.editionId, chapter.index, entityIds),
    recentEntityMentions(db, ir.bookId, ir.editionId, chapter.index, entityIds),
    unresolvedForeshadows(db, ir.editionId, chapter.index),
  ]);
  const candidates: Omit<ContextSection, 'estimatedTokens'>[] = [
    ...states.map((s) => ({
      kind: 'state' as const,
      reference: s.id,
      content: `${s.entityId} ${s.field}: ${s.value}（第 ${s.chapterIndex} 章）`,
    })),
    ...mentions.map((m) => ({
      kind: 'mention' as const,
      reference: `${m.entityId}:${m.chapterIndex}:${m.charStart}`,
      content: m.excerpt,
    })),
    ...unresolved.map((f) => ({
      kind: 'foreshadow' as const,
      reference: f.id,
      content: `${f.summary}（第 ${f.chapterIndex} 章）`,
    })),
    ...ir.segments
      .filter((s) => s.speaker?.surface && !s.speaker.entityId && s.speaker.surface !== UNKNOWN_SPEAKER_SURFACE)
      .map((s) => ({
        kind: 'surface' as const,
        reference: s.id,
        content: `${s.speaker!.surface}: ${chapter.text.slice(s.charStart, s.charEnd)}`,
      })),
  ];
  if (options.embedder) {
    const query = ir.scenes
      .map((s) => s.summary ?? chapter.text.slice(s.charStart, Math.min(s.charEnd, s.charStart + 160)))
      .join('\n')
      .slice(0, 1200);
    if (query) {
      const similar = await searchScenes(db, { query, bookIds: [ir.bookId], limit: 30, embedder: options.embedder });
      candidates.push(
        ...similar
          .filter((hit) => hit.editionId === ir.editionId && hit.chapterIndex < chapter.index)
          .slice(0, 10)
          .map((hit) => ({
            kind: 'similar' as const,
            reference: hit.sceneId,
            content: `第 ${hit.chapterIndex} 章：${hit.excerpt}`,
          })),
      );
    }
  }
  const sections: ContextSection[] = [];
  let tokens = 0;
  for (const candidate of candidates) {
    const estimatedTokens = estimateContextTokens(candidate.reference) + estimateContextTokens(candidate.content) + 4;
    if (tokens + estimatedTokens > options.budget) continue;
    sections.push({ ...candidate, estimatedTokens });
    tokens += estimatedTokens;
  }
  return { sections, estimatedTokens: tokens, budget: options.budget, omitted: candidates.length - sections.length };
}

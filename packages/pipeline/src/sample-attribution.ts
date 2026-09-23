import { type Db, getChapterByNumber, getEdition } from '@novelstruct/db';
import { paragraphsFromText } from '@novelstruct/ingest';
import { extractQuotes, type QuoteSpan } from '@novelstruct/parser';
import { PipelineError } from './errors.js';
import type { GoldItem } from './gold.js';

export interface SampleAttributionOptions {
  readonly editionId: string;
  /** Chapter heading numbers (第N章), not database indexes. */
  readonly from?: number;
  readonly to?: number;
  readonly perChapter?: number;
  /** Already reviewed gold items; these quote occurrences are excluded from the draft. */
  readonly gold?: readonly GoldItem[];
}

/** An unlabelled draft. `speaker: null` deliberately cannot pass GoldItemSchema until reviewed. */
export interface AttributionDraft {
  readonly chapter: number;
  readonly quote: string;
  readonly occurrence?: number;
  readonly speaker: null;
  readonly chapterIndex: number;
  readonly charStart: number;
  readonly charEnd: number;
  readonly context: string;
}

/** Stable, evenly distributed quote candidates from each numbered chapter, without invoking an LLM. */
export async function sampleAttributionDrafts(db: Db, options: SampleAttributionOptions): Promise<AttributionDraft[]> {
  const from = options.from ?? 1;
  const to = options.to ?? 20;
  const perChapter = options.perChapter ?? 5;
  if (![from, to, perChapter].every((value) => Number.isInteger(value) && value > 0) || to < from) {
    throw new PipelineError('invalid_input', '章节编号和每章抽样数必须为正整数，结束章不能早于起始章');
  }
  if (to - from > 199) throw new PipelineError('invalid_input', '一次最多抽样 200 章');
  if (perChapter > 50) throw new PipelineError('invalid_input', '每章最多抽样 50 条对白');
  if (!(await getEdition(db, options.editionId)))
    throw new PipelineError('not_found', `版本 ${options.editionId} 不存在`);

  const drafts: AttributionDraft[] = [];
  for (let number = from; number <= to; number += 1) {
    const chapter = await getChapterByNumber(db, options.editionId, number);
    if (!chapter) throw new PipelineError('not_found', `版本里没有第 ${number} 章，无法抽样`);
    const quotes = extractQuotes(chapter.text, paragraphsFromText(chapter.text)).quotes;
    const excluded = new Set<number>();
    for (const item of options.gold?.filter((entry) => entry.chapter === number) ?? []) {
      const matches = quotes.filter((quote) => quote.inner.includes(item.quote));
      if (matches.length === 0)
        throw new PipelineError('invalid_input', `第 ${number} 章金标「${item.quote}」找不到对应对白`);
      if (matches.length > 1 && item.occurrence === undefined) {
        throw new PipelineError('invalid_input', `第 ${number} 章金标「${item.quote}」不唯一，需指定 occurrence`);
      }
      const picked = matches[(item.occurrence ?? 1) - 1];
      if (!picked) throw new PipelineError('invalid_input', `第 ${number} 章金标「${item.quote}」的 occurrence 越界`);
      excluded.add(quotes.indexOf(picked));
    }
    const available = quotes.filter((_, index) => !excluded.has(index));
    const count = Math.min(perChapter, available.length);
    for (let i = 0; i < count; i += 1) {
      const quote = available[Math.floor(((i + 0.5) * available.length) / count)]!;
      drafts.push(toDraft(chapter.text, number, chapter.index, quotes, quote));
    }
  }
  return drafts;
}

function toDraft(
  text: string,
  chapter: number,
  chapterIndex: number,
  quotes: readonly QuoteSpan[],
  quote: QuoteSpan,
): AttributionDraft {
  const inner = quote.inner.trim();
  // Full inner text avoids accidentally choosing a substring also present in another utterance.
  const matches = quotes.filter((candidate) => candidate.inner.includes(inner));
  const occurrence = matches.length > 1 ? matches.indexOf(quote) + 1 : undefined;
  return {
    chapter,
    quote: inner,
    ...(occurrence === undefined ? {} : { occurrence }),
    speaker: null,
    chapterIndex,
    charStart: quote.charStart,
    charEnd: quote.charEnd,
    context: text.slice(Math.max(0, quote.charStart - 100), Math.min(text.length, quote.charEnd + 100)),
  };
}

export function formatAttributionDrafts(drafts: readonly AttributionDraft[]): string {
  const header = [
    '# 人工标注候选；speaker: null 表示尚未标注，不能直接交给 eval。',
    '# 填写规范角色名及可选 aliases 后再评测；chapter 是章节标题编号，charStart/charEnd 和 context 仅供核对。',
  ];
  return [...header, ...drafts.map((draft) => JSON.stringify(draft))].join('\n') + '\n';
}

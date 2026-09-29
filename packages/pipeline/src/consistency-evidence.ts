import type { FactEvidence } from '@novelstruct/db';

export interface EvidenceQuote {
  readonly quote: string;
  readonly charStart?: number;
  readonly charEnd?: number;
}

/** Store one continuous citation covering both the assertion and its explicit time anchor. */
export function locateTimedConsistencyEvidence(
  text: string,
  fact: { evidence: EvidenceQuote; storyTime?: string; timeEvidence?: EvidenceQuote },
): FactEvidence {
  const evidence = locateConsistencyEvidence(text, fact.evidence);
  if (fact.storyTime !== undefined && !fact.storyTime.trim()) throw new Error('故事时间不能为空');
  if (fact.storyTime !== undefined && fact.timeEvidence === undefined)
    throw new Error('故事时间必须提供本章时间锚点 timeEvidence');
  if (fact.timeEvidence === undefined) return evidence;
  if (fact.storyTime === undefined) throw new Error('时间证据必须对应 storyTime');
  const anchor = locateConsistencyEvidence(text, fact.timeEvidence);
  const charStart = Math.min(evidence.charStart, anchor.charStart);
  const charEnd = Math.max(evidence.charEnd, anchor.charEnd);
  return { charStart, charEnd, quote: text.slice(charStart, charEnd) };
}

/** Resolve exact quotes only; a valid offset can disambiguate repeated text. Never fuzzy-match. */
export function locateConsistencyEvidence(text: string, evidence: EvidenceQuote): FactEvidence {
  const { quote, charStart, charEnd } = evidence;
  if (!quote.length) throw new Error('一致性证据不能为空');
  if (
    charStart !== undefined &&
    charEnd !== undefined &&
    Number.isInteger(charStart) &&
    Number.isInteger(charEnd) &&
    charStart >= 0 &&
    charEnd > charStart &&
    charEnd <= text.length &&
    text.slice(charStart, charEnd) === quote
  ) {
    return { quote, charStart, charEnd };
  }
  const start = text.indexOf(quote);
  if (start < 0) throw new Error(`一致性证据找不到原文：${JSON.stringify(quote.slice(0, 100))}`);
  if (text.indexOf(quote, start + 1) >= 0)
    throw new Error(`一致性证据在本章不唯一，需提供更长原文或准确偏移：${JSON.stringify(quote.slice(0, 100))}`);
  return { quote, charStart: start, charEnd: start + quote.length };
}

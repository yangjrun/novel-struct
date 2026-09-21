import { type KnownEntity, entityNames, occurrences } from '@novelstruct/core';
import type { NormalizedParagraph } from '@novelstruct/ingest';
import type { QuoteSpan } from '../quotes.js';
import type {
  AttributionInput,
  AttributionResult,
  ExtractedEntity,
  QuoteAttribution,
  SpeakerAttributor,
} from './types.js';

export const HEURISTIC_PROMPT_VERSION = 'heuristic/0.2';

const PRONOUNS: ReadonlySet<string> = new Set([
  '他',
  '她',
  '它',
  '我',
  '你',
  '您',
  '咱',
  '俺',
  '他们',
  '她们',
  '我们',
  '你们',
  '咱们',
  '众人',
  '那人',
  '此人',
  '对方',
  '来人',
  '两人',
  '三人',
  '有人',
  '某人',
]);

/** Characters that commonly follow a speaker's name in a speech tag, e.g. 铁老[说]道, 顾小满[喘]着气. */
const AFTER_NAME_HINTS = [
  '说',
  '道',
  '问',
  '喊',
  '叫',
  '笑',
  '答',
  '回',
  '叹',
  '哼',
  '吼',
  '骂',
  '怒',
  '冷',
  '淡',
  '缓',
  '慢',
  '忽',
  '突',
  '低',
  '沉',
  '轻',
  '急',
  '喘',
  '指',
  '终',
  '没',
  '抬',
  '转',
  '皱',
  '摇',
  '点',
  '看',
  '望',
  '瞪',
  '盯',
  '开',
  '继',
  '接',
  '插',
  '补',
  '解',
  '把',
  '将',
  '走',
  '站',
  '坐',
  '抓',
  '伸',
  '拍',
  '推',
  '拉',
  '拿',
  '举',
  '放',
  '攥',
  '咬',
  '露',
  '脸',
  '眼',
  '嘴',
  '声',
  '却',
  '也',
  '又',
  '才',
  '便',
  '就',
  '正',
  '已',
  '试',
  '定',
  '想',
  '顿',
  '不',
  '立',
  '连',
  '一',
];

const NAME_BEFORE_HINT = new RegExp(`^([\\u4e00-\\u9fa5]{1,4}?)(?=[${AFTER_NAME_HINTS.join('')}])`);
const CLAUSE_BREAK = /[，,。！？!?；;：:“”「」『』"、（）()【】]/;
const SENTENCE_BREAK = /[。！？!?]/;
const COLON_END = /[：:]\s*$/;
/**
 * A speech tag that ends a paragraph and introduces the quote in the next one: 小柒回答道。 /
 * 楚光定了定神，说道。 / 叶炜急忙道： The verb must be the last word before the final punctuation,
 * and a 道 that is part of another word (知道, 味道, 难道) does not count.
 */
const TAG_ENDING =
  /(?:(?<![知味街难频通轨赛跑管地厚正王力])道|说|问|答|回答|解释|嘀咕|嘟囔|感慨|感叹|提醒|补充|开口|喊|叫|骂|叹|吼|嚷)[。：:！]?$/;
/**
 * A bare label before a colon, chat or script style: 楚光：“……” / 八级大狂风（管理员）：“……”.
 * Letters and digits are allowed for handles like 光 or 小柒.
 */
const LABEL = /^[一-龥A-Za-z0-9]{1,8}$/;

const CONFIDENCE_KNOWN = 0.7;
const CONFIDENCE_PATTERN = 0.6;
const CONFIDENCE_LABEL = 0.6;
const CONFIDENCE_PREVIOUS_PARAGRAPH = 0.5;
const CONFIDENCE_PRONOUN = 0.3;
const DISCOVERED_ENTITY_CONFIDENCE = 0.5;
/** A name found only once in the chapter is more likely a false positive than a speaker. */
const MIN_DISCOVERED_OCCURRENCES = 2;

/**
 * Rule based speaker attribution for offline runs and as the evaluation baseline. Looks at the
 * narration immediately before a quote (`铁老说道：“…”`), after it (`“…”顾小满喘着气`), a bare
 * label before a colon (`楚光：“…”`), and, when the quote opens its paragraph, a speech tag that
 * closes the previous paragraph (`小柒回答道。`). Prefers names already known for the book, then a
 * name-plus-verb pattern, then a pronoun.
 */
export function createHeuristicAttributor(): SpeakerAttributor {
  return {
    name: 'heuristic',
    promptVersion: HEURISTIC_PROMPT_VERSION,
    attribute: async (input) => attribute(input),
  };
}

function attribute(input: AttributionInput): AttributionResult {
  const contexts = input.quotes.map((quote, i) => quoteContext(input, quote, i));
  const knownNames = knownNameIndex(input.knownEntities);
  const discovered = discoverNames(contexts, knownNames, input.text);
  const names = new Set([...knownNames.keys(), ...discovered]);

  const attributions = input.quotes.map((quote, i) => attributeOne(quote, contexts[i]!, names, knownNames));
  const entities: ExtractedEntity[] = [...discovered].map((name) => ({
    type: 'character',
    name,
    aliases: [],
    confidence: DISCOVERED_ENTITY_CONFIDENCE,
  }));
  const scenes =
    input.paragraphs.length === 0 ? [] : [{ startParagraph: 0, endParagraph: input.paragraphs.length - 1 }];
  return { attributions, entities, scenes, warnings: [] };
}

interface QuoteContext {
  readonly before: string;
  readonly after: string;
  /** Text of the previous paragraph when the quote opens its own paragraph, otherwise empty. */
  readonly previousParagraph: string;
}

function quoteContext(input: AttributionInput, quote: QuoteSpan, i: number): QuoteContext {
  const paragraph = input.paragraphs[quote.paragraphIndex]!;
  const prev = input.quotes[i - 1];
  const next = input.quotes[i + 1];
  const beforeStart =
    prev !== undefined && prev.paragraphIndex === quote.paragraphIndex ? prev.charEnd : paragraph.charStart;
  const afterEnd =
    next !== undefined && next.paragraphIndex === quote.paragraphIndex ? next.charStart : paragraph.charEnd;
  const before = input.text.slice(beforeStart, quote.charStart);
  const opensParagraph = before.trim().length === 0 && beforeStart === paragraph.charStart;
  return {
    before,
    after: input.text.slice(quote.charEnd, afterEnd),
    previousParagraph: opensParagraph ? paragraphText(input, input.paragraphs[quote.paragraphIndex - 1]) : '',
  };
}

function paragraphText(input: AttributionInput, paragraph: NormalizedParagraph | undefined): string {
  return paragraph === undefined ? '' : input.text.slice(paragraph.charStart, paragraph.charEnd);
}

function knownNameIndex(known: readonly KnownEntity[]): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const entity of known) {
    if (entity.type !== 'character') continue;
    for (const name of entityNames(entity)) index.set(name, entity.canonicalName);
  }
  return index;
}

function discoverNames(
  contexts: readonly QuoteContext[],
  known: ReadonlyMap<string, string>,
  text: string,
): ReadonlySet<string> {
  const found = new Set<string>();
  for (const ctx of contexts) {
    const candidates = [
      patternName(tagClauseBefore(ctx.before)),
      patternName(tagClauseAfter(ctx.after)),
      labelName(ctx.before),
      previousParagraphName(ctx.previousParagraph),
    ];
    for (const name of candidates) {
      if (name === undefined || PRONOUNS.has(name) || name.length < 2 || known.has(name)) continue;
      if (occurrences(text, name).length >= MIN_DISCOVERED_OCCURRENCES) found.add(name);
    }
  }
  return found;
}

function attributeOne(
  quote: QuoteSpan,
  ctx: QuoteContext,
  names: ReadonlySet<string>,
  known: ReadonlyMap<string, string>,
): QuoteAttribution {
  const guess =
    speakerFromLabel(ctx.before, names, known) ??
    speakerFromTags(ctx, names, known) ??
    speakerFromPreviousParagraph(ctx.previousParagraph, names, known);
  return guess === undefined
    ? { quoteId: quote.id, kind: 'dialogue', confidence: 0 }
    : { quoteId: quote.id, kind: 'dialogue', ...guess };
}

interface SpeakerGuess {
  readonly speakerSurface: string;
  readonly confidence: number;
}

function speakerFromTags(
  ctx: QuoteContext,
  names: ReadonlySet<string>,
  known: ReadonlyMap<string, string>,
): SpeakerGuess | undefined {
  const before = tagClauseBefore(ctx.before);
  const after = tagClauseAfter(ctx.after);
  const order = COLON_END.test(ctx.before) ? [before, after] : [after, before];
  for (const clause of order) {
    const speaker = speakerInClause(clause, names, known);
    if (speaker !== undefined) return speaker;
  }
  return undefined;
}

/** 楚光：“……” — the whole text before the colon is a name or handle, no verb needed. */
function speakerFromLabel(
  before: string,
  names: ReadonlySet<string>,
  known: ReadonlyMap<string, string>,
): SpeakerGuess | undefined {
  const label = labelName(before);
  if (label === undefined) return undefined;
  if (PRONOUNS.has(label)) return { speakerSurface: label, confidence: CONFIDENCE_PRONOUN };
  const canonical = known.get(label);
  if (canonical !== undefined) return { speakerSurface: canonical, confidence: CONFIDENCE_KNOWN };
  return { speakerSurface: label, confidence: names.has(label) ? CONFIDENCE_PATTERN : CONFIDENCE_LABEL };
}

/**
 * 楚光：“……” / 八级大狂风（管理员）：“……” — everything before the colon is one name or handle,
 * optionally followed by a parenthetical. A clause that reads as name plus verb (铁老说道：) is a
 * speech tag, not a label, and is left to the tag rules.
 */
function labelName(before: string): string | undefined {
  if (!COLON_END.test(before)) return undefined;
  const stripped = before
    .trim()
    .replace(/[：:]\s*$/, '')
    .replace(/[（(][^（()）]*[)）]\s*$/, '')
    .trim();
  if (!LABEL.test(stripped)) return undefined;
  const tag = NAME_BEFORE_HINT.exec(stripped);
  return tag !== null && tag[1]!.length < stripped.length ? undefined : stripped;
}

/** The previous paragraph is a speech tag: 小柒回答道。 → 小柒; 楚光定了定神，说道。 → 楚光 */
function speakerFromPreviousParagraph(
  previous: string,
  names: ReadonlySet<string>,
  known: ReadonlyMap<string, string>,
): SpeakerGuess | undefined {
  const clauses = tagClauses(previous);
  if (clauses === undefined) return undefined;
  const named = longestNameIn(clauses.join(' '), names);
  if (named !== undefined) {
    const canonical = known.get(named);
    return canonical !== undefined
      ? { speakerSurface: canonical, confidence: CONFIDENCE_KNOWN }
      : { speakerSurface: named, confidence: CONFIDENCE_PATTERN };
  }
  const name = clauses.map(patternName).find((n) => n !== undefined);
  if (name === undefined) return undefined;
  if (PRONOUNS.has(name)) return { speakerSurface: name, confidence: CONFIDENCE_PRONOUN };
  return name.length >= 2 ? { speakerSurface: name, confidence: CONFIDENCE_PREVIOUS_PARAGRAPH } : undefined;
}

function previousParagraphName(previous: string): string | undefined {
  const clauses = tagClauses(previous);
  return clauses?.map(patternName).find((n) => n !== undefined);
}

/**
 * When a paragraph ends in a speech verb, the clauses of its last sentence that may name the
 * speaker: the clause holding the verb first (蹲在墙角的小柒问道), then the sentence opener
 * (楚光定了定神，说道 → 楚光定了定神). Undefined when the paragraph is not a tag.
 */
function tagClauses(previous: string): readonly string[] | undefined {
  const trimmed = previous.trim();
  if (trimmed.length === 0 || !TAG_ENDING.test(trimmed)) return undefined;
  const parts = (sentences(trimmed).at(-1) ?? '')
    .split(CLAUSE_BREAK)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const last = parts.at(-1);
  const first = parts[0];
  return last === undefined ? [] : first === undefined || first === last ? [last] : [last, first];
}

function speakerInClause(
  clause: string,
  names: ReadonlySet<string>,
  known: ReadonlyMap<string, string>,
): SpeakerGuess | undefined {
  if (clause.length === 0) return undefined;
  const named = longestNameIn(clause, names);
  if (named !== undefined) {
    const canonical = known.get(named);
    return canonical !== undefined
      ? { speakerSurface: canonical, confidence: CONFIDENCE_KNOWN }
      : { speakerSurface: named, confidence: CONFIDENCE_PATTERN };
  }
  const name = patternName(clause);
  if (name === undefined) return undefined;
  if (PRONOUNS.has(name)) return { speakerSurface: name, confidence: CONFIDENCE_PRONOUN };
  return name.length >= 2 ? { speakerSurface: name, confidence: CONFIDENCE_PATTERN } : undefined;
}

function longestNameIn(clause: string, names: ReadonlySet<string>): string | undefined {
  return [...names].filter((n) => clause.includes(n)).sort((a, b) => b.length - a.length)[0];
}

function patternName(clause: string): string | undefined {
  const m = NAME_BEFORE_HINT.exec(clause);
  return m?.[1];
}

/** Last sentence of the narration before a quote, cut at the first clause break: 铁老没有抬头，…说道： → 铁老没有抬头 */
function tagClauseBefore(before: string): string {
  return firstClause(sentences(before).at(-1) ?? '');
}

/** First clause of the narration after a quote: 顾小满喘着气，… → 顾小满喘着气 */
function tagClauseAfter(after: string): string {
  return firstClause(after.trim());
}

function sentences(text: string): string[] {
  return text
    .split(SENTENCE_BREAK)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function firstClause(s: string): string {
  const m = CLAUSE_BREAK.exec(s);
  return (m === null ? s : s.slice(0, m.index)).trim();
}

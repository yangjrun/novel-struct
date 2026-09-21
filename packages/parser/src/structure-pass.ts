import {
  ChapterIRSchema,
  complementSpans,
  IR_VERSION,
  newId,
  sortSpans,
  spanAt,
  spanContainsOffset,
  type ChapterIR,
  type EntityIR,
  type KnownEntity,
  type MentionIR,
  type SceneIR,
  type SegmentIR,
  type Span,
  UNKNOWN_SPEAKER_SURFACE,
  entityNames,
  validateChapterIR,
} from '@novelstruct/core';
import { paragraphsFromText, type NormalizedParagraph } from '@novelstruct/ingest';
import type { LlmUsage, QuoteAttribution, SceneProposal, SpeakerAttributor } from './attribution/types.js';
import { resolveEntities, resolveSpeaker, type ResolvedEntities } from './entity-resolver.js';
import { findMentions, type MentionTarget } from './mentions.js';
import { extractQuotes, type QuoteSpan } from './quotes.js';

export interface StructurePassInput {
  readonly bookId: string;
  readonly editionId: string;
  readonly chapterId: string;
  readonly text: string;
  readonly normalizerVersion: string;
  readonly knownEntities: readonly KnownEntity[];
  readonly attributor: SpeakerAttributor;
  readonly parseRunId?: string;
}

export interface StructurePassResult {
  readonly ir: ChapterIR;
  readonly warnings: readonly string[];
  readonly usage?: LlmUsage;
  readonly model?: string;
}

/**
 * Structure pass for one chapter. Only the attributor talks to a model; quote extraction,
 * segment assembly, entity resolution and mention evidence are deterministic, and the result is
 * validated before it is returned so an invalid IR here is a programming error, not a model error.
 */
export async function runStructurePass(input: StructurePassInput): Promise<StructurePassResult> {
  const { text } = input;
  const paragraphs = paragraphsFromText(text);
  const extraction = extractQuotes(text, paragraphs);
  const attribution = await input.attributor.attribute({
    text,
    paragraphs,
    quotes: extraction.quotes,
    knownEntities: input.knownEntities,
  });

  const resolved = resolveEntities(input.knownEntities, attribution.entities);
  const { scenes, warnings: sceneWarnings } = buildScenes(attribution.scenes, paragraphs, text.length);
  const segments = buildSegments(text, extraction.quotes, attribution.attributions, scenes, resolved);
  const mentions = findMentions(text, mentionTargets(input.knownEntities, resolved));
  const entities = entitiesForIR(input.knownEntities, resolved, segments, mentions);

  const ir = ChapterIRSchema.parse({
    irVersion: IR_VERSION,
    bookId: input.bookId,
    editionId: input.editionId,
    chapterId: input.chapterId,
    charCount: text.length,
    scenes: attachCharacters(scenes, segments, mentions, entities),
    segments,
    entities,
    mentions,
    provenance: {
      pass: 'structure',
      attributor: input.attributor.name,
      model: attribution.model,
      promptVersion: input.attributor.promptVersion,
      normalizerVersion: input.normalizerVersion,
      parseRunId: input.parseRunId,
    },
  });

  const validation = validateChapterIR(ir, text);
  if (!validation.ok) {
    const detail = validation.errors.map((e) => `${e.code} ${e.path ?? ''} ${e.message}`).join('; ');
    throw new Error(`structure pass produced an invalid IR: ${detail}`);
  }
  return {
    ir,
    warnings: [...extraction.warnings, ...attribution.warnings, ...sceneWarnings],
    ...(attribution.usage === undefined ? {} : { usage: attribution.usage }),
    ...(attribution.model === undefined ? {} : { model: attribution.model }),
  };
}

function buildScenes(
  proposals: readonly SceneProposal[],
  paragraphs: readonly NormalizedParagraph[],
  length: number,
): { scenes: SceneIR[]; warnings: string[] } {
  if (paragraphs.length === 0) return { scenes: [], warnings: [] };
  const sorted = [...proposals].sort((a, b) => a.startParagraph - b.startParagraph);
  const tiles = sorted.length > 0 && tilesParagraphs(sorted, paragraphs.length);
  const effective: readonly SceneProposal[] = tiles
    ? sorted
    : [{ startParagraph: 0, endParagraph: paragraphs.length - 1 }];
  const warnings =
    tiles || proposals.length === 0 ? [] : ['scene proposals do not tile the chapter, using a single scene'];

  const scenes = effective.map((p, index) => {
    const next = effective[index + 1];
    return {
      id: newId('scene'),
      index,
      charStart: paragraphs[p.startParagraph]!.charStart,
      charEnd: next === undefined ? length : paragraphs[next.startParagraph]!.charStart,
      characterIds: [] as string[],
      ...(p.location === undefined ? {} : { location: p.location }),
      ...(p.timeHint === undefined ? {} : { timeHint: p.timeHint }),
      ...(p.summary === undefined ? {} : { summary: p.summary }),
    };
  });
  return { scenes, warnings };
}

function tilesParagraphs(sorted: readonly SceneProposal[], paragraphCount: number): boolean {
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  return (
    first.startParagraph === 0 &&
    last.endParagraph === paragraphCount - 1 &&
    sorted.every(
      (s, i) => s.startParagraph <= s.endParagraph && (i === 0 || s.startParagraph === sorted[i - 1]!.endParagraph + 1),
    )
  );
}

type DraftSegment = Span & Pick<SegmentIR, 'kind' | 'speaker' | 'emotion'>;

function buildSegments(
  text: string,
  quotes: readonly QuoteSpan[],
  attributions: readonly QuoteAttribution[],
  scenes: readonly SceneIR[],
  resolved: ResolvedEntities,
): SegmentIR[] {
  const byQuoteId = new Map(attributions.map((a) => [a.quoteId, a] as const));
  const spoken: DraftSegment[] = quotes.map((q) => toSpokenSegment(q, byQuoteId.get(q.id), resolved));
  const narration: DraftSegment[] = complementSpans(quotes, text.length)
    .flatMap((gap) => splitAtSceneBoundaries(gap, scenes))
    .map((span) => ({ ...span, kind: 'narration' }));

  return sortSpans([...spoken, ...narration]).map((draft, index) => ({
    id: newId('segment'),
    sceneId: sceneAt(scenes, draft.charStart).id,
    index,
    kind: draft.kind,
    charStart: draft.charStart,
    charEnd: draft.charEnd,
    ...(draft.speaker === undefined ? {} : { speaker: draft.speaker }),
    ...(draft.emotion === undefined ? {} : { emotion: draft.emotion }),
  }));
}

function toSpokenSegment(
  quote: QuoteSpan,
  attribution: QuoteAttribution | undefined,
  resolved: ResolvedEntities,
): DraftSegment {
  const surface = attribution?.speakerSurface;
  const entityId = surface === undefined ? undefined : resolveSpeaker(resolved, surface);
  const speaker =
    surface === undefined
      ? { surface: UNKNOWN_SPEAKER_SURFACE, confidence: 0 }
      : { surface, confidence: attribution?.confidence ?? 0, ...(entityId === undefined ? {} : { entityId }) };
  return {
    charStart: quote.charStart,
    charEnd: quote.charEnd,
    kind: attribution?.kind ?? 'dialogue',
    speaker,
    ...(attribution?.emotion === undefined ? {} : { emotion: attribution.emotion }),
  };
}

function splitAtSceneBoundaries(gap: Span, scenes: readonly SceneIR[]): Span[] {
  return scenes.flatMap((scene) => {
    const charStart = Math.max(gap.charStart, scene.charStart);
    const charEnd = Math.min(gap.charEnd, scene.charEnd);
    return charStart < charEnd ? [{ charStart, charEnd }] : [];
  });
}

function sceneAt(scenes: readonly SceneIR[], position: number): SceneIR {
  const scene = spanAt(scenes, position);
  if (scene === undefined) throw new Error(`no scene covers offset ${position}`);
  return scene;
}

function mentionTargets(known: readonly KnownEntity[], resolved: ResolvedEntities): MentionTarget[] {
  const names = new Map<string, Set<string>>();
  const add = (id: string, values: readonly string[]): void => {
    const set = names.get(id) ?? new Set<string>();
    values.forEach((v) => set.add(v));
    names.set(id, set);
  };
  known.forEach((k) => add(k.id, entityNames(k)));
  resolved.entities.forEach((e) => add(e.id, entityNames(e)));
  return [...names.entries()].map(([id, set]) => ({ id, names: [...set] }));
}

/** Entities the attributor reported, plus known entities that turned out to speak or be mentioned. */
function entitiesForIR(
  known: readonly KnownEntity[],
  resolved: ResolvedEntities,
  segments: readonly SegmentIR[],
  mentions: readonly MentionIR[],
): EntityIR[] {
  const referenced = new Set([
    ...segments.flatMap((s) => (s.speaker?.entityId === undefined ? [] : [s.speaker.entityId])),
    ...mentions.map((m) => m.entityId),
  ]);
  const emitted = new Map(resolved.entities.map((e) => [e.id, e] as const));
  for (const k of known) {
    if (referenced.has(k.id) && !emitted.has(k.id)) {
      emitted.set(k.id, {
        id: k.id,
        type: k.type,
        canonicalName: k.canonicalName,
        aliases: [],
        isNew: false,
        confidence: 1,
      });
    }
  }
  return [...emitted.values()];
}

function attachCharacters(
  scenes: readonly SceneIR[],
  segments: readonly SegmentIR[],
  mentions: readonly MentionIR[],
  entities: readonly EntityIR[],
): SceneIR[] {
  const characters = new Set(entities.filter((e) => e.type === 'character').map((e) => e.id));
  const appearances: readonly { readonly entityId: string; readonly charStart: number }[] = sortSpans([
    ...segments.flatMap((s) =>
      s.speaker?.entityId === undefined
        ? []
        : [{ entityId: s.speaker.entityId, charStart: s.charStart, charEnd: s.charEnd }],
    ),
    ...mentions,
  ]);
  return scenes.map((scene) => ({
    ...scene,
    characterIds: [
      ...new Set(
        appearances
          .filter((a) => characters.has(a.entityId) && spanContainsOffset(scene, a.charStart))
          .map((a) => a.entityId),
      ),
    ],
  }));
}

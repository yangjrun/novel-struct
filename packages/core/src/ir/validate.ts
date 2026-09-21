import { type Span, isWellFormedSpan, spanContains, sliceSpan } from '../text/span.js';
import type { ChapterIR } from './schema.js';

export type ValidationCode =
  | 'IR-LENGTH'
  | 'IR-SEG-COVER'
  | 'IR-SCENE-PARTITION'
  | 'IR-SEG-SCENE'
  | 'IR-DIALOGUE-SPEAKER'
  | 'IR-MENTION-EVIDENCE'
  | 'IR-REF'
  | 'IR-UNIQUE'
  | 'IR-RANGE';

export interface ValidationError {
  readonly code: ValidationCode;
  readonly message: string;
  readonly path?: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: readonly ValidationError[];
}

interface Indexed extends Span {
  readonly id: string;
  readonly index: number;
}

/**
 * Pure structural validation of a ChapterIR against the chapter text it describes.
 * Any error blocks the write to the fact layer. Codes are documented in docs/03-novel-ir.md.
 */
export function validateChapterIR(ir: ChapterIR, text: string): ValidationResult {
  const errors: ValidationError[] = [
    ...checkLength(ir, text),
    ...checkPartition(ir.scenes, ir.charCount, 'IR-SCENE-PARTITION', 'scenes'),
    ...checkPartition(ir.segments, ir.charCount, 'IR-SEG-COVER', 'segments'),
    ...checkUniqueIds(ir),
    ...checkReferences(ir),
    ...checkSegmentsInsideScenes(ir),
    ...checkSpeakers(ir),
    ...checkMentions(ir, text),
    ...checkRanges(ir),
  ];
  return { ok: errors.length === 0, errors };
}

function err(code: ValidationCode, message: string, path?: string): ValidationError {
  return path === undefined ? { code, message } : { code, message, path };
}

function checkLength(ir: ChapterIR, text: string): ValidationError[] {
  return ir.charCount === text.length
    ? []
    : [err('IR-LENGTH', `charCount ${ir.charCount} does not match text length ${text.length}`)];
}

function checkPartition(
  items: readonly Indexed[],
  total: number,
  code: ValidationCode,
  label: string,
): ValidationError[] {
  const sorted = [...items].sort((a, b) => a.index - b.index);
  if (sorted.length === 0) {
    return total === 0 ? [] : [err(code, `${label} is empty but chapter has ${total} chars`)];
  }
  const errors: ValidationError[] = [];
  let cursor = 0;
  sorted.forEach((item, position) => {
    const path = `${label}[${item.index}]`;
    if (item.index !== position) errors.push(err(code, `index gap, expected ${position}`, path));
    if (item.charStart !== cursor) {
      errors.push(err(code, `starts at ${item.charStart}, expected ${cursor}`, path));
    }
    if (!(item.charStart < item.charEnd)) errors.push(err(code, 'empty or inverted span', path));
    cursor = item.charEnd;
  });
  if (cursor !== total) errors.push(err(code, `${label} end at ${cursor}, expected ${total}`));
  return errors;
}

function checkUniqueIds(ir: ChapterIR): ValidationError[] {
  const groups: ReadonlyArray<readonly [string, readonly { id: string }[]]> = [
    ['scenes', ir.scenes],
    ['segments', ir.segments],
    ['entities', ir.entities],
  ];
  return groups.flatMap(([label, items]) => {
    const seen = new Set<string>();
    return items.flatMap((item) => {
      if (seen.has(item.id)) return [err('IR-UNIQUE', `duplicate id ${item.id}`, label)];
      seen.add(item.id);
      return [];
    });
  });
}

function checkReferences(ir: ChapterIR): ValidationError[] {
  const sceneIds = new Set(ir.scenes.map((s) => s.id));
  const entityIds = new Set(ir.entities.map((e) => e.id));
  const missing = (kind: string, id: string, path: string): ValidationError =>
    err('IR-REF', `unknown ${kind} ${id}`, path);

  return [
    ...ir.segments.flatMap((seg) => {
      const path = `segments[${seg.index}]`;
      const out: ValidationError[] = [];
      if (!sceneIds.has(seg.sceneId)) out.push(missing('scene', seg.sceneId, path));
      const speakerId = seg.speaker?.entityId;
      if (speakerId !== undefined && !entityIds.has(speakerId)) {
        out.push(missing('entity', speakerId, `${path}.speaker`));
      }
      return out;
    }),
    ...ir.mentions.flatMap((m, i) =>
      entityIds.has(m.entityId) ? [] : [missing('entity', m.entityId, `mentions[${i}]`)],
    ),
    ...ir.scenes.flatMap((scene) =>
      scene.characterIds.flatMap((id) =>
        entityIds.has(id) ? [] : [missing('entity', id, `scenes[${scene.index}].characterIds`)],
      ),
    ),
  ];
}

function checkSegmentsInsideScenes(ir: ChapterIR): ValidationError[] {
  const scenesById = new Map(ir.scenes.map((s) => [s.id, s] as const));
  return ir.segments.flatMap((seg) => {
    const scene = scenesById.get(seg.sceneId);
    if (scene === undefined || spanContains(scene, seg)) return [];
    return [err('IR-SEG-SCENE', `segment outside scene ${scene.id}`, `segments[${seg.index}]`)];
  });
}

function checkSpeakers(ir: ChapterIR): ValidationError[] {
  return ir.segments.flatMap((seg) => {
    if (seg.kind === 'narration') return [];
    const speaker = seg.speaker;
    if (speaker === undefined || (speaker.entityId === undefined && speaker.surface === undefined)) {
      return [err('IR-DIALOGUE-SPEAKER', `${seg.kind} segment has no speaker`, `segments[${seg.index}]`)];
    }
    return [];
  });
}

function checkMentions(ir: ChapterIR, text: string): ValidationError[] {
  return ir.mentions.flatMap((m, i) => {
    const path = `mentions[${i}]`;
    if (!isWellFormedSpan(m, text.length)) return [err('IR-MENTION-EVIDENCE', 'span out of bounds', path)];
    const actual = sliceSpan(text, m);
    return actual === m.surface
      ? []
      : [err('IR-MENTION-EVIDENCE', `text at span is "${actual}", surface is "${m.surface}"`, path)];
  });
}

function checkRanges(ir: ChapterIR): ValidationError[] {
  const inUnit = (n: number): boolean => n >= 0 && n <= 1;
  return [
    ...ir.segments.flatMap((seg) => {
      const path = `segments[${seg.index}]`;
      const out: ValidationError[] = [];
      if (seg.speaker !== undefined && !inUnit(seg.speaker.confidence)) {
        out.push(err('IR-RANGE', 'speaker confidence outside [0, 1]', path));
      }
      if (seg.emotion !== undefined && !inUnit(seg.emotion.intensity)) {
        out.push(err('IR-RANGE', 'emotion intensity outside [0, 1]', path));
      }
      return out;
    }),
    ...ir.entities.flatMap((e) =>
      inUnit(e.confidence) ? [] : [err('IR-RANGE', 'entity confidence outside [0, 1]', `entities.${e.id}`)],
    ),
  ];
}

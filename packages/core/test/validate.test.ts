import { describe, expect, it } from 'vitest';
import { ChapterIRSchema, validateChapterIR, type ChapterIRInput } from '../src/index.js';

const text = '林风走进铁匠铺。“老先生在吗？”屋里没有回应。';
const quoteStart = text.indexOf('“');
const quoteEnd = text.indexOf('”') + 1;

function baseIR(): ChapterIRInput {
  return {
    irVersion: '0.1',
    bookId: 'bk_1',
    editionId: 'ed_1',
    chapterId: 'chp_1',
    charCount: text.length,
    scenes: [{ id: 'scn_1', index: 0, charStart: 0, charEnd: text.length, characterIds: ['ent_1'] }],
    segments: [
      { id: 'seg_0', sceneId: 'scn_1', index: 0, kind: 'narration', charStart: 0, charEnd: quoteStart },
      {
        id: 'seg_1',
        sceneId: 'scn_1',
        index: 1,
        kind: 'dialogue',
        charStart: quoteStart,
        charEnd: quoteEnd,
        speaker: { entityId: 'ent_1', surface: '林风', confidence: 0.9 },
        emotion: { type: 'calm', intensity: 0.2 },
      },
      { id: 'seg_2', sceneId: 'scn_1', index: 2, kind: 'narration', charStart: quoteEnd, charEnd: text.length },
    ],
    entities: [{ id: 'ent_1', type: 'character', canonicalName: '林风', aliases: [], isNew: true, confidence: 0.95 }],
    mentions: [{ entityId: 'ent_1', surface: '林风', charStart: 0, charEnd: 2 }],
    provenance: { pass: 'structure', attributor: 'test', promptVersion: 'test/0', normalizerVersion: '0.1' },
  };
}

function validate(input: ChapterIRInput, chapterText = text) {
  return validateChapterIR(ChapterIRSchema.parse(input), chapterText);
}

function codes(input: ChapterIRInput, chapterText = text): string[] {
  return validate(input, chapterText).errors.map((e) => e.code);
}

describe('validateChapterIR', () => {
  it('accepts a well formed chapter', () => {
    expect(validate(baseIR())).toEqual({ ok: true, errors: [] });
  });

  it('accepts an empty chapter with no scenes or segments', () => {
    const ir = { ...baseIR(), charCount: 0, scenes: [], segments: [], mentions: [] };
    expect(validate(ir, '').ok).toBe(true);
  });

  it('rejects charCount that disagrees with the text', () => {
    expect(codes({ ...baseIR(), charCount: text.length + 1 })).toContain('IR-LENGTH');
  });

  it('rejects a gap between segments', () => {
    const base = baseIR();
    const segments = base.segments.map((s, i) => (i === 1 ? { ...s, charStart: s.charStart + 1 } : s));
    expect(codes({ ...base, segments })).toContain('IR-SEG-COVER');
  });

  it('rejects segments that do not reach the end of the chapter', () => {
    const base = baseIR();
    const segments = base.segments.slice(0, 2);
    expect(codes({ ...base, segments })).toContain('IR-SEG-COVER');
  });

  it('rejects scenes that do not partition the chapter', () => {
    const base = baseIR();
    const scenes = [{ ...base.scenes[0]!, charEnd: text.length - 1 }];
    const result = codes({ ...base, scenes });
    expect(result).toContain('IR-SCENE-PARTITION');
    expect(result).toContain('IR-SEG-SCENE');
  });

  it('rejects dialogue without a speaker', () => {
    const base = baseIR();
    const segments = base.segments.map((s) => (s.kind === 'dialogue' ? { ...s, speaker: undefined } : s));
    expect(codes({ ...base, segments })).toContain('IR-DIALOGUE-SPEAKER');
  });

  it('rejects a mention whose surface does not match the text', () => {
    const base = baseIR();
    const mentions = [{ ...base.mentions[0]!, surface: '林风走' }];
    expect(codes({ ...base, mentions })).toContain('IR-MENTION-EVIDENCE');
  });

  it('rejects references to unknown scenes and entities', () => {
    const base = baseIR();
    const segments = base.segments.map((s, i) => (i === 0 ? { ...s, sceneId: 'scn_missing' } : s));
    const mentions = [{ ...base.mentions[0]!, entityId: 'ent_missing' }];
    const result = codes({ ...base, segments, mentions });
    expect(result.filter((c) => c === 'IR-REF')).toHaveLength(2);
  });

  it('rejects duplicate ids', () => {
    const base = baseIR();
    const segments = base.segments.map((s) => ({ ...s, id: 'seg_dup' }));
    expect(codes({ ...base, segments })).toContain('IR-UNIQUE');
  });

  it('rejects confidence outside the unit range at schema level', () => {
    const base = baseIR();
    const entities = [{ ...base.entities[0]!, confidence: 1.5 }];
    expect(() => ChapterIRSchema.parse({ ...base, entities })).toThrow();
  });
});

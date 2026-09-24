import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UNKNOWN_SPEAKER_SURFACE, validateChapterIR } from '@novelstruct/core';
import { normalizeNovel } from '@novelstruct/ingest';
import {
  createFakeLlmClient,
  createHeuristicAttributor,
  createLlmAttributor,
  LlmRequestRejectedError,
  runStructurePass,
} from '../src/index.js';
import { normalizeEntityType } from '../src/attribution/llm.js';

const fixture = new Uint8Array(readFileSync(new URL('../../ingest/test/fixtures/demo-novel.txt', import.meta.url)));
const chapterOne = normalizeNovel(fixture).chapters[1]!;

const base = {
  bookId: 'bk_1',
  editionId: 'ed_1',
  chapterId: 'chp_1',
  text: chapterOne.text,
  normalizerVersion: '0.1',
  knownEntities: [],
};

describe('runStructurePass with the heuristic attributor', () => {
  it('produces a valid, fully covering IR', async () => {
    const { ir, warnings } = await runStructurePass({ ...base, attributor: createHeuristicAttributor() });
    expect(validateChapterIR(ir, chapterOne.text)).toEqual({ ok: true, errors: [] });
    expect(warnings).toEqual([]);
    expect(ir.scenes).toHaveLength(1);
    expect(ir.segments.filter((s) => s.kind === 'dialogue')).toHaveLength(6);
    expect(ir.provenance).toMatchObject({
      pass: 'structure',
      attributor: 'heuristic',
      promptVersion: 'heuristic/0.3+quotes/0.2',
    });
  });

  it('resolves tagged speakers to new entities and marks untagged ones', async () => {
    const { ir } = await runStructurePass({ ...base, attributor: createHeuristicAttributor() });
    const dialogue = ir.segments.filter((s) => s.kind === 'dialogue');
    const tieLao = ir.entities.find((e) => e.canonicalName === '铁老');
    expect(tieLao?.isNew).toBe(true);
    expect(dialogue[1]?.speaker).toEqual({ entityId: tieLao?.id, surface: '铁老', confidence: 0.6 });
    expect(dialogue[0]?.speaker).toEqual({ surface: '他', confidence: 0.3 });
    expect(ir.mentions.some((m) => m.entityId === tieLao?.id)).toBe(true);
    expect(dialogue.filter((s) => s.speaker?.surface === UNKNOWN_SPEAKER_SURFACE)).toHaveLength(2);
  });
});

describe('runStructurePass with an LLM attributor', () => {
  const canned = JSON.stringify({
    quotes: [
      { id: 'q0', speaker: '沈青崖', kind: 'dialogue', confidence: 0.9, emotion: 'calm', intensity: 0.2 },
      { id: 1, speaker: '铁老', confidence: 0.95 },
      { id: 'q2', speaker: '沈青崖', kind: null, confidence: null },
      { id: 'q3', speaker: '铁老', confidence: 0.9, emotion: 'teasing', intensity: 0.4 },
      { id: 'q4', speaker: '顾小满', confidence: 0.95, emotion: 'anxious', intensity: 0.8 },
      { id: 'q5', speaker: '顾小满', confidence: 0.95, emotion: 'not-a-real-emotion' },
      { id: 'q9', speaker: '路人', confidence: 0.1 },
    ],
    entities: [
      { name: '沈青崖', type: '人物', aliases: ['青崖哥'], confidence: 0.95 },
      { name: '铁老', type: 'character', aliases: null, confidence: 0.9 },
      { name: '顾小满', type: 'Character', aliases: [], confidence: 0.9 },
      { name: '断水剑', type: 'item', aliases: [], confidence: 0.8 },
      { name: '铁匠铺', type: 'location', aliases: [], confidence: 0.7 },
      { name: '雨', type: '天气', aliases: [], confidence: 0.3 },
    ],
    scenes: [
      { startParagraph: 0, endParagraph: 5, location: '铁匠铺', timeHint: '雨天' },
      { startParagraph: 6, endParagraph: 8, location: '铁匠铺', summary: null },
    ],
  });

  it('splits scenes, attaches emotions and evidence, tolerates sloppy fields, and warns on the rest', async () => {
    const client = createFakeLlmClient('```json\n' + canned + '\n```', 'fake-model');
    const { ir, warnings, usage, model } = await runStructurePass({ ...base, attributor: createLlmAttributor(client) });

    expect(validateChapterIR(ir, chapterOne.text)).toEqual({ ok: true, errors: [] });
    expect(model).toBe('fake-model');
    expect(usage?.inputTokens).toBeGreaterThan(0);
    expect(warnings).toEqual([
      'llm returned unknown quote id 1',
      'llm returned unknown quote id q9',
      'llm left 1 quotes unattributed',
      'llm entity 雨 has unknown type 天气, skipped',
    ]);
    expect(client.requests[0]?.user).toContain('q0 (段落 1)');

    expect(ir.scenes.map((s) => s.location)).toEqual(['铁匠铺', '铁匠铺']);
    expect(ir.scenes[1]?.charStart).toBe(chapterOne.paragraphs[6]?.charStart);

    const shen = ir.entities.find((e) => e.canonicalName === '沈青崖')!;
    expect(shen.type).toBe('character');
    expect(shen.aliases).toEqual(['青崖哥']);
    expect(ir.mentions.filter((m) => m.entityId === shen.id).map((m) => m.surface)).toContain('青崖哥');

    const dialogue = ir.segments.filter((s) => s.kind === 'dialogue');
    expect(dialogue[0]?.speaker?.entityId).toBe(shen.id);
    expect(dialogue[0]?.emotion).toEqual({ type: 'calm', intensity: 0.2 });
    expect(dialogue[1]?.speaker?.surface).toBe(UNKNOWN_SPEAKER_SURFACE);
    expect(dialogue[2]?.speaker).toEqual({ entityId: shen.id, surface: '沈青崖', confidence: 0.5 });
    expect(dialogue[5]?.emotion).toBeUndefined();
    expect(ir.scenes[0]?.characterIds).toContain(shen.id);
    expect(ir.entities.map((e) => e.type).sort()).toEqual(['character', 'character', 'character', 'item', 'location']);
  });

  it('keeps one scene and repairs its incomplete end when it starts at paragraph zero', async () => {
    const broken = JSON.stringify({ quotes: [], entities: [], scenes: [{ startParagraph: 0, endParagraph: 2 }] });
    const { ir, warnings } = await runStructurePass({
      ...base,
      attributor: createLlmAttributor(createFakeLlmClient(broken)),
    });
    expect(ir.scenes).toHaveLength(1);
    expect(warnings).toEqual([
      'llm left 6 quotes unattributed',
      'scene proposals do not tile the chapter, repaired from start paragraphs',
    ]);
    expect(
      ir.segments.filter((s) => s.kind === 'dialogue').every((s) => s.speaker?.surface === UNKNOWN_SPEAKER_SURFACE),
    ).toBe(true);
  });

  it('repairs gaps and overlaps from distinct scene starts without losing their metadata', async () => {
    const end = chapterOne.paragraphs.length - 1;
    expect(end).toBeGreaterThan(6);
    for (const badEnd of [1, 6]) {
      const client = createFakeLlmClient(
        JSON.stringify({
          scenes: [
            { startParagraph: 0, endParagraph: badEnd, summary: '前一场' },
            { startParagraph: 5, endParagraph: end, summary: '后一场' },
          ],
        }),
      );
      const { ir, warnings } = await runStructurePass({ ...base, attributor: createLlmAttributor(client) });
      expect(validateChapterIR(ir, chapterOne.text)).toEqual({ ok: true, errors: [] });
      expect(ir.scenes.map((scene) => scene.summary)).toEqual(['前一场', '后一场']);
      expect(ir.scenes[0]?.charEnd).toBe(chapterOne.paragraphs[5]?.charStart);
      expect(ir.scenes[1]?.charStart).toBe(chapterOne.paragraphs[5]?.charStart);
      expect(warnings).toContain('scene proposals do not tile the chapter, repaired from start paragraphs');
    }
  });

  it('falls back when scene starts are missing, duplicated or outside the chapter', async () => {
    for (const starts of [
      [1, 5],
      [0, 0],
      [0, chapterOne.paragraphs.length],
    ]) {
      const { ir, warnings } = await runStructurePass({
        ...base,
        attributor: createLlmAttributor(
          createFakeLlmClient(
            JSON.stringify({
              scenes: starts.map((startParagraph) => ({ startParagraph, endParagraph: startParagraph })),
            }),
          ),
        ),
      });
      expect(ir.scenes).toHaveLength(1);
      expect(warnings).toContain('scene proposals do not tile the chapter, using a single scene');
    }
  });

  it('retries malformed JSON once, then reports response length and the syntax error context', async () => {
    const broken = '{"quotes":[{"id":"q0","speaker":"楚光" "kind":"dialogue"}]}';
    const notJson = createFakeLlmClient(broken);
    await expect(runStructurePass({ ...base, attributor: createLlmAttributor(notJson) })).rejects.toThrow(
      /LLM output is not JSON:.*response length: \d+ characters; near position \d+: .*楚光.*"kind".*gave up after 2 malformed JSON attempts/,
    );
    expect(notJson.requests).toHaveLength(2);
    expect(notJson.requests[1]).toEqual(notJson.requests[0]);
  });

  it('reports provider truncation when both malformed answers end at the output limit', async () => {
    const requests: string[] = [];
    const client = {
      model: 'fake-model',
      async completeJson(request: { user: string }) {
        requests.push(request.user);
        return { content: '{"quotes":[', finishReason: 'length' };
      },
    };
    await expect(runStructurePass({ ...base, attributor: createLlmAttributor(client) })).rejects.toThrow(
      /near position 11:.*finish_reason: length/,
    );
    expect(requests).toHaveLength(2);
  });

  it('uses a valid JSON response after one malformed answer', async () => {
    const requests: string[] = [];
    const client = {
      model: 'fake-model',
      async completeJson(request: { user: string }) {
        requests.push(request.user);
        return requests.length === 1
          ? { content: '{"quotes":[' }
          : { content: canned, usage: { inputTokens: 12, outputTokens: 3 } };
      },
    };
    const { ir, usage } = await runStructurePass({ ...base, attributor: createLlmAttributor(client) });
    expect(validateChapterIR(ir, chapterOne.text)).toEqual({ ok: true, errors: [] });
    expect(usage).toEqual({ inputTokens: 12, outputTokens: 3 });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(requests[0]);
  });

  it('rejects structurally broken JSON without retrying', async () => {
    const badShape = JSON.stringify({ quotes: 'q0 is 沈青崖' });
    const invalidShape = createFakeLlmClient(badShape);
    await expect(runStructurePass({ ...base, attributor: createLlmAttributor(invalidShape) })).rejects.toThrow(
      /schema/,
    );
    expect(invalidShape.requests).toHaveLength(1);
  });

  it('retries a provider risk rejection once and uses the successful answer', async () => {
    const requests: string[] = [];
    const client = {
      model: 'fake-model',
      async completeJson(request: { user: string }) {
        requests.push(request.user);
        return requests.length === 1
          ? { content: 'The request was rejected because it was considered high risk' }
          : { content: canned, usage: { inputTokens: 12, outputTokens: 3 } };
      },
    };
    const { ir, usage } = await runStructurePass({ ...base, attributor: createLlmAttributor(client) });
    expect(validateChapterIR(ir, chapterOne.text)).toEqual({ ok: true, errors: [] });
    expect(ir.provenance.model).toBe('fake-model');
    expect(usage).toEqual({ inputTokens: 12, outputTokens: 3 });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toBe(requests[0]);
  });

  it('distinguishes repeated provider risk rejections from malformed JSON answers', async () => {
    const client = createFakeLlmClient('The request was rejected because it was considered high risk');
    await expect(
      runStructurePass({
        ...base,
        attributor: createLlmAttributor(client),
      }),
    ).rejects.toBeInstanceOf(LlmRequestRejectedError);
    expect(client.requests).toHaveLength(2);
  });

  it('handles an empty chapter', async () => {
    const empty = JSON.stringify({ quotes: [], entities: [], scenes: [] });
    const { ir } = await runStructurePass({
      ...base,
      text: '',
      attributor: createLlmAttributor(createFakeLlmClient(empty)),
    });
    expect(ir).toMatchObject({ charCount: 0, scenes: [], segments: [], mentions: [] });
  });
});

describe('normalizeEntityType', () => {
  it('accepts the vocabulary in any case and common synonyms, rejects the rest', () => {
    expect(normalizeEntityType('Character')).toBe('character');
    expect(normalizeEntityType('人物')).toBe('character');
    expect(normalizeEntityType('宗门')).toBe('organization');
    expect(normalizeEntityType('天气')).toBeUndefined();
    expect(normalizeEntityType(null)).toBeUndefined();
  });
});

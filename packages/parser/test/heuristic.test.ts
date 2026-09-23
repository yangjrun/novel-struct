import { describe, expect, it } from 'vitest';
import type { KnownEntity } from '@novelstruct/core';
import { paragraphsFromText } from '@novelstruct/ingest';
import { createHeuristicAttributor, extractQuotes } from '../src/index.js';

async function attribute(text: string, knownEntities: readonly KnownEntity[] = []) {
  const paragraphs = paragraphsFromText(text);
  const { quotes } = extractQuotes(text, paragraphs);
  const result = await createHeuristicAttributor().attribute({ text, paragraphs, quotes, knownEntities });
  return { quotes, result };
}

describe('heuristic attributor', () => {
  it('uses the speech tag before a colon', async () => {
    const { result } = await attribute('铁老没有抬头，慢悠悠地说道：“修好了。”\n铁老又说。');
    expect(result.attributions[0]).toMatchObject({ quoteId: 'q0', speakerSurface: '铁老', confidence: 0.6 });
    expect(result.entities.map((e) => e.name)).toEqual(['铁老']);
  });

  it('uses the tag after the quote', async () => {
    const { result } = await attribute('“青崖哥！”顾小满喘着气，“石桥塌了！”\n顾小满跑了。');
    expect(result.attributions.map((a) => a.speakerSurface)).toEqual(['顾小满', '顾小满']);
  });

  it('prefers known entities and reports their canonical name', async () => {
    const known: KnownEntity[] = [{ id: 'ent_1', type: 'character', canonicalName: '沈青崖', aliases: ['青崖'] }];
    const { result } = await attribute('青崖低声说道：“走吧。”', known);
    expect(result.attributions[0]).toMatchObject({ speakerSurface: '沈青崖', confidence: 0.7 });
    expect(result.entities).toEqual([]);
  });

  it('falls back to a pronoun with low confidence', async () => {
    const { result } = await attribute('“剑修好了吗？”他问。');
    expect(result.attributions[0]).toMatchObject({ speakerSurface: '他', confidence: 0.3 });
  });

  it('gives up with confidence zero when there is no tag', async () => {
    const { result } = await attribute('“剑修好了吗？”\n雨还在下。');
    expect(result.attributions[0]).toEqual({ quoteId: 'q0', kind: 'dialogue', confidence: 0 });
  });

  it('does not invent a character from a name seen only once', async () => {
    const { result } = await attribute('门外传来一阵脚步声：“有人吗？”');
    expect(result.entities).toEqual([]);
  });

  it('proposes one scene covering every paragraph', async () => {
    const { result } = await attribute('第一段。\n第二段。\n第三段。');
    expect(result.scenes).toEqual([{ startParagraph: 0, endParagraph: 2 }]);
  });

  it('reads a bare label before a colon, chat or script style', async () => {
    const text = '楚光：“……”\n八级大狂风（管理员）：“这是什么幻想系设定吗？”\n楚光笑了。\n八级大狂风又说。';
    const { result } = await attribute(text);
    expect(result.attributions.map((a) => [a.speakerSurface, a.confidence])).toEqual([
      ['楚光', 0.6],
      ['八级大狂风', 0.6],
    ]);
    expect(result.entities.map((e) => e.name).sort()).toEqual(['八级大狂风', '楚光']);
  });

  it('uses a speech tag that closes the previous paragraph when the quote opens its own', async () => {
    const text = [
      '“活性物质提取器……这玩意儿到底是干什么用的？”',
      '小柒回答道。',
      '“活性物质是制作克隆体的原料。”',
      '楚光定了定神，说道。',
      '“我还以为奖品至少会用盒子装着。”',
      '小柒试着给出解释。',
      '“或许盲盒只是一种设定？”',
      '楚光继续问道。',
      '“具体是哪一年？”',
      '小柒回答。',
      '“2157年1月1日。”',
      '注意到他的动作，蹲在墙角的小柒问道。',
      '“主人，您要走了吗？”',
    ].join('\n');
    const { result } = await attribute(text);
    expect(result.attributions.map((a) => a.speakerSurface)).toEqual([
      undefined,
      '小柒',
      '楚光',
      '小柒',
      '楚光',
      '小柒',
      '小柒',
    ]);
    expect(result.attributions[1]?.confidence).toBe(0.6);
  });

  it('does not read narration that merely ends in 道 as a tag', async () => {
    const { result } = await attribute('他不知道。\n“谁？”\n他又说。');
    expect(result.attributions[0]?.speakerSurface).toBeUndefined();
  });

  it('treats name-plus-verb before a colon as a tag, not a label', async () => {
    const { result } = await attribute('铁老没有抬头，手里的锤子又落了三下，才慢悠悠地说道：“修好了。”\n铁老又说。');
    expect(result.attributions[0]).toMatchObject({ speakerSurface: '铁老', confidence: 0.6 });
    const second = await attribute('铁老说道：“好。”\n铁老又说。');
    expect(second.result.attributions[0]?.speakerSurface).toBe('铁老');
  });

  it('does not attribute a new quote to a different character named in the preceding speech tag', async () => {
    const known: KnownEntity[] = [
      { id: 'ent_chu', type: 'character', canonicalName: '楚光', aliases: [] },
      { id: 'ent_charlie', type: 'character', canonicalName: '查理', aliases: [] },
      { id: 'ent_fang', type: 'character', canonicalName: '方长', aliases: [] },
    ];
    const text = [
      '老查理咧嘴笑了笑，看着转身要走的楚光继续说道。',
      '“不过食物和燃料倒是有一些。”',
      '方长走上前来，说道：“有枪吗？”',
      '“我们该走了。”',
    ].join('\n');
    const { result } = await attribute(text, known);
    expect(result.attributions[0]?.speakerSurface).not.toBe('楚光');
    expect(result.attributions[1]?.speakerSurface).toBe('方长');
    expect(result.attributions[2]?.speakerSurface).toBeUndefined();
    expect(result.entities.map((entity) => entity.name)).not.toContain('看着');
  });

  it('does not invent speakers from participial narration and pronoun actions', async () => {
    const { result } = await attribute(
      [
        '楚光推开门。',
        '她眨了下眼，愉快地补了一句：“放心。”',
        '她眨了下眼。',
        '余虎也不拐弯抹角，直来直去道：“一起走？”',
        '余虎继续说。',
      ].join('\n'),
    );
    expect(result.entities.map((entity) => entity.name)).not.toContain('她眨了下');
    expect(result.attributions[1]?.speakerSurface).not.toBe('直来直去');
  });
});

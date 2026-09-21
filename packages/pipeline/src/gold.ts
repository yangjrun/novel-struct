import { z } from 'zod';
import { PipelineError } from './errors.js';

/**
 * One hand-labelled quote. `quote` is a substring of the quote's inner text (without the marks),
 * long enough to be unique within the chapter; `occurrence` picks one when it is not.
 */
export const GoldItemSchema = z.object({
  /** Heading number of the chapter, 第N章 → N. */
  chapter: z.number().int().positive(),
  quote: z.string().trim().min(1),
  /** Canonical speaker name. */
  speaker: z.string().trim().min(1),
  /** Other surfaces that count as correct, e.g. a nickname the text uses for the same person. */
  aliases: z.array(z.string().trim().min(1)).default([]),
  /** 1-based, among the chapter's quotes containing `quote`. Defaults to the only match. */
  occurrence: z.number().int().positive().optional(),
  note: z.string().optional(),
});

export type GoldItem = z.output<typeof GoldItemSchema>;

/**
 * Parses a JSON Lines gold set. Blank lines and lines starting with `#` are ignored, so the
 * file can carry a short header explaining its conventions.
 */
export function parseGoldSet(source: string): GoldItem[] {
  const items: GoldItem[] = [];
  source.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) return;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch (error) {
      throw new PipelineError('invalid_input', `金标第 ${i + 1} 行不是合法 JSON: ${(error as Error).message}`);
    }
    const parsed = GoldItemSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new PipelineError(
        'invalid_input',
        `金标第 ${i + 1} 行不合法: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim(),
      );
    }
    items.push(parsed.data);
  });
  if (items.length === 0) throw new PipelineError('invalid_input', '金标文件里没有任何条目');
  return items;
}

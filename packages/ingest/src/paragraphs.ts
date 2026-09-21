import type { NormalizedParagraph } from './types.js';

/**
 * Paragraph offsets for a normalized chapter text. Normalizer rule 0.1 joins paragraphs with a
 * single "\n", so this is the inverse of that join and can be recomputed from stored text.
 */
export function paragraphsFromText(text: string): NormalizedParagraph[] {
  if (text.length === 0) return [];
  const paragraphs: NormalizedParagraph[] = [];
  let charStart = 0;
  text.split('\n').forEach((line, index) => {
    paragraphs.push({ index, charStart, charEnd: charStart + line.length });
    charStart += line.length + 1;
  });
  return paragraphs;
}

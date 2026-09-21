import { type MentionIR, occurrences } from '@novelstruct/core';

export interface MentionTarget {
  readonly id: string;
  readonly names: readonly string[];
}

const MIN_NAME_LENGTH = 2;

/**
 * Every occurrence of every entity name in the text, longest match wins on overlap. Each mention
 * is evidence by construction: text.slice(charStart, charEnd) === surface.
 */
export function findMentions(text: string, targets: readonly MentionTarget[]): MentionIR[] {
  const candidates = targets.flatMap((t) =>
    t.names
      .filter((n) => n.length >= MIN_NAME_LENGTH)
      .flatMap((name) =>
        occurrences(text, name).map((charStart) => ({
          entityId: t.id,
          surface: name,
          charStart,
          charEnd: charStart + name.length,
        })),
      ),
  );
  const ordered = [...candidates].sort((a, b) => a.charStart - b.charStart || b.charEnd - a.charEnd);
  return ordered.reduce<MentionIR[]>((kept, m) => {
    const last = kept.at(-1);
    return last !== undefined && m.charStart < last.charEnd ? kept : [...kept, m];
  }, []);
}

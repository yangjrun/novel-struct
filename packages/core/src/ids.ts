import { randomUUID } from 'node:crypto';

export const ID_PREFIXES = {
  library: 'lib',
  universe: 'uni',
  series: 'ser',
  book: 'bk',
  edition: 'ed',
  volume: 'vol',
  chapter: 'chp',
  scene: 'scn',
  segment: 'seg',
  entity: 'ent',
  alias: 'als',
  mention: 'men',
  sourceRef: 'src',
  parseRun: 'run',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

/** Prefixed random id, e.g. `chp_3f1c…`. The prefix keeps logs and IR documents readable. */
export function newId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}_${randomUUID()}`;
}

export function isIdOfKind(kind: IdKind, value: string): boolean {
  const prefix = `${ID_PREFIXES[kind]}_`;
  return value.startsWith(prefix) && value.length > prefix.length;
}

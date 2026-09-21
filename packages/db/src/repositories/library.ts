import { newId } from '@novelstruct/core';
import type { Db } from '../client.js';
import { libraries } from '../schema/index.js';

export const DEFAULT_LIBRARY_NAME = '默认小说库';

/** Returns the oldest library, creating the default one on first use. */
export async function ensureDefaultLibrary(db: Db): Promise<string> {
  const existing = await db.select({ id: libraries.id }).from(libraries).orderBy(libraries.createdAt).limit(1);
  const found = existing[0];
  if (found !== undefined) return found.id;
  const id = newId('library');
  await db.insert(libraries).values({ id, name: DEFAULT_LIBRARY_NAME });
  return id;
}

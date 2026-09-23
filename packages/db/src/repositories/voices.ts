import { and, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { entities, voiceProfiles } from '../schema/index.js';

export async function setVoiceProfile(
  db: Db,
  input: {
    bookId: string;
    entityId: string;
    provider: string;
    voiceId: string;
    params?: Record<string, string | number | boolean>;
  },
): Promise<void> {
  if (!input.provider.trim() || !input.voiceId.trim()) throw new Error('声音服务和 voiceId 不能为空');
  const entity = (
    await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.id, input.entityId), eq(entities.bookId, input.bookId), eq(entities.type, 'character')))
      .limit(1)
  )[0];
  if (!entity) throw new Error('角色实体不属于本书');
  await db
    .insert(voiceProfiles)
    .values({
      bookId: input.bookId,
      entityId: input.entityId,
      provider: input.provider,
      voiceId: input.voiceId,
      params: input.params ? JSON.stringify(input.params) : null,
    })
    .onConflictDoUpdate({
      target: voiceProfiles.entityId,
      set: {
        provider: input.provider,
        voiceId: input.voiceId,
        params: input.params ? JSON.stringify(input.params) : null,
      },
    });
}

export async function listVoiceProfiles(db: Db, bookId: string) {
  return db
    .select({
      entityId: voiceProfiles.entityId,
      provider: voiceProfiles.provider,
      voiceId: voiceProfiles.voiceId,
      params: voiceProfiles.params,
    })
    .from(voiceProfiles)
    .where(eq(voiceProfiles.bookId, bookId))
    .orderBy(voiceProfiles.entityId);
}

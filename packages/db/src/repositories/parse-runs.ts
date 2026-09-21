import { and, eq, isNull } from 'drizzle-orm';
import { newId, type ParsePass } from '@novelstruct/core';
import type { Db } from '../client.js';
import { parseRuns } from '../schema/index.js';

export interface StartParseRunInput {
  readonly editionId: string;
  readonly chapterId: string;
  readonly pass: ParsePass;
  readonly attributor: string;
  readonly promptVersion: string;
  readonly model?: string;
}

export interface FinishParseRunInput {
  readonly status: 'succeeded' | 'failed';
  readonly error?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface ParseRunKey {
  readonly pass: ParsePass;
  readonly attributor: string;
  readonly promptVersion: string;
  readonly model?: string;
}

/** True when the chapter already has a successful run with the same pass, attributor, prompt and model. */
export async function hasSucceededRun(db: Db, chapterId: string, key: ParseRunKey): Promise<boolean> {
  const rows = await db
    .select({ id: parseRuns.id })
    .from(parseRuns)
    .where(
      and(
        eq(parseRuns.chapterId, chapterId),
        eq(parseRuns.status, 'succeeded'),
        eq(parseRuns.pass, key.pass),
        eq(parseRuns.attributor, key.attributor),
        eq(parseRuns.promptVersion, key.promptVersion),
        key.model === undefined ? isNull(parseRuns.model) : eq(parseRuns.model, key.model),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function startParseRun(db: Db, input: StartParseRunInput): Promise<string> {
  const id = newId('parseRun');
  await db.insert(parseRuns).values({
    id,
    editionId: input.editionId,
    chapterId: input.chapterId,
    pass: input.pass,
    attributor: input.attributor,
    promptVersion: input.promptVersion,
    model: input.model ?? null,
    status: 'running',
  });
  return id;
}

export async function finishParseRun(db: Db, runId: string, input: FinishParseRunInput): Promise<void> {
  await db
    .update(parseRuns)
    .set({
      status: input.status,
      error: input.error ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      finishedAt: new Date(),
    })
    .where(eq(parseRuns.id, runId));
}

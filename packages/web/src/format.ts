import type { JobDto, JobStatusDto, ParseRunStatus } from '@novelstruct/api/contracts';

export const JOB_STATUS_LABEL: Record<JobStatusDto, string> = {
  queued: '排队中',
  running: '运行中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
};

export const RUN_STATUS_LABEL: Record<ParseRunStatus, string> = {
  pending: '等待',
  running: '运行中',
  succeeded: '成功',
  failed: '失败',
  interrupted: '已中断',
};

/** Runs that ended without a result and need another attempt. */
export function isRunUnfinished(status: ParseRunStatus): boolean {
  return status === 'failed' || status === 'interrupted';
}

export const CHAPTER_KIND_LABEL: Record<string, string> = {
  chapter: '正文',
  prologue: '序章',
  extra: '番外',
  front_matter: '前言',
  note: '作者的话',
};

export const ENTITY_TYPE_LABEL: Record<string, string> = {
  character: '角色',
  location: '地点',
  organization: '组织',
  item: '物品',
  skill: '功法',
  realm: '境界',
  species: '种族',
  concept: '概念',
  event: '事件',
};

export function isJobActive(job: JobDto): boolean {
  return job.status === 'queued' || job.status === 'running';
}

/** Completed chapters over planned chapters, in percent, for a progress bar. */
export function jobProgress(job: JobDto): number {
  if (job.total === 0) return 100;
  return Math.round((job.events.length / job.total) * 100);
}

export function formatTime(iso: string | null): string {
  if (iso === null) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false });
}

export function formatCount(n: number): string {
  return n.toLocaleString('zh-CN');
}

/** A cost in the pricing currency; a dash when no prices are configured. Small amounts keep four decimals. */
export function formatCost(cost: number | null, currency: string | undefined): string {
  if (cost === null || currency === undefined) return '—';
  return `${cost.toFixed(cost < 1 ? 4 : 2)} ${currency}`;
}

export function chapterLabel(chapter: { index: number; title: string | null; kind: string }): string {
  return `[${chapter.index}] ${chapter.title ?? CHAPTER_KIND_LABEL[chapter.kind] ?? chapter.kind}`;
}

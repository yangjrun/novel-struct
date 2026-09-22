<script setup lang="ts">
import { computed, ref } from 'vue';
import type { JobDto } from '@novelstruct/api/contracts';
import { api } from '../api.js';
import ErrorBanner from '../components/ErrorBanner.vue';
import JobCard from '../components/JobCard.vue';
import ParseForm from '../components/ParseForm.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { useAsync, usePolling } from '../composables.js';
import {
  CHAPTER_KIND_LABEL,
  formatCount,
  formatTime,
  isJobActive,
  isRunUnfinished,
  RUN_STATUS_LABEL,
} from '../format.js';

const props = defineProps<{ editionId: string }>();

const config = useAsync(() => api.config());
const edition = useAsync(() => api.edition(props.editionId));
const jobs = useAsync(async () => (await api.jobs()).filter((j) => j.editionId === props.editionId));
const filter = ref<'all' | 'parsed' | 'unparsed' | 'failed'>('all');

const activeJobs = computed(() => (jobs.data.value ?? []).filter(isJobActive));
const recentJobs = computed(() => (jobs.data.value ?? []).slice(0, 5));

const stats = computed(() => {
  const chapters = edition.data.value?.chapters ?? [];
  const parsed = chapters.filter((c) => c.segmentCount > 0).length;
  const failed = chapters.filter((c) => c.latestRun !== null && isRunUnfinished(c.latestRun.status)).length;
  const chars = chapters.reduce((sum, c) => sum + c.charCount, 0);
  return { total: chapters.length, parsed, failed, chars };
});

const visibleChapters = computed(() => {
  const chapters = edition.data.value?.chapters ?? [];
  switch (filter.value) {
    case 'parsed':
      return chapters.filter((c) => c.segmentCount > 0);
    case 'unparsed':
      return chapters.filter((c) => c.segmentCount === 0);
    case 'failed':
      return chapters.filter((c) => c.latestRun !== null && isRunUnfinished(c.latestRun.status));
    default:
      return chapters;
  }
});

usePolling(
  async () => {
    await jobs.reload();
    await edition.reload();
  },
  () => activeJobs.value.length > 0,
  1500,
);

async function onStarted(_job: JobDto): Promise<void> {
  await jobs.reload();
}
</script>

<template>
  <div class="stack">
    <p class="crumbs"><RouterLink to="/">小说库</RouterLink> / 版本</p>
    <ErrorBanner :message="edition.error.value" />

    <template v-if="edition.data.value">
      <div class="page-head">
        <div>
          <h1>{{ edition.data.value.book.title }}</h1>
          <p class="meta">
            {{ edition.data.value.book.author ?? '佚名' }} · 版本 {{ edition.data.value.edition.label }} ·
            {{ edition.data.value.edition.sourceFormat }} / {{ edition.data.value.edition.sourceEncoding }} · 导入于
            {{ formatTime(edition.data.value.edition.createdAt) }}
          </p>
          <p class="mono muted small">{{ editionId }}</p>
        </div>
        <div class="row">
          <RouterLink class="btn" :to="{ name: 'entities', params: { editionId } }">实体</RouterLink>
          <a class="btn" :href="api.reportUrl(editionId)" target="_blank" rel="noopener">HTML 报告</a>
          <button type="button" :disabled="edition.loading.value" @click="edition.reload()">刷新</button>
        </div>
      </div>

      <div class="kpis">
        <div class="card">
          <p class="tile-label">章节</p>
          <p class="tile-value">{{ formatCount(stats.total) }}</p>
          <p class="tile-sub">{{ formatCount(stats.chars) }} 字</p>
        </div>
        <div class="card">
          <p class="tile-label">已解析</p>
          <p class="tile-value">{{ formatCount(stats.parsed) }}</p>
          <div class="meter">
            <span :style="{ width: `${stats.total === 0 ? 0 : (stats.parsed / stats.total) * 100}%` }"></span>
          </div>
        </div>
        <div class="card">
          <p class="tile-label">最近一次失败</p>
          <p class="tile-value">{{ formatCount(stats.failed) }}</p>
          <p class="tile-sub">章节的最新解析记录为失败</p>
        </div>
        <div class="card">
          <p class="tile-label">运行中任务</p>
          <p class="tile-value">{{ activeJobs.length }}</p>
          <p class="tile-sub"><RouterLink to="/jobs">查看全部任务</RouterLink></p>
        </div>
      </div>

      <ParseForm
        :edition-id="editionId"
        :chapter-count="stats.total"
        :config="config.data.value"
        @started="onStarted"
      />

      <section v-if="recentJobs.length > 0" class="stack">
        <h2>最近任务</h2>
        <JobCard v-for="job in recentJobs" :key="job.id" :job="job" @changed="jobs.reload()" />
      </section>

      <section class="card stack">
        <div class="row">
          <h2 style="margin: 0">章节</h2>
          <span class="spacer" style="flex: 1"></span>
          <label class="field inline">
            筛选
            <select v-model="filter">
              <option value="all">全部</option>
              <option value="parsed">已解析</option>
              <option value="unparsed">未解析</option>
              <option value="failed">最近失败或中断</option>
            </select>
          </label>
        </div>
        <p v-if="visibleChapters.length === 0" class="empty">没有符合条件的章节。</p>
        <table v-else>
          <thead>
            <tr>
              <th class="num">index</th>
              <th>类型</th>
              <th>标题</th>
              <th class="num">字数</th>
              <th class="num">分段</th>
              <th>最新解析</th>
              <th>归属器</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="chapter in visibleChapters" :key="chapter.id">
              <td class="num">{{ chapter.index }}</td>
              <td class="secondary">{{ CHAPTER_KIND_LABEL[chapter.kind] ?? chapter.kind }}</td>
              <td>
                <RouterLink :to="{ name: 'chapter', params: { editionId, index: chapter.index } }">
                  {{ chapter.title ?? (chapter.number === null ? '（无标题）' : `第 ${chapter.number} 章`) }}
                </RouterLink>
              </td>
              <td class="num">{{ formatCount(chapter.charCount) }}</td>
              <td class="num">{{ chapter.segmentCount === 0 ? '' : formatCount(chapter.segmentCount) }}</td>
              <td>
                <StatusBadge
                  v-if="chapter.latestRun"
                  :status="chapter.latestRun.status"
                  :label="RUN_STATUS_LABEL[chapter.latestRun.status]"
                />
                <span v-else class="muted">未解析</span>
              </td>
              <td class="secondary">
                {{ chapter.latestRun?.attributor ?? '' }}
                <span v-if="chapter.latestRun?.model" class="muted">/ {{ chapter.latestRun.model }}</span>
              </td>
              <td class="muted small">
                {{ formatTime(chapter.latestRun?.finishedAt ?? chapter.latestRun?.startedAt ?? null) }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
    <p v-else-if="edition.loading.value" class="muted">加载中…</p>
  </div>
</template>

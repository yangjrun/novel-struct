<script setup lang="ts">
import { computed } from 'vue';
import { api } from '../api.js';
import ErrorBanner from '../components/ErrorBanner.vue';
import JobCard from '../components/JobCard.vue';
import { useAsync, usePolling } from '../composables.js';
import { isJobActive } from '../format.js';

const jobs = useAsync(() => api.jobs());
const hasActive = computed(() => (jobs.data.value ?? []).some(isJobActive));

usePolling(
  () => jobs.reload(),
  () => hasActive.value,
  1500,
);
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1>解析任务</h1>
        <p class="meta">任务在 API 进程内串行执行，只保留在内存里；重启服务后列表清空，解析结果本身已写入数据库。</p>
      </div>
      <button type="button" :disabled="jobs.loading.value" @click="jobs.reload()">刷新</button>
    </div>
    <ErrorBanner :message="jobs.error.value" />
    <template v-if="jobs.data.value">
      <p v-if="jobs.data.value.length === 0" class="empty card">还没有任务。到某个版本页发起解析。</p>
      <JobCard v-for="job in jobs.data.value" :key="job.id" :job="job" show-edition @changed="jobs.reload()" />
    </template>
    <p v-else-if="jobs.loading.value" class="muted">加载中…</p>
  </div>
</template>

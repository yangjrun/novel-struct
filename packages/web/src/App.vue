<script setup lang="ts">
import { api } from './api.js';
import { useAsync } from './composables.js';

const config = useAsync(() => api.config());
</script>

<template>
  <header class="topbar">
    <RouterLink to="/" class="brand">NovelStruct</RouterLink>
    <nav>
      <RouterLink to="/">小说库</RouterLink>
      <RouterLink to="/jobs">任务</RouterLink>
    </nav>
    <span class="spacer"></span>
    <span v-if="config.data.value" class="env">
      数据库 {{ config.data.value.database }} · 队列 {{ config.data.value.queue === 'bullmq' ? 'BullMQ' : '进程内' }} ·
      {{ config.data.value.llmConfigured ? `模型 ${config.data.value.llmModel}` : '未配置模型，只能用启发式归属' }}
    </span>
    <span v-else-if="config.error.value" class="env">{{ config.error.value }}</span>
  </header>
  <main>
    <RouterView />
  </main>
</template>

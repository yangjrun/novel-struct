<script setup lang="ts">
import { ref } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import { api, setApiToken, storedToken } from './api.js';
import { useAsync } from './composables.js';

const config = useAsync(() => api.config());
const token = ref(storedToken);
async function connect(): Promise<void> {
  setApiToken(token.value);
  await config.reload();
}

function pageKey(route: RouteLocationNormalizedLoaded): string {
  const params = Object.entries(route.params).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([String(route.name ?? ''), params]);
}
</script>

<template>
  <header class="topbar">
    <RouterLink to="/" class="brand">NovelStruct</RouterLink>
    <nav>
      <RouterLink to="/">小说库</RouterLink>
      <RouterLink to="/jobs">任务</RouterLink>
      <RouterLink to="/usage">用量</RouterLink>
      <RouterLink to="/search">检索</RouterLink>
    </nav>
    <span class="spacer"></span>
    <span v-if="config.data.value" class="env">
      数据库 {{ config.data.value.database }} · 队列 {{ config.data.value.queue === 'bullmq' ? 'BullMQ' : '进程内' }} ·
      {{ config.data.value.llmConfigured ? `模型 ${config.data.value.llmModel}` : '未配置模型，只能用启发式归属' }}
    </span>
    <span v-else-if="config.error.value" class="env">{{ config.error.value }}</span>
  </header>
  <main>
    <section v-if="config.error.value" class="card stack">
      <h1>连接 API</h1>
      <p class="secondary">{{ config.error.value }}</p>
      <form class="inline-form" @submit.prevent="connect">
        <label class="field">API 访问令牌 <input v-model="token" type="password" autocomplete="off" /></label>
        <button type="submit">连接</button>
      </form>
    </section>
    <RouterView v-else-if="config.data.value" v-slot="{ Component, route }">
      <component :is="Component" :key="pageKey(route)" />
    </RouterView>
  </main>
</template>

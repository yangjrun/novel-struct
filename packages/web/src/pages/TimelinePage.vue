<script setup lang="ts">
import { api } from '../api.js';
import ErrorBanner from '../components/ErrorBanner.vue';
import { useAsync } from '../composables.js';

const props = defineProps<{ editionId: string }>();
const timeline = useAsync(() => api.timeline(props.editionId));
</script>

<template>
  <div class="stack">
    <p class="crumbs">
      <RouterLink to="/">小说库</RouterLink> /
      <RouterLink :to="{ name: 'edition', params: { editionId } }">版本</RouterLink> / 时间线
    </p>
    <h1>故事时间线</h1>
    <p class="secondary">按读者看到的章节顺序排列，故事内时间另列；回忆、插叙不会被误排成章节顺序。</p>
    <ErrorBanner :message="timeline.error.value" />
    <section class="card">
      <p v-if="timeline.data.value?.length === 0" class="empty">暂无事件。完成一致性遍后会显示在这里。</p>
      <table v-else-if="timeline.data.value">
        <thead>
          <tr>
            <th>章节</th>
            <th>故事时间</th>
            <th>类型</th>
            <th>角色</th>
            <th>事件</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in timeline.data.value" :key="event.id">
            <td>
              <RouterLink :to="{ name: 'chapter', params: { editionId, index: event.chapterIndex } }">{{
                event.chapterTitle ?? `第 ${event.chapterIndex} 章`
              }}</RouterLink>
            </td>
            <td>{{ event.storyTime ?? '未标注' }}</td>
            <td>{{ event.type }}</td>
            <td>{{ event.actor ?? '—' }}</td>
            <td>{{ event.summary }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

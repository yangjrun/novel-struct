<script setup lang="ts">
import { ref } from 'vue';
import { api, errorMessage } from '../api.js';
import ErrorBanner from '../components/ErrorBanner.vue';
import { useAsync } from '../composables.js';

const props = defineProps<{ bookId: string }>();
const reviews = useAsync(() => api.reviews(props.bookId));
const actionError = ref<string | null>(null);
async function finish(id: string, status: 'approved' | 'rejected'): Promise<void> {
  actionError.value = null;
  try {
    await api.finishReview(props.bookId, id, status);
    await reviews.reload();
  } catch (error) {
    actionError.value = errorMessage(error);
  }
}
</script>

<template>
  <div class="stack">
    <p class="crumbs"><RouterLink to="/">小说库</RouterLink> / 复核队列</p>
    <h1>人工复核</h1>
    <ErrorBanner :message="reviews.error.value ?? actionError" />
    <section class="card">
      <p v-if="reviews.data.value?.length === 0" class="empty">暂无待复核事实。</p>
      <table v-else-if="reviews.data.value">
        <thead>
          <tr>
            <th>类型</th>
            <th>目标</th>
            <th>原因</th>
            <th>置信度</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in reviews.data.value" :key="item.id">
            <td>{{ item.kind }}</td>
            <td class="mono">{{ item.targetId }}</td>
            <td>{{ item.reason }}</td>
            <td>{{ item.confidence.toFixed(2) }}</td>
            <td>{{ item.status }}</td>
            <td>
              <template v-if="item.status === 'pending'"
                ><button type="button" class="small" @click="finish(item.id, 'approved')">认可</button>
                <button type="button" class="small" @click="finish(item.id, 'rejected')">驳回</button></template
              >
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

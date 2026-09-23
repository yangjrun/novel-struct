<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SceneSearchResultDto } from '@novelstruct/api/contracts';
import { api, errorMessage } from '../api.js';
import ErrorBanner from '../components/ErrorBanner.vue';
import { useAsync } from '../composables.js';

const books = useAsync(() => api.books());
const config = useAsync(() => api.config());
const query = ref('');
const selected = ref<string[]>([]);
const results = ref<SceneSearchResultDto[]>([]);
const error = ref<string | null>(null);
const loading = ref(false);
const selectedBooks = computed(() => books.data.value?.filter((book) => selected.value.includes(book.id)) ?? []);

async function search(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    results.value = await api.search(query.value, selected.value);
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="stack">
    <h1>跨书场景检索</h1>
    <p class="secondary">选择要检索的书，按场景语义查找；结果指向规范化原文偏移。</p>
    <ErrorBanner :message="books.error.value ?? config.error.value ?? error" />
    <p v-if="config.data.value && !config.data.value.embeddingConfigured" class="notice">
      检索需要先配置 EMBEDDING_API_KEY 和 EMBEDDING_MODEL，并在版本页索引场景。
    </p>
    <form class="card stack" @submit.prevent="search">
      <label class="field"
        >检索词 <input v-model="query" type="text" required maxlength="500" placeholder="例如：石桥上的相遇"
      /></label>
      <fieldset class="book-picker">
        <legend>检索范围（至少一本）</legend>
        <label v-for="book in books.data.value" :key="book.id" class="row"
          ><input v-model="selected" type="checkbox" :value="book.id" />{{ book.title }}</label
        >
      </fieldset>
      <p class="small secondary">已选 {{ selectedBooks.length }} 本书</p>
      <button
        class="primary"
        type="submit"
        :disabled="loading || selected.length === 0 || !config.data.value?.embeddingConfigured"
      >
        {{ loading ? '检索中…' : '检索' }}
      </button>
    </form>
    <section v-if="results.length" class="stack">
      <h2>结果</h2>
      <article v-for="result in results" :key="result.sceneId" class="card stack">
        <RouterLink
          :to="{
            name: 'chapter',
            params: { editionId: result.editionId, index: result.chapterIndex },
            query: { offset: result.charStart },
          }"
        >
          {{ result.bookTitle }} · {{ result.editionLabel }} ·
          {{ result.chapterTitle ?? `第 ${result.chapterIndex} 章` }} · 场景 {{ result.sceneIndex }}
        </RouterLink>
        <p class="small muted">
          相似度 {{ result.similarity.toFixed(3) }} · 原文偏移 {{ result.charStart }}–{{ result.charEnd }}
        </p>
        <p class="excerpt">{{ result.excerpt }}</p>
      </article>
    </section>
    <p v-else-if="!loading" class="muted">没有结果。请确认所选版本已解析并索引。</p>
  </div>
</template>

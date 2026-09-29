<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { SceneSearchResultDto, WeKnoraSearchDto } from '@novelstruct/api/contracts';
import { api, errorMessage } from '../api.js';
import ErrorBanner from '../components/ErrorBanner.vue';
import { useAsync } from '../composables.js';

const books = useAsync(() => api.books());
const config = useAsync(() => api.config());
const route = useRoute();
const source = ref<'scenes' | 'weknora'>(route.query['source'] === 'weknora' ? 'weknora' : 'scenes');
const choseSource = ref(route.query['source'] !== undefined);
const query = ref('');
const selected = ref<string[]>(typeof route.query['book'] === 'string' ? [route.query['book']] : []);
const results = ref<SceneSearchResultDto[]>([]);
const knowledge = ref<WeKnoraSearchDto | null>(null);
const searched = ref(false);
const error = ref<string | null>(null);
const loading = ref(false);
const selectedBooks = computed(() => books.data.value?.filter((book) => selected.value.includes(book.id)) ?? []);
const configured = computed(() =>
  source.value === 'weknora' ? config.data.value?.weknoraConfigured : config.data.value?.embeddingConfigured,
);
watch(
  () => config.data.value,
  (value) => {
    if (value?.weknoraConfigured && !choseSource.value) source.value = 'weknora';
  },
);
watch(
  [source, query, selected],
  () => {
    results.value = [];
    knowledge.value = null;
    searched.value = false;
    error.value = null;
  },
  { deep: true },
);

async function search(): Promise<void> {
  if (loading.value || !query.value.trim() || !selected.value.length || !configured.value) return;
  loading.value = true;
  error.value = null;
  results.value = [];
  knowledge.value = null;
  searched.value = false;
  try {
    if (source.value === 'weknora') knowledge.value = await api.searchWeKnora(query.value, selected.value);
    else results.value = await api.search(query.value, selected.value);
    searched.value = true;
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="stack">
    <h1>跨书检索</h1>
    <p class="secondary">选择书籍和检索来源，查找片段并返回原文章节。</p>
    <ErrorBanner :message="books.error.value ?? config.error.value ?? error" />
    <p v-if="config.data.value && !configured" class="notice">
      {{
        source === 'weknora'
          ? 'WeKnora 尚未配置，请在服务端配置地址和凭据后重启 API。'
          : '场景检索需要先配置 EMBEDDING_API_KEY 和 EMBEDDING_MODEL，并在版本页索引场景。'
      }}
    </p>
    <form class="card stack" @submit.prevent="search">
      <label class="field"
        >检索来源
        <select v-model="source" :disabled="loading" @change="choseSource = true">
          <option value="weknora">WeKnora · 正文混合检索</option>
          <option value="scenes">场景语义检索</option>
        </select>
      </label>
      <label class="field"
        >检索词
        <input
          v-model="query"
          type="text"
          :disabled="loading"
          required
          maxlength="500"
          placeholder="例如：石桥上的相遇"
      /></label>
      <fieldset class="book-picker" :disabled="loading">
        <legend>检索范围（至少一本）</legend>
        <label v-for="book in books.data.value" :key="book.id" class="row"
          ><input v-model="selected" type="checkbox" :value="book.id" />{{ book.title }}</label
        >
      </fieldset>
      <p v-if="books.loading.value" class="muted">正在加载书籍…</p>
      <p v-else-if="books.data.value?.length === 0" class="muted">小说库为空，请先导入一本书。</p>
      <p class="small secondary">已选 {{ selectedBooks.length }} 本书</p>
      <p v-if="source === 'weknora'" class="small secondary">
        检索已同步并完成解析的正文；在书籍版本页可查看状态和同步章节。
      </p>
      <button
        class="primary"
        type="submit"
        :disabled="loading || selected.length === 0 || !query.trim() || !configured"
      >
        {{ loading ? '检索中…' : '检索' }}
      </button>
    </form>
    <p v-if="loading" role="status" class="muted">正在检索所选书籍…</p>
    <div v-if="knowledge?.skippedEditions.length" class="notice stack">
      <p>以下版本尚未同步，本次未检索：</p>
      <div class="row">
        <RouterLink
          v-for="edition in knowledge.skippedEditions"
          :key="edition.editionId"
          :to="{ name: 'edition', params: { editionId: edition.editionId } }"
        >
          {{ edition.bookTitle }} · {{ edition.editionLabel }}
        </RouterLink>
      </div>
    </div>
    <section v-if="knowledge?.results.length" class="stack" aria-live="polite">
      <h2>WeKnora 结果（{{ knowledge.results.length }}）</h2>
      <article v-for="result in knowledge.results" :key="`${result.editionId}:${result.chunkId}`" class="card stack">
        <RouterLink
          :to="{
            name: 'chapter',
            params: { editionId: result.editionId, index: result.chapterIndex },
            query: result.charStart === null ? { raw: '1' } : { raw: '1', offset: result.charStart },
          }"
        >
          {{ result.bookTitle }} · {{ result.editionLabel }} ·
          {{ result.chapterTitle ?? `第 ${result.chapterIndex} 章` }}
        </RouterLink>
        <p class="small muted">
          相关度 {{ result.score.toFixed(3) }} ·
          {{
            result.charStart === null
              ? '片段未能唯一定位，可打开章节核对'
              : `原文偏移 ${result.charStart}–${result.charEnd}`
          }}
        </p>
        <p class="excerpt">{{ result.excerpt }}</p>
      </article>
    </section>
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
    <p v-if="searched && !loading && !results.length && !knowledge?.results.length" class="muted">
      {{
        source === 'weknora'
          ? '没有匹配结果。请确认相关章节已同步并完成解析，或尝试其他检索词。'
          : '没有匹配结果。请确认所选版本已解析并索引，或尝试其他检索词。'
      }}
    </p>
  </div>
</template>

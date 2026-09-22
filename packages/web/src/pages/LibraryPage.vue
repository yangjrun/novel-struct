<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import type { BookDto, ImportResultDto } from '@novelstruct/api/contracts';
import { api, errorMessage } from '../api.js';
import ErrorBanner from '../components/ErrorBanner.vue';
import ImportForm from '../components/ImportForm.vue';
import { useAsync } from '../composables.js';
import { formatCount } from '../format.js';

const router = useRouter();
const books = useAsync(() => api.books());
const deleting = ref<string | null>(null);
const deleteError = ref<string | null>(null);

async function onImported(result: ImportResultDto): Promise<void> {
  await router.push({ name: 'edition', params: { editionId: result.editionId } });
}

async function onDelete(book: BookDto): Promise<void> {
  if (!window.confirm(`删除《${book.title}》及其全部版本、解析结果和实体？不可恢复。`)) return;
  deleting.value = book.id;
  deleteError.value = null;
  try {
    await api.deleteBook(book.id);
    await books.reload();
  } catch (error) {
    deleteError.value = errorMessage(error);
  } finally {
    deleting.value = null;
  }
}
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1>小说库</h1>
        <p class="meta">每本书可以有多个版本，解析、报告和实体都挂在版本上。</p>
      </div>
      <button type="button" :disabled="books.loading.value" @click="books.reload()">刷新</button>
    </div>

    <ImportForm @imported="onImported" />
    <ErrorBanner :message="books.error.value" />
    <ErrorBanner :message="deleteError" />

    <section v-if="books.data.value" class="card">
      <p v-if="books.data.value.length === 0" class="empty">小说库为空，先在上方导入一本 TXT。</p>
      <table v-else>
        <thead>
          <tr>
            <th>书名</th>
            <th>作者</th>
            <th>版本</th>
            <th class="num">章数</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="book in books.data.value" :key="book.id">
            <tr v-for="(edition, i) in book.editions" :key="edition.id">
              <td>
                <strong v-if="i === 0">{{ book.title }}</strong>
                <span v-else class="muted">同上</span>
                <button
                  v-if="i === 0"
                  type="button"
                  class="small danger"
                  :disabled="deleting === book.id"
                  @click="onDelete(book)"
                >
                  删除
                </button>
              </td>
              <td>{{ i === 0 ? (book.author ?? '') : '' }}</td>
              <td>
                <RouterLink :to="{ name: 'edition', params: { editionId: edition.id } }">{{
                  edition.label
                }}</RouterLink>
                <span class="mono muted"> {{ edition.id }}</span>
              </td>
              <td class="num">{{ formatCount(edition.chapterCount) }}</td>
              <td class="num">
                <RouterLink :to="{ name: 'edition', params: { editionId: edition.id } }">章节</RouterLink>
                ·
                <RouterLink :to="{ name: 'entities', params: { editionId: edition.id } }">实体</RouterLink>
                ·
                <a :href="api.reportUrl(edition.id)" target="_blank" rel="noopener">报告</a>
              </td>
            </tr>
            <tr v-if="book.editions.length === 0">
              <td>
                <strong>{{ book.title }}</strong>
                <button type="button" class="small danger" :disabled="deleting === book.id" @click="onDelete(book)">
                  删除
                </button>
              </td>
              <td>{{ book.author ?? '' }}</td>
              <td colspan="3" class="muted">没有版本</td>
            </tr>
          </template>
        </tbody>
      </table>
    </section>
    <p v-else-if="books.loading.value" class="muted">加载中…</p>
  </div>
</template>

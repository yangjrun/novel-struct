<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ChapterRowDto, WeKnoraSyncResultDto } from '@novelstruct/api/contracts';
import { api, errorMessage } from '../api.js';
import { useAsync, usePolling } from '../composables.js';
import ErrorBanner from './ErrorBanner.vue';

const props = defineProps<{ editionId: string; bookId: string; chapters: readonly ChapterRowDto[] }>();
const status = useAsync(() => api.weknoraStatus(props.editionId));
const eligible = computed(() =>
  props.chapters.filter((chapter) => chapter.kind === 'chapter' && chapter.charCount > 0),
);
const from = ref(eligible.value[0]?.index ?? 0);
const to = ref(from.value);
const busy = ref(false);
const error = ref<string | null>(null);
const result = ref<WeKnoraSyncResultDto | null>(null);
const synced = computed(() => status.data.value?.chapters.filter((chapter) => chapter.knowledgeId !== null) ?? []);
const count = computed(() => to.value - from.value + 1);
const validRange = computed(
  () =>
    Number.isInteger(from.value) &&
    Number.isInteger(to.value) &&
    count.value > 0 &&
    count.value <= 10 &&
    eligible.value.filter((chapter) => chapter.index >= from.value && chapter.index <= to.value).length === count.value,
);
const pending = computed(() =>
  synced.value.some((chapter) => ['pending', 'processing', 'finalizing'].includes(chapter.parseStatus ?? '')),
);
const statusLabels: Record<string, string> = {
  pending: '等待解析',
  processing: '解析中',
  finalizing: '解析收尾中',
  completed: '可检索',
  failed: '解析失败',
  cancelled: '解析已取消',
  deleting: '删除中',
  missing: '远端文档缺失',
  unknown: '解析状态未知',
};
function label(chapter: (typeof synced.value)[number]): string {
  if (chapter.parseStatus === 'missing') return '远端文档缺失，可重新同步';
  if (chapter.needsSync) return '原文已更新，待同步';
  return chapter.parseStatus === null ? '远端状态未获取' : (statusLabels[chapter.parseStatus] ?? '解析状态未知');
}
async function sync(): Promise<void> {
  if (busy.value || !validRange.value || !status.data.value?.configured) return;
  busy.value = true;
  error.value = null;
  result.value = null;
  try {
    result.value = await api.syncWeKnora(props.editionId, from.value, to.value);
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    await status.reload();
    busy.value = false;
  }
}
usePolling(
  () => status.reload(),
  () => pending.value && !busy.value && !status.loading.value && !status.error.value && !status.data.value?.remoteError,
  5000,
);
</script>

<template>
  <section class="card stack" aria-labelledby="weknora-heading" :aria-busy="busy">
    <div class="row">
      <h2 id="weknora-heading" class="weknora-title">WeKnora 知识库</h2>
      <span v-if="status.data.value" class="badge neutral">{{
        status.data.value.configured ? '已配置' : '未配置'
      }}</span>
      <button type="button" :disabled="busy || status.loading.value" @click="status.reload()">
        {{ status.loading.value ? '刷新中…' : '刷新状态' }}
      </button>
      <RouterLink :to="{ name: 'search', query: { source: 'weknora', book: bookId } }">用 WeKnora 检索此书</RouterLink>
    </div>
    <ErrorBanner :message="error ?? status.error.value ?? status.data.value?.remoteError ?? null" />
    <p v-if="status.loading.value && !status.data.value" class="muted">正在读取同步状态…</p>
    <template v-if="status.data.value">
      <p v-if="!status.data.value.configured" class="notice">
        请在服务端配置 WEKNORA_BASE_URL 和访问凭据后重启 API，即可在此同步和检索。
      </p>
      <p class="secondary">
        已同步 {{ synced.length }} / {{ chapters.length }} 章 · 已关联证据 {{ status.data.value.evidenceLinked }} /
        {{ status.data.value.evidenceTotal }} 条
      </p>
      <p v-if="!status.data.value.kbId" class="muted">尚未创建知识库。首次同步会为此版本创建知识库。</p>
      <form class="inline-form" @submit.prevent="sync">
        <label class="field"
          >起始章节
          <select v-model.number="from" :disabled="busy || !status.data.value.configured || !eligible.length">
            <option v-for="chapter in eligible" :key="chapter.id" :value="chapter.index">
              {{ chapter.index }} · {{ chapter.title ?? '无标题章节' }}
            </option>
          </select>
        </label>
        <label class="field"
          >结束章节（含）
          <select v-model.number="to" :disabled="busy || !status.data.value.configured || !eligible.length">
            <option v-for="chapter in eligible" :key="chapter.id" :value="chapter.index">
              {{ chapter.index }} · {{ chapter.title ?? '无标题章节' }}
            </option>
          </select>
        </label>
        <button type="submit" class="primary" :disabled="busy || !status.data.value.configured || !validRange">
          {{ busy ? '同步中…' : validRange ? `同步所选 ${count} 章` : '同步所选章节' }}
        </button>
      </form>
      <p v-if="!eligible.length" class="muted">此版本没有可同步的正文章节。</p>
      <p v-else-if="!validRange" class="notice">请选择连续的正文章节，起点不大于终点，每次最多 10 章。</p>
      <p class="small secondary">
        所选正文将发送到 WeKnora。解析可能需要一些时间；解析完成后再次同步同一范围，可补充证据关联。
        同步只处理所选章节，保留知识库中的其他文档。
      </p>
      <p v-if="busy" role="status" class="notice">
        正在提交章节和关联证据，请等待；WeKnora 的解析状态会在完成提交后显示。
      </p>
      <p v-if="result" role="status" class="notice">
        同步提交完成：新建 {{ result.created }} 章，更新 {{ result.updated }} 章，本次关联 {{ result.linked }} 条证据。
      </p>
      <details v-if="synced.length" :open="synced.length <= 10">
        <summary>已同步章节（{{ synced.length }}）{{ pending ? ' · 正在自动刷新解析状态' : '' }}</summary>
        <div class="weknora-table">
          <table>
            <thead>
              <tr>
                <th>章节</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="chapter in synced" :key="chapter.chapterId">
                <td>
                  <RouterLink :to="{ name: 'chapter', params: { editionId, index: chapter.index } }">
                    {{ chapter.index }} · {{ chapter.title ?? '无标题章节' }}
                  </RouterLink>
                </td>
                <td>{{ label(chapter) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </template>
  </section>
</template>

<style scoped>
.weknora-title {
  margin: 0;
}
.field {
  max-width: 100%;
}
select {
  max-width: min(100%, 26rem);
}
.weknora-table {
  overflow-x: auto;
  margin-top: 12px;
}
summary {
  cursor: pointer;
}
</style>

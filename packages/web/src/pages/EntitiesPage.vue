<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { api, errorMessage } from '../api.js';
import ErrorBanner from '../components/ErrorBanner.vue';
import { useAsync } from '../composables.js';
import { ENTITY_TYPE_LABEL, formatCount } from '../format.js';

const props = defineProps<{ editionId: string }>();
let disposed = false;
onUnmounted(() => {
  disposed = true;
});

const entities = useAsync(() => api.entities(props.editionId));
const edition = useAsync(() => api.edition(props.editionId));
const bookId = computed(() => edition.data.value?.book.id);
const voices = useAsync(async () => {
  if (disposed || !bookId.value || edition.error.value) return [];
  return api.voiceProfiles(bookId.value);
});
watch(bookId, () => {
  void voices.reload();
});
const refreshing = computed(() => entities.loading.value || edition.loading.value || voices.loading.value);
const editing = ref<string | null>(null);
const provider = ref('');
const voiceId = ref('');
const voiceError = ref<string | null>(null);
const byEntity = computed(() => new Map((voices.data.value ?? []).map((v) => [v.entityId, v] as const)));
async function refresh(): Promise<void> {
  if (disposed) return;
  await Promise.all([entities.reload(), reloadEditionAndVoices()]);
}

async function reloadEditionAndVoices(): Promise<void> {
  const previousBookId = bookId.value;
  await edition.reload();
  // A changed book ID is handled by the watcher; the same book needs an explicit retry.
  if (!disposed && bookId.value === previousBookId && !edition.error.value) await voices.reload();
}

async function saveVoice(entityId: string): Promise<void> {
  const currentBookId = bookId.value;
  if (disposed || !currentBookId || edition.error.value) return;
  voiceError.value = null;
  try {
    await api.setVoiceProfile(currentBookId, entityId, provider.value, voiceId.value);
    if (disposed) return;
    await voices.reload();
    editing.value = null;
  } catch (error) {
    voiceError.value = errorMessage(error);
  }
}

function editVoice(entityId: string): void {
  editing.value = entityId;
  provider.value = byEntity.value.get(entityId)?.provider ?? '';
  voiceId.value = byEntity.value.get(entityId)?.voiceId ?? '';
}
const type = ref<string>('all');
const query = ref('');

const types = computed(() => [...new Set((entities.data.value ?? []).map((e) => e.type))]);

const visible = computed(() => {
  const q = query.value.trim();
  return (entities.data.value ?? [])
    .filter((e) => type.value === 'all' || e.type === type.value)
    .filter((e) => q.length === 0 || e.canonicalName.includes(q) || e.aliases.some((a) => a.includes(q)))
    .slice()
    .sort((a, b) => b.dialogueCount + b.mentionCount - (a.dialogueCount + a.mentionCount));
});
</script>

<template>
  <div class="stack">
    <p class="crumbs">
      <RouterLink to="/">小说库</RouterLink> /
      <RouterLink :to="{ name: 'edition', params: { editionId } }">版本</RouterLink> / 实体
    </p>
    <div class="page-head">
      <div>
        <h1>实体</h1>
        <p class="meta">实体属于书，跨版本共享；对白数与提及数是全书累计。</p>
      </div>
      <button type="button" :disabled="refreshing" @click="refresh">刷新</button>
    </div>
    <ErrorBanner :message="entities.error.value" />
    <ErrorBanner :message="edition.error.value" />
    <ErrorBanner :message="voices.error.value" />
    <ErrorBanner :message="voiceError" />

    <section v-if="entities.data.value" class="card stack">
      <div class="row">
        <label class="field inline">
          类型
          <select v-model="type">
            <option value="all">全部</option>
            <option v-for="t in types" :key="t" :value="t">{{ ENTITY_TYPE_LABEL[t] ?? t }}</option>
          </select>
        </label>
        <label class="field inline">
          搜索
          <input v-model="query" type="text" placeholder="名字或别名" />
        </label>
        <span class="muted small">{{ visible.length }} / {{ entities.data.value.length }}</span>
      </div>
      <p v-if="visible.length === 0" class="empty">没有实体。解析几章后再来看。</p>
      <table v-else>
        <thead>
          <tr>
            <th>名称</th>
            <th>类型</th>
            <th>别名</th>
            <th class="num">对白</th>
            <th class="num">提及</th>
            <th class="num">置信</th>
            <th>描述</th>
            <th>声音</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entity in visible" :key="entity.id">
            <td>
              <strong>{{ entity.canonicalName }}</strong>
            </td>
            <td>
              <span class="badge neutral">{{ ENTITY_TYPE_LABEL[entity.type] ?? entity.type }}</span>
            </td>
            <td class="secondary">{{ entity.aliases.join('、') }}</td>
            <td class="num">{{ formatCount(entity.dialogueCount) }}</td>
            <td class="num">{{ formatCount(entity.mentionCount) }}</td>
            <td class="num">{{ entity.confidence.toFixed(2) }}</td>
            <td class="secondary small">{{ entity.description ?? '' }}</td>
            <td>
              <template v-if="entity.type === 'character'">
                <form v-if="editing === entity.id" class="row" @submit.prevent="saveVoice(entity.id)">
                  <input v-model="provider" type="text" required placeholder="服务" aria-label="声音服务" />
                  <input v-model="voiceId" type="text" required placeholder="voice ID" aria-label="voice ID" />
                  <button class="small" type="submit">保存</button>
                </form>
                <button v-else class="small" type="button" @click="editVoice(entity.id)">
                  {{
                    byEntity.get(entity.id)
                      ? `${byEntity.get(entity.id)?.provider} / ${byEntity.get(entity.id)?.voiceId}`
                      : '配置声音'
                  }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
    <p v-else-if="entities.loading.value" class="muted">加载中…</p>
  </div>
</template>

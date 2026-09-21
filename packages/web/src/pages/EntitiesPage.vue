<script setup lang="ts">
import { computed, ref } from 'vue';
import { api } from '../api.js';
import ErrorBanner from '../components/ErrorBanner.vue';
import { useAsync } from '../composables.js';
import { ENTITY_TYPE_LABEL, formatCount } from '../format.js';

const props = defineProps<{ editionId: string }>();

const entities = useAsync(() => api.entities(props.editionId));
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
      <button type="button" :disabled="entities.loading.value" @click="entities.reload()">刷新</button>
    </div>
    <ErrorBanner :message="entities.error.value" />

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
          </tr>
        </tbody>
      </table>
    </section>
    <p v-else-if="entities.loading.value" class="muted">加载中…</p>
  </div>
</template>

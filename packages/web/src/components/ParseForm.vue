<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AttributorNameDto, ConfigDto, JobDto } from '@novelstruct/api/contracts';
import { api, errorMessage } from '../api.js';
import ErrorBanner from './ErrorBanner.vue';

const props = defineProps<{ editionId: string; chapterCount: number; config: ConfigDto | undefined }>();
const emit = defineEmits<{ started: [job: JobDto] }>();

const from = ref(0);
const to = ref<number | null>(null);
const attributor = ref<AttributorNameDto>('heuristic');
const force = ref(false);
const allKinds = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);

const llmDisabled = computed(() => props.config !== undefined && !props.config.llmConfigured);
const maxIndex = computed(() => Math.max(0, props.chapterCount - 1));

async function submit(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    const job = await api.startParse(props.editionId, {
      from: from.value,
      ...(to.value === null ? {} : { to: to.value }),
      attributor: attributor.value,
      force: force.value,
      allKinds: allKinds.value,
    });
    emit('started', job);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="card stack">
    <h2>运行结构遍</h2>
    <form class="inline-form" @submit.prevent="submit">
      <label class="field">
        起始 index
        <input v-model.number="from" type="number" min="0" :max="maxIndex" :disabled="busy" />
      </label>
      <label class="field">
        结束 index（留空到末章）
        <input v-model.number="to" type="number" min="0" :max="maxIndex" :disabled="busy" placeholder="末章" />
      </label>
      <label class="field">
        归属器
        <select v-model="attributor" :disabled="busy">
          <option value="heuristic">heuristic（离线启发式）</option>
          <option value="llm" :disabled="llmDisabled">llm{{ llmDisabled ? '（未配置模型）' : '' }}</option>
        </select>
      </label>
      <label class="field inline">
        <input v-model="force" type="checkbox" :disabled="busy" />
        强制重跑已成功章节
      </label>
      <label class="field inline">
        <input v-model="allKinds" type="checkbox" :disabled="busy" />
        包括作者留言与前言
      </label>
      <button type="submit" class="primary" :disabled="busy || chapterCount === 0">
        {{ busy ? '提交中…' : '开始解析' }}
      </button>
    </form>
    <ErrorBanner :message="error" />
  </section>
</template>

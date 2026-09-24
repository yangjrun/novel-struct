<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AttributorNameDto, ConfigDto, JobDto } from '@novelstruct/api/contracts';
import { api, errorMessage } from '../api.js';
import ErrorBanner from './ErrorBanner.vue';

const props = defineProps<{ editionId: string; chapterCount: number; config: ConfigDto | undefined }>();
const emit = defineEmits<{ started: [job: JobDto] }>();

const from = ref(0);
const to = ref<number | null>(null);
const attributor = ref<AttributorNameDto>('llm');
const selectedByUser = ref(false);
const force = ref(false);
const allKinds = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);

const llmDisabled = computed(() => !props.config?.llmConfigured);
watch(
  () => props.config?.llmConfigured,
  (configured) => {
    if (!selectedByUser.value) attributor.value = configured === false ? 'heuristic' : 'llm';
  },
  { immediate: true },
);
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
        <select v-model="attributor" :disabled="busy" @change="selectedByUser = true">
          <option value="llm" :disabled="llmDisabled">llm（质量优先）{{ llmDisabled ? ' · 未配置模型' : '' }}</option>
          <option value="heuristic">heuristic（离线基线，归属与场景质量有限）</option>
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
      <button type="submit" class="primary" :disabled="busy || chapterCount === 0 || config === undefined">
        {{ busy ? '提交中…' : '开始解析' }}
      </button>
    </form>
    <p class="muted small">
      模型逐章解析可能耗时数分钟；{{
        config?.shadowModel ? `${config.shadowModel} 仅影子复核，不自动改写结果。` : '未配置 Jev 影子复核。'
      }}
    </p>
    <ErrorBanner :message="error" />
  </section>
</template>

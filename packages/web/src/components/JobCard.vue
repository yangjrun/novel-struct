<script setup lang="ts">
import { computed, ref } from 'vue';
import type { JobDto } from '@novelstruct/api/contracts';
import { api, errorMessage } from '../api.js';
import { chapterLabel, formatTime, isJobActive, jobProgress, JOB_STATUS_LABEL } from '../format.js';
import ErrorBanner from './ErrorBanner.vue';
import StatusBadge from './StatusBadge.vue';

const props = defineProps<{ job: JobDto; showEdition?: boolean }>();
const emit = defineEmits<{ changed: [] }>();

const error = ref<string | null>(null);
const expanded = ref(isJobActive(props.job));
const progress = computed(() => jobProgress(props.job));
const active = computed(() => isJobActive(props.job));
const rangeLabel = computed(() => {
  const { from, to } = props.job.options;
  return to === null ? `从 ${from} 到末章` : `${from} 到 ${to}`;
});
/** Tokens reported so far by succeeded chapters; zero for the heuristic attributor. */
const tokens = computed(() =>
  props.job.events.reduce(
    (acc, event) =>
      event.type === 'succeeded' && event.usage !== undefined
        ? { input: acc.input + event.usage.inputTokens, output: acc.output + event.usage.outputTokens }
        : acc,
    { input: 0, output: 0 },
  ),
);

async function cancel(): Promise<void> {
  error.value = null;
  try {
    await api.cancelJob(props.job.id);
    emit('changed');
  } catch (e) {
    error.value = errorMessage(e);
  }
}
</script>

<template>
  <article class="card stack">
    <div class="row">
      <StatusBadge :status="job.status" :label="JOB_STATUS_LABEL[job.status]" />
      <strong>{{ job.options.attributor }}</strong>
      <span class="secondary">{{ rangeLabel }}，共 {{ job.total }} 章{{ job.options.force ? '，强制重跑' : '' }}</span>
      <RouterLink v-if="showEdition" :to="{ name: 'edition', params: { editionId: job.editionId } }" class="mono">
        {{ job.editionId }}
      </RouterLink>
      <span class="spacer" style="flex: 1"></span>
      <span class="muted small">{{ formatTime(job.createdAt) }}</span>
      <button v-if="active" class="small danger" type="button" @click="cancel">取消</button>
      <button class="small" type="button" @click="expanded = !expanded">{{ expanded ? '收起' : '详情' }}</button>
    </div>
    <div class="meter" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100">
      <span :style="{ width: `${progress}%` }"></span>
    </div>
    <p v-if="job.result" class="secondary small">
      成功 {{ job.result.succeeded }} · 跳过 {{ job.result.skipped }} · 失败 {{ job.result.failed }}
      <span v-if="job.result.stopped">· 提前停止</span>
      <span v-if="tokens.input + tokens.output > 0">· token 输入 {{ tokens.input }} 输出 {{ tokens.output }}</span>
    </p>
    <ErrorBanner :message="error ?? job.error" />
    <div v-if="expanded && job.events.length > 0" class="job-events">
      <ul>
        <template v-for="(event, i) in job.events" :key="i">
          <li>
            <StatusBadge
              :status="event.type === 'succeeded' ? 'succeeded' : event.type === 'failed' ? 'failed' : 'cancelled'"
              :label="event.type === 'succeeded' ? '成功' : event.type === 'failed' ? '失败' : '跳过'"
            />
            <span>{{ chapterLabel(event.chapter) }}</span>
            <span v-if="event.type === 'succeeded'" class="secondary">
              场景 {{ event.summary.scenes }} · 分段 {{ event.summary.segments }} · 新实体
              {{ event.summary.newEntities }} · 未消解对白 {{ event.unresolved }}
              <template v-if="event.usage"
                >· token {{ event.usage.inputTokens }} / {{ event.usage.outputTokens }}</template
              >
            </span>
            <span v-else-if="event.type === 'failed'" class="secondary">{{ event.error }}</span>
            <span v-else class="secondary">{{ event.reason }}</span>
          </li>
          <li v-for="(warning, w) in event.type === 'succeeded' ? event.warnings : []" :key="`${i}-${w}`" class="warn">
            ! {{ warning }}
          </li>
        </template>
      </ul>
    </div>
  </article>
</template>

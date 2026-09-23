<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { SegmentDto } from '@novelstruct/api/contracts';
import { api, errorMessage } from '../api.js';
import ErrorBanner from '../components/ErrorBanner.vue';
import { useAsync } from '../composables.js';
import { CHAPTER_KIND_LABEL, formatCount } from '../format.js';

const props = defineProps<{ editionId: string; index: number }>();
const route = useRoute();
const router = useRouter();
const showRaw = ref(route.query['raw'] === '1');
watch(
  () => route.query['raw'],
  (value) => {
    if (value === '1') showRaw.value = true;
  },
);

async function jumpToOriginal(offset: number): Promise<void> {
  showRaw.value = true;
  await router.replace({ query: { ...route.query, raw: '1', offset: String(offset) } });
}

const detail = useAsync(() => api.chapter(props.editionId, props.index));
const ttsError = ref<string | null>(null);
async function downloadTtsTasks(): Promise<void> {
  ttsError.value = null;
  try {
    const tasks = await api.ttsTasks(props.editionId, props.index);
    if (!tasks.length) throw new Error('本章尚未解析，没有可导出的 TTS 任务');
    const url = URL.createObjectURL(new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `tts-${props.editionId}-${props.index}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  } catch (error) {
    ttsError.value = errorMessage(error);
  }
}
const requestedOffset = computed(() => {
  const raw = route.query['offset'];
  const value = typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isInteger(value) && value >= 0 ? value : null;
});
const targetSegment = computed(
  () =>
    detail.data.value?.segments.find(
      (segment) =>
        requestedOffset.value !== null &&
        segment.charStart <= requestedOffset.value &&
        requestedOffset.value < segment.charEnd,
    )?.index ?? null,
);
const targetNarrationLine = computed(() => {
  const segment = detail.data.value?.segments.find((s) => s.index === targetSegment.value);
  if (!segment || segment.kind !== 'narration' || requestedOffset.value === null) return null;
  const lines = segmentLines(segment);
  return (
    lines.find((line) => line.start <= requestedOffset.value! && requestedOffset.value! < line.start + line.text.length)
      ?.start ??
    lines.find((line) => line.start >= requestedOffset.value!)?.start ??
    lines.at(-1)?.start ??
    null
  );
});
const rawParts = computed(() => {
  const text = detail.data.value?.chapter.text ?? '';
  const offset = requestedOffset.value;
  if (offset === null || offset >= text.length) return { before: text, selected: '', after: '' };
  const start = offset === 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1;
  const end = text.indexOf('\n', offset);
  const stop = end === -1 ? text.length : end;
  return { before: text.slice(0, start), selected: text.slice(start, stop), after: text.slice(stop) };
});
watch(
  [() => detail.data.value, requestedOffset],
  () => {
    if (requestedOffset.value === null || !detail.data.value) return;
    requestAnimationFrame(() =>
      document.getElementById('source-target')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
  },
  { immediate: true },
);
watch(
  () => [props.editionId, props.index],
  () => {
    showRaw.value = route.query['raw'] === '1';
    void detail.reload();
    window.scrollTo({ top: 0 });
  },
);

const UNKNOWN_SURFACE = '[unknown]';

interface ReaderBlock {
  readonly key: number;
  readonly sceneBanner: string | null;
  readonly segment: SegmentDto;
  readonly tone: 'resolved' | 'unresolved' | 'unknown';
}

const blocks = computed<ReaderBlock[]>(() => {
  const segments = detail.data.value?.segments ?? [];
  return segments.map((segment, i) => {
    const previous = segments[i - 1];
    const newScene = previous === undefined || previous.sceneIndex !== segment.sceneIndex;
    return {
      key: segment.index,
      sceneBanner: newScene
        ? `场景 ${segment.sceneIndex}${segment.sceneLocation ? ` · ${segment.sceneLocation}` : ''}`
        : null,
      segment,
      tone: toneOf(segment),
    };
  });
});

const stats = computed(() => {
  const segments = detail.data.value?.segments ?? [];
  const spoken = segments.filter((s) => s.kind !== 'narration');
  return {
    spoken: spoken.length,
    resolved: spoken.filter((s) => s.speakerName !== null).length,
    unknown: spoken.filter((s) => s.speakerSurface === UNKNOWN_SURFACE || s.speakerSurface === null).length,
  };
});

function toneOf(segment: SegmentDto): ReaderBlock['tone'] {
  if (segment.speakerName !== null) return 'resolved';
  if (segment.speakerSurface === null || segment.speakerSurface === UNKNOWN_SURFACE) return 'unknown';
  return 'unresolved';
}

function speakerOf(segment: SegmentDto): string {
  if (segment.speakerName !== null) return segment.speakerName;
  if (segment.speakerSurface === null || segment.speakerSurface === UNKNOWN_SURFACE) return '未知';
  return segment.speakerSurface;
}

function segmentLines(segment: SegmentDto): { text: string; start: number }[] {
  const lines: { text: string; start: number }[] = [];
  let offset = 0;
  for (const raw of segment.text.split('\n')) {
    const text = raw.trim();
    if (text) lines.push({ text, start: segment.charStart + offset + raw.indexOf(text) });
    offset += raw.length + 1;
  }
  return lines;
}
</script>

<template>
  <div class="stack">
    <p class="crumbs">
      <RouterLink to="/">小说库</RouterLink> /
      <RouterLink :to="{ name: 'edition', params: { editionId } }">版本</RouterLink> / 章节
    </p>
    <ErrorBanner :message="detail.error.value" />
    <ErrorBanner :message="ttsError" />

    <template v-if="detail.data.value">
      <div class="page-head">
        <div>
          <h1>
            {{
              detail.data.value.chapter.headingRaw ??
              detail.data.value.chapter.title ??
              CHAPTER_KIND_LABEL[detail.data.value.chapter.kind]
            }}
          </h1>
          <p class="meta">
            index {{ detail.data.value.chapter.index }} · {{ formatCount(detail.data.value.chapter.charCount) }} 字
            <template v-if="detail.data.value.segments.length > 0">
              · 对白 {{ stats.spoken }} · 已消解 {{ stats.resolved }} · 未知说话人 {{ stats.unknown }}
            </template>
          </p>
        </div>
        <div class="legend" v-if="detail.data.value.segments.length > 0">
          <span><i style="background: var(--series-1)"></i>已消解到实体</span>
          <span><i style="background: var(--status-warning)"></i>只有称呼</span>
          <span><i style="background: var(--status-serious)"></i>未知说话人</span>
          <span><i style="background: var(--series-2)"></i>心声</span>
        </div>
      </div>

      <div class="row" v-if="detail.data.value.segments.length > 0">
        <button type="button" @click="showRaw = !showRaw">{{ showRaw ? '查看分段' : '查看规范化原文' }}</button>
        <button type="button" @click="downloadTtsTasks">导出 TTS 任务 JSON</button>
      </div>
      <div class="reader">
        <p v-if="detail.data.value.segments.length === 0" class="notice">
          该章尚未解析，下面是规范化后的原文。回到版本页可以发起解析。
        </p>
        <div v-if="detail.data.value.segments.length === 0 || showRaw" class="raw">
          {{ rawParts.before }}<mark v-if="rawParts.selected" id="source-target">{{ rawParts.selected }}</mark
          >{{ rawParts.after }}
        </div>

        <template v-for="block in showRaw ? [] : blocks" :key="block.key">
          <p v-if="block.sceneBanner" class="scene">{{ block.sceneBanner }}</p>
          <template v-if="block.segment.kind === 'narration'">
            <p
              v-for="(line, i) in segmentLines(block.segment)"
              :key="`${block.key}-${i}`"
              class="narration"
              :title="`分段 ${block.segment.index} · 偏移 ${block.segment.charStart}–${block.segment.charEnd}，点击查看原文`"
              @click="jumpToOriginal(line.start)"
              :id="
                targetSegment === block.segment.index && targetNarrationLine === line.start
                  ? 'source-target'
                  : undefined
              "
              :class="{
                'source-highlight': targetSegment === block.segment.index && targetNarrationLine === line.start,
              }"
            >
              {{ line.text }}
            </p>
          </template>
          <div
            v-else
            class="speech"
            :id="targetSegment === block.segment.index ? 'source-target' : undefined"
            :class="[
              block.tone,
              { thought: block.segment.kind === 'thought', 'source-highlight': targetSegment === block.segment.index },
            ]"
            :title="`分段 ${block.segment.index} · 偏移 ${block.segment.charStart}–${block.segment.charEnd}`"
            role="button"
            tabindex="0"
            @click="jumpToOriginal(block.segment.charStart)"
            @keydown.enter="jumpToOriginal(block.segment.charStart)"
          >
            <div class="speaker">
              {{ speakerOf(block.segment) }}
              <span class="sub">
                <template v-if="block.segment.kind === 'thought'">心声 · </template>
                <template v-if="block.segment.speakerConfidence !== null"
                  >置信 {{ block.segment.speakerConfidence.toFixed(2) }}</template
                >
                <template v-if="block.segment.emotionType"> · {{ block.segment.emotionType }}</template>
              </span>
            </div>
            <div class="quote">{{ block.segment.text.trim() }}</div>
          </div>
        </template>

        <nav class="pager">
          <RouterLink
            v-if="detail.data.value.prevIndex !== null"
            class="btn"
            :to="{ name: 'chapter', params: { editionId, index: detail.data.value.prevIndex } }"
          >
            ← 上一章
          </RouterLink>
          <span v-else></span>
          <RouterLink
            v-if="detail.data.value.nextIndex !== null"
            class="btn"
            :to="{ name: 'chapter', params: { editionId, index: detail.data.value.nextIndex } }"
          >
            下一章 →
          </RouterLink>
        </nav>
      </div>
    </template>
    <p v-else-if="detail.loading.value" class="muted">加载中…</p>
  </div>
</template>

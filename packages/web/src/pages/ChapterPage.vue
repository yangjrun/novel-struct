<script setup lang="ts">
import { computed, watch } from 'vue';
import type { SegmentDto } from '@novelstruct/api/contracts';
import { api } from '../api.js';
import ErrorBanner from '../components/ErrorBanner.vue';
import { useAsync } from '../composables.js';
import { CHAPTER_KIND_LABEL, formatCount } from '../format.js';

const props = defineProps<{ editionId: string; index: number }>();

const detail = useAsync(() => api.chapter(props.editionId, props.index));
watch(
  () => [props.editionId, props.index],
  () => {
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

function trimmedLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
</script>

<template>
  <div class="stack">
    <p class="crumbs">
      <RouterLink to="/">小说库</RouterLink> /
      <RouterLink :to="{ name: 'edition', params: { editionId } }">版本</RouterLink> / 章节
    </p>
    <ErrorBanner :message="detail.error.value" />

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

      <div class="reader">
        <p v-if="detail.data.value.segments.length === 0" class="notice">
          该章尚未解析，下面是规范化后的原文。回到版本页可以发起解析。
        </p>
        <div v-if="detail.data.value.segments.length === 0" class="raw">{{ detail.data.value.chapter.text }}</div>

        <template v-for="block in blocks" :key="block.key">
          <p v-if="block.sceneBanner" class="scene">{{ block.sceneBanner }}</p>
          <template v-if="block.segment.kind === 'narration'">
            <p v-for="(line, i) in trimmedLines(block.segment.text)" :key="`${block.key}-${i}`" class="narration">
              {{ line }}
            </p>
          </template>
          <div
            v-else
            class="speech"
            :class="[block.tone, { thought: block.segment.kind === 'thought' }]"
            :title="`分段 ${block.segment.index} · 偏移 ${block.segment.charStart}–${block.segment.charEnd}`"
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

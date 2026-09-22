<script setup lang="ts">
import { computed } from 'vue';

type Tone = 'neutral' | 'good' | 'warning' | 'bad' | 'info';

const props = defineProps<{ status: string; label?: string }>();

const TONE: Record<string, Tone> = {
  queued: 'neutral',
  pending: 'neutral',
  running: 'info',
  succeeded: 'good',
  failed: 'bad',
  interrupted: 'warning',
  cancelled: 'warning',
};

const tone = computed<Tone>(() => TONE[props.status] ?? 'neutral');
</script>

<template>
  <span class="badge" :class="tone">{{ label ?? status }}</span>
</template>

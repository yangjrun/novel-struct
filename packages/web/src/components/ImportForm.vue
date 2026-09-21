<script setup lang="ts">
import { ref } from 'vue';
import type { ImportResultDto } from '@novelstruct/api/contracts';
import { api, errorMessage } from '../api.js';
import ErrorBanner from './ErrorBanner.vue';

const emit = defineEmits<{ imported: [result: ImportResultDto] }>();

const file = ref<File | null>(null);
const title = ref('');
const author = ref('');
const label = ref('v1');
const busy = ref(false);
const error = ref<string | null>(null);

function isEpub(picked: File): boolean {
  return /\.epub$/i.test(picked.name);
}

function onFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const picked = input.files?.[0] ?? null;
  file.value = picked;
  // A TXT has no metadata, so its file name is the best guess; an EPUB carries its own title.
  if (picked !== null && !isEpub(picked) && title.value.trim().length === 0) {
    title.value = picked.name.replace(/\.[^.]+$/, '');
  }
}

async function submit(): Promise<void> {
  if (file.value === null) {
    error.value = '请先选择一个 TXT 或 EPUB 文件';
    return;
  }
  if (title.value.trim().length === 0 && !isEpub(file.value)) {
    error.value = 'TXT 文件需要填写书名';
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    const result = await api.importBook({
      file: file.value,
      title: title.value.trim(),
      author: author.value.trim(),
      label: label.value.trim(),
    });
    emit('imported', result);
    file.value = null;
    title.value = '';
    author.value = '';
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="card stack">
    <h2>导入小说</h2>
    <form class="inline-form" @submit.prevent="submit">
      <label class="field">
        TXT 或 EPUB 文件
        <input type="file" accept=".txt,.epub,text/plain,application/epub+zip" :disabled="busy" @change="onFile" />
      </label>
      <label class="field">
        书名
        <input v-model="title" type="text" maxlength="200" placeholder="EPUB 可留空，取文件自带书名" :disabled="busy" />
      </label>
      <label class="field">
        作者
        <input v-model="author" type="text" maxlength="100" placeholder="EPUB 可留空" :disabled="busy" />
      </label>
      <label class="field">
        版本标签
        <input v-model="label" type="text" maxlength="50" :disabled="busy" />
      </label>
      <button type="submit" class="primary" :disabled="busy">{{ busy ? '导入中…' : '导入' }}</button>
    </form>
    <ErrorBanner :message="error" />
    <p class="muted small">
      导入会规范化文本、识别章节标题并写入数据库。TXT 的编码自动识别，UTF-8、GBK、GB18030 都可以；EPUB
      按目录切章。同名同标签再次导入会原地更新并保留章节 ID。
    </p>
  </section>
</template>

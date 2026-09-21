<script setup lang="ts">
defineProps<{ message: string | null | undefined }>();
</script>

<template>
  <div v-if="message" class="error-banner" role="alert">{{ message }}</div>
</template>

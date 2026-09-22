<script setup lang="ts">
import { api } from '../api.js';
import ErrorBanner from '../components/ErrorBanner.vue';
import { useAsync } from '../composables.js';
import { formatCost, formatCount, formatTime } from '../format.js';

const usage = useAsync(() => api.usage());
</script>

<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1>用量与成本</h1>
        <p class="meta">
          按版本、归属器、模型汇总所有解析记录的 token；失败和中断的运行也计入，那些 token
          同样花掉了。成本按当前配置的单价估算。
        </p>
      </div>
      <button type="button" :disabled="usage.loading.value" @click="usage.reload()">刷新</button>
    </div>
    <ErrorBanner :message="usage.error.value" />

    <template v-if="usage.data.value">
      <div class="kpis">
        <div class="card">
          <p class="tile-label">输入 token</p>
          <p class="tile-value">{{ formatCount(usage.data.value.total.inputTokens) }}</p>
        </div>
        <div class="card">
          <p class="tile-label">输出 token</p>
          <p class="tile-value">{{ formatCount(usage.data.value.total.outputTokens) }}</p>
        </div>
        <div class="card">
          <p class="tile-label">估算成本</p>
          <p class="tile-value">{{ formatCost(usage.data.value.total.cost, usage.data.value.pricing?.currency) }}</p>
          <p class="tile-sub">
            <template v-if="usage.data.value.pricing">
              每百万 token 输入 {{ usage.data.value.pricing.inputPerMillion }} 输出
              {{ usage.data.value.pricing.outputPerMillion }} {{ usage.data.value.pricing.currency }}
            </template>
            <template v-else>未设置 LLM_PRICE_INPUT / LLM_PRICE_OUTPUT</template>
          </p>
        </div>
        <div class="card">
          <p class="tile-label">运行次数</p>
          <p class="tile-value">{{ formatCount(usage.data.value.total.runs) }}</p>
          <p class="tile-sub">
            成功 {{ formatCount(usage.data.value.total.succeeded) }} · 失败
            {{ formatCount(usage.data.value.total.failed) }}
          </p>
        </div>
      </div>

      <section class="card">
        <p v-if="usage.data.value.rows.length === 0" class="empty">还没有解析记录。</p>
        <table v-else>
          <thead>
            <tr>
              <th>书</th>
              <th>版本</th>
              <th>归属器 / 模型</th>
              <th class="num">运行</th>
              <th class="num">成功</th>
              <th class="num">失败</th>
              <th class="num">章</th>
              <th class="num">输入 token</th>
              <th class="num">输出 token</th>
              <th class="num">成本</th>
              <th>最近运行</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in usage.data.value.rows" :key="`${row.editionId}-${row.attributor}-${row.model ?? ''}`">
              <td>{{ row.bookTitle }}</td>
              <td>
                <RouterLink :to="{ name: 'edition', params: { editionId: row.editionId } }">{{
                  row.editionLabel
                }}</RouterLink>
              </td>
              <td>
                {{ row.attributor }}
                <span v-if="row.model" class="muted">/ {{ row.model }}</span>
              </td>
              <td class="num">{{ formatCount(row.runs) }}</td>
              <td class="num">{{ formatCount(row.succeeded) }}</td>
              <td class="num">{{ formatCount(row.failed) }}</td>
              <td class="num">{{ formatCount(row.chapters) }}</td>
              <td class="num">{{ formatCount(row.inputTokens) }}</td>
              <td class="num">{{ formatCount(row.outputTokens) }}</td>
              <td class="num">{{ formatCost(row.cost, usage.data.value.pricing?.currency) }}</td>
              <td class="muted small">{{ formatTime(row.lastRunAt) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
    <p v-else-if="usage.loading.value" class="muted">加载中…</p>
  </div>
</template>

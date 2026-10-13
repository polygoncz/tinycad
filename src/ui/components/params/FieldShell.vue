<script setup lang="ts">
// Common frame of a param field: translated label, the control (slot) and the issue text.
import { useI18n } from 'vue-i18n';
import type { ParamIssue } from '@/document';
import { issueText } from '../../i18n/i18n';

defineProps<{ label: string; issue: ParamIssue | null }>();

const { t } = useI18n();
</script>

<template>
  <div class="param-field">
    <span class="label">{{ t(label) }}</span>
    <div class="control"><slot /></div>
    <div v-if="issue" class="issue">{{ issueText(t, issue) }}</div>
  </div>
</template>

<style scoped>
.param-field {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: center;
  gap: 4px 10px;
  margin: 0 14px 10px;
}
.label {
  color: var(--text-secondary);
}
.issue {
  grid-column: 2;
  color: var(--danger);
  font-size: var(--font-size-small);
}
</style>

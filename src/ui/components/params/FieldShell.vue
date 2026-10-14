<script setup lang="ts">
// Common frame of a param field: translated label, the control (slot) and the issue text.
// Accessibility (spec 11, "Komponenty"): the slot gets the ids of the label and of the issue,
// the control names itself by them (aria-labelledby, aria-describedby), so a screen reader and
// the e2e test find the field as "Výška". The line of the issue is reserved even without one
// (M19.1, revize U9): when "Vyberte aspoň 1" goes away after a pick, the fields below stay where
// they were and the next click lands where the user aimed.
import { useId } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ParamIssue } from '@/document';
import { issueText } from '../../i18n/i18n';

defineProps<{ label: string; issue: ParamIssue | null }>();

const { t } = useI18n();
const labelId = useId();
const issueId = useId();
</script>

<template>
  <div class="param-field">
    <span :id="labelId" class="label">{{ t(label) }}</span>
    <div class="control">
      <slot :label-id="labelId" :issue-id="issue ? issueId : undefined" />
    </div>
    <div v-if="issue" :id="issueId" class="issue">{{ issueText(t, issue) }}</div>
  </div>
</template>

<style scoped>
.param-field {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  /* The second row is the issue line: an explicit track keeps its height while it is empty. */
  grid-template-rows: auto minmax(calc(var(--font-size-small) * var(--line-height)), auto);
  align-items: center;
  gap: 2px 10px;
  margin: 0 14px 4px;
}
.label {
  color: var(--text-secondary);
}
.issue {
  grid-column: 2;
  grid-row: 2;
  color: var(--danger);
  font-size: var(--font-size-small);
  line-height: var(--line-height);
}
</style>

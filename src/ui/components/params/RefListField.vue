<script setup lang="ts">
// ParamSpec kinds 'bodies' and 'topo': the selected references and whether the field is the
// active one that takes the selection from the view (FieldState.active). The references are
// set by the selection, not typed here, so the field reports only that it wants to become
// active (the dialog calls focusRefParam).
import { computed, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FieldState } from '@/interaction';
import FieldShell from './FieldShell.vue';

const props = defineProps<{ field: FieldState }>();
const emit = defineEmits<{ update: [value: unknown]; activate: [] }>();

const { t } = useI18n();
// The name is the label followed by the own text: "Tělesa 2 vybráno".
const buttonId = useId();
const count = computed(() => (Array.isArray(props.field.value) ? props.field.value.length : 0));
</script>

<template>
  <FieldShell v-slot="{ labelId, issueId }" :label="field.spec.label" :issue="field.issue">
    <button
      :id="buttonId"
      type="button"
      :aria-labelledby="`${labelId} ${buttonId}`"
      :aria-describedby="issueId"
      :aria-pressed="field.active"
      class="ref-list"
      :class="{ active: field.active, invalid: field.issue !== null }"
      @click="emit('activate')"
    >
      {{ field.active ? t('field.refs.pick') : t('field.refs.count', { n: count }) }}
    </button>
  </FieldShell>
</template>

<style scoped>
.ref-list {
  height: var(--field-height);
  padding: 0 8px;
  text-align: left;
  border-radius: var(--radius-control);
  background: var(--field-bg);
  border: 0.5px solid var(--field-border);
  color: var(--text-primary);
  font: inherit;
}
.ref-list.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
  color: var(--accent);
}
.ref-list.invalid {
  border-color: var(--danger);
}
</style>

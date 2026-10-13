<script setup lang="ts">
// ParamSpec kind 'enum': a select of the options; option labels are translation keys.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FieldState } from '@/interaction';
import FieldShell from './FieldShell.vue';

const props = defineProps<{ field: FieldState }>();
const emit = defineEmits<{ update: [value: unknown] }>();

const { t } = useI18n();
const options = computed(() => (props.field.spec.kind === 'enum' ? props.field.spec.options : []));

// v-model through a computed: reads the field, a change is only reported.
const selected = computed({
  get: () => (typeof props.field.value === 'string' ? props.field.value : ''),
  set: (value: string) => {
    emit('update', value);
  },
});
</script>

<template>
  <FieldShell v-slot="{ labelId, issueId }" :label="field.spec.label" :issue="field.issue">
    <select
      v-model="selected"
      class="select"
      :class="{ invalid: field.issue !== null }"
      :aria-labelledby="labelId"
      :aria-describedby="issueId"
      :aria-invalid="field.issue !== null"
    >
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ t(option.label) }}
      </option>
    </select>
  </FieldShell>
</template>

<style scoped>
.select {
  height: var(--field-height);
  padding: 0 6px;
  border-radius: var(--radius-control);
  background: var(--field-bg);
  border: 0.5px solid var(--field-border);
  color: var(--text-primary);
  font: inherit;
}
.select:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.select.invalid {
  border-color: var(--danger);
  box-shadow: 0 0 0 3px var(--danger-soft);
}
</style>

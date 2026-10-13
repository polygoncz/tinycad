<script setup lang="ts">
// Text input for one number. Reports a value on change (Enter or leaving the field), not on
// every keystroke. Text that is not a number is not reported; the field shows the last value.
// The typed text is a local string (pure UI state); no DOM types in the script, so the
// component typechecks in the DOM-free test project too.
import { ref, watch } from 'vue';
import { formatNumber, parseNumber } from './field-values';

const props = defineProps<{ value: unknown; unit?: string; invalid: boolean }>();
const emit = defineEmits<{ commit: [value: number] }>();

const text = ref(formatNumber(props.value));
watch(
  () => props.value,
  (value) => {
    text.value = formatNumber(value);
  },
);

function onChange(): void {
  const value = parseNumber(text.value);
  if (value === null) text.value = formatNumber(props.value);
  else emit('commit', value);
}
</script>

<template>
  <label class="numeric-input" :class="{ invalid }">
    <input v-model="text" type="text" inputmode="decimal" @change="onChange" />
    <span v-if="unit" class="unit">{{ unit }}</span>
  </label>
</template>

<style scoped>
.numeric-input {
  display: flex;
  align-items: center;
  height: var(--field-height);
  padding: 0 8px;
  border-radius: var(--radius-control);
  background: var(--field-bg);
  border: 0.5px solid var(--field-border);
}
.numeric-input:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.numeric-input.invalid {
  border-color: var(--danger);
  box-shadow: 0 0 0 3px var(--danger-soft);
}
input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
}
.unit {
  color: var(--text-tertiary);
}
</style>

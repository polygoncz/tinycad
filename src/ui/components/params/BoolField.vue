<script setup lang="ts">
// ParamSpec kind 'boolean': a checkbox.
import { computed } from 'vue';
import type { FieldState } from '@/interaction';
import FieldShell from './FieldShell.vue';

const props = defineProps<{ field: FieldState }>();
const emit = defineEmits<{ update: [value: unknown] }>();

// v-model through a computed: reads the field, a change is only reported.
const checked = computed({
  get: () => props.field.value === true,
  set: (value: boolean) => {
    emit('update', value);
  },
});
</script>

<template>
  <FieldShell :label="field.spec.label" :issue="field.issue">
    <input v-model="checked" type="checkbox" class="checkbox" />
  </FieldShell>
</template>

<style scoped>
.checkbox {
  accent-color: var(--accent);
  justify-self: start;
}
</style>

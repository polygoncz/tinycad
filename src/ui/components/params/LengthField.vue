<script setup lang="ts">
// ParamSpec kind 'length': millimetres in the document and in the UI.
import type { FieldState } from '@/interaction';
import FieldShell from './FieldShell.vue';
import NumericInput from './NumericInput.vue';

defineProps<{ field: FieldState }>();
const emit = defineEmits<{ update: [value: unknown] }>();
</script>

<template>
  <FieldShell :label="field.spec.label" :issue="field.issue">
    <NumericInput
      :value="field.value"
      unit="mm"
      :invalid="field.issue !== null"
      @commit="emit('update', $event)"
    />
  </FieldShell>
</template>

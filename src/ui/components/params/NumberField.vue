<script setup lang="ts">
// ParamSpec kind 'number': a plain number without a unit. Whether it must be an integer is
// checked by validation (param.notInteger), not here.
import type { FieldState } from '@/interaction';
import FieldShell from './FieldShell.vue';
import NumericInput from './NumericInput.vue';

defineProps<{ field: FieldState }>();
const emit = defineEmits<{ update: [value: unknown] }>();
</script>

<template>
  <FieldShell v-slot="{ labelId, issueId }" :label="field.spec.label" :issue="field.issue">
    <NumericInput
      :value="field.value"
      :invalid="field.issue !== null"
      :labelledby="labelId"
      :describedby="issueId"
      @commit="emit('update', $event)"
    />
  </FieldShell>
</template>

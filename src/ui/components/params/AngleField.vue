<script setup lang="ts">
// ParamSpec kind 'angle': radians in the document, degrees in the UI (spec 01, "Souřadnice a
// jednotky").
import { computed } from 'vue';
import type { FieldState } from '@/interaction';
import { degToRad, radToDeg } from './field-values';
import FieldShell from './FieldShell.vue';
import NumericInput from './NumericInput.vue';

const props = defineProps<{ field: FieldState }>();
const emit = defineEmits<{ update: [value: unknown] }>();

// A non-number stays as it is, NumericInput shows it as empty.
const degrees = computed(() =>
  typeof props.field.value === 'number' ? radToDeg(props.field.value) : props.field.value,
);
</script>

<template>
  <FieldShell :label="field.spec.label" :issue="field.issue">
    <NumericInput
      :value="degrees"
      unit="°"
      :invalid="field.issue !== null"
      @commit="emit('update', degToRad($event))"
    />
  </FieldShell>
</template>

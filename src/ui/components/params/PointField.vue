<script setup lang="ts">
// ParamSpec kind 'point': three coordinates in millimetres; a change reports the whole point.
import { computed } from 'vue';
import type { Vec3 } from '@/core';
import type { FieldState } from '@/interaction';
import { asPoint, withCoordinate } from './field-values';
import FieldShell from './FieldShell.vue';
import NumericInput from './NumericInput.vue';

const props = defineProps<{ field: FieldState }>();
const emit = defineEmits<{ update: [value: unknown] }>();

const AXES = [
  { name: 'X', index: 0 },
  { name: 'Y', index: 1 },
  { name: 'Z', index: 2 },
] as const;

// A value that is not a point (invalid document data) edits as the origin.
const point = computed((): Vec3 => asPoint(props.field.value) ?? [0, 0, 0]);
</script>

<template>
  <FieldShell :label="field.spec.label" :issue="field.issue">
    <div class="point">
      <div v-for="axis in AXES" :key="axis.name" class="axis">
        <span class="axis-name">{{ axis.name }}</span>
        <NumericInput
          :value="point[axis.index]"
          unit="mm"
          :invalid="field.issue !== null"
          @commit="emit('update', withCoordinate(point, axis.index, $event))"
        />
      </div>
    </div>
  </FieldShell>
</template>

<style scoped>
.point {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.axis {
  display: grid;
  grid-template-columns: 12px 1fr;
  align-items: center;
  gap: 6px;
}
.axis-name {
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
}
</style>

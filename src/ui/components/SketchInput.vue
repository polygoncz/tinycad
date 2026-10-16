<script setup lang="ts">
// The numeric input of a drawing tool over the view (spec 12, "Číselný vstup (M32)"): the fields
// of the current step as a row of small labels left and up from the cursor, like Fusion. What is
// drawn is SketchState.numericInput of sketcher; where it stands is the pure inputLayout of
// ../sketch-input over the projection of session.view.project, recomputed when the input changes
// and on every onViewChanged, like SketchGlyphs. The active field is highlighted, a locked one has
// a lock, an invalid one the error colour. The labels are no <input> and never take the pointer:
// the focus stays in the view, so the mouse and the keyboard work together. aria-live announces
// the typed values.
import { onMounted, onScopeDispose, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Vec3 } from '@/core';
import { useObservable } from '../composables/use-observable';
import { useSession } from '../composables/use-session';
import type { ScreenPoint } from '../manipulator-hud';
import { inputClasses, inputLabel, inputLayout } from '../sketch-input';
import type { InputPlacement, InputSketch } from '../sketch-input';

const props = defineProps<{ sketch: InputSketch }>();

const session = useSession();
const { t } = useI18n();
const state = useObservable(props.sketch.state);

const project = (world: Vec3): ScreenPoint | null => session.view.project(world);

function layout(): InputPlacement | null {
  return inputLayout(state.value.numericInput, project);
}

/** The row of the fields, or null. */
const placed = shallowRef(layout());

function place(): void {
  placed.value = layout();
}

watch(() => state.value.numericInput, place);
const offViewChanged = session.view.onViewChanged(place);
onScopeDispose(offViewChanged);
onMounted(place);
</script>

<template>
  <div class="sketch-input" aria-live="polite">
    <div
      v-if="placed !== null"
      class="row"
      :style="{ left: `${String(placed.at[0])}px`, top: `${String(placed.at[1])}px` }"
    >
      <span
        v-for="field in placed.fields"
        :key="field.id"
        class="field"
        :class="inputClasses(field)"
      >
        <span class="label">{{ inputLabel(t, field) }}</span>
        <span class="text">{{ field.text }}</span>
        <i v-if="field.locked" class="ti ti-lock" aria-hidden="true" />
      </span>
    </div>
  </div>
</template>

<style scoped>
.sketch-input {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
.row {
  position: absolute;
  transform: translate(-100%, -100%);
  display: flex;
  gap: 4px;
  white-space: nowrap;
}
.field {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 1px 5px;
  border: 0.5px solid var(--field-border);
  border-radius: 3px;
  background: var(--field-bg);
  color: var(--text-secondary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.field .text {
  color: var(--text-secondary);
}
.field.typed .text {
  color: var(--text-primary);
}
.field.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.field.invalid,
.field.invalid .text {
  border-color: var(--danger);
  color: var(--danger);
}
</style>

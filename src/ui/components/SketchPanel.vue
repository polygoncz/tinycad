<script setup lang="ts">
// The sketch panel (spec 11, "Komponenty"; M12): floats on the right instead of the feature
// dialog while the sketcher is open (AppShell mounts one panel per sketch session). The name of
// the sketch, the status of the last solve (role="status"), the message of the last refused
// command, the constraints – a dimension with its value field, click = select, × = remove – and
// Cancel / Finish (disabled while the session is busy, D8). Everything goes to the SketchSession;
// the status line is its statusKey, the row names come from ../sketch-panel.
// M19.2 D4: the values of the dimensions are shown rounded (formatDimension, the model stays
// exact) and the switch of snapping to the grid belongs to the sketcher (session.sketches), so it
// survives closing the sketch. The panel starts below the view cube (D8).
// M21 (Q076): the field "Plane" shows SketchState.planeField; a click is SketchSession.pickPlane
// (refPick covers the tools of the sketcher and a plane is picked in the view or the Browser),
// Esc on the field cancelPlanePick. A picked plane ends picking too (interaction). A sketch whose
// plane could not be computed (Q079) opens on XY with SketchState.planeMissing: an alert above
// the field asks for a new plane.
import { computed, nextTick, useId, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SketchConstraintRow, SketchSession } from '@/sketcher';
import { useObservable } from '../composables/use-observable';
import { useSession } from '../composables/use-session';
import { isAdditive } from '../item-actions';
import { constraintRowLabel } from '../sketch-panel';
import { formatDimension } from './params/field-values';
import NumericInput from './params/NumericInput.vue';

const props = defineProps<{ sketch: SketchSession }>();

const { t } = useI18n();
const session = useSession();
const state = useObservable(props.sketch.state);
const gridSnap = useObservable(session.sketches.gridSnap);
const planeLabelId = useId();
const planeButtonId = useId();
const planeField = computed(() => state.value.planeField);
const planeText = computed(() => {
  const text = planeField.value?.text ?? null;
  return text === null ? t('field.noRef') : t(text.key, text.params);
});

/** Esc on the field while picking ends picking (in the view refPick takes Esc itself). */
function onPlaneKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.sketch.cancelPlanePick()) e.preventDefault();
}

function toggleGridSnap(): void {
  session.sketches.setGridSnap(!gridSnap.value);
}

/** The text of a dimension field: rounded to two decimals; '' for a non-number. */
function dimensionText(value: unknown): string {
  return typeof value === 'number' ? formatDimension(value) : '';
}

function label(row: SketchConstraintRow): string {
  return constraintRowLabel(t, row);
}

/** Id of the row label: it names the value field of a dimension ("Vzdálenost 1"). */
function labelId(row: SketchConstraintRow): string {
  return `sketch-constraint-${row.id}`;
}

function select(row: SketchConstraintRow, e: MouseEvent): void {
  props.sketch.select(row.id, { additive: isAdditive(e) });
}

function remove(row: SketchConstraintRow): void {
  void props.sketch.remove([row.id]);
}

function setDimension(row: SketchConstraintRow, value: number): void {
  void props.sketch.setDimension(row.id, value);
}

// A dimension just made by the tool gets the focus of its field (spec 11, "Režim skici").
const list = useTemplateRef<HTMLElement>('list');
watch(
  () => state.value.editingDimension,
  async (id) => {
    if (id === null) return;
    await nextTick();
    const input = list.value?.querySelector<HTMLInputElement>(
      `[data-constraint="${CSS.escape(id)}"] input`,
    );
    input?.focus();
    input?.select();
    props.sketch.clearEditingDimension();
  },
  { immediate: true },
);
</script>

<template>
  <section class="sketch-panel" :aria-label="state.name">
    <header class="header">
      <i class="ti ti-pencil sketch-icon" aria-hidden="true" />
      <span class="title">{{ state.name }}</span>
    </header>

    <p class="status" :class="{ defined: state.fullyDefined }" role="status">
      {{ t(state.statusKey, state.statusParams) }}
    </p>
    <p v-if="state.message !== null" class="message" role="alert">{{ t(state.message.key) }}</p>

    <p v-if="state.planeMissing" class="message" role="alert">
      {{ t('sketch.planeMissing') }}
    </p>
    <div v-if="planeField !== null" class="plane">
      <span :id="planeLabelId" class="plane-label">{{ t(planeField.label) }}</span>
      <button
        :id="planeButtonId"
        type="button"
        class="plane-ref"
        :class="{ active: planeField.active, invalid: planeField.invalid }"
        :aria-labelledby="`${planeLabelId} ${planeButtonId}`"
        :aria-pressed="planeField.active"
        @click="sketch.pickPlane()"
        @keydown="onPlaneKey"
      >
        {{ planeText }}
      </button>
    </div>

    <div class="options">
      <button
        type="button"
        class="toggle"
        :class="{ on: gridSnap }"
        :aria-pressed="gridSnap"
        :title="t('sketchPanel.gridSnapHint')"
        @click="toggleGridSnap"
      >
        <i class="ti ti-grid-dots" aria-hidden="true" />
        {{ t('sketchPanel.gridSnap') }}
      </button>
    </div>

    <h3 class="section">{{ t('sketchPanel.constraints') }}</h3>
    <ul ref="list" class="constraints">
      <li
        v-for="row in state.constraintRows"
        :key="row.id"
        class="row"
        :class="{ selected: row.selected }"
        :data-constraint="row.id"
      >
        <button
          :id="labelId(row)"
          type="button"
          class="name"
          :aria-pressed="row.selected"
          @click="select(row, $event)"
        >
          {{ label(row) }}
        </button>
        <NumericInput
          v-if="row.value !== null"
          class="value"
          :value="row.value"
          unit="mm"
          :invalid="false"
          :labelledby="labelId(row)"
          :format="dimensionText"
          @commit="setDimension(row, $event)"
        />
        <button
          type="button"
          class="remove"
          :aria-label="t('sketchPanel.remove', { name: label(row) })"
          @click="remove(row)"
        >
          <i class="ti ti-x" aria-hidden="true" />
        </button>
      </li>
    </ul>

    <footer class="buttons">
      <button type="button" class="button" @click="sketch.cancel()">
        {{ t('sketch.cancel') }}
      </button>
      <button type="button" class="button primary" :disabled="state.busy" @click="sketch.finish()">
        {{ t('sketch.finish') }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.sketch-panel {
  position: absolute;
  right: 14px;
  top: var(--view-cube-reserve);
  z-index: 20;
  width: 280px;
  max-height: calc(100% - var(--view-cube-reserve) - 12px);
  overflow: auto;
  padding-bottom: 12px;
  border-radius: var(--radius-panel);
  background: var(--panel-bg);
  backdrop-filter: var(--panel-blur);
  -webkit-backdrop-filter: var(--panel-blur);
  border: 0.5px solid var(--panel-border);
  box-shadow:
    var(--panel-shadow),
    inset 0 0.5px 0 var(--panel-highlight);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--font-size);
}
.header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 10px 14px;
  border-bottom: 0.5px solid var(--panel-border);
}
.sketch-icon {
  font-size: 18px;
  color: var(--accent);
}
.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-small);
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.status,
.message {
  margin: 0 14px 6px;
}
.status {
  color: var(--text-secondary);
}
.status.defined {
  color: var(--accent);
}
.message {
  color: var(--danger);
  font-size: var(--font-size-small);
}
.plane {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 14px 6px;
}
.plane-label {
  color: var(--text-secondary);
}
.plane-ref {
  flex: 1;
  min-width: 0;
  height: var(--field-height);
  padding: 0 8px;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: var(--radius-control);
  background: var(--field-bg);
  border: 0.5px solid var(--field-border);
  color: var(--text-primary);
  font: inherit;
}
.plane-ref.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
  color: var(--accent);
}
.plane-ref.invalid {
  border-color: var(--danger);
}
.options {
  margin: 4px 14px 6px;
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--field-height);
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-control);
  background: none;
  color: var(--text-secondary);
  font: inherit;
}
.toggle:hover {
  background: var(--control-hover);
}
.toggle.on {
  background: var(--accent-soft);
  color: var(--accent);
}
.section {
  margin: 10px 14px 4px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.constraints {
  margin: 0;
  padding: 0 8px;
  list-style: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: var(--tree-row);
  padding: 2px 4px;
  border-radius: var(--radius-row);
}
/* A selected constraint is a selected entity: the colour of the selection (M19.2 D1). */
.row.selected {
  background: var(--selection-soft);
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  border: none;
  background: none;
  padding: 0;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.value {
  width: 96px;
}
.remove {
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border: none;
  border-radius: var(--radius-row);
  background: none;
  color: var(--text-secondary);
}
.remove:hover {
  background: var(--control-hover);
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px 0;
}
.button {
  height: var(--field-height);
  padding: 0 14px;
  border: none;
  border-radius: var(--radius-control);
  background: var(--control-hover);
  color: var(--text-primary);
  font: inherit;
  font-weight: 500;
}
.button.primary {
  background: var(--accent);
  color: var(--on-accent);
}
</style>

<script setup lang="ts">
// The sketch panel (spec 11, "Komponenty"; M12): floats on the right instead of the feature
// dialog while the sketcher is open (AppShell mounts one panel per sketch session). The name of
// the sketch, the status of the last solve (role="status"), the message of the last refused
// command, the constraints – a dimension with its value field, click = select, × = remove – and
// Cancel / Finish (disabled while the session is busy, D8). Everything goes to the SketchSession;
// the status line is its statusKey, the row names come from ../sketch-panel.
import { nextTick, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SketchConstraintRow, SketchSession } from '@/interaction';
import { useObservable } from '../composables/use-observable';
import { constraintRowLabel } from '../sketch-panel';
import NumericInput from './params/NumericInput.vue';

const props = defineProps<{ sketch: SketchSession }>();

const { t } = useI18n();
const state = useObservable(props.sketch.state);

function label(row: SketchConstraintRow): string {
  return constraintRowLabel(t, row);
}

/** Id of the row label: it names the value field of a dimension ("Vzdálenost 1"). */
function labelId(row: SketchConstraintRow): string {
  return `sketch-constraint-${row.id}`;
}

function select(row: SketchConstraintRow, e: MouseEvent): void {
  props.sketch.select(row.id, { additive: e.shiftKey || e.metaKey || e.ctrlKey });
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
  top: 12px;
  z-index: 20;
  width: 280px;
  max-height: calc(100% - 24px);
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
.row.selected {
  background: var(--accent-soft);
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

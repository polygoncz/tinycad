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
// M25 (spec 12, "Glyfy vazeb"): the list of constraints is a <details> section, collapsed by
// default (its state is not saved, it is not even bound: the element keeps it); the switch "Show
// constraints" above it is SketchEditor.showAllConstraints, next to the grid snap. A new dimension
// opens the section before its field takes the focus (focusNewDimension).
// M28: the field of an angle shows and takes degrees (the model keeps radians, ../sketch-dimensions).
// M37 (spec 12, "Text ve skice"): with exactly one text selected, the section "Text" edits its
// string, font and height (../sketch-text-panel): Enter or leaving a field commits a changed valid
// value through setTextParams, Esc and anything not committed show the value of the text again.
// A text the Text tool has just written and selected gets the focus of its string field.
import { computed, nextTick, ref, useId, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SketchConstraintRow, SketchSession } from '@/sketcher';
import { useObservable } from '../composables/use-observable';
import { useSession } from '../composables/use-session';
import { isAdditive } from '../item-actions';
import { dimensionUnit, fromShownValue, toShownValue } from '../sketch-dimensions';
import { constraintRowLabel, focusNewDimension, toggleShowAllConstraints } from '../sketch-panel';
import {
  createNewTextFocus,
  selectedText,
  textCommit,
  textFieldText,
  textFontLabel,
} from '../sketch-text-panel';
import type { TextField } from '../sketch-text-panel';
import { SKETCH_TEXT_FONTS } from '@/sketcher/constants';
import { formatDimension } from './params/field-values';
import NumericInput from './params/NumericInput.vue';

const props = defineProps<{ sketch: SketchSession }>();

const { t } = useI18n();
const session = useSession();
const state = useObservable(props.sketch.state);
const gridSnap = useObservable(session.sketches.gridSnap);
const showAllConstraints = useObservable(session.sketches.showAllConstraints);
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

function toggleShowAll(): void {
  toggleShowAllConstraints(session.sketches);
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

/** The value of a dimension row as the field shows it (M28: an angle in degrees). */
function shownValue(row: SketchConstraintRow): number | null {
  return row.value === null ? null : toShownValue(row.kind, row.value);
}

/** The typed value is in the units of the field: an angle goes to the model in radians. */
function setDimension(row: SketchConstraintRow, value: number): void {
  void props.sketch.setDimension(row.id, fromShownValue(row.kind, value));
}

// A dimension just made by the tool gets the focus of its field (spec 11, "Režim skici"); the
// collapsed list opens for it first (M25).
const section = useTemplateRef<HTMLDetailsElement>('section');
const list = useTemplateRef<HTMLElement>('list');
watch(
  () => state.value.editingDimension,
  async (id) => {
    if (id === null) return;
    await focusNewDimension(
      nextTick,
      () => section.value,
      () =>
        list.value?.querySelector<HTMLInputElement>(
          `[data-constraint="${CSS.escape(id)}"] input`,
        ) ?? null,
    );
    props.sketch.clearEditingDimension();
  },
  { immediate: true },
);

// The section "Text": the typed values are local strings (pure UI state), set from the text
// whenever one of its values changes.
const text = computed(() => selectedText(state.value));
const textSectionId = useId();
const textValueId = useId();
const textFontId = useId();
const textHeightId = useId();
const drafts = ref<Record<TextField, string>>({ text: '', font: '', height: '' });
// Each value is a source of its own, compared by value: a new snapshot with the same values (the
// read model of an answer, M52) keeps what is being typed.
watch(
  [() => text.value?.id, () => text.value?.text, () => text.value?.font, () => text.value?.height],
  () => {
    revert('text');
    revert('font');
    revert('height');
  },
  { immediate: true },
);

/** The field shows the value of the selected text again. */
function revert(field: TextField): void {
  const current = text.value;
  drafts.value[field] = current === null ? '' : textFieldText(field, current);
}

/** A changed valid value goes to the session; otherwise, or when refused, the field reverts. */
async function commit(field: TextField): Promise<void> {
  const current = text.value;
  if (current === null) return;
  const params = textCommit(field, drafts.value[field], current);
  if (params === null || !(await props.sketch.setTextParams(current.id, params))) revert(field);
}

// The Text tool selects the text it wrote; its string field then takes the focus with the text
// selected, so typing replaces it (spec 12, "Nástroj Text").
const textValue = useTemplateRef<HTMLInputElement>('textValue');
const newTextFocus = createNewTextFocus(state.value);
// Sync: the tracker reads every state of the session, also two in one tick (write, then select).
watch(
  state,
  async (s) => {
    if (newTextFocus(s) === null) return;
    // After the tick the section and its field exist.
    await nextTick();
    textValue.value?.focus();
    textValue.value?.select();
  },
  { flush: 'sync' },
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
      <button
        type="button"
        class="toggle"
        :class="{ on: showAllConstraints }"
        :aria-pressed="showAllConstraints"
        :title="t('sketchPanel.showConstraintsHint')"
        @click="toggleShowAll"
      >
        <i class="ti ti-link" aria-hidden="true" />
        {{ t('sketchPanel.showConstraints') }}
      </button>
    </div>

    <section v-if="text !== null" class="text" :aria-labelledby="textSectionId">
      <h3 :id="textSectionId" class="section">{{ t('sketch.text.section') }}</h3>
      <div class="text-row">
        <label :for="textValueId" class="text-label">{{ t('sketch.text.value') }}</label>
        <span class="text-field">
          <input
            :id="textValueId"
            ref="textValue"
            v-model="drafts.text"
            type="text"
            @change="commit('text')"
            @keydown.escape="revert('text')"
          />
        </span>
      </div>
      <div class="text-row">
        <label :for="textFontId" class="text-label">{{ t('sketch.text.font') }}</label>
        <span class="text-field">
          <select :id="textFontId" v-model="drafts.font" @change="commit('font')">
            <option v-for="font in SKETCH_TEXT_FONTS" :key="font" :value="font">
              {{ textFontLabel(t, font) }}
            </option>
          </select>
        </span>
      </div>
      <div class="text-row">
        <label :for="textHeightId" class="text-label">{{ t('sketch.text.height') }}</label>
        <span class="text-field">
          <input
            :id="textHeightId"
            v-model="drafts.height"
            type="text"
            inputmode="decimal"
            @change="commit('height')"
            @keydown.escape="revert('height')"
          />
          <span class="unit">mm</span>
        </span>
      </div>
    </section>

    <details ref="section">
      <summary class="section">{{ t('sketchPanel.constraints') }}</summary>
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
            :value="shownValue(row)"
            :unit="dimensionUnit(row.kind)"
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
    </details>

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
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
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
  cursor: default;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.text {
  margin: 0 0 6px;
}
.text-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 14px;
}
.text-label {
  width: 56px;
  color: var(--text-secondary);
}
.text-field {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  height: var(--field-height);
  padding: 0 8px;
  border-radius: var(--radius-control);
  background: var(--field-bg);
  border: 0.5px solid var(--field-border);
}
.text-field:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.text-field input,
.text-field select {
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

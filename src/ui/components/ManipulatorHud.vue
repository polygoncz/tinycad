<script setup lang="ts">
// The HUD of the manipulator (spec 11, rule 8): the mode bar and the value field over the view.
// What it shows is the presentation model session.manipulator.hud (spec 10, "Režimy a HUD
// (M19)"); where it stands is the pure functions of manipulator-hud.ts over the projections of
// session.manipulator.project. The positions are recomputed when hud changes and on every
// onViewChanged, which comes each frame of a camera animation: then only the positions change,
// hud stays (M19 plan, "Na co si dát pozor" 6).
// The container ignores the pointer, only the bar and the field take it, so the view under the
// rest of the HUD still orbits and picks. The input is a text input: the global keyboard sees
// inTextField and leaves its keys alone (AppShell, ActionRegistry.handleKey).
import { computed, onMounted, onScopeDispose, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useObservable } from '../composables/use-observable';
import { useSession } from '../composables/use-session';
import { axisLetter, fieldCommit, fieldText, hudLayout } from '../manipulator-hud';
import type { HudLayout } from '../manipulator-hud';

const session = useSession();
const { t } = useI18n();
const hud = useObservable(session.manipulator.hud);

const root = useTemplateRef<HTMLElement>('root');
const bar = useTemplateRef<HTMLElement>('bar');
const input = useTemplateRef<HTMLInputElement>('input');

/** Top left corner of the bar and center of the field in px of the view; null = hidden. */
const layout = shallowRef<HudLayout>({ barAt: null, fieldAt: null });

const field = computed(() => hud.value?.field ?? null);
const modes = computed(() => hud.value?.modes ?? []);

/** The text of the input: typed text while editing, otherwise the value of the field. */
const text = ref(fieldText(field.value));
watch(
  () => fieldText(field.value),
  (next) => {
    text.value = next;
  },
);

function place(): void {
  const el = root.value;
  // Before the mount there is no area to place into; onMounted places then.
  if (el === null) return;
  const b = bar.value;
  layout.value = hudLayout(
    hud.value,
    (world) => session.manipulator.project(world),
    { width: el.clientWidth, height: el.clientHeight },
    b === null ? null : { width: b.offsetWidth, height: b.offsetHeight },
  );
}

// After the DOM update, so the bar of new modes can be measured.
watch(hud, place, { flush: 'post' });
const offViewChanged = session.manipulator.onViewChanged(place);
onScopeDispose(offViewChanged);
// The first placement: the root is in the DOM only after the mount.
onMounted(place);

function setMode(id: string): void {
  session.manipulator.setMode(id);
}

/** Enter or blur: a valid changed number goes to setValue, anything else brings back the value. */
function commit(): void {
  const f = field.value;
  if (f === null) return;
  const value = fieldCommit(text.value, f);
  if (value !== null) session.manipulator.setValue(f.handleId, value);
  // A changed value comes back through hud at once (the watch above); otherwise show it again.
  text.value = fieldText(field.value);
}

function cancel(): void {
  text.value = fieldText(field.value);
  input.value?.blur();
}
</script>

<template>
  <div ref="root" class="manipulator-hud">
    <div
      v-if="modes.length > 0"
      ref="bar"
      class="modes"
      :class="{ hidden: layout.barAt === null }"
      :style="
        layout.barAt === null
          ? undefined
          : { left: `${layout.barAt[0]}px`, top: `${layout.barAt[1]}px` }
      "
    >
      <button
        v-for="mode in modes"
        :key="mode.id"
        type="button"
        class="mode"
        :class="{ active: mode.active }"
        :aria-label="t(mode.label)"
        :aria-pressed="mode.active"
        @click="setMode(mode.id)"
      >
        <i class="ti" :class="`ti-${mode.icon}`" aria-hidden="true" />
        <span class="tip" role="tooltip">{{ t(mode.label) }}</span>
      </button>
    </div>
    <label
      v-if="field !== null && layout.fieldAt !== null"
      class="field"
      :class="{ dragging: field.dragging }"
      :style="{ left: `${layout.fieldAt[0]}px`, top: `${layout.fieldAt[1]}px` }"
    >
      <span v-if="axisLetter(field.tint) !== null" class="axis" aria-hidden="true">
        {{ axisLetter(field.tint) }}
      </span>
      <input
        ref="input"
        v-model="text"
        type="text"
        inputmode="decimal"
        :readonly="field.dragging"
        :aria-label="t('manipulator.field.label')"
        @keydown.enter="commit"
        @keydown.esc="cancel"
        @blur="commit"
      />
      <span class="unit">{{ field.unit === 'length' ? 'mm' : '°' }}</span>
    </label>
  </div>
</template>

<style scoped>
.manipulator-hud {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
.modes {
  position: absolute;
  display: flex;
  gap: 1px;
  padding: 3px;
  border-radius: var(--radius-button);
  background: var(--chrome-bg);
  backdrop-filter: var(--chrome-blur);
  -webkit-backdrop-filter: var(--chrome-blur);
  border: 0.5px solid var(--chrome-border);
  box-shadow: var(--panel-shadow);
  pointer-events: auto;
}
.modes.hidden {
  visibility: hidden;
  pointer-events: none;
}
.mode {
  position: relative;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-control);
  background: none;
  color: var(--text-primary);
  font-size: 18px;
}
.mode:hover {
  background: var(--control-hover);
}
.mode.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.tip {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  z-index: 50;
  transform: translateX(-50%);
  display: none;
  padding: 4px 8px;
  border-radius: var(--radius-row);
  background: var(--tooltip-bg);
  color: var(--tooltip-text);
  font-family: var(--font-ui);
  font-size: var(--font-size-small);
  white-space: nowrap;
  pointer-events: none;
}
.mode:hover .tip {
  display: block;
}
.field {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 6px;
  height: var(--field-height);
  padding: 0 8px;
  border-radius: var(--radius-control);
  background: var(--chrome-bg);
  backdrop-filter: var(--chrome-blur);
  -webkit-backdrop-filter: var(--chrome-blur);
  border: 0.5px solid var(--chrome-border);
  box-shadow: var(--panel-shadow);
  font-family: var(--font-ui);
  font-size: var(--font-size);
  color: var(--text-primary);
  pointer-events: auto;
}
.field:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.axis {
  font-weight: 600;
  color: var(--text-secondary);
}
input {
  width: 64px;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: right;
}
.field.dragging input {
  cursor: default;
}
.unit {
  color: var(--text-tertiary);
}
</style>

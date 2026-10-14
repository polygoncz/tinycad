<script setup lang="ts">
// The feature dialog (spec 11, "Komponenty"; spec 10, "Dialog featury"): a floating panel on the
// right, shown while features.current is a session (AppShell mounts one dialog per session).
// The form is generated from the schema through the ParamField registry (hidden fields left out,
// groups with a heading, M13); every change goes to the session (setParam, removeRef,
// focusRefParam, commit, cancel). Movable by its header; the offset is view state of this panel
// only. Enter is OK and Esc is Cancel while the focus is in
// the dialog. On opening the first field gets the focus (spec 11, "Přístupnost"), so the keys
// work at once.
import { computed, onMounted, ref, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FeatureEditSession, FieldState } from '@/interaction';
import { useObservable } from '../composables/use-observable';
import { paramFieldFor } from './params/registry';

const props = defineProps<{ edit: FeatureEditSession }>();

const { t } = useI18n();
const state = useObservable(props.edit.state);

const icon = computed(() => `ti-${props.edit.schema.icon ?? 'cube'}`);
// The name of the feature from the session (generated on create, spec 10 "Dialog featury").
const title = computed(() => state.value.name);

// Hidden fields are not drawn (M13); a group gets its heading before its first visible field –
// a group other than that of the previous visible field, null = no heading (spec 11, "Skrytá
// pole a skupiny"). The rule which field is hidden lives in interaction (FieldState.hidden).
const rows = computed(() => {
  let group: string | null = null;
  return (
    state.value.fields
      // A field without a component ('data') is skipped like a hidden one.
      .filter((field) => !field.hidden && paramFieldFor(field.spec.kind) !== undefined)
      .map((field) => {
        const heading = field.group !== null && field.group !== group ? field.group : null;
        group = field.group;
        return { field, heading };
      })
  );
});

function update(field: FieldState, value: unknown): void {
  props.edit.setParam(field.name, value);
}

function remove(field: FieldState, index: number): void {
  props.edit.removeRef(field.name, index);
}

function activate(field: FieldState): void {
  props.edit.focusRefParam(field.name);
}

// Keys of the dialog (spec 11, "Komponenty"). Enter in a field must first confirm the typed value:
// fields report it on change, which the browser fires only after keydown. Leaving the field fires
// change synchronously, so blur() stores the value (setParam) before commit. Enter on a button
// keeps its own meaning (Cancel stays Cancel). preventDefault also keeps the keys from the global
// shortcuts in AppShell and from the active tool.
function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.isComposing) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    props.edit.cancel();
  } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
    e.preventDefault();
    if (e.target instanceof HTMLElement) e.target.blur();
    props.edit.commit();
  }
}

// The first control of the form; a dialog without fields keeps the focus where it was.
const fields = useTemplateRef<HTMLElement>('fields');
onMounted(() => {
  fields.value?.querySelector<HTMLElement>('input, select, button')?.focus();
});

// Moving by the header: pointer capture, the offset from the docked position.
const offset = ref({ x: 0, y: 0 });
let drag: { readonly x: number; readonly y: number; readonly pointerId: number } | null = null;

function onGripDown(e: PointerEvent): void {
  if (e.button !== 0 || !(e.currentTarget instanceof Element)) return;
  e.currentTarget.setPointerCapture(e.pointerId);
  drag = { x: e.clientX - offset.value.x, y: e.clientY - offset.value.y, pointerId: e.pointerId };
}

function onGripMove(e: PointerEvent): void {
  if (drag?.pointerId !== e.pointerId) return;
  offset.value = { x: e.clientX - drag.x, y: e.clientY - drag.y };
}

function onGripUp(): void {
  drag = null;
}
</script>

<template>
  <section
    class="feature-dialog"
    role="dialog"
    :aria-label="title"
    :style="{ transform: `translate(${String(offset.x)}px, ${String(offset.y)}px)` }"
    @keydown="onKeyDown"
  >
    <header
      class="header"
      :title="t('dialog.move')"
      @pointerdown="onGripDown"
      @pointermove="onGripMove"
      @pointerup="onGripUp"
      @pointercancel="onGripUp"
    >
      <i class="ti feature-icon" :class="icon" aria-hidden="true" />
      <span class="title">{{ title }}</span>
      <i class="ti ti-grip-horizontal grip" aria-hidden="true" />
    </header>

    <div ref="fields" class="fields">
      <template v-for="{ field, heading } in rows" :key="field.name">
        <div v-if="heading !== null" class="group-heading" role="heading" aria-level="3">
          {{ t(heading) }}
        </div>
        <component
          :is="paramFieldFor(field.spec.kind)"
          v-if="paramFieldFor(field.spec.kind) !== undefined"
          :field="field"
          @update="update(field, $event)"
          @activate="activate(field)"
          @remove="remove(field, $event)"
        />
      </template>
    </div>

    <footer class="buttons">
      <button type="button" class="button" @click="edit.cancel()">{{ t('dialog.cancel') }}</button>
      <button type="button" class="button primary" @click="edit.commit()">
        {{ t('dialog.ok') }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.feature-dialog {
  position: absolute;
  right: 14px;
  top: 12px;
  z-index: 20;
  width: 280px;
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
  margin-bottom: 12px;
  padding: 10px 14px;
  border-bottom: 0.5px solid var(--panel-border);
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.header:active {
  cursor: grabbing;
}
.feature-icon {
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
.grip {
  color: var(--text-tertiary);
}
.group-heading {
  margin: 14px 14px 8px;
  padding-top: 10px;
  border-top: 0.5px solid var(--panel-border);
  color: var(--text-secondary);
  font-size: var(--font-size-small);
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 6px 14px 0;
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

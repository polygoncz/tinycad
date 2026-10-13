<script setup lang="ts">
// The Timeline (spec 11, "Komponenty"): FeatureTreeModel drawn horizontally, docked at the
// bottom. Only bindings and layout (rule 4): the rows, the bar and the step actions come from
// the session, every change goes back through featureTree or actions. On the right the state
// of the regeneration, the body count and the selection (replaces a status bar).
import { computed, ref, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FeatureId } from '@/document';
import type { ActionState } from '@/interaction';
import { useObservable } from '../composables/use-observable';
import { useSession } from '../composables/use-session';
import TimelineItem from './TimelineItem.vue';

const session = useSession();
const { featureTree, actions } = session;
const { t } = useI18n();

const rows = useObservable(featureTree.rows);
const rollbackIndex = useObservable(featureTree.rollbackIndex);
const actionStates = useObservable(actions.actions);
const regen = useObservable(session.regen);
const selection = useObservable(session.selection.items);
const editSession = useObservable(session.features.current);

/** The step buttons; the actions are registered by app (M10, Ú7). */
const STEPS = Object.freeze([
  { id: 'timeline.toStart', icon: 'ti-player-skip-back' },
  { id: 'timeline.stepBack', icon: 'ti-player-track-prev' },
  { id: 'timeline.stepForward', icon: 'ti-player-track-next' },
  { id: 'timeline.toEnd', icon: 'ti-player-skip-forward' },
]);

function actionState(id: string): ActionState | undefined {
  return actionStates.value.find((a) => a.id === id);
}

function runStep(id: string): void {
  if (actionState(id)?.enabled === true) actions.run(id);
}

// While the feature dialog is open the dispatcher is in a transaction and refuses the bar
// and a second edit (spec 10, "Strom featur"); read-only refuses every change.
const locked = computed(() => session.readOnly || editSession.value !== null);

function select(id: FeatureId, additive: boolean): void {
  featureTree.select(id, { additive });
}

function edit(id: FeatureId): void {
  if (!locked.value) featureTree.edit(id);
}

// Dragging the rollback marker: only the position under the pointer is local view state;
// the bar moves in the document once, on release.
const itemsEl = useTemplateRef<HTMLElement>('items');
const dragIndex = ref<number | null>(null);
const barIndex = computed(() => dragIndex.value ?? rollbackIndex.value);

/** Number of features whose centre is left of `clientX` = bar index under the pointer. */
function indexAt(clientX: number): number {
  const items = itemsEl.value?.querySelectorAll('.timeline-item') ?? [];
  let index = 0;
  for (const item of items) {
    const box = item.getBoundingClientRect();
    if (clientX > box.left + box.width / 2) index++;
  }
  return index;
}

function onBarDown(e: PointerEvent): void {
  if (locked.value || e.button !== 0) return;
  if (e.currentTarget instanceof Element) e.currentTarget.setPointerCapture(e.pointerId);
  dragIndex.value = rollbackIndex.value;
}

function onBarMove(e: PointerEvent): void {
  if (dragIndex.value === null) return;
  dragIndex.value = indexAt(e.clientX);
}

function onBarUp(): void {
  const target = dragIndex.value;
  dragIndex.value = null;
  if (target !== null && target !== rollbackIndex.value) featureTree.moveRollbackBar(target);
}

function onBarCancel(): void {
  dragIndex.value = null;
}
</script>

<template>
  <footer class="timeline">
    <button
      v-for="step in STEPS"
      :key="step.id"
      type="button"
      class="step"
      :title="actionState(step.id) ? t(actionState(step.id)?.label ?? '') : undefined"
      :disabled="actionState(step.id)?.enabled !== true"
      @click="runStep(step.id)"
    >
      <i class="ti" :class="step.icon" />
    </button>
    <div class="separator" />

    <div ref="items" class="items">
      <template v-for="(row, i) in rows" :key="row.id">
        <div
          v-if="i === barIndex"
          class="bar"
          :class="{ dragging: dragIndex !== null, locked }"
          :title="t('timeline.rollbackBar')"
          @pointerdown="onBarDown"
          @pointermove="onBarMove"
          @pointerup="onBarUp"
          @pointercancel="onBarCancel"
        />
        <TimelineItem :row="row" @select="select(row.id, $event)" @edit="edit(row.id)" />
      </template>
      <div
        v-if="barIndex >= rows.length"
        class="bar"
        :class="{ dragging: dragIndex !== null, locked }"
        :title="t('timeline.rollbackBar')"
        @pointerdown="onBarDown"
        @pointermove="onBarMove"
        @pointerup="onBarUp"
        @pointercancel="onBarCancel"
      />
    </div>

    <div class="status">
      <span v-if="regen.busy" class="busy">
        <i class="ti ti-loader-2" /> {{ t('timeline.regen.busy') }}
      </span>
      <span v-else-if="regen.errorCount > 0" class="errors">
        <i class="ti ti-alert-triangle" /> {{ t('timeline.regen.errors', { n: regen.errorCount }) }}
      </span>
      <span v-else-if="regen.lastMs !== null">
        <i class="ti ti-check ok" /> {{ t('timeline.regen.ms', { ms: Math.round(regen.lastMs) }) }}
      </span>
      <span>{{ t('timeline.bodies', { n: regen.bodyCount }) }}</span>
      <span v-if="selection.length > 0">{{ t('timeline.selected', { n: selection.length }) }}</span>
    </div>
  </footer>
</template>

<style scoped>
.timeline {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 52px;
  padding: 0 10px;
  background: var(--chrome-bg);
  backdrop-filter: var(--chrome-blur);
  -webkit-backdrop-filter: var(--chrome-blur);
  border-top: 0.5px solid var(--chrome-border);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--font-size);
}
.step {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-row);
  background: none;
  color: var(--text-secondary);
  font-size: 17px;
}
.step:hover:not(:disabled) {
  background: var(--control-hover);
}
.step:disabled {
  color: var(--text-tertiary);
}
.separator {
  width: 1px;
  height: 26px;
  margin: 0 8px;
  background: var(--chrome-border);
}
.items {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  height: 100%;
}
.bar {
  position: relative;
  flex: none;
  width: 10px;
  height: 40px;
  cursor: ew-resize;
  touch-action: none;
}
.bar::before {
  content: '';
  position: absolute;
  left: 3.5px;
  top: 0;
  width: 3px;
  height: 100%;
  border-radius: 2px;
  background: var(--accent);
}
.bar::after {
  content: '';
  position: absolute;
  left: -1px;
  top: -4px;
  width: 12px;
  height: 10px;
  background: var(--accent);
  clip-path: polygon(0 0, 100% 0, 50% 100%);
}
.bar.dragging {
  opacity: 0.7;
}
.bar.locked {
  cursor: default;
}
.status {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}
.errors {
  color: var(--danger);
}
.ok {
  color: var(--success);
}
</style>

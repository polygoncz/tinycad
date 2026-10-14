<script setup lang="ts">
// The Timeline (spec 11, "Komponenty"): FeatureTreeModel drawn horizontally, docked at the
// bottom. Only bindings and layout (rule 4): the rows, the bar and the step actions come from
// the session, every change goes back through featureTree or actions. On the right the state
// of the regeneration, the body count and the selection (replaces a status bar).
import { computed, onUnmounted, ref, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FeatureId } from '@/document';
import type { ActionState } from '@/interaction';
import { useObservable } from '../composables/use-observable';
import { useSession } from '../composables/use-session';
import { rollbackIndexAt } from '../rollback-bar';
import ContextMenu from './ContextMenu.vue';
import TimelineItem from './TimelineItem.vue';

const session = useSession();
const { featureTree, actions, actionIds } = session;
const { t } = useI18n();

const rows = useObservable(featureTree.rows);
const rollbackIndex = useObservable(featureTree.rollbackIndex);
const actionStates = useObservable(actions.actions);
const regen = useObservable(session.regen);
const selection = useObservable(session.selection.items);
// Read-only or the feature dialog is open (spec 10, "Vestavěné akce"): the bar is drawn disabled.
// The commands guard the lock themselves (FeatureTreeModel), the view only binds it.
const locked = useObservable(session.locked);
const renamingId = useObservable(featureTree.renaming);

/** The step buttons; the actions are the built-in ones of interaction. */
const STEPS = Object.freeze([
  { id: actionIds.toStart, icon: 'ti-player-skip-back' },
  { id: actionIds.stepBack, icon: 'ti-player-track-prev' },
  { id: actionIds.stepForward, icon: 'ti-player-track-next' },
  { id: actionIds.toEnd, icon: 'ti-player-skip-forward' },
]);

function actionState(id: string): ActionState | undefined {
  return actionStates.value.find((a) => a.id === id);
}

function runStep(id: string): void {
  if (actionState(id)?.enabled === true) actions.run(id);
}

function select(id: FeatureId, additive: boolean): void {
  featureTree.select(id, { additive });
}

// Context menu of a feature (spec 10, "Vestavěné akce"): the snapshot of the actions of the group
// 'feature'. The right button selects the feature first, so the actions work on the selection;
// rename puts the feature into the rename mode of the tree, which shows the inline field.
const FEATURE_GROUP = 'feature';
const menu = ref<{ readonly x: number; readonly y: number } | null>(null);
const menuItems = computed((): readonly ActionState[] =>
  actionStates.value.filter((a) => a.group === FEATURE_GROUP),
);

function openMenu(id: FeatureId, e: MouseEvent): void {
  featureTree.select(id);
  menu.value = { x: e.clientX, y: e.clientY };
}

function runMenuItem(actionId: string): void {
  actions.run(actionId);
}

// Dragging the rollback marker (revision C2). The bar is one element for the whole drag, placed
// among the features by the flex order: re-creating it at every index dropped its pointer
// capture, so a drag over two features got stuck after one step. Move, up and cancel are heard on
// the window from the press until the release. Only the index under the pointer is local view
// state; the bar moves in the document once, on release.
const itemsEl = useTemplateRef<HTMLElement>('items');
const barEl = useTemplateRef<HTMLElement>('bar');
const dragIndex = ref<number | null>(null);
const barIndex = computed(() => dragIndex.value ?? rollbackIndex.value);
/** Removes the window listeners of the drag in progress; null when there is no drag. */
let stopDrag: (() => void) | null = null;

/** The bar index under the pointer, from the boxes of the features (the items but the bar). */
function indexAt(clientX: number): number {
  const boxes = Array.from(itemsEl.value?.children ?? [])
    .filter((el) => el !== barEl.value)
    .map((el) => el.getBoundingClientRect());
  return rollbackIndexAt(clientX, boxes);
}

function onBarDown(e: PointerEvent): void {
  if (e.button !== 0 || stopDrag !== null) return;
  const { pointerId } = e;
  const onMove = (ev: PointerEvent): void => {
    if (ev.pointerId === pointerId) dragIndex.value = indexAt(ev.clientX);
  };
  const onUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return;
    const target = dragIndex.value;
    endDrag();
    if (target !== null && target !== rollbackIndex.value) featureTree.moveRollbackBar(target);
  };
  const onCancel = (ev: PointerEvent): void => {
    if (ev.pointerId === pointerId) endDrag();
  };
  globalThis.addEventListener('pointermove', onMove);
  globalThis.addEventListener('pointerup', onUp);
  globalThis.addEventListener('pointercancel', onCancel);
  stopDrag = () => {
    globalThis.removeEventListener('pointermove', onMove);
    globalThis.removeEventListener('pointerup', onUp);
    globalThis.removeEventListener('pointercancel', onCancel);
  };
  // The capture keeps the moves and the release coming while the pointer is outside the window.
  barEl.value?.setPointerCapture(pointerId);
  dragIndex.value = rollbackIndex.value;
}

/** Ends the drag without moving the bar in the document: it is back at the rollback index. */
function endDrag(): void {
  stopDrag?.();
  stopDrag = null;
  dragIndex.value = null;
}

onUnmounted(endDrag);
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
      <i class="ti" :class="step.icon" aria-hidden="true" />
    </button>
    <div class="separator" />

    <div ref="items" class="items">
      <div
        ref="bar"
        class="bar"
        :class="{ dragging: dragIndex !== null, locked }"
        :style="{ order: 2 * barIndex }"
        :title="t('timeline.rollbackBar')"
        @pointerdown="onBarDown"
      />
      <TimelineItem
        v-for="(row, i) in rows"
        :key="row.id"
        :style="{ order: 2 * i + 1 }"
        :row="row"
        :renaming="renamingId === row.id"
        @select="select(row.id, $event)"
        @edit="featureTree.edit(row.id)"
        @menu="openMenu(row.id, $event)"
        @rename="featureTree.rename(row.id, $event)"
        @cancel-rename="featureTree.cancelRename()"
      />
    </div>

    <ContextMenu
      v-if="menu !== null"
      :items="menuItems"
      :x="menu.x"
      :y="menu.y"
      @run="runMenuItem"
      @close="menu = null"
    />

    <div class="status">
      <span v-if="regen.busy" class="busy">
        <i class="ti ti-loader-2" aria-hidden="true" /> {{ t('timeline.regen.busy') }}
      </span>
      <span v-else-if="regen.errorCount > 0" class="errors">
        <i class="ti ti-alert-triangle" aria-hidden="true" />
        {{ t('timeline.regen.errors', { n: regen.errorCount }) }}
      </span>
      <span v-else-if="regen.lastMs !== null">
        <i class="ti ti-check ok" aria-hidden="true" />
        {{ t('timeline.regen.ms', { ms: Math.round(regen.lastMs) }) }}
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
/* Disabled while locked: the drag does not even start (FeatureTreeModel would ignore it). */
.bar.locked {
  pointer-events: none;
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

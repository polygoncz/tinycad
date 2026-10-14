<script setup lang="ts">
// The Timeline (spec 11, "Komponenty"): FeatureTreeModel drawn horizontally, docked at the
// bottom. Only bindings and layout (rule 4): the rows, the bar and the step actions come from
// the session, every change goes back through featureTree or actions. On the right the state
// of the regeneration, the body count and the selection (replaces a status bar).
// M19.2: the items scroll (D10, wheel and edge buttons, scrollButtons) and never cover the status;
// one tooltip for the whole Timeline is teleported to <body> and placed in the window
// (D9, placeTooltip); the items are a toolbar with a roving tabindex and keys (D14, rovingNext).
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue';
import { useI18n } from 'vue-i18n';
import type { FeatureId } from '@/document';
import type { ActionState, TreeRow } from '@/interaction';
import { useObservable } from '../composables/use-observable';
import { useSession } from '../composables/use-session';
import { issueText } from '../i18n/i18n';
import { rollbackIndexAt } from '../rollback-bar';
import { isAdditive, runOnSelected } from '../item-actions';
import { rovingActive, rovingNext } from '../roving-focus';
import { scrollButtons } from '../timeline-scroll';
import type { ScrollButtons } from '../timeline-scroll';
import { placeTooltip } from '../tooltip-position';
import type { TooltipPlacement } from '../tooltip-position';
import ContextMenu from './ContextMenu.vue';
import TimelineItem from './TimelineItem.vue';

const session = useSession();
const { featureTree, actions, actionIds } = session;
const { t } = useI18n();

const rows = useObservable(featureTree.rows);
const rollbackIndex = useObservable(featureTree.rollbackIndex);
const actionStates = useObservable(actions.actions);
const regen = useObservable(session.regen);
// From the tree, not the regeneration: a draft is not an error (D6 of M19.2).
const errorCount = useObservable(featureTree.errorCount);
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

const itemsEl = useTemplateRef<HTMLElement>('items');
const barEl = useTemplateRef<HTMLElement>('bar');

/** The elements of the features in the order of the rows (the items but the bar). */
function itemElements(): HTMLElement[] {
  return Array.from(itemsEl.value?.children ?? []).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el !== barEl.value,
  );
}

// Context menu of a feature (spec 10, "Vestavěné akce"): the snapshot of the actions of the group
// 'feature'. The right button selects the feature first, so the actions work on the selection;
// rename puts the feature into the rename mode of the tree, which shows the inline field.
const FEATURE_GROUP = 'feature';
const menu = ref<{ readonly x: number; readonly y: number } | null>(null);
const menuItems = computed((): readonly ActionState[] =>
  actionStates.value.filter((a) => a.group === FEATURE_GROUP),
);

function openMenu(id: FeatureId, x: number, y: number): void {
  featureTree.select(id);
  menu.value = { x, y };
}

function runMenuItem(actionId: string): void {
  actions.run(actionId);
}

// Dragging the rollback marker (revision C2). The bar is one element for the whole drag, placed
// among the features by the flex order: re-creating it at every index dropped its pointer
// capture, so a drag over two features got stuck after one step. Move, up and cancel are heard on
// the window from the press until the release. Only the index under the pointer is local view
// state; the bar moves in the document once, on release.
const dragIndex = ref<number | null>(null);
const barIndex = computed(() => dragIndex.value ?? rollbackIndex.value);
/** Removes the window listeners of the drag in progress; null when there is no drag. */
let stopDrag: (() => void) | null = null;

/** The bar index under the pointer, from the boxes of the features. */
function indexAt(clientX: number): number {
  return rollbackIndexAt(
    clientX,
    itemElements().map((el) => el.getBoundingClientRect()),
  );
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

// The bar from the keyboard (D14): ← and → are the step buttons (the actions stepBack and
// stepForward decide the end of the list and the lock). preventDefault keeps the arrows from the
// global keyboard and scrolling.
function onBarKeyDown(e: KeyboardEvent): void {
  const id =
    e.key === 'ArrowLeft'
      ? actionIds.stepBack
      : e.key === 'ArrowRight'
        ? actionIds.stepForward
        : null;
  if (id === null) return;
  e.preventDefault();
  if (dragIndex.value === null) actions.run(id);
}

// Overflow (D10): the items scroll horizontally with a hidden scrollbar; the wheel scrolls them
// and the edge buttons show only when there is somewhere to go. The state is measured on scroll,
// on resize of the container and after the rows change.
const scroll = shallowRef<ScrollButtons>({ left: false, right: false });
/** The share of the visible width one click of an edge button scrolls by. */
const SCROLL_STEP = 0.8;

function measureScroll(): void {
  const el = itemsEl.value;
  if (el === null) return;
  scroll.value = scrollButtons(el.scrollLeft, el.clientWidth, el.scrollWidth);
}

function onItemsScroll(): void {
  measureScroll();
  placeTip();
}

function onWheel(e: WheelEvent): void {
  const el = itemsEl.value;
  if (el === null || e.deltaY === 0) return;
  e.preventDefault();
  el.scrollLeft += e.deltaY;
}

function scrollBy(direction: -1 | 1): void {
  const el = itemsEl.value;
  if (el === null) return;
  el.scrollBy({ left: direction * SCROLL_STEP * el.clientWidth, behavior: 'smooth' });
}

/** Brings the element into the visible part of the items, scrolling as little as needed. */
function reveal(el: Element | null | undefined): void {
  el?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

// A moved bar and a feature opened for editing are scrolled into view (D10).
watch(
  rollbackIndex,
  () => {
    reveal(barEl.value);
  },
  { flush: 'post' },
);
const editingIndex = computed(() => rows.value.findIndex((row) => row.editing));
watch(
  editingIndex,
  (index) => {
    if (index !== -1) reveal(itemElements()[index]);
  },
  { flush: 'post' },
);
watch(rows, measureScroll, { flush: 'post' });

let resizeObserver: ResizeObserver | null = null;
let resizeFrame: number | null = null;
onMounted(() => {
  measureScroll();
  // globalThis: the ESLint config has no browser globals for .vue files (no-undef). Measured on
  // the next frame: an edge button that comes or goes resizes the items again, which inside the
  // callback is a ResizeObserver loop error.
  resizeObserver = new globalThis.ResizeObserver(() => {
    if (resizeFrame !== null) return;
    resizeFrame = globalThis.requestAnimationFrame(() => {
      resizeFrame = null;
      measureScroll();
    });
  });
  if (itemsEl.value !== null) resizeObserver.observe(itemsEl.value);
});

// The roving tabindex (D14): one item of the toolbar is in the Tab order (rovingActive); the
// arrows, Home and End move the focus.
const activeIndex = computed(() => rovingActive(rows.value));

function onItemKeyDown(index: number, row: TreeRow, e: KeyboardEvent): void {
  // Keys of a child (none today) are not the item's.
  if (e.target !== e.currentTarget) return;
  const next = rovingNext(e.key, index, rows.value.length);
  if (next !== null) {
    e.preventDefault();
    itemElements()[next]?.focus();
    return;
  }
  if (e.key === 'Enter') featureTree.edit(row.id);
  else if (e.key === ' ') select(row.id, isAdditive(e));
  else if (e.key === 'Delete' || e.key === 'Backspace') {
    // As the context menu: the feature becomes the selection, then the action of the selection.
    runOnSelected(
      () => {
        featureTree.select(row.id);
      },
      actions,
      actionIds.featureDelete,
    );
  } else if (e.key === 'F2') featureTree.beginRename(row.id);
  else if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
    if (!(e.currentTarget instanceof HTMLElement)) return;
    const box = e.currentTarget.getBoundingClientRect();
    openMenu(row.id, box.left, box.bottom);
  } else return;
  // Handled: the global keyboard of AppShell skips it, and the browser does not scroll or open
  // its own menu.
  e.preventDefault();
}

// One tooltip for the whole Timeline (D9), teleported to <body> so neither the scroll container
// nor the backdrop-filter of the Timeline clips it, and placed in the window by placeTooltip over
// its size measured after the render (hidden until then). It shows for the item under the
// pointer, otherwise for the item focused from the keyboard; never while the context menu is open
// or a feature is renamed. The content is the row of the item, as its hidden description.
const hoveredId = ref<FeatureId | null>(null);
const focusedId = ref<FeatureId | null>(null);
const tipEl = useTemplateRef<HTMLElement>('tip');
const tipPlacement = shallowRef<TooltipPlacement | null>(null);

const tipIndex = computed((): number => {
  if (menu.value !== null || renamingId.value !== null) return -1;
  const id = hoveredId.value ?? focusedId.value;
  return id === null ? -1 : rows.value.findIndex((row) => row.id === id);
});
const tipRow = computed((): TreeRow | null => rows.value[tipIndex.value] ?? null);

function placeTip(): void {
  const tip = tipEl.value;
  const anchor = itemElements()[tipIndex.value];
  if (tip === null || anchor === undefined) return;
  const box = tip.getBoundingClientRect();
  tipPlacement.value = placeTooltip(
    anchor.getBoundingClientRect(),
    { width: box.width, height: box.height },
    { width: globalThis.innerWidth, height: globalThis.innerHeight },
  );
}

// Another item or other content: measured and placed again after the DOM update.
watch(
  tipRow,
  async (row) => {
    tipPlacement.value = null;
    if (row === null) return;
    await nextTick();
    placeTip();
  },
  { flush: 'post' },
);

function onItemFocus(id: FeatureId, e: FocusEvent): void {
  // Only a focus from the keyboard shows the tooltip; a click focuses the item too.
  if (e.currentTarget instanceof HTMLElement && e.currentTarget.matches(':focus-visible'))
    focusedId.value = id;
}

function onItemBlur(id: FeatureId): void {
  if (focusedId.value === id) focusedId.value = null;
}

function onItemLeave(id: FeatureId): void {
  if (hoveredId.value === id) hoveredId.value = null;
}

onUnmounted(() => {
  endDrag();
  resizeObserver?.disconnect();
  if (resizeFrame !== null) globalThis.cancelAnimationFrame(resizeFrame);
});
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

    <button
      v-if="scroll.left"
      type="button"
      class="scroll"
      :aria-label="t('timeline.scrollLeft')"
      @click="scrollBy(-1)"
    >
      ‹
    </button>
    <div
      ref="items"
      class="items"
      role="toolbar"
      :aria-label="t('timeline.label')"
      aria-orientation="horizontal"
      @wheel="onWheel"
      @scroll="onItemsScroll"
    >
      <div
        ref="bar"
        class="bar"
        :class="{ dragging: dragIndex !== null, locked }"
        :style="{ order: 2 * barIndex }"
        role="separator"
        aria-orientation="vertical"
        :aria-valuenow="rollbackIndex"
        aria-valuemin="0"
        :aria-valuemax="rows.length"
        tabindex="0"
        :title="t('timeline.rollbackBar')"
        @pointerdown="onBarDown"
        @keydown="onBarKeyDown"
      />
      <TimelineItem
        v-for="(row, i) in rows"
        :key="row.id"
        :style="{ order: 2 * i + 1 }"
        :row="row"
        :renaming="renamingId === row.id"
        :tabindex="i === activeIndex ? 0 : -1"
        @select="select(row.id, $event)"
        @edit="featureTree.edit(row.id)"
        @menu="openMenu(row.id, $event.clientX, $event.clientY)"
        @rename="featureTree.rename(row.id, $event)"
        @cancel-rename="featureTree.cancelRename()"
        @keydown="onItemKeyDown(i, row, $event)"
        @pointerenter="hoveredId = row.id"
        @pointerleave="onItemLeave(row.id)"
        @focus="onItemFocus(row.id, $event)"
        @blur="onItemBlur(row.id)"
      />
    </div>
    <button
      v-if="scroll.right"
      type="button"
      class="scroll"
      :aria-label="t('timeline.scrollRight')"
      @click="scrollBy(1)"
    >
      ›
    </button>

    <Teleport to="body">
      <div
        v-if="tipRow !== null"
        ref="tip"
        class="timeline-tooltip"
        :class="{ measuring: tipPlacement === null }"
        role="tooltip"
        :style="
          tipPlacement === null
            ? undefined
            : { left: `${String(tipPlacement.left)}px`, top: `${String(tipPlacement.top)}px` }
        "
      >
        <span class="name">{{ tipRow.name }}</span>
        <span class="muted">{{ t(tipRow.typeLabel) }}</span>
        <span v-if="tipRow.status !== 'ok'" class="muted">{{
          t(`timeline.status.${tipRow.status}`)
        }}</span>
        <span v-if="tipRow.message !== null">{{ tipRow.message }}</span>
        <span v-for="(issue, i) in tipRow.issues ?? []" :key="i">
          {{ issueText(t, issue) }}
        </span>
        <span v-if="tipRow.dependents > 0" class="muted">{{
          t('timeline.dependents', { n: tipRow.dependents })
        }}</span>
      </div>
    </Teleport>

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
      <span v-else-if="errorCount > 0" class="errors">
        <i class="ti ti-alert-triangle" aria-hidden="true" />
        {{ t('timeline.regen.errors', { n: errorCount }) }}
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
/* D10: the items scroll and give way; the status (flex: none) is never covered. The scrollbar is
   hidden, the wheel and the edge buttons scroll instead. */
.items {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.items::-webkit-scrollbar {
  display: none;
}
.scroll {
  flex: none;
  width: 18px;
  height: 34px;
  border: none;
  border-radius: var(--radius-row);
  background: none;
  color: var(--text-secondary);
  font-size: 18px;
  line-height: 1;
}
.scroll:hover {
  background: var(--control-hover);
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
.bar:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
  border-radius: 2px;
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
/* Teleported to <body> (the scoped attribute stays on it). */
.timeline-tooltip {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 2px;
  /* The measured size must not depend on the position (a fixed box near the right edge would
     shrink to the room left there). */
  width: max-content;
  max-width: 280px;
  padding: 4px 8px;
  border-radius: var(--radius-row);
  background: var(--tooltip-bg);
  color: var(--tooltip-text);
  font-family: var(--font-ui);
  font-size: var(--font-size-small);
  white-space: normal;
  pointer-events: none;
}
/* Rendered for the measurement, not yet placed. */
.timeline-tooltip.measuring {
  visibility: hidden;
}
.timeline-tooltip .name {
  font-weight: 600;
}
.timeline-tooltip .muted {
  opacity: 0.7;
}
</style>

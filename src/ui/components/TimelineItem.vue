<script setup lang="ts">
// One feature of the Timeline: the icon and the state of the row. The row is a frozen TreeRow
// snapshot, passed as a prop (never put into ref()/reactive()). While `renaming`, the name is an
// inline field; the Timeline does the rest.
// The technical message is drawn as the row has it: the presenter leaves it only to a row
// without translated issues (FeatureTreeModel, ADR 0010).
// Accessibility (spec 11, "Přístupnost"): the name of the item is the feature name, the details
// (type, state, message, issues, dependents) are its description in a visually hidden span, so the
// description is there also without the tooltip. The tooltip itself is one for the whole Timeline
// (M19.2 D9), drawn by the Timeline from the same row. A draft (a new feature still missing its
// references, D6 of M19.2) is neutral: no red and no badge, only its state in the description.
// M19.2 D10: the items scroll, so the rename field would be clipped by the scroll container; it is
// teleported to <body> and placed over the item by placeTooltip, hidden until measured.
// The keys of the item (roving focus, D14) are heard by the Timeline on the root of the item.
import { nextTick, shallowRef, useId, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TreeRow } from '@/interaction';
import { issueText } from '../i18n/i18n';
import { finishEdit } from '../inline-rename';
import { isAdditive } from '../item-actions';
import { placeTooltip } from '../tooltip-position';
import type { TooltipPlacement } from '../tooltip-position';

const props = defineProps<{
  row: TreeRow;
  renaming: boolean;
  /** The roving tabindex (D14): 0 for the one active item of the Timeline, −1 for the others. */
  tabindex: number;
}>();
const emit = defineEmits<{
  select: [additive: boolean];
  edit: [];
  menu: [e: MouseEvent];
  rename: [name: string];
  cancelRename: [];
}>();

const { t } = useI18n();
const detailsId = useId();

const root = useTemplateRef<HTMLElement>('root');
const input = useTemplateRef<HTMLInputElement>('input');
/** Where the teleported rename field stands; null until measured (hidden till then). */
const placement = shallowRef<TooltipPlacement | null>(null);

// Enter and blur both commit; finishEdit keeps the blur after Enter or Escape from repeating it.
const editing: { value: true | null } = { value: null };
watch(
  () => props.renaming,
  async (renaming) => {
    editing.value = renaming ? true : null;
    placement.value = null;
    if (!renaming) return;
    await nextTick();
    placeField();
    // Only a visible field takes the focus.
    await nextTick();
    input.value?.select();
  },
);

function placeField(): void {
  const item = root.value;
  const field = input.value;
  // Unmounted or out of the rename mode meanwhile: nothing to place.
  if (item === null || field === null) return;
  const box = field.getBoundingClientRect();
  placement.value = placeTooltip(
    item.getBoundingClientRect(),
    { width: box.width, height: box.height },
    { width: globalThis.innerWidth, height: globalThis.innerHeight },
  );
}

function commit(): void {
  if (finishEdit(editing) === null) return;
  emit('rename', input.value?.value ?? props.row.name);
}

// Enter and Escape end the rename from the keyboard: the focus goes back to the item before the
// field leaves the DOM (its blur then finds the rename done), so the keyboard user stays in the
// Timeline instead of on <body>.
function commitFromKey(): void {
  if (finishEdit(editing) === null) return;
  const name = input.value?.value ?? props.row.name;
  root.value?.focus();
  emit('rename', name);
}
function cancelFromKey(): void {
  if (finishEdit(editing) === null) return;
  root.value?.focus();
  emit('cancelRename');
}
</script>

<template>
  <div
    ref="root"
    class="timeline-item"
    :class="[row.status, { selected: row.selected, editing: row.editing }]"
    role="button"
    :tabindex="tabindex"
    :aria-label="row.name"
    :aria-describedby="detailsId"
    @click="emit('select', isAdditive($event))"
    @dblclick="emit('edit')"
    @contextmenu.prevent="emit('menu', $event)"
  >
    <i class="ti" :class="`ti-${row.icon ?? 'cube'}`" aria-hidden="true" />
    <span v-if="row.status === 'error'" class="badge" aria-hidden="true">!</span>
    <span :id="detailsId" class="details">
      <span>{{ t(row.typeLabel) }}</span>
      <span v-if="row.status !== 'ok'">{{ t(`timeline.status.${row.status}`) }}</span>
      <span v-if="row.message !== null">{{ row.message }}</span>
      <span v-for="(issue, i) in row.issues ?? []" :key="i">{{ issueText(t, issue) }}</span>
      <span v-if="row.dependents > 0">{{ t('timeline.dependents', { n: row.dependents }) }}</span>
    </span>
    <Teleport to="body">
      <input
        v-if="renaming"
        ref="input"
        class="timeline-rename"
        :class="{ measuring: placement === null }"
        :style="
          placement === null
            ? undefined
            : { left: `${String(placement.left)}px`, top: `${String(placement.top)}px` }
        "
        :value="row.name"
        :aria-label="t('feature.rename')"
        @keydown.enter.prevent="commitFromKey"
        @keydown.escape.prevent="cancelFromKey"
        @blur="commit"
      />
    </Teleport>
  </div>
</template>

<style scoped>
.timeline-item {
  position: relative;
  flex: none;
  width: var(--timeline-item);
  height: var(--timeline-item);
  margin: 0 1px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-control);
  font-size: 20px;
  color: var(--text-primary);
  cursor: default;
  user-select: none;
}
.timeline-item:hover {
  background: var(--control-hover);
}
.timeline-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
/* Selected = the colour of the selection (M19.2 D1); edited = a mode, the accent, and wins. */
.timeline-item.selected {
  background: var(--selection-soft);
  color: var(--selection);
  box-shadow: inset 0 0 0 1.5px var(--selection);
}
.timeline-item.editing {
  background: var(--accent-soft);
  color: var(--accent);
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
.timeline-item.rolledBack,
.timeline-item.pending,
.timeline-item.suppressed {
  color: var(--text-tertiary);
}
.timeline-item.suppressed::after {
  content: '';
  position: absolute;
  width: 26px;
  height: 1.5px;
  background: var(--text-tertiary);
  transform: rotate(-45deg);
}
.timeline-item.draft {
  color: var(--text-secondary);
}
.timeline-item.warning {
  color: var(--warning);
}
.timeline-item.error {
  color: var(--danger);
  background: var(--danger-bg);
}
.badge {
  position: absolute;
  right: -2px;
  top: -2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--danger);
  color: var(--on-accent);
  font-size: 9px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* The description for aria-describedby: read by assistive technology, never drawn. */
.details {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.timeline-rename {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 100;
  width: 160px;
  padding: 3px 6px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-row);
  background: var(--panel-bg);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--font-size);
}
/* Rendered for the measurement, not yet placed. */
.timeline-rename.measuring {
  visibility: hidden;
}
</style>

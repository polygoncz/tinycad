<script setup lang="ts">
// One feature of the Timeline: the icon, the state of the row and a tooltip with the name and
// the translated issues and how many features depend on it. The row is a frozen TreeRow snapshot, passed as a prop (never put into
// ref()/reactive()). While `renaming`, the name is an inline field; the Timeline does the rest.
// The technical message is drawn as the row has it: the presenter leaves it only to a row
// without translated issues (FeatureTreeModel, ADR 0010).
// Accessibility (spec 11, "Přístupnost"): the name of the item is the feature name, the details
// of the tooltip (type, state, message, issues) are its description; the tooltip is hidden until
// hover, which aria-describedby does not mind.
import { nextTick, useId, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TreeRow } from '@/interaction';
import { issueText } from '../i18n/i18n';

const props = defineProps<{ row: TreeRow; renaming: boolean }>();
const emit = defineEmits<{
  select: [additive: boolean];
  edit: [];
  menu: [e: MouseEvent];
  rename: [name: string];
  cancelRename: [];
}>();

const { t } = useI18n();
const detailsId = useId();

const input = useTemplateRef<HTMLInputElement>('input');
// Enter and blur both commit; the flag keeps the blur after Enter or Escape from repeating it.
let done = false;
watch(
  () => props.renaming,
  async (renaming) => {
    done = false;
    if (!renaming) return;
    await nextTick();
    input.value?.select();
  },
);
function commit(): void {
  if (done) return;
  done = true;
  emit('rename', input.value?.value ?? props.row.name);
}
function cancel(): void {
  if (done) return;
  done = true;
  emit('cancelRename');
}
</script>

<template>
  <div
    class="timeline-item"
    :class="[row.status, { selected: row.selected, editing: row.editing }]"
    role="button"
    :aria-label="row.name"
    :aria-describedby="renaming ? undefined : detailsId"
    @click="emit('select', $event.shiftKey || $event.metaKey || $event.ctrlKey)"
    @dblclick="emit('edit')"
    @contextmenu.prevent="emit('menu', $event)"
  >
    <i class="ti" :class="`ti-${row.icon ?? 'cube'}`" aria-hidden="true" />
    <span v-if="row.status === 'error'" class="badge" aria-hidden="true">!</span>
    <input
      v-if="renaming"
      ref="input"
      class="rename"
      :value="row.name"
      :aria-label="t('feature.rename')"
      @click.stop
      @dblclick.stop
      @keydown.enter.prevent="commit"
      @keydown.escape.prevent="cancel"
      @blur="commit"
    />
    <span v-else class="tooltip">
      <span class="name">{{ row.name }}</span>
      <span :id="detailsId" class="details">
        <span class="type">{{ t(row.typeLabel) }}</span>
        <span v-if="row.status !== 'ok'" class="state">{{
          t(`timeline.status.${row.status}`)
        }}</span>
        <span v-if="row.message !== null" class="message">{{ row.message }}</span>
        <span v-for="(issue, i) in row.issues ?? []" :key="i" class="issue">
          {{ issueText(t, issue) }}
        </span>
        <span v-if="row.dependents > 0" class="dependents">{{
          t('timeline.dependents', { n: row.dependents })
        }}</span>
      </span>
    </span>
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
.timeline-item.selected,
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
.tooltip {
  display: none;
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  flex-direction: column;
  gap: 2px;
  max-width: 280px;
  width: max-content;
  padding: 4px 8px;
  border-radius: var(--radius-row);
  background: var(--tooltip-bg);
  color: var(--tooltip-text);
  font-size: var(--font-size-small);
  pointer-events: none;
}
.timeline-item:hover .tooltip {
  display: flex;
}
.name {
  font-weight: 600;
}
/* Only groups the description for aria-describedby; the tooltip lays out its children. */
.details {
  display: contents;
}
.type,
.state,
.dependents {
  opacity: 0.7;
}
.message,
.issue {
  white-space: normal;
}
.rename {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  width: 160px;
  padding: 3px 6px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-row);
  background: var(--panel-bg);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--font-size);
}
</style>

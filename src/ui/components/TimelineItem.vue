<script setup lang="ts">
// One feature of the Timeline: the icon, the state of the row and a tooltip with the name.
// The row is a frozen TreeRow snapshot, passed as a prop (never put into ref()/reactive()).
import { useI18n } from 'vue-i18n';
import type { TreeRow } from '@/interaction';

defineProps<{ row: TreeRow }>();
const emit = defineEmits<{
  select: [additive: boolean];
  edit: [];
}>();

const { t } = useI18n();
</script>

<template>
  <div
    class="timeline-item"
    :class="[row.status, { selected: row.selected, editing: row.editing }]"
    role="button"
    :aria-label="row.name"
    @click="emit('select', $event.shiftKey || $event.metaKey || $event.ctrlKey)"
    @dblclick="emit('edit')"
  >
    <!-- One generic icon for every feature type until TreeRow carries an icon. -->
    <i class="ti ti-cube" />
    <span v-if="row.status === 'error'" class="badge">!</span>
    <span class="tooltip">
      <span class="name">{{ row.name }}</span>
      <span class="type">{{ t(row.typeLabel) }}</span>
      <span v-if="row.status !== 'ok'" class="state">{{ t(`timeline.status.${row.status}`) }}</span>
      <span v-if="row.message !== null" class="message">{{ row.message }}</span>
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
.type,
.state {
  opacity: 0.7;
}
.message {
  white-space: normal;
}
</style>

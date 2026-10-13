<script setup lang="ts">
// The Toolbar (spec 11, "Komponenty"): docked under the title bar, buttons in groups (Historie,
// Vytvořit, Upravit, Konstrukce, Zobrazit). Which button sits in which group and whether it is
// enabled is the pure function toolbarGroups; this component only draws it and runs commands.
// Icon without a label, a tooltip "name  shortcut", under each group its label opening a menu
// of the group. Tabs Modelling/Sketch come with the sketcher (M12). The tooltip opens under the
// whole bar, so it never covers the group label under the button.
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ActionState } from '@/interaction';
import { useObservable } from '../composables/use-observable';
import { useSession } from '../composables/use-session';
import { isMacPlatform, shortcutText } from '../keyboard';
import { toolbarGroups } from '../toolbar-groups';
import type { ToolbarGroup, ToolbarItem } from '../toolbar-groups';
import ContextMenu from './ContextMenu.vue';

const session = useSession();
const i18n = useI18n();
const { t } = i18n;
const isMac = isMacPlatform(globalThis.navigator.userAgent);

const actionStates = useObservable(session.actions.actions);
const locked = useObservable(session.locked);
const activeTool = useObservable(session.tools.active);

const groups = computed(() =>
  toolbarGroups({
    tools: session.toolList,
    actions: actionStates.value,
    actionIds: session.actionIds,
    toolActionId: (id) => session.toolActionId(id),
    locked: locked.value,
  }),
);

function groupLabel(group: ToolbarGroup): string {
  const key = `toolbar.group.${group.id}`;
  return i18n.te(key) ? t(key) : group.id;
}

function isActive(item: ToolbarItem): boolean {
  return session.toolList.some((tool) => tool.id === item.id) && activeTool.value === item.id;
}

function run(item: ToolbarItem): void {
  if (!item.enabled) return;
  if (item.command.kind === 'action') session.actions.run(item.command.id);
  else session.tools.activate(item.command.id);
}

// The menu under a group label: the same items with their names and shortcuts.
const menu = ref<{ readonly x: number; readonly y: number; readonly groupId: string } | null>(null);
const menuGroup = computed(() => groups.value.find((g) => g.id === menu.value?.groupId));
const menuItems = computed((): readonly ActionState[] =>
  (menuGroup.value?.items ?? []).map((item) =>
    Object.freeze({
      id: item.id,
      label: item.label,
      shortcut: item.shortcut,
      group: null,
      enabled: item.enabled,
    }),
  ),
);

function openMenu(group: ToolbarGroup, e: MouseEvent): void {
  const target = e.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  const box = target.getBoundingClientRect();
  menu.value = { x: box.left, y: box.bottom + 4, groupId: group.id };
}

function runMenuItem(id: string): void {
  const item = menuGroup.value?.items.find((i) => i.id === id);
  if (item !== undefined) run(item);
}
</script>

<template>
  <nav class="toolbar">
    <template v-for="(group, i) in groups" :key="group.id">
      <div v-if="i > 0" class="separator" />
      <div class="group">
        <div class="buttons">
          <button
            v-for="item in group.items"
            :key="item.id"
            type="button"
            class="tool"
            :class="{ active: isActive(item) }"
            :disabled="!item.enabled"
            :aria-label="t(item.label)"
            @click="run(item)"
          >
            <i class="ti" :class="`ti-${item.icon}`" aria-hidden="true" />
            <span class="tip" role="tooltip">
              {{ t(item.label) }}
              <kbd v-if="item.shortcut !== null">{{ shortcutText(item.shortcut, isMac) }}</kbd>
            </span>
          </button>
        </div>
        <button type="button" class="group-label" @click="openMenu(group, $event)">
          {{ groupLabel(group) }} <i class="ti ti-chevron-down" aria-hidden="true" />
        </button>
      </div>
    </template>

    <ContextMenu
      v-if="menu !== null"
      :items="menuItems"
      :x="menu.x"
      :y="menu.y"
      @run="runMenuItem"
      @close="menu = null"
    />
  </nav>
</template>

<style scoped>
.toolbar {
  /* Rows under a button down to the bottom edge of the bar: the tooltip goes below them. */
  --label-gap: 1px;
  --label-height: 16px;
  --bar-padding-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px var(--bar-padding-bottom);
  background: var(--chrome-bg);
  backdrop-filter: var(--chrome-blur);
  -webkit-backdrop-filter: var(--chrome-blur);
  border-bottom: 0.5px solid var(--chrome-border);
  color: var(--text-primary);
}
.group {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 6px;
}
.buttons {
  display: flex;
  gap: 1px;
}
.tool {
  position: relative;
  width: var(--toolbar-button);
  height: var(--toolbar-button);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-button);
  background: none;
  color: var(--text-primary);
  font-size: var(--toolbar-icon);
}
.tool:hover:not(:disabled) {
  background: var(--control-hover);
}
.tool:disabled {
  color: var(--text-tertiary);
}
.tool.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.tip {
  position: absolute;
  top: calc(100% + var(--label-gap) + var(--label-height) + var(--bar-padding-bottom) + 6px);
  left: 50%;
  z-index: 50;
  transform: translateX(-50%);
  display: none;
  gap: 8px;
  padding: 4px 8px;
  border-radius: var(--radius-row);
  background: var(--tooltip-bg);
  color: var(--tooltip-text);
  font-family: var(--font-ui);
  font-size: var(--font-size-small);
  white-space: nowrap;
  pointer-events: none;
}
.tip kbd {
  font: inherit;
  opacity: 0.6;
}
.tool:hover .tip {
  display: flex;
}
.group-label {
  display: flex;
  align-items: center;
  gap: 2px;
  height: var(--label-height);
  margin-top: var(--label-gap);
  padding: 0 4px;
  border: none;
  border-radius: var(--radius-row);
  background: none;
  color: var(--text-secondary);
  font-family: var(--font-ui);
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.group-label:hover {
  background: var(--control-hover);
}
.group-label i {
  font-size: 10px;
}
.separator {
  width: 1px;
  align-self: stretch;
  margin: 6px 4px;
  background: var(--chrome-border);
}
</style>

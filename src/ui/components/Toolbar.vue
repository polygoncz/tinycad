<script setup lang="ts">
// The Toolbar (spec 11, "Komponenty"): docked under the title bar, buttons in groups (Historie,
// Vytvořit, Upravit, Konstrukce, Zobrazit). Which button sits in which group and whether it is
// enabled is the ToolbarModel of interaction (M20); this component only draws it and runs
// commands through it.
// Icon without a label, a tooltip "name  shortcut", under each group its label opening a menu
// of the group. In the sketch mode (M12) the bar shows the tools and actions of the sketcher
// instead (the model follows the mode). The tooltip opens under the whole bar, so it never covers
// the group label under the button.
// M19.1 (revision C10): groups that do not fit into the bar go into the menu of the button "…"
// ("Další nástroje"), group by group, as the same items. How many fit is the pure function
// fitGroups over widths measured by a ResizeObserver (the row and every group), the items of the
// menu the pure function overflowItems. A group that does not fit stays in the DOM out of the
// flow and invisible: it keeps its natural width, so it is measured also while hidden, and it is
// not drawn, focused, clicked nor seen by assistive tech.
// M19.2 (D8): items with menuOnly (the standard views) are not buttons, only items of the menu of
// their group and of "…"; fitGroups measures only the drawn buttons, so it needs no change.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ToolbarGroup, ToolbarItem } from '@/interaction';
import { useObservable } from '../composables/use-observable';
import { useSession } from '../composables/use-session';
import { isMacPlatform, shortcutText } from '../keyboard';
import { fitGroups, overflowItems } from '../toolbar-fit';
import ContextMenu from './ContextMenu.vue';

const session = useSession();
const i18n = useI18n();
const { t } = i18n;
const isMac = isMacPlatform(globalThis.navigator.userAgent);

const groups = useObservable(session.toolbar.groups);

function groupLabel(group: ToolbarGroup): string {
  const key = `toolbar.group.${group.id}`;
  return i18n.te(key) ? t(key) : group.id;
}

/** The items drawn as buttons; the menus show all items of the group. */
function buttonsOf(group: ToolbarGroup): readonly ToolbarItem[] {
  return group.items.filter((item) => !item.menuOnly);
}

function run(item: ToolbarItem): void {
  session.toolbar.run(item);
}

/** Natural widths in px: of each group with its separator (by id), of the button "…", of the row. */
interface Widths {
  readonly groups: ReadonlyMap<string, number>;
  readonly more: number;
  readonly available: number;
}

const row = useTemplateRef<HTMLElement>('row');
const moreSlot = useTemplateRef<HTMLElement>('moreSlot');
const widths = shallowRef<Widths | null>(null);

/** How many groups from the left are in the bar; the rest is in the menu of the button "…". */
const fitCount = computed(() => {
  const measured = widths.value;
  // Not measured yet (before the mount): all of them, the observer corrects it before a paint.
  if (measured === null) return groups.value.length;
  // A group of a new mode not measured yet counts as 0 until its first observation.
  const groupWidths = groups.value.map((group) => measured.groups.get(group.id) ?? 0);
  return fitGroups(groupWidths, measured.available, measured.more);
});
const overflowing = computed(() => fitCount.value < groups.value.length);

/** Reads the widths from the DOM; every observation calls it. */
function measure(): void {
  const el = row.value;
  const more = moreSlot.value;
  // Unmounted meanwhile: nothing to measure.
  if (el === null || more === null) return;
  const groupWidths = new Map<string, number>();
  for (const slot of el.querySelectorAll<HTMLElement>('[data-group]')) {
    const id = slot.dataset.group;
    if (id !== undefined) groupWidths.set(id, slot.getBoundingClientRect().width);
  }
  widths.value = {
    groups: groupWidths,
    more: more.getBoundingClientRect().width,
    available: el.getBoundingClientRect().width,
  };
}

let observer: ResizeObserver | null = null;

/** Observes the row, every group and the button "…"; again when the groups change (new slots). */
function observe(): void {
  const el = row.value;
  const more = moreSlot.value;
  if (observer === null || el === null || more === null) return;
  observer.disconnect();
  observer.observe(el);
  observer.observe(more);
  for (const slot of el.querySelectorAll('[data-group]')) observer.observe(slot);
}

onMounted(() => {
  // A new observation reports the current size at once, so this measures the first time too.
  observer = new globalThis.ResizeObserver(measure);
  observe();
});
// The slots of a group stay while its id stays (the key); only another set of ids (the mode)
// brings new elements. After the DOM update, so the new slots are there.
watch(() => groups.value.map((group) => group.id).join(' '), observe, { flush: 'post' });
onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});

/**
 * An open menu at (x, y): under a group label (groupId), or of the button "…" (null). Both show
 * the same items as the buttons (a ToolbarItem is an ActionState); "…" the items of the groups
 * out of the bar, group after group.
 */
interface OpenMenu {
  readonly x: number;
  readonly y: number;
  readonly groupId: string | null;
}

const menu = ref<OpenMenu | null>(null);
const menuItems = computed<readonly ToolbarItem[]>(() => {
  const open = menu.value;
  if (open === null) return [];
  if (open.groupId === null) return overflowItems(groups.value, fitCount.value);
  return groups.value.find((g) => g.id === open.groupId)?.items ?? [];
});

// All groups fit again (a wider window) while the menu of "…" is open: it would stay empty.
watch(overflowing, (now) => {
  if (!now && menu.value?.groupId === null) menu.value = null;
});

function openMenu(groupId: string | null, e: MouseEvent): void {
  const target = e.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  const box = target.getBoundingClientRect();
  menu.value = { x: box.left, y: box.bottom + 4, groupId };
}

function runMenuItem(id: string): void {
  const item = menuItems.value.find((i) => i.id === id);
  if (item !== undefined) run(item);
}
</script>

<template>
  <nav class="toolbar">
    <div ref="row" class="row">
      <div
        v-for="(group, i) in groups"
        :key="group.id"
        class="slot"
        :class="{ overflowed: i >= fitCount }"
        :data-group="group.id"
      >
        <div v-if="i > 0" class="separator" />
        <div class="group">
          <div class="buttons">
            <button
              v-for="item in buttonsOf(group)"
              :key="item.id"
              type="button"
              class="tool"
              :class="{ active: item.active }"
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
          <button type="button" class="group-label" @click="openMenu(group.id, $event)">
            {{ groupLabel(group) }} <i class="ti ti-chevron-down" aria-hidden="true" />
          </button>
        </div>
      </div>

      <!-- Always in the DOM (measured even when everything fits), visible only on an overflow. -->
      <div ref="moreSlot" class="slot" :class="{ overflowed: !overflowing }">
        <div class="separator" />
        <div class="group">
          <div class="buttons">
            <button
              type="button"
              class="tool"
              :aria-label="t('toolbar.more')"
              @click="openMenu(null, $event)"
            >
              <i class="ti ti-dots" aria-hidden="true" />
            </button>
          </div>
          <!-- The room of a group label: the button sits in line with the tool buttons. -->
          <div class="label-room" />
        </div>
      </div>
    </div>

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
  padding: 6px 12px var(--bar-padding-bottom);
  background: var(--chrome-bg);
  backdrop-filter: var(--chrome-blur);
  -webkit-backdrop-filter: var(--chrome-blur);
  border-bottom: 0.5px solid var(--chrome-border);
  color: var(--text-primary);
}
/* As wide as the bar whatever is in it: its width is the room for the groups. */
.row {
  position: relative;
  display: flex;
  align-items: center;
}
/* A group with the separator before it. Its natural width, also out of the flow, so the widths add
   up and a hidden group is measured as it would stand in the bar. */
.slot {
  flex: none;
  display: flex;
  align-items: center;
  width: max-content;
}
/* Out of the bar (in the menu of "…"): out of the flow, not drawn, not hit. */
.slot.overflowed {
  position: absolute;
  left: 0;
  top: 0;
  visibility: hidden;
  pointer-events: none;
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
.label-room {
  height: var(--label-height);
  margin-top: var(--label-gap);
}
/* 12 px on each side: the former 8 px gap of the bar and 4 px margin, now inside the slot. */
.separator {
  width: 1px;
  align-self: stretch;
  margin: 6px 12px;
  background: var(--chrome-border);
}
</style>

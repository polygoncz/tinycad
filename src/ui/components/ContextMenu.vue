<script setup lang="ts">
// Shared context menu built from an ActionState[] snapshot (spec 11, "Komponenty"). It only
// shows the given actions and reports which one was chosen; what the menu contains and what
// running an action does is decided by the caller and the ActionRegistry.
// M19.1 (revision C1): the menu is teleported to <body>. A parent with backdrop-filter or
// transform (the Timeline, the Toolbar) is the containing block of a position: fixed child and
// its own stacking context, so the menu was drawn off the window and under the feature dialog.
// Where it opens is placeMenu over its size measured after the render (hidden until then); the
// keys move the focus by menuFocusIndex, Esc closes it and the focus goes back where it was.
// An item with an icon (a ToolbarItem) shows it before its label; the column is there when any
// item has one (menuHasIcons), an item without an icon keeps its room empty.
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue';
import { useI18n } from 'vue-i18n';
import { menuHasIcons } from '../context-menu';
import type { ContextMenuItem } from '../context-menu';
import { isMacPlatform, shortcutText } from '../keyboard';
import { isMenuNavigationKey, menuFocusIndex } from '../menu-navigation';
import { placeMenu } from '../menu-position';
import type { MenuPlacement } from '../menu-position';

const props = defineProps<{
  items: readonly ContextMenuItem[];
  /** The anchor in viewport pixels (clientX/clientY of the click); placeMenu decides the corner. */
  x: number;
  y: number;
}>();
const emit = defineEmits<{ run: [id: string]; close: [] }>();

const { t } = useI18n();
const withIcons = computed(() => menuHasIcons(props.items));
const menu = useTemplateRef<HTMLElement>('menu');
// globalThis, not window/navigator: the ESLint config has no browser globals for .vue files
// (no-undef); the types are the same.
const isMac = isMacPlatform(globalThis.navigator.userAgent);
// The element focused before the menu opened: it gets the focus back when the menu closes.
const previousFocus = globalThis.document.activeElement;

/** The top left corner in viewport px; null until the menu is measured (hidden till then). */
const placement = shallowRef<MenuPlacement | null>(null);

function place(): void {
  const el = menu.value;
  // Unmounted meanwhile: nothing to place.
  if (el === null) return;
  // width: max-content (styles): the size does not depend on where the menu stands now.
  const box = el.getBoundingClientRect();
  placement.value = placeMenu(
    { x: props.x, y: props.y },
    { width: box.width, height: box.height },
    { width: globalThis.innerWidth, height: globalThis.innerHeight },
  );
}

/** The item buttons in the order of the menu. */
function itemButtons(): HTMLButtonElement[] {
  return Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
}

function enabledFlags(): boolean[] {
  return itemButtons().map((button) => !button.disabled);
}

function focusItem(index: number | null): void {
  if (index !== null) itemButtons()[index]?.focus();
}

/** Measured after the render, then visible; only a visible item can take the focus. */
async function open(): Promise<void> {
  await nextTick();
  place();
  await nextTick();
  focusItem(menuFocusIndex(enabledFlags(), null, 'Home'));
}

function choose(item: ContextMenuItem): void {
  if (!item.enabled) return;
  emit('run', item.id);
  emit('close');
}

function onPointerDown(e: PointerEvent): void {
  if (e.target instanceof Node && menu.value?.contains(e.target) === true) return;
  emit('close');
}

// Esc on the window (capture), so it closes the menu also when no item has the focus; it stops
// there and never reaches the global keyboard of AppShell nor a dialog under the menu.
function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  emit('close');
}

// The arrows, Home and End while the focus is in the menu; preventDefault keeps them from the
// global keyboard of AppShell (it skips handled keys) and from scrolling.
function onMenuKeyDown(e: KeyboardEvent): void {
  if (!isMenuNavigationKey(e.key)) return;
  e.preventDefault();
  const buttons = itemButtons();
  const current = buttons.findIndex((button) => button === globalThis.document.activeElement);
  focusItem(menuFocusIndex(enabledFlags(), current === -1 ? null : current, e.key));
}

// Other items or another anchor while open: placed again after the DOM update.
watch(() => [props.x, props.y, props.items], place, { flush: 'post' });

onMounted(() => {
  globalThis.addEventListener('pointerdown', onPointerDown, true);
  globalThis.addEventListener('keydown', onKeyDown, true);
  void open();
});
// The focus goes back before the menu leaves the DOM: its focused item is still there, and it is
// done in the same update, before whatever the chosen action focuses after it (the rename field
// of the Timeline on nextTick, a new dialog on its mount). An action that has moved the focus
// already keeps it: it goes back only from the menu or from nowhere (body).
onBeforeUnmount(() => {
  const active = globalThis.document.activeElement;
  const untouched =
    active === null || active === globalThis.document.body || menu.value?.contains(active) === true;
  if (untouched && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
    previousFocus.focus();
  }
});
onUnmounted(() => {
  globalThis.removeEventListener('pointerdown', onPointerDown, true);
  globalThis.removeEventListener('keydown', onKeyDown, true);
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="menu"
      class="context-menu"
      :class="{ measuring: placement === null }"
      role="menu"
      :style="
        placement === null
          ? undefined
          : { left: `${String(placement.left)}px`, top: `${String(placement.top)}px` }
      "
      @contextmenu.prevent
      @keydown="onMenuKeyDown"
    >
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        role="menuitem"
        class="row"
        :disabled="!item.enabled"
        @click="choose(item)"
      >
        <i
          v-if="withIcons"
          class="ti icon"
          :class="item.icon === undefined ? undefined : `ti-${item.icon}`"
          aria-hidden="true"
        />
        <span class="label">{{ t(item.label) }}</span>
        <span v-if="item.shortcut !== null" class="shortcut">{{
          shortcutText(item.shortcut, isMac)
        }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 100;
  /* The measured size must not depend on the position (a fixed box near the right edge would
     shrink to the room left there). */
  width: max-content;
  min-width: 190px;
  padding: 5px 0;
  border-radius: var(--radius-menu);
  background: var(--panel-bg);
  backdrop-filter: var(--panel-blur);
  -webkit-backdrop-filter: var(--panel-blur);
  border: 0.5px solid var(--panel-border);
  box-shadow:
    var(--panel-shadow),
    inset 0 0.5px 0 var(--panel-highlight);
}
/* Rendered for the measurement, not yet placed. */
.context-menu.measuring {
  visibility: hidden;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% - 10px);
  height: 24px;
  margin: 0 5px;
  padding: 0 8px;
  border: none;
  border-radius: 5px;
  background: none;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
}
.row:hover:not(:disabled),
.row:focus-visible {
  background: var(--accent);
  color: var(--on-accent);
  outline: none;
}
.row:disabled {
  color: var(--text-tertiary);
}
.icon {
  flex: none;
  width: 16px;
  margin-left: -2px;
  color: var(--text-secondary);
  font-size: 16px;
  text-align: center;
}
.row:disabled .icon {
  color: inherit;
}
.shortcut {
  margin-left: auto;
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
}
.row:hover:not(:disabled) .icon,
.row:focus-visible .icon {
  color: inherit;
}
.row:hover:not(:disabled) .shortcut,
.row:focus-visible .shortcut {
  color: inherit;
  opacity: 0.75;
}
</style>

<script setup lang="ts">
// The display style button left of the view cube (spec 11, "Styl zobrazení", M22): its icon shows
// the current mode, a click opens a menu of the four modes and the toggles. The style is a page
// preference held by the display style controller; AppShell hands it to the session, this menu
// only asks the controller for changes. Its own menu, not ContextMenu (that one shows actions
// only), but built the same way: teleported to <body>, placed by placeMenu once measured, the
// focus moved by menuFocusIndex, Esc or a click outside closes it. The "AO settings…" item (M23)
// closes the menu and asks AppShell to open the AO settings panel (openAoSettings); AppShell
// returns the focus to the button through focusButton when the panel closes.
import { computed, nextTick, onUnmounted, shallowRef, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  chooseDisplayStyleItem,
  displayModeIcon,
  displayModeLabel,
  displayStyleMenuItems,
} from '../display-style/menu-items';
import type { DisplayStyleMenuItem } from '../display-style/menu-items';
import { useDisplayStyle } from '../display-style/use-display-style';
import { isMenuNavigationKey, menuFocusIndex } from '../menu-navigation';
import { placeMenu } from '../menu-position';
import type { MenuPlacement } from '../menu-position';

type ModeItem = Extract<DisplayStyleMenuItem, { kind: 'mode' }>;

const emit = defineEmits<{ openAoSettings: [] }>();

const { t } = useI18n();
const displayStyle = useDisplayStyle();
const style = displayStyle.style;
const items = computed(() => displayStyleMenuItems(style.value));
const modeItems = computed(() =>
  items.value.filter((item): item is ModeItem => item.kind === 'mode'),
);
/** The toggles and the AO settings command, in the order of the menu after the separator. */
const otherItems = computed(() => items.value.filter((item) => item.kind !== 'mode'));
const buttonLabel = computed(() =>
  t('displayStyle.current', { mode: t(displayModeLabel(style.value.mode)) }),
);

const button = useTemplateRef<HTMLButtonElement>('button');
const menu = useTemplateRef<HTMLElement>('menu');
const open = shallowRef(false);
/** The top left corner in viewport px; null until the menu is measured (hidden till then). */
const placement = shallowRef<MenuPlacement | null>(null);

function place(): void {
  const el = menu.value;
  const anchor = button.value;
  // Closed meanwhile: nothing to place.
  if (el === null || anchor === null) return;
  const box = anchor.getBoundingClientRect();
  const size = el.getBoundingClientRect();
  // Anchored at the bottom right corner of the button: the button stands near the right edge, so
  // placeMenu turns the menu to the left and it ends flush with the button.
  placement.value = placeMenu(
    { x: box.right, y: box.bottom + 4 },
    { width: size.width, height: size.height },
    { width: globalThis.innerWidth, height: globalThis.innerHeight },
  );
}

/** The item buttons in the order of the menu (the separator is no button). */
function itemButtons(): HTMLButtonElement[] {
  return Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('button') ?? []);
}

function focusItem(index: number | null): void {
  if (index !== null) itemButtons()[index]?.focus();
}

function enabledFlags(): boolean[] {
  return items.value.map((item) => item.enabled);
}

async function openMenu(): Promise<void> {
  open.value = true;
  placement.value = null;
  globalThis.addEventListener('pointerdown', onPointerDown, true);
  globalThis.addEventListener('keydown', onKeyDown, true);
  // Measured after the render, then visible; only a visible item can take the focus.
  await nextTick();
  place();
  await nextTick();
  focusItem(menuFocusIndex(enabledFlags(), null, 'Home'));
}

function closeMenu(): void {
  if (!open.value) return;
  open.value = false;
  placement.value = null;
  removeListeners();
  button.value?.focus();
}

function removeListeners(): void {
  globalThis.removeEventListener('pointerdown', onPointerDown, true);
  globalThis.removeEventListener('keydown', onKeyDown, true);
}

function onButtonClick(): void {
  if (open.value) closeMenu();
  else void openMenu();
}

/**
 * A mode closes the menu, a toggle keeps it open, the AO settings close it and open the panel
 * (chooseDisplayStyleItem). The menu closes first, so the panel takes the focus from the button.
 */
function choose(item: DisplayStyleMenuItem): void {
  switch (chooseDisplayStyleItem(displayStyle, item)) {
    case 'close':
      closeMenu();
      break;
    case 'openAoSettings':
      closeMenu();
      emit('openAoSettings');
      break;
    case 'keepOpen':
    case 'ignored':
      break;
  }
}

// A press outside the menu closes it. The button is left to its click, which closes it then
// (otherwise the press would close and the click reopen it).
function onPointerDown(e: PointerEvent): void {
  if (e.target instanceof Node) {
    if (menu.value?.contains(e.target) === true) return;
    if (button.value?.contains(e.target) === true) return;
  }
  closeMenu();
}

// Esc on the window (capture), like ContextMenu: it closes the menu also when no item has the
// focus, and stops there, so it never reaches the global keyboard of AppShell nor a dialog.
function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  closeMenu();
}

// The arrows, Home and End while the focus is in the menu; preventDefault keeps them from the
// global keyboard of AppShell (it skips handled keys) and from scrolling. Enter and Space click
// the focused item button natively.
function onMenuKeyDown(e: KeyboardEvent): void {
  if (!isMenuNavigationKey(e.key)) return;
  e.preventDefault();
  const current = itemButtons().findIndex((item) => item === globalThis.document.activeElement);
  focusItem(menuFocusIndex(enabledFlags(), current === -1 ? null : current, e.key));
}

/** For AppShell: the AO settings panel closed by × or Esc gives the focus back here. */
function focusButton(): void {
  button.value?.focus();
}

defineExpose({ focusButton });

onUnmounted(removeListeners);
</script>

<template>
  <button
    ref="button"
    type="button"
    class="display-style-button"
    :title="buttonLabel"
    :aria-label="buttonLabel"
    aria-haspopup="menu"
    :aria-expanded="open"
    @click="onButtonClick"
  >
    <i class="ti" :class="displayModeIcon(style.mode)" aria-hidden="true" />
  </button>
  <Teleport to="body">
    <div
      v-if="open"
      ref="menu"
      class="display-style-menu"
      :class="{ measuring: placement === null }"
      role="menu"
      :aria-label="t('displayStyle.button')"
      :style="
        placement === null
          ? undefined
          : { left: `${String(placement.left)}px`, top: `${String(placement.top)}px` }
      "
      @contextmenu.prevent
      @keydown="onMenuKeyDown"
    >
      <button
        v-for="item in modeItems"
        :key="item.key"
        type="button"
        role="menuitemradio"
        class="row"
        :aria-checked="item.checked"
        @click="choose(item)"
      >
        <i class="ti ti-check check" :class="{ off: !item.checked }" aria-hidden="true" />
        <i class="ti icon" :class="displayModeIcon(item.mode)" aria-hidden="true" />
        <span class="label">{{ t(item.label) }}</span>
      </button>
      <div role="separator" class="separator" />
      <template v-for="item in otherItems" :key="item.key">
        <button
          v-if="item.kind === 'toggle'"
          type="button"
          role="menuitemcheckbox"
          class="row"
          :aria-checked="item.checked"
          :aria-disabled="item.enabled ? undefined : 'true'"
          @click="choose(item)"
        >
          <i class="ti ti-check check" :class="{ off: !item.checked }" aria-hidden="true" />
          <span class="label">{{ t(item.label) }}</span>
        </button>
        <button
          v-else
          type="button"
          role="menuitem"
          class="row"
          :aria-disabled="item.enabled ? undefined : 'true'"
          @click="choose(item)"
        >
          <i class="ti ti-check check off" aria-hidden="true" />
          <span class="label">{{ t(item.label) }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
/* Left of the view cube at the top edge: the panels on the right start under the cube (the
   view cube reserve), so under it the button would cover them. */
.display-style-button {
  position: absolute;
  top: 8px;
  right: var(--view-cube-reserve);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0.5px solid var(--panel-border);
  border-radius: var(--radius-button);
  background: var(--panel-bg);
  backdrop-filter: var(--panel-blur);
  -webkit-backdrop-filter: var(--panel-blur);
  box-shadow: inset 0 0.5px 0 var(--panel-highlight);
  color: var(--text-secondary);
  font-size: 20px;
  cursor: pointer;
}
.display-style-button:hover,
.display-style-button[aria-expanded='true'] {
  color: var(--text-primary);
}
.display-style-menu {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 100;
  /* The measured size must not depend on the position. */
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
.display-style-menu.measuring {
  visibility: hidden;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: calc(100% - 10px);
  height: 24px;
  margin: 0 5px;
  padding: 0 8px 0 4px;
  border: none;
  border-radius: 5px;
  background: none;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
}
.row:hover:not([aria-disabled='true']),
.row:focus-visible {
  background: var(--accent);
  color: var(--on-accent);
  outline: none;
}
.row[aria-disabled='true'] {
  color: var(--text-tertiary);
}
.check {
  width: 16px;
  font-size: 14px;
}
.check.off {
  visibility: hidden;
}
.icon {
  font-size: 16px;
}
.separator {
  height: 0.5px;
  margin: 5px 10px;
  background: var(--panel-border);
}
</style>

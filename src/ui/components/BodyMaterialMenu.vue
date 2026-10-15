<script setup lang="ts">
// The material button of a body row in the Browser (spec 11, "Materiál tělesa", M24, Q078): a
// small icon button right after the colour field, a click opens a menu of the materials as radio
// items, a choice goes to BrowserModel.setMaterial. Built like DisplayStyleMenu: teleported to
// <body>, placed by placeMenu once measured, the focus moved by menuFocusIndex, Esc, a click
// outside or a choice closes it and gives the focus back to the button. The button sits in a
// treeitem, so its clicks stop there (they would select the row or start the rename); the menu
// is teleported out of the row, so its events never reach the row.
import { computed, nextTick, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BodyMaterial } from '@/app';
import type { BrowserBodyRow } from '@/interaction';
import { useSession } from '../composables/use-session';
import { bodyMaterialLabel, bodyMaterialMenuItems } from '../body-material';
import { isMenuNavigationKey, menuFocusIndex } from '../menu-navigation';
import { placeMenu } from '../menu-position';
import type { MenuPlacement } from '../menu-position';

const props = defineProps<{
  row: BrowserBodyRow;
  /** The shown name of the body (user name or the automatic one), for the labels. */
  name: string;
  /** Without BrowserModel.canEdit. */
  disabled: boolean;
}>();

const { t } = useI18n();
const { browser } = useSession();
const items = computed(() => bodyMaterialMenuItems(props.row.material));
const buttonLabel = computed(() =>
  t('browser.materialCurrent', {
    name: props.name,
    material: t(bodyMaterialLabel(props.row.material)),
  }),
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
  // Under the button, from its left edge: the Browser is on the left, so the menu opens to the
  // right over the canvas.
  placement.value = placeMenu(
    { x: box.left, y: box.bottom + 4 },
    { width: size.width, height: size.height },
    { width: globalThis.innerWidth, height: globalThis.innerHeight },
  );
}

function itemButtons(): HTMLButtonElement[] {
  return Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('button') ?? []);
}

function focusItem(index: number | null): void {
  if (index !== null) itemButtons()[index]?.focus();
}

/** All materials can be chosen. */
function enabledFlags(): boolean[] {
  return items.value.map(() => true);
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
  // The checked material first; the first item only if none is checked (never with a valid row).
  const checked = items.value.findIndex((item) => item.checked);
  focusItem(checked === -1 ? menuFocusIndex(enabledFlags(), null, 'Home') : checked);
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

function choose(material: BodyMaterial): void {
  closeMenu();
  browser.setMaterial(props.row.body, material);
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

// Esc on the window (capture), like DisplayStyleMenu: it closes the menu also when no item has
// the focus, and stops there, so it never reaches the global keyboard of AppShell nor a dialog.
function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  closeMenu();
}

// The arrows, Home and End while the focus is in the menu; preventDefault keeps them from the
// global keyboard of AppShell and from scrolling. Enter and Space click the item natively.
function onMenuKeyDown(e: KeyboardEvent): void {
  if (!isMenuNavigationKey(e.key)) return;
  e.preventDefault();
  const current = itemButtons().findIndex((item) => item === globalThis.document.activeElement);
  focusItem(menuFocusIndex(enabledFlags(), current === -1 ? null : current, e.key));
}

// The editing got disabled (a dialog opened, read only): the menu goes away too.
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) closeMenu();
  },
);

onUnmounted(removeListeners);
</script>

<template>
  <button
    ref="button"
    type="button"
    class="material-button"
    :title="buttonLabel"
    :aria-label="buttonLabel"
    aria-haspopup="menu"
    :aria-expanded="open"
    :disabled="disabled"
    @click.stop="onButtonClick"
    @dblclick.stop
  >
    <i class="ti ti-texture" aria-hidden="true" />
  </button>
  <Teleport to="body">
    <div
      v-if="open"
      ref="menu"
      class="material-menu"
      :class="{ measuring: placement === null }"
      role="menu"
      :aria-label="t('browser.material', { name })"
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
        :key="item.material"
        type="button"
        role="menuitemradio"
        class="row"
        :aria-checked="item.checked"
        @click="choose(item.material)"
      >
        <i class="ti ti-check check" :class="{ off: !item.checked }" aria-hidden="true" />
        <span class="label">{{ t(item.label) }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
/* As big as the colour field next to it. */
.material-button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: var(--radius-row);
  background: none;
  color: var(--text-secondary);
}
.material-button i {
  font-size: 16px;
}
.material-button:hover:not(:disabled),
.material-button[aria-expanded='true'] {
  background: var(--control-hover);
  color: var(--text-primary);
}
.material-button:disabled {
  opacity: 0.4;
}
.material-menu {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 100;
  /* The measured size must not depend on the position. */
  width: max-content;
  min-width: 120px;
  padding: 5px 0;
  border-radius: var(--radius-menu);
  background: var(--panel-bg);
  backdrop-filter: var(--panel-blur);
  -webkit-backdrop-filter: var(--panel-blur);
  border: 0.5px solid var(--panel-border);
  box-shadow:
    var(--panel-shadow),
    inset 0 0.5px 0 var(--panel-highlight);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: var(--font-size);
}
/* Rendered for the measurement, not yet placed. */
.material-menu.measuring {
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
.row:hover,
.row:focus-visible {
  background: var(--accent);
  color: var(--on-accent);
  outline: none;
}
.check {
  width: 16px;
  font-size: 14px;
}
.check.off {
  visibility: hidden;
}
</style>

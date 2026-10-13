<script setup lang="ts">
// Shared context menu built from an ActionState[] snapshot (spec 11, "Komponenty"). It only
// shows the given actions and reports which one was chosen; what the menu contains and what
// running an action does is decided by the caller and the ActionRegistry.
import { onMounted, onUnmounted, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ActionState } from '@/interaction';
import { isMacPlatform } from '../keyboard';

defineProps<{
  items: readonly ActionState[];
  /** Position of the top left corner in viewport pixels (clientX/clientY of the click). */
  x: number;
  y: number;
}>();
const emit = defineEmits<{ run: [id: string]; close: [] }>();

const { t } = useI18n();
const menu = useTemplateRef<HTMLElement>('menu');
// globalThis, not window/navigator: the ESLint config has no browser globals for .vue files
// (no-undef); the types are the same.
const isMac = isMacPlatform(globalThis.navigator.userAgent);

/** Symbols of named keys and modifiers as macOS menus show them. */
const MAC_KEYS: Readonly<Record<string, string>> = Object.freeze({
  Mod: '⌘',
  Shift: '⇧',
  Alt: '⌥',
  Delete: '⌫',
  Backspace: '⌫',
  Enter: '↩',
  Escape: '⎋',
});
const OTHER_KEYS: Readonly<Record<string, string>> = Object.freeze({ Mod: 'Ctrl' });

/** 'Mod+Shift+Z' → '⌘⇧Z' on macOS, 'Ctrl+Shift+Z' elsewhere (spec 10: formatting is ui's). */
function shortcutText(shortcut: string): string {
  const names = isMac ? MAC_KEYS : OTHER_KEYS;
  const tokens = shortcut.split('+').map((token) => names[token] ?? token.toUpperCase());
  return tokens.join(isMac ? '' : '+');
}

function choose(item: ActionState): void {
  if (!item.enabled) return;
  emit('run', item.id);
  emit('close');
}

function onPointerDown(e: PointerEvent): void {
  if (e.target instanceof Node && menu.value?.contains(e.target) === true) return;
  emit('close');
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close');
}

onMounted(() => {
  globalThis.addEventListener('pointerdown', onPointerDown, true);
  globalThis.addEventListener('keydown', onKeyDown, true);
});
onUnmounted(() => {
  globalThis.removeEventListener('pointerdown', onPointerDown, true);
  globalThis.removeEventListener('keydown', onKeyDown, true);
});
</script>

<template>
  <div
    ref="menu"
    class="context-menu"
    role="menu"
    :style="{ left: `${String(x)}px`, top: `${String(y)}px` }"
    @contextmenu.prevent
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
      <span class="label">{{ t(item.label) }}</span>
      <span v-if="item.shortcut !== null" class="shortcut">{{ shortcutText(item.shortcut) }}</span>
    </button>
  </div>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 100;
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
.row:hover:not(:disabled) {
  background: var(--accent);
  color: var(--on-accent);
}
.row:disabled {
  color: var(--text-tertiary);
}
.shortcut {
  margin-left: auto;
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
}
.row:hover:not(:disabled) .shortcut {
  color: inherit;
  opacity: 0.75;
}
</style>

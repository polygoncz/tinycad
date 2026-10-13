<script setup lang="ts">
// The window of one open document (spec 11, "Rozvržení"): docked title bar and toolbar on top,
// the Timeline at the bottom, the viewport filling the area between them and the floating
// Browser and feature dialog over it. The panels are DOM siblings of the viewport host, never
// its children, so pointer and wheel events over a panel never reach the view.
// Also the page-level bindings of a session: the theme (Q072) and the global keyboard.
import { onMounted, onUnmounted, useTemplateRef, watch } from 'vue';
import type { AppSession } from '@/app';
import { provideSession } from '../composables/use-session';
import { useObservable } from '../composables/use-observable';
import { isMacPlatform, toViewKeyEvent } from '../keyboard';
import { useTheme } from '../theme/use-theme';
import Browser from './Browser.vue';
import FeatureDialog from './FeatureDialog.vue';
import Timeline from './Timeline.vue';
import TitleBar from './TitleBar.vue';
import Toolbar from './Toolbar.vue';
import ViewportHost from './ViewportHost.vue';

const props = defineProps<{ session: AppSession }>();
// One session per AppShell: App.vue mounts a new AppShell for every document.
const session = props.session;
provideSession(session);

const editSession = useObservable(session.features.current);

// The theme belongs to the page; the session only follows it with the scene palette.
const { theme } = useTheme();
watch(
  theme,
  (value) => {
    session.setTheme(value);
  },
  { immediate: true },
);

// Global keyboard (spec 10, "Akce a klávesové zkratky"): window keys → ViewKeyEvent →
// ActionRegistry.handleKey, which ignores text fields. Keys on the focused canvas are not
// handled here: render forwards them to the active tool, whose unhandled keys reach
// handleKey already (ToolManager.unhandledKey) – a second call would run the action twice.
const viewport = useTemplateRef<InstanceType<typeof ViewportHost>>('viewport');
const isMac = isMacPlatform(globalThis.navigator.userAgent);

function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.isComposing) return;
  if (e.target instanceof Node && viewport.value?.contains(e.target) === true) return;
  if (session.actions.handleKey(toViewKeyEvent(e, isMac))) e.preventDefault();
}

onMounted(() => {
  globalThis.addEventListener('keydown', onKeyDown);
});
onUnmounted(() => {
  globalThis.removeEventListener('keydown', onKeyDown);
});
</script>

<template>
  <div class="app-shell">
    <header class="top">
      <TitleBar />
      <Toolbar />
    </header>
    <main class="stage">
      <ViewportHost ref="viewport" />
      <Browser class="floating-browser" />
      <FeatureDialog v-if="editSession !== null" :key="editSession.featureId" :edit="editSession" />
    </main>
    <Timeline />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--page-bg);
}
.top {
  flex: none;
  position: relative;
  z-index: 10;
}
.stage {
  position: relative;
  flex: 1;
  min-height: 0;
}
.floating-browser {
  position: absolute;
  left: 12px;
  top: 12px;
  max-height: calc(100% - 24px);
  overflow: auto;
}
</style>

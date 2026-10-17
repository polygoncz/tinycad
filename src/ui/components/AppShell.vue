<script setup lang="ts">
// The window of one open document (spec 11, "Rozvržení"): docked title bar and toolbar on top,
// the Timeline at the bottom, the viewport filling the area between them and the floating
// Browser and the feature dialog over it (the generated one or an own one of the type, dialogFor,
// M13) – or, while a sketch session is open (M12), the sketch panel instead of the dialog: the
// sketch is a feature edit session too, but it has its own panel. In development the debug panel
// of topological names floats bottom left (M14). While a sketch is open, its dimensions (M19.2
// D4), the dimensions of a selected pattern (M36) and the glyphs of its constraints (M25) lie
// over the view, above the viewport host and below the floating panels. The panels are DOM
// siblings of the viewport host, never its children, so pointer and wheel events over a panel never reach the view.
// M15: the history panel floats on the right where the dialog and the sketch panel are, so it is
// drawn only without them; whether it is open is layout state of this window (the TitleBar
// switch), nothing of the session.
// Also the page-level bindings of a session: the theme (Q072), the view cube labels of the
// language (M17), the rotation mode of the camera (M17.1), the display style of the bodies (M22,
// its button left of the view cube), the AO settings (M23, their panel opened from the display
// style menu), the global keyboard and the toasts of the notices of the session (M48).
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AppSession } from '@/app';
import { provideSession } from '../composables/use-session';
import { useObservable } from '../composables/use-observable';
import { isAoDrawn } from '../display-style/menu-items';
import { useAoSettings } from '../display-style/use-ao-settings';
import { useDisplayStyle } from '../display-style/use-display-style';
import { isMacPlatform, toViewKeyEvent } from '../keyboard';
import { useOrbitMode } from '../orbit-mode/use-orbit-mode';
import { useTheme } from '../theme/use-theme';
import AoSettingsPanel from './AoSettingsPanel.vue';
import Browser from './Browser.vue';
import DisplayStyleMenu from './DisplayStyleMenu.vue';
import { dialogFor } from './feature-dialogs';
import HistoryPanel from './HistoryPanel.vue';
import SketchDimensions from './SketchDimensions.vue';
import SketchGlyphs from './SketchGlyphs.vue';
import SketchInput from './SketchInput.vue';
import SketchPanel from './SketchPanel.vue';
import SketchPatternDimensions from './SketchPatternDimensions.vue';
import Timeline from './Timeline.vue';
import TitleBar from './TitleBar.vue';
import ToastStack from './ToastStack.vue';
import { isCloseErrorToast, noticeIdOf, pageToasts, toastItemsOf } from '../toasts';
import type { ToastItem } from '../toasts';
import Toolbar from './Toolbar.vue';
import TopoDebugPanel from './TopoDebugPanel.vue';
import { viewCubeLabels } from '../view-cube-labels';
import ViewportHost from './ViewportHost.vue';

const props = defineProps<{
  session: AppSession;
  /** The error of closing the previous document as a toast (App.vue); [] = none (N170). */
  closeToasts: readonly ToastItem[];
}>();
const emit = defineEmits<{ 'dismiss-close': [] }>();
// One session per AppShell: App.vue mounts a new AppShell for every document.
const session = props.session;
provideSession(session);

const editSession = useObservable(session.features.current);
const sketchSession = useObservable(session.sketches.current);
const historyOpen = ref(false);

// The theme belongs to the page; the session only follows it with the scene palette.
const { theme } = useTheme();
watch(
  theme,
  (value) => {
    session.viewSettings.setTheme(value);
  },
  { immediate: true },
);

// The labels of the view cube follow the language of the page (M17); render knows no i18n.
const { t, locale } = useI18n();
watch(
  locale,
  () => {
    session.viewSettings.setViewCubeLabels(viewCubeLabels((key) => t(key)));
  },
  { immediate: true },
);

// M48: the transient notices of the session as toasts (N151), in one stack with the error of
// closing the previous document (N170); closing a toast dismisses its source.
const notices = useObservable(session.notices);
const toasts = computed(() =>
  pageToasts(
    props.closeToasts,
    toastItemsOf(notices.value, (key, params) => t(key, { ...params })),
  ),
);
function dismissToast(id: string): void {
  if (isCloseErrorToast(id)) {
    emit('dismiss-close');
    return;
  }
  const notice = noticeIdOf(id);
  if (notice !== null) session.dismissNotice(notice);
}

// The rotation mode belongs to the page like the theme (M17.1, ADR 0020); the button at the
// view cube only asks for a toggle, the controller decides and remembers.
const orbitMode = useOrbitMode();
watch(
  orbitMode.mode,
  (value) => {
    session.viewSettings.setOrbitMode(value);
  },
  { immediate: true },
);
const offOrbitModeToggle = session.viewSettings.onOrbitModeToggle(() => {
  orbitMode.toggle();
});

// The display style belongs to the page too (M22); DisplayStyleMenu changes it in the controller.
const { style: displayStyle } = useDisplayStyle();
watch(
  displayStyle,
  (value) => {
    session.viewSettings.setDisplayStyle(value);
  },
  { immediate: true },
);

// The AO settings are a page preference next to the style (M23, Q081). Whether their panel is
// open is layout state of this window; it closes by itself when AO stops drawing (mode,
// transparency, AO off), by × and Esc it gives the focus back to the display style button.
const { settings: aoSettings } = useAoSettings();
watch(
  aoSettings,
  (value) => {
    session.viewSettings.setAoSettings(value);
  },
  { immediate: true },
);
const aoSettingsOpen = ref(false);
const displayStyleMenu = useTemplateRef<InstanceType<typeof DisplayStyleMenu>>('displayStyleMenu');
watch(
  () => isAoDrawn(displayStyle.value),
  (drawn) => {
    if (!drawn) aoSettingsOpen.value = false;
  },
);

function closeAoSettings(): void {
  aoSettingsOpen.value = false;
  displayStyleMenu.value?.focusButton();
}

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
  offOrbitModeToggle();
});
</script>

<template>
  <div class="app-shell">
    <header class="top">
      <TitleBar :history-open="historyOpen" @toggle-history="historyOpen = !historyOpen" />
      <Toolbar />
    </header>
    <main class="stage">
      <ViewportHost ref="viewport" />
      <DisplayStyleMenu ref="displayStyleMenu" @open-ao-settings="aoSettingsOpen = true" />
      <AoSettingsPanel v-if="aoSettingsOpen" @close="closeAoSettings" />
      <SketchDimensions
        v-if="sketchSession !== null"
        :key="`dimensions-${sketchSession.featureId}`"
        :sketch="sketchSession"
      />
      <SketchPatternDimensions
        v-if="sketchSession !== null"
        :key="`pattern-dimensions-${sketchSession.featureId}`"
        :sketch="sketchSession"
      />
      <SketchGlyphs
        v-if="sketchSession !== null"
        :key="`glyphs-${sketchSession.featureId}`"
        :sketch="sketchSession"
      />
      <SketchInput
        v-if="sketchSession !== null"
        :key="`input-${sketchSession.featureId}`"
        :sketch="sketchSession"
      />
      <Browser class="floating-browser" />
      <TopoDebugPanel />
      <SketchPanel
        v-if="sketchSession !== null"
        :key="sketchSession.featureId"
        :sketch="sketchSession"
      />
      <component
        :is="dialogFor(editSession.schema.type)"
        v-else-if="editSession !== null"
        :key="editSession.featureId"
        :edit="editSession"
      />
      <HistoryPanel v-else-if="historyOpen" />
    </main>
    <Timeline />
    <ToastStack :items="toasts" @dismiss="dismissToast" />
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

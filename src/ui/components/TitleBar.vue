<script setup lang="ts">
// The title bar (spec 11, "Komponenty"): the way to the document list, the document name with a
// dot for the save state while saving works (green saved, orange pending), the read-only notice
// (Q038), the notices of the states that need the user's attention (M19.1, titleBarNotices: a
// save that fails or no longer works with Export, the kernel that starts, restarts or does not
// run with Try again, a regeneration that threw; the technical cause in expandable Details) and
// the switches of language and theme; in development builds also the switch of the debug panel
// of topological names (M14, R111). M15: the File menu (the actions of session.fileActionIds)
// with the state of an export and its warning (M19.1: a document exported without history), and
// the switch of the history panel (its open state is layout of AppShell). M19.2 (D5): the name
// is a button that turns into a text field; Enter or leaving it renames through
// session.documentName (outside undo), Esc cancels. Only bindings.
import { computed, nextTick, ref, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { useObservable } from '../composables/use-observable';
import { useSession } from '../composables/use-session';
import { fileMenuItems } from '../file-menu';
import { finishEdit } from '../inline-rename';
import { saveDotOf, titleBarNotices } from '../title-bar-status';
import type { NoticeAction } from '../title-bar-status';
import ContextMenu from './ContextMenu.vue';
import ThemeLocaleToggles from './ThemeLocaleToggles.vue';

defineProps<{ historyOpen: boolean }>();
const emit = defineEmits<{ toggleHistory: [] }>();

const session = useSession();
const { t } = useI18n();

const actionStates = useObservable(session.actions.actions);
const fileActionIds = Object.values(session.fileActionIds);
const fileItems = computed(() => fileMenuItems(actionStates.value, fileActionIds));
const fileStatus = useObservable(session.files.status);
const fileMenu = ref<{ readonly x: number; readonly y: number } | null>(null);

function openFileMenu(e: MouseEvent): void {
  const target = e.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  const box = target.getBoundingClientRect();
  fileMenu.value = { x: box.left, y: box.bottom + 4 };
}

const persistence = useObservable(session.persistence);
const persistenceError = useObservable(session.persistenceError);
const kernel = useObservable(session.kernel);
const kernelError = useObservable(session.kernelError);
const regen = useObservable(session.regen);
const saveDot = computed(() => saveDotOf(persistence.value));
const notices = computed(() =>
  titleBarNotices({
    persistence: persistence.value,
    persistenceError: persistenceError.value,
    kernel: kernel.value,
    kernelError: kernelError.value,
    regenFailed: regen.value.failed,
  }),
);
// The debug switch exists only in development builds (spec 11); production drops it.
const debugSwitch = import.meta.env.DEV;
const topoNamesShown = useObservable(session.topoInspector.enabled);
const documentName = useObservable(session.documentName.name);
const canRename = useObservable(session.documentName.canRename);
// The running edit of the name (true) and its text; one edit commits at most once.
const renaming = ref<true | null>(null);
const nameText = ref('');
const nameInput = useTemplateRef<HTMLInputElement>('nameInput');
const nameButton = useTemplateRef<HTMLButtonElement>('nameButton');

async function startRename(): Promise<void> {
  if (!canRename.value) return;
  nameText.value = documentName.value;
  renaming.value = true;
  await nextTick();
  nameInput.value?.select();
}

/** Enter or leaving the field. An empty name is refused: the field closes on the old name. */
function commitRename(): void {
  if (finishEdit(renaming) === null) return;
  session.documentName.rename(nameText.value);
}

function cancelRename(): void {
  finishEdit(renaming);
}

/** Enter or Esc: the focus goes back to the name, not to the page. */
async function endRenameByKey(commit: boolean): Promise<void> {
  if (commit) commitRename();
  else cancelRename();
  await nextTick();
  nameButton.value?.focus();
}

function showDocuments(): void {
  globalThis.location.hash = '';
}

function runNotice(action: NoticeAction): void {
  if (action === 'retryKernel') session.retryKernel();
  else session.actions.run(session.fileActionIds.exportDocument);
}

function toggleTopoNames(): void {
  session.topoInspector.toggle();
}
</script>

<template>
  <div class="title-bar">
    <button
      type="button"
      class="icon-button"
      :title="t('titleBar.documents')"
      @click="showDocuments"
    >
      <i class="ti ti-layout-grid" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="icon-button"
      :title="t('titleBar.file')"
      :aria-label="t('titleBar.file')"
      aria-haspopup="menu"
      :aria-expanded="fileMenu !== null"
      @click="openFileMenu"
    >
      <i class="ti ti-file-export" aria-hidden="true" />
    </button>
    <span v-if="fileStatus.kind === 'running'" class="file-status" role="status">
      <i class="ti ti-loader-2" aria-hidden="true" /> {{ t('file.running') }}
    </span>
    <span
      v-else-if="fileStatus.kind === 'failed'"
      class="file-status failed"
      role="alert"
      :title="fileStatus.message"
    >
      <i class="ti ti-alert-triangle" aria-hidden="true" /> {{ t('file.failed') }}
      <button
        type="button"
        class="dismiss"
        :title="t('app.dismiss')"
        :aria-label="t('app.dismiss')"
        @click="session.files.dismiss()"
      >
        <i class="ti ti-x" aria-hidden="true" />
      </button>
    </span>
    <span
      v-else-if="fileStatus.kind === 'idle' && fileStatus.warning !== null"
      class="file-status warning"
      role="status"
    >
      <i class="ti ti-alert-circle" aria-hidden="true" /> {{ t(fileStatus.warning) }}
      <button
        type="button"
        class="dismiss"
        :title="t('app.dismiss')"
        :aria-label="t('app.dismiss')"
        @click="session.files.dismiss()"
      >
        <i class="ti ti-x" aria-hidden="true" />
      </button>
    </span>

    <div class="title">
      <input
        v-if="renaming !== null"
        ref="nameInput"
        v-model="nameText"
        type="text"
        class="name-input"
        :aria-label="t('documents.name')"
        @keydown.enter.prevent="endRenameByKey(true)"
        @keydown.esc.prevent="endRenameByKey(false)"
        @blur="commitRename"
      />
      <button
        v-else
        ref="nameButton"
        type="button"
        class="name"
        :title="t('titleBar.rename')"
        :aria-label="t('titleBar.rename')"
        :disabled="!canRename"
        @click="startRename"
      >
        {{ documentName }}
      </button>
      <span v-if="session.readOnly" class="read-only" :title="t('titleBar.readOnlyHint')">
        <i class="ti ti-lock" aria-hidden="true" /> {{ t('titleBar.readOnly') }}
      </span>
      <span
        v-else-if="saveDot !== null"
        class="save-dot"
        :class="saveDot"
        role="status"
        :title="t(`titleBar.persistence.${saveDot}`)"
        :aria-label="t(`titleBar.persistence.${saveDot}`)"
      />
    </div>

    <!-- A new state is a new element (the key has the text), so a screen reader announces it. -->
    <span
      v-for="notice in notices"
      :key="`${notice.id}:${notice.text}`"
      class="notice"
      :class="notice.tone"
      :role="notice.tone === 'error' ? 'alert' : 'status'"
    >
      <i
        class="ti"
        :class="notice.tone === 'error' ? 'ti-alert-triangle' : 'ti-loader-2'"
        aria-hidden="true"
      />
      {{ t(notice.text) }}
      <details v-if="notice.detail !== null" class="details">
        <summary>{{ t('titleBar.details') }}</summary>
        <p class="detail">{{ notice.detail }}</p>
      </details>
      <button
        v-if="notice.action !== null"
        type="button"
        class="notice-action"
        @click="runNotice(notice.action.kind)"
      >
        {{ t(notice.action.label) }}
      </button>
    </span>

    <button
      v-if="debugSwitch"
      type="button"
      class="icon-button"
      :class="{ active: topoNamesShown }"
      :title="t('debug.topoNames')"
      :aria-pressed="topoNamesShown"
      @click="toggleTopoNames"
    >
      <i class="ti ti-tag" aria-hidden="true" />
    </button>

    <button
      type="button"
      class="icon-button"
      :class="{ active: historyOpen }"
      :title="t('history.title')"
      :aria-label="t('history.title')"
      :aria-pressed="historyOpen"
      @click="emit('toggleHistory')"
    >
      <i class="ti ti-history" aria-hidden="true" />
    </button>

    <ThemeLocaleToggles />

    <ContextMenu
      v-if="fileMenu !== null"
      :items="fileItems"
      :x="fileMenu.x"
      :y="fileMenu.y"
      @run="(id) => session.actions.run(id)"
      @close="fileMenu = null"
    />
  </div>
</template>

<style scoped>
/* The backdrop filter makes the bar a stacking context; above the Toolbar that follows it, so
   the Details of a notice (absolute, dropping out of the bar) are not covered by it. The File
   menu does not need it: ContextMenu is teleported to <body> (M19.1). */
.title-bar {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 12px;
  background: var(--chrome-bg);
  backdrop-filter: var(--chrome-blur);
  -webkit-backdrop-filter: var(--chrome-blur);
  border-bottom: 0.5px solid var(--chrome-border);
  color: var(--text-primary);
}
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-row);
  background: none;
  color: var(--text-secondary);
  font-size: 18px;
}
.icon-button:hover {
  background: var(--control-hover);
}
.icon-button.active {
  color: var(--accent);
}
.title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-weight: 600;
}
.name {
  min-width: 0;
  padding: 2px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: none;
  border-radius: var(--radius-row);
  background: none;
  color: inherit;
  font: inherit;
}
.name:hover:enabled {
  background: var(--control-hover);
}
.name-input {
  width: min(320px, 100%);
  min-width: 0;
  height: 24px;
  padding: 0 6px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-row);
  background: var(--field-bg);
  color: inherit;
  font: inherit;
  text-align: center;
}
.save-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
}
.save-dot.pending {
  background: var(--warning);
}
.read-only {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: var(--radius-row);
  background: var(--control-hover);
  color: var(--text-secondary);
  font-size: var(--font-size-small);
  font-weight: 500;
}
.notice {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
  white-space: nowrap;
}
.notice.error {
  color: var(--danger);
}
.details {
  position: relative;
  color: var(--text-secondary);
}
.details > summary {
  cursor: pointer;
  list-style: none;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.details > summary::-webkit-details-marker {
  display: none;
}
.detail {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: max-content;
  max-width: 360px;
  margin: 0;
  padding: 6px 9px;
  border-radius: var(--radius-row);
  background: var(--tooltip-bg);
  color: var(--tooltip-text);
  font-size: var(--font-size-small);
  line-height: var(--line-height);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}
.file-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}
.file-status.failed {
  color: var(--danger);
}
/* Orange text would be hard to read on the bar; the icon carries the colour. */
.file-status.warning > .ti {
  color: var(--warning);
}
.dismiss {
  display: inline-flex;
  border: none;
  background: none;
  padding: 2px;
  border-radius: var(--radius-row);
  color: var(--text-secondary);
}
.dismiss:hover {
  background: var(--control-hover);
}
.notice-action {
  height: 22px;
  margin-left: 4px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-row);
  background: var(--accent);
  color: var(--on-accent);
  font: inherit;
  font-weight: 500;
}
</style>

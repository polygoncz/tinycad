<script setup lang="ts">
// The root of the page (spec 11, "Dokumenty"): no router, the open document is location.hash
// (#/d/<id>). An empty hash shows the DocumentList; a change of the hash closes the old session
// (awaiting its final save) and opens the new one through the DocumentSwitcher. The session
// reaches the components only through AppShell's provideSession (rule 5).
import { onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { openAppSession } from '@/app';
import type { AppSession, OpenAppSessionOptions } from '@/app';
import AppShell from './components/AppShell.vue';
import DocumentList from './components/DocumentList.vue';
import { createDocumentSwitcher } from './document-switcher';
import { addPluginMessages } from './i18n/i18n';
import { useUiI18n } from './i18n/use-ui-i18n';
import { parseDocHash } from './route';
import { useTheme } from './theme/use-theme';

const props = defineProps<{ plugins: OpenAppSessionOptions['plugins'] }>();

const i18n = useUiI18n();
const { t } = useI18n();
// Applies data-theme on <html> right away, also for the document list.
const theme = useTheme();

const switcher = createDocumentSwitcher<AppSession>({
  async open(docId) {
    const session = await openAppSession({
      docId,
      plugins: props.plugins,
      // Called later (name of a new feature), when the plugin texts are already added.
      translate: (key) => i18n.global.t(key),
      theme: theme.theme.value,
    });
    try {
      addPluginMessages(i18n, session.messages);
    } catch (e) {
      session.dispose();
      throw e;
    }
    return session;
  },
});
const view = switcher.view;

function onHashChange(): void {
  // show never rejects: failures of open and close end up in the view.
  void switcher.show(parseDocHash(globalThis.location.hash));
}

function backToList(): void {
  globalThis.location.hash = '';
}

onMounted(() => {
  globalThis.addEventListener('hashchange', onHashChange);
  onHashChange();
});
onUnmounted(() => {
  globalThis.removeEventListener('hashchange', onHashChange);
  switcher.dispose();
});
</script>

<template>
  <AppShell v-if="view.session !== null" :key="view.docId ?? ''" :session="view.session" />
  <div v-else class="start">
    <DocumentList v-if="view.docId === null" />
    <div v-else class="notice" role="status">
      <template v-if="view.openError !== null">
        <i class="ti ti-alert-triangle error-icon" aria-hidden="true" />
        <p>{{ t('app.openError') }}</p>
        <p class="detail">{{ view.openError }}</p>
        <button type="button" class="button" @click="backToList">{{ t('app.backToList') }}</button>
      </template>
      <template v-else>
        <i class="ti ti-loader-2 spinner" aria-hidden="true" />
        <p>{{ t('app.opening') }}</p>
      </template>
    </div>
  </div>

  <div v-if="view.closeError !== null" class="toast" role="alert">
    <i class="ti ti-alert-triangle error-icon" aria-hidden="true" />
    <span>{{ t('app.closeError', { error: view.closeError }) }}</span>
    <button
      type="button"
      class="dismiss"
      :title="t('app.dismiss')"
      @click="switcher.dismissCloseError()"
    >
      <i class="ti ti-x" aria-hidden="true" />
    </button>
  </div>
</template>

<style>
/* Page-wide base: the app fills the window, no page scrolling (the viewport takes the wheel). */
html,
body,
#app {
  height: 100%;
  margin: 0;
  overflow: hidden;
}
body {
  font-family: var(--font-ui);
  font-size: var(--font-size);
  line-height: var(--line-height);
  color: var(--text-primary);
  background: var(--page-bg);
  -webkit-font-smoothing: antialiased;
}
* {
  box-sizing: border-box;
}
</style>

<style scoped>
.start {
  position: relative;
  height: 100%;
}
.notice {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--text-secondary);
}
.notice p {
  margin: 0;
}
.detail {
  font-size: var(--font-size-small);
  color: var(--text-tertiary);
}
.spinner,
.error-icon {
  font-size: 22px;
}
.error-icon {
  color: var(--danger);
}
.button {
  margin-top: 10px;
  height: var(--field-height);
  padding: 0 14px;
  border: none;
  border-radius: var(--radius-control);
  background: var(--control-hover);
  color: var(--text-primary);
  font: inherit;
  font-weight: 500;
}
.toast {
  position: fixed;
  left: 50%;
  bottom: 64px;
  z-index: 200;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 560px;
  padding: 8px 10px 8px 12px;
  border-radius: var(--radius-panel);
  background: var(--panel-bg);
  backdrop-filter: var(--panel-blur);
  -webkit-backdrop-filter: var(--panel-blur);
  border: 0.5px solid var(--panel-border);
  box-shadow: var(--panel-shadow);
}
.toast .error-icon {
  font-size: 16px;
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
</style>

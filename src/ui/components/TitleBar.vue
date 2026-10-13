<script setup lang="ts">
// The title bar (spec 11, "Komponenty"): the way to the document list, the document name with a
// dot for the save state (green saved, orange pending, red error), the read-only notice (Q038),
// the kernel restart notice (Q055) and the switches of language and theme. Only bindings.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useObservable } from '../composables/use-observable';
import { useSession } from '../composables/use-session';
import { setUiLocale } from '../i18n/i18n';
import { useUiI18n } from '../i18n/use-ui-i18n';
import { useTheme } from '../theme/use-theme';

const session = useSession();
const { t, locale } = useI18n();
const i18n = useUiI18n();
const themeController = useTheme();
const theme = themeController.theme;

const persistence = useObservable(session.persistence);
const kernel = useObservable(session.kernel);
// No rename of documents in M10, so the name is read once (as in the Browser).
const documentName = session.doc.meta.name;

const nextLocale = computed(() => (locale.value === 'cs' ? 'en' : 'cs'));

function toggleLocale(): void {
  setUiLocale(i18n, nextLocale.value);
}

function toggleTheme(): void {
  themeController.toggle();
}

function showDocuments(): void {
  globalThis.location.hash = '';
}

function reload(): void {
  globalThis.location.reload();
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
      <i class="ti ti-layout-grid" />
    </button>

    <div class="title">
      <span class="name">{{ documentName }}</span>
      <span v-if="session.readOnly" class="read-only" :title="t('titleBar.readOnlyHint')">
        <i class="ti ti-lock" /> {{ t('titleBar.readOnly') }}
      </span>
      <span
        v-else
        class="save-dot"
        :class="persistence"
        role="status"
        :title="t(`titleBar.persistence.${persistence}`)"
        :aria-label="t(`titleBar.persistence.${persistence}`)"
      />
    </div>

    <span v-if="kernel === 'restarting'" class="kernel" role="status">
      <i class="ti ti-loader-2" /> {{ t('titleBar.kernel.restarting') }}
    </span>
    <span v-else-if="kernel === 'failed'" class="kernel failed" role="alert">
      <i class="ti ti-alert-triangle" /> {{ t('titleBar.kernel.failed') }}
      <button type="button" class="reload" @click="reload">
        {{ t('titleBar.kernel.reload') }}
      </button>
    </span>

    <button
      type="button"
      class="icon-button"
      :title="t('titleBar.language', { language: t(`titleBar.locale.${nextLocale}`) })"
      @click="toggleLocale"
    >
      <i class="ti ti-language" />
    </button>
    <button
      type="button"
      class="icon-button"
      :title="theme === 'dark' ? t('titleBar.themeLight') : t('titleBar.themeDark')"
      @click="toggleTheme"
    >
      <i class="ti" :class="theme === 'dark' ? 'ti-sun' : 'ti-moon'" />
    </button>
  </div>
</template>

<style scoped>
.title-bar {
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
.save-dot.error {
  background: var(--danger);
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
.kernel {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}
.kernel.failed {
  color: var(--danger);
}
.reload {
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

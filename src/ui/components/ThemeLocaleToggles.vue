<script setup lang="ts">
// The switches of language and theme (spec 11, "Komponenty"): in the TitleBar and over the
// DocumentList. Both belong to the page, not to a session, so this needs no session.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { setUiLocale } from '../i18n/i18n';
import { useUiI18n } from '../i18n/use-ui-i18n';
import { useTheme } from '../theme/use-theme';

const { t, locale } = useI18n();
const i18n = useUiI18n();
const themeController = useTheme();
const theme = themeController.theme;

const nextLocale = computed(() => (locale.value === 'cs' ? 'en' : 'cs'));

function toggleLocale(): void {
  setUiLocale(i18n, nextLocale.value);
}

function toggleTheme(): void {
  themeController.toggle();
}
</script>

<template>
  <span class="toggles">
    <button
      type="button"
      class="icon-button"
      :title="t('titleBar.language', { language: t(`titleBar.locale.${nextLocale}`) })"
      @click="toggleLocale"
    >
      <i class="ti ti-language" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="icon-button"
      :title="theme === 'dark' ? t('titleBar.themeLight') : t('titleBar.themeDark')"
      @click="toggleTheme"
    >
      <i class="ti" :class="theme === 'dark' ? 'ti-sun' : 'ti-moon'" aria-hidden="true" />
    </button>
  </span>
</template>

<style scoped>
.toggles {
  display: inline-flex;
  align-items: center;
  gap: 10px;
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
</style>

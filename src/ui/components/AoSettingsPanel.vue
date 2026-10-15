<script setup lang="ts">
// The floating panel of the AO settings (spec 11, "Nastavení AO", Q081), opened from the display
// style menu. Not modal: the view stays usable while the user tunes, so a click outside does not
// close it (it may start a camera orbit); only × and Esc do, and AppShell closes it when AO stops
// drawing. A slider changes the value live on input and stores it on change (released). The rows
// and value texts come from ao-settings-panel.ts.
import { computed, onMounted, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AoSettings } from '@/app';
import { aoSettingRows, formatAoSetting } from '../display-style/ao-settings-panel';
import { useAoSettings } from '../display-style/use-ao-settings';

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const aoSettings = useAoSettings();
const rows = computed(() => aoSettingRows(aoSettings.settings.value));
const basicRows = computed(() => rows.value.filter((row) => !row.advanced));
const advancedRows = computed(() => rows.value.filter((row) => row.advanced));

const panel = useTemplateRef<HTMLElement>('panel');

function sliderValue(e: Event): number | null {
  return e.target instanceof HTMLInputElement ? Number(e.target.value) : null;
}

function onInput(key: keyof AoSettings, e: Event): void {
  const value = sliderValue(e);
  if (value !== null) aoSettings.set(key, value);
}

function onChange(): void {
  aoSettings.commit();
}

// Esc while the focus is in the panel; stopped here, so it never reaches the global keyboard of
// AppShell (it would clear the selection or end a tool).
function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  emit('close');
}

function sliderId(key: keyof AoSettings): string {
  return `ao-setting-${key}`;
}

onMounted(() => {
  panel.value?.querySelector<HTMLInputElement>('input[type="range"]')?.focus();
});
</script>

<template>
  <div
    ref="panel"
    class="ao-settings-panel"
    role="dialog"
    :aria-label="t('aoSettings.title')"
    @keydown="onKeyDown"
  >
    <div class="header">
      <span class="title">{{ t('aoSettings.title') }}</span>
      <button
        type="button"
        class="close"
        :title="t('aoSettings.close')"
        :aria-label="t('aoSettings.close')"
        @click="emit('close')"
      >
        <i class="ti ti-x" aria-hidden="true" />
      </button>
    </div>
    <div v-for="row in basicRows" :key="row.key" class="row">
      <label :for="sliderId(row.key)">{{ t(row.label) }}</label>
      <input
        :id="sliderId(row.key)"
        type="range"
        :min="row.range.min"
        :max="row.range.max"
        :step="row.range.step"
        :value="row.value"
        @input="onInput(row.key, $event)"
        @change="onChange"
      />
      <span class="value">{{ formatAoSetting(row.key, row.value) }}</span>
    </div>
    <details class="advanced">
      <summary>{{ t('aoSettings.advanced') }}</summary>
      <div v-for="row in advancedRows" :key="row.key" class="row">
        <label :for="sliderId(row.key)">{{ t(row.label) }}</label>
        <input
          :id="sliderId(row.key)"
          type="range"
          :min="row.range.min"
          :max="row.range.max"
          :step="row.range.step"
          :value="row.value"
          @input="onInput(row.key, $event)"
          @change="onChange"
        />
        <span class="value">{{ formatAoSetting(row.key, row.value) }}</span>
      </div>
    </details>
    <div class="footer">
      <button type="button" class="reset" @click="aoSettings.reset()">
        {{ t('aoSettings.reset') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Under the display style button at the right edge of the viewport. */
.ao-settings-panel {
  position: absolute;
  top: 48px;
  right: var(--view-cube-reserve);
  z-index: 30;
  width: 280px;
  padding: 4px 12px 10px;
  border-radius: var(--radius-panel);
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
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 0 6px;
}
.title {
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--radius-row);
  background: none;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
}
.close:hover {
  color: var(--text-primary);
}
.row {
  display: grid;
  grid-template-columns: 1fr 34px;
  align-items: center;
  column-gap: 8px;
  padding: 3px 0;
}
.row label {
  grid-column: 1 / -1;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}
.row input {
  width: 100%;
  margin: 0;
  accent-color: var(--accent);
}
.value {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.advanced {
  margin-top: 4px;
}
.advanced summary {
  padding: 4px 0;
  color: var(--text-secondary);
  cursor: pointer;
}
.footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
.reset {
  padding: 3px 10px;
  border: 0.5px solid var(--panel-border);
  border-radius: var(--radius-button);
  background: none;
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
}
.reset:hover {
  background: var(--accent);
  color: var(--on-accent);
}
</style>

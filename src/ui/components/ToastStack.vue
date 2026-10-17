<script setup lang="ts">
// The toasts of the page (spec 11, "Komponenty", N151): transient messages at the bottom centre
// above the Timeline, one under another, the newest at the bottom. An error is an alert, the other
// tones a status; the tone has an icon, not only a colour. It takes no focus: the close button is
// an ordinary button in the tab order. What the items are is decided by toasts.ts.
import { useI18n } from 'vue-i18n';
import type { ToastItem } from '../toasts';

defineProps<{ items: readonly ToastItem[] }>();
const emit = defineEmits<{ dismiss: [id: string] }>();
const { t } = useI18n();

const ICONS: Readonly<Record<ToastItem['tone'], string>> = Object.freeze({
  info: 'ti-info-circle',
  warning: 'ti-alert-triangle',
  error: 'ti-alert-circle',
});
</script>

<template>
  <div v-if="items.length > 0" class="toast-stack">
    <div
      v-for="item in items"
      :key="item.id"
      class="toast"
      :class="item.tone"
      :role="item.tone === 'error' ? 'alert' : 'status'"
    >
      <i class="ti tone-icon" :class="ICONS[item.tone]" aria-hidden="true" />
      <span class="text">{{ item.text }}</span>
      <button
        type="button"
        class="dismiss"
        :aria-label="t('app.dismiss')"
        :title="t('app.dismiss')"
        @click="emit('dismiss', item.id)"
      >
        <i class="ti ti-x" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.toast-stack {
  position: fixed;
  left: 50%;
  bottom: 64px;
  z-index: 200;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  max-width: min(560px, calc(100% - 24px));
}
.toast {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 8px 12px;
  border-radius: var(--radius-panel);
  background: var(--panel-bg);
  backdrop-filter: var(--panel-blur);
  -webkit-backdrop-filter: var(--panel-blur);
  border: 0.5px solid var(--panel-border);
  box-shadow: var(--panel-shadow);
  color: var(--text-primary);
}
.tone-icon {
  flex: none;
  font-size: 16px;
}
.info .tone-icon {
  color: var(--accent);
}
.warning .tone-icon {
  color: var(--warning);
}
.error .tone-icon {
  color: var(--danger);
}
.dismiss {
  display: inline-flex;
  flex: none;
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

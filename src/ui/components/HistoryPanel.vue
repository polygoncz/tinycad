<script setup lang="ts">
// The edit history panel (spec 11, "Komponenty", M15, R127, R128): a floating panel on the right
// with the rows of session.history, newest first – the time, the text of the entry ("Undo: …"
// and "Redo: …" rows of their own), an undone entry grey and italic, an abandoned one struck
// through, both also read out by a visually hidden text; below a note on the older entries the
// model leaves out. Read only: going back to an entry would be a branch of the log (Q006).
// AppShell decides when it is drawn. Only bindings: the texts come from history-text.ts.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useObservable } from '../composables/use-observable';
import { useSession } from '../composables/use-session';
import {
  historyRowClass,
  historyStatusText,
  historyText,
  historyTimeFormat,
} from '../history-text';

const session = useSession();
const i18n = useI18n();
const { t, locale } = i18n;
const te = (key: string): boolean => i18n.te(key);

const history = useObservable(session.history.state);
const timeText = computed(() => historyTimeFormat(locale.value));
</script>

<template>
  <aside class="history-panel" :aria-label="t('history.title')">
    <div class="header">{{ t('history.title') }}</div>
    <ol class="rows" role="list">
      <li
        v-for="row in history.rows"
        :key="row.seq"
        class="row"
        :class="historyRowClass(row)"
        role="listitem"
      >
        <span class="time">{{ timeText(row.time) }}</span>
        <span class="text">{{ historyText(row, t, te) }}</span>
        <span v-if="historyStatusText(row, t) !== null" class="status">
          {{ historyStatusText(row, t) }}
        </span>
      </li>
    </ol>
    <div v-if="history.older > 0" class="older">
      {{ t('history.older', { n: history.older }) }}
    </div>
  </aside>
</template>

<style scoped>
.history-panel {
  position: absolute;
  right: 14px;
  top: 12px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  width: 260px;
  max-height: calc(100% - 24px);
  padding-bottom: 6px;
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
  padding: 9px 12px 6px;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.rows {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0 6px;
  overflow: auto;
  list-style: none;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--tree-row);
  padding: 0 6px;
  border-radius: var(--radius-row);
}
.time {
  flex: none;
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
  font-variant-numeric: tabular-nums;
}
.text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row.undone .text {
  color: var(--text-tertiary);
  font-style: italic;
}
.row.abandoned .text {
  color: var(--text-tertiary);
  text-decoration: line-through;
}
/* Visually hidden, read by screen readers. */
.status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.older {
  padding: 6px 12px 0;
  color: var(--text-tertiary);
  font-size: var(--font-size-small);
}
</style>

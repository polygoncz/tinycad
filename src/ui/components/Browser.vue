<script setup lang="ts">
// The Browser (spec 11, "Komponenty"; Prohlížeč): a floating panel on the left with the result
// of modelling – document › Bodies › Body n. Click selects a body, the eye toggles its
// visibility (Q071). Only bindings and layout (rule 4): rows come from BrowserModel, changes go
// back through it. Origin and Sketches come with M11/M12.
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BrowserBodyRow } from '@/interaction';
import { useObservable } from '../composables/use-observable';
import { useSession } from '../composables/use-session';

const session = useSession();
const { browser } = session;
const { t } = useI18n();

const bodies = useObservable(browser.bodies);
// No rename of documents in M10, so the name is read once.
const documentName = session.doc.meta.name;

// Collapsed sections are view state of this panel only.
const panelOpen = ref(true);
const bodiesOpen = ref(true);

function select(row: BrowserBodyRow, e: MouseEvent): void {
  browser.select(row.body, { additive: e.shiftKey || e.metaKey || e.ctrlKey });
}

function toggleVisible(row: BrowserBodyRow): void {
  browser.setVisible(row.body, !row.visible);
}
</script>

<template>
  <aside class="browser">
    <button type="button" class="header" @click="panelOpen = !panelOpen">
      <i
        class="ti chevron"
        :class="panelOpen ? 'ti-chevron-down' : 'ti-chevron-right'"
        aria-hidden="true"
      />
      <span>{{ t('browser.title') }}</span>
    </button>

    <div v-if="panelOpen" class="tree" role="tree">
      <div class="node level-0" role="treeitem">
        <i class="ti ti-chevron-down chevron" aria-hidden="true" />
        <i class="ti ti-cube document-icon" aria-hidden="true" />
        <span class="name document-name">{{ documentName }}</span>
      </div>

      <div
        class="node level-1"
        role="treeitem"
        :aria-expanded="bodiesOpen"
        @click="bodiesOpen = !bodiesOpen"
      >
        <i
          class="ti chevron"
          :class="bodiesOpen ? 'ti-chevron-down' : 'ti-chevron-right'"
          aria-hidden="true"
        />
        <i class="ti ti-folder" aria-hidden="true" />
        <span class="name">{{ t('browser.bodies') }}</span>
      </div>

      <template v-if="bodiesOpen">
        <div
          v-for="row in bodies"
          :key="row.body"
          class="node level-2"
          :class="{ selected: row.selected, hidden: !row.visible }"
          role="treeitem"
          :aria-selected="row.selected"
          @click="select(row, $event)"
        >
          <span class="chevron" />
          <i class="ti ti-box" aria-hidden="true" />
          <span class="name">{{ t(row.name.key, { n: row.name.n }) }}</span>
          <button
            type="button"
            class="eye"
            :title="row.visible ? t('browser.hide') : t('browser.show')"
            @click.stop="toggleVisible(row)"
          >
            <i class="ti" :class="row.visible ? 'ti-eye' : 'ti-eye-off'" aria-hidden="true" />
          </button>
        </div>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.browser {
  width: 230px;
  padding-bottom: 8px;
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
  gap: 6px;
  width: 100%;
  padding: 9px 12px 6px;
  border: none;
  background: none;
  color: var(--text-secondary);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  text-align: left;
}
.node {
  display: flex;
  align-items: center;
  gap: 6px;
  height: var(--tree-row);
  margin: 0 6px;
  padding-right: 4px;
  border-radius: var(--radius-row);
  user-select: none;
}
.node i {
  font-size: 16px;
}
.level-0 {
  padding-left: 4px;
}
.level-1 {
  padding-left: 20px;
}
.level-2 {
  padding-left: 36px;
}
.node.selected {
  background: var(--accent-soft);
}
.node.hidden .name,
.node.hidden > i {
  color: var(--text-tertiary);
}
.chevron {
  width: 12px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.node .chevron {
  font-size: 12px;
}
.document-icon {
  color: var(--accent);
}
.document-name {
  font-weight: 500;
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.eye {
  display: inline-flex;
  align-items: center;
  border: none;
  background: none;
  padding: 2px;
  border-radius: var(--radius-row);
  color: var(--text-secondary);
}
.eye:hover {
  background: var(--control-hover);
}
.node.hidden .eye {
  color: var(--text-tertiary);
}
</style>

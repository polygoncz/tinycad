<script setup lang="ts">
// The Browser (spec 11, "Komponenty"; Prohlížeč): a floating panel on the left with the result
// of modelling – document › Origin, Sketches, Bodies. Click selects a body (or puts it into the
// active bodies field of the dialog), the eye toggles its visibility, a double click on the name
// renames it; both are stored in the document (Q071) and disabled without BrowserModel.canEdit
// (R14). Origin (M12): the three planes, click = select, the eye draws the plane – view state
// only (R48), so it stays enabled. Sketches (M12): click selects the feature, a double click opens
// the sketcher; sketches have no eye. M13: the three origin axes under the planes (click = into
// the active axis field of the dialog, the eye draws the axis) and, while the dialog has an active
// region field, the regions of each sketch under its row (click = add or remove). Only bindings
// and layout (rule 4): rows, the rename mode and canEdit come from BrowserModel, changes go back
// through it.
import { nextTick, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BrowserBodyRow, BrowserPlaneRow, BrowserSketchRow } from '@/interaction';
import { useObservable } from '../composables/use-observable';
import { useSession } from '../composables/use-session';

const session = useSession();
const { browser } = session;
const { t } = useI18n();

const bodies = useObservable(browser.bodies);
const planes = useObservable(browser.planes);
const axes = useObservable(browser.axes);
const sketches = useObservable(browser.sketches);
const canEdit = useObservable(browser.canEdit);
const renaming = useObservable(browser.renaming);
// No rename of documents in M10, so the name is read once.
const documentName = session.doc.meta.name;

// Collapsed sections are view state of this panel only.
const panelOpen = ref(true);
const bodiesOpen = ref(true);
// Collapsed by default like the Origin folder of Fusion: the planes are rarely needed.
const originOpen = ref(false);
const sketchesOpen = ref(true);

function additive(e: MouseEvent): boolean {
  return e.shiftKey || e.metaKey || e.ctrlKey;
}

function selectPlane(row: BrowserPlaneRow, e: MouseEvent): void {
  browser.selectPlane(row.plane, { additive: additive(e) });
}

function selectSketch(row: BrowserSketchRow, e: MouseEvent): void {
  browser.selectSketch(row.feature, { additive: additive(e) });
}

function select(row: BrowserBodyRow, e: MouseEvent): void {
  browser.select(row.body, { additive: additive(e) });
}

function displayName(row: BrowserBodyRow): string {
  return row.userName ?? t(row.name.key, { n: row.name.n });
}

// The inline field, like TimelineItem. Enter and blur both commit; the flag keeps the blur after
// Enter or Escape from repeating it.
const input = useTemplateRef<HTMLInputElement[]>('input');
let done = false;
watch(renaming, async (body) => {
  if (body === null) return;
  done = false;
  await nextTick();
  input.value?.[0]?.select();
});

function commitRename(row: BrowserBodyRow): void {
  if (done) return;
  done = true;
  // An untouched field (still the filled-in name) keeps an unnamed body on its automatic name.
  const text = input.value?.[0]?.value;
  browser.rename(row.body, text === undefined || text === displayName(row) ? null : text);
}
function cancelRename(): void {
  if (done) return;
  done = true;
  browser.cancelRename();
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
        :aria-expanded="originOpen"
        @click="originOpen = !originOpen"
      >
        <i
          class="ti chevron"
          :class="originOpen ? 'ti-chevron-down' : 'ti-chevron-right'"
          aria-hidden="true"
        />
        <i class="ti ti-folder" aria-hidden="true" />
        <span class="name">{{ t('browser.origin') }}</span>
      </div>

      <template v-if="originOpen">
        <div
          v-for="row in planes"
          :key="row.plane"
          class="node level-2"
          :class="{ selected: row.selected, hidden: !row.visible }"
          role="treeitem"
          :aria-selected="row.selected"
          @click="selectPlane(row, $event)"
        >
          <span class="chevron" />
          <i class="ti ti-square-dashed" aria-hidden="true" />
          <span class="name">{{ t(row.label) }}</span>
          <button
            type="button"
            class="eye"
            :title="row.visible ? t('browser.hide') : t('browser.show')"
            @click.stop="browser.setPlaneVisible(row.plane, !row.visible)"
          >
            <i class="ti" :class="row.visible ? 'ti-eye' : 'ti-eye-off'" aria-hidden="true" />
          </button>
        </div>
        <div
          v-for="row in axes"
          :key="row.axis"
          class="node level-2"
          :class="{ selected: row.active, hidden: !row.visible }"
          role="treeitem"
          :aria-pressed="row.active"
          @click="browser.selectAxis(row.axis)"
        >
          <span class="chevron" />
          <i class="ti ti-line-dashed" aria-hidden="true" />
          <span class="name">{{ t(row.label) }}</span>
          <button
            type="button"
            class="eye"
            :title="row.visible ? t('browser.hide') : t('browser.show')"
            @click.stop="browser.setAxisVisible(row.axis, !row.visible)"
          >
            <i class="ti" :class="row.visible ? 'ti-eye' : 'ti-eye-off'" aria-hidden="true" />
          </button>
        </div>
      </template>

      <div
        class="node level-1"
        role="treeitem"
        :aria-expanded="sketchesOpen"
        @click="sketchesOpen = !sketchesOpen"
      >
        <i
          class="ti chevron"
          :class="sketchesOpen ? 'ti-chevron-down' : 'ti-chevron-right'"
          aria-hidden="true"
        />
        <i class="ti ti-folder" aria-hidden="true" />
        <span class="name">{{ t('browser.sketches') }}</span>
      </div>

      <template v-if="sketchesOpen">
        <template v-for="row in sketches" :key="row.sketch">
          <div
            class="node level-2"
            :class="{ selected: row.selected }"
            role="treeitem"
            :aria-selected="row.selected"
            @click="selectSketch(row, $event)"
            @dblclick="browser.editSketch(row.feature)"
          >
            <span class="chevron" />
            <i class="ti ti-pencil" aria-hidden="true" />
            <span class="name">{{ row.name }}</span>
          </div>
          <div
            v-for="region in row.regions"
            :key="region.region"
            class="node level-3"
            :class="{ selected: region.selected }"
            role="treeitem"
            :aria-pressed="region.selected"
            @click="browser.selectRegion(row.feature, region.region)"
          >
            <span class="chevron" />
            <i class="ti ti-shape" aria-hidden="true" />
            <span class="name">{{ t('browser.region', { n: region.n }) }}</span>
          </div>
        </template>
      </template>

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
          <input
            v-if="renaming === row.body"
            ref="input"
            class="rename"
            :value="displayName(row)"
            :aria-label="t('browser.rename')"
            @click.stop
            @dblclick.stop
            @keydown.enter.prevent="commitRename(row)"
            @keydown.escape.prevent="cancelRename"
            @blur="commitRename(row)"
          />
          <span
            v-else
            class="name"
            :title="t('browser.rename')"
            @dblclick.stop="browser.beginRename(row.body)"
            >{{ displayName(row) }}</span
          >
          <button
            type="button"
            class="eye"
            :title="row.visible ? t('browser.hide') : t('browser.show')"
            :disabled="!canEdit"
            @click.stop="browser.setVisible(row.body, !row.visible)"
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
.level-3 {
  padding-left: 52px;
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
.eye:hover:not(:disabled) {
  background: var(--control-hover);
}
.eye:disabled {
  opacity: 0.4;
}
.rename {
  flex: 1;
  min-width: 0;
  padding: 1px 4px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-row);
  background: var(--panel-bg);
  color: var(--text-primary);
  font: inherit;
}
.node.hidden .eye {
  color: var(--text-tertiary);
}
</style>

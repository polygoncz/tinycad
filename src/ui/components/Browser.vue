<script setup lang="ts">
// The Browser (spec 11, "Komponenty"; Prohlížeč): a floating panel on the left with the result
// of modelling – document › Origin, Sketches, Bodies. Click selects a body (or puts it into the
// active bodies field of the dialog), the eye toggles its visibility, a double click on the name
// renames it; both are stored in the document (Q071) and disabled without BrowserModel.canEdit
// (R14). Origin (M12): the three planes, click = select, the eye draws the plane – view state
// only (R48), so it stays enabled. Sketches (M12): click selects the feature, a double click opens
// the sketcher; sketches have no eye. M13: the three origin axes under the planes (click = into
// the active axis field of the dialog, the eye draws the axis) and, while the dialog has an active
// region field, the regions of each sketch under its row (click = add or remove). M15: the colour
// field of a body (metadata like the eye, body.setColor) and, with a colour set, the button back
// to the default colour of the palette. M19.2 (D14): the ARIA pattern tree over one flat list of
// the visible rows (browserTreeRows) with aria-level, a roving tabindex and the keys of treeKey;
// Enter, the space bar and Delete (or Backspace) act on the row (rowKeyAction). Ctrl/Cmd adds to
// the selection (isAdditive), as in the Timeline. M24 (Q078): the material button of a body right
// after its colour field (BodyMaterialMenu, body.setMaterial). The colour, default colour and
// material controls of a body are shown only on the active row (hovered, focused or selected); the
// other rows show the colour as a dot after the name – CSS only, the logic is the same. Only bindings
// and layout (rule 4): rows, the rename mode and canEdit come from BrowserModel, changes go back
// through it.
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BodyId } from '@/document';
import type { BrowserBodyRow, BrowserSketchRow } from '@/interaction';
import { ACTION_IDS } from '@/interaction/constants';
import { useObservable } from '../composables/use-observable';
import { useSession } from '../composables/use-session';
import BodyMaterialMenu from './BodyMaterialMenu.vue';
import { finishEdit } from '../inline-rename';
import { isAdditive, runOnSelected } from '../item-actions';
import { browserTreeRows, navItemOf, rowKeyAction, treeKey } from '../tree-navigation';
import type {
  BrowserFolder,
  BrowserFolders,
  BrowserTreeRow,
  RowKeyAction,
} from '../tree-navigation';

const session = useSession();
const { browser, actions } = session;
// The ids of the built-in actions from the data entry point of interaction (M20, D6).
const actionIds = ACTION_IDS;
const { t } = useI18n();

const bodies = useObservable(browser.bodies);
const planes = useObservable(browser.planes);
const axes = useObservable(browser.axes);
const sketches = useObservable(browser.sketches);
const canEdit = useObservable(browser.canEdit);
const renaming = useObservable(browser.renaming);
const defaultBodyColor = useObservable(session.defaultBodyColor);
// Follows document.rename (M19.2, D5).
const documentName = useObservable(session.documentName.name);

// Collapsed sections are view state of this panel only.
const panelOpen = ref(true);
const folders = ref<BrowserFolders>({
  // Collapsed by default like the Origin folder of Fusion: the planes are rarely needed.
  origin: false,
  sketches: true,
  bodies: true,
});

const FOLDER_LABELS: Readonly<Record<BrowserFolder, string>> = {
  origin: 'browser.origin',
  sketches: 'browser.sketches',
  bodies: 'browser.bodies',
};

// The visible rows (browserTreeRows): the template and the keyboard (ARIA tree, D14) share them.
const rows = computed(() =>
  browserTreeRows({
    folders: folders.value,
    planes: planes.value,
    axes: axes.value,
    sketches: sketches.value,
    bodies: bodies.value,
  }),
);

function selected(row: BrowserTreeRow): boolean | undefined {
  switch (row.kind) {
    case 'plane':
    case 'sketch':
    case 'body':
      return row.row.selected;
    case 'axis':
      return row.row.active;
    case 'region':
      return row.region.selected;
    default:
      return undefined;
  }
}

function hidden(row: BrowserTreeRow): boolean {
  return (row.kind === 'plane' || row.kind === 'axis' || row.kind === 'body') && !row.row.visible;
}

function toggleFolder(folder: BrowserFolder): void {
  folders.value = { ...folders.value, [folder]: !folders.value[folder] };
}

/** A click on the row (and the space bar, D14). */
function activate(row: BrowserTreeRow, e: MouseEvent | KeyboardEvent): void {
  switch (row.kind) {
    case 'folder':
      toggleFolder(row.folder);
      return;
    case 'plane':
      browser.selectPlane(row.row.plane, { additive: isAdditive(e) });
      return;
    case 'axis':
      browser.selectAxis(row.row.axis);
      return;
    case 'sketch':
      browser.selectSketch(row.row.feature, { additive: isAdditive(e) });
      return;
    case 'region':
      browser.selectRegion(row.sketch.feature, row.region.region);
      return;
    case 'body':
      browser.select(row.row.body, { additive: isAdditive(e) });
      return;
    case 'document':
      return;
  }
}

function displayName(row: BrowserBodyRow): string {
  return row.userName ?? t(row.name.key, { n: row.name.n });
}

// `change`, not `input`: dragging in the picker would dispatch an operation per step. The
// value of <input type="color"> is always '#rrggbb' in lower case.
function changeColor(row: BrowserBodyRow, e: Event): void {
  if (e.target instanceof HTMLInputElement) browser.setColor(row.body, e.target.value);
}

// Keyboard (ARIA tree, D14): a roving tabindex – only the active row (the last focused one,
// otherwise the first) is in the tab order – and the keys of treeKey over the visible rows.
const treeEl = useTemplateRef<HTMLElement>('tree');
const activeKey = ref<string | null>(null);
const activeIndex = computed(() => {
  const i = rows.value.findIndex((row) => row.key === activeKey.value);
  return i === -1 ? 0 : i;
});

async function focusRow(index: number): Promise<void> {
  const row = rows.value[index];
  if (row === undefined) return;
  activeKey.value = row.key;
  await nextTick();
  treeEl.value?.querySelectorAll<HTMLElement>('[role="treeitem"]')[index]?.focus();
}

/** Delete on a sketch (D14): as in the Timeline, the feature becomes the selection first. */
function deleteSketch(row: BrowserSketchRow): void {
  runOnSelected(
    () => {
      browser.selectSketch(row.feature);
    },
    actions,
    actionIds.featureDelete,
  );
}

/** A double click on a sketch opens the sketcher. */
function openSketch(row: BrowserTreeRow): void {
  if (row.kind === 'sketch') browser.editSketch(row.row.feature);
}

function onKeydown(index: number, e: KeyboardEvent): void {
  // Keys of the inline field and of the buttons in the row are theirs.
  if (e.target !== e.currentTarget) return;
  const row = rows.value[index];
  if (row === undefined) return;
  const action = rowKeyAction(row.kind, e.key);
  if (action !== null) {
    e.preventDefault();
    runRowAction(row, action, e);
    return;
  }
  const result = treeKey(rows.value.map(navItemOf), index, e.key);
  if (result === null) return;
  e.preventDefault();
  if ('focus' in result) {
    void focusRow(result.focus);
    return;
  }
  const target = rows.value[result.toggle];
  if (target?.kind === 'folder') toggleFolder(target.folder);
}

/** The action of a key on the row (rowKeyAction, D14). */
function runRowAction(row: BrowserTreeRow, action: RowKeyAction, e: KeyboardEvent): void {
  if (action === 'activate') activate(row, e);
  else if (action === 'editSketch' && row.kind === 'sketch') browser.editSketch(row.row.feature);
  else if (action === 'rename' && row.kind === 'body') browser.beginRename(row.row.body);
  else if (action === 'delete' && row.kind === 'sketch') deleteSketch(row.row);
}

// The inline field, like TimelineItem. Enter and blur both commit; finishEdit keeps the blur
// after Enter or Escape from repeating it.
const input = useTemplateRef<HTMLInputElement[]>('input');
const editing: { value: BodyId | null } = { value: null };
watch(renaming, async (body) => {
  editing.value = body;
  if (body === null) return;
  await nextTick();
  input.value?.[0]?.select();
});

function commitRename(row: BrowserBodyRow): void {
  if (finishEdit(editing) === null) return;
  // An untouched field (still the filled-in name) keeps an unnamed body on its automatic name.
  const text = input.value?.[0]?.value;
  browser.rename(row.body, text === undefined || text === displayName(row) ? null : text);
}
function cancelRename(): void {
  if (finishEdit(editing) === null) return;
  browser.cancelRename();
}

/** Enter or Escape in the field: the field goes away, so the focus goes back to its row. */
function endRenameByKey(index: number, end: () => void): void {
  end();
  void focusRow(index);
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

    <div v-if="panelOpen" ref="tree" class="tree" role="tree" :aria-label="t('browser.title')">
      <div
        v-for="(row, index) in rows"
        :key="row.key"
        class="node"
        :class="[`level-${row.level}`, { selected: selected(row), hidden: hidden(row) }]"
        role="treeitem"
        :aria-level="row.level + 1"
        :aria-expanded="row.expanded"
        :aria-selected="selected(row)"
        :tabindex="index === activeIndex ? 0 : -1"
        @focus="activeKey = row.key"
        @keydown="onKeydown(index, $event)"
        @click="activate(row, $event)"
        @dblclick="openSketch(row)"
      >
        <template v-if="row.kind === 'document'">
          <i class="ti ti-chevron-down chevron" aria-hidden="true" />
          <i class="ti ti-cube document-icon" aria-hidden="true" />
          <span class="name document-name">{{ documentName }}</span>
        </template>

        <template v-else-if="row.kind === 'folder'">
          <i
            class="ti chevron"
            :class="folders[row.folder] ? 'ti-chevron-down' : 'ti-chevron-right'"
            aria-hidden="true"
          />
          <i class="ti ti-folder" aria-hidden="true" />
          <span class="name">{{ t(FOLDER_LABELS[row.folder]) }}</span>
        </template>

        <template v-else-if="row.kind === 'plane'">
          <span class="chevron" />
          <i class="ti ti-square-dashed" aria-hidden="true" />
          <span class="name">{{ t(row.row.label) }}</span>
          <button
            type="button"
            class="eye"
            :title="row.row.visible ? t('browser.hide') : t('browser.show')"
            @click.stop="browser.setPlaneVisible(row.row.plane, !row.row.visible)"
          >
            <i class="ti" :class="row.row.visible ? 'ti-eye' : 'ti-eye-off'" aria-hidden="true" />
          </button>
        </template>

        <template v-else-if="row.kind === 'axis'">
          <span class="chevron" />
          <i class="ti ti-line-dashed" aria-hidden="true" />
          <span class="name">{{ t(row.row.label) }}</span>
          <button
            type="button"
            class="eye"
            :title="row.row.visible ? t('browser.hide') : t('browser.show')"
            @click.stop="browser.setAxisVisible(row.row.axis, !row.row.visible)"
          >
            <i class="ti" :class="row.row.visible ? 'ti-eye' : 'ti-eye-off'" aria-hidden="true" />
          </button>
        </template>

        <template v-else-if="row.kind === 'sketch'">
          <span class="chevron" />
          <i class="ti ti-pencil" aria-hidden="true" />
          <span class="name">{{ row.row.name }}</span>
        </template>

        <template v-else-if="row.kind === 'region'">
          <span class="chevron" />
          <i class="ti ti-shape" aria-hidden="true" />
          <span class="name">{{ t('browser.region', { n: row.region.n }) }}</span>
        </template>

        <template v-else>
          <span class="chevron" />
          <i class="ti ti-box" aria-hidden="true" />
          <input
            v-if="renaming === row.row.body"
            ref="input"
            class="rename"
            :value="displayName(row.row)"
            :aria-label="t('browser.rename')"
            @click.stop
            @dblclick.stop
            @keydown.enter.prevent="endRenameByKey(index, () => commitRename(row.row))"
            @keydown.escape.prevent="endRenameByKey(index, cancelRename)"
            @blur="commitRename(row.row)"
          />
          <span v-else class="body-label">
            <span
              class="name"
              :title="t('browser.rename')"
              @dblclick.stop="browser.beginRename(row.row.body)"
              >{{ displayName(row.row) }}</span
            >
            <span
              v-if="row.row.color !== null"
              class="dot"
              :style="{ background: row.row.color }"
              aria-hidden="true"
            />
          </span>
          <span class="controls">
            <button
              v-if="row.row.color !== null"
              type="button"
              class="eye"
              :title="t('browser.defaultColor')"
              :aria-label="t('browser.defaultColor')"
              :disabled="!canEdit"
              @click.stop="browser.setColor(row.row.body, null)"
            >
              <i class="ti ti-palette" aria-hidden="true" />
            </button>
            <input
              type="color"
              class="color"
              :value="row.row.color ?? defaultBodyColor"
              :aria-label="t('browser.color', { name: displayName(row.row) })"
              :title="t('browser.color', { name: displayName(row.row) })"
              :disabled="!canEdit"
              @click.stop
              @change="changeColor(row.row, $event)"
            />
            <BodyMaterialMenu :row="row.row" :name="displayName(row.row)" :disabled="!canEdit" />
          </span>
          <button
            type="button"
            class="eye"
            :title="row.row.visible ? t('browser.hide') : t('browser.show')"
            :disabled="!canEdit"
            @click.stop="browser.setVisible(row.row.body, !row.row.visible)"
          >
            <i class="ti" :class="row.row.visible ? 'ti-eye' : 'ti-eye-off'" aria-hidden="true" />
          </button>
        </template>
      </div>
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
  background: var(--selection-soft);
}
.node:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
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
.color {
  flex: none;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0.5px solid var(--panel-border);
  border-radius: var(--radius-row);
  background: none;
}
.color::-webkit-color-swatch-wrapper {
  padding: 0;
}
.color::-webkit-color-swatch {
  border: none;
  border-radius: var(--radius-row);
}
.color::-moz-color-swatch {
  border: none;
  border-radius: var(--radius-row);
}
.color:disabled {
  opacity: 0.4;
}
.node.hidden .eye {
  color: var(--text-tertiary);
}
/* The name and the colour dot of a body; the dot stands right after the (ellipsised) name. */
.body-label {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.body-label .name {
  flex: 0 1 auto;
}
.dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
/*
 * The controls of a body only on the active row (spec 11, "Ovládání řádku tělesa jen u aktivního
 * řádku"): otherwise the 230 px panel would cut the name to "T…". A focused row matches
 * :focus-within too, so Tab from it reaches the controls. While the material menu is open the
 * focus is in the menu (teleported out of the row), so its open button keeps the controls shown:
 * the menu stays anchored and Esc or a choice can give the focus back to the button. The dot is
 * not needed while the colour field shows the colour.
 */
.controls {
  display: none;
  flex: none;
  align-items: center;
  gap: 6px;
}
.node:hover .controls,
.node:focus-within .controls,
.node[aria-selected='true'] .controls,
.controls:has([aria-haspopup][aria-expanded='true']) {
  display: inline-flex;
}
.node:hover .dot,
.node:focus-within .dot,
.node[aria-selected='true'] .dot,
.node:has(.controls [aria-haspopup][aria-expanded='true']) .dot {
  display: none;
}
</style>

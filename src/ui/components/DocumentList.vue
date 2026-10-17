<script setup lang="ts">
// The document list (spec 11, "Komponenty"; Q019): a floating sheet with the cards of the stored
// documents, newest first. Its logic is DocumentListModel of interaction (M20, A3.5), built by
// app's createDocumentList over the store; this component only draws its state, reads a chosen
// file and opens a document by a change of the hash (#/d/<id>), App.vue does the rest. Deleting
// or renaming a document open in another tab is refused by app (its lock) and the error is shown
// here. The header has the same switches of language and theme as the TitleBar. M15: import of a
// document file (R126) – a hidden file input; a stored file opens like a new document. M19.1
// (revize U3, U11): the list that fails to load shows its error and Try again instead of an
// endless "Loading…"; the delete button stays in the tab order (hidden by opacity only); one date
// formatter for the whole list. M19.2 (D5): Rename next to Delete turns the name of the card into
// a text field; Enter or leaving it renames, Esc cancels; the list loads again. M46 (N68, N71):
// the documents are on the core; while the browser still has documents in IndexedDB, a button
// above the list moves them there (app's openBrowserMigration; IndexedDB stays).
import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { createDocumentList, openBrowserMigration } from '@/app';
import type { MigrationReport, OpenAppSessionOptions } from '@/app';
import type { DocumentId } from '@/document';
import type { DocumentCatalogEntry } from '@/interaction';
import { useObservable } from '../composables/use-observable';
import { updatedFormatter } from '../document-list';
import { docHash } from '../route';
import ThemeLocaleToggles from './ThemeLocaleToggles.vue';

// The plugins of the sessions: the logs stored in the browser are replayed with them (N71).
const props = defineProps<{ plugins: OpenAppSessionOptions['plugins'] }>();

const { t, locale } = useI18n();

// M20 (A3.5): loading, busy, the error, the confirmation of a delete and the rename are the
// model's; the component draws them, reads the chosen file and opens the returned ids.
const model = createDocumentList({
  translate: (key) => t(key),
  // The browser's own dialog (R16), like deleting a feature with dependents.
  confirm: ({ key, params }) => globalThis.confirm(t(key, params)),
});
const list = useObservable(model.list);
const busy = useObservable(model.busy);
const actionError = useObservable(model.error);
const renaming = useObservable(model.renaming);
const updatedText = computed(() => updatedFormatter(locale.value));
// The error of an action (create, delete, rename, import); a failed load is a state of the list.
const error = computed(() => {
  const current = actionError.value;
  return current === null ? null : t(current.key, current.params);
});
const fileInput = useTemplateRef<HTMLInputElement>('fileInput');
// The text of the name field of the card being renamed.
const nameText = ref('');
// A ref inside v-for is an array; only the edited card has the field.
const nameInputs = useTemplateRef<HTMLInputElement[]>('nameInput');

// N71: the documents of IndexedDB; 0 hides the button.
const migration = openBrowserMigration({ plugins: props.plugins });
const browserCount = ref(0);
// The progress of a running move, null otherwise.
const migrating = ref<{ readonly done: number; readonly total: number } | null>(null);
const migrationReport = ref<MigrationReport | null>(null);

async function migrate(): Promise<void> {
  if (migrating.value !== null || busy.value) return;
  migrationReport.value = null;
  migrating.value = { done: 0, total: browserCount.value };
  try {
    const report = await migration.run((done, total) => {
      migrating.value = { done, total };
    });
    migrationReport.value = report;
    // Everything moved: the button goes; a repeat would create no duplicates anyway.
    if (report.failures.length === 0) browserCount.value = 0;
  } catch (e) {
    migrationReport.value = {
      migrated: 0,
      failures: [{ name: '', error: e instanceof Error ? e.message : String(e) }],
    };
  } finally {
    migrating.value = null;
  }
  await model.load();
}

function retry(): void {
  void model.retry();
}

function open(id: DocumentId | null): void {
  if (id !== null) globalThis.location.hash = docHash(id);
}

async function create(): Promise<void> {
  open(await model.create());
}

async function remove(info: DocumentCatalogEntry): Promise<void> {
  await model.remove(info);
}

async function startRename(info: DocumentCatalogEntry): Promise<void> {
  nameText.value = info.meta.name;
  if (!model.beginRename(info.meta.id)) return;
  await nextTick();
  nameInputs.value?.[0]?.select();
}

/** Enter or leaving the field; the model ends the edit, so a blur after Enter does nothing. */
async function commitRename(info: DocumentCatalogEntry): Promise<void> {
  await model.commitRename(info, nameText.value);
}

function cancelRename(): void {
  model.cancelRename();
}

function chooseFile(): void {
  if (busy.value) return;
  fileInput.value?.click();
}

async function importChosen(e: Event): Promise<void> {
  const input = e.target instanceof HTMLInputElement ? e.target : null;
  const file = input?.files?.[0];
  // Choosing the same file again fires change once more.
  if (input !== null) input.value = '';
  if (file === undefined) return;
  open(await model.importFile(() => file.text()));
}

onMounted(() => {
  void model.load();
  void migration.count().then((count) => {
    browserCount.value = count;
  });
});
</script>

<template>
  <section class="document-list" :aria-label="t('documents.title')">
    <header class="header">
      <h1 class="title">{{ t('documents.title') }}</h1>
      <ThemeLocaleToggles />
      <button type="button" class="import" :disabled="busy" @click="chooseFile">
        <i class="ti ti-file-import" aria-hidden="true" /> {{ t('documents.import') }}
      </button>
      <input
        ref="fileInput"
        type="file"
        accept=".json,application/json"
        class="file-input"
        tabindex="-1"
        aria-hidden="true"
        @change="importChosen"
      />
      <button type="button" class="new" :disabled="busy" @click="create">
        <i class="ti ti-plus" aria-hidden="true" /> {{ t('documents.new') }}
      </button>
    </header>

    <div v-if="browserCount > 0 || migrationReport !== null" class="migration">
      <button
        v-if="browserCount > 0"
        type="button"
        class="migrate"
        :disabled="busy || migrating !== null"
        @click="migrate"
      >
        <i class="ti ti-cloud-upload" aria-hidden="true" />
        {{ t('documents.migrate', { count: browserCount }) }}
      </button>
      <p v-if="migrating !== null" class="migration-status" role="status">
        {{ t('documents.migrating', { done: migrating.done, total: migrating.total }) }}
      </p>
      <p v-else-if="migrationReport !== null" class="migration-status" role="status">
        {{ t('documents.migrated', { count: migrationReport.migrated }) }}
      </p>
      <p
        v-if="migrationReport !== null && migrationReport.failures.length > 0"
        class="error"
        role="alert"
        :title="migrationReport.failures.map((f) => `${f.name}: ${f.error}`).join('\n')"
      >
        {{ t('documents.migrateFailed', { count: migrationReport.failures.length }) }}
      </p>
    </div>

    <p v-if="error !== null" class="error" role="alert" :title="actionError?.detail ?? undefined">
      {{ error }}
    </p>

    <p v-if="list.kind === 'loading'" class="empty">{{ t('documents.loading') }}</p>
    <div v-else-if="list.kind === 'failed'" class="load-failed" role="alert">
      <p class="error">{{ t('documents.error.list', { error: list.error }) }}</p>
      <button type="button" class="retry" @click="retry">{{ t('documents.retry') }}</button>
    </div>
    <p v-else-if="list.documents.length === 0" class="empty">{{ t('documents.empty') }}</p>
    <div v-else class="cards">
      <article v-for="info in list.documents" :key="info.meta.id" class="card">
        <div v-if="renaming === info.meta.id" class="open">
          <span class="preview"><i class="ti ti-box" aria-hidden="true" /></span>
          <span class="meta">
            <input
              ref="nameInput"
              v-model="nameText"
              type="text"
              class="name-input"
              :aria-label="t('documents.name')"
              @keydown.enter.prevent="commitRename(info)"
              @keydown.esc.prevent="cancelRename"
              @blur="commitRename(info)"
            />
            <span class="date">{{ updatedText(info.updatedAt) }}</span>
          </span>
        </div>
        <button v-else type="button" class="open" @click="open(info.meta.id)">
          <span class="preview"><i class="ti ti-box" aria-hidden="true" /></span>
          <span class="meta">
            <span class="name">{{ info.meta.name }}</span>
            <span class="date">{{ updatedText(info.updatedAt) }}</span>
          </span>
        </button>
        <div class="card-actions">
          <!-- Delete first: Tab from the card reaches it as before M19.2. -->
          <button
            type="button"
            class="card-action delete"
            :title="t('documents.delete')"
            :aria-label="t('documents.delete')"
            :disabled="busy"
            @click="remove(info)"
          >
            <i class="ti ti-trash" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="card-action"
            :title="t('documents.rename')"
            :aria-label="t('documents.rename')"
            :disabled="busy"
            @click="startRename(info)"
          >
            <i class="ti ti-pencil" aria-hidden="true" />
          </button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.document-list {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(560px, calc(100% - 32px));
  max-height: calc(100% - 32px);
  overflow: auto;
  padding: 18px 16px 16px;
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
  gap: 10px;
  margin-bottom: 14px;
}
.title {
  flex: 1;
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}
.new {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: var(--field-height);
  padding: 0 14px;
  border: none;
  border-radius: var(--radius-control);
  background: var(--accent);
  color: var(--on-accent);
  font: inherit;
  font-weight: 500;
}
.new:disabled,
.import:disabled {
  opacity: 0.6;
}
.import {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: var(--field-height);
  padding: 0 12px;
  border: none;
  border-radius: var(--radius-control);
  background: var(--control-hover);
  color: var(--text-primary);
  font: inherit;
  font-weight: 500;
}
.file-input {
  display: none;
}
.migration {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 12px;
}
.migrate {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: var(--field-height);
  padding: 0 12px;
  border: none;
  border-radius: var(--radius-control);
  background: var(--control-hover);
  color: var(--text-primary);
  font: inherit;
  font-weight: 500;
}
.migrate:disabled {
  opacity: 0.6;
}
.migration-status {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}
.error {
  margin: 0 0 12px;
  color: var(--danger);
  font-size: var(--font-size-small);
}
.empty {
  margin: 24px 0;
  text-align: center;
  color: var(--text-secondary);
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}
.card {
  position: relative;
  border-radius: var(--radius-panel);
  border: 0.5px solid var(--panel-border);
  background: var(--field-bg);
  overflow: hidden;
}
.card:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.open {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
}
.preview {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88px;
  background: var(--control-hover);
  color: var(--text-tertiary);
  font-size: 36px;
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px 10px;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.date {
  color: var(--text-secondary);
  font-size: var(--font-size-small);
}
.name-input {
  min-width: 0;
  height: 22px;
  margin: -2px -4px;
  padding: 0 4px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-row);
  background: var(--field-bg);
  color: inherit;
  font: inherit;
  font-weight: 500;
}
.card-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 4px;
}
/* Hidden by opacity, not display: none, so they stay in the tab order and on touch screens. */
.card-action {
  display: inline-flex;
  opacity: 0;
  padding: 3px;
  border: none;
  border-radius: var(--radius-row);
  background: var(--panel-bg);
  color: var(--text-secondary);
  font-size: 16px;
}
.card-action.delete {
  color: var(--danger);
}
.card:hover .card-action,
.card:focus-within .card-action,
.card-action:focus-visible {
  opacity: 1;
}
/* Without hover (touch) the buttons are always there. */
@media (hover: none) {
  .card-action {
    opacity: 1;
  }
}
.load-failed {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin: 24px 0;
  text-align: center;
}
.load-failed .error {
  margin: 0;
}
.retry {
  height: var(--field-height);
  padding: 0 14px;
  border: none;
  border-radius: var(--radius-control);
  background: var(--control-hover);
  color: var(--text-primary);
  font: inherit;
  font-weight: 500;
}
</style>

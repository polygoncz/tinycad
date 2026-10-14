<script setup lang="ts">
// The document list (spec 11, "Komponenty"; Q019): a floating sheet with the cards of the stored
// documents, newest first. New, open and delete go through app; opening is only a change of the
// hash (#/d/<id>), App.vue does the rest. Deleting a document open in another tab is refused by
// app (its lock) and the error is shown here. The header has the same switches of language and
// theme as the TitleBar. M15: import of a document file (R126) – a hidden file input, the text
// goes through importDocumentText; a stored file opens like a new document. M19.1 (revize U3,
// U11): the list that fails to load shows its error and Try again instead of an endless
// "Loading…" (loadDocumentList); the delete button stays in the tab order (hidden by opacity
// only); one date formatter for the whole list.
import { computed, onMounted, ref, shallowRef, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { createNewDocument, deleteDocument, importDocumentFile, listDocuments } from '@/app';
import type { DocumentInfo, OpenAppSessionOptions } from '@/app';
import type { DocumentId } from '@/document';
import { importDocumentText } from '../document-import';
import type { ImportOutcome } from '../document-import';
import { loadDocumentList, updatedFormatter } from '../document-list';
import type { DocumentListState } from '../document-list';
import { docHash } from '../route';
import ThemeLocaleToggles from './ThemeLocaleToggles.vue';

// The plugins of the sessions: the file is checked against their registries.
const props = defineProps<{ plugins: OpenAppSessionOptions['plugins'] }>();

const { t, locale } = useI18n();

// A frozen state with the frozen list from app, never deep-reactive.
const list = shallowRef<DocumentListState>({ kind: 'loading' });
const updatedText = computed(() => updatedFormatter(locale.value));
// The error of an action (create, delete, import); a failed load is a state of the list.
const error = ref<string | null>(null);
// The technical detail of a failed import (its first issue), in the tooltip of the error.
const errorDetail = ref<string | null>(null);
const busy = ref(false);
const fileInput = useTemplateRef<HTMLInputElement>('fileInput');

/** Loads the list again; the cards stay until the new list is there (after a delete). */
async function load(): Promise<void> {
  list.value = await loadDocumentList(listDocuments);
}

/** Try again after a failed load: "Loading…" until it settles. */
function retry(): void {
  list.value = { kind: 'loading' };
  void load();
}

function open(id: DocumentId): void {
  globalThis.location.hash = docHash(id);
}

async function create(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  clearError();
  try {
    open(await createNewDocument({ translate: (key) => t(key) }));
  } catch (e) {
    error.value = t('documents.error.create', { error: errorText(e) });
  } finally {
    busy.value = false;
  }
}

async function remove(info: DocumentInfo): Promise<void> {
  if (busy.value) return;
  if (!globalThis.confirm(t('documents.confirmDelete', { name: info.meta.name }))) return;
  busy.value = true;
  clearError();
  try {
    await deleteDocument(info.meta.id);
    await load();
  } catch (e) {
    error.value = t('documents.error.delete', { error: errorText(e) });
  } finally {
    busy.value = false;
  }
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
  if (file === undefined || busy.value) return;
  busy.value = true;
  clearError();
  // importDocumentText never rejects; only reading the file can.
  const outcome = await file.text().then(
    (text) =>
      importDocumentText(text, (raw) => importDocumentFile(raw, { plugins: props.plugins })),
    (e: unknown): ImportOutcome => ({ ok: false, detail: errorText(e) }),
  );
  busy.value = false;
  if (outcome.ok) {
    open(outcome.id);
  } else {
    error.value = t('documents.importError');
    errorDetail.value = outcome.detail;
  }
}

function clearError(): void {
  error.value = null;
  errorDetail.value = null;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

onMounted(() => {
  void load();
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

    <p v-if="error !== null" class="error" role="alert" :title="errorDetail ?? undefined">
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
        <button type="button" class="open" @click="open(info.meta.id)">
          <span class="preview"><i class="ti ti-box" aria-hidden="true" /></span>
          <span class="meta">
            <span class="name">{{ info.meta.name }}</span>
            <span class="date">{{ updatedText(info.updatedAt) }}</span>
          </span>
        </button>
        <button
          type="button"
          class="delete"
          :title="t('documents.delete')"
          :aria-label="t('documents.delete')"
          :disabled="busy"
          @click="remove(info)"
        >
          <i class="ti ti-trash" aria-hidden="true" />
        </button>
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
/* Hidden by opacity, not display: none, so it stays in the tab order and on touch screens. */
.delete {
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  opacity: 0;
  padding: 3px;
  border: none;
  border-radius: var(--radius-row);
  background: var(--panel-bg);
  color: var(--danger);
  font-size: 16px;
}
.card:hover .delete,
.card:focus-within .delete,
.delete:focus-visible {
  opacity: 1;
}
/* Without hover (touch) the button is always there. */
@media (hover: none) {
  .delete {
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

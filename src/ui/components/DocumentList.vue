<script setup lang="ts">
// The document list (spec 11, "Komponenty"; Q019): a floating sheet with the cards of the stored
// documents, newest first. New, open and delete go through app; opening is only a change of the
// hash (#/d/<id>), App.vue does the rest. Deleting a document open in another tab is refused by
// app (its lock) and the error is shown here. The header has the same switches of language and
// theme as the TitleBar.
import { onMounted, ref, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { createNewDocument, deleteDocument, listDocuments } from '@/app';
import type { DocumentInfo } from '@/app';
import type { DocumentId } from '@/document';
import { docHash } from '../route';
import ThemeLocaleToggles from './ThemeLocaleToggles.vue';

const { t, locale } = useI18n();

// null while loading; a frozen list from app, never deep-reactive.
const documents = shallowRef<readonly DocumentInfo[] | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);

async function load(): Promise<void> {
  try {
    documents.value = await listDocuments();
  } catch (e) {
    error.value = t('documents.error.list', { error: errorText(e) });
  }
}

function open(id: DocumentId): void {
  globalThis.location.hash = docHash(id);
}

async function create(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
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
  error.value = null;
  try {
    await deleteDocument(info.meta.id);
    await load();
  } catch (e) {
    error.value = t('documents.error.delete', { error: errorText(e) });
  } finally {
    busy.value = false;
  }
}

function updatedText(info: DocumentInfo): string {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(
    info.updatedAt,
  );
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
      <button type="button" class="new" :disabled="busy" @click="create">
        <i class="ti ti-plus" aria-hidden="true" /> {{ t('documents.new') }}
      </button>
    </header>

    <p v-if="error !== null" class="error" role="alert">{{ error }}</p>

    <p v-if="documents === null" class="empty">{{ t('documents.loading') }}</p>
    <p v-else-if="documents.length === 0" class="empty">{{ t('documents.empty') }}</p>
    <div v-else class="cards">
      <article v-for="info in documents" :key="info.meta.id" class="card">
        <button type="button" class="open" @click="open(info.meta.id)">
          <span class="preview"><i class="ti ti-box" aria-hidden="true" /></span>
          <span class="meta">
            <span class="name">{{ info.meta.name }}</span>
            <span class="date">{{ updatedText(info) }}</span>
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
.new:disabled {
  opacity: 0.6;
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
.delete {
  position: absolute;
  top: 6px;
  right: 6px;
  display: none;
  padding: 3px;
  border: none;
  border-radius: var(--radius-row);
  background: var(--panel-bg);
  color: var(--danger);
  font-size: 16px;
}
.card:hover .delete,
.delete:focus-visible {
  display: inline-flex;
}
</style>

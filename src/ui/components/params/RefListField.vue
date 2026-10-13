<script setup lang="ts">
// ParamSpec kinds 'bodies' and 'topo': the selected references and whether the field is the
// active one that takes the selection from the view or the Browser (FieldState.active). The
// references are set by the selection, not typed here, so the button reports only that the field
// wants to become active (the dialog calls focusRefParam). A 'bodies' field lists the chosen
// bodies as chips; the name comes from the document (browser.refLabel), not from the Browser
// rows, because a preview may drop a tool body from the result that the chip still has to name.
// Each chip removes its item with ×. A 'topo' field shows the count only.
import { computed, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FieldState } from '@/interaction';
import { useSession } from '../../composables/use-session';
import { bodyRefItems, withoutIndex } from './field-values';
import FieldShell from './FieldShell.vue';

const props = defineProps<{ field: FieldState }>();
const emit = defineEmits<{ update: [value: unknown]; activate: [] }>();

const { t } = useI18n();
const { browser } = useSession();
// The name is the label followed by the own text: "Tělesa 2 vybráno".
const buttonId = useId();
const count = computed(() => (Array.isArray(props.field.value) ? props.field.value.length : 0));
const chips = computed(() =>
  props.field.spec.kind === 'bodies'
    ? bodyRefItems(props.field.value).map(({ index, body }) => {
        const label = browser.refLabel(body);
        return { index, key: `${String(index)}:${body}`, label, missing: label === null };
      })
    : [],
);

function remove(index: number): void {
  emit('update', withoutIndex(props.field.value, index));
}
</script>

<template>
  <FieldShell v-slot="{ labelId, issueId }" :label="field.spec.label" :issue="field.issue">
    <div class="refs">
      <button
        :id="buttonId"
        type="button"
        :aria-labelledby="`${labelId} ${buttonId}`"
        :aria-describedby="issueId"
        :aria-pressed="field.active"
        class="ref-list"
        :class="{ active: field.active, invalid: field.issue !== null }"
        @click="emit('activate')"
      >
        {{ field.active ? t('field.refs.pick') : t('field.refs.count', { n: count }) }}
      </button>
      <ul v-if="chips.length > 0" class="chips">
        <li v-for="chip in chips" :key="chip.key" class="chip" :class="{ missing: chip.missing }">
          <span class="chip-name">{{ chip.label ?? t('field.refs.missing') }}</span>
          <button
            type="button"
            class="chip-remove"
            :aria-label="t('field.refs.remove', { name: chip.label ?? t('field.refs.missing') })"
            @click="remove(chip.index)"
          >
            <i class="ti ti-x" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </div>
  </FieldShell>
</template>

<style scoped>
.refs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.ref-list {
  height: var(--field-height);
  padding: 0 8px;
  text-align: left;
  border-radius: var(--radius-control);
  background: var(--field-bg);
  border: 0.5px solid var(--field-border);
  color: var(--text-primary);
  font: inherit;
}
.ref-list.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
  color: var(--accent);
}
.ref-list.invalid {
  border-color: var(--danger);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 100%;
  padding: 1px 2px 1px 8px;
  border-radius: var(--radius-row);
  background: var(--accent-soft);
  color: var(--text-primary);
}
.chip.missing {
  background: none;
  border: 0.5px solid var(--danger);
  color: var(--danger);
}
.chip-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip-remove {
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border: none;
  border-radius: var(--radius-row);
  background: none;
  color: inherit;
  font-size: 12px;
}
.chip-remove:hover {
  background: var(--control-hover);
}
</style>

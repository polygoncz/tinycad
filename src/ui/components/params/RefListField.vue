<script setup lang="ts">
// ParamSpec kinds 'bodies', 'topo' and 'planes': the selected references and whether the field is the
// active one that takes the selection from the view or the Browser (FieldState.active). The
// references are set by the selection, not typed here, so the button reports only that the field
// wants to become active (the dialog calls focusRefParam). A 'bodies' field lists the chosen
// bodies as chips from FieldState.refs (names from the document, interaction); each chip reports
// the removal of its item with × (the dialog calls removeRef). 'topo' and 'planes' show the count only.
import { computed, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FieldState } from '@/interaction';
import FieldShell from './FieldShell.vue';

const props = defineProps<{ field: FieldState }>();
const emit = defineEmits<{ update: [value: unknown]; activate: []; remove: [index: number] }>();

const { t } = useI18n();
// The name is the label followed by the own text: "Tělesa 2 vybráno".
const buttonId = useId();
const count = computed(() => (Array.isArray(props.field.value) ? props.field.value.length : 0));
const chips = computed(() => props.field.refs ?? []);
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
        <li
          v-for="chip in chips"
          :key="`${String(chip.index)}:${chip.body ?? ''}`"
          class="chip"
          :class="{ missing: chip.label === null }"
        >
          <span class="chip-name">{{ chip.label ?? t('field.refs.missing') }}</span>
          <button
            type="button"
            class="chip-remove"
            :aria-label="t('field.refs.remove', { name: chip.label ?? t('field.refs.missing') })"
            @click="emit('remove', chip.index)"
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

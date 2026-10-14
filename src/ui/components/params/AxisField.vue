<script setup lang="ts">
// ParamSpec kind 'axis' (M13): one reference – an origin axis or a line of a sketch. Like
// RefListField the button only reports that the field wants to become active (the dialog calls
// focusRefParam); the axis itself comes from the Browser or the view. The text of the reference is
// FieldState.refText from interaction ("Osa X", "Úsečka ze skici Skica 1", "Chybí položka", also
// for a value of an invalid shape), without a value "Nevybráno"; × reports the empty value.
import { computed, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FieldState } from '@/interaction';
import FieldShell from './FieldShell.vue';

const props = defineProps<{ field: FieldState }>();
const emit = defineEmits<{ update: [value: unknown]; activate: [] }>();

const { t } = useI18n();
// The name is the label followed by the own text: "Osa Osa X".
const buttonId = useId();
const text = computed(() => {
  const ref = props.field.refText;
  return ref === null ? t('field.noRef') : t(ref.key, ref.params);
});
// interaction gives any value a text, an invalid one included (field.missingRef), so it can be removed.
const hasValue = computed(() => props.field.refText !== null);
</script>

<template>
  <FieldShell v-slot="{ labelId, issueId }" :label="field.spec.label" :issue="field.issue">
    <div class="axis">
      <button
        :id="buttonId"
        type="button"
        :aria-labelledby="`${labelId} ${buttonId}`"
        :aria-describedby="issueId"
        :aria-pressed="field.active"
        class="axis-ref"
        :class="{ active: field.active, invalid: field.issue !== null, empty: !hasValue }"
        @click="emit('activate')"
      >
        {{ text }}
      </button>
      <button
        v-if="hasValue"
        type="button"
        class="axis-remove"
        :aria-label="t('field.refs.remove', { name: text })"
        @click="emit('update', null)"
      >
        <i class="ti ti-x" aria-hidden="true" />
      </button>
    </div>
  </FieldShell>
</template>

<style scoped>
.axis {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.axis-ref {
  flex: 1;
  min-width: 0;
  height: var(--field-height);
  padding: 0 8px;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: var(--radius-control);
  background: var(--field-bg);
  border: 0.5px solid var(--field-border);
  color: var(--text-primary);
  font: inherit;
}
.axis-ref.empty {
  color: var(--text-tertiary);
}
.axis-ref.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
  color: var(--accent);
}
.axis-ref.invalid {
  border-color: var(--danger);
}
.axis-remove {
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border: none;
  border-radius: var(--radius-row);
  background: none;
  color: var(--text-secondary);
  font-size: 12px;
}
.axis-remove:hover {
  background: var(--control-hover);
}
</style>

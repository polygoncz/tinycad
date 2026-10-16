<script setup lang="ts">
// The dimensions of a selected pattern over the view (spec 12, "Zrcadlení a pole (M36)",
// "Vynesené kóty pole"), drawn like SketchDimensions: the guides in an SVG over the whole view
// area, the labels as buttons. What is drawn is SketchState.patternDimensions of sketcher; where
// it stands is the pure patternDimensionLayout of ../sketch-pattern-dimensions over the
// projections of session.view.project, recomputed when they change and on every onViewChanged.
// A pattern dimension is no constraint: it is neither selected nor dragged, so a click on its
// label opens the text field with the value at once. Enter or leaving the field writes a valid
// changed value through setPatternParam (commitPatternEdit), like the field of a dimension;
// Esc closes it without writing; an invalid value closes it without writing too.
import { nextTick, onMounted, onScopeDispose, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Vec3 } from '@/core';
import type { SketchPatternDimensionView, SketchSession } from '@/sketcher';
import { useObservable } from '../composables/use-observable';
import { useSession } from '../composables/use-session';
import { finishEdit } from '../inline-rename';
import type { ScreenPoint } from '../manipulator-hud';
import { withLabelGap } from '../sketch-dimensions';
import type { DimensionLayout } from '../sketch-dimensions';
import {
  commitPatternEdit,
  patternDimensionLabel,
  patternDimensionLayout,
  patternFieldText,
} from '../sketch-pattern-dimensions';

const props = defineProps<{ sketch: SketchSession }>();

const session = useSession();
const { t } = useI18n();
const state = useObservable(props.sketch.state);

interface Placed {
  readonly key: string;
  readonly dim: SketchPatternDimensionView;
  readonly layout: DimensionLayout;
}

/** A label of a pattern is one per parameter. */
function keyOf(dim: SketchPatternDimensionView): string {
  return `${dim.pattern}/${dim.param}`;
}

function layout(): readonly Placed[] {
  const project = (world: Vec3): ScreenPoint | null => session.view.project(world);
  const next: Placed[] = [];
  for (const dim of state.value.patternDimensions) {
    const placed = patternDimensionLayout(dim, project);
    // The guide leaves the label free, like the lines of a dimension (M28).
    if (placed !== null) {
      next.push({
        key: keyOf(dim),
        dim,
        layout: withLabelGap(placed, patternDimensionLabel(dim)),
      });
    }
  }
  return next;
}

/** The pattern dimensions that project onto the view, with their layout. */
const placed = shallowRef(layout());

function place(): void {
  placed.value = layout();
}

watch(() => state.value.patternDimensions, place);
const offViewChanged = session.view.onViewChanged(place);
onScopeDispose(offViewChanged);
onMounted(place);

/** The label whose field is open (keyOf), null = none. */
const editing = ref<string | null>(null);
const text = ref('');
const input = useTemplateRef<HTMLInputElement[]>('input');

async function edit(dim: SketchPatternDimensionView): Promise<void> {
  editing.value = keyOf(dim);
  text.value = patternFieldText(dim);
  await nextTick();
  const el = input.value?.[0];
  el?.focus();
  el?.select();
}

/** Enter or blur: a valid changed value goes to setPatternParam; the field closes. */
function commit(dim: SketchPatternDimensionView): void {
  // Enter removes the field and its blur finds the edit done.
  if (finishEdit(editing) === null) return;
  commitPatternEdit(props.sketch, dim, text.value);
}

function cancel(): void {
  finishEdit(editing);
}

function name(dim: SketchPatternDimensionView): string {
  return t(`sketch.patternParam.${dim.format}`);
}
</script>

<template>
  <div class="sketch-pattern-dimensions">
    <svg class="lines" aria-hidden="true">
      <g v-for="{ key, layout: l } in placed" :key="key">
        <line v-for="([a, b], i) in l.lines" :key="i" :x1="a[0]" :y1="a[1]" :x2="b[0]" :y2="b[1]" />
      </g>
    </svg>
    <template v-for="{ key, dim, layout: l } in placed" :key="key">
      <input
        v-if="editing === key"
        ref="input"
        v-model="text"
        class="field"
        type="text"
        :inputmode="dim.format === 'count' ? 'numeric' : 'decimal'"
        :aria-label="name(dim)"
        :style="{ left: `${String(l.labelAt[0])}px`, top: `${String(l.labelAt[1])}px` }"
        @keydown.enter="commit(dim)"
        @keydown.esc="cancel"
        @blur="commit(dim)"
      />
      <button
        v-else
        type="button"
        class="label"
        :aria-label="`${name(dim)} ${patternDimensionLabel(dim)}`"
        :style="{ left: `${String(l.labelAt[0])}px`, top: `${String(l.labelAt[1])}px` }"
        @click="edit(dim)"
      >
        {{ patternDimensionLabel(dim) }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.sketch-pattern-dimensions {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
.lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
line {
  stroke: var(--text-secondary);
  stroke-width: 1;
}
.label,
.field {
  position: absolute;
  transform: translate(-50%, -50%);
  font-family: var(--font-ui);
  font-size: var(--font-size-small);
  pointer-events: auto;
}
.label {
  padding: 1px 4px;
  border: none;
  border-radius: var(--radius-row);
  background: none;
  color: var(--text-secondary);
  white-space: nowrap;
}
.label:hover {
  background: var(--control-hover);
}
.field {
  width: 64px;
  height: var(--field-height);
  padding: 0 6px;
  border-radius: var(--radius-control);
  background: var(--field-bg);
  border: 0.5px solid var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
  outline: none;
  color: var(--text-primary);
  text-align: right;
}
</style>

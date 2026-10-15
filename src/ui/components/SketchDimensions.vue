<script setup lang="ts">
// The dimensions of the open sketch over the view (spec 11, "Režim skici"; M19.2 D4): the
// extension and dimension lines with arrows in an SVG over the whole view area, the labels as
// buttons. What is drawn is SketchState.dimensions of interaction; where it stands is the pure
// dimensionLayout of ../sketch-dimensions over the projections of session.view.project. The
// positions are recomputed when the state changes and on every onViewChanged, like the HUD of the
// manipulator.
// The SVG ignores the pointer, only the labels take it, so the view under the lines still orbits
// and picks. Click on a label selects the dimension like its row in the panel; a double click
// opens a text field with the value in place: Enter or leaving the field writes a valid changed
// number through setDimension (the same way as the panel), Esc closes it without writing. The
// field is a text input, so the global keyboard leaves its keys alone (inTextField).
// M28: the lines come from the geometry of each dimension (its placement), an angle is in degrees
// in the label and the field. A label is dragged (spec 12, "Přetažení"): a press and a move past
// CLICK_TOLERANCE_PX make every move SketchSession.moveDimension in px of the view area (this
// element covers the view area like the canvas, so its box is the origin of `project` too), the
// release endMoveDimension, and the click that follows does not select (../dimension-drag). The
// preview of the dimension tool (preview: true) is only drawn: dashed, its label takes no pointer.
import { nextTick, onMounted, onScopeDispose, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Vec3 } from '@/core';
import type { SketchDimensionView, SketchSession } from '@/sketcher';
import { useObservable } from '../composables/use-observable';
import { useSession } from '../composables/use-session';
import type { ScreenPoint } from '../manipulator-hud';
import { finishEdit } from '../inline-rename';
import { isAdditive } from '../item-actions';
import { createDimensionDrag } from '../dimension-drag';
import {
  dimensionFieldText,
  dimensionLabel,
  dimensionLayout,
  editedDimensionValue,
  withLabelGap,
} from '../sketch-dimensions';
import type { DimensionLayout, ScreenTriangle } from '../sketch-dimensions';
import { constraintRowLabel } from '../sketch-panel';

const props = defineProps<{ sketch: SketchSession }>();

const session = useSession();
const { t } = useI18n();
const state = useObservable(props.sketch.state);

interface Placed {
  readonly dim: SketchDimensionView;
  readonly layout: DimensionLayout;
}

/** The dimensions that project onto the view, with their layout. */
const placed = shallowRef<readonly Placed[]>([]);

function place(): void {
  const project = (world: Vec3): ScreenPoint | null => session.view.project(world);
  const next: Placed[] = [];
  for (const dim of state.value.dimensions) {
    const layout = dimensionLayout(dim, project);
    // The lines leave the label free, so they do not cross its text (M28).
    if (layout !== null) next.push({ dim, layout: withLabelGap(layout, dimensionLabel(dim)) });
  }
  placed.value = next;
}

watch(() => state.value.dimensions, place);
const offViewChanged = session.view.onViewChanged(place);
onScopeDispose(offViewChanged);
onMounted(place);

function points(triangle: ScreenTriangle): string {
  return triangle.map(([x, y]) => `${String(x)},${String(y)}`).join(' ');
}

const root = useTemplateRef<HTMLElement>('root');
const drag = createDimensionDrag(props.sketch);

/** The pointer in px of the view area (the box of this element). */
function areaPoint(e: PointerEvent): readonly [x: number, y: number] {
  const box = root.value?.getBoundingClientRect();
  return [e.clientX - (box?.left ?? 0), e.clientY - (box?.top ?? 0)];
}

function onLabelDown(dim: SketchDimensionView, e: PointerEvent): void {
  if (e.button !== 0) return;
  const [x, y] = areaPoint(e);
  drag.down(dim.id, x, y);
  // The capture keeps the moves and the release coming to the label while the pointer leaves it.
  if (e.currentTarget instanceof Element) e.currentTarget.setPointerCapture(e.pointerId);
}

function onLabelMove(e: PointerEvent): void {
  const [x, y] = areaPoint(e);
  drag.move(x, y);
}

function select(dim: SketchDimensionView, e: MouseEvent): void {
  // The click that ends a drag is not a selection.
  if (!drag.takeClick()) return;
  props.sketch.select(dim.id, { additive: isAdditive(e) });
}

/** The dimension whose field is open, null = none. */
const editing = ref<SketchDimensionView['id'] | null>(null);
const text = ref('');
const input = useTemplateRef<HTMLInputElement[]>('input');

async function edit(dim: SketchDimensionView): Promise<void> {
  editing.value = dim.id;
  text.value = dimensionFieldText(dim);
  await nextTick();
  const el = input.value?.[0];
  el?.focus();
  el?.select();
}

/** Enter or blur: a valid number other than the shown one goes to setDimension; the field closes. */
function commit(dim: SketchDimensionView): void {
  // Only the field of `dim` is open; Enter removes it and its blur finds the edit done.
  if (finishEdit(editing) === null) return;
  const value = editedDimensionValue(text.value, dim);
  if (value !== null) void props.sketch.setDimension(dim.id, value);
}

function cancel(): void {
  finishEdit(editing);
}

function name(dim: SketchDimensionView): string {
  return constraintRowLabel(t, { kind: dim.kind, n: dim.n });
}
</script>

<template>
  <div ref="root" class="sketch-dimensions">
    <svg class="lines" aria-hidden="true">
      <g
        v-for="{ dim, layout } in placed"
        :key="dim.id"
        :class="{ selected: dim.selected, preview: dim.preview === true }"
      >
        <line
          v-for="([a, b], i) in layout.lines"
          :key="`l${String(i)}`"
          :x1="a[0]"
          :y1="a[1]"
          :x2="b[0]"
          :y2="b[1]"
        />
        <polygon
          v-for="(triangle, i) in layout.arrows"
          :key="`a${String(i)}`"
          :points="points(triangle)"
        />
      </g>
    </svg>
    <template v-for="{ dim, layout } in placed" :key="dim.id">
      <input
        v-if="editing === dim.id"
        ref="input"
        v-model="text"
        class="field"
        type="text"
        inputmode="decimal"
        :aria-label="name(dim)"
        :style="{ left: `${String(layout.labelAt[0])}px`, top: `${String(layout.labelAt[1])}px` }"
        @keydown.enter="commit(dim)"
        @keydown.esc="cancel"
        @blur="commit(dim)"
      />
      <span
        v-else-if="dim.preview === true"
        class="label preview"
        :style="{ left: `${String(layout.labelAt[0])}px`, top: `${String(layout.labelAt[1])}px` }"
      >
        {{ dimensionLabel(dim) }}
      </span>
      <button
        v-else
        type="button"
        class="label"
        :class="{ selected: dim.selected }"
        :aria-pressed="dim.selected"
        :style="{ left: `${String(layout.labelAt[0])}px`, top: `${String(layout.labelAt[1])}px` }"
        @pointerdown="onLabelDown(dim, $event)"
        @pointermove="onLabelMove"
        @pointerup="drag.up()"
        @pointercancel="drag.cancel()"
        @click="select(dim, $event)"
        @dblclick="edit(dim)"
      >
        {{ dimensionLabel(dim) }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.sketch-dimensions {
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
polygon {
  fill: var(--text-secondary);
}
.selected line {
  stroke: var(--selection);
}
.selected polygon {
  fill: var(--selection);
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
.label.preview {
  color: var(--text-tertiary);
  pointer-events: none;
}
.preview line {
  stroke: var(--text-tertiary);
  stroke-dasharray: 4 3;
}
.preview polygon {
  fill: var(--text-tertiary);
}
.label.selected {
  color: var(--selection);
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

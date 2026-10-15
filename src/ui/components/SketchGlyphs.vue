<script setup lang="ts">
// The glyphs of the constraints of the open sketch over the view (spec 12, "Glyfy vazeb (M25)";
// Q083): a small button with the icon of the kind of a geometric constraint next to each of its
// entities, coincident a dot. What is drawn is SketchState.glyphs of sketcher; where it stands is
// the pure glyphLayout of ../sketch-glyphs over the projections of session.view.project,
// recomputed when the glyphs change and on every onViewChanged, like SketchDimensions.
// Only the buttons take the pointer, so the view around them still orbits and picks. Hovering a
// glyph hovers its constraint (the session highlights its entities), a click selects it like its
// row in the panel (glyphListeners) and Delete removes it through the sketch actions.
// The layout is computed already in setup, so the first render has the glyphs, and again on
// mount, like SketchDimensions, in case the view was mounted only with this component.
import { onMounted, onScopeDispose, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Vec3 } from '@/core';
import { useObservable } from '../composables/use-observable';
import { useSession } from '../composables/use-session';
import type { ScreenPoint } from '../manipulator-hud';
import { GLYPH_ICON_VIEW_BOX, glyphIconPaths, isGlyphDot } from '../sketch-glyph-icons';
import { GLYPH_LAYOUT, glyphKey, glyphLabel, glyphLayout, glyphListeners } from '../sketch-glyphs';
import type { GlyphPlacement, GlyphSketch } from '../sketch-glyphs';

const props = defineProps<{ sketch: GlyphSketch }>();

const session = useSession();
const { t } = useI18n();
const state = useObservable(props.sketch.state);

function layout(): readonly GlyphPlacement[] {
  const project = (world: Vec3): ScreenPoint | null => session.view.project(world);
  return glyphLayout(state.value.glyphs, project);
}

/** The glyphs that project onto the view, with their centres. */
const placed = shallowRef(layout());

function place(): void {
  placed.value = layout();
}

watch(() => state.value.glyphs, place);
const offViewChanged = session.view.onViewChanged(place);
onScopeDispose(offViewChanged);
onMounted(place);

const size = `${String(GLYPH_LAYOUT.sizePx)}px`;
</script>

<template>
  <div class="sketch-glyphs">
    <button
      v-for="{ glyph, at } in placed"
      :key="glyphKey(glyph)"
      type="button"
      class="glyph"
      :class="{
        dot: isGlyphDot(glyph.kind),
        hover: glyph.hover,
        selected: glyph.selected,
      }"
      :aria-label="glyphLabel(t, glyph.kind)"
      :aria-pressed="glyph.selected"
      :style="{ left: `${String(at[0])}px`, top: `${String(at[1])}px`, width: size, height: size }"
      v-on="glyphListeners(sketch, glyph)"
    >
      <svg :viewBox="GLYPH_ICON_VIEW_BOX" aria-hidden="true">
        <circle v-if="isGlyphDot(glyph.kind)" cx="8" cy="8" r="3.5" />
        <path v-for="d in glyphIconPaths(glyph.kind)" v-else :key="d" :d="d" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.sketch-glyphs {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
.glyph {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  padding: 0;
  border: 0.5px solid var(--field-border);
  border-radius: 3px;
  background: var(--field-bg);
  color: var(--text-secondary);
  pointer-events: auto;
}
.glyph svg {
  width: 100%;
  height: 100%;
}
path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
circle {
  fill: currentColor;
}
/* coincident: only the dot, smaller than an icon, without the box. */
.glyph.dot {
  border-color: transparent;
  background: none;
}
.glyph:hover,
.glyph.hover {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}
.glyph.selected {
  border-color: var(--selection);
  background: var(--selection-soft);
  color: var(--selection);
}
.glyph.dot:hover,
.glyph.dot.hover,
.glyph.dot.selected {
  background: none;
  border-color: transparent;
}
</style>

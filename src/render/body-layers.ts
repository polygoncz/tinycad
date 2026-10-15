// The two layers of bodies of the viewport (spec 09, M21, ADR 0025): the main layer (picking,
// highlight) and the preview of the edited feature's result. One mesh cache serves both, so a
// handle is tessellated once whichever layer shows it. The viewport puts both groups into the
// scene and routes picking and highlight to the main layer only.

import type { Disposable } from '@/core';
import type { BodyId } from '@/interaction';
import type { BoundingBox, MeshOps, MeshQuality } from '@/kernel';
import { assertUniqueIds, type ShownBody } from './body-diff';
import { createBodyLayer, type BodyLayerInternal } from './body-layer';
import { unionBounds } from './bounds';
import type { DisplayPlan } from './display-style';
import { createSharedMeshCache } from './mesh-cache';
import { parseHexColor, type ScenePalette } from './palette';
import { createPicker, type Picker } from './picker';

export interface BodyLayers extends Disposable {
  /** Bodies of the pickable model: the input of an edited feature, otherwise the end state. */
  readonly main: BodyLayerInternal;
  /** The result of the edited feature where it differs from the input; never picked. */
  readonly preview: BodyLayerInternal;
  /**
   * Both layers at once (M21, D3 of M19.1): prepares the meshes of both and swaps both in one
   * synchronous block, so the main layer never shows a new model while the preview (and the
   * publish that waits for it) is still on its way. Settles once both are swapped or the call is
   * stale: a newer sync, syncLayers or clear of either layer makes it swap neither. Never
   * rejects; a duplicate BodyId in either list throws synchronously, before anything changes.
   */
  syncLayers(next: {
    readonly main: readonly ShownBody[];
    readonly preview: readonly ShownBody[];
  }): Promise<void>;
  /** Picks and occludes by the main layer only: the preview neither hits nor hides. */
  readonly picker: Picker;
  /** Union of the visible bodies of both layers (near/far, fitAll); null when there are none. */
  bounds(): BoundingBox | null;
  setPalette(palette: ScenePalette): void;
  /** View state by BodyId (Q071), for both layers. */
  setBodyVisible(body: BodyId, visible: boolean): void;
  /** Body colour (M15) for both layers; an invalid colour throws before anything changes. */
  setBodyColor(body: BodyId, color: string | null): void;
  /** Kernel instance swap (Q060): forgets the shared cache, empties both layers. */
  reset(meshes: MeshOps): void;
  /** Display plan (M22) of the main layer only: the preview looks the same in every mode. */
  setDisplayPlan(plan: DisplayPlan): void;
  /** Dash length of the hidden edges of the main layer only (BodyLayerInternal.setPixelSize). */
  setPixelSize(worldPerPx: number): void;
  /** Canvas size for the thick edges of the main layer only (BodyLayerInternal.setResolution). */
  setResolution(width: number, height: number): void;
}

export interface BodyLayersOptions {
  readonly meshes: MeshOps;
  readonly quality: MeshQuality;
  readonly palette: ScenePalette;
  readonly reportError: (body: BodyId, error: unknown) => void;
  readonly requestRender: () => void;
  /** After a scene swap of the main layer: the highlight rebuilds (the preview has none). */
  readonly afterApply?: () => void;
  /** After setBodyVisible changed a body of the main layer. */
  readonly afterVisibilityChange?: () => void;
  /** The display plan the main layer starts in (BodyLayerOptions.initialPlan); the preview has none. */
  readonly initialPlan?: DisplayPlan;
  /** X-ray of the current display plan (M22), for the picker; none = never. */
  readonly xray?: () => boolean;
}

export function createBodyLayers(options: BodyLayersOptions): BodyLayers {
  const cache = createSharedMeshCache(options.meshes, options.quality);
  const common = {
    reportError: options.reportError,
    requestRender: options.requestRender,
    palette: options.palette,
  };
  const main = createBodyLayer({
    ...common,
    cache: cache.client(),
    ...(options.afterApply === undefined ? {} : { afterApply: options.afterApply }),
    ...(options.afterVisibilityChange === undefined
      ? {}
      : { afterVisibilityChange: options.afterVisibilityChange }),
    ...(options.initialPlan === undefined ? {} : { initialPlan: options.initialPlan }),
  });
  const preview = createBodyLayer({ ...common, cache: cache.client(), style: 'preview' });
  const picker = createPicker({
    views: () => main.views.values(),
    bounds: () => main.bounds(),
    ...(options.xray === undefined ? {} : { xray: options.xray }),
  });
  let disposed = false;

  return {
    main,
    preview,
    picker,
    syncLayers(next) {
      // Both lists first, so a duplicate leaves the running syncs of both layers valid.
      assertUniqueIds(next.main);
      assertUniqueIds(next.preview);
      return Promise.all([main.prepare(next.main), preview.prepare(next.preview)]).then(
        ([mainSync, previewSync]) => {
          if (!mainSync.isCurrent() || !previewSync.isCurrent()) return;
          // One synchronous block: no frame and no publish comes between the two swaps.
          mainSync.commit();
          previewSync.commit();
        },
      );
    },
    bounds(): BoundingBox | null {
      return unionBounds([main.bounds(), preview.bounds()]);
    },
    setPalette(palette) {
      main.setPalette(palette);
      preview.setPalette(palette);
    },
    setBodyVisible(body, visible) {
      main.setBodyVisible(body, visible);
      preview.setBodyVisible(body, visible);
    },
    setBodyColor(body, color) {
      // Validated here, so an invalid colour cannot change one layer and throw in the other.
      if (color !== null) parseHexColor(color);
      main.setBodyColor(body, color);
      preview.setBodyColor(body, color);
    },
    setDisplayPlan(plan) {
      main.setDisplayPlan(plan);
    },
    setPixelSize(worldPerPx) {
      main.setPixelSize(worldPerPx);
    },
    setResolution(width, height) {
      main.setResolution(width, height);
    },
    reset(meshes) {
      cache.reset(meshes);
      main.clear();
      preview.clear();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      preview.dispose();
      main.dispose();
    },
  };
}

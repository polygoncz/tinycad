// Adapter of RegenStatusPort (spec 10, "Port stavu regenerace"): interaction must not know regen,
// so app turns every RegenResult into a RegenSnapshot – health of the evaluated features, the
// bodies (with their topological names, M14) and the sketches (with region names) of the final
// state (plane artifacts are not listed: the Browser shows the origin planes from document), the
// anchors of the manipulators (M18) and its own generation counter.

import { ObservableValue } from '@/core';
import type { FeatureId } from '@/document';
import type {
  FeatureAnchors,
  FeatureHealth,
  RegenBody,
  RegenSketch,
  RegenSnapshot,
  RegenStatusPort,
} from '@/interaction';
import { bodiesOf, sketchesOf } from '@/regen';
import type { FeatureStatus, RegenResult } from '@/regen';

export interface RegenStatusAdapter extends RegenStatusPort {
  /** A finished regeneration: a new snapshot with generation + 1. */
  publish(result: RegenResult): void;
}

const EMPTY: RegenSnapshot = Object.freeze({
  generation: 0,
  health: new Map<FeatureId, FeatureHealth>(),
  bodies: Object.freeze([]),
  sketches: Object.freeze([]),
  anchors: new Map<FeatureId, FeatureAnchors>(),
});

export function createRegenStatusAdapter(): RegenStatusAdapter {
  const state = new ObservableValue<RegenSnapshot>(EMPTY);
  return {
    state: state.asObservable(),
    publish(result) {
      // A new map every time; nobody changes it after (spec 10).
      const health = new Map<FeatureId, FeatureHealth>();
      for (const [id, status] of result.statuses) {
        const h = toHealth(status);
        if (h !== undefined) health.set(id, h);
      }
      // The feature of a body is its origin, the one that minted the id (ADR 0015). The name
      // table of the body is its names as they are: regen's NameTable fits the narrow TopoNames
      // of interaction structurally (M14, spec 11), and it is frozen already.
      const bodies: readonly RegenBody[] = Object.freeze(
        bodiesOf(result.finalState).map((b) =>
          Object.freeze({ body: b.id, feature: b.origin, names: b.names }),
        ),
      );
      // The feature of a sketch is its owner (spec 12); regions in the order of the artifact (M13).
      const sketches: readonly RegenSketch[] = Object.freeze(
        sketchesOf(result.finalState).map((a) =>
          Object.freeze({
            sketch: a.id,
            feature: a.owner,
            regions: Object.freeze([...a.regions.keys()]),
          }),
        ),
      );
      // A new map like health; the anchors are deeply frozen by regen already and regen's Anchor
      // fits the one of interaction structurally (M18, spec 10), so they pass on unchanged.
      const anchors = new Map<FeatureId, FeatureAnchors>(result.anchors);
      // Generation of the port, not of the Regenerator: a restarted kernel brings a new
      // Regenerator that counts from 1 again, the port must keep growing (spec 10).
      state.set(
        Object.freeze({
          generation: state.get().generation + 1,
          health,
          bodies,
          sketches,
          anchors,
        }),
      );
    },
  };
}

/** Health of an evaluated feature; suppressed, rolled back and pending ones have none. */
function toHealth(status: FeatureStatus): FeatureHealth | undefined {
  switch (status.kind) {
    case 'ok':
      return OK;
    case 'warning':
      return Object.freeze({ kind: 'warning', message: status.message });
    case 'error': {
      const { message, issues } = status.error;
      // issues are already a frozen copy (spec 07); ui translates them, not the message.
      return Object.freeze(
        issues === undefined ? { kind: 'error', message } : { kind: 'error', message, issues },
      );
    }
    case 'suppressed':
    case 'rolledBack':
    case 'pending':
      return undefined;
  }
}

const OK: FeatureHealth = Object.freeze({ kind: 'ok' });

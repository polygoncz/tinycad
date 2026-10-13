// Adapter of RegenStatusPort (spec 10, "Port stavu regenerace"): interaction must not know regen,
// so app turns every RegenResult into a RegenSnapshot – health of the evaluated features, the
// bodies of the final state (only artifacts of kind body until M12) and its own generation counter.

import { ObservableValue } from '@/core';
import type { FeatureId } from '@/document';
import type { FeatureHealth, RegenBody, RegenSnapshot, RegenStatusPort } from '@/interaction';
import { bodiesOf } from '@/regen';
import type { FeatureStatus, RegenResult } from '@/regen';

export interface RegenStatusAdapter extends RegenStatusPort {
  /** A finished regeneration: a new snapshot with generation + 1. */
  publish(result: RegenResult): void;
}

const EMPTY: RegenSnapshot = Object.freeze({
  generation: 0,
  health: new Map<FeatureId, FeatureHealth>(),
  bodies: Object.freeze([]),
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
      // The feature of a body is its origin, the one that minted the id (ADR 0015).
      const bodies: readonly RegenBody[] = Object.freeze(
        bodiesOf(result.finalState).map((b) => Object.freeze({ body: b.id, feature: b.origin })),
      );
      // Generation of the port, not of the Regenerator: a restarted kernel brings a new
      // Regenerator that counts from 1 again, the port must keep growing (spec 10).
      state.set(Object.freeze({ generation: state.get().generation + 1, health, bodies }));
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

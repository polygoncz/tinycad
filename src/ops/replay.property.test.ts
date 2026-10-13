import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import { toData } from '@/document';
import type { FeatureId } from '@/document';
import { aDocument, aFeature } from '@/document/testing';
import { replayLog } from './replay';
import { anOpsSession } from './testing';
import type {
  BatchOp,
  FeatureAddOp,
  FeatureMoveOp,
  FeatureRemoveOp,
  FeatureRenameOp,
  FeatureSetParamsOp,
  FeatureSuppressOp,
  StudioSetRollbackOp,
} from './operation';
import { rebuildUndoStacks } from './undo';

type Operation =
  | FeatureAddOp
  | FeatureRemoveOp
  | FeatureSetParamsOp
  | FeatureRenameOp
  | FeatureSuppressOp
  | FeatureMoveOp
  | StudioSetRollbackOp
  | BatchOp;

// Abstract steps: a kind plus plain integers/booleans. They are translated to concrete
// operations against the CURRENT document, so every generated sequence is valid.
type OpStep =
  | { readonly k: 'add'; readonly at: number }
  | { readonly k: 'remove'; readonly i: number }
  | { readonly k: 'setParams'; readonly i: number; readonly n: number }
  | { readonly k: 'rename'; readonly i: number; readonly n: number }
  | { readonly k: 'suppress'; readonly i: number; readonly on: boolean }
  | { readonly k: 'move'; readonly i: number; readonly to: number }
  | { readonly k: 'rollback'; readonly at: number };

type Step =
  | OpStep
  | {
      readonly k: 'batch';
      readonly a: number;
      readonly b: number;
      readonly c: number;
      readonly addAtEnd: boolean;
    }
  | { readonly k: 'tx'; readonly steps: readonly OpStep[]; readonly commit: boolean }
  | { readonly k: 'undo' }
  | { readonly k: 'redo' };

const int = fc.nat(1000);
const opStep: fc.Arbitrary<OpStep> = fc.oneof(
  fc.record({ k: fc.constant('add' as const), at: int }),
  fc.record({ k: fc.constant('remove' as const), i: int }),
  fc.record({ k: fc.constant('setParams' as const), i: int, n: int }),
  fc.record({ k: fc.constant('rename' as const), i: int, n: int }),
  fc.record({ k: fc.constant('suppress' as const), i: int, on: fc.boolean() }),
  fc.record({ k: fc.constant('move' as const), i: int, to: int }),
  fc.record({ k: fc.constant('rollback' as const), at: int }),
);
const step: fc.Arbitrary<Step> = fc.oneof(
  { arbitrary: opStep, weight: 6 },
  {
    arbitrary: fc.record({
      k: fc.constant('batch' as const),
      a: int,
      b: int,
      c: int,
      addAtEnd: fc.boolean(),
    }),
    weight: 1,
  },
  {
    arbitrary: fc.record({
      k: fc.constant('tx' as const),
      steps: fc.array(opStep, { minLength: 1, maxLength: 4 }),
      commit: fc.boolean(),
    }),
    weight: 2,
  },
  { arbitrary: fc.constant({ k: 'undo' as const }), weight: 1 },
  { arbitrary: fc.constant({ k: 'redo' as const }), weight: 1 },
);

const META = { id: 'doc-prop' as never, createdAt: 123 };

describe('replayLog (property)', () => {
  it('replaying the log reproduces the live document and undo stacks', () => {
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 40 }), (steps) => {
        const { doc, handlers, log, dispatcher, undo } = anOpsSession({ meta: META });
        const ids = createSequentialIdGenerator('p');

        const featureAt = (i: number): FeatureId | undefined => {
          const fs = doc.studio.features;
          return fs[i % Math.max(fs.length, 1)]?.id;
        };

        /** Concrete op for a step, or null when it cannot be done in the current state. */
        function toOp(s: OpStep): Operation | null {
          const len = doc.studio.features.length;
          switch (s.k) {
            case 'add':
              return {
                type: 'feature.add',
                v: 1,
                feature: aFeature({ id: ids.next() }),
                index: s.at % (len + 1),
              };
            case 'rollback':
              return { type: 'studio.setRollback', v: 1, index: s.at % (len + 1) };
            default: {
              const featureId = featureAt(s.i);
              if (featureId === undefined) return null;
              switch (s.k) {
                case 'remove':
                  return { type: 'feature.remove', v: 1, featureId };
                case 'setParams':
                  return { type: 'feature.setParams', v: 1, featureId, params: { size: s.n } };
                case 'rename':
                  return { type: 'feature.rename', v: 1, featureId, name: `n${String(s.n)}` };
                case 'suppress':
                  return { type: 'feature.suppress', v: 1, featureId, suppressed: s.on };
                case 'move':
                  return { type: 'feature.move', v: 1, featureId, toIndex: s.to % len };
              }
            }
          }
        }

        for (const s of steps) {
          switch (s.k) {
            case 'undo':
              if (undo.canUndo()) undo.undo();
              break;
            case 'redo':
              if (undo.canRedo()) undo.redo();
              break;
            case 'batch': {
              // Order-independent ops on existing features, plus optionally one add at the end.
              const ops: Operation[] = [];
              const x = featureAt(s.a);
              const y = featureAt(s.b);
              const z = featureAt(s.c);
              if (x !== undefined) {
                ops.push({ type: 'feature.setParams', v: 1, featureId: x, params: { size: s.a } });
              }
              if (y !== undefined) {
                ops.push({ type: 'feature.rename', v: 1, featureId: y, name: `b${String(s.b)}` });
              }
              if (z !== undefined) {
                ops.push({ type: 'feature.suppress', v: 1, featureId: z, suppressed: s.addAtEnd });
              }
              if (s.addAtEnd || ops.length === 0) {
                ops.push({
                  type: 'feature.add',
                  v: 1,
                  feature: aFeature({ id: ids.next() }),
                  index: doc.studio.features.length,
                });
              }
              const batch: BatchOp = { type: 'batch', v: 1, ops };
              dispatcher.dispatch(batch);
              break;
            }
            case 'tx': {
              const tx = dispatcher.begin('tx');
              for (const sub of s.steps) {
                const op = toOp(sub);
                if (op !== null) tx.apply(op);
              }
              if (s.commit) tx.commit();
              else tx.abort();
              break;
            }
            default: {
              const op = toOp(s);
              if (op !== null) dispatcher.dispatch(op);
            }
          }
        }

        const replayed = aDocument({ meta: META });
        replayLog(replayed, handlers, log.entries());
        expect(toData(replayed)).toEqual(toData(doc));
        expect(rebuildUndoStacks(log.entries())).toEqual(undo.stacks());
      }),
      { numRuns: 1000 },
    );
  });
});

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { createSequentialIdGenerator } from '@/core';
import { bodyId, toData } from '@/document';
import type { BodyId, BodyMaterial, DocumentData, FeatureId } from '@/document';
import { aDocument, aFeature } from '@/document/testing';
import { replayLog } from '@/ops/replay';
import type { LogEntry } from '@/ops/log';
import { anOpsSession } from '@/ops/testing';
import type {
  BatchOp,
  BodyRenameOp,
  BodySetColorOp,
  BodySetMaterialOp,
  BodySetVisibleOp,
  FeatureAddOp,
  FeatureMoveOp,
  FeatureRemoveOp,
  FeatureRenameOp,
  FeatureSetParamsOp,
  FeatureSuppressOp,
  StudioSetRollbackOp,
} from '@/ops/operation';
import { rebuildUndoStacks } from '@/ops/undo';

type Operation =
  | FeatureAddOp
  | FeatureRemoveOp
  | FeatureSetParamsOp
  | FeatureRenameOp
  | FeatureSuppressOp
  | FeatureMoveOp
  | StudioSetRollbackOp
  | BodyRenameOp
  | BodySetVisibleOp
  | BodySetColorOp
  | BodySetMaterialOp
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
  | { readonly k: 'rollback'; readonly at: number }
  | { readonly k: 'bodyRename'; readonly b: number; readonly n: number }
  | { readonly k: 'bodyVisible'; readonly b: number; readonly on: boolean }
  | { readonly k: 'bodyColor'; readonly b: number; readonly c: number }
  | { readonly k: 'bodyMaterial'; readonly b: number; readonly m: number };

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
  fc.record({ k: fc.constant('bodyRename' as const), b: int, n: fc.nat(3) }),
  fc.record({ k: fc.constant('bodyVisible' as const), b: int, on: fc.boolean() }),
  fc.record({ k: fc.constant('bodyColor' as const), b: int, c: fc.nat(3) }),
  fc.record({ k: fc.constant('bodyMaterial' as const), b: int, m: fc.nat(2) }),
);

// c = 0 resets to the default color; three colors make the same value collide often too.
const COLORS: readonly string[] = ['#ff0000', '#00ff00', '#0000ff'];
const colorAt = (c: number): string | null => (c === 0 ? null : (COLORS[c - 1] ?? null));
// m = 0 is the default 'plastic', which the canonical form drops (M24).
const MATERIALS: readonly BodyMaterial[] = ['plastic', 'steel', 'glass'];
const materialAt = (m: number): BodyMaterial => MATERIALS[m] ?? 'plastic';

// Body metadata does not depend on features existing (spec 03), so a small fixed set of bodies,
// some of them of features that never exist, makes renames and hiding collide often.
const fid = (s: string): FeatureId => s as FeatureId;
const BODIES: readonly BodyId[] = [
  bodyId(fid('p1')),
  bodyId(fid('p2')),
  bodyId(fid('p2'), 1),
  bodyId(fid('zz')),
];
const bodyAt = (b: number): BodyId => BODIES[b % BODIES.length] ?? bodyId(fid('p1'));
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

        // The state before and after every 'do' entry, by seq. Undo must give back the state
        // before its target and redo the state after it: replay alone cannot catch a wrong
        // inverse, because it replays that very inverse (revision, domain).
        const before = new Map<number, DocumentData>();
        const after = new Map<number, DocumentData>();
        const record = (entry: LogEntry | null, start: DocumentData): void => {
          if (entry === null) return;
          before.set(entry.seq, start);
          after.set(entry.seq, toData(doc));
        };
        const dispatch = (op: Operation): void => {
          const start = toData(doc);
          record(dispatcher.dispatch(op), start);
        };

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
            // n = 0 clears the name, so the canonical form (no entry, no bodies) is exercised too.
            case 'bodyRename':
              return {
                type: 'body.rename',
                v: 1,
                body: bodyAt(s.b),
                name: s.n === 0 ? '' : `n${String(s.n)}`,
              };
            case 'bodyVisible':
              return { type: 'body.setVisible', v: 1, body: bodyAt(s.b), visible: s.on };
            case 'bodyColor':
              return { type: 'body.setColor', v: 1, body: bodyAt(s.b), color: colorAt(s.c) };
            case 'bodyMaterial':
              return {
                type: 'body.setMaterial',
                v: 1,
                body: bodyAt(s.b),
                material: materialAt(s.m),
              };
            default: {
              const featureId = featureAt(s.i);
              if (featureId === undefined) return null;
              switch (s.k) {
                case 'remove':
                  return { type: 'feature.remove', v: 1, featureId };
                case 'setParams':
                  return {
                    type: 'feature.setParams',
                    v: 2,
                    featureId,
                    typeVersion: 1,
                    params: { size: s.n },
                  };
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
            case 'undo': {
              const target = undo.stacks().undo.at(-1);
              if (target === undefined) break;
              undo.undo();
              expect(toData(doc)).toEqual(before.get(target));
              break;
            }
            case 'redo': {
              const target = undo.stacks().redo.at(-1);
              if (target === undefined) break;
              undo.redo();
              expect(toData(doc)).toEqual(after.get(target));
              break;
            }
            case 'batch': {
              // Order-independent ops on existing features, plus optionally one add at the end.
              const ops: Operation[] = [];
              const x = featureAt(s.a);
              const y = featureAt(s.b);
              const z = featureAt(s.c);
              if (x !== undefined) {
                ops.push({
                  type: 'feature.setParams',
                  v: 2,
                  featureId: x,
                  typeVersion: 1,
                  params: { size: s.a },
                });
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
              dispatch(batch);
              break;
            }
            case 'tx': {
              const start = toData(doc);
              const tx = dispatcher.begin('tx');
              for (const sub of s.steps) {
                const op = toOp(sub);
                if (op !== null) tx.apply(op);
              }
              if (s.commit) record(tx.commit(), start);
              else tx.abort();
              break;
            }
            default: {
              const op = toOp(s);
              if (op !== null) dispatch(op);
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

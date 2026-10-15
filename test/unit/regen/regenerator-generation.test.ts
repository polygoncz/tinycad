import { describe, expect, it } from 'vitest';
import type { FeatureId, FeatureInstance } from '@/document';
import { aFeature } from '@/document/testing';
import type { DefaultParams } from '@/document/testing';
import type { RegenResult, Regenerator } from '@/regen/regenerator';
import type { FeatureStatus } from '@/regen/state';
import {
  aGatedBuild,
  aRegenSetup,
  aSchema,
  aSpyBuilder,
  aStudio,
  features,
  resized,
  result,
} from '@/regen/testing';

// Concurrency (generations) and events of the Regenerator (spec 07, Souběh (generace)).

const OK: FeatureStatus = { kind: 'ok' };

type Event =
  | { type: 'started'; generation: number }
  | { type: 'featureDone'; generation: number; featureId: FeatureId; status: FeatureStatus }
  | { type: 'finished'; generation: number; result: RegenResult };

/** Records all events of the regenerator in emission order. */
function record(regenerator: Regenerator): Event[] {
  const events: Event[] = [];
  regenerator.events.on('started', (e) => events.push({ type: 'started', ...e }));
  regenerator.events.on('featureDone', (e) => events.push({ type: 'featureDone', ...e }));
  regenerator.events.on('finished', (e) => events.push({ type: 'finished', ...e }));
  return events;
}

/** Events without the result object, for compact comparisons. */
function brief(events: readonly Event[]): string[] {
  return events.map((e) =>
    e.type === 'featureDone'
      ? `${String(e.generation)} featureDone ${e.featureId} ${e.status.kind}`
      : `${String(e.generation)} ${e.type}`,
  );
}

describe('Regenerator generations', () => {
  it('a run during a running one supersedes it; the second gives the result', async () => {
    const gated = aGatedBuild();
    const { regenerator, box } = aRegenSetup({ build: gated.build });
    const [f1, f2] = features(2) as [
      FeatureInstance<DefaultParams>,
      FeatureInstance<DefaultParams>,
    ];
    const gate = gated.hold(f1);

    const first = regenerator.run(aStudio([f1, f2]));
    const changed = resized(f1, 2);
    const second = await regenerator.run(aStudio([changed, f2]));
    gate.resolve();

    expect(await first).toBe('superseded');
    const r = result(second);
    expect(r.generation).toBe(2);
    expect([...r.statuses]).toEqual([
      ['f1', OK],
      ['f2', OK],
    ]);
    // The superseded run stops after the await of f1 and never builds its f2.
    expect(box.calls.map((c) => c.feature)).toEqual([f1, changed, f2]);
  });

  it('the cache matches the run that finished, not the superseded one', async () => {
    const gated = aGatedBuild();
    const { regenerator, box } = aRegenSetup({ build: gated.build });
    const [f1, f2] = features(2) as [
      FeatureInstance<DefaultParams>,
      FeatureInstance<DefaultParams>,
    ];
    const gate = gated.hold(f1);
    const first = regenerator.run(aStudio([f1, f2]));
    const studio = aStudio([resized(f1, 2), f2]);
    const second = result(await regenerator.run(studio));
    gate.resolve();
    await first;

    const calls = box.calls.length;
    const third = result(await regenerator.run(studio));
    expect(box.calls.length).toBe(calls);
    expect(third.finalState).toBe(second.finalState);
  });

  it('a superseded run finishing after the current one does not write the cache', async () => {
    const gated = aGatedBuild();
    const { regenerator, box } = aRegenSetup({ build: gated.build });
    const [f1, f2] = features(2) as [
      FeatureInstance<DefaultParams>,
      FeatureInstance<DefaultParams>,
    ];
    const changed = resized(f1, 2);
    const firstGate = gated.hold(f1);
    const secondGate = gated.hold(changed);

    const first = regenerator.run(aStudio([f1, f2]));
    const second = regenerator.run(aStudio([changed, f2]));
    secondGate.resolve();
    result(await second);
    firstGate.resolve();
    expect(await first).toBe('superseded');

    // The cache holds the second studio: running the first one again rebuilds from f1 on.
    const before = box.calls.length;
    result(await regenerator.run(aStudio([f1, f2])));
    expect(box.calls.slice(before).map((c) => c.feature)).toEqual([f1, f2]);
  });

  it('a superseded run that finished first still does not write the cache', async () => {
    const gated = aGatedBuild();
    const { regenerator, box } = aRegenSetup({ build: gated.build });
    const [f1, f2] = features(2) as [
      FeatureInstance<DefaultParams>,
      FeatureInstance<DefaultParams>,
    ];
    const changed = resized(f1, 2);
    const firstGate = gated.hold(f1);
    const secondGate = gated.hold(changed);

    const first = regenerator.run(aStudio([f1, f2]));
    const second = regenerator.run(aStudio([changed, f2]));
    firstGate.resolve();
    expect(await first).toBe('superseded');
    secondGate.resolve();
    result(await second);

    const before = box.calls.length;
    result(await regenerator.run(aStudio([changed, f2])));
    expect(box.calls.slice(before)).toEqual([]);
  });

  it('generation grows with every run, superseded ones included', async () => {
    const gated = aGatedBuild();
    const { regenerator } = aRegenSetup({ build: gated.build });
    const [f1] = features(1) as [FeatureInstance<DefaultParams>];
    const gate = gated.hold(f1);
    const first = regenerator.run(aStudio([f1]));
    const second = result(await regenerator.run(aStudio([resized(f1, 2)])));
    gate.resolve();
    await first;
    const third = result(await regenerator.run(aStudio([resized(f1, 3)])));
    expect([second.generation, third.generation]).toEqual([2, 3]);
  });
});

describe('Regenerator events', () => {
  it('emits started, featureDone for every feature in order, then finished', async () => {
    const { regenerator } = aRegenSetup();
    const events = record(regenerator);
    const list = features(3);
    const r = result(await regenerator.run(aStudio(list, 2)));
    expect(brief(events)).toEqual([
      '1 started',
      '1 featureDone f1 ok',
      '1 featureDone f2 ok',
      '1 featureDone f3 rolledBack',
      '1 finished',
    ]);
    const last = events.at(-1);
    expect(last?.type === 'finished' ? last.result : undefined).toBe(r);
  });

  it('featureDone carries the statuses of the result', async () => {
    const { regenerator } = aRegenSetup();
    const events = record(regenerator);
    const list = [...features(2), aFeature({ id: 'bad', params: { size: 0 } })];
    const r = result(await regenerator.run(aStudio(list)));
    const done = events.flatMap((e) =>
      e.type === 'featureDone' ? [[e.featureId, e.status] as const] : [],
    );
    expect(done).toEqual([...r.statuses]);
  });

  it('cached and rolledBack features get featureDone too, in feature order', async () => {
    const { regenerator, box } = aRegenSetup();
    const list = features(4);
    result(await regenerator.run(aStudio(list, 3)));
    const events = record(regenerator);
    const before = box.calls.length;
    const changed = list.map((f, i) => (i === 2 ? resized(f, 2) : f));
    result(await regenerator.run(aStudio(changed, 3)));
    expect(box.builtIds().slice(before)).toEqual(['f3']);
    expect(brief(events)).toEqual([
      '2 started',
      '2 featureDone f1 ok',
      '2 featureDone f2 ok',
      '2 featureDone f3 ok',
      '2 featureDone f4 rolledBack',
      '2 finished',
    ]);
  });

  it('finished comes before the promise resolves', async () => {
    const { regenerator } = aRegenSetup();
    let resolved = false;
    let resolvedAtFinished: boolean | undefined;
    regenerator.events.on('finished', () => {
      resolvedAtFinished = resolved;
    });
    await regenerator.run(aStudio(features(1))).then(() => {
      resolved = true;
    });
    expect(resolvedAtFinished).toBe(false);
  });

  it('finished only for the generation that completes; the superseded one emits what it got to', async () => {
    const gated = aGatedBuild();
    const { regenerator } = aRegenSetup({ build: gated.build });
    const events = record(regenerator);
    const [f1, f2] = features(2) as [
      FeatureInstance<DefaultParams>,
      FeatureInstance<DefaultParams>,
    ];
    const f2Gate = gated.hold(f2);

    const first = regenerator.run(aStudio([f1, f2]));
    // Let the first run build f1 and wait in f2.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = regenerator.run(aStudio([resized(f1, 2), f2]));
    f2Gate.resolve();
    await Promise.all([first, second]);

    expect(brief(events)).toEqual([
      '1 started',
      '1 featureDone f1 ok',
      '2 started',
      '2 featureDone f1 ok',
      '2 featureDone f2 ok',
      '2 finished',
    ]);
  });

  it('a non-kernel exception rejects run without finished', async () => {
    const { regenerator, schemas, builders } = aRegenSetup();
    const events = record(regenerator);
    const bug = new TypeError('plugin bug');
    schemas.register(aSchema('buggy'));
    builders.register(aSpyBuilder('buggy', () => Promise.reject(bug)));
    await expect(
      regenerator.run(aStudio([aFeature({ id: 'a' }), aFeature({ id: 'b', type: 'buggy' })])),
    ).rejects.toBe(bug);
    expect(brief(events)).toEqual(['1 started', '1 featureDone a ok']);
  });
});

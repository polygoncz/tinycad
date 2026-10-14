import { Emitter, RpcError } from '@/core';
import type { RegistryReader, Subscribable } from '@/core';
import type {
  FeatureId,
  FeatureInstance,
  FeatureSchema,
  ParamIssue,
  PartStudioData,
} from '@/document';
import { kernelErrorCode } from '@/kernel';
import type { GeometryKernel, ShapeHandle } from '@/kernel';
import { createBuildSession } from './build-context';
import type { BuildOutput, FeatureBuilder } from './builder';
import { EMPTY_STATE, bodiesOf, sketchesOf } from './state';
import type { FeatureError, FeatureStatus, RegenState } from './state';

// Replays the features of a part studio through the kernel (spec 07, Regenerator) with a cache
// keyed by the identity of feature objects (ADR 0006).

export interface RegenResult {
  readonly generation: number;
  /** State at the rollback bar: output of the last feature in front of it, or EMPTY_STATE. */
  readonly finalState: RegenState;
  /** Every feature of the studio, in feature order. */
  readonly statuses: ReadonlyMap<FeatureId, FeatureStatus>;
  readonly durationMs: number;
}

/** Events of the Regenerator (spec 07, Souběh); a listener filters by `generation`. */
export interface RegenEvents {
  readonly started: { readonly generation: number };
  readonly featureDone: {
    readonly generation: number;
    readonly featureId: FeatureId;
    readonly status: FeatureStatus;
  };
  readonly finished: { readonly generation: number; readonly result: RegenResult };
}

export interface Regenerator {
  /** Regenerates the studio. A call during a running regeneration replaces it (the old result is dropped). */
  run(studio: PartStudioData): Promise<RegenResult | 'superseded'>;
  readonly events: Subscribable<RegenEvents>;
}

/** Cache entry of one position (Q042): the feature, its output state and its status. */
interface CacheEntry {
  readonly feature: FeatureInstance;
  readonly state: RegenState;
  readonly status: FeatureStatus;
}

// Statuses go to listeners and the UI and stay in the cache, so each one is frozen (spec 07).
const OK: FeatureStatus = Object.freeze({ kind: 'ok' });
const SUPPRESSED: FeatureStatus = Object.freeze({ kind: 'suppressed' });
const ROLLED_BACK: FeatureStatus = Object.freeze({ kind: 'rolledBack' });

export function createRegenerator(deps: {
  kernel: GeometryKernel;
  builders: RegistryReader<FeatureBuilder>;
  schemas: RegistryReader<FeatureSchema>;
  /** Clock for durationMs (Q046); app supplies it, ring 1 does not touch globals (ADR 0009). */
  now: () => number;
}): Regenerator {
  const { kernel, builders, schemas, now } = deps;
  const emitter = new Emitter<RegenEvents>();
  /** Every handle the kernel gave to a builder; mark & sweep releases the dead ones. */
  const owned = new Set<ShapeHandle>();
  let cache: readonly CacheEntry[] = [];
  let generation = 0;
  /**
   * Set once the kernel is gone (Q049): the Regenerator is dead, the running and every later run
   * rejects with this error. app creates a new kernel and a new Regenerator.
   */
  let lostKernel: RpcError | undefined;

  /** Rejects the run when the kernel is gone (Q049), whatever its generation. */
  function assertKernelAlive(): void {
    if (lostKernel !== undefined) throw lostKernel;
  }

  /** Output state and status of one feature in front of the rollback bar (steps 2–7). */
  async function build(feature: FeatureInstance, input: RegenState): Promise<CacheEntry> {
    const passThrough = (status: FeatureStatus): CacheEntry => ({ feature, state: input, status });
    // A copy, so freezing it does not touch the object the builder returned.
    const failed = (error: FeatureError): CacheEntry =>
      passThrough(Object.freeze({ kind: 'error', error: Object.freeze({ ...error }) }));

    if (feature.suppressed) return passThrough(SUPPRESSED);

    const schema = schemas.find(feature.type);
    const builder = builders.find(feature.type);
    if (schema === undefined || builder === undefined) {
      const missing = schema === undefined ? 'schema' : 'builder';
      return failed({
        code: 'UNKNOWN_TYPE',
        message: `No feature ${missing} for type '${feature.type}'`,
      });
    }

    // A guard for data that missed migration (fromData, apply of ops): the builder and validate
    // expect the params of the current schema version.
    if (feature.typeVersion !== schema.version) {
      return failed({
        code: 'STALE_VERSION',
        message:
          `Feature of type '${feature.type}' has data version ${String(feature.typeVersion)}, ` +
          `the schema is version ${String(schema.version)}`,
      });
    }

    const issues = schema.validate(feature.params);
    if (issues.length > 0) {
      return failed({
        code: 'INVALID_PARAMS',
        message: issues.map(formatIssue).join('; '),
        issues: freezeIssues(issues),
      });
    }

    const session = createBuildSession({ kernel, owned, state: input });
    let output: BuildOutput;
    try {
      output = await builder.build({ feature, state: input }, session.ctx);
    } catch (e) {
      // Q043: only a kernel error is a feature error; anything else is a bug and rejects run.
      if (kernelErrorCode(e) === undefined) throw e;
      return failed({ code: 'KERNEL', message: e instanceof Error ? e.message : String(e) });
    }
    if (!output.ok) return failed(output.error);

    const warnings = session.warnings();
    const status: FeatureStatus =
      warnings === undefined ? OK : Object.freeze({ kind: 'warning', message: warnings });
    return { feature, state: output.state, status };
  }

  /**
   * The kernel is gone with all its handles (Q037, Q049): nothing owned or cached is valid and
   * the Regenerator is dead from now on. Recovery (a new kernel, a new Regenerator) is up to app.
   */
  function dropKernelState(error: RpcError): void {
    owned.clear();
    cache = [];
    // The first loss is the cause; later 'disconnected' errors are its echoes.
    lostKernel ??= error;
  }

  /**
   * Mark & sweep (spec 07, Životnost handle): live = the shapes of the body artifacts and the
   * region faces of the sketch artifacts of all states in the cache (planes have no handle);
   * every other owned handle is released in one release call. Failures of release
   * by code (Q040).
   */
  async function sweep(): Promise<void> {
    // A dead kernel has nothing to release to (Q049).
    assertKernelAlive();
    const live = new Set<ShapeHandle>();
    for (const entry of cache) {
      for (const body of bodiesOf(entry.state)) live.add(body.shape);
      for (const sketch of sketchesOf(entry.state)) {
        for (const face of sketch.regions.values()) live.add(face);
      }
    }
    const dead = [...owned].filter((h) => !live.has(h));
    if (dead.length === 0) return;
    // Out of the owned set before the await: when a newer run sweeps while this release is
    // pending, it does not see these handles and cannot release them a second time.
    for (const h of dead) owned.delete(h);
    try {
      await kernel.release(dead);
    } catch (e) {
      if (isDisconnected(e)) {
        dropKernelState(e);
        throw e;
      }
      // release is atomic: nothing was released, so the handles are owned again.
      for (const h of dead) owned.add(h);
      // 'unknown-handle' is a bug of regen; an error without a kernel code is a bug too.
      const code = kernelErrorCode(e);
      if (code === undefined || code === 'unknown-handle') throw e;
      // Any other kernel error ('internal'): the next sweep tries again.
    }
  }

  /**
   * Steps 1–5 of the cache for generation `current`; writes the cache unless superseded.
   * Emits `started` and `featureDone`, not `finished`.
   */
  async function regenerate(
    studio: PartStudioData,
    current: number,
  ): Promise<Omit<RegenResult, 'durationMs'> | 'superseded'> {
    const { features, rollbackIndex } = studio;
    const done = (featureId: FeatureId, status: FeatureStatus): void => {
      emitter.emit('featureDone', { generation: current, featureId, status });
    };
    emitter.emit('started', { generation: current });

    // Cache step 1: the first position whose feature is not the cached object.
    let k = 0;
    while (k < features.length && features[k] === cache[k]?.feature) k++;

    // Steps 2, 3 and 5: positions 0..k-1 stay, k..rollbackIndex-1 are built anew.
    const entries = cache.slice(0, k);
    for (const entry of entries.slice(0, rollbackIndex)) done(entry.feature.id, entry.status);
    for (let i = k; i < rollbackIndex; i++) {
      const feature = features[i];
      if (feature === undefined) break;
      const entry = await build(feature, entries[i - 1]?.state ?? EMPTY_STATE);
      // The kernel died during the await (a concurrent run saw it): the entries hold dead handles.
      assertKernelAlive();
      // A newer run started during the await: drop this one, its result is stale.
      if (current !== generation) return 'superseded';
      entries.push(entry);
      done(feature.id, entry.status);
    }

    // Step 4: features behind the bar are rolledBack whatever the cache holds for them.
    const statuses = new Map<FeatureId, FeatureStatus>();
    features.forEach((feature, i) => {
      const built = i < rollbackIndex ? entries[i]?.status : undefined;
      const status = built ?? ROLLED_BACK;
      // Built and cached features already got their featureDone above.
      if (built === undefined) done(feature.id, status);
      statuses.set(feature.id, status);
    });

    // Only the current generation of a live kernel gets here, so only it writes the cache.
    assertKernelAlive();
    cache = entries;
    return {
      generation: current,
      finalState: entries[rollbackIndex - 1]?.state ?? EMPTY_STATE,
      statuses,
    };
  }

  /**
   * Events (spec 07, Souběh): `started` first; then `featureDone` once for every feature of the
   * studio, in feature order, so the UI gets the whole picture of the generation – cached features
   * before the first build, a rebuilt one right after its build, rolledBack ones at the end;
   * `finished` last, after the sweep and before the promise resolves. A superseded generation
   * stops emitting at the first check after an await and never emits `finished`; neither does a
   * run rejected by a non-kernel exception (Q043), by a lost kernel (Q049) or by a failed
   * release (Q040).
   *
   * The sweep runs at the end of every run that ends as the current generation – with a result
   * or with an exception. A superseded run does not sweep; the run that replaced it does. A lost
   * kernel (RpcError 'disconnected', Q049) is the exception: whatever the generation, there is no
   * sweep, run drops the cache and the owned set at once and the Regenerator is dead – the
   * running runs reject at their next check (after an await, before writing the cache, before
   * `finished`) and every later run rejects at once, without calling the kernel. They all reject
   * with the RpcError of the first loss.
   */
  async function run(studio: PartStudioData): Promise<RegenResult | 'superseded'> {
    assertKernelAlive();
    const start = now();
    const current = ++generation;
    let outcome: Omit<RegenResult, 'durationMs'> | 'superseded';
    try {
      outcome = await regenerate(studio, current);
    } catch (e) {
      if (isDisconnected(e)) {
        // Q049: the kernel is gone with all its handles, for every generation – nothing owned or
        // cached is valid and there is nobody to release them to.
        dropKernelState(e);
        throw e;
      }
      // Q043 and listener exceptions: the cache was not written, so the handles of this run
      // are dead. The original exception wins over a failed release; sweep has already put
      // owned and cache into a consistent state before it rejects. A dead kernel takes no sweep.
      if (current === generation && lostKernel === undefined) {
        await sweep().catch(() => undefined);
      }
      throw e;
    }
    if (outcome === 'superseded') return outcome;

    await sweep();
    // The kernel died during the release, in a concurrent run: no result of a dead kernel.
    assertKernelAlive();
    // A run started while release was pending replaces this one, like a run started during a
    // build: this result is dropped. The cache stays as written – it is valid for this studio
    // and the newer run reuses or replaces it. owned is consistent either way, because sweep
    // removed the dead handles before the await.
    if (current !== generation) return 'superseded';

    // The statuses map is not frozen; ReadonlyMap guards it (spec 07).
    const result: RegenResult = Object.freeze({ ...outcome, durationMs: now() - start });
    emitter.emit('finished', { generation: current, result });
    return result;
  }

  return { run, events: emitter };
}

/** RpcError of a kernel that is gone (Q037); recognised by code, the message is free text. */
function isDisconnected(e: unknown): e is RpcError {
  return e instanceof RpcError && e.code === 'disconnected';
}

/** 'param: code', or the code alone for an issue of the params as a whole (codes since ADR 0014). */
/** A frozen copy: the status lives in the cache and goes to the UI, the schema's array may not be frozen. */
function freezeIssues(issues: readonly ParamIssue[]): readonly ParamIssue[] {
  return Object.freeze(
    issues.map((issue) =>
      Object.freeze(
        issue.params === undefined
          ? { ...issue }
          : { ...issue, params: Object.freeze({ ...issue.params }) },
      ),
    ),
  );
}

function formatIssue(issue: ParamIssue): string {
  return issue.param === '' ? issue.code : `${issue.param}: ${issue.code}`;
}

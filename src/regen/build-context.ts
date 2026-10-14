import { EPSILON, err, ok, plane, vec3 } from '@/core';
import type { Result, Vec2 } from '@/core';
import { sketchId } from '@/document';
import type {
  AxisRef,
  BodyRef,
  PlaneRef,
  SketchEntityRef,
  SketchRegionRef,
  TopoName,
  TopoRef,
} from '@/document';
import type { ShapeHandle } from '@/kernel';
import type { SketchEntity } from '@/sketch';
import type {
  BuildContext,
  ModelingKernel,
  RefError,
  ResolvedAxis,
  ResolvedPlane,
  ResolvedRegion,
  ResolvedTopo,
} from './builder';
import { resolveNamed, resolvePlaneRef } from './face-plane';
import { isAxis, isBody, isSketch } from './state';
import type { Body, RegenState, SketchArtifact } from './state';
import { createTrackingKernel } from './tracking-kernel';

// BuildContext of one feature build (spec 07, Builder featury). Internal to regen: the
// Regenerator creates a session per build and reads the collected warnings afterwards.

export interface BuildSessionInit {
  /** The real kernel; the builder gets it wrapped by createTrackingKernel. */
  readonly kernel: ModelingKernel;
  /** Handles owned by the Regenerator; the tracked kernel adds to it (Q041). */
  readonly owned: Set<ShapeHandle>;
  /** Input state of the feature; every resolve method looks only at artifacts of its kind. */
  readonly state: RegenState;
}

export interface BuildSession {
  readonly ctx: BuildContext;
  /** Messages of ctx.warn joined with '\n' in call order (Q045), undefined when none. */
  warnings(): string | undefined;
}

export function createBuildSession(init: BuildSessionInit): BuildSession {
  const { state } = init;
  const messages: string[] = [];

  const resolveBodies = (refs: readonly BodyRef[]): Result<Body[], RefError> => {
    const bodies: Body[] = [];
    for (const ref of refs) {
      const artifact = state.artifacts.get(ref.body);
      if (artifact === undefined) {
        return err({ ref, message: `Body '${ref.body}' does not exist` });
      }
      if (!isBody(artifact)) {
        return err({ ref, message: `'${ref.body}' is not a body` });
      }
      bodies.push(artifact);
    }
    return ok(bodies);
  };

  const warn = (message: string): void => {
    messages.push(message);
  };
  /**
   * Spec 08: a face name on several faces is a warning. resolveTopo hands them all to the
   * builder, a sketch plane uses only the first (R96), so the text says which.
   */
  const warnSeveralFaces = (name: TopoName, count: number, used: 'all' | 'first'): void => {
    if (count <= 1) return;
    const tail = used === 'all' ? 'all are used' : 'the first is used';
    warn(`Reference '${name}' matches ${String(count)} faces; ${tail}`);
  };

  const resolvePlanes = (
    refs: readonly (PlaneRef | TopoRef)[],
  ): Result<ResolvedPlane[], RefError> => {
    const planes: ResolvedPlane[] = [];
    for (const ref of refs) {
      const resolved = resolvePlaneRef(state, ref);
      if (!resolved.ok) return err({ ref, message: resolved.error });
      if (ref.kind === 'topo') warnSeveralFaces(ref.name, resolved.value.matches, 'first');
      planes.push(Object.freeze({ ref, plane: resolved.value.plane }));
    }
    return ok(planes);
  };

  const resolveTopo = (
    refs: readonly TopoRef[],
    entity: 'face' | 'edge',
  ): Result<ResolvedTopo[], RefError> => {
    const resolved: ResolvedTopo[] = [];
    for (const ref of refs) {
      const found = resolveNamed(state, ref.body, ref.name, entity);
      if (!found.ok) return err({ ref, message: found.error });
      const { body, indices } = found.value;
      // Several edges under one name are usually wanted (spec 08): no warning for them.
      if (entity === 'face') warnSeveralFaces(ref.name, indices.length, 'all');
      resolved.push(Object.freeze({ ref, body, indices }));
    }
    return ok(resolved);
  };

  /** The sketch artifact of the sketch feature `ref.sketch`, or a RefError for `ref`. */
  const sketchOf = (ref: SketchRegionRef | SketchEntityRef): Result<SketchArtifact, RefError> => {
    const artifact = state.artifacts.get(sketchId(ref.sketch));
    if (artifact === undefined || !isSketch(artifact)) {
      return err({ ref, message: `Sketch '${ref.sketch}' not found` });
    }
    return ok(artifact);
  };

  const resolveRegions = (refs: readonly SketchRegionRef[]): Result<ResolvedRegion[], RefError> => {
    const regions: ResolvedRegion[] = [];
    for (const ref of refs) {
      const sketch = sketchOf(ref);
      if (!sketch.ok) return sketch;
      const face = sketch.value.regions.get(ref.region);
      if (face === undefined) {
        return err({ ref, message: `Region '${ref.region}' of sketch '${ref.sketch}' not found` });
      }
      regions.push(Object.freeze({ ref, sketch: sketch.value, face }));
    }
    return ok(regions);
  };

  const resolveOriginAxis = (ref: AxisRef): Result<ResolvedAxis, RefError> => {
    const artifact = state.artifacts.get(ref.axis);
    if (artifact === undefined) {
      return err({ ref, message: `Axis '${ref.axis}' does not exist` });
    }
    if (!isAxis(artifact)) {
      return err({ ref, message: `'${ref.axis}' is not an axis` });
    }
    // The values of an axis artifact are frozen already.
    return ok(Object.freeze({ origin: artifact.origin, direction: artifact.direction }));
  };

  const resolveSketchLine = (ref: SketchEntityRef): Result<ResolvedAxis, RefError> => {
    const sketch = sketchOf(ref);
    if (!sketch.ok) return sketch;
    const { entities, plane: frame } = sketch.value;
    const line = entities.find((e) => e.id === ref.entity);
    if (line === undefined) {
      return err({
        ref,
        message: `Sketch entity '${ref.entity}' of sketch '${ref.sketch}' not found`,
      });
    }
    if (line.kind !== 'line') {
      return err({ ref, message: `Sketch entity '${ref.entity}' is not a line` });
    }
    const p1 = plane.toWorld(frame, pointOf(entities, line.p1));
    const p2 = plane.toWorld(frame, pointOf(entities, line.p2));
    const d = vec3.sub(p2, p1);
    if (vec3.length(d) <= EPSILON) {
      return err({ ref, message: `Sketch line '${ref.entity}' has zero length` });
    }
    return ok(Object.freeze({ origin: p1, direction: vec3.normalize(d) }));
  };

  const resolveAxis = (ref: AxisRef | SketchEntityRef): Result<ResolvedAxis, RefError> =>
    ref.kind === 'axis' ? resolveOriginAxis(ref) : resolveSketchLine(ref);

  return {
    ctx: {
      kernel: createTrackingKernel(init.kernel, init.owned),
      resolveBodies,
      resolvePlanes,
      resolveRegions,
      resolveAxis,
      warn,
      resolveTopo,
    },
    warnings: () => (messages.length === 0 ? undefined : messages.join('\n')),
  };
}

/**
 * The coordinates of the point `id` of a sketch. The entities of a sketch artifact come from
 * validated sketch data (spec 12), so a line without its point is a programming error.
 */
function pointOf(entities: readonly SketchEntity[], id: string): Vec2 {
  const point = entities.find((e) => e.id === id);
  if (point?.kind !== 'point') throw new Error(`Sketch point '${id}' not found`);
  return [point.x, point.y];
}

import { err, ok } from '@/core';
import type { Result } from '@/core';
import type { BodyRef, PlaneRef } from '@/document';
import type { ShapeHandle } from '@/kernel';
import type { BuildContext, ModelingKernel, RefError } from './builder';
import { isBody, isPlane } from './state';
import type { Body, PlaneArtifact, RegenState } from './state';
import { createTrackingKernel } from './tracking-kernel';

// BuildContext of one feature build (spec 07, Builder featury). Internal to regen: the
// Regenerator creates a session per build and reads the collected warnings afterwards.

export interface BuildSessionInit {
  /** The real kernel; the builder gets it wrapped by createTrackingKernel. */
  readonly kernel: ModelingKernel;
  /** Handles owned by the Regenerator; the tracked kernel adds to it (Q041). */
  readonly owned: Set<ShapeHandle>;
  /** Input state of the feature; resolveBodies and resolvePlanes look only at artifacts of their kind. */
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

  const resolvePlanes = (refs: readonly PlaneRef[]): Result<PlaneArtifact[], RefError> => {
    const planes: PlaneArtifact[] = [];
    for (const ref of refs) {
      const artifact = state.artifacts.get(ref.plane);
      if (artifact === undefined) {
        return err({ ref, message: `Plane '${ref.plane}' does not exist` });
      }
      if (!isPlane(artifact)) {
        return err({ ref, message: `'${ref.plane}' is not a plane` });
      }
      planes.push(artifact);
    }
    return ok(planes);
  };

  return {
    ctx: {
      kernel: createTrackingKernel(init.kernel, init.owned),
      resolveBodies,
      resolvePlanes,
      warn: (message) => {
        messages.push(message);
      },
    },
    warnings: () => (messages.length === 0 ? undefined : messages.join('\n')),
  };
}

import { err, ok } from '@/core';
import type { Result } from '@/core';
import type { BodyRef } from '@/document';
import type { ShapeHandle } from '@/kernel';
import type { BuildContext, ModelingKernel, RefError } from './builder';
import { isBody } from './state';
import type { Body, RegenState } from './state';
import { createTrackingKernel } from './tracking-kernel';

// BuildContext of one feature build (spec 07, Builder featury). Internal to regen: the
// Regenerator creates a session per build and reads the collected warnings afterwards.

export interface BuildSessionInit {
  /** The real kernel; the builder gets it wrapped by createTrackingKernel. */
  readonly kernel: ModelingKernel;
  /** Handles owned by the Regenerator; the tracked kernel adds to it (Q041). */
  readonly owned: Set<ShapeHandle>;
  /** Input state of the feature; resolveBodies looks only at its body artifacts. */
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

  return {
    ctx: {
      kernel: createTrackingKernel(init.kernel, init.owned),
      resolveBodies,
      warn: (message) => {
        messages.push(message);
      },
    },
    warnings: () => (messages.length === 0 ? undefined : messages.join('\n')),
  };
}

import { assert, createRegistry } from '@/core';
import type { Registry, Vec3 } from '@/core';

// The data half of a feature type (ADR 0004): params, defaults, validation, migration.
// Geometry is computed by the FeatureBuilder in regen.

// One ParamSpec drives three things: validation, the generated UI form (spec 11)
// and telling reference params apart for picking in the feature dialog.
export type ParamSpec =
  | {
      readonly kind: 'length';
      readonly label: string;
      readonly default: number;
      readonly min?: number;
      readonly max?: number;
    }
  | {
      readonly kind: 'angle';
      readonly label: string;
      readonly default: number;
      readonly min?: number;
      readonly max?: number;
    }
  | {
      readonly kind: 'number';
      readonly label: string;
      readonly default: number;
      readonly min?: number;
      readonly max?: number;
      readonly integer?: boolean;
    }
  | { readonly kind: 'boolean'; readonly label: string; readonly default: boolean }
  | {
      readonly kind: 'enum';
      readonly label: string;
      readonly default: string;
      readonly options: readonly { readonly value: string; readonly label: string }[];
    }
  | { readonly kind: 'point'; readonly label: string; readonly default: Vec3 }
  // Reference params hold arrays; min/max count the references and default to 0..∞.
  | {
      readonly kind: 'bodies';
      readonly label: string;
      readonly min?: number;
      readonly max?: number;
    } // BodyRef[]
  | {
      readonly kind: 'topo';
      readonly label: string;
      readonly entity: 'face' | 'edge' | 'vertex';
      readonly min?: number;
      readonly max?: number;
    } // TopoRef[]
  | {
      readonly kind: 'region';
      readonly label: string;
      readonly min?: number;
      readonly max?: number;
    }; // SketchRegionRef[]

export type ParamSchema = Readonly<Record<string, ParamSpec>>;

export interface ParamIssue {
  /** Key of the param, '' for the params object as a whole. */
  readonly param: string;
  readonly message: string;
}

export interface FeatureSchema<P = unknown> {
  /** Registry key, 'box'. */
  readonly type: string;
  readonly version: number;
  /** Display name, 'Box'. */
  readonly label: string;
  readonly params: ParamSchema;
  defaults(): P;
  /** Takes unknown: params come from the document unchecked. Usually validateAgainstSchema + own rules. */
  validate(params: unknown): readonly ParamIssue[];
  /** Required once version > 1, enforced by the registry. Must drop params the new version no longer has (Q028). */
  migrate?(fromVersion: number, raw: unknown): P;
}

export type FeatureSchemaRegistry = Registry<FeatureSchema>;

export function createFeatureSchemaRegistry(): FeatureSchemaRegistry {
  const registry = createRegistry<FeatureSchema>({ what: 'feature schema', keyOf: (s) => s.type });
  return {
    ...registry,
    register(schema) {
      assert(
        Number.isInteger(schema.version) && schema.version >= 1,
        `Feature schema '${schema.type}' has invalid version ${String(schema.version)}`,
      );
      assert(
        schema.version === 1 || schema.migrate !== undefined,
        `Feature schema '${schema.type}' version ${String(schema.version)} needs migrate()`,
      );
      registry.register(schema);
    },
  };
}

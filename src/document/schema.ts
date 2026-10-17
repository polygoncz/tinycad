import { assert, createRegistry } from '@/core';
import type { Registry, Vec3 } from '@/core';

// The data half of a feature type (ADR 0004): params, defaults, validation, migration.
// Geometry is computed by the builder of the feature on the server (server/src/features).

/**
 * Bounds of a numeric param, inclusive unless marked exclusive (Q050):
 * `{ min: 0, exclusiveMin: true }` means > 0. exclusiveMin/Max without min/max have no effect.
 */
interface Bounds {
  readonly min?: number;
  readonly max?: number;
  readonly exclusiveMin?: boolean;
  readonly exclusiveMax?: boolean;
}

/** Fields every kind of ParamSpec may have (M13, spec 03 "Podmíněné a seskupené parametry"). */
interface ParamCommon {
  /** Translation key of the dialog section heading; validation ignores it. */
  readonly group?: string;
  /**
   * Pure predicate over the UNCHECKED params, without exceptions; compare values, do not assume
   * types (`p => p.operation !== 'new'`). A hidden param is neither required nor checked.
   */
  readonly visibleWhen?: (params: Readonly<Record<string, unknown>>) => boolean;
}

// One ParamSpec drives three things: validation, the generated UI form (spec 11)
// and telling reference params apart for picking in the feature dialog.
// Every label (of a ParamSpec, an enum option and a FeatureSchema) is a translation key,
// 'box.width', never a text; the plugin brings the texts in its messages (ADR 0014).
// The kinds come in two unions: plain values and references (M20); a new kind goes into one of
// them, and a new reference kind then needs an entry in the tables of reference kinds.
type ValueParamVariant =
  | ({ readonly kind: 'length'; readonly label: string; readonly default: number } & Bounds)
  | ({ readonly kind: 'angle'; readonly label: string; readonly default: number } & Bounds)
  | ({
      readonly kind: 'number';
      readonly label: string;
      readonly default: number;
      readonly integer?: boolean;
    } & Bounds)
  | { readonly kind: 'boolean'; readonly label: string; readonly default: boolean }
  | {
      readonly kind: 'enum';
      readonly label: string;
      readonly default: string;
      readonly options: readonly { readonly value: string; readonly label: string }[];
    }
  | { readonly kind: 'point'; readonly label: string; readonly default: Vec3 }
  // Any JSON data without a form field; the schema's own validate checks the content (M12, sketch).
  | { readonly kind: 'data'; readonly label: string };

type RefParamVariant =
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
    } // SketchRegionRef[]
  | {
      readonly kind: 'planes';
      readonly label: string;
      readonly min?: number;
      readonly max?: number;
    } // PlaneRef[] (M12)
  // A single reference, not an array: AxisRef | SketchEntityRef, empty as null (M13, Revolve).
  | { readonly kind: 'axis'; readonly label: string };

export type ParamSpec = ParamCommon & (ValueParamVariant | RefParamVariant);

/**
 * The kinds of ParamSpec that hold references (M20): 'bodies' | 'topo' | 'region' | 'planes' |
 * 'axis'. The tables of reference kinds (document, interaction) have one entry per kind.
 */
export type RefParamKind = Extract<ParamSpec, RefParamVariant>['kind'];

/** A ParamSpec of a reference kind (M20). */
export type RefParamSpec = Extract<ParamSpec, { readonly kind: RefParamKind }>;

/** Whether the param applies to these params; true without a predicate (M13). */
export function isParamVisible(
  spec: ParamSpec,
  params: Readonly<Record<string, unknown>>,
): boolean {
  return spec.visibleWhen?.(params) ?? true;
}

/** The untyped schema of params: registries and readers that do not know the plugin (M20). */
export type ParamSchema = Readonly<Record<string, ParamSpec>>;

/**
 * The schema of params tied to their type P (M20): exactly one ParamSpec per key of P, optional
 * keys too, so a missing or an extra key is a type error. Without known keys (P = unknown, the
 * default of FeatureSchema) it is the untyped ParamSchema.
 */
export type ParamSchemaOf<P> = [keyof P] extends [never]
  ? ParamSchema
  : { readonly [K in keyof P]-?: ParamSpec };

export interface ParamIssue {
  /** Key of the param, '' for the params object as a whole. */
  readonly param: string;
  /** Translation key, 'param.atOrBelowMin' (ADR 0014); the codes of validateAgainstSchema are in spec 03. */
  readonly code: string;
  /** Values for the text, e.g. { min: 0 }. */
  readonly params?: Readonly<Record<string, string | number>>;
}

export interface FeatureSchema<P = unknown> {
  /** Registry key, 'box'. */
  readonly type: string;
  readonly version: number;
  /** Translation key of the display name, 'box.label' (ADR 0014). */
  readonly label: string;
  /** Tabler icon name, 'box' (Timeline, M10); the UI falls back to a generic icon. */
  readonly icon?: string;
  readonly params: ParamSchemaOf<P>;
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

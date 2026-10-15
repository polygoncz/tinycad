import type { RegistryReader } from '@/core';
import type { FeatureId, PartStudioData } from './model';
import { isRefParamSpec, rulesOf } from './ref-kinds';
import { ownerOf, readRefOf } from './refs';
import type { EntityRef } from './refs';
import { isParamVisible } from './schema';
import type { FeatureSchema } from './schema';

// References between features and the dependency graph that follows from them (spec 03,
// ADR 0015). Pure functions over the schema and the data; the rules for moving and
// deleting features build on them (M11).

/** A feature that refers to something not before it in the history. */
export interface OrderViolation {
  readonly feature: FeatureId;
  readonly dependsOn: FeatureId;
}

/**
 * The references in the params, in schema order and then array order. Takes only the
 * items that are a valid reference of the param's kinds; anything else is skipped, the
 * validation reports it. Hidden params are skipped (M13), so an old value of a hidden param
 * makes no dependency; an axis param gives 0 or 1 reference. Params that are not an object give [].
 */
export function referencesOf(schema: FeatureSchema, params: unknown): readonly EntityRef[] {
  if (!isRecord(params)) return Object.freeze([]);
  const refs: EntityRef[] = [];
  for (const [key, spec] of Object.entries(schema.params)) {
    if (!isRefParamSpec(spec) || !isParamVisible(spec, params)) continue;
    // What the param holds and where its items are: the table of reference kinds (M20, D5).
    const rules = rulesOf(spec);
    const value = Object.hasOwn(params, key) ? params[key] : undefined;
    for (const item of rules.items(value)) {
      const ref = readRefOf(rules.refKinds, item);
      if (ref !== undefined) refs.push(ref);
    }
  }
  return Object.freeze(refs);
}

/**
 * For every feature of the studio, in order: the features its references belong to,
 * without duplicates, in order of first occurrence. Leaves out features not in the
 * studio (regeneration reports the unresolved reference) and the feature itself, so a
 * reference to the origin geometry (owner ORIGIN, not a feature) is no dependency.
 * An unknown feature type has no schema and gives [].
 */
export function dependenciesOf(
  studio: PartStudioData,
  schemas: RegistryReader<FeatureSchema>,
): ReadonlyMap<FeatureId, readonly FeatureId[]> {
  const ids = new Set(studio.features.map((f) => f.id));
  const deps = new Map<FeatureId, readonly FeatureId[]>();
  for (const feature of studio.features) {
    const schema = schemas.find(feature.type);
    const owners = new Set<FeatureId>();
    if (schema !== undefined) {
      for (const ref of referencesOf(schema, feature.params)) {
        const owner = ownerOf(ref);
        if (owner !== feature.id && ids.has(owner)) owners.add(owner);
      }
    }
    // A Set keeps insertion order: the order of first occurrence.
    deps.set(feature.id, Object.freeze([...owners]));
  }
  return deps;
}

/** The features whose dependencies contain the id, in map order. */
export function dependentsOf(
  deps: ReadonlyMap<FeatureId, readonly FeatureId[]>,
  id: FeatureId,
): readonly FeatureId[] {
  const dependents: FeatureId[] = [];
  for (const [feature, dependsOn] of deps) {
    if (dependsOn.includes(id)) dependents.push(feature);
  }
  return Object.freeze(dependents);
}

/**
 * Pairs where the dependency sits at an index >= the feature's index: the feature refers
 * to something the state before it does not have yet. Empty = the order is valid.
 * Ordered by feature, then by dependency.
 */
export function orderViolations(
  studio: PartStudioData,
  deps: ReadonlyMap<FeatureId, readonly FeatureId[]>,
): readonly OrderViolation[] {
  const indexOf = new Map(studio.features.map((f, i) => [f.id, i]));
  const violations: OrderViolation[] = [];
  studio.features.forEach((feature, index) => {
    for (const dependsOn of deps.get(feature.id) ?? []) {
      const at = indexOf.get(dependsOn);
      if (at !== undefined && at >= index) {
        violations.push(Object.freeze({ feature: feature.id, dependsOn }));
      }
    }
  });
  return Object.freeze(violations);
}

function isRecord(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

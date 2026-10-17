// The schemas of the built-in feature types for the shared-case runners, as the client has them
// (N124): the descriptors of the golden file of the C++ core (N75) through featureSchemaOf. The core
// migrates the features before the client sees them, so a schema above version 1 gets a migrate
// that only fails (like createRemoteRegistries of app). The declarative rules come with the
// descriptors (M49); the codes of the rules that cannot be data are SERVER_ONLY_CODES.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromJson } from '@bufbuild/protobuf';
import type { JsonValue } from '@bufbuild/protobuf';
import { createFeatureSchemaRegistry } from '@/document';
import type { FeatureSchema, FeatureSchemaRegistry } from '@/document';
import { FeatureTypeDescriptorSchema } from '@/protocol';
import type { FeatureTypeDescriptor } from '@/protocol';
import { featureSchemaOf } from '@/remote/testing';

// Written by the C++ tests (N88, N95).
const GOLDEN = join(import.meta.dirname, '../../../golden/feature-types.json');

/**
 * The ParamIssue codes of the rules only the server checks (spec 03 "Pravidla jen na serveru",
 * N150): the sketch data by Sketch::parse. The TS runner of schema.validate drops them from
 * expected; the C++ runner checks them.
 */
export const SERVER_ONLY_CODES: readonly string[] = Object.freeze([
  'sketch.invalidEntity',
  'sketch.invalidConstraint',
]);

/** The codes of the declarative rules of the descriptors (FeatureTypeDescriptor.rules), in order. */
export function builtInRuleCodes(): readonly string[] {
  return goldenDescriptors().flatMap((d) => d.rules.map((rule) => rule.code));
}

/** The feature types the core describes, in its order. */
export function builtInFeatureTypes(): readonly string[] {
  return builtInSchemaList().map((s) => s.type);
}

/** A schema registry with the schemas of all built-in feature types of the core. */
export function builtInSchemas(): FeatureSchemaRegistry {
  const schemas = createFeatureSchemaRegistry();
  for (const schema of builtInSchemaList()) schemas.register(migratedByCore(schema));
  return schemas;
}

function builtInSchemaList(): readonly FeatureSchema[] {
  return goldenDescriptors().map(featureSchemaOf);
}

function goldenDescriptors(): readonly FeatureTypeDescriptor[] {
  // The file holds { feature_types: [ FeatureTypeDescriptor as protobuf JSON ] }.
  const json = JSON.parse(readFileSync(GOLDEN, 'utf8')) as { feature_types: JsonValue[] };
  return json.feature_types.map((d) => fromJson(FeatureTypeDescriptorSchema, d));
}

function migratedByCore(schema: FeatureSchema): FeatureSchema {
  if (schema.version === 1) return schema;
  return {
    ...schema,
    migrate(fromVersion: number): never {
      throw new Error(
        `Feature '${schema.type}' version ${String(fromVersion)}: only the core migrates features`,
      );
    },
  };
}

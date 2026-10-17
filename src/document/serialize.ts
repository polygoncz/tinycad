import { assert, err, ok } from '@/core';
import type { RegistryReader, Result } from '@/core';
import { createDocument } from './cad-document';
import type { DocumentReader, DocumentWriter } from './document';
import { isJsonObject } from './json';
import { BODY_MATERIALS, DEFAULT_BODY_MATERIAL, isBodyColor, isBodyMaterial } from './model';
import type {
  BodyId,
  BodyMeta,
  DocumentId,
  DocumentMeta,
  FeatureId,
  FeatureInstance,
  PartStudioData,
} from './model';
import { ORIGIN } from './origin';
import { parseBodyId } from './refs';
import type { FeatureSchema } from './schema';

export interface DocumentData {
  readonly meta: DocumentMeta;
  /** FeatureInstances are already plain JSON data. */
  readonly studio: PartStudioData;
}

export interface DocumentLoadIssue {
  /** Where in the data, 'studio.features[3].id'. */
  readonly path: string;
  readonly message: string;
}

export interface DocumentLoadError {
  readonly issues: readonly DocumentLoadIssue[];
}

/** What a migration needs of a feature: its type, the schema version of its params and the params. */
export interface FeatureData {
  readonly type: string;
  readonly typeVersion: number;
  readonly params: unknown;
}

/** No copy: the document data is immutable plain JSON, so it already is a consistent snapshot. */
export function toData(doc: DocumentReader): DocumentData {
  return Object.freeze({ meta: doc.meta, studio: doc.studio });
}

/**
 * Loads data from outside (since M47 only in tests; the core loads documents). Broken data is
 * an expected failure, so it is a Result, not an exception (Q026). Checks the shape, the
 * document invariants and migrates features to their current schema version. Feature params
 * are taken over by the document (and frozen), not copied. Unknown feature types are kept
 * unchanged.
 */
export function fromData(
  data: unknown,
  schemas: RegistryReader<FeatureSchema>,
): Result<DocumentWriter, DocumentLoadError> {
  const issues: DocumentLoadIssue[] = [];
  const at = (path: string, message: string) => {
    issues.push({ path, message });
  };

  if (!isRecord(data)) {
    at('', 'Document data must be an object');
    return err({ issues });
  }
  const meta = readMeta(data.meta, at);
  const studio = readStudio(data.studio, schemas, at);
  if (meta === undefined || studio === undefined || issues.length > 0) return err({ issues });
  return ok(createDocument({ meta, studio }));
}

type At = (path: string, message: string) => void;

function readMeta(raw: unknown, at: At): DocumentMeta | undefined {
  if (!isRecord(raw)) {
    at('meta', 'Must be an object');
    return undefined;
  }
  const { id, name, createdAt } = raw;
  if (!isNonEmptyString(id)) at('meta.id', 'Must be a non-empty string');
  if (typeof name !== 'string') at('meta.name', 'Must be a string');
  if (!isFiniteNumber(createdAt)) at('meta.createdAt', 'Must be a number');
  if (!isNonEmptyString(id) || typeof name !== 'string' || !isFiniteNumber(createdAt))
    return undefined;
  // The single trusted place where a loaded id becomes branded.
  return { id: id as DocumentId, name, createdAt };
}

function readStudio(
  raw: unknown,
  schemas: RegistryReader<FeatureSchema>,
  at: At,
): PartStudioData | undefined {
  if (!isRecord(raw)) {
    at('studio', 'Must be an object');
    return undefined;
  }
  if (!Array.isArray(raw.features)) {
    at('studio.features', 'Must be an array');
    return undefined;
  }
  const features: FeatureInstance[] = [];
  const seen = new Set<string>();
  raw.features.forEach((rawFeature: unknown, i) => {
    const path = `studio.features[${String(i)}]`;
    const f = readFeature(rawFeature, path, schemas, at);
    if (f === undefined) return;
    if (seen.has(f.id)) at(`${path}.id`, `Duplicate feature id '${f.id}'`);
    seen.add(f.id);
    features.push(f);
  });
  const { rollbackIndex } = raw;
  const length = raw.features.length;
  if (!isWholeNumber(rollbackIndex) || rollbackIndex < 0 || rollbackIndex > length) {
    at('studio.rollbackIndex', `Must be a whole number in 0..${String(length)}`);
    return undefined;
  }
  const bodies = readBodies(raw.bodies, at);
  return bodies === undefined ? { features, rollbackIndex } : { features, rollbackIndex, bodies };
}

/**
 * Body metadata (spec 03, M11) in canonical form: absent or empty -> undefined, `hidden: false`
 * and entries left empty are dropped. Keys must be body ids; values have only `name` (non-empty
 * string), `hidden` (boolean) and `color` (isBodyColor, M15), any other field is an issue
 * (strict as params, Q028).
 */
function readBodies(raw: unknown, at: At): PartStudioData['bodies'] {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    at('studio.bodies', 'Must be an object');
    return undefined;
  }
  const bodies: Record<BodyId, BodyMeta> = {};
  for (const [key, value] of Object.entries(raw)) {
    const path = `studio.bodies['${key}']`;
    const body = parseBodyId(key);
    if (body === undefined) {
      at(path, "Must be a body id '<feature>/body' or '<feature>/body:<n>'");
      continue;
    }
    const meta = readBodyMeta(value, path, at);
    if (meta !== undefined) bodies[body] = meta;
  }
  return Object.keys(bodies).length === 0 ? undefined : bodies;
}

/** The canonical metadata of one body, undefined when broken (reported) or empty. */
function readBodyMeta(raw: unknown, path: string, at: At): BodyMeta | undefined {
  if (!isRecord(raw)) {
    at(path, 'Must be an object');
    return undefined;
  }
  let valid = true;
  for (const key of Object.keys(raw)) {
    if (key !== 'name' && key !== 'hidden' && key !== 'color' && key !== 'material') {
      at(`${path}.${key}`, 'Unexpected property');
      valid = false;
    }
  }
  const { name, hidden, color, material } = raw;
  if (name !== undefined && !isNonEmptyString(name)) {
    at(`${path}.name`, 'Must be a non-empty string');
    valid = false;
  }
  if (hidden !== undefined && typeof hidden !== 'boolean') {
    at(`${path}.hidden`, 'Must be true or false');
    valid = false;
  }
  if (color !== undefined && !isBodyColor(color)) {
    at(`${path}.color`, "Must be a color '#rrggbb' in lower case");
    valid = false;
  }
  if (material !== undefined && !isBodyMaterial(material)) {
    at(`${path}.material`, `Must be one of ${BODY_MATERIALS.join(', ')}`);
    valid = false;
  }
  if (!valid) return undefined;
  const meta: BodyMeta = {
    ...(isNonEmptyString(name) ? { name } : {}),
    ...(hidden === true ? { hidden } : {}),
    ...(isBodyColor(color) ? { color } : {}),
    ...(isBodyMaterial(material) && material !== DEFAULT_BODY_MATERIAL ? { material } : {}),
  };
  return Object.keys(meta).length === 0 ? undefined : meta;
}

function readFeature(
  raw: unknown,
  path: string,
  schemas: RegistryReader<FeatureSchema>,
  at: At,
): FeatureInstance | undefined {
  if (!isRecord(raw)) {
    at(path, 'Must be an object');
    return undefined;
  }
  const { id, type, typeVersion, name, params, suppressed } = raw;
  // Report every bad field first, then narrow all of them at once.
  // The owner of an artifact id is the text before the first '/', so a feature id has none, and
  // 'origin' owns the origin geometry (spec 03).
  if (!isFeatureIdText(id))
    at(`${path}.id`, "Must be a non-empty string without '/', other than 'origin'");
  if (!isNonEmptyString(type)) at(`${path}.type`, 'Must be a non-empty string');
  if (!isWholeNumber(typeVersion) || typeVersion < 1)
    at(`${path}.typeVersion`, 'Must be a whole number >= 1');
  if (typeof name !== 'string') at(`${path}.name`, 'Must be a string');
  if (!isJsonObject(params)) at(`${path}.params`, 'Must be a plain JSON object');
  if (typeof suppressed !== 'boolean') at(`${path}.suppressed`, 'Must be true or false');
  if (
    !isFeatureIdText(id) ||
    !isNonEmptyString(type) ||
    !isWholeNumber(typeVersion) ||
    typeVersion < 1 ||
    typeof name !== 'string' ||
    !isJsonObject(params) ||
    typeof suppressed !== 'boolean'
  )
    return undefined;

  const feature: FeatureInstance = {
    id: id as FeatureId,
    type,
    typeVersion,
    name,
    params,
    suppressed,
  };
  return migrate(feature, path, schemas, at);
}

/** Paths of the migration issues are made relative to the document. */
function migrate(
  f: FeatureInstance,
  path: string,
  schemas: RegistryReader<FeatureSchema>,
  at: At,
): FeatureInstance | undefined {
  const migrated = migrateFeatureData(schemas, f);
  if (!migrated.ok) {
    at(`${path}.${migrated.error.path}`, migrated.error.message);
    return undefined;
  }
  if (migrated.value === f) return f;
  const { typeVersion, params } = migrated.value;
  // migrateFeatureData returns a migrated value only with params that are a plain JSON object.
  return { ...f, typeVersion, params: params as FeatureInstance['params'] };
}

/**
 * Params on the current version of the schema of their type (spec 03, Q035). Shared by fromData
 * and the operation handlers, which migrate the feature data of old log entries when applied.
 * Unknown type or the current version: unchanged, the same object. Old data the migration cannot
 * handle is broken data, not a programmer error: a newer version is an issue at 'typeVersion',
 * a throwing migrate or a result that is not a plain JSON object an issue at 'params'.
 */
export function migrateFeatureData(
  schemas: RegistryReader<FeatureSchema>,
  data: FeatureData,
): Result<FeatureData, DocumentLoadIssue> {
  const schema = schemas.find(data.type);
  // Unknown type: kept as is, regeneration reports it.
  if (schema === undefined || data.typeVersion === schema.version) return ok(data);
  const from = String(data.typeVersion);
  if (data.typeVersion > schema.version) {
    // Should not happen: the app always runs the latest version (Q025).
    return err({
      path: 'typeVersion',
      message: `Version ${from} is newer than the known ${String(schema.version)}`,
    });
  }
  // The registry rejects schemas with version > 1 and no migrate.
  assert(schema.migrate !== undefined, `Feature schema '${schema.type}' has no migrate()`);
  let params: unknown;
  try {
    params = schema.migrate(data.typeVersion, data.params);
  } catch (e) {
    return err({ path: 'params', message: `Migration from version ${from} failed: ${String(e)}` });
  }
  if (!isJsonObject(params)) {
    return err({
      path: 'params',
      message: `Migration from version ${from} did not return a plain JSON object`,
    });
  }
  return ok({ ...data, typeVersion: schema.version, params });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isFeatureIdText(v: unknown): v is string {
  return isNonEmptyString(v) && !v.includes('/') && v !== ORIGIN;
}

function isWholeNumber(v: unknown): v is number {
  return Number.isInteger(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

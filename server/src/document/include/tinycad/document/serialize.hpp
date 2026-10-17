#pragma once

// Plain JSON and loading/saving documents (spec 03 "Serializace", src/document/json.ts and
// serialize.ts). The JSON is DocumentData of TS ({ meta, studio }), i.e. `.tinycad.json` and the
// snapshots of storage (M41) and the shared cases `document.load` (spec 13).

#include <memory>
#include <string>
#include <vector>

#include "tinycad/core/result.hpp"
#include "tinycad/document/document.hpp"
#include "tinycad/document/schema.hpp"

namespace tinycad::document {

/**
 * Plain JSON (isJsonValue): null, string, boolean, finite number, array or object of plain JSON.
 * nlohmann can hold NaN/±∞ in a float; those are not plain JSON. Linear, no allocations.
 */
bool isJsonValue(const Json& v);
/** An object whose values are all plain JSON (isJsonObject). */
bool isJsonObject(const Json& v);

/** A snapshot of a document: meta and the shared studio (no copy). */
struct DocumentData {
  DocumentMeta meta;
  StudioPtr studio;
};

struct DocumentLoadIssue {
  /** Where in the data, "studio.features[3].id" – the same paths as TS (the shared cases compare them). */
  std::string path;
  /** Technical text; never compared (spec 13). */
  std::string message;
};

struct DocumentLoadError {
  std::vector<DocumentLoadIssue> issues;
};

/** What a migration needs of a feature. */
struct FeatureData {
  std::string type;
  int typeVersion = 1;
  Json params;
};

/** No copy: the studio is immutable and shared. */
DocumentData toData(const DocumentReader& doc);

/**
 * JSON of the TS DocumentData in canonical form: `bodies` only when not empty, body metadata
 * fields only when set, numbers via core::numberJson.
 */
Json documentDataJson(const DocumentData& data);

/**
 * The JSON of one feature (FeatureInstance of TS): the features of documentDataJson, the feature
 * of a feature.add operation. Without params (null) the params are {}.
 */
Json featureJson(const FeatureInstance& f);

/**
 * One feature from outside, as fromData reads each of `studio.features`: checks the shape (id
 * without '/' and other than 'origin', type, typeVersion a whole number >= 1 that fits an int,
 * name, params a plain JSON object, suppressed) and migrates known types to the current schema
 * version (migrateFeatureData). Every problem, paths relative to the feature ('id', 'params').
 */
core::Result<FeaturePtr, DocumentLoadError> readFeature(const Json& raw,
                                                        const FeatureSchemaRegistryReader& schemas);

/**
 * Loads data from outside (persistence, import): checks the shape and the invariants, reports
 * EVERY problem with its path, migrates known features to the current schema version, keeps
 * unknown feature types unchanged (fromData in TS).
 */
core::Result<std::unique_ptr<Document>, DocumentLoadError> fromData(
    const Json& data, const FeatureSchemaRegistryReader& schemas);

/**
 * Params on the current version of the schema of their type (migrateFeatureData, Q035); shared by
 * fromData and the op handlers (old log entries). Unknown type or the current version: unchanged.
 * A newer version → issue at "typeVersion"; a failing migrate or a result that is not a plain
 * JSON object → issue at "params" (paths relative to the feature).
 */
core::Result<FeatureData, DocumentLoadIssue> migrateFeatureData(
    const FeatureSchemaRegistryReader& schemas, const FeatureData& data);

}  // namespace tinycad::document

#pragma once

// FeatureTypeDescriptor from the C++ schemas (spec 14 "Schéma featur", Q098, Q105): the
// declarative half of every FeatureSchema of the server goes to the client in
// OpenSessionResponse.feature_types. validate, migrate and the builder stay on the server; the
// client uses bounds only for the comfort of the dialog.
//
// Built once at server start from the one schema registry (registerBuiltInSchemas, M40/M44.1) and
// shared read-only by every session. Depends only on tinycad_features (schemas), not on regen or
// OCCT (decision N44).

#include <vector>

#include "tinycad/document/schema.hpp"
#include "tinycad/v1/schema.pb.h"

namespace tinycad::session {

/**
 * One schema → its descriptor: type, version, label and icon (keys, no texts), params in the
 * order of the schema with key, label, group, visible_when and the oneof spec by ParamKind
 * (Enum → `enumeration`, the option values and label keys in order; Length/Angle/Number →
 * NumberParam with optional min/max and the exclusive flags; Point → Vec3 default; Data → empty
 * DataParam; Bodies/Region/Planes → RefListParam min/max; Topo → TopoParam with the entity;
 * Axis → AxisParam), `defaults` = schema.defaults() as a Struct.
 * VisibleWhen: { param, equals_any | equals_none | less_than } exactly as the C++ data of N20.
 */
void describeFeatureType(const document::FeatureSchema& schema,
                         tinycad::v1::FeatureTypeDescriptor* out);

/** Every schema of the registry in registration order (the order of the toolbar). */
std::vector<tinycad::v1::FeatureTypeDescriptor> describeFeatureTypes(
    const document::FeatureSchemaRegistryReader& schemas);

}  // namespace tinycad::session

#pragma once

// References from feature params to results of other features (spec 03 "Reference na jiné
// entity", src/document/refs.ts). Always names, never indices or kernel handles (ADR 0007).
// Artifact ids are '<owner>/<kind>[:<n>]' (ADR 0015): the owner can always be read back.

#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "tinycad/document/model.hpp"

namespace tinycad::document {

struct TopoNameTag;
struct PlaneIdTag;
struct AxisIdTag;
struct SketchIdTag;

/** Persistent topological name (spec 08). */
using TopoName = core::StrongId<TopoNameTag>;
/** '<owner>/plane:<name>', name [a-z0-9]+ (M12). */
using PlaneId = core::StrongId<PlaneIdTag>;
/** '<owner>/axis:<name>', name [a-z0-9]+ (M13). */
using AxisId = core::StrongId<AxisIdTag>;
/** '<featureId>/sketch' (M12). */
using SketchId = core::StrongId<SketchIdTag>;

/** The JSON `kind` of a reference. */
enum class RefKind { Body, Topo, Region, Plane, Axis, SketchEntity };
/** "body", "topo", "region", "plane", "axis", "sketchEntity". */
std::string_view refKindName(RefKind kind);

/**
 * Any reference (BodyRef | TopoRef | SketchRegionRef | PlaneRef | AxisRef | SketchEntityRef in TS).
 * KISS (N6): one plain struct with `kind`; only the fields of the kind are set:
 *
 *   Body          { kind: "body", body }
 *   Topo          { kind: "topo", body, name }
 *   Region        { kind: "region", sketch, region }  – a closed region of a sketch (spec 12)
 *   Plane         { kind: "plane", plane }
 *   Axis          { kind: "axis", axis }
 *   SketchEntity  { kind: "sketchEntity", sketch, entity } – e.g. a line as the Revolve axis
 */
struct EntityRef {
  RefKind kind = RefKind::Body;
  BodyId body;           // Body, Topo
  TopoName name;         // Topo
  FeatureId sketch;      // Region, SketchEntity
  std::string region;    // Region
  PlaneId plane;         // Plane
  AxisId axis;           // Axis
  std::string entity;    // SketchEntity

  static EntityRef toBody(BodyId body);
  static EntityRef toTopo(BodyId body, TopoName name);
  static EntityRef toRegion(FeatureId sketch, std::string region);
  static EntityRef toPlane(PlaneId plane);
  static EntityRef toAxis(AxisId axis);
  static EntityRef toSketchEntity(FeatureId sketch, std::string entity);

  friend bool operator==(const EntityRef&, const EntityRef&) = default;
};

/** '<origin>/body' or '<origin>/body:<n>' (n >= 1). Throws AssertionError on an invalid origin or n. */
BodyId bodyId(const FeatureId& origin, std::optional<int> n = std::nullopt);
/** '<owner>/sketch'. */
SketchId sketchId(const FeatureId& owner);

std::optional<BodyId> parseBodyId(std::string_view text);
std::optional<PlaneId> parsePlaneId(std::string_view text);
std::optional<AxisId> parseAxisId(std::string_view text);
std::optional<SketchId> parseSketchId(std::string_view text);

/** The text before the first '/'; an id without '/' throws AssertionError. */
FeatureId ownerOfArtifact(std::string_view artifactId);
FeatureId originOfBody(const BodyId& body);
/** The feature whose result the reference points to. */
FeatureId ownerOf(const EntityRef& ref);

/**
 * One reference of the given kind from unchecked JSON: just the fields of the type, or nullopt
 * when the shape is wrong (readRef in TS; shared by validateAgainstSchema and referencesOf).
 */
std::optional<EntityRef> readRef(RefKind kind, const Json& raw);
/** The first of the kinds that reads (readRefOf). */
std::optional<EntityRef> readRefOf(const std::vector<RefKind>& kinds, const Json& raw);

/** JSON of the TS shape. */
Json refJson(const EntityRef& ref);

}  // namespace tinycad::document

#pragma once

// Values that cross the GeometryKernel port (spec 06, src/kernel/types.ts): identity (handle) and
// plain data. Nothing here refers to OCCT.

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include "tinycad/core/math.hpp"

namespace tinycad::kernel {

using core::Vec3;

/**
 * Opaque id of a shape living inside the kernel (decision N11). Positive, never reused within one
 * kernel instance (a growing counter), so a released handle always fails with UnknownHandle.
 */
enum class ShapeHandle : std::uint64_t {};

struct BoundingBox {
  Vec3 min{};
  Vec3 max{};
};

struct MeshQuality {
  double linearDeflection = 0;
  double angularDeflection = 0;
};

enum class SubShapeType { Face, Edge, Vertex };

/**
 * Index of a sub-shape = position in TopExp::MapShapes(shape, TopAbs_FACE/EDGE/VERTEX), from 0
 * (OCCT counts from 1, the implementation subtracts). Valid only for one handle.
 */
struct SubShapeIndex {
  SubShapeType type = SubShapeType::Face;
  int index = 0;
  friend bool operator==(const SubShapeIndex&, const SubShapeIndex&) = default;
};

struct HistoryLink {
  /** Index of the input shape in the call (boolean: [...targets, ...tools]). */
  int input = 0;
  SubShapeIndex from;
  /** Ascending, without duplicates. */
  std::vector<SubShapeIndex> to;
};

struct DeletedSubShape {
  int input = 0;
  SubShapeIndex sub;
};

/** Spec 06 "Stav po M14": modified/deleted for FACES of the inputs, generated = faces of the output. */
struct ShapeHistory {
  std::vector<HistoryLink> modified;
  std::vector<HistoryLink> generated;
  std::vector<DeletedSubShape> deleted;
};

/** Named parts, e.g. { "face:top": [5] }; keys without a feature id (ADR 0018). */
using Roles = std::map<std::string, std::vector<SubShapeIndex>>;

struct ShapeResult {
  ShapeHandle shape{};
  /** Operations with input shapes (transform, boolean, extrude, revolve, fillet, chamfer). */
  std::optional<ShapeHistory> history;
  /** Primitives, makeFace, extrude, revolve (spec 06 "Stav po M14"). */
  std::optional<Roles> roles;
};

/**
 * Flat arrays like MeshData in TS (spec 06 "Síť pro vykreslení"; on the wire `Mesh` of spec 14,
 * little-endian). validateMeshData (mesh.hpp) checks the invariants.
 */
struct MeshData {
  /** xyz */
  std::vector<float> positions;
  /** xyz, unit length, one per vertex */
  std::vector<float> normals;
  /** Triangles, counter-clockwise when viewed from outside. */
  std::vector<std::uint32_t> indices;
  /** Triples [faceIndex, firstTriangle, triangleCount], sorted by firstTriangle. */
  std::vector<std::uint32_t> faceRanges;
  /** Edge polylines: points one after another. */
  std::vector<float> edgePositions;
  /** Triples [edgeIndex, firstPoint, pointCount], sorted by firstPoint. */
  std::vector<std::uint32_t> edgeRanges;
};

enum class SurfaceType { Plane, Cylinder, Cone, Sphere, Torus, Other };

/** "plane", "cylinder", "cone", "sphere", "torus", "other". */
const char* surfaceTypeName(SurfaceType type);

/** A point on a planar face and the unit normal out of the solid (face orientation applied). */
struct FacePlane {
  Vec3 origin{};
  Vec3 normal{};
};

struct FaceInfo {
  SurfaceType surface = SurfaceType::Other;
  /** Present exactly when surface is Plane. */
  std::optional<FacePlane> plane;
};

struct EdgeInfo {
  /** Adjacent faces, ascending without duplicates (a seam: one). */
  std::vector<int> faces;
  /** End vertices, ascending without duplicates (closed edge: one, none without a vertex). */
  std::vector<int> vertices;
  /** Point at half the parameter range; only to tell edges apart (#k, spec 08). */
  Vec3 midpoint{};
};

struct TopologySummary {
  /** Index = SubShapeIndex of the face. */
  std::vector<FaceInfo> faces;
  /** Index = SubShapeIndex of the edge. */
  std::vector<EdgeInfo> edges;
  int vertexCount = 0;
};

}  // namespace tinycad::kernel

#pragma once

// The operations of OcctKernel, one source file per area (decision N30). Each takes the shape
// table, checks its input, builds with OCCT and stores a result only when it has succeeded;
// an expected failure is a KernelFailure (guarded.hpp), turned into the KernelResult by
// OcctKernel. Internal to tinycad_kernel.

#include <TopoDS_Shape.hxx>

#include <span>
#include <string>

#include "shape_table.hpp"
#include "tinycad/kernel/kernel.hpp"

namespace tinycad::kernel::detail {

// primitives.cpp
ShapeResult makeBoxShape(ShapeTable& shapes, const BoxInput& p);
ShapeResult makeCylinderShape(ShapeTable& shapes, const CylinderInput& p);

// transform.cpp
ShapeResult transformShape(ShapeTable& shapes, ShapeHandle shape, const core::Mat4& m);

// boolean.cpp
ShapeResult booleanShape(ShapeTable& shapes, BooleanOp op, std::span<const ShapeHandle> targets,
                         std::span<const ShapeHandle> tools);

// face.cpp
ShapeResult makeFaceShape(ShapeTable& shapes, const FaceInput& p);

// sweep.cpp
ShapeResult extrudeShape(ShapeTable& shapes, ShapeHandle profile, const Vec3& direction,
                         double distance);
ShapeResult revolveShape(ShapeTable& shapes, ShapeHandle profile, const Axis& axis, double angle);

// dressup.cpp
enum class Dressup { Fillet, Chamfer };
ShapeResult dressupShape(ShapeTable& shapes, Dressup kind, ShapeHandle shape,
                         std::span<const int> edges, double size);

// query.cpp
BoundingBox boundingBoxOf(const ShapeEntry& entry);
/** Whether the shape contains at least one solid. */
bool hasSolid(const TopoDS_Shape& shape);
/** BRepCheck_Analyzer of the shape (geometry checked, no extra tolerance checks). */
bool isValidShape(const TopoDS_Shape& shape);
/** Every component finite. */
bool isFinite(const Vec3& v);
/** Euclidean length. */
double lengthOf(const Vec3& v);

// topology.cpp
TopologySummary topologyOf(const ShapeEntry& entry);
/** Surface type of a face; for a plane its point and the normal out of the solid. */
FaceInfo faceInfoOf(const TopoDS_Shape& face);

// tessellate.cpp
MeshData tessellateEntry(const ShapeEntry& entry, const MeshQuality& q);

// step.cpp
std::string exportStepOf(const ShapeTable& shapes, std::span<const ShapeHandle> handles);

}  // namespace tinycad::kernel::detail

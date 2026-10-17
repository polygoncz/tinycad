#pragma once

// The part of the TS wrapper GcsWrapper of @salusoft89/planegcs 1.3.0 (sketch/gcs_wrapper.ts and
// sketch/sketch_index.ts) the adapter uses, ported to C++ over the vendored GcsSystem. The order
// of the p-params, the tags of the constraints and the defaults (DogLeg, the System defaults) are
// those of the wrapper, so the native solve repeats the WASM one. One instance = one GcsSystem
// for one solve; the destructor releases it (RAII, destroy_gcs_module in TS).

#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include "gcs_system.h"
#include "primitives.hpp"

namespace tinycad::solver_planegcs {

/** SolveStatus of planegcs. */
enum class GcsStatus { Success = 0, Converged = 1, Failed = 2, SuccessfulSolutionInvalid = 3 };

class GcsWrapper {
 public:
  GcsWrapper();
  ~GcsWrapper();
  GcsWrapper(const GcsWrapper&) = delete;
  GcsWrapper& operator=(const GcsWrapper&) = delete;

  /** A free or fixed p-param addressed by name (push_sketch_param). */
  void pushSketchParam(const std::string& name, double value, bool fixed);
  /** One geometry or constraint (push_primitive); throws for what planegcs cannot take. */
  void pushPrimitive(const Primitive& primitive);

  /** solve() of the wrapper: DogLeg. */
  GcsStatus solve();
  /** Writes the solution into the p-params (apply_solution). */
  void applySolution();
  [[nodiscard]] int dof();
  /** The ids of the conflicting / redundant constraints by tag; nullopt for an unknown tag. */
  [[nodiscard]] std::vector<std::optional<std::string>> conflicting();
  [[nodiscard]] std::vector<std::optional<std::string>> redundant();

  [[nodiscard]] std::optional<double> sketchParamValue(const std::string& name);
  /** The coordinates of a point primitive (get_sketch_point after apply_solution). */
  [[nodiscard]] core::Vec2 point(const std::string& id);
  /** The radius of a circle primitive (get_sketch_circle after apply_solution). */
  [[nodiscard]] double circleRadius(const std::string& id);

 private:
  /** A geometry of planegcs made from a primitive for one constraint (sketch_primitive_to_gcs). */
  struct Geometry {
    PrimitiveType type = PrimitiveType::Point;
    GCS::Point point;
    GCS::Line line;
    GCS::Circle circle;
    GCS::Arc arc;
    GCS::BSpline* bspline = nullptr;

    GCS::Point& asPoint();
    GCS::Line& asLine();
    GCS::Circle& asCircle();
    GCS::Arc& asArc();
    GCS::BSpline& asBSpline();
    GCS::Curve& asCurve();
  };

  int pushParams(const std::string& id, const std::vector<double>& values, bool fixed);
  void pushPoint(const Primitive& p);
  void pushConstraint(const Primitive& c);
  [[nodiscard]] Geometry makeGeometry(const std::string& id);
  [[nodiscard]] int paramAddress(const Primitive& c, const ParamValue& value);
  [[nodiscard]] const Primitive& primitive(const std::string& id) const;
  [[nodiscard]] const Primitive& sketchPoint(const std::string& id) const;
  [[nodiscard]] int address(const std::string& id) const;
  [[nodiscard]] std::vector<std::optional<std::string>> idsOfTags(const std::vector<int>& tags) const;

  // Declared before the system: a point_on_bspline constraint keeps a reference to its BSpline,
  // so the splines must outlive the constraints of the system (destroyed in reverse order).
  std::unordered_map<std::string, std::unique_ptr<GCS::BSpline>> bsplines_;
  planegcs::GcsSystem gcs_;
  /** id → index of its first p-param (p_param_index). */
  std::unordered_map<std::string, int> paramIndex_;
  /** sketch param name → index in the p-params. */
  std::unordered_map<std::string, int> sketchParamIndex_;
  /** The pushed primitives by id and their ids in push order (SketchIndex). */
  std::unordered_map<std::string, Primitive> index_;
  std::vector<std::string> primitiveIds_;
};

}  // namespace tinycad::solver_planegcs

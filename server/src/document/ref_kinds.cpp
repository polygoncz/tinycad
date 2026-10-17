#include "ref_kinds.hpp"

#include <cstddef>
#include <set>
#include <string>

#include "tinycad/core/result.hpp"

namespace tinycad::document {

namespace {

ParamProblem problem(std::string code, Json params = nullptr) {
  return ParamProblem{std::move(code), std::move(params)};
}

/**
 * A single reference, always required (M13): null is too few, a valid reference of the kinds
 * passes, anything else (an array too) is an invalid reference without an index.
 */
std::optional<ParamProblem> checkSingle(const Json& value, const std::vector<RefKind>& kinds) {
  if (value.is_null()) return problem("param.tooFewRefs", {{"min", 1}});
  if (!readRefOf(kinds, value)) return problem("param.invalidRef");
  return std::nullopt;
}

/** An array of references: invalid ones first, then duplicates, then the counts. */
std::optional<ParamProblem> checkList(const Json& value, const ParamSpec& spec,
                                      const std::vector<RefKind>& kinds) {
  if (!value.is_array()) return problem("param.wrongType");
  std::vector<std::vector<std::string>> keys;
  for (std::size_t index = 0; index < value.size(); ++index) {
    const auto ref = readRefOf(kinds, value[index]);
    if (!ref) return problem("param.invalidRef", {{"index", index}});
    keys.push_back(refKey(*ref));
  }
  std::set<std::vector<std::string>> seen;
  for (std::size_t index = 0; index < keys.size(); ++index) {
    if (!seen.insert(keys[index]).second) {
      return problem("param.duplicateRef", {{"index", index}});
    }
  }
  const auto count = static_cast<double>(value.size());
  if (spec.min && count < *spec.min) {
    return problem("param.tooFewRefs", {{"min", core::numberJson(*spec.min)}});
  }
  if (spec.max && count > *spec.max) {
    return problem("param.tooManyRefs", {{"max", core::numberJson(*spec.max)}});
  }
  return std::nullopt;
}

}  // namespace

// Extra fields of the raw data are ignored: readRef keeps only the fields of the key.
std::vector<std::string> refKey(const EntityRef& ref) {
  switch (ref.kind) {
    case RefKind::Body: return {"body", ref.body.str()};
    case RefKind::Topo: return {"topo", ref.body.str(), ref.name.str()};
    case RefKind::Region: return {"region", ref.sketch.str(), ref.region};
    case RefKind::Plane: return {"plane", ref.plane.str()};
    case RefKind::Axis: return {"axis", ref.axis.str()};
    case RefKind::SketchEntity: return {"sketchEntity", ref.sketch.str(), ref.entity};
  }
  return {};
}

std::vector<std::string> refKeyOf(const ParamSpec& spec, const Json& item) {
  const auto ref = readRefOf(refKindsOf(spec.kind), item);
  if (!ref) return {};
  return refKey(*ref);
}

const std::vector<RefKind>& refKindsOf(ParamKind kind) {
  static const std::vector<RefKind> body = {RefKind::Body};
  static const std::vector<RefKind> topo = {RefKind::Topo};
  static const std::vector<RefKind> region = {RefKind::Region};
  // A plane of the history, or a planar face of a body to sketch on (M14).
  static const std::vector<RefKind> planes = {RefKind::Plane, RefKind::Topo};
  // An origin axis or a line of a sketch (M13).
  static const std::vector<RefKind> axis = {RefKind::Axis, RefKind::SketchEntity};
  static const std::vector<RefKind> none;
  switch (kind) {
    case ParamKind::Bodies: return body;
    case ParamKind::Topo: return topo;
    case ParamKind::Region: return region;
    case ParamKind::Planes: return planes;
    case ParamKind::Axis: return axis;
    default: return none;
  }
}

std::optional<ParamProblem> checkReferenceParam(const ParamSpec& spec, const Json& value) {
  TINYCAD_ASSERT(spec.isReference(), "checkReferenceParam: not a reference param");
  const auto& kinds = refKindsOf(spec.kind);
  if (spec.kind == ParamKind::Axis) return checkSingle(value, kinds);
  return checkList(value, spec, kinds);
}

}  // namespace tinycad::document

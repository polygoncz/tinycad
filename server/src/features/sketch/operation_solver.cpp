// SketchOperationSolver (sketch_solve.hpp, decision N47, Q103): the server solution of every
// sketch an operation writes, before the operation enters the dispatcher.

#include <set>
#include <string>
#include <utility>

#include "tinycad/core/result.hpp"
#include "tinycad/features/sketch_solve.hpp"
#include "tinycad/sketch/model.hpp"
#include "tinycad/sketch/sketch.hpp"

namespace tinycad::features {

using core::Json;

namespace {

const std::string kSketchType(sketch::SKETCH_FEATURE_TYPE);
const std::string kEntities(sketch::SKETCH_PARAM_ENTITIES);
const std::string kConstraints(sketch::SKETCH_PARAM_CONSTRAINTS);

/** The string field `key` of an object, "" when there is none. */
std::string stringField(const Json& object, const char* key) {
  if (!object.is_object()) return "";
  const auto it = object.find(key);
  return it != object.end() && it->is_string() ? it->get<std::string>() : "";
}

std::string statusText(const sketch::SolveResult& result) {
  if (result.status == sketch::SolveStatus::Failed) return "the solver failed";
  std::string text = "conflicting constraints";
  for (std::size_t i = 0; i < result.conflicting.size(); ++i) {
    text += (i == 0 ? ": " : ", ") + result.conflicting[i].str();
  }
  return text;
}

/**
 * One walk over one operation: solves the sketches it writes in order and remembers the sketch
 * features added by earlier feature.add operations of the same batch.
 */
class OperationWalk {
 public:
  OperationWalk(sketch::ConstraintSolver& solver, const document::DocumentReader& doc)
      : solver_(solver), doc_(doc) {}

  core::Result<Json, SketchNotSolved> operation(const Json& op) {
    const std::string type = stringField(op, "type");
    if (type == "batch") return batch(op);
    if (type == "feature.add") return featureAdd(op);
    if (type == "feature.setParams") return setParams(op);
    return op;
  }

 private:
  core::Result<Json, SketchNotSolved> batch(const Json& op) {
    const auto ops = op.find("ops");
    if (ops == op.end() || !ops->is_array()) return op;
    Json out = op;
    for (std::size_t i = 0; i < ops->size(); ++i) {
      auto solved = operation((*ops)[i]);
      if (!solved) return core::fail(std::move(solved.error()));
      out["ops"][i] = std::move(*solved);
    }
    return out;
  }

  core::Result<Json, SketchNotSolved> featureAdd(const Json& op) {
    const auto feature = op.find("feature");
    if (feature == op.end() || stringField(*feature, "type") != kSketchType) return op;
    const std::string id = stringField(*feature, "id");
    addedSketches_.insert(id);
    const auto params = feature->find("params");
    if (params == feature->end()) return op;
    auto solved = sketchParams(*params, id);
    if (!solved) return core::fail(std::move(solved.error()));
    Json out = op;
    out["feature"]["params"] = std::move(*solved);
    return out;
  }

  core::Result<Json, SketchNotSolved> setParams(const Json& op) {
    const std::string id = stringField(op, "featureId");
    if (!isSketch(id)) return op;
    const auto params = op.find("params");
    if (params == op.end()) return op;
    auto solved = sketchParams(*params, id);
    if (!solved) return core::fail(std::move(solved.error()));
    Json out = op;
    out["params"] = std::move(*solved);
    return out;
  }

  /** A sketch added earlier in this operation, or a feature of type sketch in the document. */
  [[nodiscard]] bool isSketch(const std::string& id) const {
    if (id.empty()) return false;
    if (addedSketches_.contains(id)) return true;
    const auto feature = doc_.feature(document::FeatureId(id));
    return feature != nullptr && feature->type == kSketchType;
  }

  /**
   * The params with the entities of the server solution. Params that do not parse as a sketch
   * stay as they are (the validation of the operation or the red feature decides).
   */
  core::Result<Json, SketchNotSolved> sketchParams(const Json& params, const std::string& id) {
    if (!params.is_object() || !params.contains(kEntities) || !params.contains(kConstraints)) {
      return params;
    }
    auto parsed = sketch::Sketch::parse(params.at(kEntities), params.at(kConstraints));
    if (!parsed) return params;
    const sketch::SolveResult result = solver_.solve(*parsed, std::nullopt);
    if (result.status != sketch::SolveStatus::Ok) {
      return core::fail(SketchNotSolved{document::FeatureId(id),
                                        "Sketch '" + id + "' not solved: " + statusText(result),
                                        {{"sketch", "sketch.notSolved", Json()}}});
    }
    TINYCAD_ASSERT(result.entities.has_value(), "A solved sketch without entities");
    // No tolerance (Q103): the server coordinates replace the client ones always.
    const sketch::Sketch solved(*result.entities, parsed->constraints());
    Json out = params;
    out[kEntities] = solved.entitiesJson();
    return out;
  }

  sketch::ConstraintSolver& solver_;
  const document::DocumentReader& doc_;
  std::set<std::string> addedSketches_;
};

}  // namespace

SketchOperationSolver::SketchOperationSolver(sketch::ConstraintSolver& solver) : solver_(solver) {}

core::Result<Json, SketchNotSolved> SketchOperationSolver::solve(
    const Json& operation, const document::DocumentReader& doc) {
  return OperationWalk(solver_, doc).operation(operation);
}

}  // namespace tinycad::features

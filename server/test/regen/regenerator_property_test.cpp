// The property test of regeneration (spec 07 "Testy", decision N28; port of
// test/unit/regen/regenerator.property.test.ts over the real built-in features): random
// sequences of document changes – add, remove, change a param, suppress, move the rollback bar,
// move a feature, including steps that lead to errors – must satisfy after every step:
//
//   1. regeneration with the cache describes the same result as a new Regenerator from scratch
//      (statuses, bodies with their names, signatures and volumes, anchors: the description of
//      the regen case runner);
//   2. no handle leaks: kernel.liveHandleCount() == Regenerator::ownedHandleCount(), every body of
//      the final state is alive, and destroying the Regenerator leaves no handle behind.
//
// Our own generator (std::mt19937 with a seed per sequence, N28). Abstract steps carry plain
// numbers and are turned into concrete features against the CURRENT studio. On a failure the test
// prints the seed and the shortest failing prefix of the steps.

#include <gtest/gtest.h>

#include <algorithm>
#include <map>
#include <random>
#include <sstream>

#include "regen/testing.hpp"
#include "shared-cases/support/regen_describe.hpp"
#include "support/compare.hpp"
#include "tinycad/features/builders.hpp"
#include "tinycad/features/builtin.hpp"

namespace tinycad::regen::test {
namespace {

using document::PartStudioData;

struct Step {
  enum class Kind { Add, Remove, SetParam, Suppress, Rollback, Move };
  Kind kind = Kind::Add;
  /** Add: the feature type 0..5 (box, cylinder, boolean, transform, fillet, chamfer). */
  int type = 0;
  int a = 0;
  int b = 0;
  int c = 0;
};

std::string describeStep(const Step& s) {
  static const char* kinds[] = {"add", "remove", "setParam", "suppress", "rollback", "move"};
  std::ostringstream out;
  out << kinds[static_cast<int>(s.kind)] << "(type " << s.type << ", " << s.a << ", " << s.b << ", "
      << s.c << ")";
  return out.str();
}

const document::FeatureSchemaRegistry& schemas() {
  static const document::FeatureSchemaRegistry registry = [] {
    document::FeatureSchemaRegistry r;
    features::registerBuiltInSchemas(r);
    return r;
  }();
  return registry;
}

const FeatureBuilderRegistry& builders() {
  static const FeatureBuilderRegistry registry = [] {
    FeatureBuilderRegistry r;
    features::registerBuiltInBuilders(r);
    return r;
  }();
  return registry;
}

/** Applies abstract steps to a studio; feature ids p1, p2, … in creation order. */
class StudioModel {
 public:
  [[nodiscard]] const PartStudioData& studio() const { return studio_; }

  void apply(const Step& s) {
    auto& fs = studio_.features;
    const int len = static_cast<int>(fs.size());
    switch (s.kind) {
      case Step::Kind::Add: {
        // Mostly at the end, like a user does; otherwise anywhere (references may then dangle).
        const int at = s.a % 4 != 0 ? len : s.a % (len + 1);
        fs.insert(fs.begin() + at, makeFeature(s));
        if (at <= studio_.rollbackIndex) ++studio_.rollbackIndex;
        return;
      }
      case Step::Kind::Rollback:
        studio_.rollbackIndex = s.a % (len + 1);
        return;
      default:
        break;
    }
    if (len == 0) return;
    const int i = s.a % len;
    switch (s.kind) {
      case Step::Kind::Remove:
        fs.erase(fs.begin() + i);
        if (i < studio_.rollbackIndex) --studio_.rollbackIndex;
        return;
      case Step::Kind::SetParam: {
        auto f = std::make_shared<document::FeatureInstance>(*fs[static_cast<std::size_t>(i)]);
        Json params = *f->params;
        changeParam(f->type, params, s.b);
        f->params = std::make_shared<const Json>(std::move(params));
        fs[static_cast<std::size_t>(i)] = f;
        return;
      }
      case Step::Kind::Suppress: {
        auto f = std::make_shared<document::FeatureInstance>(*fs[static_cast<std::size_t>(i)]);
        f->suppressed = s.b % 2 == 1;
        fs[static_cast<std::size_t>(i)] = f;
        return;
      }
      case Step::Kind::Move: {
        // The bar stays at its index (moveFeature of ops keeps the rollback index).
        const auto feature = fs[static_cast<std::size_t>(i)];
        fs.erase(fs.begin() + i);
        const int to = s.b % len;
        fs.insert(fs.begin() + to, feature);
        return;
      }
      default:
        return;
    }
  }

 private:
  /**
   * The id of a body to refer to: mostly a box or cylinder ever created (it may be deleted,
   * moved behind or consumed since), sometimes any feature (most have no body of their own).
   */
  [[nodiscard]] std::string bodyOf(int n) const {
    const auto& pool = n % 7 == 0 || bodyIds_.empty() ? ids_ : bodyIds_;
    return pool.empty() ? "nothing" : pool[static_cast<std::size_t>(n / 7) % pool.size()];
  }

  /** Another body than bodyOf(n) when there are at least two to choose from. */
  [[nodiscard]] std::string otherBodyOf(int n, int m) const {
    const std::string first = bodyOf(n);
    for (int k = 1; k <= 7 * static_cast<int>(ids_.size() + 1); ++k) {
      const std::string other = bodyOf(n + 7 * (1 + m % 3) * k);
      if (other != first) return other;
    }
    return first;
  }

  static Json bodyRef(const std::string& id) { return {{"kind", "body"}, {"body", id + "/body"}}; }

  /** An edge between the front face and another face of the box `id` (edges of other bodies are
   * unresolved). */
  static Json edgeRef(const std::string& id, int n) {
    static const char* others[] = {"top", "bottom", "left", "right"};
    const std::string other = others[n % 4];
    // edge:<A>|<B> with A ≤ B in sort order: "front" sorts after "bottom" and before the rest.
    const std::string front = id + "/face:front";
    const std::string second = id + "/face:" + other;
    const std::string name =
        front <= second ? "edge:" + front + "|" + second : "edge:" + second + "|" + front;
    return {{"kind", "topo"}, {"body", id + "/body"}, {"name", name}};
  }

  document::FeaturePtr makeFeature(const Step& s) {
    static const char* types[] = {"box", "cylinder", "boolean", "transform", "fillet", "chamfer"};
    const std::string type = types[s.type % 6];
    auto f = std::make_shared<document::FeatureInstance>();
    f->id = document::FeatureId("p" + std::to_string(++counter_));
    f->type = type;
    f->typeVersion = schemas().get(type).version();
    f->name = f->id.str();
    Json params;
    const double x = (s.b % 5) * 4.0;
    if (type == "box") {
      params = {{"origin", {x, 0, 0}}, {"width", 6}, {"depth", 6}, {"height", 2 + s.c % 4}};
    } else if (type == "cylinder") {
      params = {{"base", {x, 3, 0}}, {"axis", "z"}, {"radius", 1 + s.c % 3}, {"height", 5}};
    } else if (type == "boolean") {
      static const char* ops[] = {"union", "subtract", "intersect"};
      params = {{"op", ops[s.c % 3]},
                {"targets", Json::array({bodyRef(bodyOf(s.b))})},
                {"tools", Json::array({bodyRef(otherBodyOf(s.b, s.c))})},
                {"keepTools", s.c % 2 == 0}};
    } else if (type == "transform") {
      static const char* pivots[] = {"origin", "bodiesCenter", "point"};
      params = {{"bodies", Json::array({bodyRef(bodyOf(s.b))})},
                {"pivot", pivots[s.c % 3]},
                {"pivotPoint", {1, 1, 0}},
                {"translate", {s.c % 3, 0, 1}},
                {"rx", 0},
                {"ry", 0},
                {"rz", (s.c % 4) * 0.5}};
    } else {
      const std::string id = bodyOf(s.b);
      // Sizes 0.5..2.5 work on the boxes, 20 is too large (fillet.failed / chamfer.failed).
      const double size = s.c % 5 == 4 ? 20 : 0.5 + (s.c % 5) * 0.5;
      params = {{"edges", Json::array({edgeRef(id, s.c)})},
                {type == "fillet" ? "radius" : "distance", size}};
    }
    f->params = std::make_shared<const Json>(std::move(params));
    ids_.push_back(f->id.str());
    if (type == "box" || type == "cylinder") bodyIds_.push_back(f->id.str());
    return f;
  }

  /** A new value of one param by type; some values are invalid (INVALID_PARAMS). */
  static void changeParam(const std::string& type, Json& params, int n) {
    const double v = n % 6 - 1;  // -1 .. 4
    if (type == "box") params["height"] = v;
    if (type == "cylinder") params["radius"] = v;
    if (type == "boolean") params["keepTools"] = n % 2 == 0;
    if (type == "transform") params["translate"] = {v, 0, 0};
    if (type == "fillet") params["radius"] = v;
    if (type == "chamfer") params["distance"] = v;
  }

  PartStudioData studio_;
  std::vector<std::string> ids_;
  /** The features with a body of their own (box, cylinder), in creation order. */
  std::vector<std::string> bodyIds_;
  int counter_ = 0;
};

std::vector<Step> randomSteps(std::mt19937& rng) {
  std::uniform_int_distribution<int> count(1, 20);
  std::uniform_int_distribution<int> any(0, 1000);
  std::discrete_distribution<int> kind({5, 1, 2, 1, 1, 1});
  std::vector<Step> steps(static_cast<std::size_t>(count(rng)));
  for (auto& s : steps) {
    s.kind = static_cast<Step::Kind>(kind(rng));
    // Boxes more often, so booleans, transforms and dressups find bodies.
    s.type = std::discrete_distribution<int>({4, 2, 2, 2, 1, 1})(rng);
    s.a = any(rng);
    s.b = any(rng);
    s.c = any(rng);
  }
  return steps;
}

struct Regen {
  Regen()
      : regenerator(std::make_unique<Regenerator>(kernel, builders(), schemas(), stoppedClock)) {}
  CountingKernel kernel;
  std::unique_ptr<Regenerator> regenerator;
};

/** Statuses seen per feature type and status kind ("fillet ok"), to check the generator. */
using Seen = std::map<std::string, int>;

/** Nullopt when every step holds; else the index of the first failing step and why. */
std::optional<std::pair<std::size_t, std::string>> firstFailure(const std::vector<Step>& steps,
                                                                Seen& seen) {
  StudioModel model;
  Regen cached;
  for (std::size_t i = 0; i < steps.size(); ++i) {
    model.apply(steps[i]);
    const auto withCache = cached.regenerator->run(model.studio());
    for (std::size_t f = 0; f < model.studio().features.size(); ++f) {
      const auto& feature = *model.studio().features[f];
      ++seen[feature.type + " " +
             std::string(featureStatusKindName(withCache.statuses[f].second.kind))];
    }
    Regen scratch;
    const auto fromScratch = scratch.regenerator->run(model.studio());
    const Json a = testing::describeResult(cached.kernel, withCache);
    const Json b = testing::describeResult(scratch.kernel, fromScratch);
    if (auto diff = testing::firstDifference(b, a, testing::Tolerance{})) {
      return std::pair{i, "cache ≠ scratch: " + *diff};
    }
    if (cached.kernel.liveHandleCount() != cached.regenerator->ownedHandleCount()) {
      return std::pair{i, "live " + std::to_string(cached.kernel.liveHandleCount()) + " ≠ owned " +
                              std::to_string(cached.regenerator->ownedHandleCount())};
    }
    for (const auto& body : withCache.finalState->bodies()) {
      if (!cached.kernel.boundingBox(body->shape())) {
        return std::pair{i, "body " + body->id() + " has a released handle"};
      }
    }
  }
  // Destroying the Regenerator releases everything it owns.
  cached.regenerator.reset();
  if (const auto left = cached.kernel.liveHandleCount(); left != 0) {
    return std::pair{steps.size() - 1, std::to_string(left) + " handles after destruction"};
  }
  return std::nullopt;
}

TEST(RegeneratorProperty, WithTheCacheGivesTheSameResultAsFromScratchAndLeaksNoHandle) {
  Seen seen;
  for (unsigned seed = 1; seed <= 100; ++seed) {
    std::mt19937 rng(seed);
    const auto steps = randomSteps(rng);
    const auto failure = firstFailure(steps, seen);
    if (!failure) continue;
    std::ostringstream prefix;
    for (std::size_t i = 0; i <= failure->first; ++i) prefix << "\n  " << describeStep(steps[i]);
    ADD_FAILURE() << "seed " << seed << ", step " << failure->first << ": " << failure->second
                  << "\nshortest failing prefix:" << prefix.str();
    return;
  }
  std::ostringstream summary;
  for (const auto& [key, count] : seen) summary << key << ": " << count << "; ";
  // The generator reaches every feature type in a working state and the error paths too.
  for (const std::string type : {"box", "cylinder", "boolean", "transform", "fillet", "chamfer"}) {
    EXPECT_GT(seen[type + " ok"], 0) << type << "\n" << summary.str();
  }
  EXPECT_GT(seen["fillet error"] + seen["chamfer error"], 0);
  EXPECT_GT(seen["boolean error"], 0);
  EXPECT_GT(seen["box suppressed"], 0);
  EXPECT_GT(seen["box rolledBack"], 0);
  RecordProperty("statuses", summary.str());
}

}  // namespace
}  // namespace tinycad::regen::test

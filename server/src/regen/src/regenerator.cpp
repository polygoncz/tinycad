// Replays the features of a part studio through the kernel with a cache keyed by the identity of
// the feature pointers (spec 07 "Regenerator", src/regen/regenerator.ts). Synchronous (N40): no
// generations to supersede, no events, no lost kernel.

#include "tinycad/regen/regenerator.hpp"

#include <algorithm>
#include <cstddef>
#include <utility>

#include "tinycad/core/result.hpp"

namespace tinycad::regen {

const FeatureStatus* RegenResult::statusOf(const FeatureId& id) const {
  for (const auto& [feature, status] : statuses) {
    if (feature == id) return &status;
  }
  return nullptr;
}

namespace {

/** Cache entry of one position (Q042): the feature, its output state, its status and anchors. */
struct CacheEntry {
  document::FeaturePtr feature;
  StatePtr state;
  FeatureStatus status;
  /** Only for a feature built with ok or warning. */
  std::optional<FeatureAnchors> anchors;
};

/** 'param: code', or the code alone for an issue of the params as a whole. */
std::string formatIssues(const std::vector<document::ParamIssue>& issues) {
  std::string text;
  for (const auto& issue : issues) {
    if (!text.empty()) text += "; ";
    text += issue.param.empty() ? issue.code : issue.param + ": " + issue.code;
  }
  return text;
}

}  // namespace

struct Regenerator::Impl {
  Impl(kernel::GeometryKernel& kernelPort, const FeatureBuilderRegistryReader& builderRegistry,
       const document::FeatureSchemaRegistryReader& schemaRegistry, Clock clock)
      : kernel(kernelPort),
        builders(builderRegistry),
        schemas(schemaRegistry),
        now(std::move(clock)) {}

  kernel::GeometryKernel& kernel;
  const FeatureBuilderRegistryReader& builders;
  const document::FeatureSchemaRegistryReader& schemas;
  Clock now;
  /** Every handle the kernel gave to a builder; mark & sweep releases the dead ones. */
  OwnedHandles owned;
  std::vector<CacheEntry> cache;
  int generation = 0;
  RegenObserver* observer = nullptr;
  ContentVersions versions;

  /** Output state and status of one feature in front of the rollback bar (steps 2–7). */
  CacheEntry build(const document::FeaturePtr& feature, const StatePtr& input) {
    const auto failed = [&](FeatureError error) {
      return CacheEntry{feature, input, FeatureStatus::failed(std::move(error)), std::nullopt};
    };

    if (feature->suppressed) {
      return CacheEntry{feature, input, FeatureStatus::suppressed(), std::nullopt};
    }

    const document::FeatureSchema* schema = schemas.find(feature->type);
    const FeatureBuilder* builder = builders.find(feature->type);
    if (schema == nullptr || builder == nullptr) {
      const char* missing = schema == nullptr ? "schema" : "builder";
      return failed({FeatureErrorCode::UnknownType,
                     std::string("No feature ") + missing + " for type '" + feature->type + "'",
                     {}});
    }

    // A guard for data that missed migration: builder and evaluation expect the current version.
    if (feature->typeVersion != schema->version()) {
      return failed({FeatureErrorCode::StaleVersion,
                     "Feature of type '" + feature->type + "' has data version " +
                         std::to_string(feature->typeVersion) + ", the schema is version " +
                         std::to_string(schema->version()),
                     {}});
    }

    // Variables do not exist yet (Q003); the builder gets the evaluated params only.
    const document::Evaluated evaluated = document::evaluateParams(*schema, *feature->params);
    if (!evaluated.params) {
      return failed(
          {FeatureErrorCode::InvalidParams, formatIssues(evaluated.issues), evaluated.issues});
    }

    // An exception out of build() is a programmer error (Q043): it leaves run() unhandled here.
    BuildContext ctx(kernel, owned, input);
    BuildResult output = builder->build(BuildInput{*feature, *evaluated.params, input}, ctx);
    if (!output) return failed(std::move(output.error()));

    const auto warnings = ctx.warnings();
    FeatureStatus status = warnings ? FeatureStatus::warning(*warnings) : FeatureStatus::ok();
    return CacheEntry{feature, std::move(output->state), std::move(status),
                      std::move(output->anchors)};
  }

  void done(int current, const FeatureId& feature, const FeatureStatus& status) {
    if (observer != nullptr) observer->featureDone(current, feature, status);
  }

  /**
   * Mark & sweep (spec 07, Životnost handle): live = the body shapes and sketch region faces of
   * every cached state; every other owned handle is released in one release call.
   */
  void sweep() {
    OwnedHandles live;
    for (const auto& entry : cache) {
      for (const auto& body : entry.state->bodies()) live.insert(body->shape());
      for (const auto& sketch : entry.state->sketches()) {
        for (const auto& region : sketch->regions) live.insert(region.face);
      }
    }
    std::vector<ShapeHandle> dead;
    for (ShapeHandle h : owned) {
      if (!live.contains(h)) dead.push_back(h);
    }
    if (dead.empty()) return;
    auto released = kernel.release(dead);
    if (!released) {
      // release is atomic: nothing was released, so the handles stay owned.
      TINYCAD_ASSERT(
          released.error().code != kernel::KernelErrorCode::UnknownHandle,
          "Regenerator owned a handle the kernel does not know: " + released.error().message);
      // Any other kernel error (Internal): the next sweep tries again (Q040).
      return;
    }
    for (ShapeHandle h : dead) owned.erase(h);
  }

  /** Steps 1–5 of the cache; writes the cache. Everything of RegenResult but durationMs. */
  RegenResult regenerate(const document::PartStudioData& studio, int current,
                         const std::optional<FeatureId>& inputOf) {
    const auto& features = studio.features;
    const std::size_t count = features.size();
    const std::size_t rollback = static_cast<std::size_t>(
        std::max(0, std::min(studio.rollbackIndex, static_cast<int>(count))));

    // Cache step 1: the first position whose feature is not the cached pointer.
    std::size_t k = 0;
    while (k < count && k < cache.size() && features[k] == cache[k].feature) ++k;

    // Steps 2, 3 and 5: positions 0..k-1 stay, k..rollback-1 are built anew.
    std::vector<CacheEntry> entries(cache.begin(), cache.begin() + static_cast<std::ptrdiff_t>(k));
    for (std::size_t i = 0; i < std::min(k, rollback); ++i) {
      done(current, entries[i].feature->id, entries[i].status);
    }
    for (std::size_t i = k; i < rollback; ++i) {
      const StatePtr& input = i == 0 ? RegenState::empty() : entries[i - 1].state;
      entries.push_back(build(features[i], input));
      done(current, features[i]->id, entries.back().status);
    }

    // Step 4: features behind the bar are rolledBack whatever the cache holds for them.
    RegenResult result;
    result.generation = current;
    for (std::size_t i = 0; i < count; ++i) {
      const FeatureId& id = features[i]->id;
      if (i < rollback) {
        result.statuses.emplace_back(id, entries[i].status);
        if (entries[i].anchors) result.anchors.emplace_back(id, *entries[i].anchors);
      } else {
        const FeatureStatus status = FeatureStatus::rolledBack();
        done(current, id, status);
        result.statuses.emplace_back(id, status);
      }
    }
    result.finalState = rollback == 0 ? RegenState::empty() : entries[rollback - 1].state;
    if (inputOf) {
      for (std::size_t i = 0; i < rollback; ++i) {
        if (features[i]->id == *inputOf) {
          result.input = RegenInput{*inputOf, i == 0 ? RegenState::empty() : entries[i - 1].state};
          break;
        }
      }
    }
    cache = std::move(entries);
    return result;
  }
};

Regenerator::Regenerator(kernel::GeometryKernel& kernel,
                         const FeatureBuilderRegistryReader& builders,
                         const document::FeatureSchemaRegistryReader& schemas, Clock now)
    : impl_(std::make_unique<Impl>(kernel, builders, schemas, std::move(now))) {}

Regenerator::~Regenerator() {
  // The Regenerator owns its handles (Q041): give them back to the kernel. Best effort.
  if (impl_->owned.empty()) return;
  const std::vector<ShapeHandle> all(impl_->owned.begin(), impl_->owned.end());
  (void)impl_->kernel.release(all);
}

RegenResult Regenerator::run(const document::PartStudioData& studio, const RunOptions& options) {
  const double start = impl_->now();
  const int current = ++impl_->generation;
  RegenResult result;
  try {
    result = impl_->regenerate(studio, current, options.inputOf);
  } catch (...) {
    // Q043 and observer exceptions: the cache was not written, so the handles of this run are
    // dead. The original exception wins over a failed sweep.
    try {
      impl_->sweep();
    } catch (...) {  // NOLINT(bugprone-empty-catch): the builder's exception is the one to report
    }
    throw;
  }
  impl_->sweep();
  result.durationMs = impl_->now() - start;
  return result;
}

void Regenerator::setObserver(RegenObserver* observer) { impl_->observer = observer; }

std::string Regenerator::contentVersion(const Body& body) const {
  return impl_->versions.of(body.shape());
}

std::size_t Regenerator::ownedHandleCount() const { return impl_->owned.size(); }

}  // namespace tinycad::regen

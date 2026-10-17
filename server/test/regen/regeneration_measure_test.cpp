// RegenerationMeasure (spec 13 "Měření výkonu", decisions N142, N156; the C++ successor of the TS
// measurement of M15): the plate with 36 holes and 4 fillets of the shared case
// regen/boolean-plate-36-holes-fillet (no second copy of the model), measured over the real
// OcctKernel behind the counting decorator.
//
// It MEASURES AND PRINTS, but never fails on time: times depend on the machine and its load, so a
// time limit would be either flaky or too loose to prove anything ("Měření, které nemůže selhat").
// It checks only deterministic quantities – no feature in error, one body with 46 faces, the
// kernel calls of the recompute from the cache and the live handles – and each of these checks was
// shown to fail with a deliberate fault of its own (listed at each check).

#include <gtest/gtest.h>

#include <algorithm>
#include <chrono>
#include <cstddef>
#include <iomanip>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "regen/testing.hpp"
#include "support/shared_cases.hpp"
#include "tinycad/document/serialize.hpp"
#include "tinycad/features/builders.hpp"
#include "tinycad/features/builtin.hpp"

namespace tinycad::regen::test {
namespace {

/** Repetitions of each measured step; the median is printed. */
constexpr int REPETITIONS = 3;
/** The default mesh quality of a session (spec 14 ReadModelOptions). */
const kernel::MeshQuality QUALITY{0.1, 0.5};
/** The index of the first feature (the box of the plate) and of the last one (the fillet). */
constexpr std::size_t PLATE = 0;
constexpr std::size_t FILLET = 38;
/** Faces of the filleted plate with its 36 holes (the `expected` of the shared case). */
constexpr std::size_t PLATE_FACES = 46;
/**
 * Kernel calls of the recompute from the cache after a change of the fillet radius, found on the
 * first run (2026-10-17): one fillet and one topology (of the new shape), plus one release of the
 * old fillet result by the sweep. Nothing in front of the fillet (no box, no cylinder, no boolean)
 * runs again.
 */
constexpr int CACHED_FILLET_CALLS = 1;
constexpr int CACHED_MODELING_CALLS = 2;

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

/** The studio of the shared case, loaded as the server loads a document. */
document::StudioPtr plateStudio() {
  const Json sharedCase = testing::loadCase("regen", "boolean-plate-36-holes-fillet");
  auto loaded = document::fromData(sharedCase.at("input").at("document"), schemas());
  if (!loaded) throw std::runtime_error("the plate document does not load");
  return (*loaded)->studio();
}

/** The studio with one param of the feature at `index` changed (a new FeaturePtr, so no cache). */
document::StudioPtr withParam(const document::PartStudioData& studio, std::size_t index,
                              const std::string& key, const Json& value) {
  auto next = std::make_shared<document::PartStudioData>(studio);
  auto feature = std::make_shared<document::FeatureInstance>(*studio.features.at(index));
  Json params = *feature->params;
  params[key] = value;
  feature->params = std::make_shared<const Json>(std::move(params));
  next->features.at(index) = std::move(feature);
  return next;
}

double millisecondsSince(std::chrono::steady_clock::time_point start) {
  return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start)
      .count();
}

double median(std::vector<double> values) {
  std::sort(values.begin(), values.end());
  return values.at(values.size() / 2);
}

/** Measures one call in ms. */
template <class Call>
double timed(Call&& call) {
  const auto start = std::chrono::steady_clock::now();
  call();
  return millisecondsSince(start);
}

/** Features whose status is not ok, as "id: kind" (empty = all fine). */
std::vector<std::string> notOk(const RegenResult& result) {
  std::vector<std::string> out;
  for (const auto& [id, status] : result.statuses) {
    if (status.kind != FeatureStatusKind::Ok) {
      out.push_back(id.str() + ": " + std::string(featureStatusKindName(status.kind)));
    }
  }
  return out;
}

struct Timings {
  std::vector<double> first;
  std::vector<double> tessellate;
  std::vector<double> full;
  std::vector<double> cached;
};

void print(const Timings& t, const std::map<std::string, int>& cachedCalls) {
  std::cout << "\nRegenerationMeasure: plate with 36 holes and 4 fillets (median of "
            << REPETITIONS << ", ms)\n";
  const auto row = [](const std::string& step, const std::vector<double>& values) {
    std::cout << "  " << std::left << std::setw(36) << step << std::right << std::setw(10)
              << std::fixed << std::setprecision(1) << median(values) << '\n';
  };
  row("first regeneration", t.first);
  row("tessellation (0.1, 0.5)", t.tessellate);
  row("full recompute (plate width)", t.full);
  row("recompute from cache (fillet radius)", t.cached);
  std::cout << "  kernel calls of the recompute from cache:";
  for (const auto& [method, count] : cachedCalls) std::cout << ' ' << method << '=' << count;
  std::cout << "\n\n";
}

TEST(RegenerationMeasure, PlateWith36HolesAndFourFillets) {
  const document::StudioPtr plate = plateStudio();
  ASSERT_EQ(plate->features.size(), FILLET + 1);
  Timings timings;
  std::map<std::string, int> cachedCalls;

  for (int repetition = 0; repetition < REPETITIONS; ++repetition) {
    CountingKernel kernel;
    {
      Regenerator regenerator(kernel, builders(), schemas(), [] { return 0.0; });

      // (1) The first regeneration of a new Regenerator over a new kernel.
      RegenResult result;
      timings.first.push_back(timed([&] { result = regenerator.run(*plate); }));
      // Deliberate fault: a fillet radius the plate cannot take → the fillet in error.
      EXPECT_EQ(notOk(result), std::vector<std::string>{});
      // Deliberate fault: the boolean without its last 35 tools → 36 bodies.
      const std::vector<BodyPtr> bodies = result.finalState->bodies();
      ASSERT_EQ(bodies.size(), 1U);
      const auto topology = kernel.topology(bodies.front()->shape());
      ASSERT_TRUE(topology.has_value());
      // Deliberate fault: the boolean switched from subtract to union → 154 faces, not 46.
      EXPECT_EQ(topology->faces.size(), PLATE_FACES);

      // (2) Tessellation of the bodies of the result.
      timings.tessellate.push_back(timed([&] {
        for (const BodyPtr& body : bodies) {
          ASSERT_TRUE(kernel.tessellate(body->shape(), QUALITY).has_value());
        }
      }));

      // (3) The full recompute: the first feature changed, so every feature is built anew.
      const document::StudioPtr wider =
          withParam(*plate, PLATE, "width", 200 + repetition + 1);
      timings.full.push_back(timed([&] { result = regenerator.run(*wider); }));
      EXPECT_EQ(notOk(result), std::vector<std::string>{});

      // (4) The recompute from the cache: only the last feature (the fillet) changed.
      const document::StudioPtr rounder = withParam(*wider, FILLET, "radius", 6);
      kernel.resetCounts();
      timings.cached.push_back(timed([&] { result = regenerator.run(*rounder); }));
      cachedCalls = kernel.counts();
      EXPECT_EQ(notOk(result), std::vector<std::string>{});
      // Deliberate fault: the first feature changed instead of the last one (no cache) → 36
      // cylinders, one boolean, makeBox and 78 modeling calls again.
      EXPECT_EQ(kernel.calls("makeBox"), 0);
      EXPECT_EQ(kernel.calls("makeCylinder"), 0);
      EXPECT_EQ(kernel.calls("boolean"), 0);
      EXPECT_EQ(kernel.calls("fillet"), CACHED_FILLET_CALLS);
      EXPECT_EQ(kernel.modelingCalls(), CACHED_MODELING_CALLS);

      // Deliberate fault: a ShapeHandle made here and never released → one live handle more.
      EXPECT_EQ(kernel.liveHandleCount(), regenerator.ownedHandleCount());
    }
    // The Regenerator released everything it owned.
    EXPECT_EQ(kernel.liveHandleCount(), 0U);
  }

  print(timings, cachedCalls);
}

}  // namespace
}  // namespace tinycad::regen::test

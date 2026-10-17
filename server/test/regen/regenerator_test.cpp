// Regenerator::run (spec 07; port of test/unit/regen/regenerator.test.ts without concurrency,
// events and the lost kernel, decision N40) over OcctKernel with the counting decorator (N45).

#include <gtest/gtest.h>

#include <stdexcept>

#include "regen/testing.hpp"

namespace tinycad::regen::test {
namespace {

using document::FeaturePtr;
using Kinds = std::vector<std::pair<std::string, FeatureStatusKind>>;
constexpr auto Ok = FeatureStatusKind::Ok;
constexpr auto Warning = FeatureStatusKind::Warning;
constexpr auto Error = FeatureStatusKind::Error;
constexpr auto Suppressed = FeatureStatusKind::Suppressed;
constexpr auto RolledBack = FeatureStatusKind::RolledBack;

std::vector<std::string> bodyIds(const RegenState& state) {
  std::vector<std::string> ids;
  for (const auto& b : state.bodies()) ids.push_back(b->id());
  return ids;
}

/** A build that fails with INVALID_PARAMS for the features in `failing`, cube otherwise. */
SpyBuilder::Build failingFor(std::vector<std::string> failing) {
  return [failing](const BuildInput& input, BuildContext& ctx) -> BuildResult {
    for (const auto& id : failing) {
      if (input.feature.id.str() == id) {
        return core::fail(FeatureError{FeatureErrorCode::InvalidParams, "nope",
                                       {document::ParamIssue{"size", "own.code", nullptr}}});
      }
    }
    return buildCube(input, ctx);
  };
}

// --- result

TEST(RegeneratorResult, BuildsAllFeaturesInOrderAndReturnsTheirBodiesAndOkStatuses) {
  RegenSetup s;
  const auto r = s.regenerator->run(aStudio(features(3)));
  EXPECT_EQ(kindsOf(r), (Kinds{{"f1", Ok}, {"f2", Ok}, {"f3", Ok}}));
  EXPECT_EQ(bodyIds(*r.finalState), (std::vector<std::string>{"f1/body", "f2/body", "f3/body"}));
  EXPECT_EQ(s.box->builtIds(), (std::vector<std::string>{"f1", "f2", "f3"}));
  EXPECT_EQ(r.generation, 1);
}

TEST(RegeneratorResult, GivesEachBuilderTheOutputStateOfThePreviousFeature) {
  RegenSetup s;
  s.regenerator->run(aStudio(features(2)));
  ASSERT_EQ(s.box->inputStates().size(), 2U);
  EXPECT_EQ(s.box->inputStates()[0], RegenState::empty());
  EXPECT_EQ(bodyIds(*s.box->inputStates()[1]), std::vector<std::string>{"f1/body"});
}

TEST(RegeneratorResult, AnEmptyStudioGivesTheEmptyStateAndNoStatuses) {
  RegenSetup s;
  const auto r = s.regenerator->run(aStudio({}));
  EXPECT_EQ(r.finalState, RegenState::empty());
  EXPECT_TRUE(r.statuses.empty());
  EXPECT_TRUE(r.anchors.empty());
  EXPECT_FALSE(r.input.has_value());
}

TEST(RegeneratorResult, IncreasesTheGenerationWithEveryRun) {
  RegenSetup s;
  const auto studio = aStudio(features(1));
  EXPECT_EQ(s.regenerator->run(studio).generation, 1);
  EXPECT_EQ(s.regenerator->run(studio).generation, 2);
}

TEST(RegeneratorResult, MeasuresDurationMsWithTheGivenClock) {
  double t = 100;
  RegenSetup s(buildCube, [&t] {
    t += 7;
    return t;
  });
  EXPECT_EQ(s.regenerator->run(aStudio(features(2))).durationMs, 7);
  EXPECT_EQ(RegenSetup().regenerator->run(aStudio(features(1))).durationMs, 0);
}

// --- cache by identity

TEST(RegeneratorCache, AChangedParamOfFeature3Of5RebuildsOnly3To5) {
  RegenSetup s;
  auto fs = features(5);
  s.regenerator->run(aStudio(fs));
  s.box->reset();
  fs[2] = resized(fs[2], 2);
  s.regenerator->run(aStudio(fs));
  EXPECT_EQ(s.box->builtIds(), (std::vector<std::string>{"f3", "f4", "f5"}));
}

TEST(RegeneratorCache, TheSameStudioAgainBuildsNothingAndReturnsTheSameFinalState) {
  RegenSetup s;
  const auto studio = aStudio(features(3));
  const auto first = s.regenerator->run(studio);
  s.box->reset();
  s.kernel.resetCounts();
  const auto second = s.regenerator->run(studio);
  EXPECT_EQ(s.box->callCount(), 0);
  EXPECT_EQ(s.kernel.modelingCalls(), 0);
  EXPECT_EQ(second.finalState, first.finalState);
}

TEST(RegeneratorCache, AnEqualButNewFeaturePointerIsRebuilt) {
  RegenSetup s;
  auto fs = features(2);
  s.regenerator->run(aStudio(fs));
  s.box->reset();
  fs[1] = std::make_shared<const document::FeatureInstance>(*fs[1]);
  s.regenerator->run(aStudio(fs));
  EXPECT_EQ(s.box->builtIds(), std::vector<std::string>{"f2"});
}

TEST(RegeneratorCache, DeletingOrInsertingAFeatureRebuildsFromItsPositionOn) {
  RegenSetup s;
  auto fs = features(4);
  s.regenerator->run(aStudio(fs));
  s.box->reset();
  fs.erase(fs.begin() + 1);
  s.regenerator->run(aStudio(fs));
  EXPECT_EQ(s.box->builtIds(), (std::vector<std::string>{"f3", "f4"}));
  s.box->reset();
  fs.insert(fs.begin() + 2, aFeature("f9"));
  s.regenerator->run(aStudio(fs));
  EXPECT_EQ(s.box->builtIds(), (std::vector<std::string>{"f9", "f4"}));
}

TEST(RegeneratorCache, BuildsAfterAChangedFeatureStartFromTheCachedStateBeforeIt) {
  RegenSetup s;
  auto fs = features(3);
  const auto first = s.regenerator->run(aStudio(fs));
  (void)first;
  const StatePtr afterF1 = s.box->inputStates()[1];
  s.box->reset();
  fs[1] = resized(fs[1], 3);
  s.regenerator->run(aStudio(fs));
  ASSERT_FALSE(s.box->inputStates().empty());
  EXPECT_EQ(s.box->inputStates()[0], afterF1);
}

// --- rollback bar

TEST(RegeneratorRollback, FeaturesBehindTheBarAreRolledBackNotBuiltAndFinalStateIsAtTheBar) {
  RegenSetup s;
  const auto r = s.regenerator->run(aStudio(features(3), 1));
  EXPECT_EQ(kindsOf(r), (Kinds{{"f1", Ok}, {"f2", RolledBack}, {"f3", RolledBack}}));
  EXPECT_EQ(s.box->builtIds(), std::vector<std::string>{"f1"});
  EXPECT_EQ(bodyIds(*r.finalState), std::vector<std::string>{"f1/body"});
}

TEST(RegeneratorRollback, RollbackIndexZeroGivesTheEmptyStateAndBuildsNothing) {
  RegenSetup s;
  const auto r = s.regenerator->run(aStudio(features(2), 0));
  EXPECT_EQ(r.finalState, RegenState::empty());
  EXPECT_EQ(s.box->callCount(), 0);
}

TEST(RegeneratorRollback, MovingTheBarBackCallsNoKernelMovingItForwardAgainNeither) {
  RegenSetup s;
  const auto fs = features(3);
  s.regenerator->run(aStudio(fs, 3));
  s.kernel.resetCounts();
  s.box->reset();
  const auto back = s.regenerator->run(aStudio(fs, 1));
  EXPECT_EQ(kindsOf(back), (Kinds{{"f1", Ok}, {"f2", RolledBack}, {"f3", RolledBack}}));
  const auto forward = s.regenerator->run(aStudio(fs, 3));
  EXPECT_EQ(kindsOf(forward), (Kinds{{"f1", Ok}, {"f2", Ok}, {"f3", Ok}}));
  EXPECT_EQ(s.kernel.modelingCalls(), 0);
  EXPECT_EQ(s.kernel.calls("release"), 0);
  EXPECT_EQ(s.box->callCount(), 0);
}

TEST(RegeneratorRollback, MovingTheBarForwardBuildsOnlyTheNewlyIncludedFeatures) {
  RegenSetup s;
  const auto fs = features(4);
  s.regenerator->run(aStudio(fs, 1));
  s.box->reset();
  s.regenerator->run(aStudio(fs, 3));
  EXPECT_EQ(s.box->builtIds(), (std::vector<std::string>{"f2", "f3"}));
}

TEST(RegeneratorRollback, AChangeBehindTheBarBuildsNothingAndKeepsValidEntriesInFrontOfIt) {
  RegenSetup s;
  auto fs = features(3);
  s.regenerator->run(aStudio(fs, 3));
  s.box->reset();
  fs[2] = resized(fs[2], 5);
  s.regenerator->run(aStudio(fs, 2));
  EXPECT_EQ(s.box->callCount(), 0);
  s.regenerator->run(aStudio(fs, 3));
  EXPECT_EQ(s.box->builtIds(), std::vector<std::string>{"f3"});
}

// --- statuses

TEST(RegeneratorStatuses, AFailingBuilderGivesErrorPassesTheStateThroughAndLaterFeaturesAreOk) {
  RegenSetup s(failingFor({"f2"}));
  const auto r = s.regenerator->run(aStudio(features(3)));
  EXPECT_EQ(kindsOf(r), (Kinds{{"f1", Ok}, {"f2", Error}, {"f3", Ok}}));
  EXPECT_EQ(bodyIds(*r.finalState), (std::vector<std::string>{"f1/body", "f3/body"}));
  const auto& error = *statusOf(r, "f2").error;
  EXPECT_EQ(error.code, FeatureErrorCode::InvalidParams);
  EXPECT_EQ(error.issues.at(0).code, "own.code");
  EXPECT_EQ(s.box->inputStates()[2], s.box->inputStates()[1]);
}

TEST(RegeneratorStatuses, AFailingLastFeatureLeavesItsInputStateAsTheFinalState) {
  RegenSetup s(failingFor({"f2"}));
  const auto r = s.regenerator->run(aStudio(features(2)));
  EXPECT_EQ(r.finalState, s.box->inputStates()[1]);
}

TEST(RegeneratorStatuses, InvalidParamsGiveInvalidParamsWithTheSchemaIssuesAndSkipTheBuilder) {
  RegenSetup s;
  const auto r = s.regenerator->run(aStudio({aFeature("f1", 0), aFeature("f2", 1)}));
  EXPECT_EQ(kindsOf(r), (Kinds{{"f1", Error}, {"f2", Ok}}));
  const auto& error = *statusOf(r, "f1").error;
  EXPECT_EQ(error.code, FeatureErrorCode::InvalidParams);
  ASSERT_EQ(error.issues.size(), 1U);
  EXPECT_EQ(error.issues[0].param, "size");
  EXPECT_EQ(error.issues[0].code, "param.atOrBelowMin");
  EXPECT_EQ(s.box->builtIds(), std::vector<std::string>{"f2"});
  EXPECT_EQ(s.kernel.calls("makeBox"), 1);
}

TEST(RegeneratorStatuses, ATypeWithoutSchemaOrWithoutBuilderGivesUnknownTypeAndGoesOn) {
  RegenSetup s;
  // 'cylinder' has a builder, 'sphere' a schema, 'torus' neither.
  s.builders.add(std::make_shared<CubeBuilder>("cylinder"));
  s.schemas.add(aSchema("sphere"));
  const auto r = s.regenerator->run(aStudio({aFeature("c", 1, "cylinder"), aFeature("s", 1, "sphere"),
                                             aFeature("t", 1, "torus"), aFeature("f1")}));
  EXPECT_EQ(kindsOf(r), (Kinds{{"c", Error}, {"s", Error}, {"t", Error}, {"f1", Ok}}));
  for (const auto* id : {"c", "s", "t"}) {
    EXPECT_EQ(statusOf(r, id).error->code, FeatureErrorCode::UnknownType) << id;
    EXPECT_TRUE(statusOf(r, id).error->issues.empty()) << id;
  }
}

TEST(RegeneratorStatuses, AnotherDataVersionGivesStaleVersionSkipsTheBuilderAndPassesTheState) {
  RegenSetup s;
  auto stale = std::make_shared<document::FeatureInstance>(*aFeature("f1", 0));
  stale->typeVersion = 2;
  const auto r = s.regenerator->run(aStudio({stale, aFeature("f2")}));
  EXPECT_EQ(kindsOf(r), (Kinds{{"f1", Error}, {"f2", Ok}}));
  // Before validation: the stale params (size 0) are not validated.
  EXPECT_EQ(statusOf(r, "f1").error->code, FeatureErrorCode::StaleVersion);
  EXPECT_EQ(s.box->builtIds(), std::vector<std::string>{"f2"});
  EXPECT_EQ(s.box->inputStates()[0], RegenState::empty());
}

TEST(RegeneratorStatuses, UnknownTypeComesBeforeStaleVersionAndSuppressedBeforeBoth) {
  RegenSetup s;
  auto unknown = std::make_shared<document::FeatureInstance>(*aFeature("u", 1, "torus"));
  unknown->typeVersion = 3;
  auto suppressed = std::make_shared<document::FeatureInstance>(*aFeature("p", 0, "torus"));
  suppressed->typeVersion = 3;
  suppressed->suppressed = true;
  const auto r = s.regenerator->run(aStudio({unknown, suppressed}));
  EXPECT_EQ(statusOf(r, "u").error->code, FeatureErrorCode::UnknownType);
  EXPECT_EQ(statusOf(r, "p").kind, Suppressed);
}

TEST(RegeneratorStatuses, ASuppressedFeaturePassesTheStateThroughWithoutBuilding) {
  RegenSetup s;
  auto fs = features(3);
  fs[1] = suppressedCopy(fs[1]);
  const auto r = s.regenerator->run(aStudio(fs));
  EXPECT_EQ(kindsOf(r), (Kinds{{"f1", Ok}, {"f2", Suppressed}, {"f3", Ok}}));
  EXPECT_EQ(s.box->builtIds(), (std::vector<std::string>{"f1", "f3"}));
  EXPECT_EQ(bodyIds(*r.finalState), (std::vector<std::string>{"f1/body", "f3/body"}));
}

TEST(RegeneratorStatuses, ARolledBackFeatureWinsOverSuppressedAndUnknownType) {
  RegenSetup s;
  const auto r = s.regenerator->run(
      aStudio({aFeature("f1"), suppressedCopy(aFeature("f2")), aFeature("t", 1, "torus")}, 1));
  EXPECT_EQ(kindsOf(r), (Kinds{{"f1", Ok}, {"f2", RolledBack}, {"t", RolledBack}}));
}

TEST(RegeneratorStatuses, WarnTwiceGivesOneWarningWithTheMessagesJoinedByNewline) {
  RegenSetup s([](const BuildInput& input, BuildContext& ctx) {
    ctx.warn("first");
    ctx.warn("second");
    return buildCube(input, ctx);
  });
  const auto r = s.regenerator->run(aStudio(features(1)));
  EXPECT_EQ(statusOf(r, "f1").kind, Warning);
  EXPECT_EQ(statusOf(r, "f1").message, "first\nsecond");
  EXPECT_EQ(bodyIds(*r.finalState), std::vector<std::string>{"f1/body"});
}

TEST(RegeneratorStatuses, AKernelFailureGivesKernelWithATranslatedIssueAndPassesTheState) {
  RegenSetup s;
  s.kernel.failNext("makeBox", {kernel::KernelErrorCode::OperationFailed, "boom"});
  const auto r = s.regenerator->run(aStudio(features(2)));
  EXPECT_EQ(kindsOf(r), (Kinds{{"f1", Error}, {"f2", Ok}}));
  const auto& error = *statusOf(r, "f1").error;
  EXPECT_EQ(error.code, FeatureErrorCode::Kernel);
  EXPECT_EQ(error.message, "boom");
  ASSERT_EQ(error.issues.size(), 1U);
  EXPECT_EQ(error.issues[0].param, "");
  EXPECT_EQ(error.issues[0].code, "kernel.operationFailed");
  EXPECT_EQ(bodyIds(*r.finalState), std::vector<std::string>{"f2/body"});
}

TEST(RegeneratorStatuses, ANonKernelExceptionLeavesRunAndDoesNotWriteTheCache) {
  bool fail = false;
  RegenSetup s([&fail](const BuildInput& input, BuildContext& ctx) -> BuildResult {
    if (fail && input.feature.id.str() == "f2") throw std::logic_error("bug");
    return buildCube(input, ctx);
  });
  auto fs = features(2);
  s.regenerator->run(aStudio(fs));
  const FeaturePtr original = fs[1];
  fail = true;
  fs[1] = resized(fs[1], 2);
  EXPECT_THROW(s.regenerator->run(aStudio(fs)), std::logic_error);
  // Only the live bodies of the cached first run remain.
  EXPECT_EQ(s.kernel.liveHandleCount(), 2U);
  // The cache is still the one of the first run: a run of the first studio builds nothing.
  fail = false;
  s.box->reset();
  s.regenerator->run(aStudio({fs[0], original}));
  EXPECT_EQ(s.box->callCount(), 0);
}

TEST(RegeneratorStatuses, StatusesFromTheCacheAreKeptWarningAndErrorBeforeAChange) {
  RegenSetup s([](const BuildInput& input, BuildContext& ctx) -> BuildResult {
    if (input.feature.id.str() == "f1") ctx.warn("w");
    if (input.feature.id.str() == "f2") {
      return core::fail(FeatureError{FeatureErrorCode::InvalidParams, "x", {}});
    }
    return buildCube(input, ctx);
  });
  auto fs = features(3);
  s.regenerator->run(aStudio(fs));
  s.box->reset();
  fs[2] = resized(fs[2], 2);
  const auto r = s.regenerator->run(aStudio(fs));
  EXPECT_EQ(kindsOf(r), (Kinds{{"f1", Warning}, {"f2", Error}, {"f3", Ok}}));
  EXPECT_EQ(statusOf(r, "f1").message, "w");
  EXPECT_EQ(s.box->builtIds(), std::vector<std::string>{"f3"});
}

TEST(RegeneratorStatuses, AKernelErrorStatusIsCachedAndNotRebuilt) {
  RegenSetup s;
  const auto studio = aStudio(features(1));
  s.kernel.failNext("makeBox", {kernel::KernelErrorCode::Internal, "boom"});
  EXPECT_EQ(statusOf(s.regenerator->run(studio), "f1").error->issues[0].code, "kernel.internal");
  s.box->reset();
  EXPECT_EQ(statusOf(s.regenerator->run(studio), "f1").error->code, FeatureErrorCode::Kernel);
  EXPECT_EQ(s.box->callCount(), 0);
}

TEST(RegeneratorDependencies, ReadsTheRegistriesAtRunTime) {
  RegenSetup s;
  const auto studio = aStudio({aFeature("c", 1, "cylinder")});
  EXPECT_EQ(statusOf(s.regenerator->run(studio), "c").error->code, FeatureErrorCode::UnknownType);
  s.schemas.add(aSchema("cylinder"));
  s.builders.add(std::make_shared<CubeBuilder>("cylinder"));
  // A new feature pointer, so the cache does not hold the old status.
  EXPECT_EQ(statusOf(s.regenerator->run(aStudio({aFeature("c", 1, "cylinder")})), "c").kind, Ok);
}

// --- observer

class RecordingObserver final : public RegenObserver {
 public:
  void featureDone(int generation, const FeatureId& feature, const FeatureStatus& status) override {
    events.emplace_back(generation, feature.str(), status.kind);
  }
  std::vector<std::tuple<int, std::string, FeatureStatusKind>> events;
};

TEST(RegeneratorObserver, GetsEveryFeatureOnceInFeatureOrder) {
  RegenSetup s;
  RecordingObserver observer;
  s.regenerator->setObserver(&observer);
  auto fs = features(4);
  s.regenerator->run(aStudio(fs, 3));
  using E = std::tuple<int, std::string, FeatureStatusKind>;
  EXPECT_EQ(observer.events, (std::vector<E>{E{1, "f1", Ok}, E{1, "f2", Ok}, E{1, "f3", Ok},
                                             E{1, "f4", RolledBack}}));
  observer.events.clear();
  fs[1] = resized(fs[1], 2);
  s.regenerator->run(aStudio(fs, 3));
  EXPECT_EQ(observer.events, (std::vector<E>{E{2, "f1", Ok}, E{2, "f2", Ok}, E{2, "f3", Ok},
                                             E{2, "f4", RolledBack}}));
  s.regenerator->setObserver(nullptr);
  observer.events.clear();
  s.regenerator->run(aStudio(fs, 3));
  EXPECT_TRUE(observer.events.empty());
}

class ThrowingObserver final : public RegenObserver {
 public:
  void featureDone(int, const FeatureId&, const FeatureStatus&) override {
    throw std::runtime_error("observer bug");
  }
};

TEST(RegeneratorObserver, AnExceptionOfTheObserverLeavesRunAndItsHandlesAreReleased) {
  RegenSetup s;
  ThrowingObserver observer;
  s.regenerator->setObserver(&observer);
  EXPECT_THROW(s.regenerator->run(aStudio(features(2))), std::runtime_error);
  EXPECT_EQ(s.regenerator->ownedHandleCount(), 0U);
  EXPECT_EQ(s.kernel.liveHandleCount(), 0U);
}

}  // namespace
}  // namespace tinycad::regen::test

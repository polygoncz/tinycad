#pragma once

// Replays the features of a part studio through the kernel (spec 07 "Regenerator",
// src/regen/regenerator.ts) with a cache keyed by the identity of the feature pointers
// (ADR 0006, decision N17: document::FeaturePtr identity replaces TS object identity).
//
// Differences to TS (decision N40):
// - run() is SYNCHRONOUS and never superseded: the session (M45) serializes calls per runtime
//   document, so there are no concurrent generations, no 'superseded' and no lost-kernel path
//   (Q049 was about the worker). `generation` stays as a counter for the read model and events.
// - No event emitter: an optional RegenObserver gets featureDone (M45 turns it into
//   regen_progress of WatchSession). `started`/`finished` are the call and the return of run().
// - Not thread-safe; one Regenerator per kernel instance (N13).

#include <cstddef>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "tinycad/document/model.hpp"
#include "tinycad/document/schema.hpp"
#include "tinycad/kernel/kernel.hpp"
#include "tinycad/regen/builder.hpp"
#include "tinycad/regen/content_version.hpp"
#include "tinycad/regen/state.hpp"

namespace tinycad::regen {

struct RegenInput {
  FeatureId feature;
  /** The state in front of the feature (ADR 0025): a pointer into the cache, its handles live. */
  StatePtr state;
};

struct RegenResult {
  /** 1 for the first run, +1 per run. */
  int generation = 0;
  /** State at the rollback bar: output of the last feature in front of it, or RegenState::empty(). */
  StatePtr finalState;
  /** Every feature of the studio, in feature order. */
  std::vector<std::pair<FeatureId, FeatureStatus>> statuses;
  /**
   * Anchors of every feature in front of the rollback bar with status ok or warning, built or
   * cached ({} for a feature without a manipulator), in feature order (spec 07, M18).
   */
  std::vector<std::pair<FeatureId, FeatureAnchors>> anchors;
  /**
   * Input of RunOptions::inputOf when that feature is in front of the rollback bar (even
   * suppressed or in error); nullopt otherwise and without inputOf (ADR 0025).
   */
  std::optional<RegenInput> input;
  /** From the clock of the Regenerator, the sweep included. */
  double durationMs = 0;

  /** The status of a feature; nullptr for an id that is not in the studio. */
  [[nodiscard]] const FeatureStatus* statusOf(const FeatureId& id) const;
};

struct RunOptions {
  /** The feature of an open dialog whose input the result carries (ADR 0025). */
  std::optional<FeatureId> inputOf;
};

/** Progress of one run (spec 07 featureDone): every feature once, in feature order. */
class RegenObserver {
 public:
  virtual ~RegenObserver() = default;
  virtual void featureDone(int generation, const FeatureId& feature,
                           const FeatureStatus& status) = 0;
};

class Regenerator {
 public:
  /** Clock in ms for durationMs (Q046); the server passes a steady clock, tests a fixed one. */
  using Clock = std::function<double()>;

  /**
   * `kernel`, `builders` and `schemas` must outlive the Regenerator. The Regenerator owns every
   * handle its builders created through the tracking kernel and releases the dead ones (sweep);
   * on destruction it releases every handle it still owns.
   */
  Regenerator(kernel::GeometryKernel& kernel, const FeatureBuilderRegistryReader& builders,
              const document::FeatureSchemaRegistryReader& schemas, Clock now);
  ~Regenerator();
  Regenerator(const Regenerator&) = delete;
  Regenerator& operator=(const Regenerator&) = delete;

  /**
   * Regenerates the studio (spec 07, cache steps 1–5): the first position k whose FeaturePtr is
   * not the cached pointer; positions 0..k-1 stay, k..rollbackIndex-1 are built anew, features
   * behind the bar are rolledBack. Per feature (steps of build in TS): suppressed → pass through;
   * missing schema or builder → UNKNOWN_TYPE; typeVersion ≠ schema version → STALE_VERSION;
   * evaluateParams issues → INVALID_PARAMS (builder not called); builder error → error status,
   * state passed through; warnings → warning status. Then mark & sweep: live = body shapes and
   * sketch region faces of every cached state; every other owned handle is released in ONE
   * release call. Release UnknownHandle → AssertionError (a regen bug, handles stay owned);
   * another kernel error → handles stay owned and the next sweep retries.
   *
   * An exception out of a builder or the observer (a programmer error, Q043) leaves the cache
   * unwritten; run sweeps and rethrows it.
   */
  RegenResult run(const document::PartStudioData& studio, const RunOptions& options = {});

  /** Progress observer for the next runs; nullptr = none. Not owned. */
  void setObserver(RegenObserver* observer);

  /** The content_version of a body of a state this Regenerator produced (N43). */
  [[nodiscard]] std::string contentVersion(const Body& body) const;

  /** Owned handles (tests: equals the live handles after a run, spec 07 sweep test). */
  [[nodiscard]] std::size_t ownedHandleCount() const;

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace tinycad::regen

// The property test of replay (decision N28; port of test/unit/ops/replay.property.test.ts):
// random sequences of valid operations over a live session – dispatches, batches, transactions
// with transient steps, undo and redo – must satisfy:
//
//   1. undo gives back the document before its target, redo the document after it;
//   2. replaying the log onto the initial document gives the live document;
//   3. rebuildUndoStacks of the log equals the live stacks;
//   4. undo of everything gives back the initial document.
//
// The generator is our own (std::mt19937 with a seed per sequence; RapidCheck is not among the
// vcpkg dependencies). Abstract steps carry plain numbers and are turned into concrete operations
// against the CURRENT document, so every generated sequence is valid. On a failure the test
// prints the seed and the shortest failing prefix of the steps.

#include <gtest/gtest.h>

#include <map>
#include <memory>
#include <optional>
#include <random>
#include <sstream>
#include <string>
#include <vector>

#include "ops/testing.hpp"
#include "tinycad/document/refs.hpp"
#include "tinycad/document/serialize.hpp"
#include "tinycad/ops/replay.hpp"
#include "tinycad/ops/transaction.hpp"

namespace tinycad::testing {
namespace {

/** An abstract step: a kind and plain numbers, translated against the current document. */
struct Step {
  enum class Kind {
    // operation steps
    Add,
    Remove,
    SetParams,
    Rename,
    Suppress,
    Move,
    Rollback,
    BodyRename,
    BodyVisible,
    BodyColor,
    BodyMaterial,
    // only inside a transaction: a transient document rename (commutes with every logged step)
    Transient,
    // session steps
    Batch,
    Transaction,
    Undo,
    Redo,
  };

  Kind kind = Kind::Add;
  int a = 0;
  int b = 0;
  int c = 0;
  bool flag = false;
  /** Transaction: its steps. */
  std::vector<Step> steps;
};

const char* kindName(Step::Kind kind) {
  switch (kind) {
    case Step::Kind::Add: return "add";
    case Step::Kind::Remove: return "remove";
    case Step::Kind::SetParams: return "setParams";
    case Step::Kind::Rename: return "rename";
    case Step::Kind::Suppress: return "suppress";
    case Step::Kind::Move: return "move";
    case Step::Kind::Rollback: return "rollback";
    case Step::Kind::BodyRename: return "bodyRename";
    case Step::Kind::BodyVisible: return "bodyVisible";
    case Step::Kind::BodyColor: return "bodyColor";
    case Step::Kind::BodyMaterial: return "bodyMaterial";
    case Step::Kind::Transient: return "transient";
    case Step::Kind::Batch: return "batch";
    case Step::Kind::Transaction: return "tx";
    case Step::Kind::Undo: return "undo";
    case Step::Kind::Redo: return "redo";
  }
  return "?";
}

std::string describe(const Step& s) {
  std::ostringstream out;
  out << kindName(s.kind) << "(" << s.a << "," << s.b << "," << s.c << "," << s.flag;
  if (s.kind == Step::Kind::Transaction) {
    out << ";";
    for (const Step& sub : s.steps) out << " " << describe(sub);
  }
  out << ")";
  return out.str();
}

/** Builds the abstract steps of one sequence from its seed. */
class StepGenerator {
 public:
  explicit StepGenerator(unsigned seed) : rng_(seed) {}

  std::vector<Step> sequence() {
    std::vector<Step> steps(static_cast<std::size_t>(between(1, 40)));
    for (Step& s : steps) s = step();
    return steps;
  }

 private:
  int between(int low, int high) { return std::uniform_int_distribution<int>(low, high)(rng_); }
  bool coin() { return between(0, 1) == 1; }

  /** Weights as in TS: an operation 6, a batch 1, a transaction 2, undo 1, redo 1. */
  Step step() {
    const int pick = between(0, 10);
    if (pick < 6) return opStep(false);
    Step s;
    if (pick == 6) {
      s.kind = Step::Kind::Batch;
      s.a = between(0, 1000);
      s.b = between(0, 1000);
      s.c = between(0, 1000);
      s.flag = coin();
    } else if (pick <= 8) {
      s.kind = Step::Kind::Transaction;
      const int count = between(1, 4);
      for (int i = 0; i < count; ++i) s.steps.push_back(opStep(true));
      s.flag = coin();  // commit, else abort
    } else {
      s.kind = pick == 9 ? Step::Kind::Undo : Step::Kind::Redo;
    }
    return s;
  }

  Step opStep(bool inTransaction) {
    Step s;
    const int last = inTransaction ? 11 : 10;
    s.kind = static_cast<Step::Kind>(between(0, last));
    s.a = between(0, 1000);
    s.b = between(0, 1000);
    s.c = between(0, 3);
    s.flag = coin();
    return s;
  }

  std::mt19937 rng_;
};

// Body metadata does not depend on features existing (spec 03), so a small fixed set of bodies,
// some of features that never exist, makes renames and hiding collide often.
const std::vector<std::string> kBodies = {"p1/body", "p2/body", "p2/body:1", "zz/body"};
// c = 0 resets to the default color; three colors make the same value collide often too.
const std::vector<std::string> kColors = {"#ff0000", "#00ff00", "#0000ff"};
// 0 is the default 'plastic', which the canonical form drops (M24).
const std::vector<std::string> kMaterials = {"plastic", "steel", "glass"};

const Json kNone = Json(Json::value_t::discarded);

/** Log entries written over all sequences: the test must exercise the session for real. */
std::int64_t totalEntries = 0;

DocumentOptions initialOptions() {
  return DocumentOptions{.id = "doc-prop", .createdAt = 123};
}

Json dataOf(const document::DocumentReader& doc) {
  return document::documentDataJson(document::toData(doc));
}

/** Runs one sequence over a fresh session; the first broken property, or nullopt. */
class SequenceRun {
 public:
  std::optional<std::string> run(const std::vector<Step>& steps) {
    initial_ = dataOf(*session_.doc);
    for (std::size_t i = 0; i < steps.size(); ++i) {
      if (auto failure = runStep(steps[i])) {
        return "step " + std::to_string(i) + " " + describe(steps[i]) + ": " + *failure;
      }
    }
    return checkEnd();
  }

 private:
  /**
   * The concrete operation of an operation step, or a `discarded` JSON when it cannot be done now
   * (an optional<json> would be ambiguous: json converts to anything).
   */
  Json toOp(const Step& s) {
    const auto& features = session_.doc->studio()->features;
    const int length = static_cast<int>(features.size());
    const std::string body = kBodies[static_cast<std::size_t>(s.b) % kBodies.size()];
    switch (s.kind) {
      case Step::Kind::Add:
        return addOp(*aFeature("p" + std::to_string(++nextId_)), s.a % (length + 1));
      case Step::Kind::Rollback: return rollbackOp(s.a % (length + 1));
      case Step::Kind::BodyRename:
        // c = 0 clears the name, so the canonical form (no entry, no bodies) is exercised too.
        return Json{{"type", "body.rename"},
                    {"v", 1},
                    {"body", body},
                    {"name", s.c == 0 ? std::string() : "n" + std::to_string(s.c)}};
      case Step::Kind::BodyVisible:
        return Json{{"type", "body.setVisible"}, {"v", 1}, {"body", body}, {"visible", s.flag}};
      case Step::Kind::BodyColor:
        return Json{{"type", "body.setColor"},
                    {"v", 1},
                    {"body", body},
                    {"color", s.c == 0 ? Json(nullptr) : Json(kColors[static_cast<std::size_t>(s.c - 1)])}};
      case Step::Kind::BodyMaterial:
        return Json{{"type", "body.setMaterial"},
                    {"v", 1},
                    {"body", body},
                    {"material", kMaterials[static_cast<std::size_t>(s.c) % kMaterials.size()]}};
      case Step::Kind::Transient:
        return Json{{"type", "document.rename"}, {"v", 1}, {"name", "t" + std::to_string(s.a)}};
      default: break;
    }
    if (length == 0) return kNone;
    const std::string id = features[static_cast<std::size_t>(s.a % length)]->id.str();
    switch (s.kind) {
      case Step::Kind::Remove: return removeOp(id);
      case Step::Kind::SetParams: return setParamsOp(id, {{"size", s.b}});
      case Step::Kind::Rename: return renameOp(id, "n" + std::to_string(s.b));
      case Step::Kind::Suppress: return suppressOp(id, s.flag);
      case Step::Kind::Move: return moveOp(id, s.b % length);
      default: return kNone;
    }
  }

  /** The id of the feature at i modulo the count, or nullopt for an empty studio. */
  std::optional<std::string> featureAt(int i) const {
    const auto& features = session_.doc->studio()->features;
    if (features.empty()) return std::nullopt;
    return features[static_cast<std::size_t>(i) % features.size()]->id.str();
  }

  void record(const std::optional<ops::LogEntry>& entry, const Json& start) {
    if (!entry) return;
    before_[entry->seq] = start;
    after_[entry->seq] = dataOf(*session_.doc);
  }

  std::optional<std::string> dispatch(const Json& op) {
    const Json start = dataOf(*session_.doc);
    auto entry = session_.dispatcher.dispatch(op);
    if (!entry) return "dispatch of " + op.dump() + " failed: " + entry.error().message;
    record(*entry, start);
    return std::nullopt;
  }

  std::optional<std::string> runStep(const Step& s) {
    switch (s.kind) {
      case Step::Kind::Undo: {
        if (session_.undo.stacks().undo.empty()) return std::nullopt;
        const auto target = session_.undo.stacks().undo.back();
        if (!session_.undo.undo()) return "undo failed";
        if (dataOf(*session_.doc) != before_.at(target)) return "undo did not restore the state";
        return std::nullopt;
      }
      case Step::Kind::Redo: {
        if (session_.undo.stacks().redo.empty()) return std::nullopt;
        const auto target = session_.undo.stacks().redo.back();
        if (!session_.undo.redo()) return "redo failed";
        if (dataOf(*session_.doc) != after_.at(target)) return "redo did not restore the state";
        return std::nullopt;
      }
      case Step::Kind::Batch: return batch(s);
      case Step::Kind::Transaction: return transaction(s);
      default: {
        const Json op = toOp(s);
        return op.is_discarded() ? std::nullopt : dispatch(op);
      }
    }
  }

  /** Order-independent ops on existing features, plus optionally one add at the end. */
  std::optional<std::string> batch(const Step& s) {
    Json ops = Json::array();
    if (const auto x = featureAt(s.a)) ops.push_back(setParamsOp(*x, {{"size", s.a}}));
    if (const auto y = featureAt(s.b)) ops.push_back(renameOp(*y, "b" + std::to_string(s.b)));
    if (const auto z = featureAt(s.c)) ops.push_back(suppressOp(*z, s.flag));
    if (s.flag || ops.empty()) {
      ops.push_back(addOp(*aFeature("p" + std::to_string(++nextId_)),
                          static_cast<int>(session_.doc->studio()->features.size())));
    }
    return dispatch(batchOp(ops));
  }

  std::optional<std::string> transaction(const Step& s) {
    const Json start = dataOf(*session_.doc);
    auto tx = session_.dispatcher.begin("tx");
    for (const Step& sub : s.steps) {
      const Json op = toOp(sub);
      if (op.is_discarded()) continue;
      const auto applied = sub.kind == Step::Kind::Transient ? tx->applyTransient(op) : tx->apply(op);
      if (!applied) return "transaction step " + op.dump() + " failed: " + applied.error().message;
    }
    if (s.flag) {
      record(tx->commit(), start);
    } else {
      tx->abort();
      if (dataOf(*session_.doc) != start) return "abort did not restore the state";
    }
    return std::nullopt;
  }

  std::optional<std::string> checkEnd() {
    const auto entries = session_.log.entries();
    totalEntries += static_cast<std::int64_t>(entries.size());
    auto replayed = aDocument(initialOptions());
    const auto replay = ops::replayLog(*replayed, session_.handlers, entries);
    if (!replay) return "replay failed at seq " + std::to_string(replay.error().seq);
    if (dataOf(*replayed) != dataOf(*session_.doc)) return "replay differs from the live document";
    if (!document::sameStudio(*replayed->studio(), *session_.doc->studio())) {
      return "sameStudio differs after replay";
    }
    if (ops::rebuildUndoStacks(entries).value() != session_.undo.stacks()) {
      return "rebuildUndoStacks differs from the live stacks";
    }
    while (session_.undo.canUndo()) {
      if (!session_.undo.undo()) return "undo of everything failed";
    }
    if (dataOf(*session_.doc) != initial_) return "undo of everything did not restore the start";
    return std::nullopt;
  }

  OpsSession session_{initialOptions()};
  Json initial_;
  int nextId_ = 0;
  std::map<std::int64_t, Json> before_;
  std::map<std::int64_t, Json> after_;
};

std::optional<std::string> runSequence(const std::vector<Step>& steps) {
  return SequenceRun().run(steps);
}

TEST(ReplayProperty, ReplayUndoAndRedoReproduceTheLiveDocument) {
  constexpr unsigned kSequences = 200;
  for (unsigned seed = 1; seed <= kSequences; ++seed) {
    const auto steps = StepGenerator(seed).sequence();
    if (!runSequence(steps)) continue;
    // The shortest failing prefix, for a readable report.
    for (std::size_t length = 1; length <= steps.size(); ++length) {
      const std::vector<Step> prefix(steps.begin(), steps.begin() + static_cast<std::ptrdiff_t>(length));
      if (const auto failure = runSequence(prefix)) {
        std::string all;
        for (const Step& s : prefix) all += "\n  " + describe(s);
        FAIL() << "seed " << seed << ", shortest failing prefix of " << length << " steps: "
               << *failure << all;
      }
    }
  }
  // About 20 steps per sequence on average: thousands of entries, not a vacuous pass.
  EXPECT_GT(totalEntries, 1000);
}

TEST(ReplayProperty, TheGeneratorIsDeterministicPerSeed) {
  const auto a = StepGenerator(7).sequence();
  const auto b = StepGenerator(7).sequence();
  ASSERT_EQ(a.size(), b.size());
  for (std::size_t i = 0; i < a.size(); ++i) EXPECT_EQ(describe(a[i]), describe(b[i]));
}

}  // namespace
}  // namespace tinycad::testing

#pragma once

// Test helpers of the runtime document and the session manager (M45 task 3): a scratch data
// directory with a real SQLite catalog (wrapped in the failing decorator of M41), the registries
// of the server, a real OcctKernel behind a gate that can hold makeBox (lock tests) and
// PlanegcsSolver (decision N45), fixed clocks, and builders of operations on box features.
// Test-only.

#include <gtest/gtest.h>

#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <mutex>
#include <optional>
#include <random>
#include <string>
#include <utility>
#include <vector>

#include "storage/failing_file.hpp"
#include "tinycad/features/builders.hpp"
#include "tinycad/features/builtin.hpp"
#include "tinycad/kernel/occt_kernel.hpp"
#include "tinycad/ops/handler.hpp"
#include "tinycad/ops/log.hpp"
#include "tinycad/regen/builder.hpp"
#include "tinycad/session/runtime_document.hpp"
#include "tinycad/session/session_manager.hpp"
#include "tinycad/solver_planegcs/planegcs_solver.hpp"
#include "tinycad/storage/document_service.hpp"
#include "tinycad/storage/persistent_document.hpp"

namespace tinycad::session::testing {

using core::Json;
namespace v1 = tinycad::v1;

/** A unique empty directory under the system temp directory, removed with everything in it. */
class ScratchDir {
 public:
  ScratchDir() {
    std::random_device random;
    std::uniform_int_distribution<std::uint64_t> any;
    path_ = std::filesystem::temp_directory_path() /
            ("tinycad-session-" + std::to_string(any(random)));
    std::filesystem::create_directories(path_);
  }
  ~ScratchDir() {
    std::error_code ignored;
    std::filesystem::remove_all(path_, ignored);
  }
  ScratchDir(const ScratchDir&) = delete;
  ScratchDir& operator=(const ScratchDir&) = delete;

  [[nodiscard]] const std::filesystem::path& path() const { return path_; }

 private:
  std::filesystem::path path_;
};

/** The registries of the server: built-in schemas, the handlers of ops, built-in builders. */
struct Registries {
  document::FeatureSchemaRegistry schemas;
  ops::OpHandlerRegistry handlers{schemas};
  regen::FeatureBuilderRegistry builders;

  Registries() {
    features::registerBuiltInSchemas(schemas);
    features::registerBuiltInBuilders(builders);
  }
  Registries(const Registries&) = delete;
  Registries& operator=(const Registries&) = delete;

  /** One instance for the test binary, like the one registry of the server. */
  static const Registries& server() {
    static const Registries registries;
    return registries;
  }

  [[nodiscard]] bool knows(const std::string& type) const { return schemas.find(type) != nullptr; }
};

/** Holds every makeBox while closed, so a test can keep a change running inside the kernel. */
class Gate {
 public:
  void close() {
    const std::lock_guard lock(mutex_);
    open_ = false;
  }
  void open() {
    {
      const std::lock_guard lock(mutex_);
      open_ = true;
    }
    changed_.notify_all();
  }
  /** Called by the kernel: waits while closed. */
  void pass() {
    std::unique_lock lock(mutex_);
    ++waiting_;
    changed_.notify_all();
    changed_.wait(lock, [&] { return open_; });
    --waiting_;
  }
  /** True once a call is held at the gate (within the timeout). */
  bool someoneWaits(std::chrono::milliseconds timeout = std::chrono::seconds(10)) {
    std::unique_lock lock(mutex_);
    return changed_.wait_for(lock, timeout, [&] { return waiting_ > 0; });
  }

 private:
  std::mutex mutex_;
  std::condition_variable changed_;
  bool open_ = true;
  int waiting_ = 0;
};

/** OcctKernel with a Gate in front of makeBox; every other call forwarded unchanged. */
class GateKernel final : public kernel::GeometryKernel {
 public:
  explicit GateKernel(std::shared_ptr<Gate> gate) : gate_(std::move(gate)) {}

  kernel::KernelResult<kernel::ShapeResult> makeBox(const kernel::BoxInput& p) override {
    gate_->pass();
    return inner_.makeBox(p);
  }
  kernel::KernelResult<kernel::ShapeResult> makeCylinder(const kernel::CylinderInput& p) override {
    return inner_.makeCylinder(p);
  }
  kernel::KernelResult<kernel::ShapeResult> transform(kernel::ShapeHandle shape,
                                                      const core::Mat4& m) override {
    return inner_.transform(shape, m);
  }
  kernel::KernelResult<kernel::ShapeResult> boolean(
      kernel::BooleanOp op, std::span<const kernel::ShapeHandle> targets,
      std::span<const kernel::ShapeHandle> tools) override {
    return inner_.boolean(op, targets, tools);
  }
  kernel::KernelResult<kernel::ShapeResult> makeFace(const kernel::FaceInput& p) override {
    return inner_.makeFace(p);
  }
  kernel::KernelResult<kernel::ProfileRegions> profileRegions(
      std::span<const kernel::ProfileCurve> curves) override {
    return inner_.profileRegions(curves);
  }
  kernel::KernelResult<kernel::ShapeResult> extrude(kernel::ShapeHandle profile,
                                                    const core::Vec3& direction,
                                                    double distance) override {
    return inner_.extrude(profile, direction, distance);
  }
  kernel::KernelResult<kernel::ShapeResult> revolve(kernel::ShapeHandle profile,
                                                    const kernel::Axis& axis,
                                                    double angle) override {
    return inner_.revolve(profile, axis, angle);
  }
  kernel::KernelResult<kernel::ShapeResult> fillet(kernel::ShapeHandle shape,
                                                   std::span<const int> edges,
                                                   double radius) override {
    return inner_.fillet(shape, edges, radius);
  }
  kernel::KernelResult<kernel::ShapeResult> chamfer(kernel::ShapeHandle shape,
                                                    std::span<const int> edges,
                                                    double distance) override {
    return inner_.chamfer(shape, edges, distance);
  }
  kernel::KernelResult<kernel::BoundingBox> boundingBox(kernel::ShapeHandle shape) override {
    return inner_.boundingBox(shape);
  }
  kernel::KernelResult<kernel::TopologySummary> topology(kernel::ShapeHandle shape) override {
    return inner_.topology(shape);
  }
  kernel::KernelResult<std::string> exportStep(
      std::span<const kernel::ShapeHandle> shapes) override {
    return inner_.exportStep(shapes);
  }
  kernel::KernelResult<kernel::MeshData> tessellate(kernel::ShapeHandle shape,
                                                    const kernel::MeshQuality& q) override {
    return inner_.tessellate(shape, q);
  }
  kernel::KernelResult<void> release(std::span<const kernel::ShapeHandle> handles) override {
    return inner_.release(handles);
  }
  [[nodiscard]] std::size_t liveHandleCount() const override { return inner_.liveHandleCount(); }

 private:
  std::shared_ptr<Gate> gate_;
  kernel::OcctKernel inner_;
};

// --- operations on box features -------------------------------------------------------------

inline Json boxParams(double width) {
  return {{"origin", {0, 0, 0}}, {"width", width}, {"depth", 10}, {"height", 10}};
}

inline Json boxFeature(const std::string& id, double width = 10) {
  return {{"id", id},     {"type", "box"},         {"typeVersion", 1},
          {"name", id},   {"params", boxParams(width)}, {"suppressed", false}};
}

inline Json addBox(const std::string& id, int index, double width = 10) {
  return {{"type", "feature.add"}, {"v", 1}, {"feature", boxFeature(id, width)}, {"index", index}};
}

inline Json setWidth(const std::string& id, double width) {
  return {{"type", "feature.setParams"},
          {"v", 2},
          {"featureId", id},
          {"typeVersion", 1},
          {"params", boxParams(width)}};
}

inline Json renameFeature(const std::string& id, const std::string& name) {
  return {{"type", "feature.rename"}, {"v", 1}, {"featureId", id}, {"name", name}};
}

inline Json removeFeature(const std::string& id) {
  return {{"type", "feature.remove"}, {"v", 1}, {"featureId", id}};
}

inline Json setRollback(int index) {
  return {{"type", "studio.setRollback"}, {"v", 1}, {"index", index}};
}

inline Json batch(Json ops) { return {{"type", "batch"}, {"v", 1}, {"ops", std::move(ops)}}; }

inline storage::OperationKey key(const std::string& id, const std::string& fingerprint = "fp") {
  return {id, fingerprint};
}

inline Caller callerOf(const std::string& session) {
  return {SessionId(session), kernel::MeshQuality{0.1, 0.5}};
}

/** Every kept event of the document. */
inline std::vector<v1::SessionEvent> eventsOf(RuntimeDocument& doc) {
  return doc.events().after(0).value_or(std::vector<v1::SessionEvent>{});
}

/** The `changed` events of the document, in order. */
inline std::vector<v1::SessionEvent::Changed> changedOf(RuntimeDocument& doc) {
  std::vector<v1::SessionEvent::Changed> out;
  for (const auto& event : eventsOf(doc)) {
    if (event.has_changed()) out.push_back(event.changed());
  }
  return out;
}

/**
 * A data directory with a document catalog, the M41 catalog service and the dependencies of a
 * runtime document. The runtime opens files through the failing decorator (`fail`), the
 * service and the test reader through the plain catalog.
 */
class RuntimeFixture : public ::testing::Test {
 protected:
  const Registries& registries = Registries::server();
  ScratchDir dir;
  double wallTime = 1000;
  storage::WallClock now = [this] { return wallTime; };
  std::unique_ptr<storage::DocumentCatalog> catalog = storage::openSqliteCatalog(dir.path(), now);
  std::shared_ptr<tinycad::testing::FailSwitches> fail =
      std::make_shared<tinycad::testing::FailSwitches>();
  tinycad::testing::FailingCatalog failing{*catalog, fail};
  std::shared_ptr<Gate> gate = std::make_shared<Gate>();
  int nextDocument = 0;
  storage::DocumentService documents{storage::DocumentService::Dependencies{
      *catalog, registries.schemas, registries.handlers, now,
      [this] { return "doc" + std::to_string(++nextDocument); }}};
  RuntimeDocument::Dependencies deps{
      failing,
      registries.schemas,
      registries.handlers,
      registries.builders,
      now,
      [] { return 0.0; },
      [g = gate]() -> std::unique_ptr<kernel::GeometryKernel> {
        return std::make_unique<GateKernel>(g);
      },
      []() -> std::unique_ptr<sketch::ConstraintSolver> {
        return std::make_unique<solver_planegcs::PlanegcsSolver>();
      },
      256,
      true};

  document::DocumentId createDocument(const std::string& name = "Part") {
    auto created = documents.create(name, key("create-" + std::to_string(nextDocument + 1)));
    EXPECT_TRUE(created.has_value());
    return created ? created->id : document::DocumentId();
  }

  std::unique_ptr<RuntimeDocument> openRuntime(const document::DocumentId& id) {
    auto opened = RuntimeDocument::open(id, deps);
    EXPECT_TRUE(opened.has_value()) << (opened ? "" : opened.error().message);
    return opened ? std::move(*opened) : nullptr;
  }

  /** A second, independent reader of the stored document (what a restart would load). */
  std::unique_ptr<storage::PersistentDocument> stored(const document::DocumentId& id) {
    const storage::PersistentDocument::Dependencies readerDeps{registries.schemas,
                                                               registries.handlers, now, false};
    auto file = catalog->open(id);
    EXPECT_TRUE(file.has_value());
    auto doc = storage::PersistentDocument::open(std::move(*file), readerDeps);
    EXPECT_TRUE(doc.has_value()) << (doc ? "" : doc.error().message);
    return doc ? std::move(*doc) : nullptr;
  }

  /** The stored log entries as JSON. */
  std::vector<Json> storedLog(const document::DocumentId& id) {
    std::vector<Json> out;
    for (const auto& entry : stored(id)->log().entries()) out.push_back(ops::logEntryJson(entry));
    return out;
  }

  /** The params of a feature in the stored document. */
  Json storedParams(const document::DocumentId& id, const std::string& feature) {
    auto doc = stored(id);
    const auto found = doc->document().feature(document::FeatureId(feature));
    EXPECT_NE(found, nullptr) << feature;
    return found ? *found->params : Json();
  }
};

}  // namespace tinycad::session::testing

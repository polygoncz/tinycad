#pragma once

// The integration harness of the session services (M45 tasks 4 and 5): a TestServer over a scratch
// data directory with a real SQLite catalog, a SessionManager with fixed clocks and sequential
// ids, both gRPC adapters on a grpc::Server without a port and a client stub over its
// InProcessChannel – every test call crosses a real gRPC channel (serialization, status details,
// streaming). restart() destroys the server and the manager and builds new ones over the same
// data directory, as a restart of tinycad-core would (new Regenerators, so new content versions).
// Test-only.

#include <grpcpp/grpcpp.h>
#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "google/rpc/status.pb.h"
#include "session/runtime_testing.hpp"
#include "tinycad/rpc/document_service.hpp"
#include "tinycad/rpc/feature_types.hpp"
#include "tinycad/rpc/operation_codec.hpp"
#include "tinycad/session/session_manager.hpp"
#include "tinycad/rpc/session_service.hpp"
#include "tinycad/v1/errors.pb.h"
#include "tinycad/v1/session.grpc.pb.h"

namespace tinycad::session::testing {

using rpc::describeFeatureTypes;
using rpc::DocumentServiceImpl;
using rpc::operationFromJson;
using rpc::SessionServiceImpl;

/** The answer of one unary call. */
template <class Response>
struct Reply {
  grpc::Status status;
  Response response;
  [[nodiscard]] bool ok() const { return status.ok(); }
};

/** The one ErrorDetail of a failed status (empty for OK). */
inline v1::ErrorDetail detailOf(const grpc::Status& status) {
  v1::ErrorDetail detail;
  google::rpc::Status rpc;
  if (!rpc.ParseFromString(status.error_details())) return detail;
  if (rpc.details_size() == 1) {
    EXPECT_TRUE(rpc.details(0).UnpackTo(&detail));
  }
  EXPECT_EQ(rpc.details_size(), 1);
  return detail;
}

/** A JSON operation of spec 04 as it travels. */
inline v1::Operation wire(const Json& op) {
  v1::Operation out;
  operationFromJson(op, &out);
  return out;
}

/** content_version → has a mesh, for every body of the final state. */
inline std::vector<std::pair<std::string, bool>> meshesOf(const v1::ReadModel& model) {
  std::vector<std::pair<std::string, bool>> out;
  for (const v1::BodyView& body : model.regen().final().bodies()) {
    out.emplace_back(body.content_version(), body.has_mesh());
  }
  return out;
}

/** ReadModelOptions knowing every mesh of `model`. */
inline v1::ReadModelOptions knowing(const v1::ReadModel& model) {
  v1::ReadModelOptions options;
  for (const v1::BodyView& body : model.regen().final().bodies()) {
    options.add_known_meshes(body.content_version());
  }
  return options;
}

/** The feature `id` of the document view (nullptr when absent). */
inline const v1::FeatureInstance* featureOf(const v1::ReadModel& model, const std::string& id) {
  for (const v1::FeatureInstance& feature : model.document().features()) {
    if (feature.id() == id) return &feature;
  }
  return nullptr;
}

/** The width param of the box `id` (-1 when the feature is absent). */
inline double widthOf(const v1::ReadModel& model, const std::string& id) {
  const v1::FeatureInstance* feature = featureOf(model, id);
  return feature == nullptr ? -1 : feature->params().fields().at("width").number_value();
}

/** One WatchSession call; the deadline keeps a broken test from hanging. */
class Watcher {
 public:
  Watcher(v1::SessionService::Stub& stub, const std::string& sessionId, std::uint64_t afterSeq,
          std::chrono::milliseconds deadline = std::chrono::seconds(20)) {
    context_.set_deadline(std::chrono::system_clock::now() + deadline);
    v1::WatchSessionRequest request;
    request.set_session_id(sessionId);
    request.set_after_seq(afterSeq);
    reader_ = stub.WatchSession(&context_, request);
  }
  ~Watcher() {
    if (!finished_) {
      context_.TryCancel();
      (void)reader_->Finish();
    }
  }
  Watcher(const Watcher&) = delete;
  Watcher& operator=(const Watcher&) = delete;

  /** The next event; nullopt when the stream ended. */
  std::optional<v1::SessionEvent> next() {
    v1::WatchSessionResponse response;
    if (!reader_->Read(&response)) return std::nullopt;
    return response.event();
  }

  /** The next event that is not regen_progress. */
  std::optional<v1::SessionEvent> nextSkippingProgress() {
    for (;;) {
      auto event = next();
      if (!event || !event->has_regen_progress()) return event;
    }
  }

  /** Reads to the end of the stream; the final status. */
  grpc::Status finish() {
    v1::WatchSessionResponse ignored;
    while (reader_->Read(&ignored)) {
    }
    finished_ = true;
    return reader_->Finish();
  }

  void cancel() { context_.TryCancel(); }

 private:
  grpc::ClientContext context_;
  std::unique_ptr<grpc::ClientReader<v1::WatchSessionResponse>> reader_;
  bool finished_ = false;
};

class TestServer {
 public:
  explicit TestServer(SessionConfig config = {}) : config_(config) { start(); }
  ~TestServer() { stop(); }
  TestServer(const TestServer&) = delete;
  TestServer& operator=(const TestServer&) = delete;

  /** Destroys server and manager (every session is gone) and starts anew over the same data. */
  void restart() {
    stop();
    start();
  }

  /** Moves the fake steady clock of the manager (idle timeout). */
  void advance(std::chrono::milliseconds by) { steadyMs_ += by.count(); }

  [[nodiscard]] SessionManager& manager() { return *instance_->manager; }
  [[nodiscard]] v1::SessionService::Stub& sessions() { return *instance_->sessions; }
  [[nodiscard]] v1::DocumentService::Stub& documents() { return *instance_->documents; }
  [[nodiscard]] const std::filesystem::path& dataDir() const { return dir_.path(); }
  /** The switches of the failing decorator between runtime documents and the catalog (spec 05). */
  [[nodiscard]] tinycad::testing::FailSwitches& failures() { return *failures_; }

  /** A new empty document through the catalog of the manager. */
  document::DocumentId createDocument(const std::string& name = "Part") {
    auto created = manager().createDocument(name, key("create-" + std::to_string(++creates_)));
    EXPECT_TRUE(created.has_value());
    return created ? created->id : document::DocumentId();
  }

  // --- unary calls of SessionService ----------------------------------------------------------

  Reply<v1::OpenSessionResponse> open(const document::DocumentId& document,
                                      const std::string& resume = {},
                                      const v1::ReadModelOptions& read = {}) {
    v1::OpenSessionRequest request;
    request.set_document_id(document.str());
    request.set_resume_session_id(resume);
    *request.mutable_read() = read;
    return call(request, &v1::SessionService::Stub::OpenSession);
  }

  /** open() that must succeed; the session id. */
  std::string openOk(const document::DocumentId& document) {
    auto opened = open(document);
    EXPECT_TRUE(opened.ok()) << opened.status.error_message();
    return opened.response.session_id();
  }

  Reply<v1::CloseSessionResponse> close(const std::string& session) {
    v1::CloseSessionRequest request;
    request.set_session_id(session);
    return call(request, &v1::SessionService::Stub::CloseSession);
  }

  Reply<v1::GetReadModelResponse> readModel(const std::string& session,
                                            const v1::ReadModelOptions& read = {}) {
    v1::GetReadModelRequest request;
    request.set_session_id(session);
    *request.mutable_read() = read;
    return call(request, &v1::SessionService::Stub::GetReadModel);
  }

  Reply<v1::DispatchResponse> dispatch(const std::string& session, const Json& op,
                                       const std::string& operationId,
                                       const v1::ReadModelOptions& read = {}) {
    v1::DispatchRequest request;
    request.set_session_id(session);
    request.set_operation_id(operationId);
    *request.mutable_op() = wire(op);
    *request.mutable_read() = read;
    return call(request, &v1::SessionService::Stub::Dispatch);
  }

  Reply<v1::BeginTransactionResponse> begin(const std::string& session, const std::string& label,
                                            const std::string& operationId) {
    v1::BeginTransactionRequest request;
    request.set_session_id(session);
    request.set_operation_id(operationId);
    request.set_label(label);
    return call(request, &v1::SessionService::Stub::BeginTransaction);
  }

  Reply<v1::ApplyResponse> apply(const std::string& session, const Json& op,
                                 const std::string& operationId) {
    v1::ApplyRequest request;
    request.set_session_id(session);
    request.set_operation_id(operationId);
    *request.mutable_op() = wire(op);
    return call(request, &v1::SessionService::Stub::Apply);
  }

  Reply<v1::ApplyTransientResponse> applyTransient(const std::string& session, const Json& op,
                                                   const std::string& operationId) {
    v1::ApplyTransientRequest request;
    request.set_session_id(session);
    request.set_operation_id(operationId);
    *request.mutable_op() = wire(op);
    return call(request, &v1::SessionService::Stub::ApplyTransient);
  }

  Reply<v1::CommitResponse> commit(const std::string& session, const std::string& operationId) {
    v1::CommitRequest request;
    request.set_session_id(session);
    request.set_operation_id(operationId);
    return call(request, &v1::SessionService::Stub::Commit);
  }

  Reply<v1::AbortResponse> abort(const std::string& session, const std::string& operationId) {
    v1::AbortRequest request;
    request.set_session_id(session);
    request.set_operation_id(operationId);
    return call(request, &v1::SessionService::Stub::Abort);
  }

  Reply<v1::UndoResponse> undo(const std::string& session, const std::string& operationId) {
    v1::UndoRequest request;
    request.set_session_id(session);
    request.set_operation_id(operationId);
    return call(request, &v1::SessionService::Stub::Undo);
  }

  Reply<v1::RedoResponse> redo(const std::string& session, const std::string& operationId) {
    v1::RedoRequest request;
    request.set_session_id(session);
    request.set_operation_id(operationId);
    return call(request, &v1::SessionService::Stub::Redo);
  }

  Reply<v1::GetHistoryResponse> history(const std::string& session, std::uint64_t fromSeq = 1) {
    v1::GetHistoryRequest request;
    request.set_session_id(session);
    request.set_from_seq(fromSeq);
    return call(request, &v1::SessionService::Stub::GetHistory);
  }

  Reply<v1::ExportStepResponse> exportStep(const std::string& session) {
    v1::ExportStepRequest request;
    request.set_session_id(session);
    return call(request, &v1::SessionService::Stub::ExportStep);
  }

  /** Every log entry of the stored document (what a restart would load). */
  std::vector<Json> storedLog(const document::DocumentId& id) {
    const auto& registries = Registries::server();
    const storage::PersistentDocument::Dependencies readerDeps{registries.schemas,
                                                               registries.handlers, now_, false};
    auto catalog = storage::openSqliteCatalog(dir_.path(), now_);
    auto file = catalog->open(id);
    EXPECT_TRUE(file.has_value());
    if (!file) return {};
    auto doc = storage::PersistentDocument::open(std::move(*file), readerDeps);
    EXPECT_TRUE(doc.has_value());
    std::vector<Json> out;
    if (!doc) return out;
    for (const auto& entry : (*doc)->log().entries()) out.push_back(ops::logEntryJson(entry));
    return out;
  }

 private:
  /** Everything one run of the server owns, destroyed in reverse order. */
  struct Instance {
    std::unique_ptr<storage::DocumentCatalog> catalog;
    /** Runtime documents open their files through it, so a test can make writing fail. */
    std::unique_ptr<tinycad::testing::FailingCatalog> failing;
    std::unique_ptr<storage::DocumentService> catalogService;
    std::unique_ptr<SessionManager> manager;
    std::unique_ptr<SessionServiceImpl> sessionService;
    std::unique_ptr<DocumentServiceImpl> documentService;
    std::unique_ptr<grpc::Server> server;
    std::unique_ptr<v1::SessionService::Stub> sessions;
    std::unique_ptr<v1::DocumentService::Stub> documents;
  };

  template <class Request, class Response>
  using Method = grpc::Status (v1::SessionService::Stub::*)(grpc::ClientContext*, const Request&,
                                                            Response*);

  template <class Request, class Response>
  Reply<Response> call(const Request& request, Method<Request, Response> method) {
    grpc::ClientContext context;
    context.set_deadline(std::chrono::system_clock::now() + std::chrono::seconds(60));
    Reply<Response> reply;
    reply.status = (sessions().*method)(&context, request, &reply.response);
    return reply;
  }

  void start() {
    const auto& registries = Registries::server();
    const int run = ++runs_;
    auto next = std::make_unique<Instance>();
    next->catalog = storage::openSqliteCatalog(dir_.path(), now_);
    next->failing = std::make_unique<tinycad::testing::FailingCatalog>(*next->catalog, failures_);
    next->catalogService = std::make_unique<storage::DocumentService>(
        storage::DocumentService::Dependencies{*next->catalog, registries.schemas,
                                               registries.handlers, now_,
                                               [this] { return "doc" + std::to_string(++ids_); }});
    const RuntimeDocument::Dependencies runtime{
        *next->failing,
        registries.schemas,
        registries.handlers,
        registries.builders,
        now_,
        [] { return 0.0; },
        []() -> std::unique_ptr<kernel::GeometryKernel> {
          return std::make_unique<kernel::OcctKernel>();
        },
        []() -> std::unique_ptr<sketch::ConstraintSolver> {
          return std::make_unique<solver_planegcs::PlanegcsSolver>();
        },
        256,
        true};
    // Session ids name the run, so an id of a run before restart() is unknown afterwards.
    next->manager = std::make_unique<SessionManager>(SessionManager::Dependencies{
        runtime, *next->catalogService,
        [this] { return SteadyTime(std::chrono::milliseconds(steadyMs_.load())); },
        [this, run] { return "r" + std::to_string(run) + "-s" + std::to_string(++sessionIds_); },
        config_});
    next->sessionService =
        std::make_unique<SessionServiceImpl>(*next->manager, registries.schemas);
    next->documentService = std::make_unique<DocumentServiceImpl>(*next->manager);

    grpc::ServerBuilder builder;
    builder.RegisterService(next->sessionService.get());
    builder.RegisterService(next->documentService.get());
    next->server = builder.BuildAndStart();
    EXPECT_NE(next->server, nullptr);
    const auto channel = next->server->InProcessChannel(grpc::ChannelArguments());
    next->sessions = v1::SessionService::NewStub(channel);
    next->documents = v1::DocumentService::NewStub(channel);
    instance_ = std::move(next);
  }

  /** As main.cpp shuts down (N106): streams end first, then gRPC, then the sessions. */
  void stop() {
    if (!instance_) return;
    instance_->manager->shutdown();
    instance_->server->Shutdown(std::chrono::system_clock::now() + std::chrono::seconds(5));
    instance_->sessions.reset();
    instance_->documents.reset();
    instance_->server.reset();
    instance_->documentService.reset();
    instance_->sessionService.reset();
    instance_->manager.reset();
    instance_.reset();
  }

  SessionConfig config_;
  ScratchDir dir_;
  /** Shared by every run, so the switches survive restart(). */
  std::shared_ptr<tinycad::testing::FailSwitches> failures_ =
      std::make_shared<tinycad::testing::FailSwitches>();
  storage::WallClock now_ = [] { return 1000.0; };
  std::atomic<long long> steadyMs_{0};
  std::atomic<int> sessionIds_{0};
  std::atomic<int> ids_{0};
  int runs_ = 0;
  int creates_ = 0;
  std::unique_ptr<Instance> instance_;
};

}  // namespace tinycad::session::testing

#pragma once

// The server of the integration tests through a real gRPC channel (M45 tasks 4 and 5, spec 14
// "Testy"): a scratch data directory with the SQLite catalog, the registries of the server, a
// SessionManager over the real OcctKernel and PlanegcsSolver (decision N45) with fixed clocks and
// sequential ids, both adapters, and a grpc::Server without a port reached through
// InProcessChannel. restart() destroys the server and the manager and builds new ones over the
// same data directory, as a restart of the process would. Test-only.

#include <grpcpp/grpcpp.h>

#include <memory>
#include <string>

#include "session/runtime_testing.hpp"
#include "tinycad/rpc/document_service.hpp"
#include "tinycad/rpc/feature_types.hpp"
#include "tinycad/session/session_manager.hpp"
#include "tinycad/rpc/session_service.hpp"
#include "tinycad/v1/session.grpc.pb.h"

namespace tinycad::session::testing {

using rpc::DocumentServiceImpl;
using rpc::SessionServiceImpl;

class DocumentsTestServer {
 public:
  DocumentsTestServer() { start(); }
  ~DocumentsTestServer() { stop(); }
  DocumentsTestServer(const DocumentsTestServer&) = delete;
  DocumentsTestServer& operator=(const DocumentsTestServer&) = delete;

  /** Destroys the server and the manager, then serves the same data directory anew. */
  void restart() {
    stop();
    start();
  }

  [[nodiscard]] SessionManager& manager() { return *running_->manager; }
  [[nodiscard]] const std::filesystem::path& dataDir() const { return dir_.path(); }

  [[nodiscard]] std::unique_ptr<v1::DocumentService::Stub> documents() const {
    return v1::DocumentService::NewStub(running_->channel);
  }
  [[nodiscard]] std::unique_ptr<v1::SessionService::Stub> sessions() const {
    return v1::SessionService::NewStub(running_->channel);
  }

  /** ms since the epoch of the catalog and of log entries; tests move it. */
  double wallTime = 1000;
  SteadyTime steadyNow{};

 private:
  /** Everything one server process owns, in construction order. */
  struct Running {
    std::unique_ptr<storage::DocumentCatalog> catalog;
    std::unique_ptr<storage::DocumentService> documents;
    std::unique_ptr<RuntimeDocument::Dependencies> runtime;
    std::unique_ptr<SessionManager> manager;
    std::unique_ptr<DocumentServiceImpl> documentService;
    std::unique_ptr<SessionServiceImpl> sessionService;
    std::unique_ptr<grpc::Server> server;
    std::shared_ptr<grpc::Channel> channel;
  };

  void start() {
    const Registries& registries = Registries::server();
    const storage::WallClock now = [this] { return wallTime; };
    auto running = std::make_unique<Running>();
    running->catalog = storage::openSqliteCatalog(dir_.path(), now);
    running->documents = std::make_unique<storage::DocumentService>(
        storage::DocumentService::Dependencies{
            *running->catalog, registries.schemas, registries.handlers, now,
            [this] { return "doc" + std::to_string(++nextDocument_); }});
    running->runtime = std::make_unique<RuntimeDocument::Dependencies>(RuntimeDocument::Dependencies{
        *running->catalog,
        registries.schemas,
        registries.handlers,
        registries.builders,
        now,
        [] { return 0.0; },
        []() -> std::unique_ptr<kernel::GeometryKernel> {
          return std::make_unique<kernel::OcctKernel>();
        },
        []() -> std::unique_ptr<sketch::ConstraintSolver> {
          return std::make_unique<solver_planegcs::PlanegcsSolver>();
        },
        256,
        true});
    running->manager = std::make_unique<SessionManager>(SessionManager::Dependencies{
        *running->runtime, *running->documents, [this] { return steadyNow; },
        [this] { return "s" + std::to_string(++nextSession_); }, SessionConfig{}});
    running->documentService = std::make_unique<DocumentServiceImpl>(*running->manager);
    running->sessionService =
        std::make_unique<SessionServiceImpl>(*running->manager, registries.schemas);
    grpc::ServerBuilder builder;
    builder.RegisterService(running->documentService.get());
    builder.RegisterService(running->sessionService.get());
    running->server = builder.BuildAndStart();
    running->channel = running->server->InProcessChannel(grpc::ChannelArguments());
    running_ = std::move(running);
  }

  /** The shutdown order of main.cpp (N106): event rings closed, gRPC down, then the manager. */
  void stop() {
    if (!running_) return;
    running_->manager->shutdown();
    running_->server->Shutdown();
    running_->server->Wait();
    running_.reset();
  }

  ScratchDir dir_;
  int nextDocument_ = 0;
  int nextSession_ = 0;
  std::unique_ptr<Running> running_;
};

}  // namespace tinycad::session::testing

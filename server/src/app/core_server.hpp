#pragma once

// The composition root of tinycad-core (ADR 0030, spec 14, M45): one schema registry, the op
// handlers and the feature builders, the SQLite catalog in the data directory, the catalog
// service of M41, the SessionManager over factories of OcctKernel and PlanegcsSolver, the three
// gRPC services with the standard health service, and the reaper thread of the idle timeout
// (decision N59). main.cpp reads the environment and the signals; this class owns the objects, so
// a test can start the composed server on a free port.
//
// Shutdown (N106, spec 14 "Vlákna a zámky serveru"): the reaper stops, the health service turns
// NOT_SERVING, SessionManager::shutdown() closes the event ring of every loaded document (every
// WatchSession ends), grpc::Server::Shutdown with a deadline lets the calls in flight finish, and
// only then the manager is destroyed (sessions closed, open transactions aborted).

#include <grpcpp/grpcpp.h>

#include <chrono>
#include <condition_variable>
#include <filesystem>
#include <memory>
#include <mutex>
#include <random>
#include <string>
#include <thread>

#include "tinycad/document/schema.hpp"
#include "tinycad/ops/handler.hpp"
#include "tinycad/regen/builder.hpp"
#include "tinycad/service/geometry_service.hpp"
#include "tinycad/session/document_service.hpp"
#include "tinycad/session/runtime_document.hpp"
#include "tinycad/session/session_manager.hpp"
#include "tinycad/session/session_service.hpp"
#include "tinycad/storage/document_service.hpp"
#include "tinycad/storage/store.hpp"

namespace tinycad::app {

struct CoreConfig {
  /** host:port; port 0 picks a free one (CoreServer::port). */
  std::string address = "0.0.0.0:50051";
  /** TINYCAD_DATA_DIR (N61): one SQLite file per document. */
  std::filesystem::path dataDir = "/data";
  /** TINYCAD_SESSION_IDLE_SECONDS (N61). */
  std::chrono::milliseconds idleTimeout = std::chrono::minutes(10);
  /** How often the reaper closes idle sessions (N59). */
  std::chrono::milliseconds reapInterval = std::chrono::seconds(30);
  /** How long the calls in flight may run after a shutdown started. */
  std::chrono::milliseconds shutdownGrace = std::chrono::seconds(5);
};

/** A random UUID v4 (ids of documents and sessions); thread safe. */
class UuidGenerator {
 public:
  std::string next();

 private:
  std::mutex mutex_;
  std::mt19937_64 random_{std::random_device{}()};
};

class CoreServer {
 public:
  /** Builds everything and starts listening; nullptr when the address cannot be bound. */
  static std::unique_ptr<CoreServer> start(const CoreConfig& config);

  /** shutdown() when not done yet. */
  ~CoreServer();
  CoreServer(const CoreServer&) = delete;
  CoreServer& operator=(const CoreServer&) = delete;

  /** The bound port (the chosen one for port 0). */
  [[nodiscard]] int port() const { return port_; }

  /** The shutdown order above; idempotent. Blocks until the gRPC server stopped. */
  void shutdown();

 private:
  explicit CoreServer(const CoreConfig& config);
  bool listen();
  void reapLoop();

  CoreConfig config_;
  UuidGenerator uuids_;

  document::FeatureSchemaRegistry schemas_;
  ops::OpHandlerRegistry handlers_{schemas_};
  regen::FeatureBuilderRegistry builders_;
  std::unique_ptr<storage::DocumentCatalog> catalog_;
  std::unique_ptr<storage::DocumentService> documents_;
  std::unique_ptr<session::RuntimeDocument::Dependencies> runtime_;
  std::unique_ptr<session::SessionManager> manager_;

  service::GeometryServiceImpl geometryService_;
  std::unique_ptr<session::SessionServiceImpl> sessionService_;
  std::unique_ptr<session::DocumentServiceImpl> documentService_;
  std::unique_ptr<grpc::Server> server_;
  int port_ = 0;

  std::mutex reaperMutex_;
  std::condition_variable reaperWake_;
  bool stopping_ = false;
  std::thread reaper_;
};

}  // namespace tinycad::app

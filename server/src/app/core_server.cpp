#include "core_server.hpp"

#include <grpcpp/health_check_service_interface.h>

#include <iostream>
#include <utility>

#include "tinycad/features/builders.hpp"
#include "tinycad/features/builtin.hpp"
#include "tinycad/kernel/occt_kernel.hpp"
#include "tinycad/solver_planegcs/planegcs_solver.hpp"

namespace tinycad::app {

namespace {

/** The services whose health Envoy and Compose check (grpc.health.v1). */
constexpr const char* SERVICES[] = {"tinycad.v1.GeometryService", "tinycad.v1.SessionService",
                                    "tinycad.v1.DocumentService"};

double wallMs() {
  using namespace std::chrono;
  return static_cast<double>(
      duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count());
}

double steadyMs() {
  using namespace std::chrono;
  return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}

}  // namespace

std::string UuidGenerator::next() {
  const std::lock_guard lock(mutex_);
  std::uniform_int_distribution<int> nibble(0, 15);
  std::string uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  for (char& c : uuid) {
    if (c != 'x' && c != 'y') continue;
    int value = nibble(random_);
    if (c == 'y') value = (value & 0x3) | 0x8;
    c = "0123456789abcdef"[value];
  }
  return uuid;
}

std::unique_ptr<CoreServer> CoreServer::start(const CoreConfig& config) {
  // Not make_unique: the constructor is private.
  std::unique_ptr<CoreServer> server(new CoreServer(config));
  if (!server->listen()) return nullptr;
  return server;
}

CoreServer::CoreServer(const CoreConfig& config) : config_(config) {
  features::registerBuiltInSchemas(schemas_);
  features::registerBuiltInBuilders(builders_);
  catalog_ = storage::openSqliteCatalog(config_.dataDir, wallMs);
  documents_ = std::make_unique<storage::DocumentService>(storage::DocumentService::Dependencies{
      *catalog_, schemas_, handlers_, wallMs, [this] { return uuids_.next(); }});
  runtime_ = std::make_unique<session::RuntimeDocument::Dependencies>(
      session::RuntimeDocument::Dependencies{
          *catalog_,
          schemas_,
          handlers_,
          builders_,
          wallMs,
          steadyMs,
          []() -> std::unique_ptr<kernel::GeometryKernel> {
            return std::make_unique<kernel::OcctKernel>();
          },
          []() -> std::unique_ptr<sketch::ConstraintSolver> {
            return std::make_unique<solver_planegcs::PlanegcsSolver>();
          }});
  session::SessionConfig sessions;
  sessions.idleTimeout = config_.idleTimeout;
  manager_ = std::make_unique<session::SessionManager>(session::SessionManager::Dependencies{
      *runtime_, *documents_, [] { return std::chrono::steady_clock::now(); },
      [this] { return uuids_.next(); }, sessions});
  sessionService_ = std::make_unique<rpc::SessionServiceImpl>(*manager_, schemas_);
  documentService_ = std::make_unique<rpc::DocumentServiceImpl>(*manager_);
}

bool CoreServer::listen() {
  grpc::EnableDefaultHealthCheckService(true);
  grpc::ServerBuilder builder;
  builder.AddListeningPort(config_.address, grpc::InsecureServerCredentials(), &port_);
  builder.RegisterService(&geometryService_);
  builder.RegisterService(sessionService_.get());
  builder.RegisterService(documentService_.get());
  server_ = builder.BuildAndStart();
  if (!server_ || port_ == 0) return false;
  for (const char* name : SERVICES) server_->GetHealthCheckService()->SetServingStatus(name, true);
  reaper_ = std::thread([this] { reapLoop(); });
  return true;
}

void CoreServer::reapLoop() {
  std::unique_lock lock(reaperMutex_);
  while (!reaperWake_.wait_for(lock, config_.reapInterval, [this] { return stopping_; })) {
    lock.unlock();
    try {
      const std::size_t closed = manager_->reapIdle();
      if (closed > 0) std::cout << "tinycad-core: closed " << closed << " idle sessions" << std::endl;
    } catch (const std::exception& e) {
      // A programmer error in one reap must not end the reaper (and with it the process).
      std::cerr << "tinycad-core: reaping idle sessions failed: " << e.what() << std::endl;
    }
    lock.lock();
  }
}

void CoreServer::shutdown() {
  {
    const std::lock_guard lock(reaperMutex_);
    if (stopping_) return;
    stopping_ = true;
  }
  reaperWake_.notify_all();
  if (reaper_.joinable()) reaper_.join();
  if (!server_) return;
  server_->GetHealthCheckService()->Shutdown();
  manager_->shutdown();
  server_->Shutdown(std::chrono::system_clock::now() + config_.shutdownGrace);
  server_->Wait();
}

CoreServer::~CoreServer() {
  shutdown();
  // Members go in reverse order: the server and the services before the manager, so no call
  // runs while the manager closes the sessions.
}

}  // namespace tinycad::app

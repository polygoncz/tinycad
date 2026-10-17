// Stub of M45 task 1; implemented by task 3.
#include "tinycad/session/session_manager.hpp"

#include <utility>

#include "not_implemented.hpp"

namespace tinycad::session {

Session::Session(SessionId id, std::shared_ptr<RuntimeDocument> document,
                 kernel::MeshQuality quality, bool writable, SteadyTime now,
                 std::size_t recentCapacity)
    : id_(std::move(id)),
      document_(std::move(document)),
      quality_(quality),
      writable_(writable),
      lastActivity_(now),
      recent_(recentCapacity) {}

void Session::watchEnded(SteadyTime /*now*/) { throwNotImplemented("Session::watchEnded"); }

bool Session::idle(SteadyTime /*now*/, std::chrono::milliseconds /*timeout*/) const {
  throwNotImplemented("Session::idle");
}

SessionManager::SessionManager(Dependencies deps) : deps_(std::move(deps)) {}

SessionManager::~SessionManager() = default;

SessionResult<SessionManager::Opened> SessionManager::open(
    const document::DocumentId& /*document*/,
    const std::optional<kernel::MeshQuality>& /*quality*/,
    const std::string& /*resumeSessionId*/) {
  return core::fail(notImplemented("SessionManager::open"));
}

void SessionManager::close(const std::string& /*sessionId*/) {
  throwNotImplemented("SessionManager::close");
}

SessionResult<SessionPtr> SessionManager::find(const std::string& /*sessionId*/) {
  return core::fail(notImplemented("SessionManager::find"));
}

SessionManager::WatchGuard::WatchGuard(SessionManager& manager, SessionPtr session)
    : manager_(&manager), session_(std::move(session)) {}

SessionManager::WatchGuard::WatchGuard(WatchGuard&& other) noexcept
    : manager_(other.manager_), session_(std::move(other.session_)) {
  other.manager_ = nullptr;
}

SessionManager::WatchGuard::~WatchGuard() = default;

SessionResult<SessionManager::WatchGuard> SessionManager::watch(const std::string& /*sessionId*/) {
  return core::fail(notImplemented("SessionManager::watch"));
}

std::size_t SessionManager::reapIdle() { throwNotImplemented("SessionManager::reapIdle"); }

storage::ServiceResult<std::vector<storage::DocumentSummary>> SessionManager::listDocuments() {
  throwNotImplemented("SessionManager::listDocuments");
}

storage::ServiceResult<storage::DocumentSummary> SessionManager::createDocument(
    const std::string& /*name*/, const storage::OperationKey& /*key*/) {
  throwNotImplemented("SessionManager::createDocument");
}

SessionResult<storage::DocumentSummary> SessionManager::renameDocument(
    const document::DocumentId& /*id*/, const std::string& /*name*/,
    const storage::OperationKey& /*key*/) {
  return core::fail(notImplemented("SessionManager::renameDocument"));
}

SessionResult<void> SessionManager::removeDocument(const document::DocumentId& /*id*/) {
  return core::fail(notImplemented("SessionManager::removeDocument"));
}

storage::ServiceResult<storage::DocumentSummary> SessionManager::importDocument(
    std::string_view /*utf8Json*/, const storage::OperationKey& /*key*/) {
  throwNotImplemented("SessionManager::importDocument");
}

storage::ServiceResult<storage::ExportedFile> SessionManager::exportDocument(
    const document::DocumentId& /*id*/) {
  throwNotImplemented("SessionManager::exportDocument");
}

std::size_t SessionManager::sessionCount() const {
  throwNotImplemented("SessionManager::sessionCount");
}

bool SessionManager::isLoaded(const document::DocumentId& /*id*/) const {
  throwNotImplemented("SessionManager::isLoaded");
}

void SessionManager::closeLocked(const SessionId& /*id*/) {
  throwNotImplemented("SessionManager::closeLocked");
}

}  // namespace tinycad::session

#include "tinycad/session/session_manager.hpp"

#include <algorithm>
#include <utility>

#include "tinycad/core/result.hpp"

namespace tinycad::session {

namespace {

SessionError sessionNotFound(const std::string& sessionId) {
  return {ErrorReason::SessionNotFound, "session_id", {},
          "no live session '" + sessionId + "' (closed, timed out or the server restarted)"};
}

}  // namespace

// --- Session ------------------------------------------------------------------------------

Session::Session(SessionId id, std::shared_ptr<RuntimeDocument> document,
                 kernel::MeshQuality quality, bool writable, SteadyTime now,
                 std::size_t recentCapacity)
    : id_(std::move(id)),
      document_(std::move(document)),
      quality_(quality),
      writable_(writable),
      lastActivity_(now),
      recent_(recentCapacity) {}

void Session::watchEnded(SteadyTime now) {
  --openWatches_;
  lastActivity_ = now;
}

bool Session::idle(SteadyTime now, std::chrono::milliseconds timeout) const {
  return openWatches_ == 0 && now - lastActivity_ >= timeout;
}

// --- SessionManager -----------------------------------------------------------------------

SessionManager::SessionManager(Dependencies deps) : deps_(std::move(deps)) {}

SessionManager::~SessionManager() {
  std::vector<Departure> departures;
  {
    const std::lock_guard lock(mutex_);
    while (!sessions_.empty()) {
      const SessionId id = sessions_.begin()->first;
      departures.push_back(detachLocked(id));
    }
  }
  for (Departure& departure : departures) leave(std::move(departure));
}

SessionResult<SessionManager::Opened> SessionManager::open(
    const document::DocumentId& document, const std::optional<kernel::MeshQuality>& quality,
    const std::string& resumeSessionId) {
  std::unique_lock lock(mutex_);
  if (!resumeSessionId.empty()) {
    const auto resumed = sessions_.find(SessionId(resumeSessionId));
    // Only a live session of the SAME document is resumed; any other id is ignored (N56, N70).
    if (resumed != sessions_.end() && resumed->second->document().id() == document) {
      resumed->second->touch(deps_.steady());
      return Opened{resumed->second, true};
    }
  }

  waitForDocumentLocked(lock, document);
  std::shared_ptr<RuntimeDocument> runtime;
  if (const auto loaded = documents_.find(document); loaded != documents_.end()) {
    runtime = loaded->second;
  } else {
    // Load outside the manager mutex (SQLite and the first regeneration, N106) behind a
    // reservation, so a second open of the same document waits instead of loading it twice.
    documents_.emplace(document, nullptr);
    lock.unlock();
    SessionResult<std::unique_ptr<RuntimeDocument>> opened = core::fail(SessionError{});
    try {
      opened = RuntimeDocument::open(document, deps_.runtime);
    } catch (...) {
      lock.lock();
      documents_.erase(document);
      documentsChanged_.notify_all();
      throw;
    }
    lock.lock();
    if (!opened) {
      documents_.erase(document);
      documentsChanged_.notify_all();
      return core::fail(std::move(opened.error()));
    }
    runtime = std::shared_ptr<RuntimeDocument>(std::move(*opened));
    documents_[document] = runtime;
    documentsChanged_.notify_all();
  }

  SessionId id(deps_.newSessionId());
  // The lease has its own leaf lock in RuntimeDocument: this never waits for a running change.
  const bool writable = runtime->acquireLease(id);
  auto session =
      std::make_shared<Session>(id, runtime, quality.value_or(deps_.config.defaultQuality),
                                writable, deps_.steady(), deps_.config.recentResponses);
  sessions_.emplace(id, session);
  return Opened{session, false};
}

void SessionManager::close(const std::string& sessionId) {
  Departure departure;
  {
    const std::lock_guard lock(mutex_);
    const SessionId id(sessionId);
    if (!sessions_.contains(id)) return;
    departure = detachLocked(id);
  }
  leave(std::move(departure));
}

SessionResult<SessionPtr> SessionManager::find(const std::string& sessionId) {
  const std::lock_guard lock(mutex_);
  const auto found = sessions_.find(SessionId(sessionId));
  if (found == sessions_.end()) return core::fail(sessionNotFound(sessionId));
  found->second->touch(deps_.steady());
  return found->second;
}

SessionManager::WatchGuard::WatchGuard(SessionManager& manager, SessionPtr session)
    : manager_(&manager), session_(std::move(session)) {}

SessionManager::WatchGuard::WatchGuard(WatchGuard&& other) noexcept
    : manager_(other.manager_), session_(std::move(other.session_)) {
  other.manager_ = nullptr;
}

SessionManager::WatchGuard::~WatchGuard() {
  if (manager_ == nullptr || session_ == nullptr) return;
  const std::lock_guard lock(manager_->mutex_);
  session_->watchEnded(manager_->deps_.steady());
}

SessionResult<SessionManager::WatchGuard> SessionManager::watch(const std::string& sessionId) {
  const std::lock_guard lock(mutex_);
  const auto found = sessions_.find(SessionId(sessionId));
  if (found == sessions_.end()) return core::fail(sessionNotFound(sessionId));
  found->second->watchStarted();
  found->second->touch(deps_.steady());
  return WatchGuard(*this, found->second);
}

std::size_t SessionManager::reapIdle() {
  std::vector<Departure> departures;
  {
    const std::lock_guard lock(mutex_);
    const SteadyTime now = deps_.steady();
    std::vector<SessionId> idle;
    for (const auto& [id, session] : sessions_) {
      if (session->idle(now, deps_.config.idleTimeout)) idle.push_back(id);
    }
    for (const SessionId& id : idle) departures.push_back(detachLocked(id));
  }
  const std::size_t count = departures.size();
  for (Departure& departure : departures) leave(std::move(departure));
  return count;
}

void SessionManager::shutdown() {
  const std::lock_guard lock(mutex_);
  for (const auto& [id, document] : documents_) {
    if (document != nullptr) document->events().close();
  }
}

// --- the catalog --------------------------------------------------------------------------

storage::ServiceResult<std::vector<storage::DocumentSummary>> SessionManager::listDocuments() {
  const std::lock_guard lock(mutex_);
  return deps_.documents.list();
}

storage::ServiceResult<storage::DocumentSummary> SessionManager::createDocument(
    const std::string& name, const storage::OperationKey& key) {
  const std::lock_guard lock(mutex_);
  return deps_.documents.create(name, key);
}

SessionResult<storage::DocumentSummary> SessionManager::renameDocument(
    const document::DocumentId& id, const std::string& name, const storage::OperationKey& key) {
  std::unique_lock lock(mutex_);
  waitForDocumentLocked(lock, id);
  if (const auto open = documents_.find(id); open != documents_.end()) {
    // An open document is renamed through its runtime document, under its lock, not ours (N37).
    const std::shared_ptr<RuntimeDocument> document = open->second;
    lock.unlock();
    return document->rename(name, key);
  }
  auto renamed = deps_.documents.rename(id, name, key);
  if (!renamed) return core::fail(fromServiceError(renamed.error()));
  return std::move(*renamed);
}

SessionResult<void> SessionManager::removeDocument(const document::DocumentId& id) {
  const std::lock_guard lock(mutex_);
  if (documents_.contains(id)) {
    return core::fail(SessionError{ErrorReason::DocumentOpen, "document_id", {},
                                   "the document is open in a session"});
  }
  auto removed = deps_.documents.remove(id);
  if (!removed) return core::fail(fromServiceError(removed.error()));
  return {};
}

storage::ServiceResult<storage::DocumentSummary> SessionManager::importDocument(
    std::string_view utf8Json, const storage::OperationKey& key) {
  const std::lock_guard lock(mutex_);
  return deps_.documents.importFile(utf8Json, key);
}

storage::ServiceResult<storage::ExportedFile> SessionManager::exportDocument(
    const document::DocumentId& id) {
  const std::lock_guard lock(mutex_);
  return deps_.documents.exportFile(id);
}

std::size_t SessionManager::sessionCount() const {
  const std::lock_guard lock(mutex_);
  return sessions_.size();
}

bool SessionManager::isLoaded(const document::DocumentId& id) const {
  const std::lock_guard lock(mutex_);
  const auto found = documents_.find(id);
  return found != documents_.end() && found->second != nullptr;
}

// --- private ------------------------------------------------------------------------------

SessionManager::Departure SessionManager::detachLocked(const SessionId& id) {
  const auto found = sessions_.find(id);
  TINYCAD_ASSERT(found != sessions_.end(), "detaching an unknown session '" + id.str() + "'");
  Departure departure{found->second, nullptr};
  sessions_.erase(found);

  const document::DocumentId& document = departure.session->document().id();
  const bool last = std::ranges::none_of(sessions_, [&](const auto& entry) {
    return entry.second->document().id() == document;
  });
  if (last) {
    const auto loaded = documents_.find(document);
    TINYCAD_ASSERT(loaded != documents_.end() && loaded->second != nullptr,
                   "a session over a document that is not loaded");
    departure.unload = std::move(loaded->second);  // the entry stays as a reservation (nullptr)
  }
  return departure;
}

void SessionManager::leave(Departure departure) {
  // Under the document lock, never under the manager lock (N106): Abort of an open transaction.
  departure.session->document().releaseLease(departure.session->id());
  if (departure.unload == nullptr) return;

  const document::DocumentId document = departure.unload->id();
  departure.unload->events().close();
  // The runtime document (and its kernel) dies here unless an RPC still holds it.
  departure.unload.reset();
  departure.session.reset();
  {
    const std::lock_guard lock(mutex_);
    documents_.erase(document);
  }
  documentsChanged_.notify_all();
}

void SessionManager::waitForDocumentLocked(std::unique_lock<std::mutex>& lock,
                                           const document::DocumentId& document) {
  documentsChanged_.wait(lock, [&] {
    const auto found = documents_.find(document);
    return found == documents_.end() || found->second != nullptr;
  });
}

}  // namespace tinycad::session

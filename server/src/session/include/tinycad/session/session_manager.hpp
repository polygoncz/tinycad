#pragma once

// Sessions and runtime documents (spec 14 "Sezení", Q094 principle 1, Q102).
//
// A Session is one client (one browser tab) over one RuntimeDocument; it does not belong to a
// connection, so a network failure closes nothing. It ends with CloseSession or after the idle
// timeout: no RPC and no open WatchSession for SessionConfig::idleTimeout (decision N59). The
// first session of a document loads the RuntimeDocument, the last one to leave unloads it.
//
// The SessionManager is also the one door to the catalog (storage::DocumentService, not
// thread-safe): DocumentService RPCs go through it, so a rename or a delete never races with
// opening the same document (N37, N56).
//
// Threads (N54, N106, spec 14 "Vlákna a zámky serveru"): one manager mutex guards the maps, the
// activity of sessions and every catalog call. Nothing long runs under it and it never waits for a
// document lock: loading a document (SQLite, the first regeneration in OCCT) runs outside it behind
// a reservation in the map, and releasing a lease (with the Abort of an open transaction) and
// unloading a document run after it is released. Changes do NOT run under it either: an RPC finds
// its Session (find), releases the manager mutex and calls the RuntimeDocument, which has its own
// mutex. A RuntimeDocument unloaded while an RPC on it is still running lives on in that RPC's
// shared_ptr; it holds no lease any more, so it never writes again. Unloading closes the EventRing
// of the document, so every WatchSession on it ends.

#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "tinycad/document/model.hpp"
#include "tinycad/kernel/types.hpp"
#include "tinycad/session/recent_responses.hpp"
#include "tinycad/session/runtime_document.hpp"
#include "tinycad/session/session_error.hpp"
#include "tinycad/storage/document_service.hpp"

namespace tinycad::session {

using SteadyTime = std::chrono::steady_clock::time_point;

struct SessionConfig {
  /** spec 14: 10 min without an RPC and without an open WatchSession (TINYCAD_SESSION_IDLE_SECONDS). */
  std::chrono::milliseconds idleTimeout = std::chrono::minutes(10);
  /** In-memory idempotence of transaction steps, per session (spec 14: 64). */
  std::size_t recentResponses = 64;
  /** WatchSession sends a heartbeat after this much silence (spec 14: 30 s). */
  std::chrono::milliseconds heartbeat = std::chrono::seconds(30);
  /** The tessellation of a session without OpenSessionRequest.mesh_quality (render MESH_QUALITY). */
  kernel::MeshQuality defaultQuality{0.1, 0.5};
};

/** One client over one runtime document. Created only by the SessionManager. */
class Session {
 public:
  Session(SessionId id, std::shared_ptr<RuntimeDocument> document, kernel::MeshQuality quality,
          bool writable, SteadyTime now, std::size_t recentCapacity);

  [[nodiscard]] const SessionId& id() const { return id_; }
  [[nodiscard]] RuntimeDocument& document() const { return *document_; }
  [[nodiscard]] const std::shared_ptr<RuntimeDocument>& documentPtr() const { return document_; }
  /** { id, quality }: what every RuntimeDocument call takes. */
  [[nodiscard]] Caller caller() const { return {id_, quality_}; }
  /** Got the edit lease at open; never changes during the session (Q102). */
  [[nodiscard]] bool writable() const { return writable_; }
  /** Used only under the document mutex (RuntimeDocument step calls). */
  [[nodiscard]] RecentResponses& recent() { return recent_; }

  // Activity: called only by the SessionManager under its mutex.
  void touch(SteadyTime now) { lastActivity_ = now; }
  void watchStarted() { ++openWatches_; }
  void watchEnded(SteadyTime now);
  /** No open WatchSession and now - lastActivity >= timeout. */
  [[nodiscard]] bool idle(SteadyTime now, std::chrono::milliseconds timeout) const;

 private:
  SessionId id_;
  std::shared_ptr<RuntimeDocument> document_;
  kernel::MeshQuality quality_;
  bool writable_;
  SteadyTime lastActivity_;
  int openWatches_ = 0;
  RecentResponses recent_;
};

using SessionPtr = std::shared_ptr<Session>;

class SessionManager {
 public:
  using SteadyClock = std::function<SteadyTime()>;

  struct Dependencies {
    /** What every RuntimeDocument is opened with (catalog, registries, clocks, factories). */
    RuntimeDocument::Dependencies runtime;
    /** The catalog service of M41 over the same catalog as `runtime.catalog`. */
    storage::DocumentService& documents;
    /** Activity and idle timeout; tests pass a fake clock and call reapIdle() themselves. */
    SteadyClock steady;
    /** A new session id (UUID v4; sequential in tests). */
    std::function<std::string()> newSessionId;
    SessionConfig config;
  };

  /** `deps` (its references) must outlive the manager. */
  explicit SessionManager(Dependencies deps);
  /** Closes every session (lease release, Abort of open transactions) and unloads documents. */
  ~SessionManager();
  SessionManager(const SessionManager&) = delete;
  SessionManager& operator=(const SessionManager&) = delete;

  struct Opened {
    SessionPtr session;
    /** True when resumeSessionId named a live session of the same document (N56, N70). */
    bool resumed = false;
  };

  /**
   * OpenSession. With a non-empty `resumeSessionId` naming a live session of `document`, that
   * session is returned (touched, lease unchanged, resumed = true); an unknown, closed or foreign
   * id is ignored and a new session opens. A new session loads the RuntimeDocument when it is not
   * loaded (DocumentNotFound / InvalidDocument / Storage on failure, nothing kept), takes the
   * lease when free (writable) and uses `quality` or SessionConfig::defaultQuality.
   */
  SessionResult<Opened> open(const document::DocumentId& document,
                             const std::optional<kernel::MeshQuality>& quality,
                             const std::string& resumeSessionId);

  /**
   * CloseSession; idempotent (an unknown id succeeds). Releases the lease (Abort of its open
   * transaction) and unloads the document when it was its last session.
   */
  void close(const std::string& sessionId);

  /** The live session, touched (every RPC of the session calls it first); else SessionNotFound. */
  SessionResult<SessionPtr> find(const std::string& sessionId);

  /** Counts an open WatchSession of a session (no idle timeout while it lives). Move-only. */
  class WatchGuard {
   public:
    WatchGuard(SessionManager& manager, SessionPtr session);
    WatchGuard(WatchGuard&& other) noexcept;
    WatchGuard& operator=(WatchGuard&&) = delete;
    WatchGuard(const WatchGuard&) = delete;
    WatchGuard& operator=(const WatchGuard&) = delete;
    /** watchEnded + touch: the idle time counts from the end of the stream. */
    ~WatchGuard();
    [[nodiscard]] const SessionPtr& session() const { return session_; }

   private:
    SessionManager* manager_;
    SessionPtr session_;
  };

  /** WatchSession start: the live session with its stream counted; else SessionNotFound. */
  SessionResult<WatchGuard> watch(const std::string& sessionId);

  /**
   * Closes every idle session (Session::idle with SessionConfig::idleTimeout) as close() does.
   * Returns how many. main.cpp calls it from a reaper thread every 30 s.
   */
  std::size_t reapIdle();

  // --- the catalog (DocumentService RPCs), all under the manager mutex ----------------------

  storage::ServiceResult<std::vector<storage::DocumentSummary>> listDocuments();
  storage::ServiceResult<storage::DocumentSummary> createDocument(const std::string& name,
                                                                  const storage::OperationKey& key);
  /** Open document → RuntimeDocument::rename (N37); closed → storage::DocumentService::rename. */
  SessionResult<storage::DocumentSummary> renameDocument(const document::DocumentId& id,
                                                         const std::string& name,
                                                         const storage::OperationKey& key);
  /** Open document → DocumentOpen (N56, as the browser refused it before); closed → remove. */
  SessionResult<void> removeDocument(const document::DocumentId& id);
  storage::ServiceResult<storage::DocumentSummary> importDocument(std::string_view utf8Json,
                                                                  const storage::OperationKey& key);
  storage::ServiceResult<storage::ExportedFile> exportDocument(const document::DocumentId& id);

  /**
   * Server shutdown, BEFORE grpc::Server::Shutdown (N106): closes the EventRing of every loaded
   * document, so every running WatchSession ends and the gRPC shutdown does not wait for them.
   * Sessions stay until the manager is destroyed.
   */
  void shutdown();

  [[nodiscard]] const SessionConfig& config() const { return deps_.config; }
  [[nodiscard]] std::size_t sessionCount() const;
  [[nodiscard]] bool isLoaded(const document::DocumentId& id) const;

 private:
  /** What closing a session leaves to do after the manager mutex is released (N106). */
  struct Departure {
    SessionPtr session;
    /** Set when it was the last session of its document: unload it. */
    std::shared_ptr<RuntimeDocument> unload;
  };

  /**
   * Under mutex_: erases the session; after the last session of a document its map entry becomes
   * a reservation (nullptr) until leave() finished unloading it.
   */
  Departure detachLocked(const SessionId& id);
  /** Without mutex_: lease release (Abort), then the unload (EventRing closed, entry erased). */
  void leave(Departure departure);
  /** Under mutex_ (held by `lock`): waits until no reservation stands for `document`. */
  void waitForDocumentLocked(std::unique_lock<std::mutex>& lock,
                             const document::DocumentId& document);

  Dependencies deps_;
  mutable std::mutex mutex_;
  /** Signalled when a reservation in documents_ is filled or erased. */
  std::condition_variable documentsChanged_;
  std::map<SessionId, SessionPtr> sessions_;
  /** Loaded documents; nullptr = a reservation while the document loads or unloads (N106). */
  std::map<document::DocumentId, std::shared_ptr<RuntimeDocument>> documents_;
};

}  // namespace tinycad::session

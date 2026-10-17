#pragma once

// Decorators of the store that fail on command (spec 05: failures of writing are simulated by a
// decorator, decision N33): FailingFile over a DocumentFile and FailingCatalog, whose files are
// FailingFiles. The switches are shared, so a test keeps control after the file moved into a
// PersistentDocument.

#include <memory>
#include <utility>

#include "tinycad/storage/store.hpp"

namespace tinycad::testing {

struct FailSwitches {
  bool append = false;
  bool snapshot = false;
  bool load = false;
  bool remove = false;
  /** Calls of appendEntries that reached the decorator (failed ones too). */
  int appendCalls = 0;
};

inline storage::StoreError injectedIo() {
  return storage::StoreError{storage::StoreErrorCode::Io, "injected I/O failure"};
}

class FailingFile final : public storage::DocumentFile {
 public:
  FailingFile(std::unique_ptr<storage::DocumentFile> inner, std::shared_ptr<FailSwitches> switches)
      : inner_(std::move(inner)), switches_(std::move(switches)) {}

  [[nodiscard]] const storage::DocumentId& id() const override { return inner_->id(); }
  storage::StoreResult<storage::DocumentInfo> info() override { return inner_->info(); }

  storage::StoreResult<void> appendEntries(std::span<const storage::StoredEntry> entries) override {
    ++switches_->appendCalls;
    if (switches_->append) return core::fail(injectedIo());
    return inner_->appendEntries(entries);
  }

  storage::StoreResult<void> saveSnapshot(std::int64_t atSeq, const core::Json& snapshot) override {
    if (switches_->snapshot) return core::fail(injectedIo());
    return inner_->saveSnapshot(atSeq, snapshot);
  }

  storage::StoreResult<storage::StoredDocument> load() override {
    if (switches_->load) return core::fail(injectedIo());
    return inner_->load();
  }

  storage::StoreResult<std::optional<storage::StoredEntry>> findEntry(
      std::string_view operationId) override {
    return inner_->findEntry(operationId);
  }

 private:
  std::unique_ptr<storage::DocumentFile> inner_;
  std::shared_ptr<FailSwitches> switches_;
};

class FailingCatalog final : public storage::DocumentCatalog {
 public:
  FailingCatalog(storage::DocumentCatalog& inner, std::shared_ptr<FailSwitches> switches)
      : inner_(inner), switches_(std::move(switches)) {}

  storage::StoreResult<std::vector<storage::DocumentInfo>> list() override { return inner_.list(); }

  storage::StoreResult<std::unique_ptr<storage::DocumentFile>> create(
      const storage::DocumentMeta& meta, const core::Json& initialSnapshot,
      const std::optional<storage::OperationKey>& createdBy) override {
    return wrap(inner_.create(meta, initialSnapshot, createdBy));
  }

  storage::StoreResult<std::unique_ptr<storage::DocumentFile>> open(
      const storage::DocumentId& id) override {
    return wrap(inner_.open(id));
  }

  storage::StoreResult<void> remove(const storage::DocumentId& id) override {
    if (switches_->remove) return core::fail(injectedIo());
    return inner_.remove(id);
  }

  storage::StoreResult<std::optional<std::pair<storage::DocumentId, storage::OperationKey>>>
  findCreated(std::string_view operationId) override {
    return inner_.findCreated(operationId);
  }

 private:
  storage::StoreResult<std::unique_ptr<storage::DocumentFile>> wrap(
      storage::StoreResult<std::unique_ptr<storage::DocumentFile>> file) {
    if (!file) return file;
    return std::unique_ptr<storage::DocumentFile>(
        std::make_unique<FailingFile>(std::move(*file), switches_));
  }

  storage::DocumentCatalog& inner_;
  std::shared_ptr<FailSwitches> switches_;
};

}  // namespace tinycad::testing

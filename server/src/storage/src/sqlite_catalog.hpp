#pragma once

// DocumentCatalog over a directory of '<id>.tinycad.sqlite' files (decisions N32, N39). No
// catalog database: list and findCreated open the files one by one.

#include <filesystem>
#include <string_view>

#include "tinycad/storage/store.hpp"

namespace tinycad::storage {

/** A document id that may go into a file name: [A-Za-z0-9_-]{1,64} (N32). */
bool isSafeDocumentId(std::string_view id);

class SqliteDocumentCatalog final : public DocumentCatalog {
 public:
  SqliteDocumentCatalog(std::filesystem::path directory, WallClock now);

  StoreResult<std::vector<DocumentInfo>> list() override;
  StoreResult<std::unique_ptr<DocumentFile>> create(
      const DocumentMeta& meta, const Json& initialSnapshot,
      const std::optional<OperationKey>& createdBy) override;
  StoreResult<std::unique_ptr<DocumentFile>> open(const DocumentId& id) override;
  StoreResult<void> remove(const DocumentId& id) override;
  StoreResult<std::optional<std::pair<DocumentId, OperationKey>>> findCreated(
      std::string_view operationId) override;

 private:
  [[nodiscard]] std::filesystem::path pathOf(const DocumentId& id) const;
  /** The ids of every '<safe id>.tinycad.sqlite' in the directory (no '.tmp'). */
  StoreResult<std::vector<DocumentId>> storedIds() const;

  std::filesystem::path directory_;
  WallClock now_;
};

}  // namespace tinycad::storage

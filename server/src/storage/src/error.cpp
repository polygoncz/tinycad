#include "tinycad/storage/store.hpp"

namespace tinycad::storage {

std::string_view storeErrorCodeName(StoreErrorCode code) {
  switch (code) {
    case StoreErrorCode::NotFound: return "not-found";
    case StoreErrorCode::AlreadyExists: return "already-exists";
    case StoreErrorCode::SeqGap: return "seq-gap";
    case StoreErrorCode::SnapshotAhead: return "snapshot-ahead";
    case StoreErrorCode::Invalid: return "invalid";
    case StoreErrorCode::DuplicateOperation: return "duplicate-operation";
    case StoreErrorCode::Io: return "io";
  }
  return "io";
}

}  // namespace tinycad::storage

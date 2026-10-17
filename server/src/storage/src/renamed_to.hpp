#pragma once

#include <optional>
#include <span>
#include <string>

#include "tinycad/storage/store.hpp"

namespace tinycad::storage {

/**
 * The name the last top-level document.rename of the batch gives the document (renamedTo of
 * src/persistence/store.ts, M19.2 D5); nullopt = the batch does not rename it. Reads only
 * entry.op.type and entry.op.name of the JSON, so the store does not depend on ops (N33); a
 * document.rename inside a batch operation does not count.
 */
std::optional<std::string> renamedTo(std::span<const StoredEntry> entries);

}  // namespace tinycad::storage

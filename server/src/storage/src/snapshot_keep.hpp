#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace tinycad::storage {

/** Snapshots kept besides the base one (Q009). */
inline constexpr std::size_t KEPT_SNAPSHOTS = 3;

/**
 * The atSeq values to keep after a snapshot write (snapshotSeqsToKeep of src/persistence/store.ts):
 * the base (0) when present and the KEPT_SNAPSHOTS highest, in ascending order.
 */
std::vector<std::int64_t> snapshotSeqsToKeep(std::vector<std::int64_t> atSeqs);

}  // namespace tinycad::storage

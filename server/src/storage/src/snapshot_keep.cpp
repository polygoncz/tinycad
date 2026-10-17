#include "snapshot_keep.hpp"

#include <algorithm>
#include <functional>

namespace tinycad::storage {

std::vector<std::int64_t> snapshotSeqsToKeep(std::vector<std::int64_t> atSeqs) {
  const bool hasBase = std::ranges::find(atSeqs, 0) != atSeqs.end();
  std::erase(atSeqs, 0);
  std::ranges::sort(atSeqs, std::greater<>());
  if (atSeqs.size() > KEPT_SNAPSHOTS) atSeqs.resize(KEPT_SNAPSHOTS);
  if (hasBase) atSeqs.push_back(0);
  std::ranges::sort(atSeqs);
  return atSeqs;
}

}  // namespace tinycad::storage

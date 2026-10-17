#include "snapshot.hpp"

namespace tinycad::storage {

core::Json snapshotJson(const document::DocumentData& data, std::int64_t atSeq) {
  return {{"format", "tinycad.snapshot"},
          {"formatVersion", 1},
          {"atSeq", atSeq},
          {"document", document::documentDataJson(data)}};
}

core::Json snapshotJson(const document::DocumentReader& doc, std::int64_t atSeq) {
  return snapshotJson(document::toData(doc), atSeq);
}

}  // namespace tinycad::storage

#pragma once

// The DocumentSnapshot JSON of spec 05 (createSnapshot of src/persistence/snapshot.ts):
// { format: 'tinycad.snapshot', formatVersion: 1, atSeq, document: DocumentData }.

#include <cstdint>

#include "tinycad/core/json.hpp"
#include "tinycad/document/document.hpp"
#include "tinycad/document/serialize.hpp"

namespace tinycad::storage {

/** The state of the document after entry atSeq (0 = the base snapshot). */
core::Json snapshotJson(const document::DocumentReader& doc, std::int64_t atSeq);

/** The same over data (import replaces meta of the loaded state). */
core::Json snapshotJson(const document::DocumentData& data, std::int64_t atSeq);

}  // namespace tinycad::storage

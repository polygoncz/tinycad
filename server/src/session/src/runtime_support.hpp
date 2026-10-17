#pragma once

// Small helpers of the runtime document (internal to tinycad_session): the proto form of a feature
// status for regen_progress events, the trimming of a document name and the safe file name of a
// STEP export.

#include <string>
#include <string_view>

#include "tinycad/regen/state.hpp"
#include "tinycad/v1/read_model.pb.h"

namespace tinycad::session {

/** regen::FeatureStatus → tinycad.v1.FeatureStatus (the oneof case by kind, error with issues). */
void featureStatusToProto(const regen::FeatureStatus& status, tinycad::v1::FeatureStatus* out);

/**
 * String.prototype.trim of a UTF-8 name (the white space the document.rename handler refuses at
 * the ends). TODO(N109): use the shared trim of core once the cleanup track moved it there.
 */
std::string trimDocumentName(std::string_view name);

/**
 * safeFileName of src/app/file-names.ts as the export of storage does it: `\ / : * ? " < > |` and
 * control characters → '_', spaces and dots trimmed at both ends, empty → 'tinycad'.
 */
std::string safeFileName(const std::string& name);

}  // namespace tinycad::session

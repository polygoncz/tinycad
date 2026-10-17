#pragma once

// Conversion between the common messages (common.proto, geometry.proto) and the domain values
// shared by the services: core::Curve2 (spec 14 "GeometryService", read model regions) and
// document::ParamIssue (error details, feature statuses). A curve without a kind or a point that
// is missing cannot be read: the conversion returns the problem, which the service answers as
// KERNEL_INVALID_INPUT, as a curve of a wrong shape is in the TypeScript kernel. An empty id is
// no id (spec 13). Internal to tinycad_rpc.

#include <optional>
#include <string>
#include <vector>

#include "tinycad/core/curve2.hpp"
#include "tinycad/document/schema.hpp"
#include "tinycad/v1/common.pb.h"
#include "tinycad/v1/geometry.pb.h"

namespace tinycad::rpc {

core::Vec2 fromProto(const tinycad::v1::Vec2& v);
void toProto(core::Vec2 v, tinycad::v1::Vec2& out);
void toProto(const core::Curve2& curve, tinycad::v1::Curve2& out);

/**
 * ParamIssue.params (an object of strings and numbers, or null) → ParamIssue.values; any other
 * value keeps its JSON text rather than lose it.
 */
void issueToProto(const document::ParamIssue& issue, tinycad::v1::ParamIssue* out);

/** Reads the curves of a request; the first problem (with its path) goes to `problem`. */
class CurveReader {
 public:
  /** The curve, or nullopt with problem() set when it is incomplete. */
  std::optional<core::Curve2> read(const tinycad::v1::Curve2& curve, const std::string& path);

  /** All curves, or nullopt with problem() set at the first incomplete one. */
  std::optional<std::vector<core::Curve2>> readAll(
      const google::protobuf::RepeatedPtrField<tinycad::v1::Curve2>& curves,
      const std::string& path);

  [[nodiscard]] const std::string& problem() const { return problem_; }

 private:
  bool point(bool present, const tinycad::v1::Vec2& v, const std::string& path, core::Vec2& out);

  std::string problem_;
};

}  // namespace tinycad::rpc

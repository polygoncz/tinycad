#pragma once

// Inside tinycad_geometry the ported algorithms stop with a Failure deep in their control flow
// (as the TS kernel throws a KernelError); Geometry2d turns it into the error of its Result, so
// no exception leaves the library. Internal to tinycad_geometry.

#include <stdexcept>
#include <string>

#include "tinycad/geometry/geometry.hpp"

namespace tinycad::geometry::detail {

class Failure : public std::runtime_error {
 public:
  Failure(ErrorCode code, const std::string& message)
      : std::runtime_error(message), code_(code) {}

  [[nodiscard]] ErrorCode code() const noexcept { return code_; }

 private:
  ErrorCode code_;
};

}  // namespace tinycad::geometry::detail

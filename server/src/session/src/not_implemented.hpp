#pragma once

// The stubs of M45 task 1 (decision N30): every source file of tinycad_session exists from the
// start, so the parallel tasks 2–5 change only their own files. A stub that returns a
// SessionResult returns notImplemented(); one without a result channel throws through
// throwNotImplemented(). Removed together with the last stub.

#include <string>

#include "tinycad/core/result.hpp"
#include "tinycad/session/session_error.hpp"

namespace tinycad::session {

inline SessionError notImplemented(const std::string& what) {
  return {ErrorReason::Internal, {}, {}, "not implemented: " + what};
}

[[noreturn]] inline void throwNotImplemented(const std::string& what) {
  throw core::AssertionError("not implemented: " + what);
}

}  // namespace tinycad::session
